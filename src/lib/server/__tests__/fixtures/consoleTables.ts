/**
 * A small Agathon for the admin console's tests. Now is 2026-10-08T12:00:00Z.
 *
 *   MAYA  (uid 1)  Maya, algebra 1, onboarded; in her free trial (ends in 3 days). Two boards: B1
 *                  saved 2 minutes ago (live), B2 three days ago. Four attempts this week (3 solved
 *                  alone, 1 with help) and one 10 days ago; 3 metered calls and 2 Unlimited calls this
 *                  week; on B1 two Solve errors and one browser-extension crash (noise); a bug report
 *                  with a screenshot and a log with a noise line.
 *   SAM   (uid 2)  paying, set to cancel (an older plan ended); one board (B3, 10 days ago); signed in
 *                  an hour ago and nothing else since.
 *   LEE   (uid 3)  an admin; a charge failing; no boards.
 *   NEW   (uid 4)  signed up an hour ago: an account with no profile yet.
 *
 * The views and functions of 20261008000000_admin_console.sql are modelled here from the tables
 * (`consoleFake`), the way the SQL computes them.
 */
import { fakeSupabase, type FakeOptions, type Row, type Tables } from "./fakeSupabase";

export const NOW = Date.parse("2026-10-08T12:00:00Z");
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
export const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

export const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const MAYA = uid(1);
export const SAM = uid(2);
export const LEE = uid(3);
export const NEW = uid(4);
export const ADMIN = uid(99);
export const B1 = "b1000000-0000-4000-8000-000000000001";
export const B2 = "b2000000-0000-4000-8000-000000000002";
export const B3 = "b3000000-0000-4000-8000-000000000003";
export const BUG = "f0000000-0000-4000-8000-0000000000b1";
export const BUG2 = "f0000000-0000-4000-8000-0000000000b2";

export const SNAPSHOT_B1 = { document: { store: { "shape:a": { id: "shape:a", type: "draw", props: { text: "x² + 3 = 7" } } }, schema: { schemaVersion: 2 } }, session: { version: 0 } };

/** A 1x1 transparent PNG. */
export const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

export const USERS: FakeOptions["users"] = {
  [MAYA]: { email: "maya@example.com", created_at: iso(20 * DAY), last_sign_in_at: iso(2 * DAY) },
  [SAM]: { email: "sam@example.com", created_at: iso(15 * DAY), last_sign_in_at: iso(HOUR) },
  [LEE]: { email: "lee@example.com", created_at: iso(30 * DAY), last_sign_in_at: null },
  [NEW]: { email: "new@example.com", created_at: iso(HOUR), last_sign_in_at: iso(HOUR) },
  [ADMIN]: { email: "owner@example.com", created_at: iso(40 * DAY), last_sign_in_at: iso(MIN) },
};

let eventId = 1;
function event(msAgo: number, e: Partial<Row>): Row {
  return {
    id: eventId++,
    at: iso(msAgo),
    source: "live",
    level: "error",
    kind: "live.solve",
    code: null,
    message: "",
    route: null,
    user_id: null,
    board_id: null,
    request_id: null,
    meta: null,
    release: "abc1234",
    ...e,
  };
}

function attempt(id: string, user: string, board: string | null, outcome: string, startedAgo: number, extra: Partial<Row> = {}): Row {
  return {
    id,
    user_id: user,
    board_id: board,
    problem_latex: "2x+3=7",
    skill: "linear_equations",
    outcome,
    hints: 1,
    solves: 0,
    lines_ringed: 0,
    active_ms: 90_000,
    started_at: iso(startedAgo),
    finished_at: outcome === "in_progress" ? null : iso(startedAgo - 5 * MIN),
    updated_at: iso(startedAgo - 5 * MIN),
    ...extra,
  };
}

