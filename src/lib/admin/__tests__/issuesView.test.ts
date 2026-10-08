import { describe, expect, it } from "vitest";
import { issueFingerprint, type AdminEvent, type AdminIssue } from "../contracts";
import { buildWorld } from "../fixtures/consoleFixtures";
import {
  ISSUES_COPY,
  applyIssuePatch,
  attentionCounts,
  issueActions,
  issueTab,
  issueTabs,
  issueView,
  issuesInTab,
  issuesUrl,
  needsAttention,
  noiseCount,
  sampleView,
  topIssues,
} from "../issuesView";

/** Thursday 2026-10-08, 3:00 PM in New York. */
const NOW = Date.parse("2026-10-08T19:00:00Z");
const CLOCK = { now: NOW, timeZone: "America/New_York" };
const MIN = 60_000;
const at = (ms: number) => new Date(NOW + ms).toISOString();
const n = (s: string | null) => (s ?? "").replace(/[  ]/g, " ");
const USER = "11111111-1111-4111-8111-111111111111";
const BOARD = "4f9c2a10-3b7d-4c55-9e21-8a6b0f1d2e33";

function event(over: Partial<AdminEvent> = {}): AdminEvent {
  return {
    id: 1,
    at: at(-4 * MIN),
    source: "live",
    level: "error",
    kind: "live.solve",
    code: "upstream",
    message: "The tutor couldn't work this one out. Try again.",
    route: "/api/live/solve",
    userId: USER,
    userEmail: "maya@example.com",
    boardId: BOARD,
    requestId: "req_7f3a9c",
    meta: { model: "openai/gpt-5.4", ms: 20412 },
    release: "e90311e",
    noise: false,
    ...over,
  };
}

function issue(over: Partial<AdminIssue> = {}): AdminIssue {
  const kind = over.kind ?? "live.solve";
  const code = over.code === undefined ? "upstream" : over.code;
  const message = over.message ?? "The tutor couldn't work this one out. Try again.";
  return {
    fingerprint: issueFingerprint(kind, code, message),
    kind,
    code,
    source: "live",
    level: "error",
    message,
    count: 23,
    users: 6,
    boards: 8,
    firstAt: at(-3 * 86_400_000),
    lastAt: at(-4 * MIN),
    perDay: [0, 4, 3, 2, 0, 5, 9],
    status: "open",
    note: null,
    fixedAt: null,
    regressed: false,
    noise: false,
    samples: [event()],
    ...over,
  };
}

const world = buildWorld(NOW);

describe("tabs", () => {
  it("muted is Muted; open, or regressed, is Open; the rest Fixed", () => {
    expect(issueTab({ status: "muted", regressed: true })).toBe("muted");
    expect(issueTab({ status: "open", regressed: false })).toBe("open");
    expect(issueTab({ status: "fixed", regressed: true })).toBe("open");
    expect(issueTab({ status: "fixed", regressed: false })).toBe("fixed");
  });

  it("needs a look: open or regressed and not noise (the nav's count)", () => {
    expect(needsAttention(issue())).toBe(true);
    expect(needsAttention(issue({ noise: true }))).toBe(false);
    expect(needsAttention(issue({ status: "fixed", regressed: true }))).toBe(true);
    expect(needsAttention(issue({ status: "muted" }))).toBe(false);
    expect(attentionCounts(world.issues)).toEqual({ open: 6, regressed: 1 });
  });

  it("a tab lists regressed first, then the most recent; noise only when asked", () => {
    const open = issuesInTab(world.issues, "open", false);
    expect(open[0].regressed).toBe(true);
    expect(open.map((i) => i.kind)).toEqual(["live.save", "live.solve", "live.recognize", "model.live.chat", "route.live.check", "client.boundary"]);
    expect(issuesInTab(world.issues, "open", true)).toHaveLength(8);
    expect(issueTabs(world.issues, false).map((t) => `${t.label} ${t.count}`)).toEqual(["Open 6", "Muted 1", "Fixed 1"]);
    expect(noiseCount(world.issues, "open")).toBe(2);
    expect(noiseCount(world.issues, "fixed")).toBe(0);
  });

  it("the route's address per window", () => {
    expect(issuesUrl()).toBe("/api/admin/issues?days=7");
    expect(issuesUrl(30)).toBe("/api/admin/issues?days=30");
  });
});

