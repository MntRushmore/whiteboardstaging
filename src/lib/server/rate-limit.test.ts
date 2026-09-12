import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LIMITS,
  checkRateLimit,
  rateLimitKey,
  rateLimitedResponse,
  resetRateLimits,
  trackedKeyCount,
} from "@/lib/server/rate-limit";

const opts = { limit: 3, windowMs: 1_000 };

describe("checkRateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-11T12:00:00Z"));
    resetRateLimits();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows up to `limit` requests and then blocks", () => {
    expect(checkRateLimit("u1:test", opts)).toMatchObject({ ok: true, remaining: 2, retryAfterMs: 0 });
    expect(checkRateLimit("u1:test", opts)).toMatchObject({ ok: true, remaining: 1 });
    expect(checkRateLimit("u1:test", opts)).toMatchObject({ ok: true, remaining: 0 });

    const blocked = checkRateLimit("u1:test", opts);
    expect(blocked.ok).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    expect(blocked.retryAfterMs).toBeLessThanOrEqual(opts.windowMs);
  });

  it("does not count blocked requests against the window", () => {
    for (let i = 0; i < 3; i++) checkRateLimit("u1:test", opts);
    checkRateLimit("u1:test", opts); // blocked
    vi.advanceTimersByTime(opts.windowMs + 1);
    // All three original hits expired; blocked attempt was not recorded.
    expect(checkRateLimit("u1:test", opts)).toMatchObject({ ok: true, remaining: 2 });
  });

  it("slides: frees a slot once the oldest request leaves the window", () => {
    checkRateLimit("u1:test", opts); // t=0
    vi.advanceTimersByTime(400);
    checkRateLimit("u1:test", opts); // t=400
    checkRateLimit("u1:test", opts); // t=400

    const blocked = checkRateLimit("u1:test", opts);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterMs).toBe(600); // first hit at t=0 expires at t=1000

    vi.advanceTimersByTime(600);
    expect(checkRateLimit("u1:test", opts)).toMatchObject({ ok: true, remaining: 0 });
    expect(checkRateLimit("u1:test", opts).ok).toBe(false);

    vi.advanceTimersByTime(400); // t=1400 -> the two t=400 hits expire
    expect(checkRateLimit("u1:test", opts)).toMatchObject({ ok: true, remaining: 1 });
  });

  it("isolates keys from each other (different users and buckets)", () => {
    for (let i = 0; i < 3; i++) checkRateLimit(rateLimitKey("alice", "ocr"), opts);
    expect(checkRateLimit(rateLimitKey("alice", "ocr"), opts).ok).toBe(false);

    expect(checkRateLimit(rateLimitKey("bob", "ocr"), opts)).toMatchObject({ ok: true, remaining: 2 });
    expect(checkRateLimit(rateLimitKey("alice", "credits"), opts)).toMatchObject({ ok: true, remaining: 2 });
  });

  it("prunes stale keys without any timers", () => {
    checkRateLimit("u1:test", opts);
    checkRateLimit("u2:test", opts);
    expect(trackedKeyCount()).toBe(2);

    // Prune runs at most once a minute, from inside checkRateLimit.
    vi.advanceTimersByTime(61_000);
    checkRateLimit("u3:test", opts);
    expect(trackedKeyCount()).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("LIMITS", () => {
  it("matches the documented per-route budget", () => {
    expect(LIMITS.generateSolution).toEqual({ limit: 12, windowMs: 60_000 });
    expect(LIMITS.generateWorksheet).toEqual({ limit: 4, windowMs: 60_000 });
    expect(LIMITS.voiceToken).toEqual({ limit: 6, windowMs: 60_000 });
    expect(LIMITS.analyzeWorkspace).toEqual({ limit: 30, windowMs: 60_000 });
    expect(LIMITS.ocr).toEqual({ limit: 30, windowMs: 60_000 });
    expect(LIMITS.checkHelp).toEqual({ limit: 30, windowMs: 60_000 });
    expect(LIMITS.credits).toEqual({ limit: 30, windowMs: 60_000 });
  });

  it("includes the Live Math buckets from the shared contracts", () => {
    expect(LIMITS.liveRecognize).toEqual({ limit: 120, windowMs: 60_000 });
    expect(LIMITS.liveCheck).toEqual({ limit: 30, windowMs: 60_000 });
    expect(LIMITS.liveSolve).toEqual({ limit: 10, windowMs: 60_000 });
  });
});

describe("rateLimitedResponse", () => {
  it("returns a 429 with the error contract and a Retry-After header in seconds", async () => {
    const res = rateLimitedResponse(1_500);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("2");
    const body = await res.json();
    expect(body.error).toBe("rate_limited");
    expect(typeof body.message).toBe("string");
    expect(body.retryAfterMs).toBe(1_500);
  });

  it("never advertises a Retry-After below 1 second", () => {
    expect(rateLimitedResponse(0).headers.get("Retry-After")).toBe("1");
  });
});
