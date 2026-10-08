/**
 * The console's users (src/lib/server/adminConsole/users.ts): every account and one account's page,
 * read over a fake PostgREST (fixtures/consoleTables.ts) and checked against the contract's schemas.
 * Plus the pure pieces: the plan state from Stripe's statuses, the latest of several times, the order.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { AdminUserDetailSchema, AdminUserListSchema } from "@/lib/admin/contracts";
import { ConsoleQueryError, resetConsoleCaches } from "@/lib/server/adminConsole/rest";
import { activityDays, buildUserDetail, buildUserList, byActivity, latestIso, planState, userRow, type SubscriptionRow } from "@/lib/server/adminConsole/users";
import { ADMIN, B1, B2, consoleFake, consoleTables, deps, iso, LEE, MAYA, NEW, NOW, SAM } from "./fixtures/consoleTables";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

beforeEach(() => resetConsoleCaches());

const sub = (over: Partial<SubscriptionRow>): SubscriptionRow => ({
  user_id: MAYA,
  status: "active",
  trial_end: null,
  current_period_end: null,
  cancel_at_period_end: false,
  cancel_at: null,
  payer_email: null,
  created_at: iso(DAY),
  ...over,
});

describe("planState", () => {
  it("maps Stripe's statuses, set to cancel or not", () => {
    expect(planState(null)).toEqual({ plan: "none", trialEndsAt: null });
    expect(planState(sub({ status: null }))).toEqual({ plan: "none", trialEndsAt: null });
    expect(planState(sub({ status: "trialing", trial_end: "2026-10-11T00:00:00Z" }))).toEqual({ plan: "trialing", trialEndsAt: "2026-10-11T00:00:00Z" });
    expect(planState(sub({ status: "trialing", trial_end: "2026-10-11T00:00:00Z", cancel_at_period_end: true })).plan).toBe("trial_cancelling");
    expect(planState(sub({ status: "trialing", cancel_at: "2026-10-11T00:00:00Z" })).plan).toBe("trial_cancelling");
    expect(planState(sub({ status: "active" }))).toEqual({ plan: "active", trialEndsAt: null });
    expect(planState(sub({ status: "active", cancel_at_period_end: true })).plan).toBe("cancelling");
    for (const s of ["past_due", "unpaid", "paused", "incomplete"]) expect(planState(sub({ status: s })).plan, s).toBe("failing");
    for (const s of ["canceled", "incomplete_expired"]) expect(planState(sub({ status: s })).plan, s).toBe("ended");
  });
});

describe("pure pieces", () => {
  it("latestIso picks the latest time and skips the missing", () => {
    expect(latestIso(null, "2026-10-01T00:00:00Z", undefined, "2026-10-03T00:00:00Z", "nope")).toBe("2026-10-03T00:00:00Z");
    expect(latestIso(null, undefined)).toBeNull();
  });

  it("byActivity: most recently active first, the never-active last, then the newest account", () => {
    const row = (id: string, lastActiveAt: string | null, createdAt: string) => userRow({ id, errors7d: 0, isAdmin: false, auth: { id, email: null, createdAt, lastSignInAt: lastActiveAt } });
    const rows = [row("a", null, iso(DAY)), row("b", iso(HOUR), iso(9 * DAY)), row("c", iso(MIN), iso(9 * DAY)), row("d", iso(HOUR), iso(2 * DAY))].sort(byActivity);
    expect(rows.map((r) => r.id)).toEqual(["c", "d", "b", "a"]);
  });

  it("activityDays: 30 UTC days, today last, every day present", () => {
    const days = activityDays([{ day: "2026-10-08", attempts: 2, ai_calls: 5, boards: 1 }, { day: "2026-09-09", attempts: 1, ai_calls: 0, boards: 0 }], NOW);
    expect(days).toHaveLength(30);
    expect(days[0]).toEqual({ day: "2026-09-09", attempts: 1, aiCalls: 0, boards: 0 });
    expect(days[29]).toEqual({ day: "2026-10-08", attempts: 2, aiCalls: 5, boards: 1 });
    expect(days[10]).toEqual({ day: "2026-09-19", attempts: 0, aiCalls: 0, boards: 0 });
  });
});

describe("buildUserList", () => {
  it("every account, in the contract's shape, most recently active first", async () => {
    const db = consoleFake();
    const list = await buildUserList(deps(db));
    const parsed = AdminUserListSchema.safeParse(list);
    expect(parsed.success, JSON.stringify(parsed.error?.issues ?? [])).toBe(true);
    expect(list.generatedAt).toBe(new Date(NOW).toISOString());
    expect(list.total).toBe(5);
    expect(list.users.map((u) => u.id)).toEqual([ADMIN, MAYA, NEW, SAM, LEE]);
  });

  it("a student's row: plan, activity, learning, AI calls, errors without noise, bug reports", async () => {
    const list = await buildUserList(deps(consoleFake()));
    const maya = list.users.find((u) => u.id === MAYA)!;
    expect(maya).toEqual({
      id: MAYA,
      email: "maya@example.com",
      name: "Maya",
      course: "algebra1",
      createdAt: iso(20 * DAY),
      onboardedAt: iso(20 * DAY),
      // B1 saved 2 minutes ago is the latest of board, AI call (30 min), attempt (3 min), sign-in (2 days)
      lastActiveAt: iso(2 * MIN),
      plan: "trialing",
      trialEndsAt: iso(-3 * DAY),
      boards: 2,
      attempts7d: 4,
      solvedAlone7d: 3,
      // 3 metered + 2 Unlimited this week
      aiCalls7d: 5,
      // two Solve errors; the extension's crash is noise
      errors7d: 2,
      bugReports: 1,
      isAdmin: false,
    });
  });

  it("plans from the newest subscription; sign-in counts as activity; admins flagged; an account with no profile listed", async () => {
    const list = await buildUserList(deps(consoleFake()));
    const by = Object.fromEntries(list.users.map((u) => [u.id, u]));
    expect(by[SAM]).toMatchObject({ plan: "cancelling", lastActiveAt: iso(HOUR), errors7d: 0, boards: 1, aiCalls7d: 0 });
    expect(by[LEE]).toMatchObject({ plan: "failing", lastActiveAt: null, isAdmin: true, onboardedAt: null });
    expect(by[NEW]).toMatchObject({ email: "new@example.com", name: null, plan: "none", createdAt: iso(HOUR), boards: 0 });
  });

  it("reads the stats in one call, the auth list in pages, and every table it needs", async () => {
    const db = consoleFake();
    await buildUserList(deps(db));
    const tables = new Set(db.calls.map((c) => c.table));
    for (const t of ["profiles", "rpc/admin_user_stats", "app_events", "unlimited_subscriptions", "admins"]) expect(tables, t).toContain(t);
    const stats = db.calls.find((c) => c.table === "rpc/admin_user_stats")!;
    expect(stats.params.get("p_since")).toBe(iso(7 * DAY));
    const auth = db.calls.filter((c) => c.path.startsWith("/auth/v1/admin/users?"));
    expect(auth).toHaveLength(1);
    expect(auth[0].params.get("per_page")).toBe("1000");
    // the errors read is the week's errors, health checks aside
    const errors = db.calls.find((c) => c.table === "app_events")!;
    expect(errors.params.get("level")).toBe("eq.error");
    expect(errors.params.get("source")).toBe("neq.health");
  });

  it("the auth list failing is a named failure", async () => {
    await expect(buildUserList(deps(consoleFake(consoleTables(), { authListStatus: 500 })))).rejects.toMatchObject({ name: "ConsoleQueryError", what: "auth" });
  });

  it("a missing function names itself and the migration", async () => {
    const err = await buildUserList(deps(consoleFake(consoleTables(), { rpc: {} }))).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConsoleQueryError);
    expect((err as Error).message).toMatch(/^Couldn't read rpc\/admin_user_stats: it does not exist \(is migration 20261008000000_admin_console\.sql applied\?\)/);
  });
});

describe("buildUserDetail", () => {
  it("one account in the contract's shape, the look logged first", async () => {
    const db = consoleFake();
    const detail = await buildUserDetail(deps(db), MAYA, ADMIN);
    const parsed = AdminUserDetailSchema.safeParse(detail);
    expect(parsed.success, JSON.stringify(parsed.error?.issues ?? [])).toBe(true);
    expect(detail!.user.id).toBe(MAYA);
    expect(db.tables.admin_audit).toEqual([expect.objectContaining({ admin_id: ADMIN, action: "user.view", target_kind: "user", target_id: MAYA, meta: { boards: 2 } })]);
  });

  it("subscription, ink, boards, learning, activity, events, bugs, emails", async () => {
    const d = (await buildUserDetail(deps(consoleFake()), MAYA, ADMIN))!;
    expect(d.subscription).toEqual({ status: "trialing", trialEnd: iso(-3 * DAY), currentPeriodEnd: iso(-3 * DAY), cancelAtPeriodEnd: false, cancelAt: null, payerEmail: "parent@example.com", createdAt: iso(4 * DAY) });
    expect(d.inkBalance).toBe(120);
    expect(d.boards.map((b) => b.id)).toEqual([B1, B2]);
    expect(d.boards[0]).toMatchObject({ ownerEmail: "maya@example.com", ownerName: "Maya", errors7d: 2, attempts: 3, version: 12 });
    expect(d.learning).toMatchObject({ attempts: 5, solvedAlone: 3, withHelp: 1, tutorSolved: 1, activeMinutes: 8 });
    expect(d.learning.skills).toEqual([
      { skill: "linear_equations", attempts: 4, solvedAlone: 2 },
      { skill: "two_step", attempts: 1, solvedAlone: 1 },
    ]);
    expect(d.learning.recent[0]).toMatchObject({ id: "a4", outcome: "with_help", boardId: B1, finishedAt: null });
    expect(d.activity).toHaveLength(30);
    expect(d.activity[29]).toEqual({ day: "2026-10-08", attempts: 1, aiCalls: 2, boards: 1 });
    // the latest events, noise flagged, not dropped
    expect(d.events.map((e) => [e.kind, e.noise])).toEqual([
      ["live.solve", false],
      ["client.error", true],
      ["live.solve", false],
    ]);
    expect(d.events[0].userEmail).toBe("maya@example.com");
    expect(d.bugs.map((b) => b.id)).toHaveLength(1);
    // newest claimed first; a claimed email not (yet) sent has no sentAt
    expect(d.emails).toEqual([
      { kind: "trial_started", sentAt: null },
      { kind: "welcome", sentAt: iso(20 * DAY) },
    ]);
  });

  it("an account with no profile still has a page; no account at all is null (and nothing is logged)", async () => {
    const db = consoleFake();
    const fresh = await buildUserDetail(deps(db), NEW, ADMIN);
    expect(fresh!.user).toMatchObject({ email: "new@example.com", plan: "none" });
    expect(fresh!.inkBalance).toBeNull();
    const before = db.tables.admin_audit.length;
    expect(await buildUserDetail(deps(db), "00000000-0000-4000-8000-0000000000ff", ADMIN)).toBeNull();
    expect(db.tables.admin_audit.length).toBe(before);
  });

  it("the look cannot be logged: nothing is answered", async () => {
    const db = consoleFake(consoleTables(), { fail: { admin_audit: 500 } });
    await expect(buildUserDetail(deps(db), MAYA, ADMIN)).rejects.toMatchObject({ name: "AuditError" });
  });
});