describe("an issue", () => {
  it("in plain words, with its kind, how often, for whom, each day, and the latest few", () => {
    const v = issueView(issue(), CLOCK);
    expect(v).toMatchObject({
      label: "Solve failed",
      kind: "live.solve",
      code: "upstream",
      sourceLabel: "Board",
      levelLabel: "Error",
      tab: "open",
      count: "23 times",
      users: "6 students",
      boards: "8 boards",
      lastSeen: "Last 4 min ago",
      regressedNote: null,
    });
    expect(n(v.firstSeen)).toBe("First Oct 5, 3:00 PM");
    expect(v.spark.total).toBe(23);
    expect(v.spark.summary).toBe("23 events in 7 days, most on Oct 8 (9)");
    expect(v.samples).toHaveLength(1);
  });

  it("regressed, noted, signed-out only", () => {
    const v = issueView(issue({ status: "fixed", fixedAt: at(-2 * 86_400_000), regressed: true, note: "  retries now ", users: 0 }), CLOCK);
    expect(n(v.regressedNote)).toBe("Marked fixed Oct 6, 3:00 PM, then seen again");
    expect(v.note).toBe("retries now");
    expect(v.users).toBe("no signed-in student");
    expect(v.tab).toBe("open");
  });

  it("a sample: when, who (their page), the board (the viewer), the release, the request, the details", () => {
    const s = sampleView(event(), CLOCK, "The tutor couldn't work this one out. Try again.");
    expect(s).toMatchObject({
      who: "maya@example.com",
      userHref: `/admin/users/${USER}`,
      boardHref: `/admin/boards/${BOARD}`,
      boardShort: "4f9c2a10",
      release: "e90311e",
      requestId: "req_7f3a9c",
      route: "/api/live/solve",
      message: null,
      facts: [
        { label: "Model", value: "openai/gpt-5.4" },
        { label: "Took", value: "20.4 s" },
      ],
    });
    expect(s.meta).toContain('"model": "openai/gpt-5.4"');
    // its own words when they say more than the issue's (the digits), and signed out
    const other = sampleView(event({ message: "check timed out after 25 s", userId: null, userEmail: null, boardId: null, meta: null }), CLOCK, "check timed out after # s");
    expect(other).toMatchObject({ message: "check timed out after 25 s", who: "signed out", whoMissing: true, userHref: null, boardHref: null, meta: null, facts: [] });
  });
});

describe("triage", () => {
  it("fixing stamps fixedAt and clears regressed; reopening clears fixedAt; muting keeps both", () => {
    const now = at(0);
    const regressed = issue({ status: "fixed", fixedAt: at(-86_400_000), regressed: true });
    expect(applyIssuePatch(regressed, { status: "fixed" }, now)).toMatchObject({ status: "fixed", fixedAt: now, regressed: false });
    expect(applyIssuePatch(regressed, { status: "open" }, now)).toMatchObject({ status: "open", fixedAt: null, regressed: false });
    expect(applyIssuePatch(regressed, { status: "muted", note: "later" }, now)).toMatchObject({ status: "muted", fixedAt: at(-86_400_000), regressed: true, note: "later" });
    expect(applyIssuePatch(issue({ note: "x" }), { status: "muted", note: " " }, now).note).toBeNull();
    expect(applyIssuePatch(issue({ note: "x" }), { status: "muted" }, now).note).toBe("x");
  });

  it("offers fix and mute when open, reopen too when regressed, reopen elsewhere", () => {
    expect(issueActions("open", false)).toEqual(["fixed", "muted"]);
    expect(issueActions("open", true)).toEqual(["fixed", "muted", "open"]);
    expect(issueActions("muted", false)).toEqual(["open"]);
    expect(issueActions("fixed", false)).toEqual(["open"]);
  });

  it("says what it did", () => {
    expect([ISSUES_COPY.marked("muted"), ISSUES_COPY.marked("fixed"), ISSUES_COPY.marked("open")]).toEqual(["Muted", "Marked fixed", "Reopened"]);
  });
});

describe("the overview's section", () => {
  it("the top five open issues, regressed first then the most frequent, and the way there", () => {
    const top = topIssues(world.issues, CLOCK);
    expect(top.items.map((i) => i.label)).toEqual(["Board didn't save", "Ask (board chat): used the backup model", "Solve failed", "Couldn't read handwriting", "Checking work: server error"]);
    expect([top.open, top.link, top.linkLabel]).toEqual([6, "/admin/issues", "All issues (6 open)"]);
    expect(topIssues([], CLOCK).linkLabel).toBe("All issues");
  });
});
