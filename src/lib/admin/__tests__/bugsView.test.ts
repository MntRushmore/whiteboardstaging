import { describe, expect, it } from "vitest";
import type { AdminBug } from "../contracts";
import { buildWorld } from "../fixtures/consoleFixtures";
import {
  BUGS_COPY,
  applyBugPatch,
  bugBoardId,
  bugCounts,
  bugHref,
  bugKeyAction,
  bugTabs,
  bugView,
  bugsInTab,
  excerptOf,
  moveSelection,
  newBugsPreview,
  selectionAfterLeaving,
} from "../bugsView";

/** Thursday 2026-10-08, 3:00 PM in New York. */
const NOW = Date.parse("2026-10-08T19:00:00Z");
const CLOCK = { now: NOW, timeZone: "America/New_York" };
const MIN = 60_000;
const at = (ms: number) => new Date(NOW + ms).toISOString();
const n = (s: string | null) => (s ?? "").replace(/[  ]/g, " ");
const USER = "11111111-1111-4111-8111-111111111111";
const BOARD = "4f9c2a10-3b7d-4c55-9e21-8a6b0f1d2e33";

function bug(over: Partial<AdminBug> = {}): AdminBug {
  return {
    id: "bug_1",
    at: at(-12 * MIN),
    userId: USER,
    email: "maya.chen@example.com",
    boardId: null,
    message: "Solve keeps spinning on my quadratic\nthen says try again",
    path: `/board/${BOARD}`,
    status: "new",
    note: null,
    resolvedAt: null,
    hasScreenshot: true,
    diagnostics: { userAgent: "Mozilla/5.0 (iPad; CPU OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1", viewport: { width: 1024, height: 768 } },
    logs: [
      { level: "info", time: "2026-10-08T18:47:01Z", text: "[live] recognize ok" },
      { level: "warning", time: "2026-10-08T18:47:20Z", text: "stalled" },
      { level: "error", time: "2026-10-08T18:47:41Z", text: "solve failed: 502" },
      { level: "trace", time: "2026-10-08T18:47:42Z", text: "x" },
    ],
    thread: [],
    waiting: false,
    reporterSeenAt: null,
    ...over,
  };
}

const world = buildWorld(NOW);

describe("tabs", () => {
  it("counts each status and lists a tab newest first", () => {
    expect(bugCounts(world.bugs)).toEqual({ new: 4, seen: 3, fixed: 3, wontfix: 2 });
    expect(bugTabs(world.bugs).map((t) => `${t.label} ${t.count}`)).toEqual(["New 4", "Seen 3", "Fixed 3", "Won't fix 2"]);
    const fresh = bugsInTab(world.bugs, "new");
    expect(fresh.map((b) => b.id)).toEqual(["bug_001", "bug_002", "bug_003", "bug_004"]);
  });

  it("an empty tab says something kind", () => {
    expect(BUGS_COPY.emptyTitle("new")).toBe("Inbox zero");
    expect(BUGS_COPY.emptyHint("fixed")).toBe("Reports you mark fixed land here.");
  });
});

describe("a report", () => {
  it("reads in full: words, who (their page), when, the device, the board, screenshot and logs", () => {
    const v = bugView(bug(), CLOCK);
    expect(v).toMatchObject({
      statusLabel: "New",
      statusTone: "info",
      message: "Solve keeps spinning on my quadratic\nthen says try again",
      excerpt: "Solve keeps spinning on my quadratic",
      who: "maya.chen@example.com",
      whoMissing: false,
      userHref: `/admin/users/${USER}`,
      ago: "12 min ago",
      boardHref: `/admin/boards/${BOARD}`,
      hasScreenshot: true,
      screenshotUrl: "/api/admin/bugs/bug_1/screenshot",
      note: "",
      resolved: null,
    });
    expect(n(v.when)).toBe("2:48 PM");
    expect(v.device.summary).toBe("Safari on iPad · 1024 × 768");
    expect(v.logs.map((l) => `${l.level} ${l.levelLabel} ${n(l.time)}`)).toEqual(["info INFO 2:47:01 PM", "warn WARN 2:47:20 PM", "error ERROR 2:47:41 PM", "debug DEBUG 2:47:42 PM"]);
  });

  it("no message, no email, signed out, no board, no screenshot", () => {
    const v = bugView(bug({ message: "  ", email: null, userId: null, path: "/account", hasScreenshot: false }), CLOCK);
    expect(v).toMatchObject({ message: "(no message)", messageMissing: true, excerpt: "(no message)", who: "signed out", whoMissing: true, userHref: null, boardHref: null, screenshotUrl: null });
    expect(bugView(bug({ email: null }), CLOCK).who).toBe("no email");
  });

  it("finds the board in its own id, else in the page's path", () => {
    expect(bugBoardId({ boardId: "x", path: null })).toBe("x");
    expect(bugBoardId({ boardId: null, path: `/board/${BOARD}?tab=2` })).toBe(BOARD);
    expect(bugBoardId({ boardId: null, path: "/progress" })).toBeNull();
  });

  it("cuts a long first line for the list", () => {
    expect(excerptOf("\n\n  hello  \nworld")).toBe("hello");
    expect(excerptOf("a".repeat(200), 10)).toBe("aaaaaaaaa…");
  });

  it("says when it was closed", () => {
    expect(n(bugView(bug({ status: "fixed", resolvedAt: at(-26 * 60 * MIN) }), CLOCK).resolved)).toBe("Fixed yesterday, 1:00 PM");
    expect(n(bugView(bug({ status: "wontfix", resolvedAt: at(-60 * MIN) }), CLOCK).resolved)).toBe("Set aside 2:00 PM");
  });
});

