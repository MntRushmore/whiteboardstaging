import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetServerEnvCache } from "@/lib/env";
import type { RpcClient, RpcError } from "@/lib/server/billing";
import {
  LIMITS,
  checkRateLimit,
  checkRateLimitDistributed,
  normalizeRateLimitHit,
  rateLimitKey,
  rateLimitedResponse,
  resetRateLimitFallbackWarning,
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

  it("adds the additive `backend` field only when given", async () => {
    expect(await rateLimitedResponse(500).json()).toEqual({ error: "rate_limited", message: expect.any(String), retryAfterMs: 500 });
    expect(await rateLimitedResponse(500, "db").json()).toMatchObject({ error: "rate_limited", retryAfterMs: 500, backend: "db" });
    expect(await rateLimitedResponse(500, "memory").json()).toMatchObject({ backend: "memory" });
  });
});

/* ------------------------------------------------------------------------- */
/* Distributed limiter                                                        */
/* ------------------------------------------------------------------------- */

const ENV_VARS = ["RATE_LIMIT_BACKEND", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "OPENROUTER_API_KEY"];
const savedEnv: Record<string, string | undefined> = {};

/** A fake RPC client that records calls and answers with a scripted result (or throws). */
function fakeRpc(reply: { data?: unknown; error?: RpcError | null } | Error): RpcClient & { calls: Array<{ fn: string; args?: Record<string, unknown> }> } {
  const calls: Array<{ fn: string; args?: Record<string, unknown> }> = [];
  return {
    calls,
    rpc: (fn, args) => {
      calls.push({ fn, args });
      if (reply instanceof Error) return Promise.reject(reply);
      return Promise.resolve({ data: reply.data ?? null, error: reply.error ?? null });
    },
  };
}

describe("normalizeRateLimitHit", () => {
  const cfg = { limit: 30, windowMs: 60_000 };

  it("maps the jsonb shape the migration returns", () => {
    expect(normalizeRateLimitHit({ allowed: true, remaining: 29, retry_after_ms: 0, backend: "db" }, cfg)).toEqual({ ok: true, remaining: 29, retryAfterMs: 0, backend: "db" });
    expect(normalizeRateLimitHit({ allowed: false, remaining: 0, retry_after_ms: 41_000, backend: "db" }, cfg)).toEqual({ ok: false, remaining: 0, retryAfterMs: 41_000, backend: "db" });
    expect(normalizeRateLimitHit([{ allowed: true, remaining: 3, retry_after_ms: 0 }], cfg)).toMatchObject({ ok: true, remaining: 3 });
  });

  it("clamps retry_after_ms into 1..windowMs when denied and returns null for garbage", () => {
    expect(normalizeRateLimitHit({ allowed: false, remaining: 0, retry_after_ms: 0 }, cfg)).toMatchObject({ retryAfterMs: 1 });
    expect(normalizeRateLimitHit({ allowed: false, remaining: 0, retry_after_ms: 999_999 }, cfg)).toMatchObject({ retryAfterMs: 60_000 });
    expect(normalizeRateLimitHit({ allowed: false }, cfg)).toMatchObject({ ok: false, remaining: 0, retryAfterMs: 60_000 });
    for (const payload of [null, undefined, 1, "x", {}, { allowed: "yes" }, []]) {
      expect(normalizeRateLimitHit(payload, cfg), JSON.stringify(payload)).toBeNull();
    }
  });
});

describe("checkRateLimitDistributed", () => {
  const input = { token: "jwt", userId: "user-1", bucket: "credits" as const };

  beforeEach(() => {
    for (const name of ENV_VARS) {
      savedEnv[name] = process.env[name];
      delete process.env[name];
    }
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    resetServerEnvCache();
    resetRateLimits();
    resetRateLimitFallbackWarning();
  });

  afterEach(() => {
    for (const name of ENV_VARS) {
      if (savedEnv[name] === undefined) delete process.env[name];
      else process.env[name] = savedEnv[name];
    }
    resetServerEnvCache();
  });

  it("calls rate_limit_hit with the bucket's LIMITS and reports an allowed hit from the db backend", async () => {
    const client = fakeRpc({ data: { allowed: true, remaining: 29, retry_after_ms: 0, backend: "db" } });
    await expect(checkRateLimitDistributed(input, client)).resolves.toEqual({ ok: true, remaining: 29, retryAfterMs: 0, backend: "db" });
    expect(client.calls).toEqual([{ fn: "rate_limit_hit", args: { p_bucket: "credits", p_limit: 30, p_window_ms: 60_000 } }]);
    expect(trackedKeyCount(), "the memory limiter is not touched when the db answers").toBe(0);
  });

  it("reports a denied hit with the database's retry_after_ms", async () => {
    const client = fakeRpc({ data: { allowed: false, remaining: 0, retry_after_ms: 12_345, backend: "db" } });
    await expect(checkRateLimitDistributed(input, client)).resolves.toEqual({ ok: false, remaining: 0, retryAfterMs: 12_345, backend: "db" });
  });

  it("honours an explicit cfg over LIMITS", async () => {
    const client = fakeRpc({ data: { allowed: true, remaining: 1, retry_after_ms: 0 } });
    await checkRateLimitDistributed({ ...input, cfg: { limit: 2, windowMs: 1_000 } }, client);
    expect(client.calls[0].args).toEqual({ p_bucket: "credits", p_limit: 2, p_window_ms: 1_000 });
  });

  it.each([
    ["missing function", fakeRpc({ error: { message: "Could not find the function public.rate_limit_hit in the schema cache", code: "PGRST202" } })],
    ["RPC error", fakeRpc({ error: { message: "permission denied", code: "42501" } })],
    ["thrown error", fakeRpc(new Error("fetch failed"))],
    ["unexpected shape", fakeRpc({ data: { nope: true } })],
  ])("falls back to the in-memory limiter on %s and still limits (never open)", async (_label, client) => {
    const cfg = { limit: 2, windowMs: 60_000 };
    const first = await checkRateLimitDistributed({ ...input, cfg }, client);
    expect(first).toEqual({ ok: true, remaining: 1, retryAfterMs: 0, backend: "memory" });
    expect(await checkRateLimitDistributed({ ...input, cfg }, client)).toMatchObject({ ok: true, remaining: 0, backend: "memory" });
    const third = await checkRateLimitDistributed({ ...input, cfg }, client);
    expect(third.ok).toBe(false);
    expect(third.backend).toBe("memory");
    expect(third.retryAfterMs).toBeGreaterThan(0);
    expect(trackedKeyCount()).toBe(1);
    expect(client.calls.length, "the database is retried on every call, not given up on").toBe(3);
  });

  it("RATE_LIMIT_BACKEND=memory skips the RPC entirely", async () => {
    process.env.RATE_LIMIT_BACKEND = "memory";
    resetServerEnvCache();
    const client = fakeRpc({ error: { message: "must not be called" } });
    await expect(checkRateLimitDistributed(input, client)).resolves.toEqual({ ok: true, remaining: 29, retryAfterMs: 0, backend: "memory" });
    expect(client.calls).toEqual([]);
  });

  it("any other RATE_LIMIT_BACKEND value keeps the db backend", async () => {
    process.env.RATE_LIMIT_BACKEND = "redis";
    resetServerEnvCache();
    const client = fakeRpc({ data: { allowed: true, remaining: 4, retry_after_ms: 0 } });
    await expect(checkRateLimitDistributed(input, client)).resolves.toMatchObject({ backend: "db" });
    expect(client.calls.length).toBe(1);
  });
});