export function consoleTables(): Tables {
  eventId = 1;
  return {
    profiles: [
      { user_id: MAYA, display_name: "Maya", course: "algebra1", created_at: iso(20 * DAY), onboarded_at: iso(20 * DAY), ink_balance: 120 },
      { user_id: SAM, display_name: null, course: "geometry", created_at: iso(15 * DAY), onboarded_at: iso(15 * DAY), ink_balance: 0 },
      { user_id: LEE, display_name: "Lee", course: null, created_at: iso(30 * DAY), onboarded_at: null, ink_balance: 0 },
      { user_id: ADMIN, display_name: "Owner", course: null, created_at: iso(40 * DAY), onboarded_at: iso(40 * DAY), ink_balance: 0 },
    ],
    whiteboards: [
      { id: B1, user_id: MAYA, title: "Solving linear equations", data: SNAPSHOT_B1, preview: "data:image/png;base64,AAAA", created_at: iso(5 * DAY), updated_at: iso(2 * MIN), version: 12, deleted_at: null },
      { id: B2, user_id: MAYA, title: "Untitled Whiteboard", data: { document: { store: {} } }, preview: "", created_at: iso(4 * DAY), updated_at: iso(3 * DAY), version: 3, deleted_at: null },
      { id: B3, user_id: SAM, title: "Triangles", data: { document: { store: {} } }, preview: null, created_at: iso(12 * DAY), updated_at: iso(10 * DAY), version: 1, deleted_at: null },
    ],
    whiteboard_snapshots: [
      { id: 7, whiteboard_id: B1, user_id: MAYA, version: 11, data: {}, created_at: iso(30 * MIN), reason: "interval" },
      { id: 8, whiteboard_id: B1, user_id: MAYA, version: 12, data: {}, created_at: iso(5 * MIN), reason: "pre_drop" },
    ],
    learning_attempts: [
      attempt("a1", MAYA, B1, "first_try", 1 * DAY),
      attempt("a2", MAYA, B1, "self_corrected", 2 * DAY, { skill: "two_step" }),
      attempt("a3", MAYA, B2, "first_try", 3 * DAY),
      attempt("a4", MAYA, B1, "with_help", 10 * MIN, { finished_at: null, outcome: "with_help", updated_at: iso(3 * MIN) }),
      attempt("a0", MAYA, null, "tutor_solved", 10 * DAY),
    ],
    usage_events: [
      { id: 1, user_id: MAYA, route: "live/recognize", units: 1, created_at: iso(HOUR) },
      { id: 2, user_id: MAYA, route: "live/check", units: 3, created_at: iso(2 * DAY) },
      { id: 3, user_id: MAYA, route: "live/solve", units: 10, created_at: iso(6 * DAY) },
      { id: 4, user_id: SAM, route: "live/check", units: 3, created_at: iso(9 * DAY) },
    ],
    unlimited_usage: [
      { id: 1, user_id: MAYA, route: "live/chat", units: 3, created_at: iso(30 * MIN) },
      { id: 2, user_id: MAYA, route: "live/chat", units: 3, created_at: iso(DAY + HOUR) },
    ],
    unlimited_subscriptions: [
      { user_id: MAYA, status: "trialing", trial_end: iso(-3 * DAY), current_period_end: iso(-3 * DAY), cancel_at_period_end: false, cancel_at: null, payer_email: "parent@example.com", created_at: iso(4 * DAY) },
      { user_id: SAM, status: "active", trial_end: iso(8 * DAY), current_period_end: iso(-20 * DAY), cancel_at_period_end: true, cancel_at: null, payer_email: null, created_at: iso(15 * DAY) },
      { user_id: SAM, status: "canceled", trial_end: null, current_period_end: null, cancel_at_period_end: false, cancel_at: null, payer_email: null, created_at: iso(30 * DAY) },
      { user_id: LEE, status: "past_due", trial_end: null, current_period_end: iso(DAY), cancel_at_period_end: false, cancel_at: null, payer_email: null, created_at: iso(25 * DAY) },
    ],
    admins: [{ user_id: LEE }, { user_id: ADMIN }],
    app_events: [
      event(20 * MIN, { code: "upstream", message: "The tutor couldn't work this one out (attempt 2)", route: "/api/live/solve", user_id: MAYA, board_id: B1, request_id: "r1" }),
      event(2 * DAY, { code: "upstream", message: "The tutor couldn't work this one out (attempt 1)", route: "/api/live/solve", user_id: MAYA, board_id: B1, request_id: "r2" }),
      // a browser extension's crash: noise
      event(HOUR, { source: "client", kind: "client.error", message: "TypeError: x is undefined", user_id: MAYA, board_id: B1, meta: { stack: "at f (chrome-extension://abc/content.js:1:2)" } }),
      // a warning, and an error last month (outside the week)
      event(3 * HOUR, { level: "warn", kind: "live.chat", code: "rate_limited", message: "Slow down", user_id: SAM }),
      event(9 * DAY, { kind: "live.check", code: "network", message: "Couldn't reach the checker", user_id: SAM, board_id: B3 }),
      // a health check: never an issue, never a user's error
      event(10 * MIN, { source: "health", kind: "health.mathpix", message: "timeout" }),
    ],
    bug_reports: [
      {
        id: BUG,
        user_id: MAYA,
        user_email: "maya@example.com",
        board_id: B1,
        message: "The tutor froze",
        screenshot: `data:image/png;base64,${PNG_BASE64}`,
        diagnostics: { url: `https://agathon.app/board/${B1}?x=1`, viewport: "1280x800" },
        logs: [
          { level: "log", time: "2026-10-08T11:00:00.000Z", args: ["saved", "v12"] },
          { level: "error", time: "2026-10-08T11:00:01.000Z", args: ["ResizeObserver loop completed with undelivered notifications."] },
          { level: "warn", time: 1791460000000, args: ["slow", { ms: 900 }] },
        ],
        status: "new",
        admin_note: null,
        resolved_at: null,
        created_at: iso(HOUR),
      },
      { id: BUG2, user_id: SAM, user_email: "sam@example.com", board_id: null, message: null, screenshot: null, diagnostics: {}, logs: [], status: "seen", admin_note: "asked for more", resolved_at: null, created_at: iso(3 * DAY) },
    ],
    email_log: [
      { user_id: MAYA, kind: "welcome", ref: "", claimed_at: iso(20 * DAY), sent_at: iso(20 * DAY) },
      { user_id: MAYA, kind: "trial_started", ref: "sub_1", claimed_at: iso(4 * DAY), sent_at: null },
    ],
    admin_issues: [],
    admin_audit: [],
  };
}

