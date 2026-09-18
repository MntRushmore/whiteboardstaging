/**
 * Rate limiting.
 *
 * Two limiters share the `RateLimitResult` shape:
 *
 *  - `checkRateLimit` — in-memory sliding window, PER INSTANCE. Every server instance
 *    (or Vercel Fluid Compute function instance) keeps its own Map, so the effective
 *    limit is `limit * instances`. Used for the public, IP-keyed buckets (config/status,
 *    billing/webhook) where there is no user to key a database row on, and as the
 *    fallback below.
 *
 *  - `checkRateLimitDistributed` — the per-user buckets. With `RATE_LIMIT_BACKEND=db`
 *    (the default) it calls the SECURITY DEFINER RPC `rate_limit_hit(p_bucket, p_limit,
 *    p_window_ms)` AS THE USER (supabase/migrations/20260917030000_refunds_ratelimit.sql):
 *    one fixed window per (auth.uid(), bucket, window_start), incremented atomically, so a
 *    budget holds across every instance. When the RPC is missing or errors the call falls
 *    back to the in-memory limiter (logged once per process) — a degraded limiter, never an
 *    open gate. `RATE_LIMIT_BACKEND=memory` skips the database entirely.
 */

import { LIVE_RATE_LIMITS } from "@/lib/live/contracts";
import { getRateLimitBackend, type RateLimitBackend } from "@/lib/env";
import { logger } from "@/lib/logger";
import { userClient, type RpcClient } from "@/lib/server/billing";

export type RateLimitOptions = { limit: number; windowMs: number };

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  /** Milliseconds until the oldest request in the window expires (0 when ok). */
  retryAfterMs: number;
};

const MINUTE = 60_000;

/** Per-user limits for each API route (requests per window). */
export const LIMITS = {
  generateSolution: { limit: 12, windowMs: MINUTE },
  generateWorksheet: { limit: 4, windowMs: MINUTE },
  voiceToken: { limit: 6, windowMs: MINUTE },
  analyzeWorkspace: { limit: 30, windowMs: MINUTE },
  ocr: { limit: 30, windowMs: MINUTE },
  checkHelp: { limit: 30, windowMs: MINUTE },
  credits: { limit: 30, windowMs: MINUTE },
  // Live Math routes (budgets are defined once, in the shared contracts).
  liveRecognize: LIVE_RATE_LIMITS.liveRecognize,
  liveCheck: LIVE_RATE_LIMITS.liveCheck,
  liveSolve: LIVE_RATE_LIMITS.liveSolve,
} as const satisfies Record<string, RateLimitOptions>;

export type RateLimitBucket = keyof typeof LIMITS;

// key -> sorted list of request timestamps (ms) inside the current window.
const windows = new Map<string, number[]>();

// Opportunistic pruning: instead of a setInterval (which would keep a serverless
// instance alive / leak in tests), sweep stale keys at most once per interval
// from inside `checkRateLimit`.
const PRUNE_EVERY_MS = MINUTE;
const MAX_WINDOW_MS = Math.max(...Object.values(LIMITS).map((l) => l.windowMs));
let lastPruneAt = 0;

function pruneStale(now: number, windowMs: number): void {
  if (now - lastPruneAt < PRUNE_EVERY_MS) return;
  lastPruneAt = now;
  const horizon = now - Math.max(windowMs, MAX_WINDOW_MS);
  for (const [key, stamps] of windows) {
    if (stamps.length === 0 || stamps[stamps.length - 1] <= horizon) {
      windows.delete(key);
    }
  }
}

/**
 * Record one hit for `key` and report whether it is within `limit` requests
 * per `windowMs`. Keys are conventionally `${userId}:${bucket}`.
 */
export function checkRateLimit(key: string, { limit, windowMs }: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  pruneStale(now, windowMs);

  const cutoff = now - windowMs;
  let stamps = windows.get(key);
  if (!stamps) {
    stamps = [];
    windows.set(key, stamps);
  }

  // Drop timestamps that have left the window (list is chronological).
  let firstLive = 0;
  while (firstLive < stamps.length && stamps[firstLive] <= cutoff) firstLive++;
  if (firstLive > 0) stamps.splice(0, firstLive);

  if (stamps.length >= limit) {
    const retryAfterMs = Math.max(1, stamps[0] + windowMs - now);
    return { ok: false, remaining: 0, retryAfterMs };
  }

  stamps.push(now);
  return { ok: true, remaining: limit - stamps.length, retryAfterMs: 0 };
}

/** Convenience: build the canonical key for a user + bucket. */
export function rateLimitKey(userId: string, bucket: RateLimitBucket): string {
  return `${userId}:${bucket}`;
}

