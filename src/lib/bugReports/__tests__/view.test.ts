/**
 * The reporter's page in words (src/lib/bugReports/view.ts): a status as a person says it, times in
 * plain words, which of our replies are new, the line under the thread, the report the address
 * points at, and their reply added in place. Plus the RPC rows' contract.
 */
import { describe, expect, it } from "vitest";
import { MyBugReportSchema, type BugMessage, type MyBugReport } from "../contracts";
import { formatReportTime, REPORT_STATUS_WORDS, REPORTS_COPY, reportTarget, reportView, totalUnread, withReply } from "../view";

/** Friday 2026-10-09, 3:00 PM in New York. */
const NOW = Date.parse("2026-10-09T19:00:00Z");
const CLOCK = { now: NOW, timeZone: "America/New_York" };
const HOUR = 3_600_000;
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const n = (s: string) => s.replace(/[  ]/g, " ");

const msg = (id: string, author: "admin" | "reporter", msAgo: number, body = `${author} ${id}`): BugMessage => ({ id, author, body, at: at(msAgo) });

function report(over: Partial<MyBugReport> = {}): MyBugReport {
  return { id: ID, created_at: at(26 * HOUR), message: "The pen draws in the wrong place", status: "seen", resolved_at: null, seen_at: null, unread: 0, thread: [], ...over };
}

describe("my_bug_reports() rows", () => {
  it("parse as the RPC sends them; an unknown status reads as new, a null message as empty", () => {
    const row = MyBugReportSchema.parse({ id: ID, created_at: at(HOUR), message: null, status: "triaged", resolved_at: null, seen_at: null, unread: 1, thread: [{ id: "m1", author: "admin", body: "hi", at: at(1) }] });
    expect(row.status).toBe("new");
    expect(row.message).toBe("");
    expect(MyBugReportSchema.safeParse({ ...row, thread: [{ id: "m1", author: "robot", body: "x", at: at(1) }] }).success).toBe(false);
  });
});

describe("words", () => {
  it("each status in plain words with one sentence", () => {
    expect(Object.fromEntries(Object.entries(REPORT_STATUS_WORDS).map(([k, v]) => [k, v.label]))).toEqual({ new: "Got it", seen: "Looking into it", fixed: "Fixed", wontfix: "Closed" });
  });

  it("times: today, yesterday, a date, and the year when it is not this one", () => {
    expect(n(formatReportTime(at(2 * HOUR), CLOCK))).toBe("today at 1:00 PM");
    expect(n(formatReportTime(at(20 * HOUR), CLOCK))).toBe("yesterday at 7:00 PM");
    expect(n(formatReportTime("2026-10-02T13:04:00Z", CLOCK))).toBe("Oct 2 at 9:04 AM");
    expect(n(formatReportTime("2025-12-30T20:00:00Z", CLOCK))).toBe("Dec 30, 2025 at 3:00 PM");
    expect(formatReportTime("not a time", CLOCK)).toBe("");
  });
});

describe("reportView", () => {
  it("no reply yet: says so; a report without a message says that too", () => {
    const v = reportView(report({ message: "  " }), CLOCK);
    expect(v.message).toBe(REPORTS_COPY.noMessage);
    expect(v.messageMissing).toBe(true);
    expect(v.footnote).toBe(REPORTS_COPY.noReplyYet);
    expect(n(v.sent)).toBe("Sent yesterday at 1:00 PM");
    expect(v.status.label).toBe("Looking into it");
  });

  it("our replies after they last looked are new; theirs never are; we answered last: no footnote", () => {
    const v = reportView(report({ seen_at: at(5 * HOUR), thread: [msg("a1", "admin", 20 * HOUR), msg("r1", "reporter", 10 * HOUR), msg("a2", "admin", 2 * HOUR)] }), CLOCK);
    expect(v.thread.map((m) => [m.who, m.isNew])).toEqual([
      ["Agathon", false],
      ["You", false],
      ["Agathon", true],
    ]);
    expect(v.unread).toBe(1);
    expect(v.footnote).toBeNull();
    // never opened: every reply of ours is new
    expect(reportView(report({ thread: [msg("a1", "admin", 3 * HOUR), msg("a2", "admin", HOUR)] }), CLOCK).unread).toBe(2);
  });

  it("they wrote last: we'll write back here", () => {
    expect(reportView(report({ thread: [msg("a1", "admin", 3 * HOUR), msg("r1", "reporter", HOUR)] }), CLOCK).footnote).toBe(REPORTS_COPY.waitingForUs);
  });
});

describe("the page's state", () => {
  it("totalUnread adds every report's unread", () => {
    expect(totalUnread([report({ unread: 2 }), report({ id: "b", unread: 1 }), report({ id: "c" })])).toBe(3);
    expect(totalUnread([])).toBe(0);
  });

  it("reportTarget: #<uuid> of a report here, of one that is not, or nothing usable", () => {
    const list = [report()];
    expect(reportTarget(`#${ID}`, list)).toEqual({ id: ID, found: true });
    expect(reportTarget(`#${ID.toUpperCase()}`, list)).toEqual({ id: ID.toUpperCase(), found: true });
    expect(reportTarget("#7c9e6679-7425-40de-944b-e07fc1f90ae7", list)).toEqual({ id: "7c9e6679-7425-40de-944b-e07fc1f90ae7", found: false });
    expect(reportTarget(`#${ID}`, null)).toEqual({ id: ID, found: false });
    expect(reportTarget("", list)).toBeNull();
    expect(reportTarget("#top", list)).toBeNull();
  });

  it("withReply: theirs last in its report, everything before it read; other reports untouched", () => {
    const other = report({ id: "other", unread: 1 });
    const mine = report({ unread: 1, thread: [msg("a1", "admin", HOUR)] });
    const reply = msg("r9", "reporter", 0, "thanks");
    const [updated, untouched] = withReply([mine, other], ID, reply);
    expect(updated.thread.map((m) => m.id)).toEqual(["a1", "r9"]);
    expect(updated.unread).toBe(0);
    expect(updated.seen_at).toBe(reply.at);
    expect(untouched).toBe(other);
    expect(reportView(updated, CLOCK).thread.every((m) => !m.isNew)).toBe(true);
  });
});
