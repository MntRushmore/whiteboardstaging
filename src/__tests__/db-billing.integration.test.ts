/**
 * Accounts, ink & billing behaviour against a LIVE Supabase stack (normally the
 * local one from `npx supabase start`). Opt-in: runs only when RUN_DB_TESTS=1.
 *
 *   RUN_DB_TESTS=1 npx vitest run src/__tests__/db-billing.integration.test.ts
 *
 * Needs SUPABASE_SERVICE_ROLE_KEY (or the local stack, whose key comes from
 * `npx supabase status -o env`): the ledger, concurrency and purchase cases add or
 * remove ink the way the webhook / an operator would, i.e. with the service role,
 * because nothing exposed to `authenticated` can add ink.
 *
 * Covered (migration 20261002000000_ink.sql, on top of 20260917020000_accounts_billing.sql):
 *   - sign-up: a 'free' profile and the 100-ink starter (once; the guided first board's, 20261005100000_no_free_plan.sql), ink_balance = the ledger
 *   - ink_summary(): shape, starter; credit_summary() keeps its old keys, consistent for ink
 *   - consume_credits(): decrement + usage row, argument validation, refusal without writes
 *   - the balance is all-time: a usage row or a grant from another month counts like today's
 *   - grant_ink(): a manual grant; a negative correction stops at zero; the CHECK refuses a
 *     ledger row that would take the balance below zero; ledger rows are append-only, and
 *     not even the service role can delete a usage row, grant, purchase or profile
 *   - concurrency: 10 parallel 1-ink spends with 5 left -> exactly 5 succeed, balance 0
 *   - purchases: once per Checkout Session; refunds (partial, full, replayed) take back at most
 *     the unspent ink and record what was taken back and what was already spent
 *   - the money has to cover the pack: underpaid, free, unpriced, non-USD sessions, unknown
 *     packs and missing accounts go to ink_checkout_reviews with no ink (service role only);
 *     refunding one marks the review refunded; resolve_ink_checkout_review() turns one into a
 *     real purchase that a later refund reverses
 *   - ink_packs: the catalogue as seeded
 *   - delete_own_account(): auth.users row, profile, boards, ledgers, purchases, storage rows
 *     (the delete guards let the account's cascade through); a review outlives the account;
 *     the account's bug reports go with it, email included (20261003010100)
 *
 * Covered (Agathon Unlimited; 20261003020000_unlimited.sql):
 *   - link before the subscription event (pending, no plan yet), then trialing: help spends no ink
 *   - the fair-use cap over a rolling 24 hours: fair_use with a retry hint; a recorded request id
 *     stays free; a refunded call gives back its count and no ink
 *   - delete_own_account waits for the plan to end; the subscription row outlives the account, unlinked
 *
 * Covered (go-live gaps; 20261003040000_go_live_gaps.sql):
 *   - the checkout links by the account's checkout_ref (never its user id), with the payer's email,
 *     which goes when the account goes
 *   - a second plan's free week grants nothing (repeat_trial) until it turns active
 *   - purge_billing_event_payloads() blanks payloads older than 90 days, keeps the rows, service role only
 *
 * Covered (sign-up consent; 20261003010000_signup_consent.sql):
 *   - the profile records the Terms version and when; the user can read it, not write it
 *   - no account without an accepted Terms version: sign-up without one, with a malformed one,
 *     or through the admin API is refused and creates nothing
 *
 * Covered (refunds of failed calls; 20260917030000_refunds_ratelimit.sql, made service-role
 * only by 20261002000000_ink.sql):
 *   - a user can call neither refund_credits() nor refund_ink_for() (403), anon neither (401)
 *   - refund_ink_for() (service role): the user's own recent request restored + row deleted,
 *     idempotent; another user's id and rows older than 15 minutes refund nothing
 *   - rate_limit_hit(): p_limit hits then denial with a retry hint, independent
 *     per user, window rollover (1 s window), expired-row cleanup, 20 parallel
 *     hits with limit 10 -> exactly 10 allowed, table unreadable by users
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ASSETS_BUCKET, TINY_PNG, isCreditSummary, isInkSummary, isRateLimitResult, rows, rpc } from "../../scripts/lib/rlsChecks.mjs";
import type { CheckContext, RlsClient } from "../../scripts/lib/rlsChecks.mjs";
import { createSupabaseHttp, resolveSupabaseEnv, waitForHealth } from "../../scripts/lib/supabaseHttp.mjs";
import { TERMS_VERSION } from "@/lib/legal";
import { bootstrapVerifyContext } from "../../scripts/lib/verifyContext.mjs";

const enabled = process.env.RUN_DB_TESTS === "1";
const suite = enabled ? describe : describe.skip;
const title = enabled
  ? "Accounts, ink & billing integration (live Supabase)"
  : "Accounts, ink & billing integration — skipped: set RUN_DB_TESTS=1 with the local stack running (`npx supabase start`) to enable";

type Ink = {
  balance: number;
  granted: number;
  purchased: number;
  refunded: number;
  used: number;
  starter: number;
  starter_at: string | null;
  purchases: number;
  last_purchase: { pack_id: string; ink: number; status: string } | null;
};
type Summary = { plan_id: string; monthly_credits: number; used: number; granted: number; remaining: number };
type Consume = { ok: boolean; remaining: number; reason: string | null };
type Refund = { refunded: number; remaining: number };
type RateLimit = { allowed: boolean; remaining: number; retry_after_ms: number; backend: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function hit(client: RlsClient, bucket: string, limit: number, windowMs: number): Promise<RateLimit> {
  const res = await rpc(client, "rate_limit_hit", { p_bucket: bucket, p_limit: limit, p_window_ms: windowMs });
  expect(res.status, `rate_limit_hit -> ${JSON.stringify(res.body)}`).toBe(200);
  expect(isRateLimitResult(res.body, windowMs), JSON.stringify(res.body)).toBe(true);
  return res.body as RateLimit;
}

async function ink(client: RlsClient): Promise<Ink> {
  const res = await rpc(client, "ink_summary");
  expect(res.status, `ink_summary -> ${JSON.stringify(res.body)}`).toBe(200);
  expect(isInkSummary(res.body), JSON.stringify(res.body)).toBe(true);
  return res.body as Ink;
}

async function summary(client: RlsClient): Promise<Summary> {
  const res = await rpc(client, "credit_summary");
  expect(res.status, `credit_summary -> ${JSON.stringify(res.body)}`).toBe(200);
  expect(isCreditSummary(res.body)).toBe(true);
  return res.body as Summary;
}

function consume(client: RlsClient, units: number, route: string, extra: Record<string, unknown> = {}) {
  return rpc(client, "consume_credits", { p_route: route, p_units: units, ...extra });
}

const DAY = 86_400_000;

suite(title, () => {
  let ctx: CheckContext;
  let service: RlsClient;
  let url: string;
  let serviceKey: string;
  let cleanup: (() => Promise<string[]>) | undefined;

  /** Set a user's balance to exactly `target` with a manual grant (the operator's tool). */
  async function setBalance(client: RlsClient, target: number) {
    const now = (await ink(client)).balance;
    if (now === target) return;
    const res = await rpc(service, "grant_ink", { p_user_id: client.userId, p_units: target - now, p_reason: "db-billing test" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await ink(client)).balance).toBe(target);
  }

  beforeAll(async () => {
    const env = resolveSupabaseEnv(process.env);
    if (!env.url || !env.anonKey) {
      throw new Error(
        "RUN_DB_TESTS=1 but no Supabase target: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, " +
          "or start the local stack with `npx supabase start`.",
      );
    }
    if (!env.serviceKey) {
      throw new Error("db-billing tests need SUPABASE_SERVICE_ROLE_KEY (the local stack provides it via `npx supabase status -o env`).");
    }
    if (!(await waitForHealth(env.url, { timeoutMs: 180_000 }))) {
      throw new Error(`Supabase at ${env.url} (from ${env.source}) did not answer /auth/v1/health within 3 minutes`);
    }
    url = env.url.replace(/\/$/, "");
    serviceKey = env.serviceKey;
    service = createSupabaseHttp({ url, anonKey: env.anonKey, accessToken: serviceKey, userId: null });
    const boot = await bootstrapVerifyContext({
      url,
      anonKey: env.anonKey,
      serviceKey,
      emailDomain: process.env.VERIFY_EMAIL_DOMAIN,
    });
    ctx = boot.ctx;
    cleanup = boot.cleanup;
  }, 240_000);

  afterAll(async () => {
    if (cleanup) await cleanup();
  }, 60_000);

  it("creates a 'free' profile and grants the 100 starter ink once for every new user (sign-up trigger)", async () => {
    for (const client of [ctx.a, ctx.b]) {
      const res = await client.rest("GET", "profiles", { query: { select: "user_id,plan_id,display_name,billing_status,ink_balance" } });
      expect(res.status).toBe(200);
      expect(rows(res)).toEqual([{ user_id: client.userId, plan_id: "free", display_name: null, billing_status: null, ink_balance: 100 }]);
      const grants = await client.rest("GET", "ink_grants", { query: { select: "kind,units,reason" } });
      expect(rows(grants)).toEqual([{ kind: "starter", units: 100, reason: "Starter ink" }]);
    }
    // a second starter is impossible (one per account)
    const dup = await service.rest("POST", "ink_grants", { body: { user_id: ctx.a.userId, units: 300, kind: "starter" }, prefer: "return=minimal" });
    expect(dup.status, JSON.stringify(dup.body)).toBe(409);
  }, 30_000);

  it("records the sign-up's Terms acceptance on the profile; the user can read it but never write it", async () => {
    const res = await ctx.a.rest("GET", "profiles", { query: { select: "accepted_terms_at,terms_version" } });
    expect(res.status).toBe(200);
    const [p] = rows(res) as Array<{ accepted_terms_at: string; terms_version: string }>;
    expect(p.terms_version).toBe(TERMS_VERSION);
    expect(Date.parse(p.accepted_terms_at)).toBeGreaterThan(Date.now() - DAY);

    const forged = await ctx.a.rest("PATCH", "profiles", {
      query: { user_id: `eq.${ctx.a.userId}` },
      body: { accepted_terms_at: "2020-01-01T00:00:00Z", terms_version: "2020-01-01" },
    });
    expect(forged.status, JSON.stringify(forged.body)).toBe(403);
    expect(rows(await ctx.a.rest("GET", "profiles", { query: { select: "terms_version" } }))).toEqual([{ terms_version: TERMS_VERSION }]);
  }, 30_000);

  it("refuses an account whose sign-up did not accept the Terms, by sign-up or with the service role", async () => {
    const anonKey = resolveSupabaseEnv(process.env).anonKey as string;
    const tag = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const attempts: Array<[string, Promise<Response>]> = [
      ["no metadata", fetch(`${url}/auth/v1/signup`, { method: "POST", headers: { apikey: anonKey, "Content-Type": "application/json" }, body: JSON.stringify({ email: `consent-none-${tag}@example.com`, password: "Consent-Test-1" }) })],
      ["not a version", fetch(`${url}/auth/v1/signup`, { method: "POST", headers: { apikey: anonKey, "Content-Type": "application/json" }, body: JSON.stringify({ email: `consent-bad-${tag}@example.com`, password: "Consent-Test-1", data: { terms_version: true } }) })],
      // date-shaped but not a version: no such day, before 2026, or in the future
      ...["2026-99-99", "2026-02-30", "1900-01-01", "2099-01-01"].map((v, i): [string, Promise<Response>] => [
        `version ${v}`,
        fetch(`${url}/auth/v1/signup`, { method: "POST", headers: { apikey: anonKey, "Content-Type": "application/json" }, body: JSON.stringify({ email: `consent-date${i}-${tag}@example.com`, password: "Consent-Test-1", data: { terms_version: v } }) }),
      ]),
      ["admin API", fetch(`${url}/auth/v1/admin/users`, { method: "POST", headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ email: `consent-admin-${tag}@example.com`, password: "Consent-Test-1", email_confirm: true }) })],
    ];
    for (const [what, attempt] of attempts) {
      const res = await attempt;
      const body = await res.text();
      expect(res.status, `${what}: ${body}`).toBeGreaterThanOrEqual(400);
    }
    // no account was created for any of them
    const listed = await fetch(`${url}/auth/v1/admin/users?per_page=1000`, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
    const users = ((await listed.json()) as { users: Array<{ email: string }> }).users;
    expect(users.filter((u) => u.email.includes(tag))).toEqual([]);
  }, 30_000);

  it("ink_summary reports the starter; credit_summary keeps its old keys, consistent for ink", async () => {
    const s = await ink(ctx.a);
    expect(s).toMatchObject({ balance: 100, granted: 100, purchased: 0, refunded: 0, used: 0, starter: 100, purchases: 0, last_purchase: null });
    expect(Date.parse(String(s.starter_at))).toBeGreaterThan(Date.now() - DAY);
    const c = await summary(ctx.a);
    expect(c).toMatchObject({ plan_id: "free", monthly_credits: 0, used: 0, granted: 100, remaining: 100 });
  }, 30_000);

  it("ink_packs holds the three packs, as seeded", async () => {
    const res = await ctx.a.rest("GET", "ink_packs", { query: { select: "id,name,ink,price_cents,active", order: "sort.asc" } });
    expect(res.status).toBe(200);
    expect(rows(res)).toEqual([
      { id: "small", name: "Small", ink: 1000, price_cents: 500, active: true },
      { id: "medium", name: "Medium", ink: 5000, price_cents: 2000, active: true },
      { id: "large", name: "Large", ink: 14000, price_cents: 5000, active: true },
    ]);
    const plans = await ctx.a.rest("GET", "plans", { query: { select: "id", active: "eq.true" } });
    expect(rows(plans)).toEqual([{ id: "free" }]);
  }, 30_000);

  it("consume_credits takes ink off the balance and records a usage_event the owner can read", async () => {
    const before = await ink(ctx.a);
    const res = await consume(ctx.a, 3, "rls-billing/consume", { p_request_id: "req-1", p_model: "test-model" });
    expect(res.status).toBe(200);
    expect(res.body as Consume).toEqual({ ok: true, remaining: before.balance - 3, reason: null });

    const after = await ink(ctx.a);
    expect(after.used).toBe(before.used + 3);
    expect(after.balance).toBe(before.balance - 3);
    expect((await summary(ctx.a)).remaining).toBe(after.balance);

    const usage = await ctx.a.rest("GET", "usage_events", {
      query: { route: "eq.rls-billing/consume", select: "user_id,route,units,model,request_id" },
    });
    expect(rows(usage)).toEqual([
      { user_id: ctx.a.userId, route: "rls-billing/consume", units: 3, model: "test-model", request_id: "req-1" },
    ]);

    const other = await ctx.b.rest("GET", "usage_events", { query: { route: "eq.rls-billing/consume", select: "id" } });
    expect(rows(other)).toEqual([]);
    expect((await ink(ctx.b)).used).toBe(0);
  }, 30_000);

  it("rejects p_units outside 1..1000 and an empty route with 400, writing nothing", async () => {
    const before = await ink(ctx.a);
    for (const args of [{ p_route: "x", p_units: 0 }, { p_route: "x", p_units: 1001 }, { p_route: "x", p_units: -1 }, { p_route: "", p_units: 1 }]) {
      const res = await rpc(ctx.a, "consume_credits", args);
      expect(res.status, JSON.stringify({ args, body: res.body })).toBe(400);
    }
    expect((await ink(ctx.a)).used).toBe(before.used);
  }, 30_000);

  it("the balance is all-time: ink used or granted in another month counts like today's", async () => {
    const before = await ink(ctx.a);
    const lastMonth = new Date(Date.now() - 40 * DAY).toISOString();
    const used = await service.rest("POST", "usage_events", {
      body: { user_id: ctx.a.userId, route: "rls-billing/old", units: 50, created_at: lastMonth },
      prefer: "return=minimal",
    });
    expect(used.status, JSON.stringify(used.body)).toBe(201);
    const granted = await service.rest("POST", "ink_grants", {
      body: { user_id: ctx.a.userId, units: 20, kind: "manual", reason: "rls-billing old grant", created_at: lastMonth },
      prefer: "return=minimal",
    });
    expect(granted.status, JSON.stringify(granted.body)).toBe(201);
    const after = await ink(ctx.a);
    expect(after.balance).toBe(before.balance - 50 + 20);
    expect(after.used).toBe(before.used + 50);
    expect(after.granted).toBe(before.granted + 20);

    // The owner can read the grants but not add one.
    const forged = await ctx.a.rest("POST", "ink_grants", { body: { user_id: ctx.a.userId, units: 5, kind: "manual" }, prefer: "return=minimal" });
    expect(forged.status).toBe(403);
  }, 30_000);

  it("refuses a spend larger than the balance without writing, then allows a spend that fits", async () => {
    const before = await ink(ctx.a);
    const countBefore = rows(await ctx.a.rest("GET", "usage_events", { query: { select: "id" } })).length;

    const over = await consume(ctx.a, Math.min(1000, before.balance + 1), "rls-billing/over");
    expect(over.status).toBe(200);
    expect(over.body as Consume).toEqual({ ok: false, remaining: before.balance, reason: "insufficient_credits" });
    expect(rows(await ctx.a.rest("GET", "usage_events", { query: { select: "id" } })).length).toBe(countBefore);

    const fits = await consume(ctx.a, 1, "rls-billing/fits");
    expect((fits.body as Consume).ok).toBe(true);
    expect((await ink(ctx.a)).balance).toBe(before.balance - 1);
  }, 30_000);

  it("grant_ink adds ink; a negative correction stops at zero; nothing can take the balance below zero", async () => {
    const before = await ink(ctx.b);
    const up = await rpc(service, "grant_ink", { p_user_id: ctx.b.userId, p_units: 25, p_reason: "outage apology" });
    expect(up.body).toEqual({ granted: 25, balance: before.balance + 25 });
    const down = await rpc(service, "grant_ink", { p_user_id: ctx.b.userId, p_units: -1_000_000, p_reason: "correction" });
    expect(down.body).toEqual({ granted: -(before.balance + 25), balance: 0 });
    expect((await ink(ctx.b)).balance).toBe(0);

    // A raw ledger row that would go below zero is refused by the CHECK on profiles.ink_balance.
    const raw = await service.rest("POST", "ink_grants", { body: { user_id: ctx.b.userId, units: -1, kind: "manual" }, prefer: "return=minimal" });
    expect(raw.status, JSON.stringify(raw.body)).toBe(400);
    expect((raw.body as { code?: string }).code).toBe("23514");
    // ...and ledger rows never change once written: corrections are new rows.
    const edit = await service.rest("PATCH", "ink_grants", { query: { user_id: `eq.${ctx.b.userId}`, kind: "eq.starter" }, body: { units: 999 } });
    expect(edit.status, JSON.stringify(edit.body)).toBe(403);
    await setBalance(ctx.b, 300);
  }, 30_000);

  it("10 parallel 1-ink spends with 5 left succeed exactly 5 times", async () => {
    await setBalance(ctx.b, 5);
    const start = await ink(ctx.b);

    const results = await Promise.all(Array.from({ length: 10 }, () => consume(ctx.b, 1, "rls-billing/concurrency")));
    expect(results.map((r) => r.status)).toEqual(Array(10).fill(200));
    const bodies = results.map((r) => r.body as Consume);
    expect(bodies.filter((b) => b.ok).length).toBe(5);
    expect(bodies.filter((b) => !b.ok).every((b) => b.reason === "insufficient_credits" && b.remaining === 0)).toBe(true);
    expect(new Set(bodies.filter((b) => b.ok).map((b) => b.remaining))).toEqual(new Set([4, 3, 2, 1, 0]));

    const after = await ink(ctx.b);
    expect(after.balance).toBe(0);
    expect(after.used).toBe(start.used + 5);
    const written = await ctx.b.rest("GET", "usage_events", { query: { route: "eq.rls-billing/concurrency", select: "id" } });
    expect(rows(written).length).toBe(5);
    await setBalance(ctx.b, 300);
  }, 60_000);

  // ------------------------------------------------------------ purchases and refunds

  it("a purchase grants once per Checkout Session; refunds take back at most the unspent ink", async () => {
    await setBalance(ctx.b, 100);
    const tag = Date.now().toString(36);
    const args = { p_user_id: ctx.b.userId, p_pack_id: "medium", p_checkout_session_id: `cs_db_${tag}`, p_payment_intent_id: `pi_db_${tag}`, p_amount_cents: 2000, p_currency: "usd" };

    const first = await rpc(service, "grant_ink_purchase", args);
    expect(first.body).toMatchObject({ granted: 5000, duplicate: false, balance: 5100 });
    const replay = await rpc(service, "grant_ink_purchase", args);
    expect(replay.body).toMatchObject({ granted: 0, duplicate: true, balance: 5100 });
    const s1 = await ink(ctx.b);
    expect(s1).toMatchObject({ balance: 5100, purchased: 5000, purchases: 1, last_purchase: { pack_id: "medium", ink: 5000, status: "paid" } });

    // A quarter of the payment back: a quarter of the pack's ink (1,250) comes off.
    const reverse = (cum: number, full = false) =>
      rpc(service, "reverse_ink_purchase", { p_payment_intent_id: args.p_payment_intent_id, p_amount_refunded_cents: cum, p_charge_amount_cents: 2000, p_fully_refunded: full });
    expect((await reverse(500)).body).toMatchObject({ found: true, reversed: 1250, requested: 1250, balance: 3850, status: "partially_refunded" });
    expect((await reverse(500)).body).toMatchObject({ found: true, duplicate: true, reversed: 0 });

    // The student spends most of what is left; then the rest of the payment is refunded.
    await setBalance(ctx.b, 1000);
    const full = (await reverse(2000, true)).body as Record<string, unknown>;
    expect(full).toMatchObject({ reversed: 1000, requested: 3750, unrecovered: 2750, balance: 0, status: "refunded" });
    expect((await ink(ctx.b)).balance).toBe(0);

    const row = await ctx.b.rest("GET", "ink_purchases", { query: { checkout_session_id: `eq.${args.p_checkout_session_id}`, select: "status,refunded_cents,refunded_ink,refund_unrecovered_ink" } });
    expect(rows(row)).toEqual([{ status: "refunded", refunded_cents: 2000, refunded_ink: 2250, refund_unrecovered_ink: 2750 }]);
    const grants = await ctx.b.rest("GET", "ink_grants", { query: { kind: "eq.refund", select: "units", order: "id.asc" } });
    expect(rows(grants).map((g) => g.units)).toEqual([-1250, -1000]);

    // Unknown payments: not found, nothing written (the webhook decides whether to wait for a grant).
    expect((await rpc(service, "reverse_ink_purchase", { p_payment_intent_id: `pi_nobody_${tag}`, p_amount_refunded_cents: 1 })).body).toEqual({ found: false, reversed: 0 });
    await setBalance(ctx.b, 300);
  }, 60_000);

  it("the money has to cover the pack: anything else waits in ink_checkout_reviews with no ink", async () => {
    await setBalance(ctx.b, 300);
    const before = await ink(ctx.b);
    const tag = Date.now().toString(36);
    const base = { p_user_id: ctx.b.userId, p_pack_id: "small", p_currency: "usd", p_customer_email: "payer@example.com" };
    const cases: Array<[string, Record<string, unknown>, RegExp]> = [
      ["underpaid", { p_amount_cents: 499 }, /paid 499 cents for the small pack, priced 500 cents/],
      ["free", { p_amount_cents: 0 }, /paid 0 cents/],
      ["unpriced", { p_amount_cents: null }, /no amount/],
      ["euro", { p_amount_cents: 500, p_currency: "eur" }, /paid in eur/],
      ["unknown-pack", { p_amount_cents: 500, p_pack_id: "huge" }, /unknown pack huge/],
      ["no-account", { p_amount_cents: 500, p_user_id: "00000000-0000-4000-8000-000000000000" }, /no account/],
    ];
    for (const [name, extra, reason] of cases) {
      const res = await rpc(service, "grant_ink_purchase", { ...base, ...extra, p_checkout_session_id: `cs_db_review_${name}_${tag}`, p_payment_intent_id: `pi_db_review_${name}_${tag}` });
      expect(res.status, `${name}: ${JSON.stringify(res.body)}`).toBe(200);
      expect(res.body, name).toMatchObject({ granted: 0, duplicate: false, review: true });
      expect(String((res.body as { reason?: string }).reason), name).toMatch(reason);
    }
    const after = await ink(ctx.b);
    expect(after).toMatchObject({ balance: 300, purchased: before.purchased, purchases: before.purchases });
    expect(rows(await ctx.b.rest("GET", "ink_purchases", { query: { checkout_session_id: `like.cs_db_review_*_${tag}`, select: "id" } }))).toEqual([]);

    // The owner's queue (service role): one open row per session, with what is needed to resolve it.
    const queue = await service.rest("GET", "ink_checkout_reviews", {
      query: { checkout_session_id: `like.cs_db_review_*_${tag}`, select: "id,checkout_session_id,status,user_id,pack_id,amount_cents,currency,customer_email", order: "id.asc" },
    });
    expect(queue.status).toBe(200);
    expect(rows(queue).map((r) => [r.checkout_session_id.split("_")[3], r.status, r.user_id, r.amount_cents, r.currency])).toEqual([
      ["underpaid", "open", ctx.b.userId, 499, "usd"],
      ["free", "open", ctx.b.userId, 0, "usd"],
      ["unpriced", "open", ctx.b.userId, null, "usd"],
      ["euro", "open", ctx.b.userId, 500, "eur"],
      ["unknown-pack", "open", ctx.b.userId, 500, "usd"],
      ["no-account", "open", null, 500, "usd"],
    ]);
    expect(rows(queue)[0].customer_email).toBe("payer@example.com");

    // A redelivery of a reviewed session is a duplicate, still with no ink.
    const again = await rpc(service, "grant_ink_purchase", { ...base, p_amount_cents: 499, p_checkout_session_id: `cs_db_review_underpaid_${tag}` });
    expect(again.body).toMatchObject({ granted: 0, duplicate: true, review: true });
    // Refunding a reviewed checkout takes no ink and closes the review.
    const refund = await rpc(service, "reverse_ink_purchase", { p_payment_intent_id: `pi_db_review_underpaid_${tag}`, p_amount_refunded_cents: 499, p_charge_amount_cents: 499, p_fully_refunded: true });
    expect(refund.body).toMatchObject({ found: true, review: true, reversed: 0 });
    const closed = await service.rest("GET", "ink_checkout_reviews", { query: { checkout_session_id: `eq.cs_db_review_underpaid_${tag}`, select: "status,resolved_at" } });
    expect(rows(closed)[0].status).toBe("refunded");
    expect(rows(closed)[0].resolved_at).toBeTruthy();
    expect((await ink(ctx.b)).balance).toBe(300);

    // The owner resolves one: it becomes a real purchase (a later refund finds it), once.
    const reviewId = (name: string) => rows(queue).find((r) => r.checkout_session_id === `cs_db_review_${name}_${tag}`)?.id;
    const resolved = await rpc(service, "resolve_ink_checkout_review", { p_review_id: reviewId("unknown-pack"), p_pack_id: "small", p_note: "meant the Small pack" });
    expect(resolved.status, JSON.stringify(resolved.body)).toBe(200);
    expect(resolved.body).toMatchObject({ granted: 1000, user_id: ctx.b.userId, balance: 1300 });
    const bought = await ctx.b.rest("GET", "ink_purchases", { query: { checkout_session_id: `eq.cs_db_review_unknown-pack_${tag}`, select: "pack_id,ink,amount_cents,status" } });
    expect(rows(bought)).toEqual([{ pack_id: "small", ink: 1000, amount_cents: 500, status: "paid" }]);
    expect((await rpc(service, "resolve_ink_checkout_review", { p_review_id: reviewId("unknown-pack") })).status).toBe(400);
    expect((await rpc(service, "resolve_ink_checkout_review", { p_review_id: reviewId("no-account") })).status).toBe(400); // names nobody
    expect((await rpc(ctx.b, "resolve_ink_checkout_review", { p_review_id: reviewId("free") })).status).toBe(403);
    // ...and refunding it takes the ink back like any purchase.
    const back = await rpc(service, "reverse_ink_purchase", { p_payment_intent_id: `pi_db_review_unknown-pack_${tag}`, p_amount_refunded_cents: 500, p_charge_amount_cents: 500, p_fully_refunded: true });
    expect(back.body).toMatchObject({ found: true, reversed: 1000, balance: 300, status: "refunded" });

    // The webhook's own path for a checkout it cannot map at all (no user): idempotent.
    const manual = { p_checkout_session_id: `cs_db_review_noref_${tag}`, p_reason: "no client_reference_id", p_pack_id: "small", p_amount_cents: 500, p_currency: "usd" };
    expect((await rpc(service, "record_ink_checkout_review", manual)).body).toMatchObject({ recorded: true, duplicate: false });
    expect((await rpc(service, "record_ink_checkout_review", manual)).body).toMatchObject({ recorded: false, duplicate: true });

    // Users see none of it, and cannot add to it.
    expect((await ctx.b.rest("GET", "ink_checkout_reviews", { query: { select: "id" } })).status).toBe(403);
    expect((await rpc(ctx.b, "record_ink_checkout_review", manual)).status).toBe(403);

    // Review rows outlive the throwaway users; remove this test's own.
    const cleared = await service.rest("DELETE", "ink_checkout_reviews", { query: { checkout_session_id: `like.cs_db_review_*_${tag}` }, prefer: "return=representation" });
    expect(rows(cleared).length).toBe(7);
  }, 60_000);

  it("ledgers are append-only even for the service role: no usage row, grant, purchase or profile can be deleted", async () => {
    await setBalance(ctx.a, 300);
    expect(((await consume(ctx.a, 2, "rls-billing/guard", { p_request_id: "req-guard" })).body as Consume).ok).toBe(true);
    const tag = Date.now().toString(36);
    const bought = await rpc(service, "grant_ink_purchase", { p_user_id: ctx.a.userId, p_pack_id: "small", p_checkout_session_id: `cs_db_guard_${tag}`, p_amount_cents: 500, p_currency: "usd" });
    expect((bought.body as { granted: number }).granted).toBe(1000);
    const before = await ink(ctx.a);

    for (const [table, query] of [
      ["usage_events", { user_id: `eq.${ctx.a.userId}`, request_id: "eq.req-guard" }],
      ["ink_grants", { user_id: `eq.${ctx.a.userId}`, kind: "eq.starter" }],
      ["ink_grants", { user_id: `eq.${ctx.a.userId}`, kind: "eq.purchase" }],
      ["ink_purchases", { checkout_session_id: `eq.cs_db_guard_${tag}` }],
      ["profiles", { user_id: `eq.${ctx.a.userId}` }],
    ] as const) {
      const del = await service.rest("DELETE", table, { query, prefer: "return=representation" });
      expect(del.status, `${table}: ${JSON.stringify(del.body)}`).toBe(403);
      expect((del.body as { code?: string }).code, table).toBe("42501");
    }
    expect(await ink(ctx.a)).toEqual(before);
    expect(rows(await ctx.a.rest("GET", "usage_events", { query: { request_id: "eq.req-guard", select: "units" } }))).toEqual([{ units: 2 }]);
    await setBalance(ctx.a, 300);
  }, 60_000);

  // ------------------------------------------------------------ refunds of failed calls

  it("a user cannot refund anything: refund_credits and refund_ink_for are denied, the charge stays", async () => {
    const before = await summary(ctx.a);
    expect(((await consume(ctx.a, 4, "rls-billing/refund", { p_request_id: "req-refund-self" })).body as Consume).ok).toBe(true);

    const self = await rpc(ctx.a, "refund_credits", { p_request_id: "req-refund-self" });
    expect(self.status, JSON.stringify(self.body)).toBe(403);
    expect((self.body as { code?: string }).code).toBe("42501");
    const direct = await rpc(ctx.a, "refund_ink_for", { p_user_id: ctx.a.userId, p_request_id: "req-refund-self" });
    expect(direct.status, JSON.stringify(direct.body)).toBe(403);
    expect((await rpc(ctx.anon, "refund_credits", { p_request_id: "req-refund-self" })).status).toBe(401);
    expect((await rpc(ctx.anon, "refund_ink_for", { p_user_id: ctx.a.userId, p_request_id: "req-refund-self" })).status).toBe(401);

    expect((await summary(ctx.a)).remaining).toBe(before.remaining - 4);
    expect(rows(await ctx.a.rest("GET", "usage_events", { query: { request_id: "eq.req-refund-self", select: "units" } }))).toEqual([{ units: 4 }]);
  }, 30_000);

  it("refund_ink_for (service role) restores the user's balance, deletes the usage row, and is idempotent", async () => {
    const before = await summary(ctx.a);
    const spend = await consume(ctx.a, 7, "rls-billing/refund", { p_request_id: "req-refund-own" });
    expect((spend.body as Consume).ok).toBe(true);
    expect((await summary(ctx.a)).remaining).toBe(before.remaining - 7);

    const refund = await rpc(service, "refund_ink_for", { p_user_id: ctx.a.userId, p_request_id: "req-refund-own" });
    expect(refund.status, JSON.stringify(refund.body)).toBe(200);
    expect(refund.body as Refund).toEqual({ refunded: 7, remaining: before.remaining });

    const after = await summary(ctx.a);
    expect(after.used).toBe(before.used);
    expect(after.remaining).toBe(before.remaining);
    expect(rows(await ctx.a.rest("GET", "usage_events", { query: { request_id: "eq.req-refund-own", select: "id" } }))).toEqual([]);

    const again = await rpc(service, "refund_ink_for", { p_user_id: ctx.a.userId, p_request_id: "req-refund-own" });
    expect(again.body as Refund).toEqual({ refunded: 0, remaining: before.remaining });
    const unknown = await rpc(service, "refund_ink_for", { p_user_id: ctx.a.userId, p_request_id: "req-never-existed" });
    expect(unknown.body as Refund).toEqual({ refunded: 0, remaining: before.remaining });
  }, 30_000);

  it("refund_ink_for naming another user with A's request id refunds 0 and touches nothing", async () => {
    const aBefore = await summary(ctx.a);
    const bBefore = await summary(ctx.b);
    expect(((await consume(ctx.a, 2, "rls-billing/refund-foreign", { p_request_id: "req-refund-foreign" })).body as Consume).ok).toBe(true);

    const foreign = await rpc(service, "refund_ink_for", { p_user_id: ctx.b.userId, p_request_id: "req-refund-foreign" });
    expect(foreign.status).toBe(200);
    expect(foreign.body as Refund).toEqual({ refunded: 0, remaining: bBefore.remaining });

    const still = await ctx.a.rest("GET", "usage_events", { query: { request_id: "eq.req-refund-foreign", select: "user_id,units" } });
    expect(rows(still)).toEqual([{ user_id: ctx.a.userId, units: 2 }]);
    expect((await summary(ctx.a)).remaining).toBe(aBefore.remaining - 2);
    expect((await summary(ctx.b)).remaining).toBe(bBefore.remaining);
  }, 30_000);

  it("refund_ink_for ignores rows older than 15 minutes but still honours a 14-minute-old one", async () => {
    const stale = new Date(Date.now() - 16 * 60_000).toISOString();
    const fresh = new Date(Date.now() - 14 * 60_000).toISOString();
    // Planted with the service role: nothing reachable with a user token can back-date a ledger row.
    for (const body of [
      { user_id: ctx.a.userId, route: "rls-billing/refund-stale", units: 9, request_id: "req-refund-stale", created_at: stale },
      { user_id: ctx.a.userId, route: "rls-billing/refund-fresh", units: 5, request_id: "req-refund-fresh", created_at: fresh },
    ]) {
      const res = await service.rest("POST", "usage_events", { body, prefer: "return=minimal" });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    }
    const before = await summary(ctx.a);

    const tooOld = await rpc(service, "refund_ink_for", { p_user_id: ctx.a.userId, p_request_id: "req-refund-stale" });
    expect(tooOld.body as Refund).toEqual({ refunded: 0, remaining: before.remaining });
    expect(rows(await service.rest("GET", "usage_events", { query: { request_id: "eq.req-refund-stale", select: "units" } }))).toEqual([{ units: 9 }]);

    const inWindow = await rpc(service, "refund_ink_for", { p_user_id: ctx.a.userId, p_request_id: "req-refund-fresh" });
    expect(inWindow.body as Refund).toEqual({ refunded: 5, remaining: before.remaining + 5 });
    expect(rows(await service.rest("GET", "usage_events", { query: { request_id: "eq.req-refund-fresh", select: "units" } }))).toEqual([]);
  }, 30_000);

  it("refund_ink_for rejects an empty or oversized request id and a missing user (400)", async () => {
    for (const args of [
      { p_user_id: ctx.a.userId, p_request_id: "" },
      { p_user_id: ctx.a.userId, p_request_id: "x".repeat(101) },
      { p_user_id: null, p_request_id: "req-x" },
    ]) {
      expect((await rpc(service, "refund_ink_for", args)).status, JSON.stringify(args)).toBe(400);
    }
  }, 30_000);

  // ------------------------------------------------------------ rate_limit_hit

  it("rate_limit_hit allows p_limit hits per window, then denies with a retry hint; counters are per user", async () => {
    const bucket = `rls-billing-${Date.now().toString(36)}`;
    const results: RateLimit[] = [];
    for (let i = 0; i < 3; i++) results.push(await hit(ctx.a, bucket, 3, 60_000));
    expect(results).toEqual([
      { allowed: true, remaining: 2, retry_after_ms: 0, backend: "db" },
      { allowed: true, remaining: 1, retry_after_ms: 0, backend: "db" },
      { allowed: true, remaining: 0, retry_after_ms: 0, backend: "db" },
    ]);
    const denied = await hit(ctx.a, bucket, 3, 60_000);
    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(0);
    expect(denied.retry_after_ms).toBeGreaterThan(0);
    expect(denied.retry_after_ms).toBeLessThanOrEqual(60_000);

    // B is unaffected by A's exhausted counter; A's other bucket is unaffected too.
    expect(await hit(ctx.b, bucket, 3, 60_000)).toEqual({ allowed: true, remaining: 2, retry_after_ms: 0, backend: "db" });
    expect((await hit(ctx.a, `${bucket}-other`, 1, 60_000)).allowed).toBe(true);

    // The table is function-only for users; the service role sees the counter (4 hits: 3 allowed + 1 denied).
    const asUser = await ctx.a.rest("GET", "rate_limit_counters", { query: { select: "hits" } });
    expect(asUser.status).toBe(403);
    expect((await ctx.a.rest("POST", "rate_limit_counters", { body: { user_id: ctx.a.userId, bucket, window_start: new Date().toISOString(), hits: 0, expires_at: new Date().toISOString() } })).status).toBe(403);
    const asService = await service.rest("GET", "rate_limit_counters", { query: { user_id: `eq.${ctx.a.userId}`, bucket: `eq.${bucket}`, select: "hits" } });
    expect(asService.status).toBe(200);
    expect(rows(asService)).toEqual([{ hits: 4 }]);

    for (const args of [{ p_bucket: "", p_limit: 1, p_window_ms: 1000 }, { p_bucket: "x", p_limit: 0, p_window_ms: 1000 }, { p_bucket: "x", p_limit: 1, p_window_ms: 0 }]) {
      expect((await rpc(ctx.a, "rate_limit_hit", args)).status, JSON.stringify(args)).toBe(400);
    }
    expect((await rpc(ctx.anon, "rate_limit_hit", { p_bucket: bucket, p_limit: 3, p_window_ms: 60_000 })).status).toBe(401);
  }, 30_000);

  it("rate_limit_hit rolls over after the window and cleans up expired counters", async () => {
    const bucket = `rls-billing-roll-${Date.now().toString(36)}`;
    const windowMs = 1000;
    // The first hit may land right before an epoch-aligned boundary, so hit until denied (at most 2 windows' worth).
    let denied: RateLimit | null = null;
    for (let i = 0; i < 6 && !denied; i++) {
      const r = await hit(ctx.a, bucket, 2, windowMs);
      if (!r.allowed) denied = r;
    }
    expect(denied, "never denied within 6 hits at limit 2").not.toBeNull();
    expect(denied!.retry_after_ms).toBeGreaterThan(0);
    expect(denied!.retry_after_ms).toBeLessThanOrEqual(windowMs);

    await sleep(denied!.retry_after_ms + 150);
    const fresh = await hit(ctx.a, bucket, 2, windowMs);
    expect(fresh).toEqual({ allowed: true, remaining: 1, retry_after_ms: 0, backend: "db" });

    // Rows expire two windows after their start; the next call for this bucket removes them.
    await sleep(2 * windowMs + 200);
    expect((await hit(ctx.a, bucket, 2, windowMs)).allowed).toBe(true);
    const left = await service.rest("GET", "rate_limit_counters", { query: { user_id: `eq.${ctx.a.userId}`, bucket: `eq.${bucket}`, select: "hits,window_start,expires_at" } });
    expect(left.status).toBe(200);
    expect(rows(left).length).toBe(1);
    expect(rows(left)[0].hits).toBe(1);
    expect(Date.parse(rows(left)[0].expires_at) - Date.parse(rows(left)[0].window_start)).toBe(2 * windowMs);
  }, 30_000);

  it("20 parallel hits with limit 10 allow exactly 10", async () => {
    const bucket = `rls-billing-par-${Date.now().toString(36)}`;
    const results = await Promise.all(Array.from({ length: 20 }, () => hit(ctx.b, bucket, 10, 60_000)));
    const allowed = results.filter((r) => r.allowed);
    const refused = results.filter((r) => !r.allowed);
    expect(allowed.length).toBe(10);
    expect(new Set(allowed.map((r) => r.remaining))).toEqual(new Set([9, 8, 7, 6, 5, 4, 3, 2, 1, 0]));
    expect(refused.every((r) => r.remaining === 0 && r.retry_after_ms > 0 && r.retry_after_ms <= 60_000)).toBe(true);
    const counter = await service.rest("GET", "rate_limit_counters", { query: { user_id: `eq.${ctx.b.userId}`, bucket: `eq.${bucket}`, select: "hits" } });
    expect(rows(counter)).toEqual([{ hits: 20 }]);
  }, 60_000);

  it("Agathon Unlimited: no ink spent, the fair-use cap answers fair_use with a retry hint, a failed call's count comes back", async () => {
    if (!ctx.newUser) throw new Error("bootstrapVerifyContext did not provide newUser()");
    const c = await ctx.newUser();
    const uid = c.userId as string;
    const sub = `sub_db_unlimited_${uid}`;
    const week = new Date(Date.now() + 7 * DAY).toISOString();
    // the checkout first this time (the other order is in scripts/lib/rlsChecks.mjs checkUnlimited),
    // naming the account by its checkout ref, which the account itself reads
    const ref = rows(await c.rest("GET", "profiles", { query: { select: "checkout_ref" } }))[0]?.checkout_ref as string;
    expect(ref).toMatch(/^[0-9a-f-]{36}$/);
    const linked = await rpc(service, "link_unlimited_checkout", {
      p_subscription_id: sub, p_checkout_ref: ref, p_customer_id: "cus_db", p_checkout_session_id: `cs_db_${uid}`, p_payer_email: "grown.up@example.com",
    });
    expect(linked.body).toMatchObject({ linked: true, status: null, unlimited: false });
    const pending = (await rpc(c, "ink_summary")).body as { unlimited: { status: string | null; unlimited: boolean } };
    expect(pending.unlimited).toMatchObject({ status: null, unlimited: false });
    const applied = await rpc(service, "apply_unlimited_subscription", {
      p_subscription_id: sub, p_customer_id: "cus_db", p_status: "trialing", p_trial_end: week, p_current_period_end: week, p_event_at: new Date().toISOString(),
    });
    expect(applied.body).toMatchObject({ applied: true, user_id: uid, status: "trialing", unlimited: true });

    const before = await ink(c);
    const free = await consume(c, 10, "live/solve", { p_request_id: "db-unlimited-1" });
    expect(free.body).toEqual({ ok: true, remaining: before.balance, reason: null, unlimited: true });
    expect((await ink(c)).balance).toBe(before.balance);

    // fill the rolling window to one under the cap (1,500), the oldest 23 hours ago
    const cap = 1500;
    const oldest = Date.now() - 23 * 60 * 60_000;
    const filler = Array.from({ length: cap - 2 }, (_, i) => ({ user_id: uid, route: "live/recognize", units: 1, created_at: new Date(oldest + i * 1000).toISOString() }));
    const filled = await service.rest("POST", "unlimited_usage", { body: filler, prefer: "return=minimal" });
    expect(filled.status, JSON.stringify(filled.body)).toBe(201);

    const last = await consume(c, 3, "live/check", { p_request_id: "db-unlimited-2" });
    expect(last.body).toMatchObject({ ok: true, unlimited: true });
    const over = await consume(c, 3, "live/check", { p_request_id: "db-unlimited-3" });
    const refusal = over.body as { ok: boolean; reason: string; retry_after_ms: number; remaining: number };
    expect(refusal).toMatchObject({ ok: false, reason: "fair_use", unlimited: true, remaining: before.balance });
    // a slot frees when the oldest action turns 24 hours old: in about an hour
    expect(refusal.retry_after_ms).toBeGreaterThan(55 * 60_000);
    expect(refusal.retry_after_ms).toBeLessThanOrEqual(60 * 60_000 + 5_000);
    // a repeat of a recorded request id is still free (a lecture minute's later ticks)
    expect(((await consume(c, 2, "live/lecture", { p_request_id: "db-unlimited-2" })).body as Consume).ok).toBe(true);

    // the failed call is refunded: no ink comes back (none was spent), its count does
    const refund = await rpc(service, "refund_ink_for", { p_user_id: uid, p_request_id: "db-unlimited-2" });
    expect(refund.body).toEqual({ refunded: 0, remaining: before.balance });
    expect(((await consume(c, 3, "live/check", { p_request_id: "db-unlimited-4" })).body as Consume).ok).toBe(true);
    expect((await ink(c)).balance).toBe(before.balance);
    // and the ink ledger never saw any of it
    expect(rows(await c.rest("GET", "usage_events", { query: { select: "id" } }))).toEqual([]);

    // the plan ends: deletion was refused while it would charge, then the account goes and the row stays, unlinked
    const refused = await rpc(c, "delete_own_account");
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({ code: "P0001", hint: "unlimited_active" });
    await rpc(service, "apply_unlimited_subscription", {
      p_subscription_id: sub, p_customer_id: "cus_db", p_status: "canceled", p_ended_at: new Date().toISOString(), p_event_at: new Date(Date.now() + 1000).toISOString(),
    });
    expect(rows(await service.rest("GET", "unlimited_subscriptions", { query: { stripe_subscription_id: `eq.${sub}`, select: "payer_email" } }))).toEqual([{ payer_email: "grown.up@example.com" }]);
    expect((await rpc(c, "delete_own_account")).status).toBeLessThan(300);
    // the row kept for the owner names nobody: no user, and no payer email either
    expect(rows(await service.rest("GET", "unlimited_subscriptions", { query: { stripe_subscription_id: `eq.${sub}`, select: "user_id,status,payer_email" } }))).toEqual([
      { user_id: null, status: "canceled", payer_email: null },
    ]);
    expect(rows(await service.rest("GET", "unlimited_usage", { query: { user_id: `eq.${uid}`, select: "id" } }))).toEqual([]);
    await service.rest("DELETE", "unlimited_subscriptions", { query: { stripe_subscription_id: `eq.${sub}` } });
  }, 60_000);

  it("go-live gaps: a user id links nobody, one free week per account, Stripe payloads purged after 90 days", async () => {
    if (!ctx.newUser) throw new Error("bootstrapVerifyContext did not provide newUser()");
    const c = await ctx.newUser();
    const uid = c.userId as string;
    const ref = rows(await c.rest("GET", "profiles", { query: { select: "checkout_ref" } }))[0]?.checkout_ref as string;
    const week = new Date(Date.now() + 7 * DAY).toISOString();
    const subs = [`sub_db_gaps_${uid}_0`, `sub_db_gaps_${uid}_1`, `sub_db_gaps_${uid}_2`];
    const apply = (sub: string, status: string, at: number, extra: Record<string, unknown> = {}) =>
      rpc(service, "apply_unlimited_subscription", { p_subscription_id: sub, p_customer_id: "cus_db", p_status: status, p_trial_end: week, p_current_period_end: week, p_event_at: new Date(at).toISOString(), ...extra });
    const plan = async () => ((await rpc(c, "ink_summary")).body as { unlimited: Record<string, unknown> }).unlimited;

    // the user id as the reference (what an attacker who knows it would send): nobody's plan
    const byId = await rpc(service, "link_unlimited_checkout", { p_subscription_id: subs[0], p_checkout_ref: uid });
    expect(byId.body).toMatchObject({ linked: false, user_id: null, no_account: true });
    await apply(subs[0], "trialing", Date.now());
    expect(await plan()).toMatchObject({ status: "none", unlimited: false, checkout_ref: ref });

    // the first plan's free week is Unlimited
    await rpc(service, "link_unlimited_checkout", { p_subscription_id: subs[1], p_checkout_ref: ref });
    await apply(subs[1], "trialing", Date.now());
    expect(await plan()).toMatchObject({ status: "trialing", unlimited: true, repeat_trial: false });
    // cancelled, then a second checkout: its free week grants nothing, help spends ink
    await apply(subs[1], "canceled", Date.now() + 1000, { p_ended_at: new Date().toISOString() });
    await rpc(service, "link_unlimited_checkout", { p_subscription_id: subs[2], p_checkout_ref: ref });
    await apply(subs[2], "trialing", Date.now() + 2000);
    expect(await plan()).toMatchObject({ status: "trialing", unlimited: false, repeat_trial: true });
    const spent = (await consume(c, 2, "live/check", { p_request_id: "db-gaps-repeat" })).body as Consume & { unlimited?: boolean };
    expect(spent).toMatchObject({ ok: true });
    expect(spent.unlimited).toBeUndefined();
    // paid: Unlimited like anyone's
    await apply(subs[2], "active", Date.now() + 3000, { p_trial_end: null, p_current_period_end: new Date(Date.now() + 30 * DAY).toISOString() });
    expect(await plan()).toMatchObject({ status: "active", unlimited: true, repeat_trial: false });
    await apply(subs[2], "canceled", Date.now() + 4000, { p_ended_at: new Date().toISOString() });

    // payloads: older than 90 days blanked, the row kept; newer kept whole; users cannot call it
    const ids = [`evt_db_gaps_${uid}_old`, `evt_db_gaps_${uid}_new`];
    const inserted = await service.rest("POST", "billing_events", {
      body: [
        { id: ids[0], type: "test", payload: { email: "a@example.com" }, received_at: new Date(Date.now() - 91 * DAY).toISOString() },
        { id: ids[1], type: "test", payload: { email: "a@example.com" }, received_at: new Date(Date.now() - 89 * DAY).toISOString() },
      ],
      prefer: "return=minimal",
    });
    expect(inserted.status, JSON.stringify(inserted.body)).toBe(201);
    expect((await rpc(c, "purge_billing_event_payloads")).status).toBeGreaterThanOrEqual(400);
    const purged = await rpc(service, "purge_billing_event_payloads");
    expect(purged.status).toBe(200);
    expect(purged.body).toBeGreaterThanOrEqual(1);
    const left = rows(await service.rest("GET", "billing_events", { query: { id: `in.(${ids.join(",")})`, select: "id,payload", order: "id" } }));
    // (ordered by id: "_new" before "_old")
    expect(left).toEqual([
      { id: ids[1], payload: { email: "a@example.com" } },
      { id: ids[0], payload: null },
    ]);
    await service.rest("DELETE", "billing_events", { query: { id: `in.(${ids.join(",")})` } });
    await service.rest("DELETE", "unlimited_subscriptions", { query: { stripe_subscription_id: `in.(${subs.join(",")})` } });
  }, 60_000);

  it("delete_own_account takes the account's bug reports with it, email included", async () => {
    if (!ctx.newUser) throw new Error("bootstrapVerifyContext did not provide newUser()");
    const c = await ctx.newUser();
    const uid = c.userId as string;
    const email = `${uid}@example.com`;
    // what BugReportButton sends: the account's email, a message, a screenshot and logs (all personal)
    const report = await c.rest("POST", "bug_reports", {
      body: { user_id: uid, user_email: email, board_id: "b1", message: "my board froze", screenshot: "data:image/png;base64,AAAA", logs: [{ level: "info", args: ["x"] }] },
      prefer: "return=minimal",
    });
    expect(report.status, JSON.stringify(report.body)).toBe(201);
    expect(rows(await service.rest("GET", "bug_reports", { query: { user_id: `eq.${uid}`, select: "user_email" } }))).toEqual([{ user_email: email }]);

    const del = await rpc(c, "delete_own_account");
    expect(del.status, JSON.stringify(del.body)).toBeLessThan(300);

    // service role (RLS bypassed): nothing left, by account or by email (20261003010100)
    expect(rows(await service.rest("GET", "bug_reports", { query: { user_id: `eq.${uid}`, select: "id" } }))).toEqual([]);
    expect(rows(await service.rest("GET", "bug_reports", { query: { user_email: `eq.${email}`, select: "id" } }))).toEqual([]);
  }, 60_000);

  it("delete_own_account removes the auth user, profile, boards, ledger and storage rows", async () => {
    if (!ctx.newUser) throw new Error("bootstrapVerifyContext did not provide newUser()");
    const c = await ctx.newUser();
    const uid = c.userId as string;

    const board = rows(await c.rest("POST", "whiteboards", { body: { title: "rls-billing delete", data: {}, user_id: uid }, prefer: "return=representation" }))[0];
    expect(board?.id).toBeTruthy();
    const path = `${uid}/${board.id}/asset.png`;
    expect((await c.upload(ASSETS_BUCKET, path, TINY_PNG, "image/png")).status).toBe(200);
    expect(((await consume(c, 1, "rls-billing/delete")).body as Consume).ok).toBe(true);
    const bought = await rpc(service, "grant_ink_purchase", { p_user_id: uid, p_pack_id: "small", p_checkout_session_id: `cs_db_delete_${uid}`, p_amount_cents: 500, p_currency: "usd" });
    expect((bought.body as { granted: number }).granted).toBe(1000);
    const underpaid = await rpc(service, "grant_ink_purchase", { p_user_id: uid, p_pack_id: "small", p_checkout_session_id: `cs_db_delete_low_${uid}`, p_amount_cents: 100, p_currency: "usd" });
    expect(underpaid.body).toMatchObject({ granted: 0, review: true });
    expect((await ctx.anon.publicRead(ASSETS_BUCKET, path)).status).toBe(200);

    const del = await rpc(c, "delete_own_account");
    expect(del.status, JSON.stringify(del.body)).toBeLessThan(300);

    // auth.users row is gone (GoTrue admin API).
    const admin = await fetch(`${url}/auth/v1/admin/users/${uid}`, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
    await admin.arrayBuffer();
    expect(admin.status).toBe(404);

    // Cascades, seen with the service role (RLS bypassed, so [] means really gone).
    for (const [table, column] of [
      ["profiles", "user_id"],
      ["whiteboards", "user_id"],
      ["usage_events", "user_id"],
      ["ink_grants", "user_id"],
      ["ink_purchases", "user_id"],
      ["board_assets", "user_id"],
      ["user_settings", "user_id"],
    ]) {
      const res = await service.rest("GET", table, { query: { [column]: `eq.${uid}`, select: column } });
      expect(res.status, table).toBe(200);
      expect(rows(res), table).toEqual([]);
    }
    // A checkout waiting for review outlives the account (the owner may still owe a refund), unlinked.
    const review = await service.rest("GET", "ink_checkout_reviews", { query: { checkout_session_id: `eq.cs_db_delete_low_${uid}`, select: "user_id,status" } });
    expect(rows(review)).toEqual([{ user_id: null, status: "open" }]);
    await service.rest("DELETE", "ink_checkout_reviews", { query: { checkout_session_id: `eq.cs_db_delete_low_${uid}` } });

    // The still signature-valid JWT can no longer spend or see anything.
    const spend = await consume(c, 1, "rls-billing/after-delete");
    expect(spend.status).toBe(403);
    expect(rows(await c.rest("GET", "profiles", { query: { select: "user_id" } }))).toEqual([]);

    // Storage is NOT cascaded (storage.protect_delete forbids direct row deletes because the bytes
    // would be orphaned). The object is still served until it is garbage-collected through the
    // Storage API - which is the documented operator path (runbook, "Accounts & billing"):
    expect((await ctx.anon.publicRead(ASSETS_BUCKET, path)).status).toBe(200);
    const svcHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
    const listed = await fetch(`${url}/storage/v1/object/list/${ASSETS_BUCKET}`, {
      method: "POST",
      headers: svcHeaders,
      body: JSON.stringify({ prefix: `${uid}/${board.id}`, limit: 100 }),
    });
    const listedBody = (await listed.json()) as Array<{ name: string }>;
    expect(listed.status).toBe(200);
    expect(listedBody.map((o) => o.name)).toEqual(["asset.png"]);
    const gc = await fetch(`${url}/storage/v1/object/${ASSETS_BUCKET}`, {
      method: "DELETE",
      headers: svcHeaders,
      body: JSON.stringify({ prefixes: [path] }),
    });
    await gc.arrayBuffer();
    expect(gc.status).toBe(200);
    expect((await ctx.anon.publicRead(ASSETS_BUCKET, path)).status).not.toBe(200);
  }, 60_000);
});