/* ------------------------------------------------------------------------- */
/* Distributed (database-backed) limiter                                      */
/* ------------------------------------------------------------------------- */

export const RATE_LIMIT_HIT_RPC = "rate_limit_hit";

export type DistributedRateLimitResult = RateLimitResult & {
  /** Which limiter answered: `db` (shared counters) or `memory` (per instance). */
  backend: RateLimitBackend;
};

export type DistributedRateLimitInput = {
  /** The caller's verified Supabase access token (from `requireUser`). */
  token: string;
  userId: string;
  bucket: RateLimitBucket;
  /** Defaults to `LIMITS[bucket]`. */
  cfg?: RateLimitOptions;
};

const rateLimitLogger = logger.child({ module: "rate-limit" });

let warnedFallback = false;

/**
 * Parse the `rate_limit_hit` payload `{ allowed, remaining, retry_after_ms, backend }`.
 * Returns null for anything unexpected so the caller falls back. Exported for tests.
 */
export function normalizeRateLimitHit(data: unknown, { limit, windowMs }: RateLimitOptions): DistributedRateLimitResult | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  if (typeof r.allowed !== "boolean") return null;
  const remaining = typeof r.remaining === "number" && Number.isFinite(r.remaining) ? Math.max(0, r.remaining) : r.allowed ? limit : 0;
  const retryRaw = typeof r.retry_after_ms === "number" && Number.isFinite(r.retry_after_ms) ? r.retry_after_ms : windowMs;
  return {
    ok: r.allowed,
    remaining: r.allowed ? remaining : 0,
    retryAfterMs: r.allowed ? 0 : Math.max(1, Math.min(windowMs, Math.round(retryRaw))),
    backend: "db",
  };
}

function memoryFallback(userId: string, bucket: RateLimitBucket, cfg: RateLimitOptions, reason: string | null): DistributedRateLimitResult {
  if (reason !== null && !warnedFallback) {
    warnedFallback = true;
    rateLimitLogger.warn({ bucket, error: reason }, "rate_limit_hit unavailable; falling back to the in-memory limiter for this process");
  }
  return { ...checkRateLimit(rateLimitKey(userId, bucket), cfg), backend: "memory" };
}

/**
 * Record one hit for `userId` in `bucket` across every instance (see the module comment).
 * Never throws and never answers "open": any database problem degrades to `checkRateLimit`.
 */
export async function checkRateLimitDistributed(input: DistributedRateLimitInput, client?: RpcClient): Promise<DistributedRateLimitResult> {
  const cfg = input.cfg ?? LIMITS[input.bucket];
  if (getRateLimitBackend() === "memory") return memoryFallback(input.userId, input.bucket, cfg, null);

  try {
    const rpcClient = client ?? userClient(input.token);
    const { data, error } = await rpcClient.rpc(RATE_LIMIT_HIT_RPC, {
      p_bucket: input.bucket,
      p_limit: cfg.limit,
      p_window_ms: cfg.windowMs,
    });
    if (error) return memoryFallback(input.userId, input.bucket, cfg, `rate_limit_hit failed: ${error.message}`);
    const result = normalizeRateLimitHit(data, cfg);
    if (!result) return memoryFallback(input.userId, input.bucket, cfg, "rate_limit_hit returned an unexpected shape");
    return result;
  } catch (err) {
    return memoryFallback(input.userId, input.bucket, cfg, `rate_limit_hit threw: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Tests only: forget that the fallback warning was already logged. */
export function resetRateLimitFallbackWarning(): void {
  warnedFallback = false;
}

/* ------------------------------------------------------------------------- */
/* Responses                                                                  */
/* ------------------------------------------------------------------------- */

/**
 * 429 response following the shared error contract, with a Retry-After header.
 * `backend` (additive) tells which limiter answered, when known.
 */
export function rateLimitedResponse(retryAfterMs: number, backend?: RateLimitBackend): Response {
  const retryAfterSec = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return Response.json(
    {
      error: "rate_limited",
      message: `You're doing that too fast. Try again in ${retryAfterSec} second${retryAfterSec === 1 ? "" : "s"}.`,
      retryAfterMs,
      ...(backend ? { backend } : {}),
    },
    {
      status: 429,
      headers: { "Retry-After": String(retryAfterSec) },
    },
  );
}

/** Clear all state (tests only). */
export function resetRateLimits(): void {
  windows.clear();
  lastPruneAt = 0;
}

/** Number of tracked keys (tests only). */
export function trackedKeyCount(): number {
  return windows.size;
}
