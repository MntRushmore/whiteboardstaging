/**
 * In-memory sliding-window rate limiter.
 *
 * Scope: PER INSTANCE. Every server instance (or Vercel Fluid Compute function
 * instance) keeps its own Map, so the effective limit is `limit * instances`.
 * For a single-region app with a handful of warm instances this is plenty to
 * stop runaway loops and casual abuse, which is all we need today.
 *
 * To make it global, swap `checkRateLimit` for a Redis-backed implementation:
 *   - Upstash: `npm i @upstash/ratelimit @upstash/redis`, then
 *       const rl = new Ratelimit({ redis: Redis.fromEnv(), limiter: Ratelimit.slidingWindow(limit, `${windowMs} ms`) });
 *       const { success, remaining, reset } = await rl.limit(key);
 *     and return { ok: success, remaining, retryAfterMs: reset - Date.now() }.
 *   - Plain Redis: ZADD <key> <now> <now>; ZREMRANGEBYSCORE <key> 0 <now-window>; ZCARD <key>; PEXPIRE <key> <window>.
 * Keep the `RateLimitResult` shape and the callers stay untouched (they would
 * just need to `await` the call, which they already do).
 */

import { LIVE_RATE_LIMITS } from "@/lib/live/contracts";

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

/** 429 response following the shared error contract, with a Retry-After header. */
export function rateLimitedResponse(retryAfterMs: number): Response {
  const retryAfterSec = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return Response.json(
    {
      error: "rate_limited",
      message: `You're doing that too fast. Try again in ${retryAfterSec} second${retryAfterSec === 1 ? "" : "s"}.`,
      retryAfterMs,
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
