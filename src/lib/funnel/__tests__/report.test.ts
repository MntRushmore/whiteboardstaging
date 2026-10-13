/**
 * The admin Funnel's adding up (src/lib/funnel/report.ts) and its page view
 * (src/lib/funnel/funnelView.ts), from made-up admin_funnel() answers.
 */
import { describe, expect, it } from "vitest";
import { FUNNEL_STAGES, PAYWALL_AT, type FunnelReport, type FunnelStage } from "../contracts";
import { FUNNEL_COPY, PATH_LABELS, buildFunnelView, cohortOptions, funnelBars, funnelTiles, pathRows, shortDate, sourceLabel, weekLabel } from "../funnelView";
import { FunnelReportSchema, FunnelRpcSchema, buildFunnelReport, cohortStart, funnelPathOf, funnelUrl, isTimeZone, reachedStages, type FunnelRpc } from "../report";
import type { FunnelStep } from "../steps";

const TRACKING = "2026-10-12T19:30:42Z";

function rpc(accounts: FunnelRpc["accounts"], over: Partial<FunnelRpc> = {}): FunnelRpc {
  return { time_zone: "America/New_York", generated_at: "2026-10-12T23:00:00Z", tracking_since: TRACKING, active_subscriptions: 0, kid_profiles: 0, accounts, start: null, ...over };
}

type Account = FunnelRpc["accounts"][number];

const A = (week: string, at: string, source: string, stages: FunnelStage[], over: Partial<Account> = {}): Account => ({
  week,
  signed_up_at: at,
  source,
  stages,
  steps: [],
  trial_ended: false,
  canceled: false,
  ...over,
});

const SAMPLE = rpc(
  [
    // 1. before the paywall: a free account that came back without a trial
    A("2026-09-28", "2026-10-01T15:00Z", "tiktok", ["signed_up", "onboarded", "came_back_day2"]),
    // 2. after it, before tracking: a trial (so it saw the plan and opened checkout), over and paid
    A("2026-10-05", "2026-10-06T14:00Z", "tiktok", ["signed_up", "onboarded", "trial_started", "came_back_day2", "paid"], { trial_ended: true }),
    // 3. after it, before tracking: onboarded, nothing more known
    A("2026-10-05", "2026-10-07T01:00Z", "unknown", ["signed_up", "onboarded"]),
    // 4. after it, before tracking: a checkout Stripe remembers (the back-fill), not onboarded on record
    A("2026-10-05", "2026-10-08T23:53Z", "utm:newsletter", ["signed_up", "checkout_opened"], { steps: ["checkout_opened"] }),
    // 5–9. tracked
    A("2026-10-12", "2026-10-12T20:00Z", "tiktok", ["signed_up", "onboarded", "plan_shown", "checkout_opened", "trial_started"], {
      steps: ["welcome_shown", "welcome_started", "tour_problem", "tour_checked", "tour_done", "plan_shown", "checkout_opened"],
    }),
    A("2026-10-12", "2026-10-12T21:00Z", "x", ["signed_up", "onboarded", "plan_shown"], { steps: ["welcome_shown", "welcome_skipped", "plan_shown"] }),
    A("2026-10-12", "2026-10-12T22:00Z", "x", ["signed_up"], { steps: ["welcome_shown"] }),
    A("2026-10-12", "2026-10-12T22:30Z", "x", ["signed_up", "onboarded", "plan_shown", "checkout_opened", "trial_started"], {
      steps: ["welcome_shown", "welcome_started", "tour_problem", "tour_skipped", "plan_shown", "checkout_opened"],
      trial_ended: true,
      canceled: true,
    }),
    // 9. signed up in the very minute tracking began: in the tracked cohort
    A("2026-10-12", "2026-10-12T19:30Z", "x", ["signed_up", "onboarded", "plan_shown"], { steps: ["welcome_shown", "welcome_started", "tour_checked", "tour_skipped", "plan_shown"] }),
  ],
  { active_subscriptions: 1, kid_profiles: 3 },
);

const counts = (r: FunnelReport) => FUNNEL_STAGES.map((s) => r.totals.counts[s]);

