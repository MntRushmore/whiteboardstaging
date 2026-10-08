/**
 * Issues (src/lib/server/adminConsole/issues.ts): app_events grouped by issueFingerprint, per day,
 * with the admin's state (open, muted, fixed → regressed), noise flagged, the latest samples with
 * their meta and emails; and the PATCH that sets the state.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { AdminIssueListSchema, issueFingerprint } from "@/lib/admin/contracts";
import { buildIssueList, groupIssues, ISSUE_SAMPLES, patchIssue, type IssueEventRow } from "@/lib/server/adminConsole/issues";
import { resetConsoleCaches } from "@/lib/server/adminConsole/rest";
import { ADMIN, B1, consoleFake, consoleTables, deps, iso, MAYA, NOW } from "./fixtures/consoleTables";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

beforeEach(() => resetConsoleCaches());

const SOLVE = issueFingerprint("live.solve", "upstream", "The tutor couldn't work this one out (attempt 1)");
const CHAT = issueFingerprint("live.chat", "rate_limited", "Slow down");
const CRASH = issueFingerprint("client.error", null, "TypeError: x is undefined");

function ev(id: number, msAgo: number, over: Partial<IssueEventRow> = {}): IssueEventRow {
  return { id, at: iso(msAgo), source: "live", level: "error", kind: "live.solve", code: "upstream", message: `failed after ${id} ms`, user_id: null, board_id: null, stack: null, ...over };
}

describe("groupIssues", () => {
  it("digits do not split an issue; per day oldest first; users and boards distinct; the latest event names it", () => {
    const events = [ev(5, 10 * MIN, { user_id: "u1", board_id: "b1", level: "warn", message: "failed after 5 ms" }), ev(4, 3 * HOUR, { user_id: "u1", board_id: "b2" }), ev(3, 2 * DAY, { user_id: "u2" }), ev(2, 6 * DAY + HOUR)];
    const [issue] = groupIssues(events, new Map(), NOW, 7);
    expect(issue).toMatchObject({
      fingerprint: "live.solve|upstream|failed after # ms",
      count: 4,
      users: 2,
      boards: 2,
      firstAt: iso(6 * DAY + HOUR),
      lastAt: iso(10 * MIN),
      level: "warn",
      message: "failed after 5 ms",
      // 24-hour steps ending now: 6 d 1 h ago is the first, 2 d ago the sixth, the last 24 h the seventh
      perDay: [1, 0, 0, 0, 0, 1, 2],
      status: "open",
      note: null,
      fixedAt: null,
      regressed: false,
      noise: false,
      sampleIds: [5, 4, 3, 2],
    });
  });

  it("at most ISSUE_SAMPLES samples, newest first; outside the window is left out", () => {
    const events = Array.from({ length: 9 }, (_, i) => ev(i + 1, (i + 1) * HOUR));
    events.push(ev(99, 8 * DAY));
    const [issue] = groupIssues(events, new Map(), NOW, 7);
    expect(issue.count).toBe(9);
    expect(issue.sampleIds).toEqual([1, 2, 3, 4, 5].slice(0, ISSUE_SAMPLES));
  });

  it("states: muted, fixed then seen again (regressed), fixed and quiet", () => {
    const events = [ev(1, HOUR), ev(2, 2 * HOUR, { kind: "live.chat", code: "rate_limited", message: "Slow down" }), ev(3, 3 * DAY, { kind: "live.check", code: "network", message: "x" })];
    const states = new Map([
      ["live.solve|upstream|failed after # ms", { fingerprint: "live.solve|upstream|failed after # ms", status: "fixed", note: "deployed", fixed_at: iso(2 * HOUR) }],
      [CHAT, { fingerprint: CHAT, status: "muted", note: null, fixed_at: null }],
      ["live.check|network|x", { fingerprint: "live.check|network|x", status: "fixed", note: null, fixed_at: iso(DAY) }],
    ]);
    const by = Object.fromEntries(groupIssues(events, states, NOW, 7).map((i) => [i.kind, i]));
    expect(by["live.solve"]).toMatchObject({ status: "fixed", note: "deployed", fixedAt: iso(2 * HOUR), regressed: true });
    expect(by["live.chat"]).toMatchObject({ status: "muted", regressed: false, fixedAt: null });
    expect(by["live.check"]).toMatchObject({ status: "fixed", regressed: false });
  });

  it("noise: only when every event of it is noise", () => {
    const ext = { source: "client", kind: "client.error", code: null, message: "TypeError: x", stack: "at y (moz-extension://abc/x.js:1:1)" };
    const events = [ev(1, HOUR, ext), ev(2, 2 * HOUR, ext), ev(3, HOUR, { ...ext, message: "TypeError: y" }), ev(4, 2 * HOUR, { ...ext, message: "TypeError: y", stack: "at ours (/_next/static/chunk.js:1:1)" })];
    const by = Object.fromEntries(groupIssues(events, new Map(), NOW, 1).map((i) => [i.message, i.noise]));
    expect(by).toEqual({ "TypeError: x": true, "TypeError: y": false });
  });
});

describe("buildIssueList", () => {
  it("the window's errors and warnings as issues, most recent first, in the contract's shape", async () => {
    const tables = consoleTables();
    tables.admin_issues.push({ fingerprint: SOLVE, status: "fixed", note: "deployed", fixed_at: iso(HOUR), updated_at: iso(HOUR) });
    const db = consoleFake(tables);
    const list = await buildIssueList(deps(db), 7);
    const parsed = AdminIssueListSchema.safeParse(list);
    expect(parsed.success, JSON.stringify(parsed.error?.issues ?? [])).toBe(true);
    expect(list.days).toBe(7);
    expect(list.issues.map((i) => i.fingerprint)).toEqual([SOLVE, CRASH, CHAT]);
    const solve = list.issues[0];
    expect(solve).toMatchObject({ count: 2, users: 1, boards: 1, perDay: [0, 0, 0, 0, 0, 1, 1], status: "fixed", regressed: true, noise: false });
    expect(solve.samples.map((s) => [s.at, s.userEmail, s.boardId])).toEqual([
      [iso(20 * MIN), "maya@example.com", B1],
      [iso(2 * DAY), "maya@example.com", B1],
    ]);
    // the crash is noise; its sample carries its meta
    expect(list.issues[1]).toMatchObject({ noise: true, source: "client" });
    expect(list.issues[1].samples[0]).toMatchObject({ noise: true, meta: { stack: "at f (chrome-extension://abc/content.js:1:2)" }, userId: MAYA });
    // the month: last week's check failure too; health checks never
    const month = await buildIssueList(deps(db), 30);
    expect(month.issues).toHaveLength(4);
    expect(month.issues.every((i) => i.perDay.length === 30 && i.source !== "health")).toBe(true);
    const read = db.calls.find((c) => c.table === "app_events")!;
    expect(read.params.get("select")).not.toContain("meta,");
    expect(read.params.get("level")).toBe("in.(error,warn)");
  });

  it("a read that fails names its table", async () => {
    await expect(buildIssueList(deps(consoleFake(consoleTables(), { fail: { admin_issues: 500 } })), 7)).rejects.toMatchObject({ name: "ConsoleQueryError", what: "admin_issues" });
  });
});

describe("patchIssue", () => {
  it("fixed stamps fixedAt; open clears it; a note left out stays; every change logged", async () => {
    const db = consoleFake();
    const fixed = await patchIssue(deps(db), { fingerprint: SOLVE, status: "fixed", note: "deployed 7fde5a4" }, ADMIN);
    expect(fixed).toEqual({ fingerprint: SOLVE, status: "fixed", note: "deployed 7fde5a4", fixedAt: new Date(NOW).toISOString(), updatedAt: new Date(NOW).toISOString() });
    expect(db.tables.admin_issues).toEqual([expect.objectContaining({ fingerprint: SOLVE, status: "fixed", updated_by: ADMIN })]);
    const reopened = await patchIssue(deps(db), { fingerprint: SOLVE, status: "open" }, ADMIN);
    expect(reopened).toMatchObject({ status: "open", note: "deployed 7fde5a4", fixedAt: null });
    expect(db.tables.admin_issues).toHaveLength(1);
    const muted = await patchIssue(deps(db), { fingerprint: SOLVE, status: "muted", note: null }, ADMIN);
    expect(muted).toMatchObject({ status: "muted", note: null });
    expect(db.tables.admin_audit.map((a) => [a.action, a.target_kind, a.target_id, a.meta])).toEqual([
      ["issue.update", "issue", SOLVE, { status: "fixed", note: "set" }],
      ["issue.update", "issue", SOLVE, { status: "open" }],
      ["issue.update", "issue", SOLVE, { status: "muted", note: "cleared" }],
    ]);
    const upsert = db.calls.find((c) => c.method === "POST" && c.table === "admin_issues")!;
    expect(upsert.params.get("on_conflict")).toBe("fingerprint");
    expect(upsert.headers.get("prefer")).toContain("resolution=merge-duplicates");
  });
});
