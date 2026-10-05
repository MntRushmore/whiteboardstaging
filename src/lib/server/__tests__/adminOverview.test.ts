/**
 * The admin overview (src/lib/server/adminOverview.ts): the reads it sends PostgREST and Supabase
 * Auth, and what it makes of a week of tables (fixtures/adminTables.ts), checked against the
 * contract's schema. Plus the pure pieces: failing runs, credit parsing, hours, grouping, AI routes.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { AdminOverviewSchema } from "@/lib/admin/contracts";
import {
  aiRoutes,
  buildAdminOverview,
  errorGroups,
  eventRoute,
  failingRun,
  messageKey,
  OverviewQueryError,
  parseCredits,
  perHour,
  reportPath,
  resetOverviewCaches,
  serviceStatuses,
  type EventRow,
  type HealthRow,
} from "@/lib/server/adminOverview";
import { adminTables, BOARD, EMAILS, iso, NOW, uid } from "./fixtures/adminTables";
import { fakeSupabase, type Tables } from "./fixtures/fakeSupabase";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

beforeEach(() => resetOverviewCaches());

function run(tables: Tables = adminTables(), opts: Parameters<typeof fakeSupabase>[1] = { users: EMAILS }) {
  const db = fakeSupabase(tables, opts);
  return { db, overview: buildAdminOverview({ url: "https://proj.supabase.co", serviceKey: "service-key", fetch: db.fetch, now: NOW }) };
}

describe("buildAdminOverview over a week of tables", () => {
  it("answers in the contract's shape", async () => {
    const { overview } = run();
    const result = await overview;
    const parsed = AdminOverviewSchema.safeParse(result);
    expect(parsed.success, JSON.stringify(parsed.error?.issues ?? [])).toBe(true);
    expect(result.generatedAt).toBe(new Date(NOW).toISOString());
  });

  it("services: the latest check, 24 h uptime, latency, and when a failing run began", async () => {
    const { services } = await run().overview;
    const by = Object.fromEntries(services.map((s) => [s.service, s]));
    expect(services.map((s) => s.service)).toEqual(["app", "database", "openrouter", "mathpix", "email", "stripe"]);
    expect(by.app).toEqual({ service: "app", ok: true, lastCheckAt: iso(2 * MIN), latencyMs: 140, detail: null, uptime24h: 1, downSince: null });
    expect(by.database.uptime24h).toBeCloseTo(287 / 288);
    expect(by.openrouter.detail).toBe("$12.40 credit left");
    // Mathpix failed its last 4 checks: down since the oldest of them
    expect(by.mathpix).toMatchObject({ ok: false, detail: "timeout after 6 s", latencyMs: 6000, downSince: iso(17 * MIN) });
    expect(by.mathpix.uptime24h).toBeCloseTo(284 / 288);
    // Email failed every check in the window: its outage began after its last pass, 30 h ago
    expect(by.email).toMatchObject({ ok: false, uptime24h: 0, downSince: iso(DAY + 3 * MIN + 71 * 5 * MIN) });
    // Stripe was last checked 3 days ago: that check, no uptime
    expect(by.stripe).toEqual({ service: "stripe", ok: true, lastCheckAt: iso(3 * DAY), latencyMs: 90, detail: "webhooks arriving", uptime24h: null, downSince: null });
  });

  it("OpenRouter's credit from its latest check", async () => {
    expect((await run().overview).openrouter).toEqual({ creditsLeftUsd: 12.4, usedUsd: null });
  });

  it("errors: exact 24 h total, students touched, 48 hours, groups with samples and emails", async () => {
    const { errors } = await run().overview;
    // 12 Solve errors, 3 model timeouts, their 3 502s, one browser crash (not health, info, or older)
    expect(errors.total24h).toBe(19);
    expect(errors.users24h).toBe(3);
    expect(errors.perHour).toHaveLength(48);
    expect(errors.perHour[47].hour).toBe("2026-10-05T20:00:00.000Z");
    expect(errors.perHour[0].hour).toBe("2026-10-03T21:00:00.000Z");
    expect(errors.perHour.reduce((n, h) => n + h.errors, 0)).toBe(20);
    expect(errors.perHour.reduce((n, h) => n + h.warnings, 0)).toBe(8);

    const [solve, chat, ...rest] = errors.groups;
    expect(solve).toMatchObject({ kind: "live.solve", code: "upstream", source: "live", level: "error", count: 12, users: 3, lastAt: iso(4 * MIN), firstAt: iso(4 * MIN + 11 * 15 * MIN) });
    // the latest event names the group
    expect(solve.message).toBe("The tutor couldn't work this one out (attempt 1)");
    expect(solve.samples).toEqual([
      { at: iso(4 * MIN), userEmail: "maya@example.com", boardId: BOARD, route: "/api/live/solve", requestId: "req-solve-ui-0" },
      { at: iso(19 * MIN), userEmail: "sam@example.com", boardId: BOARD, route: "/api/live/solve", requestId: "req-solve-ui-1" },
      { at: iso(34 * MIN), userEmail: "lee@example.com", boardId: BOARD, route: "/api/live/solve", requestId: "req-solve-ui-2" },
    ]);
    expect(chat).toMatchObject({ kind: "model.live.chat", code: "fallback", level: "warn", count: 7, users: 0 });
    // "timed out after 6000 ms" and "after 6012 ms" are one group
    const kinds = rest.map((g) => `${g.kind}:${g.count}`).sort();
    expect(kinds).toEqual(["client.boundary:1", "model.live.solve:3", "route.live.solve:3"]);
    const crash = rest.find((g) => g.kind === "client.boundary")!;
    expect(crash.samples[0].userEmail).toBeNull();
  });

  it("AI: calls per route (metered and Unlimited), failures once per request, fallbacks", async () => {
    const { ai } = await run().overview;
    const by = Object.fromEntries(ai.routes.map((r) => [r.route, r]));
    expect(ai.routes.slice(0, 3).map((r) => r.route)).toEqual(["live/recognize", "live/solve", "live/chat"]);
    expect(by["live/recognize"]).toEqual({ route: "live/recognize", calls24h: 1500, failures24h: 0, fallbacks24h: 0 });
    // three timeouts, each also a 502: three failures, not six
    expect(by["live/solve"]).toEqual({ route: "live/solve", calls24h: 41, failures24h: 3, fallbacks24h: 0 });
    expect(by["live/chat"]).toEqual({ route: "live/chat", calls24h: 10, failures24h: 0, fallbacks24h: 7 });
    // every metered route is listed, busy or not; yesterday's check failure is not today's
    expect(ai.routes).toHaveLength(10);
    expect(by["live/check"]).toEqual({ route: "live/check", calls24h: 0, failures24h: 0, fallbacks24h: 0 });
  });

  it("users and learning", async () => {
    const result = await run().overview;
    // usage (1, 2, 3), Unlimited (8), a problem worked (9); this week also 6, 7 (calls) and 10 (a problem)
    expect(result.users).toEqual({ total: 20, signups24h: 2, signups7d: 5, active24h: 5, active7d: 8 });
    expect(result.learning).toEqual({ attempts24h: 10, solvedAlone24h: 6 });
  });

  it("the latest 20 bug reports, with the path they were sent from", async () => {
    const { bugReports } = await run().overview;
    expect(bugReports).toHaveLength(20);
    expect(bugReports[0]).toEqual({ at: iso(12 * MIN), email: "maya@example.com", message: "Report 0", path: `/board/${BOARD}` });
    expect(bugReports[1]).toEqual({ at: iso(HOUR + 12 * MIN), email: null, message: "", path: "/progress" });
    expect(bugReports[2].path).toBeNull();
  });

  it("reads with the service role, pages past 1,000 rows only as far as needed, and looks up only the samples' emails", async () => {
    const { db, overview } = run();
    await overview;
    // usage_events: 1,543 rows this week, so two pages
    const usage = db.calls.filter((c) => c.table === "usage_events");
    expect(usage.map((c) => c.params.get("offset"))).toEqual(["0", "1000"]);
    expect(usage[0].params.get("order")).toBe("created_at.desc");
    // health_checks: 1,440 checks in the window
    expect(db.calls.filter((c) => c.table === "health_checks" && c.params.has("offset")).map((c) => c.params.get("offset"))).toEqual(["0", "1000"]);
    // app_events skip health checks and info
    const events = db.calls.find((c) => c.table === "app_events" && c.method === "GET")!;
    expect(events.params.get("source")).toBe("neq.health");
    expect(events.params.get("level")).toBe("in.(error,warn)");
    // the bug reports' screenshots and logs are never downloaded
    expect(db.calls.find((c) => c.table === "bug_reports")!.params.get("select")).toBe("created_at,user_email,message,url:diagnostics->>url");
    const lookups = db.calls.filter((c) => c.path.startsWith("/auth/v1/admin/users/")).map((c) => c.path.split("/").pop()).sort();
    expect(lookups).toEqual([uid(1), uid(2), uid(3)]);
  });

  it("emails are remembered between overviews", async () => {
    const tables = adminTables();
    await run(tables).overview;
    const { db, overview } = run(tables);
    await overview;
    expect(db.calls.filter((c) => c.path.startsWith("/auth/v1/"))).toEqual([]);
  });

  it("a table that is not there yet (the admin migration) reads as empty", async () => {
    const tables = adminTables();
    delete tables.app_events;
    delete tables.health_checks;
    const result = await run(tables).overview;
    expect(AdminOverviewSchema.safeParse(result).success).toBe(true);
    expect(result.services.every((s) => s.ok === null && s.uptime24h === null)).toBe(true);
    expect(result.openrouter).toBeNull();
    expect(result.errors).toMatchObject({ total24h: 0, users24h: 0, groups: [] });
    expect(result.errors.perHour).toHaveLength(48);
    expect(result.users.total).toBe(20);
  });

  it("any other failure names the table", async () => {
    const { overview } = run(adminTables(), { users: EMAILS, fail: { usage_events: 500 } });
    await expect(overview).rejects.toBeInstanceOf(OverviewQueryError);
    // a count (HEAD) has no body to quote; a read does
    await expect(run(adminTables(), { users: EMAILS, fail: { profiles: 503 } }).overview).rejects.toThrow("Couldn't read profiles: status 503");
    await expect(run(adminTables(), { users: EMAILS, fail: { bug_reports: 500 } }).overview).rejects.toThrow("Couldn't read bug_reports: status 500 XX000: the fake database fell over");
  });

  it("a network failure or a wrong key says so", async () => {
    const down = buildAdminOverview({ url: "https://proj.supabase.co", serviceKey: "k", now: NOW, fetch: (async () => { throw new TypeError("fetch failed"); }) as typeof fetch });
    await expect(down).rejects.toThrow(/Couldn't read .*: network: fetch failed/);
    await expect(run(adminTables(), { serviceKey: "other" }).overview).rejects.toThrow(/status 401/);
  });

  it("a busy day past the row cap counts each route's calls exactly", async () => {
    const tables = adminTables();
    // 5,200 reads in the last 2 hours: more than the 5,000 rows read
    tables.usage_events = Array.from({ length: 5_200 }, (_, i) => ({ id: i, route: "live/recognize", units: 1, user_id: uid(1), created_at: iso(i * 1_000), model: null, request_id: `x${i}` }));
    const { db, overview } = run(tables);
    const result = await overview;
    expect(result.ai.routes.find((r) => r.route === "live/recognize")?.calls24h).toBe(5_200);
    expect(db.calls.some((c) => c.method === "HEAD" && c.table === "usage_events" && c.params.get("route") === "eq.live/recognize")).toBe(true);
  });
});

describe("the pure pieces", () => {
  const check = (minsAgo: number, ok: boolean, service = "mathpix"): HealthRow => ({ at: iso(minsAgo * MIN), service, ok, latency_ms: 1, detail: null });

  it("a failing run: its first failure, and whether it began inside the rows", () => {
    expect(failingRun([])).toEqual({ since: null, complete: true });
    expect(failingRun([check(1, true), check(6, false)])).toEqual({ since: null, complete: true });
    expect(failingRun([check(1, false), check(6, false), check(11, true)])).toEqual({ since: iso(6 * MIN), complete: true });
    expect(failingRun([check(1, false), check(6, false)])).toEqual({ since: iso(6 * MIN), complete: false });
  });

  it("statuses for services never checked", () => {
    const statuses = serviceStatuses([]);
    expect(statuses).toHaveLength(6);
    expect(statuses[0]).toEqual({ service: "app", ok: null, lastCheckAt: null, latencyMs: null, detail: null, uptime24h: null, downSince: null });
  });

  it("credit, in the ways a health check might say it", () => {
    expect(parseCredits("$12.40 credit left")).toEqual({ creditsLeftUsd: 12.4, usedUsd: null });
    expect(parseCredits("$1,204.00 credits remaining")).toEqual({ creditsLeftUsd: 1204, usedUsd: null });
    expect(parseCredits("credits left: $3.10")).toEqual({ creditsLeftUsd: 3.1, usedUsd: null });
    expect(parseCredits("balance $7")).toEqual({ creditsLeftUsd: 7, usedUsd: null });
    expect(parseCredits("$87.60 used of $100, $12.40 left")).toEqual({ creditsLeftUsd: 12.4, usedUsd: 87.6 });
    expect(parseCredits("used: $5.5")).toEqual({ creditsLeftUsd: null, usedUsd: 5.5 });
    expect(parseCredits("401 invalid key")).toEqual({ creditsLeftUsd: null, usedUsd: null });
    expect(parseCredits(null)).toEqual({ creditsLeftUsd: null, usedUsd: null });
  });

  it("48 hours, every one present, errors and warnings apart", () => {
    const e = (msAgo: number, level: EventRow["level"]): EventRow => ({ at: iso(msAgo), source: "live", level, kind: "live.solve", code: null, message: null, route: null, user_id: null, board_id: null, request_id: null });
    const hours = perHour([e(MIN, "error"), e(MIN, "warn"), e(HOUR + MIN, "error"), e(47 * HOUR + MIN, "error"), e(49 * HOUR, "error"), e(MIN, "info")], NOW + 30 * MIN);
    expect(hours).toHaveLength(48);
    expect(hours[47]).toEqual({ hour: "2026-10-05T20:00:00.000Z", errors: 0, warnings: 0 });
    expect(hours[46]).toEqual({ hour: "2026-10-05T19:00:00.000Z", errors: 1, warnings: 1 });
    expect(hours[45].errors).toBe(1);
    expect(hours[0].errors).toBe(0);
  });

  it("messages group without their ids and numbers", () => {
    expect(messageKey("Timed out after 6012 ms")).toBe(messageKey("timed out after 5980 ms"));
    expect(messageKey(`board ${BOARD} failed`)).toBe("board <id> failed");
    expect(messageKey("  two\n spaces ")).toBe("two spaces");
    expect(messageKey(null)).toBe("");
  });

  it("at most 30 groups, 3 samples each, most frequent first", () => {
    const events: EventRow[] = [];
    for (let k = 0; k < 35; k++) {
      for (let i = 0; i <= k; i++) events.push({ at: iso(i * MIN), source: "live", level: "error", kind: `live.k${k}`, code: null, message: "m", route: null, user_id: uid(i), board_id: null, request_id: null });
    }
    const groups = errorGroups(events, new Map([[uid(0), "a@example.com"]]));
    expect(groups).toHaveLength(30);
    expect(groups[0]).toMatchObject({ kind: "live.k34", count: 35, users: 35 });
    expect(groups.every((g) => g.samples.length <= 3)).toBe(true);
    expect(groups[0].samples[0]).toMatchObject({ at: iso(0), userEmail: "a@example.com" });
  });

  it("which AI route an event is about", () => {
    expect(eventRoute("model.live.solve")).toBe("live/solve");
    expect(eventRoute("route.live.lecture.sketch")).toBe("live/sketch");
    expect(eventRoute("live.solve")).toBeNull();
    expect(eventRoute("mathpix")).toBeNull();
  });

  it("an uncharged route appears when it fails", () => {
    const failed: EventRow = { at: iso(MIN), source: "server", level: "error", kind: "route.live.title", code: "upstream", message: "502", route: null, user_id: null, board_id: null, request_id: null };
    const routes = aiRoutes([], [failed, { ...failed }]);
    // no request id: each event is its own failure
    expect(routes.find((r) => r.route === "live/title")).toEqual({ route: "live/title", calls24h: 0, failures24h: 2, fallbacks24h: 0 });
  });

  it("a bug report's path, without origin, query or hash", () => {
    expect(reportPath("https://agathon.app/board/abc?x=1#y")).toBe("/board/abc");
    expect(reportPath("/progress")).toBe("/progress");
    expect(reportPath(null)).toBeNull();
  });
});
