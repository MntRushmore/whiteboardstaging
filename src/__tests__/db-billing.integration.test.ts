/**
 * Accounts & billing behaviour against a LIVE Supabase stack (normally the
 * local one from `npx supabase start`). Opt-in: runs only when RUN_DB_TESTS=1.
 *
 *   RUN_DB_TESTS=1 npx vitest run src/__tests__/db-billing.integration.test.ts
 *
 * Needs SUPABASE_SERVICE_ROLE_KEY (or the local stack, whose key comes from
 * `npx supabase status -o env`): the month-window and concurrency cases seed
 * ledger rows the way the webhook / an operator would, i.e. with the service
 * role, because nothing exposed to `authenticated` can add credits.
 *
 * Covered (migration 20260917020000_accounts_billing.sql):
 *   - profile auto-creation on sign-up (plan 'free')
 *   - credit_summary(): shape, current UTC month window, plan change via service role
 *   - consume_credits(): decrement + usage row, argument validation, refusal without writes
 *   - rows dated outside the current month are not counted
 *   - concurrency: 10 parallel 1-unit spends with 5 remaining -> exactly 5 succeed
 *   - delete_own_account(): auth.users row, profile, boards, usage, storage rows all gone
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ASSETS_BUCKET, TINY_PNG, isCreditSummary, rows, rpc } from "../../scripts/lib/rlsChecks.mjs";
import type { CheckContext, RlsClient } from "../../scripts/lib/rlsChecks.mjs";
import { createSupabaseHttp, resolveSupabaseEnv, waitForHealth } from "../../scripts/lib/supabaseHttp.mjs";
import { bootstrapVerifyContext } from "../../scripts/lib/verifyContext.mjs";

const enabled = process.env.RUN_DB_TESTS === "1";
const suite = enabled ? describe : describe.skip;
const title = enabled
  ? "Accounts & billing integration (live Supabase)"
  : "Accounts & billing integration — skipped: set RUN_DB_TESTS=1 with the local stack running (`npx supabase start`) to enable";

type Summary = {
  plan_id: string;
  plan_name: string;
  monthly_credits: number;
  used: number;
  granted: number;
  remaining: number;
  period_start: string;
  period_end: string;
};
type Consume = { ok: boolean; remaining: number; reason: string | null };

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
function currentPeriodStart() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

suite(title, () => {
  let ctx: CheckContext;
  let service: RlsClient;
  let url: string;
  let serviceKey: string;
  let cleanup: (() => Promise<string[]>) | undefined;

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

  it("creates a 'free' profile for every new user (sign-up trigger)", async () => {
    for (const client of [ctx.a, ctx.b]) {
      const res = await client.rest("GET", "profiles", { query: { select: "user_id,plan_id,display_name,billing_status" } });
      expect(res.status).toBe(200);
      expect(rows(res)).toEqual([{ user_id: client.userId, plan_id: "free", display_name: null, billing_status: null }]);
    }
  }, 30_000);

  it("credit_summary reports the free plan over the current UTC calendar month", async () => {
    const plans = await ctx.a.rest("GET", "plans", { query: { id: "eq.free", select: "monthly_credits,name" } });
    expect(plans.status).toBe(200);
    const free = rows(plans)[0];
    const s = await summary(ctx.a);
    expect(s.plan_id).toBe("free");
    expect(s.plan_name).toBe(free.name);
    expect(s.monthly_credits).toBe(free.monthly_credits);
    expect(s.used).toBe(0);
    expect(s.granted).toBe(0);
    expect(s.remaining).toBe(free.monthly_credits);
    const start = currentPeriodStart();
    expect(Date.parse(s.period_start)).toBe(start.getTime());
    expect(Date.parse(s.period_end)).toBe(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  }, 30_000);

  it("consume_credits decrements remaining and records a usage_event the owner can read", async () => {
    const before = await summary(ctx.a);
    const res = await consume(ctx.a, 3, "rls-billing/consume", { p_request_id: "req-1", p_model: "test-model" });
    expect(res.status).toBe(200);
    expect(res.body as Consume).toEqual({ ok: true, remaining: before.remaining - 3, reason: null });

    const after = await summary(ctx.a);
    expect(after.used).toBe(before.used + 3);
    expect(after.remaining).toBe(before.remaining - 3);

    const usage = await ctx.a.rest("GET", "usage_events", {
      query: { route: "eq.rls-billing/consume", select: "user_id,route,units,model,request_id" },
    });
    expect(rows(usage)).toEqual([
      { user_id: ctx.a.userId, route: "rls-billing/consume", units: 3, model: "test-model", request_id: "req-1" },
    ]);

    const other = await ctx.b.rest("GET", "usage_events", { query: { route: "eq.rls-billing/consume", select: "id" } });
    expect(rows(other)).toEqual([]);
    expect((await summary(ctx.b)).used).toBe(0);
  }, 30_000);

  it("rejects p_units outside 1..1000 and an empty route with 400, writing nothing", async () => {
    const before = await summary(ctx.a);
    for (const args of [{ p_route: "x", p_units: 0 }, { p_route: "x", p_units: 1001 }, { p_route: "x", p_units: -1 }, { p_route: "", p_units: 1 }]) {
      const res = await rpc(ctx.a, "consume_credits", args);
      expect(res.status, JSON.stringify({ args, body: res.body })).toBe(400);
    }
    expect((await summary(ctx.a)).used).toBe(before.used);
  }, 30_000);

  it("only counts usage and grants dated inside the current month", async () => {
    const before = await summary(ctx.a);
    const start = currentPeriodStart();
    const lastMonth = new Date(start.getTime() - DAY).toISOString();
    const nextMonth = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1) + DAY).toISOString();

    // Seeded the way the webhook / an operator would: with the service role.
    const seeds = [
      service.rest("POST", "usage_events", { body: { user_id: ctx.a.userId, route: "rls-billing/old", units: 50, created_at: lastMonth }, prefer: "return=minimal" }),
      service.rest("POST", "usage_events", { body: { user_id: ctx.a.userId, route: "rls-billing/future", units: 60, created_at: nextMonth }, prefer: "return=minimal" }),
      service.rest("POST", "credit_grants", { body: { user_id: ctx.a.userId, units: 1000, reason: "rls-billing old grant", created_at: lastMonth }, prefer: "return=minimal" }),
      service.rest("POST", "credit_grants", { body: { user_id: ctx.a.userId, units: 7, reason: "rls-billing current grant" }, prefer: "return=minimal" }),
    ];
    for (const res of await Promise.all(seeds)) expect(res.status, JSON.stringify(res.body)).toBe(201);

    const after = await summary(ctx.a);
    expect(after.used).toBe(before.used); // 50 + 60 outside the window
    expect(after.granted).toBe(before.granted + 7); // 1000 outside the window
    expect(after.remaining).toBe(before.remaining + 7);

    // The owner can read both grants but not add one.
    const grants = await ctx.a.rest("GET", "credit_grants", { query: { select: "units", order: "units.asc" } });
    expect(rows(grants).map((g) => g.units)).toEqual([7, 1000]);
    const forged = await ctx.a.rest("POST", "credit_grants", { body: { user_id: ctx.a.userId, units: 5 }, prefer: "return=minimal" });
    expect(forged.status).toBe(403);
  }, 30_000);

  it("refuses a spend larger than remaining without writing, then allows a spend that fits", async () => {
    const before = await summary(ctx.a);
    const countBefore = rows(await ctx.a.rest("GET", "usage_events", { query: { select: "id" } })).length;

    const over = await consume(ctx.a, Math.min(1000, before.remaining + 1), "rls-billing/over");
    expect(over.status).toBe(200);
    expect(over.body as Consume).toEqual({ ok: false, remaining: before.remaining, reason: "insufficient_credits" });
    expect(rows(await ctx.a.rest("GET", "usage_events", { query: { select: "id" } })).length).toBe(countBefore);

    const fits = await consume(ctx.a, 1, "rls-billing/fits");
    expect((fits.body as Consume).ok).toBe(true);
    expect((await summary(ctx.a)).remaining).toBe(before.remaining - 1);
  }, 30_000);

  it("a plan change by the service role is reflected immediately in credit_summary", async () => {
    const plus = rows(await ctx.a.rest("GET", "plans", { query: { id: "eq.plus", select: "monthly_credits,name" } }))[0];
    const before = await summary(ctx.a);
    const upgrade = await service.rest("PATCH", "profiles", {
      query: { user_id: `eq.${ctx.a.userId}` },
      body: { plan_id: "plus", billing_status: "active" },
      prefer: "return=representation",
    });
    expect(upgrade.status).toBe(200);
    expect(rows(upgrade)[0]?.plan_id).toBe("plus");

    const after = await summary(ctx.a);
    expect(after.plan_id).toBe("plus");
    expect(after.plan_name).toBe(plus.name);
    expect(after.monthly_credits).toBe(plus.monthly_credits);
    expect(after.used).toBe(before.used);
    expect(after.remaining).toBe(plus.monthly_credits + after.granted - after.used);

    // ...and the user still cannot do it themselves.
    const self = await ctx.a.rest("PATCH", "profiles", { query: { user_id: `eq.${ctx.a.userId}` }, body: { plan_id: "pro" } });
    expect(self.status).toBe(403);
    expect((self.body as { code?: string }).code).toBe("42501");
  }, 30_000);

  it("10 parallel 1-unit spends with 5 remaining succeed exactly 5 times", async () => {
    const start = await summary(ctx.b);
    const fill = start.remaining - 5;
    expect(fill).toBeGreaterThan(0);
    const seeded = await service.rest("POST", "usage_events", {
      body: { user_id: ctx.b.userId, route: "rls-billing/fill", units: fill },
      prefer: "return=minimal",
    });
    expect(seeded.status, JSON.stringify(seeded.body)).toBe(201);
    expect((await summary(ctx.b)).remaining).toBe(5);

    const results = await Promise.all(Array.from({ length: 10 }, () => consume(ctx.b, 1, "rls-billing/concurrency")));
    expect(results.map((r) => r.status)).toEqual(Array(10).fill(200));
    const bodies = results.map((r) => r.body as Consume);
    expect(bodies.filter((b) => b.ok).length).toBe(5);
    expect(bodies.filter((b) => !b.ok).every((b) => b.reason === "insufficient_credits" && b.remaining === 0)).toBe(true);
    expect(new Set(bodies.filter((b) => b.ok).map((b) => b.remaining))).toEqual(new Set([4, 3, 2, 1, 0]));

    const after = await summary(ctx.b);
    expect(after.remaining).toBe(0);
    expect(after.used).toBe(start.used + fill + 5);
    const written = await ctx.b.rest("GET", "usage_events", { query: { route: "eq.rls-billing/concurrency", select: "id" } });
    expect(rows(written).length).toBe(5);
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
    expect((await ctx.anon.publicRead(ASSETS_BUCKET, path)).status).toBe(200);

    const del = await rpc(c, "delete_own_account");
    expect(del.status, JSON.stringify(del.body)).toBeLessThan(300);

    // auth.users row is gone (GoTrue admin API).
    const admin = await fetch(`${url}/auth/v1/admin/users/${uid}`, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
    await admin.arrayBuffer();
    expect(admin.status).toBe(404);

    // Cascades, seen with the service role (RLS bypassed, so [] means really gone).
    for (const [table, column] of [["profiles", "user_id"], ["whiteboards", "user_id"], ["usage_events", "user_id"], ["board_assets", "user_id"], ["user_settings", "user_id"]]) {
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
