/**
 * Behavioural check of `refund_credits` and `rate_limit_hit` against a LIVE Supabase stack
 * (normally the local one from `npx supabase start` with 20260917030000_refunds_ratelimit.sql
 * applied). Opt-in:
 *
 *   RUN_DB_TESTS=1 npx vitest run src/lib/server/__tests__/refunds.integration.test.ts
 *
 * Uses its OWN throwaway user (qa-refunds@example.com, created on first run like the RLS
 * verifier does) so it cannot race the other DB suites, which spend and re-plan the shared QA
 * user. Every credit it spends it refunds again; rate-limit rows use a unique bucket name and
 * age out on their own.
 */
import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureUser, resolveSupabaseEnv, waitForHealth } from "../../../../scripts/lib/supabaseHttp.mjs";
import { resetServerEnvCache } from "@/lib/env";
import { consumeCredits, refundCredits, userClient } from "@/lib/server/billing";
import { RATE_LIMIT_HIT_RPC, normalizeRateLimitHit } from "@/lib/server/rate-limit";

const enabled = process.env.RUN_DB_TESTS === "1";
const suite = enabled ? describe : describe.skip;
const title = enabled
  ? "refunds + distributed rate limit integration (live Supabase)"
  : "refunds + distributed rate limit integration — skipped: set RUN_DB_TESTS=1 with the local stack running to enable";

const EMAIL = "qa-refunds@example.com";
const PASSWORD = process.env.SMOKE_PASSWORD || "password123";

suite(title, () => {
  let token: string;
  let url: string;
  let anonKey: string;

  async function remaining(): Promise<number> {
    const { data, error } = await userClient(token).rpc("credit_summary");
    if (error) throw new Error(error.message);
    const row = (Array.isArray(data) ? data[0] : data) as { remaining: number };
    return Number(row.remaining);
  }

  beforeAll(async () => {
    const env = resolveSupabaseEnv(process.env);
    if (!env.url || !env.anonKey) throw new Error("RUN_DB_TESTS=1 but no Supabase target (start the local stack).");
    if (!(await waitForHealth(env.url, { timeoutMs: 180_000 }))) throw new Error(`Supabase at ${env.url} is not healthy`);
    url = env.url;
    anonKey = env.anonKey;
    process.env.NEXT_PUBLIC_SUPABASE_URL = env.url;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = env.anonKey;
    process.env.OPENROUTER_API_KEY ||= "sk-or-integration-placeholder";
    delete process.env.BILLING_ENFORCE;
    resetServerEnvCache();

    const session = await ensureUser({ url: env.url, anonKey: env.anonKey, serviceKey: env.serviceKey, email: EMAIL, password: PASSWORD });
    token = session.accessToken;
  }, 240_000);

  it("refund_credits gives back exactly what consume_credits charged for the same request id (idempotent)", async () => {
    const before = await remaining();
    const requestId = `it-refund-${Date.now()}`;
    const charged = await consumeCredits({ token, route: "live/solve", requestId, model: "test" });
    expect(charged).toEqual({ ok: true, remaining: before - 10 });

    const refund = await refundCredits({ token, requestId });
    expect(refund).toEqual({ refunded: 10, remaining: before });
    expect(await remaining()).toBe(before);

    // A second refund of the same id finds nothing to undo.
    expect(await refundCredits({ token, requestId })).toEqual({ refunded: 0, remaining: before });
  });

  it("refund_credits for an unknown request id refunds nothing and leaves the balance alone", async () => {
    const before = await remaining();
    expect(await refundCredits({ token, requestId: `it-unknown-${Date.now()}` })).toEqual({ refunded: 0, remaining: before });
  });

  it("rate_limit_hit allows exactly p_limit hits per window and then denies with retry_after_ms (backend db)", async () => {
    const bucket = `it-${Date.now()}`;
    const cfg = { limit: 2, windowMs: 60_000 };
    const client = userClient(token);
    const hit = async () => {
      const { data, error } = await client.rpc(RATE_LIMIT_HIT_RPC, { p_bucket: bucket, p_limit: cfg.limit, p_window_ms: cfg.windowMs });
      if (error) throw new Error(error.message);
      return normalizeRateLimitHit(data, cfg);
    };
    expect(await hit()).toEqual({ ok: true, remaining: 1, retryAfterMs: 0, backend: "db" });
    expect(await hit()).toEqual({ ok: true, remaining: 0, retryAfterMs: 0, backend: "db" });
    const denied = await hit();
    expect(denied).toMatchObject({ ok: false, remaining: 0, backend: "db" });
    expect(denied!.retryAfterMs).toBeGreaterThan(0);
    expect(denied!.retryAfterMs).toBeLessThanOrEqual(cfg.windowMs);
  });

  it("neither RPC is callable without a user (anon is rejected)", async () => {
    const anon = createClient(url, anonKey, { auth: { persistSession: false } });
    expect((await anon.rpc("refund_credits", { p_request_id: "x" })).error).not.toBeNull();
    expect((await anon.rpc(RATE_LIMIT_HIT_RPC, { p_bucket: "x", p_limit: 1, p_window_ms: 1000 })).error).not.toBeNull();
  });
});
