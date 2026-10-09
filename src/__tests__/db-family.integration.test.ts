/**
 * Family hardening (supabase/migrations/20261009040000_family_hardening.sql) against a LIVE Supabase
 * stack (normally the local one from `npx supabase start`). Opt-in: runs only when RUN_DB_TESTS=1.
 *
 *   RUN_DB_TESTS=1 npx vitest run src/__tests__/db-family.integration.test.ts
 *
 * Needs SUPABASE_SERVICE_ROLE_KEY (the local stack's comes from `npx supabase status -o env`): kids
 * are made the way the server makes them (src/lib/family/server/store.ts createKid: the admin API
 * with `user_metadata.kid = true`, then a family_members row with the service role).
 *
 * Covered:
 *   1. kids are no free-AI loophole
 *      - a kid account gets no starter ink, at sign-up or from the self-heal on its first call; an
 *        ordinary account still does
 *      - a kid never spends ink of their own, not even ink granted by hand: without the grown-up's
 *        Unlimited it is insufficient_credits with plan_required, and nothing is written
 *      - fair use is ONE allowance per family, counted on the grown-up's rows: a full family refuses
 *        every member, deleting a kid and adding another resets nothing, and refunding a kid's call
 *        gives the family its count back
 *   2. the PIN's day budget: the 10th try is the last; the lock outlives the 15-minute window, a token
 *      refresh does not lift it, the grown-up's own password sign-in does, and so do 24 hours
 *   3. deleting a grown-up by the admin API (the Dashboard's path) deletes their kids' accounts too
 *   4. delete_own_account() refusing (a plan that would charge again) deletes no kid
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rows, rpc } from "../../scripts/lib/rlsChecks.mjs";
import type { RlsClient } from "../../scripts/lib/rlsChecks.mjs";
import { TERMS_VERSION, adminDeleteUser, createSupabaseHttp, resolveSupabaseEnv, signInWithPassword, waitForHealth } from "../../scripts/lib/supabaseHttp.mjs";

const enabled = process.env.RUN_DB_TESTS === "1";
const suite = enabled ? describe : describe.skip;
const title = enabled
  ? "Family hardening integration (live Supabase)"
  : "Family hardening integration — skipped: set RUN_DB_TESTS=1 with the local stack running (`npx supabase start`) to enable";

type Account = { client: RlsClient; userId: string; email: string; password: string; refreshToken: string };
type Consume = { ok: boolean; remaining: number; reason: string | null; unlimited?: boolean; plan_required?: boolean };
type PinTry = { allowed: boolean; remaining: number; locked: boolean; last: boolean; retry_after_ms: number; window_start: string | null };

const DAY = 86_400_000;

suite(title, () => {
  let url: string;
  let anonKey: string;
  let serviceKey: string;
  let service: RlsClient;
  const made: string[] = [];
  const subs: string[] = [];
  const tag = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  /** An account made with the admin API (like the server makes kids), signed in with its password. */
  async function account(kind: "grown-up" | "kid"): Promise<Account> {
    const email = kind === "kid" ? `kid-${crypto.randomUUID()}@kids.agathon.app` : `family-db-${tag}-${made.length}@example.com`;
    const password = `Family-${crypto.randomUUID()}`;
    const res = await fetch(`${url}/auth/v1/admin/users`, {
      method: "POST",
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { terms_version: TERMS_VERSION, ...(kind === "kid" ? { kid: true, display_name: "Kid" } : {}) } }),
    });
    const created = (await res.json()) as { id?: string };
    expect(res.status, JSON.stringify(created)).toBeLessThan(300);
    made.push(created.id as string);
    return signIn(email, password);
  }

  async function signIn(email: string, password: string): Promise<Account> {
    const session = await signInWithPassword(url, anonKey, email, password);
    expect(session.status, JSON.stringify(session.body)).toBe(200);
    const userId = session.body.user.id as string;
    return { client: createSupabaseHttp({ url, anonKey, accessToken: session.body.access_token, userId }), userId, email, password, refreshToken: session.body.refresh_token };
  }

  /** A grown-up with a PIN'd family and `n` kids made as kids. */
  async function family(n: number): Promise<{ parent: Account; kids: Account[] }> {
    const parent = await account("grown-up");
    const fam = await service.rest("POST", "families", { body: { parent_id: parent.userId, pin_hash: "scrypt$db$family" }, prefer: "return=minimal" });
    expect(fam.status, JSON.stringify(fam.body)).toBe(201);
    const kids: Account[] = [];
    for (let i = 0; i < n; i++) kids.push(await addKid(parent));
    return { parent, kids };
  }

  async function addKid(parent: Account): Promise<Account> {
    const kid = await account("kid");
    const link = await service.rest("POST", "family_members", { body: { child_id: kid.userId, parent_id: parent.userId }, prefer: "return=minimal" });
    expect(link.status, JSON.stringify(link.body)).toBe(201);
    return kid;
  }

  async function givePlan(parent: Account, status: "trialing" | "active" = "trialing"): Promise<string> {
    const sub = `sub_db_family_${tag}_${subs.length}`;
    subs.push(sub);
    const res = await service.rest("POST", "unlimited_subscriptions", {
      body: { stripe_subscription_id: sub, user_id: parent.userId, status, trial_end: new Date(Date.now() + 7 * DAY).toISOString(), current_period_end: new Date(Date.now() + 7 * DAY).toISOString(), livemode: false },
      prefer: "return=minimal",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return sub;
  }

  async function consume(who: Account, request: string): Promise<Consume> {
    const res = await rpc(who.client, "consume_credits", { p_route: "live/check", p_units: 3, p_request_id: request });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as Consume;
  }

  async function balance(who: Account): Promise<{ balance: number; starter: number }> {
    const res = await rpc(who.client, "ink_summary");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as { balance: number; starter: number };
  }

  async function pinTry(parentId: string): Promise<PinTry> {
    const res = await rpc(service, "family_pin_attempt", { p_parent: parentId, p_limit: 1000, p_window_ms: 900_000, p_day_limit: 10 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as PinTry;
  }

  async function exists(userId: string): Promise<boolean> {
    const res = await fetch(`${url}/auth/v1/admin/users/${userId}`, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
    await res.arrayBuffer();
    return res.status === 200;
  }

  beforeAll(async () => {
    const env = resolveSupabaseEnv(process.env);
    if (!env.url || !env.anonKey) throw new Error("RUN_DB_TESTS=1 but no Supabase target: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, or start the local stack.");
    if (!env.serviceKey) throw new Error("db-family tests need SUPABASE_SERVICE_ROLE_KEY (the local stack provides it via `npx supabase status -o env`).");
    if (!(await waitForHealth(env.url, { timeoutMs: 180_000, anonKey: env.anonKey }))) throw new Error(`Supabase at ${env.url} did not answer /auth/v1/health within 3 minutes`);
    url = env.url.replace(/\/$/, "");
    anonKey = env.anonKey;
    serviceKey = env.serviceKey;
    service = createSupabaseHttp({ url, anonKey, accessToken: serviceKey, userId: null });
  }, 240_000);

  afterAll(async () => {
    if (!service) return;
    await service.rest("DELETE", "unlimited_usage", { query: { request_id: `like.db-family-${tag}-*` } });
    for (const sub of subs) await service.rest("DELETE", "unlimited_subscriptions", { query: { stripe_subscription_id: `eq.${sub}` } });
    for (const id of made) {
      await service.rest("DELETE", "rate_limit_counters", { query: { user_id: `eq.${id}` } });
      await service.rest("DELETE", "unlimited_usage", { query: { user_id: `eq.${id}` } });
      // a grown-up first takes their kids with them: a kid's 404 afterwards is expected
      const res = await adminDeleteUser(url, serviceKey, id);
      if (res.status >= 300 && res.status !== 404) console.warn(`could not delete ${id}: ${res.status}`);
    }
  }, 120_000);

  // ------------------------------------------------------------------ 1. no free AI through kids
  it("a kid account gets no starter ink, at sign-up or on its first call; an ordinary account still does", async () => {
    const { parent, kids } = await family(1);
    const [kid] = kids;
    expect(rows(await service.rest("GET", "ink_grants", { query: { user_id: `eq.${kid.userId}`, select: "kind" } }))).toEqual([]);
    // ink_summary runs the self-heal (ensure_ink_account), which must not grant it now either
    expect(await balance(kid)).toMatchObject({ balance: 0, starter: 0 });
    await consume(kid, `db-family-${tag}-first`);
    expect(rows(await service.rest("GET", "ink_grants", { query: { user_id: `eq.${kid.userId}`, select: "kind" } }))).toEqual([]);
    // the grown-up's own sign-up is unchanged
    const grownUp = await balance(parent);
    expect(grownUp.starter).toBeGreaterThan(0);
    expect(grownUp.balance).toBe(grownUp.starter);
  }, 60_000);

  it("a kid never spends ink of their own, not even ink granted by hand, without the grown-up's plan", async () => {
    const { kids } = await family(1);
    const [kid] = kids;
    const grant = await rpc(service, "grant_ink", { p_user_id: kid.userId, p_units: 50, p_reason: "db-family test" });
    expect(grant.status, JSON.stringify(grant.body)).toBe(200);
    expect((await balance(kid)).balance).toBe(50);
    const refused = await consume(kid, `db-family-${tag}-noplan`);
    expect(refused).toEqual({ ok: false, remaining: 0, reason: "insufficient_credits", plan_required: true });
    expect((await balance(kid)).balance).toBe(50);
    expect(rows(await service.rest("GET", "usage_events", { query: { user_id: `eq.${kid.userId}`, select: "id" } }))).toEqual([]);
  }, 60_000);

  it("fair use is one allowance per family, on the grown-up's rows: full means full for everyone, and deleting a kid resets nothing", async () => {
    const { parent, kids } = await family(2);
    const [kidA, kidB] = kids;
    await givePlan(parent);

    const first = await consume(kidA, `db-family-${tag}-fair-1`);
    expect(first).toMatchObject({ ok: true, unlimited: true });
    const row = rows(await service.rest("GET", "unlimited_usage", { query: { request_id: `eq.db-family-${tag}-fair-1`, select: "user_id" } }));
    expect(row).toEqual([{ user_id: parent.userId }]);

    // refunding a kid's failed call gives the family its count back
    const refund = await rpc(service, "refund_ink_for", { p_user_id: kidA.userId, p_request_id: `db-family-${tag}-fair-1` });
    expect(refund.body).toMatchObject({ refunded: 0 });
    expect(rows(await service.rest("GET", "unlimited_usage", { query: { request_id: `eq.db-family-${tag}-fair-1`, select: "id" } }))).toEqual([]);

    // fill the family's window to one under the cap
    const capRes = await rpc(service, "unlimited_fair_use_per_day");
    const cap = Number(capRes.body);
    expect(cap).toBeGreaterThan(1);
    const oldest = Date.now() - 23 * 60 * 60_000;
    const filler = Array.from({ length: cap - 1 }, (_, i) => ({ user_id: parent.userId, route: "live/recognize", units: 1, created_at: new Date(oldest + i * 1000).toISOString() }));
    const filled = await service.rest("POST", "unlimited_usage", { body: filler, prefer: "return=minimal" });
    expect(filled.status, JSON.stringify(filled.body)).toBe(201);

    expect(await consume(kidB, `db-family-${tag}-fair-2`)).toMatchObject({ ok: true, unlimited: true });
    for (const who of [kidA, kidB, parent]) expect(await consume(who, `db-family-${tag}-fair-over-${who.userId}`)).toMatchObject({ ok: false, reason: "fair_use", unlimited: true });

    // a kid removed and a new one added: the family's count is where it was
    const gone = await adminDeleteUser(url, serviceKey, kidB.userId);
    expect(gone.status).toBeLessThan(300);
    const kidC = await addKid(parent);
    expect(await consume(kidC, `db-family-${tag}-fair-3`)).toMatchObject({ ok: false, reason: "fair_use" });
    expect(await consume(parent, `db-family-${tag}-fair-4`)).toMatchObject({ ok: false, reason: "fair_use" });
  }, 120_000);

  // ------------------------------------------------------------------ 2. the PIN's day budget
  it("the PIN's day: the 10th try is the last; the lock outlives the 15-minute window and a token refresh, and lifts on the grown-up's own sign-in", async () => {
    const { parent } = await family(0);
    const tries: PinTry[] = [];
    for (let i = 0; i < 10; i++) tries.push(await pinTry(parent.userId));
    expect(tries.map((t) => t.allowed)).toEqual(Array(10).fill(true));
    expect(tries.map((t) => t.last)).toEqual([...Array(9).fill(false), true]);
    expect(tries[9].remaining).toBe(0);

    const locked = await pinTry(parent.userId);
    expect(locked).toMatchObject({ allowed: false, locked: true });
    expect(locked.retry_after_ms).toBeGreaterThan(23 * 60 * 60_000);
    // a new 15-minute window changes nothing (it is the day's lock, not the window's)
    await service.rest("DELETE", "rate_limit_counters", { query: { user_id: `eq.${parent.userId}`, bucket: "eq.family_pin" } });
    expect(await pinTry(parent.userId)).toMatchObject({ allowed: false, locked: true });
    // a session kept alive somewhere (a token refresh) is not the grown-up signing in
    const refreshed = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, { method: "POST", headers: { apikey: anonKey, "Content-Type": "application/json" }, body: JSON.stringify({ refresh_token: parent.refreshToken }) });
    expect(refreshed.status).toBe(200);
    expect(await pinTry(parent.userId)).toMatchObject({ allowed: false, locked: true });

    // the grown-up signs in with their password: the lock lifts and the day starts over
    await signIn(parent.email, parent.password);
    expect(await pinTry(parent.userId)).toMatchObject({ allowed: true, locked: false, remaining: 9 });
  }, 60_000);

  it("the PIN's lock lifts after 24 hours, and a right PIN on the last try is no lock", async () => {
    const { parent } = await family(0);
    for (let i = 0; i < 10; i++) await pinTry(parent.userId);
    expect(await pinTry(parent.userId)).toMatchObject({ locked: true });
    const aged = await service.rest("PATCH", "families", { query: { parent_id: `eq.${parent.userId}` }, body: { pin_locked_at: new Date(Date.now() - 25 * 60 * 60_000).toISOString() }, prefer: "return=minimal" });
    expect(aged.status, JSON.stringify(aged.body)).toBe(204);
    expect(await pinTry(parent.userId)).toMatchObject({ allowed: true, remaining: 9 });

    // eight more (nine in the day), then the tenth is right: forgiven, and the lock it set goes
    for (let i = 0; i < 8; i++) await pinTry(parent.userId);
    const tenth = await pinTry(parent.userId);
    expect(tenth).toMatchObject({ allowed: true, last: true });
    const forgive = await rpc(service, "family_pin_forgive", { p_parent: parent.userId, p_window_start: tenth.window_start });
    expect(forgive.status, JSON.stringify(forgive.body)).toBeLessThan(300);
    expect(rows(await service.rest("GET", "families", { query: { parent_id: `eq.${parent.userId}`, select: "pin_locked_at" } }))).toEqual([{ pin_locked_at: null }]);
    expect(await pinTry(parent.userId)).toMatchObject({ allowed: true, last: true });
  }, 60_000);

  // ------------------------------------------------------------------ 3 and 4. deleting the grown-up
  it("deleting a grown-up by the admin API (the Dashboard) deletes their kids' accounts too", async () => {
    const { parent, kids } = await family(2);
    const other = await family(1); // another family is untouched
    const res = await adminDeleteUser(url, serviceKey, parent.userId);
    expect(res.status).toBeLessThan(300);
    for (const kid of kids) {
      expect(await exists(kid.userId)).toBe(false);
      expect(rows(await service.rest("GET", "profiles", { query: { user_id: `eq.${kid.userId}`, select: "user_id" } }))).toEqual([]);
    }
    expect(await exists(other.kids[0].userId)).toBe(true);
    expect(rows(await service.rest("GET", "family_members", { query: { child_id: `eq.${other.kids[0].userId}`, select: "parent_id" } }))).toEqual([{ parent_id: other.parent.userId }]);
  }, 60_000);

  it("delete_own_account() refusing (a plan that would charge again) deletes no kid; once allowed, the kids go with the grown-up", async () => {
    const { parent, kids } = await family(1);
    const sub = await givePlan(parent, "active");
    const refused = await rpc(parent.client, "delete_own_account");
    expect(refused.body).toMatchObject({ hint: "unlimited_active" });
    expect(await exists(kids[0].userId)).toBe(true);

    await service.rest("PATCH", "unlimited_subscriptions", { query: { stripe_subscription_id: `eq.${sub}` }, body: { cancel_at_period_end: true }, prefer: "return=minimal" });
    const done = await rpc(parent.client, "delete_own_account");
    expect(done.status, JSON.stringify(done.body)).toBeLessThan(300);
    expect(await exists(kids[0].userId)).toBe(false);
    expect(await exists(parent.userId)).toBe(false);
  }, 60_000);
});
