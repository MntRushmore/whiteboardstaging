/**
 * POST /api/billing/apple/transaction and POST /api/billing/apple/notifications, driven through
 * their real handlers. supabase-js is faked for what the transaction route does itself (verifying the
 * user's JWT, the per-user rate limit); everything Apple-specific comes from `appleDeps`, replaced
 * per test: the env, a verifier trusting a test chain made fresh per run (testChain.ts), an in-memory
 * store, a fixed clock. The contract: 401 / 429 / 400 before any work, 503 where Apple billing is not
 * set up (or is set up unsafely: Xcode on production), only App Store-signed payloads of this app's
 * plan, another account's purchase refused with nothing written, and each notification logged once
 * and applied idempotently.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.LOG_LEVEL = "silent";
});

const fake = vi.hoisted(() => ({
  GOOD_TOKEN: "aaaa.bbbb.cccc",
  USER_ID: "11111111-2222-4333-8444-555555555555",
  rateLimit: { allowed: true, remaining: 4, retry_after_ms: 0, backend: "db" } as Record<string, unknown>,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getUser: async (token: string) =>
        token === fake.GOOD_TOKEN ? { data: { user: { id: fake.USER_ID, email: "parent@example.com" } }, error: null } : { data: { user: null }, error: { message: "invalid token" } },
    },
    rpc: async (fn: string) => (fn === "rate_limit_hit" ? { data: fake.rateLimit, error: null } : { data: null, error: { message: `no fake for ${fn}` } }),
  }),
}));

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
import type { AppleConfig } from "@/lib/server/apple/config";
import type { AppleRouteEnv } from "@/lib/server/apple/deps";
import type { AppleSubscriptionState } from "@/lib/server/apple/state";
import type { AppleApplyOutcome, AppleEventRecord, AppleStore } from "@/lib/server/apple/store";
import { createAppleVerifier } from "@/lib/server/apple/verify";
import { resetRateLimitFallbackWarning, resetRateLimits } from "@/lib/server/rate-limit";
import { renewalPayload, transactionPayload } from "./apple.test";
import { makeTestChain, selfSignedCert, signJws, type TestChain } from "./testChain";

const APP_APPLE_ID = 6740000001;
/** A little ahead of the wall clock: the test chain is valid from the moment it is made, for 3 days. */
const NOW = Math.floor(Date.now() / 1000) * 1000 + 10 * 60_000;
const DAY = 86_400_000;

type FakeStore = AppleStore & { applied: Array<{ state: AppleSubscriptionState; claim: string | null }>; events: AppleEventRecord[]; forgotten: string[]; next: AppleApplyOutcome[] };

function fakeStore(): FakeStore {
  const ids = new Set<string>();
  const s: FakeStore = {
    applied: [],
    events: [],
    forgotten: [],
    next: [],
    async apply(state, claim) {
      s.applied.push({ state, claim });
      return s.next.shift() ?? { status: "applied", userId: "99999999-2222-4333-8444-555555555555", subscriptionStatus: state.status, unlimited: state.status === "trialing" || state.status === "active", linked: true };
    },
    async recordEvent(event) {
      if (ids.has(event.id)) return { status: "duplicate" };
      ids.add(event.id);
      s.events.push(event);
      return { status: "inserted" };
    },
    async forgetEvent(id) {
      ids.delete(id);
      s.forgotten.push(id);
      return { ok: true };
    },
  };
  return s;
}

let chain: TestChain;
let store: FakeStore;
let env: AppleRouteEnv;

beforeAll(() => {
  chain = makeTestChain();
});

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.OPENROUTER_API_KEY = "sk-or-test";
  delete process.env.RATE_LIMIT_BACKEND;
  resetServerEnvCache();
  resetRateLimits();
  resetRateLimitFallbackWarning();
  fake.rateLimit = { allowed: true, remaining: 4, retry_after_ms: 0, backend: "db" };
  store = fakeStore();
  env = {
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    SUPABASE_SERVICE_ROLE_KEY: "service-role",
    APPLE_ENVIRONMENT: "Production",
    APPLE_APP_APPLE_ID: String(APP_APPLE_ID),
    NODE_ENV: "production",
    VERCEL_ENV: "production",
  };
  deps.current = {
    getEnv: () => env,
    createVerifier: (c: AppleConfig) => createAppleVerifier(c, { roots: [chain.root], onlineChecks: false }),
    createStore: () => store,
    now: () => NOW,
  };
});