describe("reachedStages", () => {
  it("fills the chain up to the furthest step before the trial", () => {
    expect([...reachedStages(["signed_up", "trial_started"])]).toEqual(["signed_up", "onboarded", "plan_shown", "checkout_opened", "trial_started"]);
    expect([...reachedStages(["checkout_opened"])]).toEqual(["signed_up", "onboarded", "plan_shown", "checkout_opened"]);
    expect([...reachedStages([])]).toEqual(["signed_up"]);
  });

  it("counts the stages after the trial only with a trial", () => {
    expect(reachedStages(["signed_up", "onboarded", "came_back_day2", "came_back_week2"]).has("came_back_day2")).toBe(false);
    const paid = reachedStages(["trial_started", "came_back_week2", "paid"]);
    expect([paid.has("came_back_day2"), paid.has("came_back_week2"), paid.has("paid")]).toEqual([false, true, true]);
  });
});

describe("funnelPathOf", () => {
  const path = (steps: FunnelStep[]) => funnelPathOf(steps);
  it("reads how an account left the welcome and the guided board, the furthest first", () => {
    expect(path(["welcome_shown", "welcome_started", "tour_checked", "tour_done"])).toBe("finished_tour");
    expect(path(["welcome_started", "tour_checked", "tour_skipped"])).toBe("skipped_tour_checked");
    expect(path(["welcome_started", "tour_unread", "tour_skipped"])).toBe("skipped_tour");
    expect(path(["welcome_shown", "welcome_skipped", "plan_shown"])).toBe("skipped_welcome");
    expect(path(["welcome_shown", "welcome_started", "tour_problem"])).toBe("left_board");
    expect(path(["welcome_shown"])).toBe("left_welcome");
    expect(path(["plan_shown", "checkout_opened"])).toBeNull();
    expect(path([])).toBeNull();
  });
});

describe("cohortStart", () => {
  it("starts at the paywall, at tracking, or never", () => {
    expect(cohortStart("paywall", TRACKING)).toBe(PAYWALL_AT);
    expect(cohortStart("tracked", TRACKING)).toBe(TRACKING);
    expect(cohortStart("tracked", null)).toBeNull();
    expect(cohortStart("all", TRACKING)).toBeNull();
  });
});