const time = (v: unknown) => (typeof v === "string" ? Date.parse(v) : NaN);
const utcDay = (t: number) => new Date(Math.floor(t / DAY) * DAY).toISOString().slice(0, 10);

/** admin_board_rows: whiteboards without data, plus its size and the board's attempts. */
export function boardRowsView(tables: Tables): Row[] {
  return tables.whiteboards.map(({ data, ...w }) => ({
    ...w,
    size_bytes: JSON.stringify(data ?? {}).length,
    attempts: (tables.learning_attempts ?? []).filter((a) => a.board_id === w.id).length,
  }));
}

/** admin_bug_rows: bug_reports without the screenshot, plus whether there is one. */
export function bugRowsView(tables: Tables): Row[] {
  return tables.bug_reports.map(({ screenshot, ...b }) => ({ ...b, has_screenshot: typeof screenshot === "string" && screenshot !== "" }));
}

/** admin_user_stats(p_since, p_user), as the SQL computes it. */
export function userStats(args: Record<string, string>, tables: Tables): Row[] {
  const since = Date.parse(args.p_since);
  const latest = (rows: Row[], col: string) => rows.map((r) => r[col] as string).sort((a, b) => time(b) - time(a))[0] ?? null;
  return (tables.profiles ?? [])
    .filter((p) => !args.p_user || p.user_id === args.p_user)
    .map((p) => {
      const id = p.user_id;
      const boards = (tables.whiteboards ?? []).filter((w) => w.user_id === id);
      const attempts = (tables.learning_attempts ?? []).filter((a) => a.user_id === id);
      const week = attempts.filter((a) => time(a.started_at) >= since);
      const usage = (tables.usage_events ?? []).filter((u) => u.user_id === id);
      const unl = (tables.unlimited_usage ?? []).filter((u) => u.user_id === id);
      const newestStarted = [...attempts].sort((a, b) => time(b.started_at) - time(a.started_at))[0];
      const lastAi = [latest(usage, "created_at"), latest(unl, "created_at")].filter(Boolean).sort((a, b) => time(b) - time(a))[0] ?? null;
      return {
        user_id: id,
        boards: boards.filter((w) => !w.deleted_at).length,
        last_board_at: latest(boards, "updated_at"),
        attempts: week.length,
        solved_alone: week.filter((a) => a.outcome === "first_try" || a.outcome === "self_corrected").length,
        last_attempt_at: newestStarted ? newestStarted.updated_at : null,
        ai_calls: usage.filter((u) => time(u.created_at) >= since).length + unl.filter((u) => time(u.created_at) >= since).length,
        last_ai_at: lastAi,
        bug_reports: (tables.bug_reports ?? []).filter((b) => b.user_id === id).length,
      };
    });
}

