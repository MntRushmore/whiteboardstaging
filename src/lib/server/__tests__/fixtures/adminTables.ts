/**
 * A week of Agathon in tables, for the admin overview tests. Now is 2026-10-05T20:00:00Z.
 *
 *   health_checks  every 5 min for 24 h (2 min past): app and database up (the database failed once,
 *                  10 h ago); OpenRouter up with its credit in the detail; Mathpix failing for the last
 *                  4 checks; email failing for 29 h 55 min (its last pass 30 h ago, before the window);
 *                  Stripe checked once, 3 days ago
 *   app_events     Solve errors students saw (numbers in the message vary), Ask's fallbacks, Solve's model
 *                  timeouts and the 502s they caused (same request ids), a browser crash signed out, an
 *                  error 30 h ago, and rows the overview must skip (health, info)
 *   usage_events   1,500 reads + 41 solves today, and two students 3 days ago
 *   unlimited_usage 10 chats today by an Unlimited subscriber
 *   learning_attempts 10 problems today (6 solved alone) by one more student, and 2 last week
 *   profiles       20 accounts: 2 new today, 5 this week
 *   bug_reports    25 reports (the overview shows 20)
 */
import type { Row, Tables } from "./fakeSupabase";

export const NOW = Date.parse("2026-10-05T20:00:00Z");
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
export const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

export const BOARD = "4f9c2a10-3b7d-4c55-9e21-8a6b0f1d2e33";
export const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const EMAILS: Record<string, string> = {
  [uid(1)]: "maya@example.com",
  [uid(2)]: "sam@example.com",
  [uid(3)]: "lee@example.com",
};

function healthRows(): Row[] {
  const rows: Row[] = [];
  for (let k = 0; k < 288; k++) {
    const ago = 2 * MIN + k * 5 * MIN;
    const at = iso(ago);
    rows.push({ at, service: "app", ok: true, latency_ms: 140 + (k % 5), detail: null });
    rows.push({ at, service: "database", ok: k !== 120, latency_ms: 80, detail: k === 120 ? "status 503" : null });
    rows.push({ at, service: "openrouter", ok: true, latency_ms: 400, detail: k === 0 ? "$12.40 credit left" : "$13.00 credit left" });
    rows.push({ at, service: "mathpix", ok: k >= 4, latency_ms: k < 4 ? 6000 : 300, detail: k < 4 ? "timeout after 6 s" : null });
    rows.push({ at, service: "email", ok: false, latency_ms: 200, detail: "401 invalid key" });
  }
  // email before the window: failing back to 29 h 55 min ago, passing before that
  for (let ago = DAY + 3 * MIN; ago <= 31 * HOUR; ago += 5 * MIN) {
    rows.push({ at: iso(ago), service: "email", ok: ago >= 30 * HOUR, latency_ms: 200, detail: ago >= 30 * HOUR ? null : "401 invalid key" });
  }
  rows.push({ at: iso(3 * DAY), service: "stripe", ok: true, latency_ms: 90, detail: "webhooks arriving" });
  return rows;
}

function event(msAgo: number, e: Partial<Row>): Row {
  return {
    id: Math.floor(Math.random() * 1e9),
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
    meta: {},
    release: "abc1234",
    ...e,
  };
}

