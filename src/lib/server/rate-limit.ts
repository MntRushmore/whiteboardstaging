/**
 * Rate limiting.
 *
 * Two limiters share the `RateLimitResult` shape:
 *
 *  - `checkRateLimit` — in-memory sliding window, PER INSTANCE. Every server instance
 *    (or Vercel Fluid Compute function instance) keeps its own Map, so the effective
 *    limit is `limit * instances`. Used for the public, IP-keyed buckets (config/status,
 *    billing/webhook, admin/gc, client-errors, health; `clientIp`) where there is no user to
 *    key a database row on, and as the fallback below.
 *
 *  - `checkRateLimitDistributed` — the per-user buckets. With `RATE_LIMIT_BACKEND=db`
 *    (the default) it calls the SECURITY DEFINER RPC `rate_limit_hit(p_bucket, p_limit,
 *    p_window_ms)` AS THE USER (supabase/migrations/20260917030000_refunds_ratelimit.sql):
 *    one fixed window per (auth.uid(), bucket, window_start), incremented atomically, so a
 *    budget holds across every instance. When the RPC is missing or errors the call falls
 *    back to the in-memory limiter (logged once per process) — a degraded limiter, never an
 *    open gate. `RATE_LIMIT_BACKEND=memory` skips the database entirely.
 *
 * And one budget for everyone together, `spendGlobalBudget` (below): units a call spends (read
 * aloud's characters), counted for the whole app rather than per user.
 */

import { LIVE_RATE_LIMITS } from "@/lib/live/contracts";
import { SPEAK_GLOBAL_BUDGET, SPEAK_RATE_LIMITS } from "@/lib/speech/contracts";
import { getRateLimitBackend, type RateLimitBackend } from "@/lib/env";
import { logger } from "@/lib/logger";
import { serviceClient, userClient, type RpcClient } from "@/lib/server/billing";

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
  credits: { limit: 30, windowMs: MINUTE },
  // The admin console's routes (src/app/api/admin/{users,boards,bugs,issues}; admins only): page loads,
  // triage, and the board viewer's follow-live poll (one every ADMIN_LIMITS.followPollMs, 15 a minute).
  adminConsole: { limit: 120, windowMs: MINUTE },
  // A bug report's screenshot (the inbox may load several at once; the browser keeps each 5 minutes).
  adminScreenshot: { limit: 240, windowMs: MINUTE },
  // POST /api/email/welcome: the app asks once, at the end of the tour; the email itself goes at most once.
  emailWelcome: { limit: 5, windowMs: MINUTE },
  // A reporter writing back on their bug report (POST /api/bug-reports/<id>/messages): each one emails
  // the operator. bug_report_reply() also caps a report at 20 replies a day, however it is called.
  bugReply: { limit: 6, windowMs: MINUTE },
  // The family routes (src/app/api/family): the Family page's reads and a grown-up's edits.
  family: { limit: 30, windowMs: MINUTE },
  // Switching profiles, per caller. The grown-up's PIN has its own budget per FAMILY (PIN_ATTEMPTS,
  // src/lib/family/server/pin.ts), counted in the database.
  familySwitch: { limit: 20, windowMs: MINUTE },
  // The weekly report (src/app/api/report): the page's week picker and a replay's board.
  report: { limit: 30, windowMs: MINUTE },
  // Live Math routes (budgets are defined once, in the shared contracts).
  liveRecognize: LIVE_RATE_LIMITS.liveRecognize,
  liveCheck: LIVE_RATE_LIMITS.liveCheck,
  liveSolve: LIVE_RATE_LIMITS.liveSolve,
  liveSetup: LIVE_RATE_LIMITS.liveSetup,
  liveReread: LIVE_RATE_LIMITS.liveReread,
  liveProof: LIVE_RATE_LIMITS.liveProof,
  liveChat: LIVE_RATE_LIMITS.liveChat,
  liveLecture: LIVE_RATE_LIMITS.liveLecture,
  liveListen: LIVE_RATE_LIMITS.liveListen,
  liveSketch: LIVE_RATE_LIMITS.liveSketch,
  liveTitle: LIVE_RATE_LIMITS.liveTitle,
  // Read aloud (POST /api/live/speak): a minute's budget and a day's cap (src/lib/speech/contracts.ts).
  liveSpeak: SPEAK_RATE_LIMITS.perMinute,
  liveSpeakDay: SPEAK_RATE_LIMITS.perDay,
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
// key -> the window it is counted over: each key is kept only as long as its own window (a day's
// cap, `liveSpeakDay`, must not keep every minute bucket's keys for a day)
const windowOf = new Map<string, number>();

