/**
 * Behavioural check of credit metering against a LIVE Supabase stack (normally the
 * local one from `npx supabase start` with the billing migration applied). Opt-in:
 *
 *   RUN_DB_TESTS=1 npx vitest run src/lib/server/__tests__/billing.integration.test.ts
 *
 * Uses the QA user from `npm run db:seed` (SMOKE_EMAIL / SMOKE_PASSWORD) and, when a
 * service role key is available, a throwaway 'zero' plan to exercise the 402 path.
 * Everything it changes is restored afterwards.
 */
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveSupabaseEnv, signInWithPassword, waitForHealth } from "../../../../scripts/lib/supabaseHttp.mjs";
import { resetServerEnvCache } from "@/lib/env";
import { consumeCredits, userClient } from "@/lib/server/billing";

const enabled = process.env.RUN_DB_TESTS === "1";
const suite = enabled ? describe : describe.skip;
const title = enabled
  ? "credit metering integration (live Supabase)"
  : "credit metering integration — skipped: set RUN_DB_TESTS=1 with the local stack running to enable";

const EMAIL = process.env.SMOKE_EMAIL || "qa-student@example.com";
const PASSWORD = process.env.SMOKE_PASSWORD || "password123";

type Summary = { plan_id: string; remaining: number };

suite(title, () => {
  let token: string;
  let userId: string;
  let serviceKey: string | undefined;
  let url: string;
  let originalPlan: string | null = null;

  async function summary(): Promise<Summary> {
    const { data, error } = await userClient(token).rpc("credit_summary");
    if (error) throw new Error(error.message);
    const row = (Array.isArray(data) ? data[0] : data) as Summary;
    return { plan_id: row.plan_id, remaining: Number(row.remaining) };
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
    resetServerEnvCache();

    const signIn = await signInWithPassword(env.url, env.anonKey, EMAIL, PASSWORD);
    if (signIn.status !== 200) throw new Error(`sign-in as ${EMAIL} failed (${signIn.status}); run \`npm run db:seed\` first`);
    const session = signIn.body as { access_token: string; user: { id: string } };
    token = session.access_token;
    userId = session.user.id;
  }, 240_000);

  afterAll(async () => {
    if (!serviceKey || originalPlan === null) return;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    await admin.from("profiles").update({ plan_id: originalPlan }).eq("user_id", userId);
    await admin.from("plans").delete().eq("id", "zero");
  });

  it("consume_credits decrements the balance by the route cost as the user", async () => {
    const before = await summary();
    const result = await consumeCredits({ token, route: "live/recognize", requestId: `it-${Date.now()}`, model: "test" });
    expect(result).toEqual({ ok: true, remaining: before.remaining - 1 });
    const after = await summary();
    expect(after.remaining).toBe(before.remaining - 1);
  });

  it("a user cannot call the RPC with someone else's token shape (anon is rejected)", async () => {
    const env = resolveSupabaseEnv(process.env);
    const anon = createClient(env.url!, env.anonKey!, { auth: { persistSession: false } });
    const { error } = await anon.rpc("consume_credits", { p_route: "ocr", p_units: 1 });
    expect(error).not.toBeNull();
  });

  it("returns insufficient_credits (402 path) on a zero-credit plan, without writing a usage event", async () => {
    if (!serviceKey) return; // needs the service role to change plans; the RLS verifier covers the rest
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data: profile } = await admin.from("profiles").select("plan_id").eq("user_id", userId).single();
    originalPlan = (profile as { plan_id: string }).plan_id;
    await admin.from("plans").upsert({ id: "zero", name: "Zero (test)", monthly_credits: 0, price_cents: 0, sort: 99, active: false });
    const { error: updErr } = await admin.from("profiles").update({ plan_id: "zero" }).eq("user_id", userId);
    expect(updErr).toBeNull();

    const { count: eventsBefore } = await admin.from("usage_events").select("id", { count: "exact", head: true }).eq("user_id", userId);
    const result = await consumeCredits({ token, route: "generate-solution", requestId: `it-zero-${Date.now()}` });
    expect(result).toEqual({ ok: false, reason: "insufficient_credits", remaining: 0 });
    const { count: eventsAfter } = await admin.from("usage_events").select("id", { count: "exact", head: true }).eq("user_id", userId);
    expect(eventsAfter).toBe(eventsBefore);

    await admin.from("profiles").update({ plan_id: originalPlan }).eq("user_id", userId);
    expect((await summary()).plan_id).toBe(originalPlan);
  });
});
