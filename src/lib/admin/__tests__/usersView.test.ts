import { describe, expect, it } from "vitest";
import type { AdminUserRow } from "../contracts";
import { buildWorld } from "../fixtures/consoleFixtures";
import {
  DEFAULT_USER_QUERY,
  USERS_COPY,
  activeToday,
  buildUsersView,
  filterChips,
  isDefaultQuery,
  matchesSearch,
  planChips,
  queryUsers,
  sortUsers,
  toggle,
  userRowView,
} from "../usersView";

/** Thursday 2026-10-08, 3:00 PM in New York. */
const NOW = Date.parse("2026-10-08T19:00:00Z");
const CLOCK = { now: NOW, timeZone: "America/New_York" };
const MIN = 60_000;
const DAY = 86_400_000;
const at = (ms: number) => new Date(NOW + ms).toISOString();

function row(over: Partial<AdminUserRow> = {}): AdminUserRow {
  return {
    id: "4f9c2a10-3b7d-4c55-9e21-8a6b0f1d2e33",
    email: "maya.chen@example.com",
    name: "Maya Chen",
    course: "algebra1",
    createdAt: at(-5 * DAY),
    onboardedAt: at(-5 * DAY),
    lastActiveAt: at(-2 * MIN),
    plan: "trialing",
    trialEndsAt: at(2 * DAY),
    boards: 7,
    attempts7d: 18,
    solvedAlone7d: 11,
    aiCalls7d: 142,
    errors7d: 4,
    bugReports: 1,
    isAdmin: false,
    ...over,
  };
}

const users = buildWorld(NOW).users;
const byName = (name: string) => users.find((u) => u.name === name)!;

describe("search", () => {
  it("matches every word against name, email, course (id or name) and id, ignoring case and accents", () => {
    expect(matchesSearch(row(), "maya")).toBe(true);
    expect(matchesSearch(row(), "CHEN example")).toBe(true);
    expect(matchesSearch(row(), "algebra 1")).toBe(true);
    expect(matchesSearch(row(), "algebra1")).toBe(true);
    expect(matchesSearch(row(), "4f9c2a10")).toBe(true);
    expect(matchesSearch(row(), "maya sam")).toBe(false);
    expect(matchesSearch(row({ name: "Chloé Dubois" }), "chloe")).toBe(true);
    expect(matchesSearch(row(), "   ")).toBe(true);
  });
});

describe("filters and sorts", () => {
  it("active today is today in the viewer's zone", () => {
    expect(activeToday(row({ lastActiveAt: at(-14 * 60 * MIN) }), CLOCK)).toBe(true); // 1 AM today in New York
    expect(activeToday(row({ lastActiveAt: at(-16 * 60 * MIN) }), CLOCK)).toBe(false); // 11 PM yesterday
    expect(activeToday(row({ lastActiveAt: null }), CLOCK)).toBe(false);
  });

  it("plans are one-of, the other filters all apply, and search narrows", () => {
    const trials = queryUsers(users, { ...DEFAULT_USER_QUERY, plans: ["trialing"] }, CLOCK);
    expect(trials.length).toBe(10);
    expect(trials.every((u) => u.plan === "trialing")).toBe(true);
    const paying = queryUsers(users, { ...DEFAULT_USER_QUERY, plans: ["active", "cancelling"] }, CLOCK);
    expect(paying.map((u) => u.name).sort()).toEqual(["Mateo Rossi", "Sam Okafor", "Zara Ahmed"]);
    const neverOnboarded = queryUsers(users, { ...DEFAULT_USER_QUERY, filters: ["never_onboarded"] }, CLOCK);
    expect(neverOnboarded.every((u) => !u.onboardedAt)).toBe(true);
    expect(neverOnboarded).toHaveLength(4);
    const both = queryUsers(users, { ...DEFAULT_USER_QUERY, filters: ["has_errors", "active_today"] }, CLOCK);
    expect(both.every((u) => u.errors7d > 0 && activeToday(u, CLOCK))).toBe(true);
    expect(queryUsers(users, { ...DEFAULT_USER_QUERY, search: "leo" }, CLOCK).map((u) => u.name)).toEqual(["Leo Martínez"]);
  });

  it("sorts by last active (never last), newest, or most active (AI calls plus problems)", () => {
    const last = sortUsers(users, "last_active");
    expect(last[0].name).toBe("Rushil Chopra");
    expect(last[last.length - 1].lastActiveAt).toBeNull();
    const newest = sortUsers(users, "newest");
    expect(newest[0].name).toBe("Arjun Mehta");
    const most = sortUsers(users, "most_active");
    expect(most[0].name).toBe("Sam Okafor");
    expect(most[1].name).toBe("Maya Chen");
  });

  it("chips: a chip per plan someone is on, with counts; the show-only filters with theirs", () => {
    const plans = planChips(users, ["trialing"]);
    expect(plans.map((p) => `${p.label} ${p.count}${p.pressed ? " ✓" : ""}`)).toEqual([
      "No plan 8",
      "Trial 10 ✓",
      "Trial, cancelling 1",
      "Paying 2",
      "Paying, cancelling 1",
      "Payment failing 1",
      "Ended 1",
    ]);
    // a plan nobody is on still shows while it is selected, so it can be turned off
    expect(planChips([row({ plan: "active" })], ["ended"]).map((p) => [p.key, p.count])).toEqual([
      ["active", "1"],
      ["ended", "0"],
    ]);
    expect(filterChips(users, ["has_errors"], CLOCK).map((f) => [f.label, f.count, f.pressed])).toEqual([
      ["Active today", "14", false],
      ["Never onboarded", "4", false],
      ["Has errors", "9", true],
    ]);
  });

  it("toggles a chip, and knows the default query", () => {
    expect(toggle(["a", "b"], "a")).toEqual(["b"]);
    expect(toggle(["a"], "b")).toEqual(["a", "b"]);
    expect(isDefaultQuery(DEFAULT_USER_QUERY)).toBe(true);
    expect(isDefaultQuery({ ...DEFAULT_USER_QUERY, sort: "newest" })).toBe(true);
    expect(isDefaultQuery({ ...DEFAULT_USER_QUERY, search: "x" })).toBe(false);
  });
});