function pruneStale(now: number): void {
  if (now - lastPruneAt < PRUNE_EVERY_MS) return;
  lastPruneAt = now;
  for (const [key, stamps] of windows) {
    const horizon = now - (windowOf.get(key) ?? MAX_WINDOW_MS);
    if (stamps.length === 0 || stamps[stamps.length - 1] <= horizon) {
      windows.delete(key);
      windowOf.delete(key);
    }
  }
}

/**
 * Record one hit for `key` and report whether it is within `limit` requests
 * per `windowMs`. Keys are conventionally `${userId}:${bucket}`.
 */
export function checkRateLimit(key: string, { limit, windowMs }: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  pruneStale(now);
  windowOf.set(key, windowMs);

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

/**
 * The caller's IP for a public route's per-IP bucket (`ip:<ip>:<bucket>`): the first hop of
 * `x-forwarded-for` (Vercel sets it), else `x-real-ip`, else "unknown".
 */
export function clientIp(req: Request): string {
  const first = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return first || req.headers.get("x-real-ip")?.trim() || "unknown";
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
  warnedBudgetFallback = false;
}

/* ------------------------------------------------------------------------- */
/* Budgets for everyone together                                              */
/* ------------------------------------------------------------------------- */

/**
 * Budgets for the whole app, in units each call spends: a ceiling on a shared account's bill
 * however many accounts call. `liveSpeakChars`: the characters read aloud sends to ElevenLabs in a
 * day (SPEAK_GLOBAL_BUDGET).
 */
export const GLOBAL_BUDGETS = {
  liveSpeakChars: SPEAK_GLOBAL_BUDGET,
} as const satisfies Record<string, RateLimitOptions>;

export type GlobalBudget = keyof typeof GLOBAL_BUDGETS;

/**
 * `global_budget_spend(p_bucket, p_amount, p_limit, p_window_ms)`, SECURITY DEFINER, the service
 * role only (supabase/migrations/20261009150000_speech_budget.sql): adds the units to one fixed
 * window in rate_limit_counters for the whole app and answers like `rate_limit_hit`.
 */
export const GLOBAL_BUDGET_RPC = "global_budget_spend";

let warnedBudgetFallback = false;
// bucket -> this instance's own count of the current fixed window (the fallback)
const budgetWindows = new Map<string, { start: number; used: number }>();

function memoryBudget(bucket: GlobalBudget, units: number, { limit, windowMs }: RateLimitOptions, reason: string | null): DistributedRateLimitResult {
  if (reason !== null && !warnedBudgetFallback) {
    warnedBudgetFallback = true;
    rateLimitLogger.warn({ bucket, error: reason }, "global_budget_spend unavailable; counting the budget per instance for this process");
  }
  const now = Date.now();
  const start = now - (now % windowMs);
  let w = budgetWindows.get(bucket);
  if (!w || w.start !== start) {
    w = { start, used: 0 };
    budgetWindows.set(bucket, w);
  }
  w.used += units;
  const ok = w.used <= limit;
  return { ok, remaining: Math.max(0, limit - w.used), retryAfterMs: ok ? 0 : Math.max(1, start + windowMs - now), backend: "memory" };
}

/**
 * Spends `amount` units of a budget for everyone together; `ok: false` once the window's units are
 * spent (they count even then: the day stays spent). Across every instance through the service
 * role; without SUPABASE_SERVICE_ROLE_KEY, with `RATE_LIMIT_BACKEND=memory`, or when the RPC fails
 * (a database without the migration), each instance keeps the budget itself, logged once: a looser
 * ceiling, never none. Never throws.
 */
export async function spendGlobalBudget(bucket: GlobalBudget, amount: number, client?: RpcClient | null): Promise<DistributedRateLimitResult> {
  const cfg = GLOBAL_BUDGETS[bucket];
  const units = Math.max(1, Math.round(amount));
  if (getRateLimitBackend() === "memory") return memoryBudget(bucket, units, cfg, null);
  try {
    const rpcClient = client === undefined ? serviceClient() : client;
    if (!rpcClient) return memoryBudget(bucket, units, cfg, "no SUPABASE_SERVICE_ROLE_KEY");
    const { data, error } = await rpcClient.rpc(GLOBAL_BUDGET_RPC, { p_bucket: bucket, p_amount: units, p_limit: cfg.limit, p_window_ms: cfg.windowMs });
    if (error) return memoryBudget(bucket, units, cfg, `global_budget_spend failed: ${error.message}`);
    return normalizeRateLimitHit(data, cfg) ?? memoryBudget(bucket, units, cfg, "global_budget_spend returned an unexpected shape");
  } catch (err) {
    return memoryBudget(bucket, units, cfg, `global_budget_spend threw: ${err instanceof Error ? err.message : String(err)}`);
  }
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
  windowOf.clear();
  budgetWindows.clear();
  lastPruneAt = 0;
}

/** Number of tracked keys (tests only). */
export function trackedKeyCount(): number {
  return windows.size;
}
