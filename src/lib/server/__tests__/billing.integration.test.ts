/**
 * Behavioural check of ink metering against a LIVE Supabase stack (normally the local one from
 * `npx supabase start` with the ink migration applied). Opt-in:
 *
 *   RUN_DB_TESTS=1 npx vitest run src/lib/server/__tests__/billing.integration.test.ts
 *
 * Uses its OWN throwaway user (qa-metering@example.com, created on first run like the RLS
 * verifier does), never the shared QA student: the 402 case empties the balance (with the
 * service role, the operator's grant_ink) and fills it back afterwards.
 */
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureUser, resolveSupabaseEnv, waitForHealth } from "../../../../scripts/lib/supabaseHttp.mjs";
import { resetServerEnvCache } from "@/lib/env";
import { consumeInk, enforceInk, userClient } from "@/lib/server/billing";

const enabled = process.env.RUN_DB_TESTS === "1";
const suite = enabled ? describe : describe.skip;
const title = enabled
  ? "ink metering integration (live Supabase)"
  : "ink metering integration — skipped: set RUN_DB_TESTS=1 with the local stack running to enable";

const EMAIL = "qa-metering@example.com";
const PASSWORD = process.env.SMOKE_PASSWORD || "password123";

suite(title, () => {
  let token: string;
  let userId: string;
  let serviceKey: string | undefined;
  let url: string;
  let restoreTo: number | null = null;

  async function balance(): Promise<number> {
    const { data, error } = await userClient(token).rpc("ink_summary");
    if (error) throw new Error(error.message);
    return Number((data as { balance: number }).balance);
  }

  async function grant(units: number) {
    const admin = createClient(url, serviceKey!, { auth: { persistSession: false } });
    const { error } = await admin.rpc("grant_ink", { p_user_id: userId, p_units: units, p_reason: "billing.integration test" });
    if (error) throw new Error(error.message);
  }

  beforeAll(async () => {
    const env = resolveSupabaseEnv(process.env);
    if (!env.url || !env.anonKey) throw new Error("RUN_DB_TESTS=1 but no Supabase target (start the local stack).");
    if (!(await waitForHealth(env.url, { timeoutMs: 180_000 }))) throw new Error(`Supabase at ${env.url} is not healthy`);
    url = env.url;
    serviceKey = env.serviceKey ?? undefined;
    process.env.NEXT_PUBLIC_SUPABASE_URL = env.url;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = env.anonKey;
    process.env.OPENROUTER_API_KEY ||= "sk-or-integration-placeholder";
    delete process.env.BILLING_ENFORCE;
    resetServerEnvCache();

    const session = await ensureUser({ url: env.url, anonKey: env.anonKey, serviceKey: env.serviceKey, email: EMAIL, password: PASSWORD });
    token = session.accessToken;
    userId = session.userId;
    // Leave enough ink for the spends below even after many runs.
    if (serviceKey && (await balance()) < 50) await grant(300);
  }, 240_000);

  afterAll(async () => {
    if (!serviceKey || restoreTo === null) return;
    const now = await balance();
    if (now < restoreTo) await grant(restoreTo - now);
  });

  it("consume_credits takes the route's cost off the ink balance, as the user", async () => {
    const before = await balance();
    const result = await consumeInk({ token, route: "live/recognize", requestId: `it-${Date.now()}`, model: "test" });
    expect(result).toEqual({ ok: true, remaining: before - 1 });
    expect(await balance()).toBe(before - 1);
  });

  it("a user cannot call the RPC without a token (anon is rejected)", async () => {
    const env = resolveSupabaseEnv(process.env);
    const anon = createClient(env.url!, env.anonKey!, { auth: { persistSession: false } });
    const { error } = await anon.rpc("consume_credits", { p_route: "live/check", p_units: 1 });
    expect(error).not.toBeNull();
  });

  it("out of ink: insufficient_ink, a 402 ink_empty from enforceInk, and no usage event written", async () => {
    if (!serviceKey) return; // needs the service role to empty the balance; the RLS verifier covers the rest
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    restoreTo = await balance();
    await grant(-restoreTo);
    expect(await balance()).toBe(0);

    const { count: eventsBefore } = await admin.from("usage_events").select("id", { count: "exact", head: true }).eq("user_id", userId);
    const result = await consumeInk({ token, route: "live/solve", requestId: `it-zero-${Date.now()}` });
    expect(result).toEqual({ ok: false, reason: "insufficient_ink", remaining: 0 });
    const enforced = await enforceInk({ token, route: "live/check", requestId: `it-zero-402-${Date.now()}` }, { warn: () => undefined });
    expect("response" in enforced).toBe(true);
    const res = (enforced as { response: Response }).response;
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ error: "ink_empty", remaining: 0, buyUrl: "/account" });
    const { count: eventsAfter } = await admin.from("usage_events").select("id", { count: "exact", head: true }).eq("user_id", userId);
    expect(eventsAfter).toBe(eventsBefore);

    await grant(restoreTo);
    expect(await balance()).toBe(restoreTo);
    restoreTo = null;
  });
});