describe("a row", () => {
  it("reads at a glance: name, email, plan and trial, dates, the week's numbers", () => {
    const r = userRowView(row(), CLOCK);
    expect(r).toMatchObject({
      href: "/admin/users/4f9c2a10-3b7d-4c55-9e21-8a6b0f1d2e33",
      name: "Maya Chen",
      email: "maya.chen@example.com",
      initials: "MC",
      course: "Algebra 1",
      planLabel: "Trial",
      planTone: "info",
      planNote: "Trial ends Sat, Oct 10",
      signedUp: "Oct 3",
      lastActive: "2 min ago",
      activeToday: true,
      liveNow: true,
      boards: "7",
      attempts: "18",
      alone: "61% alone",
      aiCalls: "142",
      errors: "4",
      hasErrors: true,
      bugs: "1",
      hasBugs: true,
      isAdmin: false,
      onboarded: true,
    });
    expect(r.facts.map((f) => f.text)).toEqual(["Active 2 min ago", "7 boards", "18 problems (61% alone)", "142 AI calls", "4 errors", "1 bug report", "Trial ends Sat, Oct 10"]);
    expect(r.facts.filter((f) => f.bad).map((f) => f.key)).toEqual(["errors", "bugs"]);
  });

  it("a quiet account: no name, never active, no plan, not onboarded", () => {
    const r = userRowView(row({ name: null, email: "parent.of.emma@example.com", lastActiveAt: null, plan: "none", trialEndsAt: null, onboardedAt: null, attempts7d: 0, solvedAlone7d: 0, aiCalls7d: 1, errors7d: 0, bugReports: 0, boards: 1 }), CLOCK);
    expect(r.name).toBe("parent.of.emma");
    expect(r.hasName).toBe(false);
    expect(r.lastActive).toBe("never");
    expect(r.planLabel).toBe("No plan");
    expect(r.alone).toBeNull();
    expect(r.facts.map((f) => f.text)).toEqual(["Never active", "1 board", "0 problems", "1 AI call", USERS_COPY.notOnboarded]);
  });
});

describe("the page", () => {
  it("says how many are shown, and tells nobody-at-all from nobody-matches", () => {
    const all = buildUsersView(users, DEFAULT_USER_QUERY, CLOCK);
    expect(all.showing).toBe("24 accounts");
    expect(all.rows).toHaveLength(24);
    expect(all.filtered).toBe(false);
    const some = buildUsersView(users, { ...DEFAULT_USER_QUERY, plans: ["failing"] }, CLOCK);
    expect(some.showing).toBe("1 of 24 accounts");
    expect(some.filtered).toBe(true);
    const none = buildUsersView(users, { ...DEFAULT_USER_QUERY, search: "zzz" }, CLOCK);
    expect([none.noMatch, none.empty]).toEqual([true, false]);
    const empty = buildUsersView([], DEFAULT_USER_QUERY, CLOCK);
    expect([empty.noMatch, empty.empty]).toEqual([false, true]);
  });

  it("marks the admin account", () => {
    expect(userRowView(byName("Rushil Chopra"), CLOCK).isAdmin).toBe(true);
  });
});