/** admin_user_days(p_user, p_since), as the SQL computes it. */
export function userDays(args: Record<string, string>, tables: Tables): Row[] {
  const since = Date.parse(args.p_since);
  const id = args.p_user;
  const days = new Map<string, { attempts: number; ai_calls: number; boards: Set<string> }>();
  const at = (t: number) => {
    const d = utcDay(t);
    if (!days.has(d)) days.set(d, { attempts: 0, ai_calls: 0, boards: new Set() });
    return days.get(d)!;
  };
  for (const a of tables.learning_attempts ?? []) {
    if (a.user_id !== id || time(a.started_at) < since) continue;
    const d = at(time(a.started_at));
    d.attempts += 1;
    if (a.board_id) d.boards.add(a.board_id as string);
  }
  for (const u of [...(tables.usage_events ?? []), ...(tables.unlimited_usage ?? [])]) if (u.user_id === id && time(u.created_at) >= since) at(time(u.created_at)).ai_calls += 1;
  for (const w of tables.whiteboards ?? []) {
    if (w.user_id !== id || w.deleted_at) continue;
    for (const col of ["created_at", "updated_at"]) if (time(w[col]) >= since) at(time(w[col])).boards.add(w.id as string);
  }
  return [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, d]) => ({ day, attempts: d.attempts, ai_calls: d.ai_calls, boards: d.boards.size }));
}

/** bug_reports' trigger: resolved_at follows the status. */
function bugTriage(before: Row, after: Row): Row {
  if (after.status === before.status) return after;
  return { ...after, resolved_at: after.status === "fixed" || after.status === "wontfix" ? new Date(NOW).toISOString() : null };
}

/** The fake PostgREST with the console's views and functions. */
export function consoleFake(tables: Tables = consoleTables(), opts: FakeOptions = {}) {
  return fakeSupabase(tables, {
    users: USERS,
    views: { admin_board_rows: boardRowsView, admin_bug_rows: bugRowsView },
    rpc: {
      admin_user_stats: { args: ["p_since", "p_user"], run: userStats },
      admin_user_days: { args: ["p_user", "p_since"], run: userDays },
    },
    onUpdate: { bug_reports: bugTriage },
    ...opts,
  });
}

export const deps = (db: { fetch: typeof fetch }) => ({ url: "https://proj.supabase.co", serviceKey: "service-key", fetch: db.fetch, now: NOW });
