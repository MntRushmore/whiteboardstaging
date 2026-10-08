import { describe, expect, it } from "vitest";
import type { AdminAttempt, AdminEvent, AdminUserDetail } from "../contracts";
import { FIXTURE_USER_IDS, buildWorld, userDetailAt } from "../fixtures/consoleFixtures";
import {
  OUTCOME_LABELS,
  activityView,
  attemptView,
  buildUserPageView,
  emailKindLabel,
  emailsView,
  eventsView,
  learningView,
  skillLabel,
  subscriptionFacts,
  userHeaderView,
} from "../userView";

/** Thursday 2026-10-08, 3:00 PM in New York. */
const NOW = Date.parse("2026-10-08T19:00:00Z");
const CLOCK = { now: NOW, timeZone: "America/New_York" };
const MIN = 60_000;
const DAY = 86_400_000;
const at = (ms: number) => new Date(NOW + ms).toISOString();
const n = (s: string | null | undefined) => (s ?? "").replace(/[  ]/g, " ");
const BOARD = "4f9c2a10-3b7d-4c55-9e21-8a6b0f1d2e33";

const world = buildWorld(NOW);
/** Maya Chen: in her trial, on a board now, a couple of bug reports. */
const maya = userDetailAt(world, FIXTURE_USER_IDS[0], NOW)!;

function attempt(over: Partial<AdminAttempt> = {}): AdminAttempt {
  return {
    id: "a1",
    boardId: BOARD,
    problemLatex: "x^{2}-5 x+6=0",
    skill: "quadratic_equations",
    outcome: "first_try",
    hints: 0,
    solves: 0,
    linesRinged: 0,
    activeMs: 7 * MIN,
    startedAt: at(-60 * MIN),
    finishedAt: at(-53 * MIN),
    ...over,
  };
}

describe("the header", () => {
  it("who, the plan and its trial, the course, and the facts (the id copyable)", () => {
    const h = userHeaderView(maya, CLOCK);
    expect(h).toMatchObject({ title: "Maya Chen", email: "maya.chen@example.com", initials: "MC", isAdmin: false, course: "Algebra 1", planLabel: "Trial", planTone: "info", planNote: "Trial ends Sat, Oct 10" });
    expect(h.facts.map((f) => [f.label, f.value])).toEqual([
      ["Signed up", "Oct 3"],
      ["Last active", "2 min ago"],
      ["Welcome", "Finished Oct 3"],
      ["Account id", FIXTURE_USER_IDS[0].slice(0, 8)],
    ]);
    expect(h.facts.at(-1)?.copy).toBe(FIXTURE_USER_IDS[0]);
  });

  it("ink when the account has a balance; not onboarded", () => {
    const ava = userDetailAt(world, FIXTURE_USER_IDS[4], NOW)!;
    const h = userHeaderView(ava, CLOCK);
    expect(h.facts.map((f) => [f.label, f.value])).toContainEqual(["Ink", "120"]);
    expect(h.facts.find((f) => f.key === "onboarded")?.value).toBe("Not finished");
    expect(h.planLabel).toBe("No plan");
  });
});

describe("30 days", () => {
  const days = (rows: [number, number, number][]): AdminUserDetail["activity"] =>
    rows.map(([attempts, aiCalls, boards], i) => ({ day: `2026-10-0${i + 1}`, attempts, aiCalls, boards }));

  it("stacks problems under AI calls against one scale, labels today, and says it in a line", () => {
    const a = activityView(days([[0, 0, 0], [2, 10, 1], [0, 0, 0], [1, 3, 0]]));
    expect(a.top).toBe(20);
    expect(a.bars[1]).toMatchObject({ attemptsRatio: 0.1, aiRatio: 0.5 });
    expect(a.bars[1].label).toBe("Oct 2: 2 problems, 10 AI calls, 1 board saved");
    expect(a.bars[3]).toMatchObject({ isToday: true, axisLabel: "Today" });
    expect(a.bars[3].label).toBe("Oct 4 (today): 1 problem, 3 AI calls, 0 boards saved");
    expect(a.summary).toBe("Active 2 of the last 4 days: 3 problems, 13 AI calls.");
    expect(a.hasData).toBe(true);
  });

  it("a quiet month", () => {
    const a = activityView(days([[0, 0, 0], [0, 0, 0]]));
    expect([a.summary, a.hasData, a.top]).toEqual(["Nothing in the last 30 days.", false, 1]);
  });

  it("marks a week back from today on the axis", () => {
    expect(activityView(maya.activity).bars.filter((b) => b.axisLabel).map((b) => b.axisLabel)).toHaveLength(4);
  });
});