const tx = (over: Record<string, unknown> = {}) =>
  chain.sign(transactionPayload({ signedDate: NOW - 1000, purchaseDate: NOW - 2000, expiresDate: NOW + 7 * DAY, ...over }));

function postTx(body: unknown, token: string | null = fake.GOOD_TOKEN): Promise<Response> {
  return postTransaction(
    new Request("http://localhost/api/billing/apple/transaction", {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

describe("POST /api/billing/apple/transaction", () => {
  it("needs a signed-in user (401) and checks the bucket (429) before anything else", async () => {
    expect((await postTx({ transaction: tx() }, null)).status).toBe(401);
    fake.rateLimit = { allowed: false, remaining: 0, retry_after_ms: 30_000, backend: "db" };
    expect((await postTx({ transaction: tx() })).status).toBe(429);
    expect(store.applied).toEqual([]);
  });

  it("refuses a body that is not a JWS (400, zod)", async () => {
    expect((await postTx({ transaction: "hello" })).status).toBe(400);
    expect((await postTx({ transaction: tx(), extra: 1 })).status).toBe(400);
    expect((await postTx("{")).status).toBe(400);
  });

  it("answers 503 where Apple billing is not set up", async () => {
    env.APPLE_ENVIRONMENT = undefined;
    expect((await postTx({ transaction: tx() })).status).toBe(503);
    env.APPLE_ENVIRONMENT = "Production";
    env.SUPABASE_SERVICE_ROLE_KEY = undefined;
    expect((await postTx({ transaction: tx() })).status).toBe(503);
  });

  it("PRODUCTION REFUSES Xcode's StoreKit purchases: an Xcode setting is refused (503), and an Xcode payload is not verified (400)", async () => {
    const xcode = selfSignedCert("StoreKit Testing in Xcode");
    const xcodeJws = signJws(transactionPayload({ environment: "Xcode", signedDate: NOW - 1000, expiresDate: NOW + DAY }), xcode.key, { kid: "Apple_Xcode_Key" });
    env.APPLE_ENVIRONMENT = "Xcode"; // a production deployment configured for Xcode: the setting itself is refused
    expect((await postTx({ transaction: xcodeJws })).status).toBe(503);
    env.APPLE_ENVIRONMENT = "Production";
    const res = await postTx({ transaction: xcodeJws });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ reason: "apple_environment" });
    // even one that claims to be Production, but is signed by Xcode's key and not Apple's chain
    const forged = signJws(transactionPayload({ environment: "Production", signedDate: NOW - 1000 }), xcode.key, { x5c: [chain.x5c[0]] });
    expect((await postTx({ transaction: forged })).status).toBe(400);
    expect(store.applied).toEqual([]);
  });

  it("takes Xcode's purchases on a dev server configured for Xcode", async () => {
    env = { ...env, APPLE_ENVIRONMENT: "Xcode", NODE_ENV: "development", VERCEL_ENV: undefined, APPLE_APP_APPLE_ID: undefined };
    const xcode = selfSignedCert("StoreKit Testing in Xcode");
    const res = await postTx({ transaction: signJws(transactionPayload({ environment: "Xcode", originalTransactionId: "0", transactionId: "0" }), xcode.key, {}) });
    expect(res.status).toBe(200);
    expect(store.applied[0].state).toMatchObject({ environment: "Xcode", originalTransactionId: "0" });
  });

  it("records a verified purchase as the caller's claim: 200 with the plan, and an X-Request-Id", async () => {
    const res = await postTx({ transaction: tx() });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(await res.json()).toEqual({ recorded: true, applied: true, status: "trialing", unlimited: true });
    expect(store.applied).toHaveLength(1);
    expect(store.applied[0].claim).toBe(fake.USER_ID);
    expect(store.applied[0].state).toMatchObject({
      originalTransactionId: "2000000123456789",
      environment: "Sandbox",
      productId: APPLE_PLAN.productId,
      status: "trialing",
      appAccountToken: "6f0d2b7e-9c3a-4e2f-8a51-1b2c3d4e5f60",
      cancelAtPeriodEnd: null,
      eventAt: new Date(NOW - 1000).toISOString(),
    });
  });

  it("uses the renewal info when sent: auto-renew off is 'set to cancel'", async () => {
    await postTx({ transaction: tx(), renewalInfo: chain.sign(renewalPayload({ autoRenewStatus: 0, signedDate: NOW - 1000 })) });
    expect(store.applied[0].state).toMatchObject({ cancelAtPeriodEnd: true, priceMilliunits: 24990, currency: "USD" });
  });

  it("an unverifiable renewal info does not lose the purchase", async () => {
    const other = makeTestChain();
    const res = await postTx({ transaction: tx(), renewalInfo: other.sign(renewalPayload()) });
    expect(res.status).toBe(200);
    expect(store.applied[0].state.cancelAtPeriodEnd).toBeNull();
  });

  it("refuses ANOTHER ACCOUNT's purchase (appAccountToken is not the caller's family's): 409, nothing written", async () => {
    store.next.push({ status: "refused", reason: "account_mismatch" });
    const res = await postTx({ transaction: tx() });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "invalid_request", reason: "apple_account_mismatch" });
    store.next.push({ status: "refused", reason: "account_unknown" });
    expect(await (await postTx({ transaction: tx() })).json()).toMatchObject({ reason: "apple_account_unknown" });
    store.next.push({ status: "conflict" });
    expect(await (await postTx({ transaction: tx() })).json()).toMatchObject({ reason: "apple_other_family" });
  });

  it("refuses what Apple did not sign, or another app's (400)", async () => {
    const other = makeTestChain();
    expect((await postTx({ transaction: other.sign(transactionPayload()) })).status).toBe(400);
    expect((await postTx({ transaction: tx({ bundleId: "com.example.other" }) })).status).toBe(400);
    expect(store.applied).toEqual([]);
  });

  it("records nothing for another product (200, ignored: the app finishes it)", async () => {
    const res = await postTx({ transaction: tx({ productId: "app.agathon.other" }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ recorded: false });
    expect(store.applied).toEqual([]);
  });

  it("answers an older transaction applied=false (the newer state stands) and a store failure 500 (the app retries)", async () => {
    store.next.push({ status: "stale", userId: "u", subscriptionStatus: "active", unlimited: true, linked: false });
    expect(await (await postTx({ transaction: tx() })).json()).toEqual({ recorded: true, applied: false, status: "active", unlimited: true });
    store.next.push({ status: "error", message: "boom" });
    expect((await postTx({ transaction: tx() })).status).toBe(500);
  });
});

function notification(type: string, opts: { subtype?: string; status?: number; transaction?: Record<string, unknown> | null; renewal?: Record<string, unknown> | null; environment?: string; uuid?: string; signedDate?: number } = {}) {
  const environment = opts.environment ?? "Production";
  const data: Record<string, unknown> = { bundleId: APPLE_PLAN.bundleId, bundleVersion: "1", environment };
  if (environment === "Production") data.appAppleId = APP_APPLE_ID;
  if (opts.transaction !== null) data.signedTransactionInfo = chain.sign(transactionPayload({ environment, signedDate: NOW - 5000, purchaseDate: NOW - 6000, expiresDate: NOW + 7 * DAY, ...(opts.transaction ?? {}) }));
  if (opts.renewal) data.signedRenewalInfo = chain.sign(renewalPayload({ environment, signedDate: NOW - 5000, ...opts.renewal }));
  if (opts.status !== undefined) data.status = opts.status;
  return chain.sign({
    notificationType: type,
    ...(opts.subtype ? { subtype: opts.subtype } : {}),
    notificationUUID: opts.uuid ?? crypto.randomUUID(),
    version: "2.0",
    signedDate: opts.signedDate ?? NOW,
    data,
  });
}

function postNote(signedPayload: string): Promise<Response> {
  return notify(new Request("http://localhost/api/billing/apple/notifications", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signedPayload }) }));
}