describe("buildFunnelReport", () => {
  const report = buildFunnelReport(SAMPLE, { monthlyUsd: 25 });

  it("counts the sign-ups since the paywall by default, each stage a part of the one before", () => {
    expect([report.cohort, report.cohortSince, report.trackingSince]).toEqual(["paywall", PAYWALL_AT, TRACKING]);
    expect(report.totals.key).toBe("all");
    // signed up, welcome, plan, checkout, trial, day 2, week 2, paying
    expect(counts(report)).toEqual([8, 7, 6, 4, 3, 1, 0, 1]);
    expect([report.totals.canceled, report.totals.trialsEnded, report.untracked]).toEqual([1, 2, 3]);
  });

  it("counts only the tracked sign-ups, from the minute tracking began", () => {
    const tracked = buildFunnelReport(SAMPLE, { monthlyUsd: 25, cohort: "tracked" });
    expect(counts(tracked)).toEqual([5, 4, 4, 2, 2, 0, 0, 0]);
    expect([tracked.untracked, tracked.cohortSince]).toEqual([0, TRACKING]);
  });

  it("counts everyone for all time, where a free account's return without a trial is not day 2", () => {
    const all = buildFunnelReport(SAMPLE, { monthlyUsd: 25, cohort: "all" });
    expect(counts(all)).toEqual([9, 8, 6, 4, 3, 1, 0, 1]);
    expect([all.untracked, all.cohortSince]).toEqual([4, null]);
  });

  it("keeps the all-time row for the money, whatever the cohort", () => {
    const tracked = buildFunnelReport(SAMPLE, { monthlyUsd: 25, cohort: "tracked" });
    expect(tracked.allTime.counts.signed_up).toBe(9);
    expect([tracked.allTime.counts.trial_started, tracked.allTime.counts.paid, tracked.allTime.trialsEnded, tracked.allTime.canceled]).toEqual([3, 1, 2, 1]);
  });

  it("adds up the paths of the tracked accounts in the cohort, in their order", () => {
    expect(report.paths.map((p) => [p.path, p.accounts, p.planShown, p.checkoutOpened, p.trialStarted])).toEqual([
      ["left_welcome", 1, 0, 0, 0],
      ["skipped_welcome", 1, 1, 0, 0],
      ["left_board", 0, 0, 0, 0],
      ["skipped_tour", 1, 1, 1, 1],
      ["skipped_tour_checked", 1, 1, 0, 0],
      ["finished_tour", 1, 1, 1, 1],
    ]);
  });

  it("groups the cohort by week (newest first) and by source (most sign-ups first, ties by name)", () => {
    expect(report.byWeek.map((r) => [r.key, r.counts.signed_up, r.counts.trial_started])).toEqual([
      ["2026-10-12", 5, 2],
      ["2026-10-05", 3, 1],
    ]);
    expect(report.bySource.map((r) => [r.key, r.counts.signed_up])).toEqual([
      ["x", 4],
      ["tiktok", 2],
      ["unknown", 1],
      ["utm:newsletter", 1],
    ]);
    expect(report.bySource.find((r) => r.key === "x")?.canceled).toBe(1);
  });

  it("prices MRR from the active subscriptions, and passes the kids and the zone through", () => {
    expect([report.mrrUsd, report.activeSubscriptions, report.kidProfiles, report.timeZone, report.generatedAt]).toEqual([25, 1, 3, "America/New_York", "2026-10-12T23:00:00Z"]);
    expect(FunnelReportSchema.safeParse(report).success).toBe(true);
  });

  it("counts a sign-up even when the list forgets it, a repeated stage once, and drops unknown stages and steps", () => {
    const parsed = FunnelRpcSchema.parse({
      ...rpc([]),
      accounts: [{ week: "2026-10-05", signed_up_at: "2026-10-06T00:00Z", source: "x", stages: ["trial_started", "paid", "paid", "teleported"], steps: ["plan_shown", "beamed"], trial_ended: true, canceled: false }],
    });
    expect(parsed.accounts[0].steps).toEqual(["plan_shown"]);
    const r = buildFunnelReport(parsed, { monthlyUsd: 25 });
    expect([r.totals.counts.signed_up, r.totals.counts.paid]).toEqual([1, 1]);
  });

  it("reads a database without the steps (v1): every account untracked, its week standing in for its sign-up", () => {
    const v1 = FunnelRpcSchema.parse({
      time_zone: "UTC",
      generated_at: "2026-10-12T23:00:00Z",
      active_subscriptions: 0,
      kid_profiles: 0,
      accounts: [
        { week: "2026-10-12", source: "x", stages: ["signed_up", "trial_started"], canceled: false },
        { week: "2026-09-28", source: "x", stages: ["signed_up"], canceled: false },
      ],
    });
    expect(v1.tracking_since).toBeNull();
    const r = buildFunnelReport(v1, { monthlyUsd: 25 });
    expect([r.totals.counts.signed_up, r.totals.counts.checkout_opened, r.untracked]).toEqual([1, 1, 1]);
    expect(buildFunnelReport(v1, { monthlyUsd: 25, cohort: "tracked" }).totals.counts.signed_up).toBe(0);
    expect(buildFunnelReport(v1, { monthlyUsd: 25, cohort: "all" }).totals.counts.signed_up).toBe(2);
  });

  it("is empty with no accounts", () => {
    const r = buildFunnelReport(rpc([]), { monthlyUsd: 25 });
    expect(r.totals.counts.signed_up).toBe(0);
    expect([r.byWeek, r.bySource, r.mrrUsd, r.untracked]).toEqual([[], [], 0, 0]);
    expect(r.paths.every((p) => p.accounts === 0)).toBe(true);
  });

  it("refuses an answer of the wrong shape", () => {
    expect(FunnelRpcSchema.safeParse({ accounts: "nope" }).success).toBe(false);
    expect(FunnelRpcSchema.safeParse(rpc([{ ...A("2026-10-05", "2026-10-06T00:00Z", "x", []), week: "last week" }])).success).toBe(false);
  });
});

