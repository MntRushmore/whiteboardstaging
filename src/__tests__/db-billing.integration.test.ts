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
 *   - sign-up: a 'free' profile and the 300-ink starter (once), ink_balance = the ledger
 *   - ink_summary(): shape, starter; credit_summary() keeps its old keys, consistent for ink
 *   - consume_credits(): decrement + usage row, argument validation, refusal without writes
 *   - the balance is all-time: a usage row or a grant from another month counts like today's
 *   - grant_ink(): a manual grant; a negative correction stops at zero; the CHECK refuses a
 *     ledger row that would take the balance below zero; ledger rows are append-only
 *   - concurrency: 10 parallel 1-ink spends with 5 left -> exactly 5 succeed, balance 0
 *   - purchases: once per Checkout Session; refunds (partial, full, replayed) take back at most
 *     the unspent ink and record what was taken back and what was already spent
 *   - ink_packs: the catalogue as seeded
 *   - delete_own_account(): auth.users row, profile, boards, ledgers, purchases, storage rows
 *
 * Covered (migration 20260917030000_refunds_ratelimit.sql):
 *   - refund_credits(): own recent request restored + row deleted, idempotent,
 *     another user's request id and rows older than 15 minutes refund nothing
 *   - rate_limit_hit(): p_limit hits then denial with a retry hint, independent
 *     per user, window rollover (1 s window), expired-row cleanup, 20 parallel
 *     hits with limit 10 -> exactly 10 allowed, table unreadable by users
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ASSETS_BUCKET, TINY_PNG, isCreditSummary, isInkSummary, isRateLimitResult, rows, rpc } from "../../scripts/lib/rlsChecks.mjs";
import type { CheckContext, RlsClient } from "../../scripts/lib/rlsChecks.mjs";
import { createSupabaseHttp, resolveSupabaseEnv, waitForHealth } from "../../scripts/lib/supabaseHttp.mjs";
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

  it("creates a 'free' profile and grants the 300 starter ink once for every new user (sign-up trigger)", async () => {
    for (const client of [ctx.a, ctx.b]) {
      const res = await client.rest("GET", "profiles", { query: { select: "user_id,plan_id,display_name,billing_status,ink_balance" } });
      expect(res.status).toBe(200);
      expect(rows(res)).toEqual([{ user_id: client.userId, plan_id: "free", display_name: null, billing_status: null, ink_balance: 300 }]);
      const grants = await client.rest("GET", "ink_grants", { query: { select: "kind,units,reason" } });
      expect(rows(grants)).toEqual([{ kind: "starter", units: 300, reason: "Starter ink" }]);
    }
    // a second starter is impossible (one per account)
    const dup = await service.rest("POST", "ink_grants", { body: { user_id: ctx.a.userId, units: 300, kind: "starter" }, prefer: "return=minimal" });
    expect(dup.status, JSON.stringify(dup.body)).toBe(409);
  }, 30_000);

  it("ink_summary reports the starter; credit_summary keeps its old keys, consistent for ink", async () => {
    const s = await ink(ctx.a);
    expect(s).toMatchObject({ balance: 300, granted: 300, purchased: 0, refunded: 0, used: 0, starter: 300, purchases: 0, last_purchase: null });
    expect(Date.parse(String(s.starter_at))).toBeGreaterThan(Date.now() - DAY);
    const c = await summary(ctx.a);
    expect(c).toMatchObject({ plan_id: "free", monthly_credits: 0, used: 0, granted: 300, remaining: 300 });
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
    const grants = await ctx.b.rest("GET", "ink_grants", { query: { kind: "eq.refund", select: "units" } });
    expect(rows(grants).map((g) => g.units)).toEqual([-1250, -1000]);

    // Unknown packs and unknown payments: refused / not found, nothing written.
    const badPack = await rpc(service, "grant_ink_purchase", { ...args, p_pack_id: "huge", p_checkout_session_id: `cs_db_bad_${tag}` });
    expect(badPack.status).toBe(400);
    expect((await rpc(service, "reverse_ink_purchase", { p_payment_intent_id: `pi_nobody_${tag}`, p_amount_refunded_cents: 1 })).body).toEqual({ found: false, reversed: 0 });
    await setBalance(ctx.b, 300);
  }, 60_000);

  // ------------------------------------------------------------ refund_credits

  it("refund_credits restores remaining, deletes the usage row, and is idempotent", async () => {
    const before = await summary(ctx.a);
    const spend = await consume(ctx.a, 7, "rls-billing/refund", { p_request_id: "req-refund-own" });
    expect((spend.body as Consume).ok).toBe(true);
    expect((await summary(ctx.a)).remaining).toBe(before.remaining - 7);

    const refund = await rpc(ctx.a, "refund_credits", { p_request_id: "req-refund-own" });
    expect(refund.status, JSON.stringify(refund.body)).toBe(200);
    expect(refund.body as Refund).toEqual({ refunded: 7, remaining: before.remaining });

    const after = await summary(ctx.a);
    expect(after.used).toBe(before.used);
    expect(after.remaining).toBe(before.remaining);
    expect(rows(await ctx.a.rest("GET", "usage_events", { query: { request_id: "eq.req-refund-own", select: "id" } }))).toEqual([]);

    const again = await rpc(ctx.a, "refund_credits", { p_request_id: "req-refund-own" });
    expect(again.body as Refund).toEqual({ refunded: 0, remaining: before.remaining });
    const unknown = await rpc(ctx.a, "refund_credits", { p_request_id: "req-never-existed" });
    expect(unknown.body as Refund).toEqual({ refunded: 0, remaining: before.remaining });
  }, 30_000);

  it("refund_credits with another user's request id refunds 0 and touches nothing", async () => {
    const aBefore = await summary(ctx.a);
    const bBefore = await summary(ctx.b);
    expect(((await consume(ctx.a, 2, "rls-billing/refund-foreign", { p_request_id: "req-refund-foreign" })).body as Consume).ok).toBe(true);

    const foreign = await rpc(ctx.b, "refund_credits", { p_request_id: "req-refund-foreign" });
    expect(foreign.status).toBe(200);
    expect(foreign.body as Refund).toEqual({ refunded: 0, remaining: bBefore.remaining });

    const still = await ctx.a.rest("GET", "usage_events", { query: { request_id: "eq.req-refund-foreign", select: "user_id,units" } });
    expect(rows(still)).toEqual([{ user_id: ctx.a.userId, units: 2 }]);
    expect((await summary(ctx.a)).remaining).toBe(aBefore.remaining - 2);
    expect((await summary(ctx.b)).remaining).toBe(bBefore.remaining);
  }, 30_000);

  it("refund_credits ignores rows older than 15 minutes but still honours a 14-minute-old one", async () => {
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

    const tooOld = await rpc(ctx.a, "refund_credits", { p_request_id: "req-refund-stale" });
    expect(tooOld.body as Refund).toEqual({ refunded: 0, remaining: before.remaining });
    expect(rows(await service.rest("GET", "usage_events", { query: { request_id: "eq.req-refund-stale", select: "units" } }))).toEqual([{ units: 9 }]);

    const inWindow = await rpc(ctx.a, "refund_credits", { p_request_id: "req-refund-fresh" });
    expect(inWindow.body as Refund).toEqual({ refunded: 5, remaining: before.remaining + 5 });
    expect(rows(await service.rest("GET", "usage_events", { query: { request_id: "eq.req-refund-fresh", select: "units" } }))).toEqual([]);
  }, 30_000);

  it("refund_credits rejects an empty request id (400) and anon (401)", async () => {
    for (const args of [{ p_request_id: "" }, { p_request_id: "x".repeat(101) }]) {
      expect((await rpc(ctx.a, "refund_credits", args)).status, JSON.stringify(args)).toBe(400);
    }
    const anon = await rpc(ctx.anon, "refund_credits", { p_request_id: "req-refund-own" });
    expect(anon.status).toBe(401);
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

  it("delete_own_account removes the auth user, profile, boards, ledger and storage rows", async () => {
    if (!ctx.newUser) throw new Error("bootstrapVerifyContext did not provide newUser()");
    const c = await ctx.newUser();
    const uid = c.userId as string;

    const board = rows(await c.rest("POST", "whiteboards", { body: { title: "rls-billing delete", data: {}, user_id: uid }, prefer: "return=representation" }))[0];
    expect(board?.id).toBeTruthy();
    const path = `${uid}/${board.id}/asset.png`;
    expect((await c.upload(ASSETS_BUCKET, path, TINY_PNG, "image/png")).status).toBe(200);
    expect(((await consume(c, 1, "rls-billing/delete")).body as Consume).ok).toBe(true);
    const bought = await rpc(service, "grant_ink_purchase", { p_user_id: uid, p_pack_id: "small", p_checkout_session_id: `cs_db_delete_${uid}` });
    expect((bought.body as { granted: number }).granted).toBe(1000);
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