function appEvents(): Row[] {
  const rows: Row[] = [];
  // 12 Solve errors students saw over the last 3 hours, 3 students (and one signed out)
  for (let i = 0; i < 12; i++) {
    rows.push(
      event(4 * MIN + i * 15 * MIN, {
        code: "upstream",
        message: `The tutor couldn't work this one out (attempt ${i + 1})`,
        route: "/api/live/solve",
        user_id: i === 11 ? null : uid((i % 3) + 1),
        board_id: BOARD,
        request_id: `req-solve-ui-${i}`,
      }),
    );
  }
  // Ask fell back to the backup model 7 times
  for (let i = 0; i < 7; i++) {
    rows.push(event(30 * MIN + i * 2 * HOUR, { source: "server", level: "warn", kind: "model.live.chat", code: "fallback", message: "fell back to deepseek", request_id: `chat-${i}` }));
  }
  // Solve's model timed out 3 times, and each answered 502: one failure each
  for (let i = 0; i < 3; i++) {
    rows.push(event(50 * MIN + i * HOUR, { source: "server", kind: "model.live.solve", code: "timeout", message: `timed out after ${6000 + i * 12} ms`, request_id: `solve-${i}`, user_id: uid(2) }));
    rows.push(event(50 * MIN + i * HOUR, { source: "server", kind: "route.live.solve", code: "upstream", message: "502", request_id: `solve-${i}`, user_id: uid(2) }));
  }
  // a browser crash, signed out
  rows.push(event(2 * HOUR, { source: "client", kind: "client.boundary", message: "Cannot read properties of undefined (reading 'x')", route: "/" }));
  // yesterday-ish: in the chart, not in today's groups
  rows.push(event(30 * HOUR, { kind: "live.check", code: "network", message: "Couldn't reach the checker", user_id: uid(4) }));
  rows.push(event(40 * HOUR, { source: "server", level: "warn", kind: "model.live.check", code: "fallback", message: "fell back" }));
  // never on the page: health checks (they have their own section), info, and last week
  rows.push(event(10 * MIN, { source: "health", kind: "health.mathpix", message: "timeout" }));
  rows.push(event(10 * MIN, { level: "info", kind: "live.solve", message: "fine" }));
  rows.push(event(3 * DAY, { kind: "live.solve", message: "old" }));
  return rows;
}

function usageEvents(): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < 1500; i++) rows.push({ id: i + 1, route: "live/recognize", units: 1, user_id: uid((i % 3) + 1), created_at: iso(MIN + i * 50_000), model: null, request_id: `r${i}` });
  for (let i = 0; i < 41; i++) rows.push({ id: 5000 + i, route: "live/solve", units: 10, user_id: uid(2), created_at: iso(5 * MIN + i * 20 * MIN), model: null, request_id: `s${i}` });
  rows.push({ id: 9001, route: "live/check", units: 3, user_id: uid(6), created_at: iso(3 * DAY), model: null, request_id: "old1" });
  rows.push({ id: 9002, route: "live/check", units: 3, user_id: uid(7), created_at: iso(3 * DAY + HOUR), model: null, request_id: "old2" });
  return rows;
}

function unlimitedUsage(): Row[] {
  return Array.from({ length: 10 }, (_, i) => ({ id: i + 1, route: "live/chat", units: 3, user_id: uid(8), created_at: iso(10 * MIN + i * HOUR), model: null, request_id: `u${i}` }));
}

function learningAttempts(): Row[] {
  const outcomes = ["first_try", "self_corrected", "first_try", "with_help", "tutor_solved", "first_try", "in_progress", "self_corrected", "unfinished", "first_try"];
  const rows: Row[] = outcomes.map((outcome, i) => ({
    id: `a-${i}`,
    user_id: uid(9),
    outcome,
    started_at: iso(20 * MIN + i * HOUR),
    updated_at: iso(10 * MIN + i * HOUR),
  }));
  rows.push({ id: "old-a", user_id: uid(10), outcome: "first_try", started_at: iso(5 * DAY), updated_at: iso(5 * DAY) });
  rows.push({ id: "older-a", user_id: uid(11), outcome: "first_try", started_at: iso(9 * DAY), updated_at: iso(9 * DAY) });
  return rows;
}

function profiles(): Row[] {
  return Array.from({ length: 20 }, (_, i) => ({
    user_id: uid(100 + i),
    display_name: null,
    created_at: iso(i < 2 ? (i + 1) * HOUR : i < 5 ? (i + 1) * DAY : 30 * DAY),
  }));
}

function bugReports(): Row[] {
  return Array.from({ length: 25 }, (_, i) => ({
    id: `b-${i}`,
    user_id: i === 1 ? null : uid(1),
    user_email: i === 1 ? null : "maya@example.com",
    board_id: i === 0 ? BOARD : null,
    message: i === 1 ? null : `Report ${i}`,
    screenshot: "data:image/png;base64,AAAA",
    diagnostics: { url: i === 0 ? `https://agathon.app/board/${BOARD}?tab=2#x` : i === 2 ? null : "https://agathon.app/progress", userAgent: "x" },
    logs: [],
    created_at: iso(i * HOUR + 12 * MIN),
  }));
}

export function adminTables(): Tables {
  return {
    health_checks: healthRows(),
    app_events: appEvents(),
    usage_events: usageEvents(),
    unlimited_usage: unlimitedUsage(),
    learning_attempts: learningAttempts(),
    profiles: profiles(),
    bug_reports: bugReports(),
  };
}