describe("isTimeZone / funnelUrl", () => {
  it("knows real zones and refuses anything else", () => {
    expect(isTimeZone("America/New_York")).toBe(true);
    expect(isTimeZone("UTC")).toBe(true);
    expect(isTimeZone("Mars/Olympus")).toBe(false);
    expect(isTimeZone("UTC'; drop table x")).toBe(false);
    expect(isTimeZone("")).toBe(false);
    expect(isTimeZone(5)).toBe(false);
  });

  it("asks the route in the viewer's zone, for a cohort other than the default", () => {
    expect(funnelUrl("America/Los_Angeles")).toBe("/api/admin/funnel?tz=America%2FLos_Angeles");
    expect(funnelUrl("America/Los_Angeles", "paywall")).toBe("/api/admin/funnel?tz=America%2FLos_Angeles");
    expect(funnelUrl("UTC", "all")).toBe("/api/admin/funnel?tz=UTC&cohort=all");
    expect(funnelUrl(null)).toBe("/api/admin/funnel");
    expect(funnelUrl(null, "tracked")).toBe("/api/admin/funnel?cohort=tracked");
  });
});

describe("the page view", () => {
  const report: FunnelReport = buildFunnelReport(SAMPLE, { monthlyUsd: 25 });

  it("puts the money first, over every sign-up: MRR, paying families of the ended trials, trials, sign-ups", () => {
    expect(funnelTiles(report)).toEqual([
      { key: "mrr", value: "$25", label: "MRR", hint: "1 active subscription × $25" },
      { key: "paying", value: "1", label: "Paying families", hint: "50% of 2 ended trials" },
      { key: "trials", value: "3", label: "Free trials", hint: "1 canceled" },
      { key: "signups", value: "9", label: "Sign-ups", hint: "Plus 3 kid profiles, not counted" },
    ]);
    const none = funnelTiles(buildFunnelReport(rpc([]), { monthlyUsd: 25 }));
    expect(none.map((t) => t.hint)).toEqual(["No active subscriptions", FUNNEL_COPY.noneEnded, "None canceled", "No kid profiles yet"]);
  });

  it("draws a bar per stage, scaled to sign-ups, each a share of the bar above; paying, of the ended trials", () => {
    const bars = funnelBars(report.totals);
    expect(bars.map((b) => b.stage)).toEqual([...FUNNEL_STAGES]);
    expect(bars.map((b) => [b.count, b.ofBefore])).toEqual([
      ["8", null],
      ["7", "88%"],
      ["6", "86%"],
      ["4", "67%"],
      ["3", "75%"],
      ["1", "33%"],
      ["0", "0%"],
      ["1", "50%"],
    ]);
    expect(bars[7].ofText).toBe(FUNNEL_COPY.ofEnded("50%", 2));
    expect(bars[7].ofText).toBe("50% of 2 ended trials");
    expect(bars[1].ratio).toBeCloseTo(7 / 8);
    expect(bars[3].summary).toBe(`Opened checkout: 4, ${FUNNEL_COPY.ofBefore("67%")}`);
    expect(funnelBars(buildFunnelReport(rpc([]), { monthlyUsd: 25 }).totals).every((b) => b.ratio === 0)).toBe(true);
  });

  it("says when no trial has ended yet, and nothing when there were no trials", () => {
    const running = buildFunnelReport(rpc([A("2026-10-12", "2026-10-12T20:00Z", "x", ["trial_started"])]), { monthlyUsd: 25 });
    expect(funnelBars(running.totals)[7]).toMatchObject({ count: "0", ofBefore: null, ofText: FUNNEL_COPY.noneEnded });
    const none = buildFunnelReport(rpc([A("2026-10-12", "2026-10-12T20:00Z", "x", [])]), { monthlyUsd: 25 });
    expect(funnelBars(none.totals)[7]).toMatchObject({ ofBefore: null, ofText: null });
  });

  it("lists the paths taken, in order, each with its share of the path's accounts", () => {
    const rows = pathRows(report.paths);
    expect(rows.map((r) => r.label)).toEqual([
      PATH_LABELS.left_welcome,
      PATH_LABELS.skipped_welcome,
      PATH_LABELS.skipped_tour,
      PATH_LABELS.skipped_tour_checked,
      PATH_LABELS.finished_tour,
    ]);
    expect(rows[1]).toMatchObject({ accounts: "1", planShown: { count: "1", pct: "100%", zero: false }, checkoutOpened: { count: "0", pct: "0%", zero: true } });
  });

  it("names the cohorts and the dates in the viewer's zone", () => {
    expect(cohortOptions().map((o) => o.value)).toEqual(["paywall", "tracked", "all"]);
    expect(shortDate(PAYWALL_AT, "America/New_York")).toBe("Oct 5");
    expect(shortDate("2026-10-13T02:00:00Z", "America/Los_Angeles")).toBe("Oct 12");
    expect(shortDate("2026-10-13T02:00:00Z", "Not/AZone")).toBe("Oct 13");
    expect(shortDate("soon")).toBe("soon");
    expect(FUNNEL_COPY.cohortHint("paywall", PAYWALL_AT, "America/New_York")).toContain("since Oct 5");
    expect(FUNNEL_COPY.cohortHint("tracked", null, "UTC")).toMatch(/not recorded a step/);
  });

  it("names the weeks and the sources", () => {
    expect(weekLabel("2026-10-05", 2026)).toEqual({ label: "Week of Oct 5", note: "Oct 5 – Oct 11" });
    expect(weekLabel("2025-12-29", 2026)).toEqual({ label: "Week of Dec 29, 2025", note: "Dec 29 – Jan 4" });
    expect(weekLabel("soon", 2026)).toEqual({ label: "soon", note: null });
    expect(sourceLabel("tiktok")).toEqual({ label: "TikTok", note: "told us at the welcome" });
    expect(sourceLabel("utm:newsletter")).toEqual({ label: "newsletter", note: "utm_source" });
    expect(sourceLabel("https://www.google.com")).toEqual({ label: "google.com", note: "linked from" });
    expect(sourceLabel("unknown")).toEqual({ label: "Unknown", note: "no answer, no link" });
  });

  it("builds the whole page: notes, paths, each table cell with its share of the row's sign-ups", () => {
    const view = buildFunnelView(report, Date.parse("2026-10-12T23:00:00Z"));
    expect([view.empty, view.emptyCohort]).toEqual([false, false]);
    expect(view.notes).toEqual([FUNNEL_COPY.week2Note, FUNNEL_COPY.paidNote, FUNNEL_COPY.untrackedNote(3, TRACKING, "America/New_York")]);
    expect(view.notes[2]).toMatch(/^3 accounts here signed up before Oct 12/);
    expect(view.pathsHint).toContain("since Oct 12");
    expect(view.paths).toHaveLength(5);
    expect(view.weeks[0].label).toBe("Week of Oct 12");
    const x = view.sources[0];
    expect(x.label).toBe("X (Twitter)");
    expect(x.cells.map((c) => [c.count, c.pct])).toEqual([
      ["4", null],
      ["3", "75%"],
      ["3", "75%"],
      ["1", "25%"],
      ["1", "25%"],
      ["0", "0%"],
      ["0", "0%"],
      ["0", "0%"],
    ]);
    expect(view.weeksHint).toContain("America/New York");
    const tracked = buildFunnelView(buildFunnelReport(SAMPLE, { monthlyUsd: 25, cohort: "tracked" }), 0);
    expect(tracked.notes).toEqual([FUNNEL_COPY.week2Note, FUNNEL_COPY.paidNote]);
  });

  it("is empty before anyone signs up, and empty-in-range when the cohort has nobody", () => {
    const nobody = buildFunnelView(buildFunnelReport(rpc([]), { monthlyUsd: 25 }), 0);
    expect([nobody.empty, nobody.emptyCohort]).toEqual([true, true]);
    const beforeTracking = buildFunnelView(buildFunnelReport(rpc(SAMPLE.accounts.slice(0, 2), { tracking_since: null }), { monthlyUsd: 25, cohort: "tracked" }), 0);
    expect([beforeTracking.empty, beforeTracking.emptyCohort]).toEqual([false, true]);
  });
});