describe("learning", () => {
  it("a problem as readable text (never KaTeX), its skill, how it went and its board", () => {
    const a = attemptView(attempt({ outcome: "with_help", hints: 2, activeMs: 8 * MIN }), CLOCK);
    expect(a).toMatchObject({ problem: "x² − 5x + 6 = 0", latex: "x^{2}-5 x+6=0", skill: "Quadratic equations", outcomeLabel: "With help", outcomeTone: "info", detail: "2 hints · 8 min", boardHref: `/admin/boards/${BOARD}` });
    expect(n(a.when)).toBe("2:00 PM");
    expect(attemptView(attempt({ problemLatex: "\\frac{4}{9}+\\frac{1}{3}", boardId: null }), CLOCK)).toMatchObject({ problem: "4/9 + ⅓", boardHref: null });
    expect(attemptView(attempt({ problemLatex: "  " }), CLOCK).problem).toBe("(no problem text)");
  });

  it("names every outcome, and a skill (or its id in words)", () => {
    expect(Object.keys(OUTCOME_LABELS)).toHaveLength(6);
    expect(skillLabel("two_step_equations")).toBe("Two-step equations");
    expect(skillLabel("future_skill")).toBe("future skill");
  });

  it("the tiles, the skills and the recent problems", () => {
    const l = learningView(
      {
        attempts: 47,
        solvedAlone: 24,
        withHelp: 9,
        tutorSolved: 6,
        activeMinutes: 282,
        skills: [{ skill: "quadratic_equations", attempts: 4, solvedAlone: 2 }],
        recent: [attempt()],
      },
      CLOCK,
    );
    expect(l.tiles.map((t) => [t.label, t.value, t.hint])).toEqual([
      ["Solved alone", "24", "51% of 47 problems"],
      ["With help", "9", "19%"],
      ["Tutor solved", "6", "13%"],
      ["Time on problems", "4h 42m", "Active time, all problems"],
    ]);
    expect(l.skills).toEqual([{ skill: "Quadratic equations", attempts: "4", alone: "50%", alonePct: 0.5 }]);
    expect(l.recent).toHaveLength(1);
    expect(l.empty).toBe(false);
    expect(learningView({ attempts: 0, solvedAlone: 0, withHelp: 0, tutorSolved: 0, activeMinutes: 0, skills: [], recent: [] }, CLOCK).empty).toBe(true);
  });
});

describe("what went wrong", () => {
  const ev = (id: number, minAgo: number, over: Partial<AdminEvent> = {}): AdminEvent => ({
    id,
    at: at(-minAgo * MIN),
    source: "live",
    level: "error",
    kind: "live.solve",
    code: "upstream",
    message: "The tutor couldn't work this one out.",
    route: "/api/live/solve",
    userId: null,
    userEmail: null,
    boardId: BOARD,
    requestId: "req_1",
    meta: { ms: 900 },
    release: "e90311e",
    noise: false,
    ...over,
  });

  it("newest first, browser noise apart", () => {
    const e = eventsView([ev(1, 30), ev(2, 5, { noise: true, kind: "client.error", code: null }), ev(3, 10, { level: "warn", kind: "model.live.chat", code: "fallback" })], CLOCK);
    expect(e.items.map((x) => [x.id, x.label, x.levelLabel])).toEqual([
      [3, "Ask (board chat): used the backup model", "Warning"],
      [1, "Solve failed", "Error"],
    ]);
    expect(e.noise.map((x) => x.id)).toEqual([2]);
    expect(e.items[1]).toMatchObject({ ago: "30 min ago", boardHref: `/admin/boards/${BOARD}`, boardShort: "4f9c2a10", facts: [{ label: "Took", value: "900 ms" }] });
  });
});

describe("emails and the subscription", () => {
  it("names each email and says when it went (or that it didn't)", () => {
    expect(emailKindLabel("welcome")).toBe("Welcome");
    expect(emailKindLabel("trial_reminder")).toBe("Trial ending reminder");
    expect(emailKindLabel("weekly_digest")).toBe("Weekly digest");
    const e = emailsView([{ kind: "welcome", sentAt: at(-5 * DAY) }, { kind: "trial_reminder", sentAt: null }], CLOCK);
    expect(e.map((x) => [x.label, n(x.when), x.sent])).toEqual([
      ["Welcome", "Oct 3, 3:00 PM", true],
      ["Trial ending reminder", "Claimed, not sent", false],
    ]);
  });

  it("Stripe's words beside their meaning, the dates, and the payer to copy", () => {
    const f = subscriptionFacts(maya, CLOCK)!;
    expect(f.map((x) => x.label)).toEqual(["Stripe status", "Started", "Trial ends", "Period ends", "Cancel at period end", "Payer email"]);
    expect(f[0]).toMatchObject({ value: "trialing (in the free trial)", copy: "trialing" });
    expect(f.find((x) => x.key === "payer")).toMatchObject({ value: "parent.maya.chen@example.com", copy: "parent.maya.chen@example.com" });
    expect(f.find((x) => x.key === "cancelAtPeriodEnd")?.value).toBe("No");
    expect(subscriptionFacts({ ...maya, subscription: null }, CLOCK)).toBeNull();
    const failing = subscriptionFacts({ ...maya, subscription: { ...maya.subscription!, status: "past_due" } }, CLOCK)!;
    expect(failing[0].value).toBe("past_due (a charge is failing)");
  });
});

describe("the page", () => {
  it("builds every section from one detail", () => {
    const v = buildUserPageView(maya, CLOCK);
    expect(v.header.title).toBe("Maya Chen");
    expect(v.boards.length).toBeGreaterThan(0);
    expect(v.boards.every((b) => b.href.startsWith("/admin/boards/"))).toBe(true);
    expect(v.bugs.map((b) => b.id)).toEqual(["bug_001", "bug_008"]);
    expect(v.events.items.length).toBeGreaterThan(0);
    expect(v.events.noise).toHaveLength(1);
    expect(v.emails.map((e) => e.label)).toEqual(["Welcome", "Trial ending reminder"]);
    expect(v.subscription).not.toBeNull();
  });
});