describe("triage", () => {
  it("a PATCH as the page shows it at once: closing stamps resolvedAt, reopening clears it, a note is trimmed", () => {
    const now = at(0);
    expect(applyBugPatch(bug(), { status: "fixed" }, now)).toMatchObject({ status: "fixed", resolvedAt: now });
    const fixed = bug({ status: "fixed", resolvedAt: at(-DAY_MS) });
    expect(applyBugPatch(fixed, { note: "done" }, now)).toMatchObject({ status: "fixed", resolvedAt: at(-DAY_MS), note: "done" });
    expect(applyBugPatch(fixed, { status: "seen" }, now)).toMatchObject({ status: "seen", resolvedAt: null });
    expect(applyBugPatch(bug({ note: "x" }), { note: "   " }, now).note).toBeNull();
    expect(applyBugPatch(bug({ note: "x" }), { status: "seen" }, now).note).toBe("x");
  });

  it("keys: j / k move, s / f / w set a status, nothing else", () => {
    expect(bugKeyAction("j")).toEqual({ kind: "move", by: 1 });
    expect(bugKeyAction("k")).toEqual({ kind: "move", by: -1 });
    expect(bugKeyAction("s")).toEqual({ kind: "status", status: "seen" });
    expect(bugKeyAction("f")).toEqual({ kind: "status", status: "fixed" });
    expect(bugKeyAction("w")).toEqual({ kind: "status", status: "wontfix" });
    expect(bugKeyAction("x")).toBeNull();
    expect(bugKeyAction("J")).toBeNull();
  });

  it("moves along the list, held at the ends; after one leaves, the next (else the one before)", () => {
    const ids = ["a", "b", "c"];
    expect(moveSelection(ids, null, 1)).toBe("a");
    expect(moveSelection(ids, null, -1)).toBe("c");
    expect(moveSelection(ids, "a", 1)).toBe("b");
    expect(moveSelection(ids, "c", 1)).toBe("c");
    expect(moveSelection(ids, "a", -1)).toBe("a");
    expect(moveSelection([], "a", 1)).toBeNull();
    expect(selectionAfterLeaving(ids, "b")).toBe("c");
    expect(selectionAfterLeaving(ids, "c")).toBe("b");
    expect(selectionAfterLeaving(["a"], "a")).toBeNull();
    expect(selectionAfterLeaving(ids, "zz")).toBe("a");
  });

  it("a report's own address in the inbox", () => {
    expect(bugHref("bug_1")).toBe("/admin/bugs?id=bug_1");
    expect(bugHref("bug_1", "new")).toBe("/admin/bugs?id=bug_1&tab=new");
  });
});

describe("the overview's section", () => {
  it("the newest three new ones and the way to the inbox", () => {
    const p = newBugsPreview(world.bugs, CLOCK);
    expect(p.items.map((b) => b.id)).toEqual(["bug_001", "bug_002", "bug_003"]);
    expect(p.newCount).toBe(4);
    expect([p.link, p.linkLabel]).toEqual(["/admin/bugs", "Open the inbox (4 new)"]);
    expect(newBugsPreview([], CLOCK).linkLabel).toBe("Open the inbox");
  });
});

const DAY_MS = 86_400_000;