describe("POST /api/billing/apple/notifications", () => {
  it("answers 503 where Apple billing is not set up (Apple retries), and refuses an Xcode setting on production", async () => {
    env.APPLE_ENVIRONMENT = undefined;
    expect((await postNote(notification("TEST", { transaction: null }))).status).toBe(503);
    env.APPLE_ENVIRONMENT = "Xcode";
    expect((await postNote(notification("TEST", { transaction: null }))).status).toBe(503);
  });

  it("refuses a body that is not { signedPayload } and a payload Apple did not sign (400)", async () => {
    const bad = await notify(new Request("http://localhost/x", { method: "POST", body: "{}" }));
    expect(bad.status).toBe(400);
    const other = makeTestChain();
    const forged = other.sign({ notificationType: "SUBSCRIBED", notificationUUID: crypto.randomUUID(), signedDate: NOW, data: { bundleId: APPLE_PLAN.bundleId, environment: "Sandbox" } });
    expect((await postNote(forged)).status).toBe(400);
    expect(store.events).toEqual([]);
  });

  it("TEST: recorded once, answered 200, nothing applied", async () => {
    const uuid = crypto.randomUUID();
    const res = await postNote(notification("TEST", { transaction: null, uuid }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, test: true });
    expect(store.events).toEqual([{ id: `apple:${uuid}`, type: "apple.TEST", payload: expect.objectContaining({ notificationType: "TEST", environment: "Production" }) }]);
    expect(store.applied).toEqual([]);
  });

  // Every handled type -> the state applied (no caller: the token decides whose it is).
  const cases: Array<[string, Parameters<typeof notification>[1], Partial<AppleSubscriptionState>]> = [
    ["SUBSCRIBED", { subtype: "INITIAL_BUY", status: 1, renewal: {} }, { status: "trialing", cancelAtPeriodEnd: false, trialEnd: new Date(NOW + 7 * DAY).toISOString() }],
    ["SUBSCRIBED", { subtype: "RESUBSCRIBE", status: 1, transaction: { offerType: undefined, price: 24990 } }, { status: "active", trialEnd: null }],
    ["DID_RENEW", { status: 1, transaction: { offerType: undefined, transactionId: "2000000300000000", expiresDate: NOW + 30 * DAY } }, { status: "active", transactionId: "2000000300000000", currentPeriodEnd: new Date(NOW + 30 * DAY).toISOString() }],
    ["DID_FAIL_TO_RENEW", { status: 3, transaction: { expiresDate: NOW - DAY } }, { status: "past_due" }],
    ["DID_FAIL_TO_RENEW", { subtype: "GRACE_PERIOD", status: 4, transaction: { expiresDate: NOW - DAY } }, { status: "past_due" }],
    ["GRACE_PERIOD_EXPIRED", { status: 3, transaction: { expiresDate: NOW - 3 * DAY } }, { status: "past_due" }],
    ["EXPIRED", { subtype: "VOLUNTARY", status: 2, transaction: { expiresDate: NOW - DAY } }, { status: "canceled", endedAt: new Date(NOW - DAY).toISOString() }],
    ["REFUND", { status: 5, transaction: { revocationDate: NOW - 60_000, revocationReason: 0 } }, { status: "canceled", endedAt: new Date(NOW - 60_000).toISOString() }],
    ["REVOKE", { status: 5 }, { status: "canceled", endedAt: new Date(NOW).toISOString() }],
    ["DID_CHANGE_RENEWAL_STATUS", { subtype: "AUTO_RENEW_DISABLED", status: 1, renewal: { autoRenewStatus: 0 } }, { status: "trialing", cancelAtPeriodEnd: true }],
    ["DID_CHANGE_RENEWAL_STATUS", { subtype: "AUTO_RENEW_ENABLED", status: 1, renewal: { autoRenewStatus: 1 } }, { cancelAtPeriodEnd: false }],
    ["OFFER_REDEEMED", { status: 1, transaction: { offerType: 3 } }, { status: "active" }],
  ];
  for (const [type, opts, want] of cases) {
    it(`${type}${opts?.subtype ? `/${opts.subtype}` : ""} -> ${want.status ?? JSON.stringify(want)}`, async () => {
      const res = await postNote(notification(type, opts));
      expect(res.status).toBe(200);
      expect(store.applied).toHaveLength(1);
      expect(store.applied[0].claim).toBeNull();
      expect(store.applied[0].state).toMatchObject({ ...want, eventAt: new Date(NOW).toISOString(), environment: "Production" });
      expect(store.events[0].type).toBe(`apple.${type}${opts?.subtype ? `.${opts.subtype}` : ""}`);
    });
  }

  it("takes Sandbox notifications on production (App Review, TestFlight) — no app Apple ID in them", async () => {
    const res = await postNote(notification("SUBSCRIBED", { subtype: "INITIAL_BUY", status: 1, environment: "Sandbox" }));
    expect(res.status).toBe(200);
    expect(store.applied[0].state.environment).toBe("Sandbox");
  });

  it("is idempotent: a redelivery is applied again and answered duplicate", async () => {
    const payload = notification("DID_RENEW", { status: 1, uuid: "1b9b1e8e-0000-4000-8000-000000000001" });
    expect(await (await postNote(payload)).json()).toEqual({ received: true });
    expect(await (await postNote(payload)).json()).toEqual({ received: true, duplicate: true });
    expect(store.events).toHaveLength(1);
    expect(store.applied).toHaveLength(2);
    expect(store.applied[0].state).toEqual(store.applied[1].state);
  });

  it("an older notification arriving late is answered stale (the database kept the newer state)", async () => {
    store.next.push({ status: "stale", userId: "u", subscriptionStatus: "active", unlimited: true, linked: false });
    expect(await (await postNote(notification("DID_FAIL_TO_RENEW", { status: 3 }))).json()).toEqual({ received: true, stale: true });
  });

  it("a failure answers 500 so Apple redelivers, and forgets the event (first delivery only)", async () => {
    const payload = notification("DID_RENEW", { status: 1, uuid: "1b9b1e8e-0000-4000-8000-000000000002" });
    store.next.push({ status: "error", message: "db down" });
    expect((await postNote(payload)).status).toBe(500);
    expect(store.forgotten).toEqual(["apple:1b9b1e8e-0000-4000-8000-000000000002"]);
    expect((await postNote(payload)).status).toBe(200); // the retry is applied
  });

  it("changes nothing for CONSUMPTION_REQUEST or another product", async () => {
    expect(await (await postNote(notification("CONSUMPTION_REQUEST", { status: 1 }))).json()).toMatchObject({ ignored: true });
    expect(await (await postNote(notification("SUBSCRIBED", { status: 1, transaction: { productId: "app.agathon.other" } }))).json()).toMatchObject({ ignored: true });
    expect(store.applied).toEqual([]);
  });

  it("keeps no signed blobs in billing_events", async () => {
    await postNote(notification("SUBSCRIBED", { subtype: "INITIAL_BUY", status: 1, renewal: {} }));
    const kept = JSON.stringify(store.events[0].payload);
    expect(kept).not.toContain("signedTransactionInfo");
    expect(kept).not.toContain(chain.x5c[0].slice(0, 40));
    expect(store.events[0].payload).toMatchObject({ transaction: expect.objectContaining({ originalTransactionId: "2000000123456789" }), renewalInfo: expect.objectContaining({ autoRenewStatus: 1 }) });
  });
});
