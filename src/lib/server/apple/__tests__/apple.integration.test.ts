/**
 * The two Apple routes against a LIVE Supabase (normally the local stack), end to end: real JWT
 * checks, the real per-user rate limit, apply_apple_subscription() and billing_events; only the App
 * Store's signing is a test chain (testChain.ts) standing in for Apple's root. Opt-in:
 *
 *   RUN_DB_TESTS=1 npx vitest run src/lib/server/apple/__tests__/apple.integration.test.ts
 *
 * What it walks through, on one subscription: another account cannot claim the grown-up's purchase;
 * the grown-up's transaction from the app starts the free week (ink_summary says unlimited, Apple);
 * then every notification type, in order, and the row each leaves; an older notification arriving
 * late changes nothing; a redelivery is logged once. Its own users (qa-apple-*@example.com) stay, like
 * the other suites'; its subscription and events are removed at the end.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ensureUser, resolveSupabaseEnv, waitForHealth } from "../../../../../scripts/lib/supabaseHttp.mjs";

vi.hoisted(() => {
  process.env.LOG_LEVEL = "silent";
});

const deps = vi.hoisted(() => ({ current: null as import("@/lib/server/apple/deps").AppleDeps | null }));
vi.mock("@/lib/server/apple/deps", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/server/apple/deps")>();
  const pick = () => deps.current ?? real.appleDeps;
  return {
    ...real,
    appleDeps: {
      getEnv: () => pick().getEnv(),
      createVerifier: (c: import("@/lib/server/apple/config").AppleConfig) => pick().createVerifier(c),
      createStore: (url: string, key: string) => pick().createStore(url, key),
      now: () => pick().now(),
    },
  };
});

import { POST as notify } from "@/app/api/billing/apple/notifications/route";
import { POST as postTransaction } from "@/app/api/billing/apple/transaction/route";
import { APPLE_PLAN } from "@/lib/billing/apple";
import { resetServerEnvCache } from "@/lib/env";
import { supabaseAppleStore } from "@/lib/server/apple/store";
import { createAppleVerifier } from "@/lib/server/apple/verify";
import { renewalPayload, transactionPayload } from "./fixtures";
import { makeTestChain, type TestChain } from "./testChain";

const enabled = process.env.RUN_DB_TESTS === "1";
const suite = enabled ? describe : describe.skip;
const PASSWORD = process.env.SMOKE_PASSWORD || "password123";
const DAY = 86_400_000;

suite("Apple purchases end to end (live Supabase, a test chain for Apple's signature)", () => {
  let chain: TestChain;
  let admin: SupabaseClient;
  let url: string;
  let anonKey: string;
  let parent: { accessToken: string; userId: string };
  let other: { accessToken: string; userId: string };
  let parentRef: string;
  const otid = `9${Date.now()}`;
  const t0 = Date.now() + 60_000;
  const notes: string[] = [];

  beforeAll(async () => {
    const env = resolveSupabaseEnv(process.env);
    if (!env.url || !env.anonKey || !env.serviceKey) throw new Error("RUN_DB_TESTS=1 needs the local stack (url, anon and service keys).");
    if (!(await waitForHealth(env.url, { timeoutMs: 180_000 }))) throw new Error(`Supabase at ${env.url} is not healthy`);
    url = env.url;
    anonKey = env.anonKey;
    process.env.NEXT_PUBLIC_SUPABASE_URL = env.url;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = env.anonKey;
    process.env.OPENROUTER_API_KEY ||= "sk-or-integration-placeholder";
    resetServerEnvCache();
    admin = createClient(env.url, env.serviceKey, { auth: { persistSession: false } });
    parent = await ensureUser({ url: env.url, anonKey: env.anonKey, serviceKey: env.serviceKey, email: "qa-apple-parent@example.com", password: PASSWORD });
    other = await ensureUser({ url: env.url, anonKey: env.anonKey, serviceKey: env.serviceKey, email: "qa-apple-other@example.com", password: PASSWORD });
    const { data } = await admin.from("profiles").select("checkout_ref").eq("user_id", parent.userId).single();
    parentRef = (data as { checkout_ref: string }).checkout_ref;
    chain = makeTestChain();
    deps.current = {
      getEnv: () => ({ NEXT_PUBLIC_SUPABASE_URL: env.url!, SUPABASE_SERVICE_ROLE_KEY: env.serviceKey!, APPLE_ENVIRONMENT: "Sandbox", NODE_ENV: "test" }),
      createVerifier: (c) => createAppleVerifier(c, { roots: [chain.root], onlineChecks: false }),
      createStore: supabaseAppleStore,
      now: () => t0,
    };
  }, 240_000);

  afterAll(async () => {
    if (!admin) return;
    await admin.from("unlimited_subscriptions").delete().eq("stripe_subscription_id", `apple:${otid}`);
    if (notes.length) await admin.from("billing_events").delete().in("id", notes.map((n) => `apple:${n}`));
  });

  const tx = (over: Record<string, unknown> = {}) =>
    transactionPayload({ originalTransactionId: otid, transactionId: otid, appAccountToken: parentRef, environment: "Sandbox", purchaseDate: t0, signedDate: t0, expiresDate: t0 + 7 * DAY, ...over });

  const postTx = (token: string, body: unknown) =>
    postTransaction(new Request("http://localhost/api/billing/apple/transaction", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) }));

  async function note(type: string, at: number, opts: { subtype?: string; status?: number; transaction?: Record<string, unknown>; renewal?: Record<string, unknown>; uuid?: string } = {}) {
    const uuid = opts.uuid ?? crypto.randomUUID();
    if (!notes.includes(uuid)) notes.push(uuid);
    const data: Record<string, unknown> = { bundleId: APPLE_PLAN.bundleId, bundleVersion: "1", environment: "Sandbox", signedTransactionInfo: chain.sign(tx({ signedDate: at, ...(opts.transaction ?? {}) })) };
    if (opts.renewal) data.signedRenewalInfo = chain.sign(renewalPayload({ originalTransactionId: otid, environment: "Sandbox", signedDate: at, ...opts.renewal }));
    if (opts.status !== undefined) data.status = opts.status;
    const signedPayload = chain.sign({ notificationType: type, ...(opts.subtype ? { subtype: opts.subtype } : {}), notificationUUID: uuid, version: "2.0", signedDate: at, data });
    const res = await notify(new Request("http://localhost/api/billing/apple/notifications", { method: "POST", body: JSON.stringify({ signedPayload }) }));
    return { res, body: (await res.json()) as Record<string, unknown>, uuid };
  }

  async function row() {
    const { data, error } = await admin.from("unlimited_subscriptions").select("*").eq("stripe_subscription_id", `apple:${otid}`).maybeSingle();
    if (error) throw new Error(error.message);
    return data as Record<string, unknown> | null;
  }

  async function summary(token: string) {
    const client = createClient(url, anonKey, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data, error } = await client.rpc("ink_summary");
    if (error) throw new Error(error.message);
    return (data as { unlimited: Record<string, unknown> }).unlimited;
  }

  it("another account cannot claim the grown-up's purchase: 409, nothing written", async () => {
    const res = await postTx(other.accessToken, { transaction: chain.sign(tx()) });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "apple_account_mismatch" });
    expect(await row()).toBeNull();
  });

  it("the grown-up's purchase from the app starts the free week; ink_summary says unlimited, billed by Apple", async () => {
    const res = await postTx(parent.accessToken, { transaction: chain.sign(tx()), renewalInfo: chain.sign(renewalPayload({ originalTransactionId: otid, environment: "Sandbox", signedDate: t0 })) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ recorded: true, applied: true, status: "trialing", unlimited: true });
    expect(await row()).toMatchObject({ provider: "apple", user_id: parent.userId, status: "trialing", apple_environment: "Sandbox", livemode: false, apple_price_milliunits: 24990, apple_currency: "USD", cancel_at_period_end: false });
    expect(await summary(parent.accessToken)).toMatchObject({ status: "trialing", unlimited: true, provider: "apple" });
  });

  it("every notification type leaves the row it should", async () => {
    let at = t0;
    const step = async (type: string, opts: Parameters<typeof note>[2], want: Record<string, unknown>, unlimited: boolean) => {
      at += 60_000;
      const { res } = await note(type, at, opts);
      expect(res.status, type).toBe(200);
      expect(await row(), type).toMatchObject(want);
      expect((await summary(parent.accessToken)).unlimited, `${type}: unlimited`).toBe(unlimited);
    };
    const trialEnd = new Date(t0 + 7 * DAY).toISOString();
    const iso = (v: unknown) => (typeof v === "string" ? new Date(v).toISOString() : v);

    await step("SUBSCRIBED", { subtype: "INITIAL_BUY", status: 1, renewal: {} }, { status: "trialing" }, true);
    await step("DID_CHANGE_RENEWAL_STATUS", { subtype: "AUTO_RENEW_DISABLED", status: 1, renewal: { autoRenewStatus: 0 } }, { status: "trialing", cancel_at_period_end: true }, true);
    await step("DID_CHANGE_RENEWAL_STATUS", { subtype: "AUTO_RENEW_ENABLED", status: 1, renewal: { autoRenewStatus: 1 } }, { cancel_at_period_end: false }, true);
    await step("DID_RENEW", { status: 1, transaction: { offerType: undefined, transactionId: `${otid}1`, price: 24990, expiresDate: t0 + 37 * DAY } }, { status: "active", apple_latest_transaction_id: `${otid}1` }, true);
    expect(iso((await row())!.trial_end)).toBe(trialEnd); // the first period's trial end is kept
    await step("DID_FAIL_TO_RENEW", { status: 3, transaction: { offerType: undefined, expiresDate: t0 + 37 * DAY } }, { status: "past_due" }, false);
    await step("GRACE_PERIOD_EXPIRED", { status: 3, transaction: { offerType: undefined } }, { status: "past_due" }, false);
    await step("DID_RENEW", { subtype: "BILLING_RECOVERY", status: 1, transaction: { offerType: undefined, expiresDate: t0 + 67 * DAY } }, { status: "active" }, true);
    await step("EXPIRED", { subtype: "VOLUNTARY", status: 2, transaction: { offerType: undefined, expiresDate: t0 - DAY } }, { status: "canceled" }, false);
    await step("SUBSCRIBED", { subtype: "RESUBSCRIBE", status: 1, transaction: { offerType: undefined, expiresDate: t0 + 30 * DAY } }, { status: "active", ended_at: null }, true);
    await step("REFUND", { status: 5, transaction: { offerType: undefined, revocationDate: t0 + 5 * 60_000 } }, { status: "canceled" }, false);
    await step("REFUND_REVERSED", { status: 1, transaction: { offerType: undefined, expiresDate: t0 + 30 * DAY } }, { status: "active" }, true);
    await step("REVOKE", { status: 5, transaction: { offerType: undefined } }, { status: "canceled" }, false);
    await step("OFFER_REDEEMED", { status: 1, transaction: { offerType: 3, expiresDate: t0 + 60 * DAY } }, { status: "active" }, true);
  });

  it("an older notification arriving late changes nothing; a redelivery is logged once", async () => {
    const before = await row();
    const late = await note("EXPIRED", t0 - 60_000, { status: 2, transaction: { expiresDate: t0 - DAY } });
    expect(late.body).toMatchObject({ received: true, stale: true });
    expect((await row())!.status).toBe(before!.status);

    const first = await note("DID_RENEW", t0 + DAY, { status: 1, transaction: { offerType: undefined, expiresDate: t0 + 90 * DAY } });
    const again = await note("DID_RENEW", t0 + DAY, { status: 1, transaction: { offerType: undefined, expiresDate: t0 + 90 * DAY }, uuid: first.uuid });
    expect(again.body).toEqual({ received: true, duplicate: true });
    const { count } = await admin.from("billing_events").select("id", { count: "exact", head: true }).eq("id", `apple:${first.uuid}`);
    expect(count).toBe(1);
  });

  it("App Store Connect's test notification is recorded", async () => {
    const uuid = crypto.randomUUID();
    notes.push(uuid);
    const signedPayload = chain.sign({ notificationType: "TEST", notificationUUID: uuid, version: "2.0", signedDate: t0, data: { bundleId: APPLE_PLAN.bundleId, environment: "Sandbox" } });
    const res = await notify(new Request("http://localhost/api/billing/apple/notifications", { method: "POST", body: JSON.stringify({ signedPayload }) }));
    expect(await res.json()).toEqual({ received: true, test: true });
    const { data } = await admin.from("billing_events").select("type").eq("id", `apple:${uuid}`).single();
    expect(data).toEqual({ type: "apple.TEST" });
  });
});
