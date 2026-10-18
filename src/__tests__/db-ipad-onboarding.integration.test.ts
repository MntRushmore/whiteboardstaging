/**
 * The iPad onboarding's server half against a LIVE Supabase (normally the local stack), end to end:
 * supabase/migrations/20261017210000_ipad_onboarding.sql and the routes and services over it. Opt-in:
 *
 *   RUN_DB_TESTS=1 npx vitest run src/__tests__/db-ipad-onboarding.integration.test.ts
 *
 * Walks the iPad's grown-up path as docs/ONBOARDING.md lays it out, with the real handlers and the
 * real database (only Apple's root is a throwaway test CA, handed to the verifier in its place):
 *  1. App Attest: a challenge, a registration, then a step recorded through the app path with an
 *     assertion over its body; the same assertion replayed is refused; the tables are the service
 *     role's alone; the store's one-time challenge and conditional counter hold in SQL.
 *  2. The account: sign-up returns a session; save_onboarding(p_complete, no grade) as the fresh
 *     grown-up; the welcome email answers 503 feature_unavailable with RESEND_API_KEY blank;
 *     link_start_journey links the journey the app recorded, and the steps after the account
 *     (trial, PIN, kid, first board) join the account.
 *  3. "Not now": POST /api/family/pin, then POST /api/family/kids with no plan -> 201 for the first
 *     kid and 409 plan_required for a second; that kid's AI calls spend the GROWN-UP's ink (the
 *     grown-up's balance drops, the usage row is the grown-up's, the kid's ink_summary shows that
 *     balance with family_ink), a refund gives it back to the grown-up, and the grown-up's ink running
 *     out refuses the kid with plan_required and writes nothing; with the plan the kid is on fair use
 *     as before (counted on the grown-up, no ink spent).
 * Its own users (ipad-onboarding-*@example.com) are deleted at the end, with their kids.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { rows, rpc } from "../../scripts/lib/rlsChecks.mjs";
import type { RlsClient } from "../../scripts/lib/rlsChecks.mjs";
import { adminDeleteUser, createSupabaseHttp, resolveSupabaseEnv, signUp, waitForHealth } from "../../scripts/lib/supabaseHttp.mjs";

vi.hoisted(() => {
  process.env.LOG_LEVEL = "silent";
});

import { POST as challengeRoute } from "@/app/api/app/attest/challenge/route";
import { POST as registerRoute } from "@/app/api/app/attest/register/route";
import { POST as welcomeRoute } from "@/app/api/email/welcome/route";
import { POST as kidsRoute } from "@/app/api/family/kids/route";
import { POST as pinRoute } from "@/app/api/family/pin/route";
import { POST as stepRoute } from "@/app/api/start/step/route";
import { resetServerEnvCache } from "@/lib/env";
import { appAttestDeps, supabaseAttestStore } from "@/lib/server/appAttest/store";
import { resetRateLimits } from "@/lib/server/rate-limit";
import { makeAssertion, makeAttestation, makeDevice, makeTestCa, type TestCa } from "@/lib/server/appAttest/__tests__/attestKit";

const enabled = process.env.RUN_DB_TESTS === "1";
const suite = enabled ? describe : describe.skip;
const title = enabled
  ? "iPad onboarding integration (live Supabase)"
  : "iPad onboarding integration — skipped: set RUN_DB_TESTS=1 with the local stack running (`npx supabase start`) to enable";

type Consume = { ok: boolean; remaining: number; reason: string | null; unlimited?: boolean; plan_required?: boolean };
type Summary = { balance: number; granted: number; used: number; starter: number; purchases: number; family_ink?: boolean; unlimited?: { unlimited: boolean } };
type Person = { userId: string; email: string; token: string; client: RlsClient };

const DAY = 86_400_000;

suite(title, () => {
  let url: string;
  let anonKey: string;
  let serviceKey: string;
  let service: RlsClient;
  let svc: SupabaseClient;
  let ca: TestCa;
  const made: string[] = [];
  const subs: string[] = [];
  const keys: string[] = [];
  const tag = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const realRoots = appAttestDeps.roots;

  /** A grown-up as the iPad makes one: the public sign-up with the terms version, which must answer with a session. */
  async function grownUp(): Promise<Person> {
    const email = `ipad-onboarding-${tag}-${made.length}@example.com`;
    const res = await signUp(url, anonKey, email, `Ipad-${crypto.randomUUID()}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.access_token, "the sign-up must come back with a session (Confirm email is off)").toBeTruthy();
    const userId = res.body.user.id as string;
    made.push(userId);
    return { userId, email, token: res.body.access_token as string, client: createSupabaseHttp({ url, anonKey, accessToken: res.body.access_token, userId }) };
  }

  /** A session for an account made by the server (a kid): the switch's own way, a magic link's hashed token verified. */
  async function sessionFor(userId: string): Promise<Person> {
    const { data: user } = await svc.auth.admin.getUserById(userId);
    const email = user.user!.email!;
    const link = await svc.auth.admin.generateLink({ type: "magiclink", email });
    const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const verified = await anon.auth.verifyOtp({ type: "magiclink", token_hash: link.data.properties!.hashed_token });
    const token = verified.data.session!.access_token;
    return { userId, email, token, client: createSupabaseHttp({ url, anonKey, accessToken: token, userId }) };
  }

  const appReq = (path: string, body: string, headers: Record<string, string> = {}) =>
    new Request(`http://localhost:3611${path}`, { method: "POST", body, headers: { "content-type": "application/json", "cf-connecting-ip": "198.51.100.77", ...headers } });
  const userReq = (path: string, who: Person, body?: unknown) =>
    new Request(`http://localhost:3611${path}`, {
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { "content-type": "application/json", Authorization: `Bearer ${who.token}`, "x-forwarded-for": "198.51.100.78" },
    });

  async function consume(who: Person, request: string, units = 3): Promise<Consume> {
    const res = await rpc(who.client, "consume_credits", { p_route: "live/check", p_units: units, p_request_id: request });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as Consume;
  }

  async function summary(who: Person): Promise<Summary> {
    const res = await rpc(who.client, "ink_summary");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as Summary;
  }

  async function ownBalance(userId: string): Promise<number> {
    return Number(rows(await service.rest("GET", "profiles", { query: { user_id: `eq.${userId}`, select: "ink_balance" } }))[0]?.ink_balance);
  }

  beforeAll(async () => {
    const env = resolveSupabaseEnv(process.env);
    if (!env.url || !env.anonKey || !env.serviceKey) throw new Error("RUN_DB_TESTS=1 needs the local stack (url, anon and service keys).");
    if (!(await waitForHealth(env.url, { timeoutMs: 180_000, anonKey: env.anonKey }))) throw new Error(`Supabase at ${env.url} is not healthy`);
    url = env.url.replace(/\/$/, "");
    anonKey = env.anonKey;
    serviceKey = env.serviceKey;
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", anonKey);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", serviceKey);
    vi.stubEnv("OPENROUTER_API_KEY", process.env.OPENROUTER_API_KEY || "sk-or-integration-placeholder");
    // never a real email from a test: the welcome route must answer 503 here
    vi.stubEnv("RESEND_API_KEY", "");
    resetServerEnvCache();
    resetRateLimits();
    service = createSupabaseHttp({ url, anonKey, accessToken: serviceKey, userId: null });
    svc = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    ca = makeTestCa();
    appAttestDeps.roots = () => [ca.root];
  }, 240_000);

  afterAll(async () => {
    appAttestDeps.roots = realRoots;
    vi.unstubAllEnvs();
    resetServerEnvCache();
    if (!service) return;
    for (const key of keys) await service.rest("DELETE", "app_attest_keys", { query: { key_id: `eq.${key}` } });
    for (const sub of subs) await service.rest("DELETE", "unlimited_subscriptions", { query: { stripe_subscription_id: `eq.${sub}` } });
    for (const id of made) {
      await service.rest("DELETE", "rate_limit_counters", { query: { user_id: `eq.${id}` } });
      await service.rest("DELETE", "unlimited_usage", { query: { user_id: `eq.${id}` } });
      const res = await adminDeleteUser(url, serviceKey, id);
      if (res.status >= 300 && res.status !== 404) console.warn(`could not delete ${id}: ${res.status}`);
    }
  }, 120_000);

  // ------------------------------------------------------------------ 1. App Attest
  describe("App Attest", () => {
    it("challenge -> register -> a step through the app path; a replay is refused; the journey links to the account and the later steps join it", async () => {
      const device = makeDevice();
      keys.push(device.keyId);

      const issued = await challengeRoute(appReq("/api/app/attest/challenge", ""));
      expect(issued.status).toBe(200);
      const { challenge, expiresAt } = (await issued.json()) as { challenge: string; expiresAt: string };
      expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Date.parse(expiresAt) - Date.now()).toBeGreaterThan(4 * 60_000);

      const attestation = makeAttestation(ca, device, { appId: appAttestDeps.appId(), challenge, environment: "development" });
      const register = () => registerRoute(appReq("/api/app/attest/register", JSON.stringify({ keyId: device.keyId, attestation: attestation.base64, challenge })));
      const registered = await register();
      expect(registered.status).toBe(201);
      expect(await registered.json()).toEqual({ ok: true });
      // a resend after a lost answer: the challenge is used up, the key is there, nothing changes
      expect((await register()).status).toBe(201);
      const stored = rows(await service.rest("GET", "app_attest_keys", { query: { key_id: `eq.${device.keyId}`, select: "sign_count,environment,receipt" } }));
      expect(stored).toEqual([{ sign_count: 0, environment: "development", receipt: Buffer.from("test receipt").toString("base64") }]);
      // the challenge is gone; another device cannot use it
      const other = makeDevice();
      const reuse = await registerRoute(
        appReq("/api/app/attest/register", JSON.stringify({ keyId: other.keyId, attestation: makeAttestation(ca, other, { appId: appAttestDeps.appId(), challenge }).base64, challenge })),
      );
      expect(reuse.status).toBe(403);
      expect(await reuse.json()).toEqual({ error: "invalid_request", reason: "attest_invalid" });

      // a step before the account, through the app path
      const journey = crypto.randomUUID();
      const step = (event: string, counter: number, meta?: Record<string, unknown>) => {
        const body = JSON.stringify({ journeyId: journey, event, meta: { client: "ipad", ...meta } });
        return { body, assertion: makeAssertion(device, { appId: appAttestDeps.appId(), body, counter }).base64 };
      };
      const first = step("start_handoff_kid", 1);
      const sent = await stepRoute(appReq("/api/start/step", first.body, { "x-agathon-app-key": device.keyId, "x-agathon-app-assertion": first.assertion }));
      expect(sent.status).toBe(204);
      const replay = await stepRoute(appReq("/api/start/step", first.body, { "x-agathon-app-key": device.keyId, "x-agathon-app-assertion": first.assertion }));
      expect(replay.status).toBe(403);
      expect(await replay.json()).toEqual({ error: "invalid_request", reason: "attest_invalid" });
      const checked = step("start_try_checked", 2, { solved: true, ms: 1840 });
      expect((await stepRoute(appReq("/api/start/step", checked.body, { "x-agathon-app-key": device.keyId, "x-agathon-app-assertion": checked.assertion }))).status).toBe(204);
      expect(rows(await service.rest("GET", "app_attest_keys", { query: { key_id: `eq.${device.keyId}`, select: "sign_count" } }))).toEqual([{ sign_count: 2 }]);
      const before = rows(await service.rest("GET", "start_steps", { query: { journey_id: `eq.${journey}`, select: "event,meta,user_id", order: "event" } }));
      expect(before).toEqual([
        { event: "start_handoff_kid", meta: { client: "ipad" }, user_id: null },
        { event: "start_try_checked", meta: { solved: true, ms: 1840, client: "ipad" }, user_id: null },
      ]);

      // the account: sign-up with a session, save_onboarding complete with no grade, the journey linked
      const parent = await grownUp();
      const saved = await rpc(parent.client, "save_onboarding", { p_complete: true, p_heard_from: "friend" });
      expect(saved.status, JSON.stringify(saved.body)).toBe(200);
      expect(saved.body).toMatchObject({ course: null, grade: null, heard_from: "friend" });
      expect(saved.body.onboarded_at).toBeTruthy();
      const welcome = await welcomeRoute(userReq("/api/email/welcome", parent));
      expect(welcome.status).toBe(503);
      expect(await welcome.json()).toMatchObject({ error: "feature_unavailable" });
      const linked = await rpc(parent.client, "link_start_journey", { p_journey: journey });
      expect(linked.status, JSON.stringify(linked.body)).toBe(200);
      expect(linked.body).toBe(true);

      // the steps after the account, still by journey through the app path: they join the account
      let counter = 3;
      for (const event of ["start_trial_shown", "start_trial_declined", "start_pin_set", "start_kid_added", "start_first_board"]) {
        const s = step(event, counter++);
        const res = await stepRoute(appReq("/api/start/step", s.body, { "x-agathon-app-key": device.keyId, "x-agathon-app-assertion": s.assertion }));
        expect(res.status, event).toBe(204);
      }
      const after = rows(await service.rest("GET", "start_steps", { query: { journey_id: `eq.${journey}`, select: "event,user_id" } }));
      expect(after).toHaveLength(8);
      expect(after.every((r: { user_id: string }) => r.user_id === parent.userId)).toBe(true);
      expect(after.map((r: { event: string }) => r.event).sort()).toEqual(
        ["start_account", "start_first_board", "start_handoff_kid", "start_kid_added", "start_pin_set", "start_trial_declined", "start_trial_shown", "start_try_checked"].sort(),
      );
      await service.rest("DELETE", "start_steps", { query: { journey_id: `eq.${journey}` } });
    }, 120_000);

    it("the tables are the service role's alone; a challenge is used once, an expired one never; the counter only moves forward", async () => {
      const parent = await grownUp();
      for (const table of ["app_attest_keys", "app_attest_challenges"]) {
        for (const client of [createSupabaseHttp({ url, anonKey, userId: null }), parent.client]) {
          const read = await client.rest("GET", table, { query: { select: "*", limit: "1" } });
          expect(read.status, `${table} read`).toBeGreaterThanOrEqual(400);
          const write = await client.rest("POST", table, { body: { challenge: "x".repeat(43), expires_at: new Date().toISOString() }, prefer: "return=minimal" });
          expect(write.status, `${table} write`).toBeGreaterThanOrEqual(400);
        }
      }

      const store = supabaseAttestStore(svc);
      const now = new Date();
      const fresh = `t${tag.replace(/[^A-Za-z0-9]/g, "")}${"a".repeat(43)}`.slice(0, 43);
      const stale = `s${tag.replace(/[^A-Za-z0-9]/g, "")}${"b".repeat(43)}`.slice(0, 43);
      await store.saveChallenge(fresh, new Date(now.getTime() + 60_000), now);
      await store.saveChallenge(stale, new Date(now.getTime() - 1_000), new Date(now.getTime() - 120_000));
      expect(await store.consumeChallenge(fresh, now)).toBe(true);
      expect(await store.consumeChallenge(fresh, now)).toBe(false);
      expect(await store.consumeChallenge(stale, now)).toBe(false);
      // the next challenge made clears the expired ones
      const next = `n${tag.replace(/[^A-Za-z0-9]/g, "")}${"c".repeat(43)}`.slice(0, 43);
      await store.saveChallenge(next, new Date(now.getTime() + 60_000), now);
      expect(rows(await service.rest("GET", "app_attest_challenges", { query: { challenge: `eq.${stale}`, select: "challenge" } }))).toEqual([]);
      await store.consumeChallenge(next, now);

      const device = makeDevice();
      keys.push(device.keyId);
      const key = { keyId: device.keyId, publicKeyPem: device.publicPem, environment: "production" as const, receipt: null };
      expect(await store.saveKey(key, now)).toBe("created");
      expect(await store.saveKey(key, now)).toBe("exists");
      expect(await store.getKey(device.keyId)).toEqual({ keyId: device.keyId, publicKeyPem: device.publicPem, signCount: 0, environment: "production" });
      expect(await store.advanceCounter(device.keyId, 1, now)).toBe(true);
      expect(await store.advanceCounter(device.keyId, 1, now)).toBe(false);
      expect(await store.advanceCounter(device.keyId, 0, now)).toBe(false);
      expect(await store.advanceCounter(device.keyId, 7, now)).toBe(true);
      expect((await store.getKey(device.keyId))?.signCount).toBe(7);
      expect(await store.getKey(makeDevice().keyId)).toBeNull();
    }, 60_000);
  });

  // ------------------------------------------------------------------ 2 and 3. "Not now"
  describe('"Not now": the first kid without the plan', () => {
    let parent: Person;
    let kid: Person;

    it("POST /api/family/pin, then /api/family/kids with no plan: 201 for the first kid, 409 plan_required for a second", async () => {
      parent = await grownUp();
      const pin = await pinRoute(userReq("/api/family/pin", parent, { pin: "2468" }));
      expect(pin.status, await pin.clone().text()).toBe(200);
      const first = await kidsRoute(userReq("/api/family/kids", parent, { displayName: "Sam", grade: 3, avatar: "panda" }));
      expect(first.status, await first.clone().text()).toBe(201);
      const member = (await first.json()) as { userId: string; displayName: string; isParent: boolean };
      expect(member).toMatchObject({ displayName: "Sam", isParent: false });
      const second = await kidsRoute(userReq("/api/family/kids", parent, { displayName: "Ada", grade: 1, avatar: "fox" }));
      expect(second.status).toBe(409);
      expect(await second.json()).toMatchObject({ error: "invalid_request", reason: "plan_required", message: "Start your free trial to add kids." });
      kid = await sessionFor(member.userId);
    }, 60_000);

    it("the kid spends the GROWN-UP's ink: the grown-up's balance drops, the row is the grown-up's, the kid's summary shows that balance", async () => {
      const start = await ownBalance(parent.userId);
      expect(start).toBeGreaterThan(10);
      expect(await ownBalance(kid.userId)).toBe(0);

      const kidView = await summary(kid);
      expect(kidView).toMatchObject({ balance: start, family_ink: true, purchases: 0 });
      expect(kidView.unlimited?.unlimited).toBe(false);
      // the grown-up's own summary is the plain one
      const parentView = await summary(parent);
      expect(parentView.balance).toBe(start);
      expect(parentView.family_ink).toBeUndefined();

      const spent = await consume(kid, `ipad-noplan-${tag}-1`);
      expect(spent).toEqual({ ok: true, remaining: start - 3, reason: null });
      expect(await ownBalance(parent.userId)).toBe(start - 3);
      expect(await ownBalance(kid.userId)).toBe(0);
      expect(rows(await service.rest("GET", "usage_events", { query: { request_id: `eq.ipad-noplan-${tag}-1`, select: "user_id,units" } }))).toEqual([{ user_id: parent.userId, units: 3 }]);
      expect((await summary(kid)).balance).toBe(start - 3);
    }, 60_000);

    it("a refund of the kid's failed call gives the ink back to the grown-up", async () => {
      const before = await ownBalance(parent.userId);
      await consume(kid, `ipad-noplan-${tag}-refund`, 2);
      expect(await ownBalance(parent.userId)).toBe(before - 2);
      const refund = await rpc(service, "refund_ink_for", { p_user_id: kid.userId, p_request_id: `ipad-noplan-${tag}-refund` });
      expect(refund.status, JSON.stringify(refund.body)).toBe(200);
      expect(refund.body).toEqual({ refunded: 2, remaining: before });
      expect(await ownBalance(parent.userId)).toBe(before);
      expect(rows(await service.rest("GET", "usage_events", { query: { request_id: `eq.ipad-noplan-${tag}-refund`, select: "id" } }))).toEqual([]);
    }, 60_000);

    it("the grown-up's ink spent: the kid is refused (insufficient_credits, plan_required) and nothing is written", async () => {
      let left = await ownBalance(parent.userId);
      let n = 0;
      while (left > 0) {
        const units = Math.min(left, 1000);
        expect(await consume(parent, `ipad-drain-${tag}-${n++}`, units)).toMatchObject({ ok: true });
        left -= units;
      }
      expect(await ownBalance(parent.userId)).toBe(0);
      expect(await consume(kid, `ipad-noplan-${tag}-empty`)).toEqual({ ok: false, remaining: 0, reason: "insufficient_credits", plan_required: true });
      expect(rows(await service.rest("GET", "usage_events", { query: { request_id: `eq.ipad-noplan-${tag}-empty`, select: "id" } }))).toEqual([]);
      expect((await summary(kid)).balance).toBe(0);
    }, 60_000);

    it("with the plan the kid is on fair use as before: unlimited, counted on the grown-up, no ink spent; the summary is the plan's", async () => {
      const sub = `sub_ipad_onboarding_${tag}`;
      subs.push(sub);
      const res = await service.rest("POST", "unlimited_subscriptions", {
        body: { stripe_subscription_id: sub, user_id: parent.userId, status: "trialing", trial_end: new Date(Date.now() + 7 * DAY).toISOString(), current_period_end: new Date(Date.now() + 7 * DAY).toISOString(), livemode: false },
        prefer: "return=minimal",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      const balance = await ownBalance(parent.userId);
      const out = await consume(kid, `ipad-plan-${tag}-1`);
      expect(out).toMatchObject({ ok: true, unlimited: true });
      expect(rows(await service.rest("GET", "unlimited_usage", { query: { request_id: `eq.ipad-plan-${tag}-1`, select: "user_id" } }))).toEqual([{ user_id: parent.userId }]);
      expect(rows(await service.rest("GET", "usage_events", { query: { request_id: `eq.ipad-plan-${tag}-1`, select: "id" } }))).toEqual([]);
      expect(await ownBalance(parent.userId)).toBe(balance);
      const view = await summary(kid);
      expect(view.family_ink).toBeUndefined();
      expect(view.unlimited?.unlimited).toBe(true);
      // and with the plan, a second kid may join
      const second = await kidsRoute(userReq("/api/family/kids", parent, { displayName: "Ada", grade: 1, avatar: "fox" }));
      expect(second.status).toBe(201);
    }, 60_000);
  });
});
