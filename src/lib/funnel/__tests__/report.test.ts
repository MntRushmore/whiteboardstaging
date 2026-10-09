/**
 * The admin Funnel's adding up (src/lib/funnel/report.ts) and its page view
 * (src/lib/funnel/funnelView.ts), from made-up admin_funnel() answers.
 */
import { describe, expect, it } from "vitest";
import { FUNNEL_STAGES, type FunnelReport } from "../contracts";
import { FUNNEL_COPY, buildFunnelView, funnelBars, funnelTiles, sourceLabel, weekLabel } from "../funnelView";
import { FunnelReportSchema, FunnelRpcSchema, buildFunnelReport, funnelUrl, isTimeZone, type FunnelRpc } from "../report";

function rpc(accounts: FunnelRpc["accounts"], over: Partial<FunnelRpc> = {}): FunnelRpc {
  return { time_zone: "America/New_York", generated_at: "2026-10-09T15:00:00Z", active_subscriptions: 0, kid_profiles: 0, accounts, ...over };
}

const A = (week: string, source: string, stages: string[], canceled = false) => ({ week, source, stages: stages as FunnelRpc["accounts"][number]["stages"], canceled });

const SAMPLE = rpc(
  [
    A("2026-09-28", "tiktok", ["signed_up", "onboarded", "first_problem", "trial_started", "came_back_day2", "paid"]),
    A("2026-09-28", "tiktok", ["signed_up", "onboarded"]),
    A("2026-10-05", "utm:newsletter", ["signed_up", "onboarded", "first_problem", "trial_started"], true),
    A("2026-10-05", "unknown", ["signed_up"]),
    A("2026-10-05", "tiktok", ["signed_up", "onboarded", "first_problem", "trial_started", "came_back_day2"]),
  ],
  { active_subscriptions: 1, kid_profiles: 3 },
);

describe("buildFunnelReport", () => {
  const report = buildFunnelReport(SAMPLE, { monthlyUsd: 25 });

  it("adds every account to the totals, a stage at a time", () => {
    expect(report.totals.key).toBe("all");
    expect(report.totals.counts).toEqual({
      signed_up: 5,
      onboarded: 4,
      first_problem: 3,
      trial_started: 3,
      came_back_day2: 2,
      came_back_week2: 0,
      paid: 1,
    });
    expect(report.totals.canceled).toBe(1);
  });

  it("groups by week (newest first) and by source (most sign-ups first, ties by name)", () => {
    expect(report.byWeek.map((r) => [r.key, r.counts.signed_up, r.counts.paid])).toEqual([
      ["2026-10-05", 3, 0],
      ["2026-09-28", 2, 1],
    ]);
    expect(report.bySource.map((r) => [r.key, r.counts.signed_up])).toEqual([
      ["tiktok", 3],
      ["unknown", 1],
      ["utm:newsletter", 1],
    ]);
    expect(report.bySource.find((r) => r.key === "utm:newsletter")?.canceled).toBe(1);
  });

  it("prices MRR from the active subscriptions, and passes the kids and the zone through", () => {
    expect([report.mrrUsd, report.activeSubscriptions, report.kidProfiles, report.timeZone, report.generatedAt]).toEqual([25, 1, 3, "America/New_York", "2026-10-09T15:00:00Z"]);
    expect(FunnelReportSchema.safeParse(report).success).toBe(true);
  });

  it("counts a sign-up even when the list forgets it, a repeated stage once, and drops unknown stages", () => {
    const parsed = FunnelRpcSchema.parse({ ...rpc([]), accounts: [{ week: "2026-10-05", source: "x", stages: ["paid", "paid", "teleported"], canceled: false }] });
    const r = buildFunnelReport(parsed, { monthlyUsd: 25 });
    expect(r.totals.counts.signed_up).toBe(1);
    expect(r.totals.counts.paid).toBe(1);
  });

  it("is empty with no accounts", () => {
    const r = buildFunnelReport(rpc([]), { monthlyUsd: 25 });
    expect(r.totals.counts.signed_up).toBe(0);
    expect([r.byWeek, r.bySource, r.mrrUsd]).toEqual([[], [], 0]);
  });

  it("refuses an answer of the wrong shape", () => {
    expect(FunnelRpcSchema.safeParse({ accounts: "nope" }).success).toBe(false);
    expect(FunnelRpcSchema.safeParse(rpc([{ week: "last week", source: "x", stages: [], canceled: false }])).success).toBe(false);
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

  it("asks the route in the viewer's zone", () => {
    expect(funnelUrl("America/Los_Angeles")).toBe("/api/admin/funnel?tz=America%2FLos_Angeles");
    expect(funnelUrl(null)).toBe("/api/admin/funnel");
  });
});

describe("the page view", () => {
  const report: FunnelReport = buildFunnelReport(SAMPLE, { monthlyUsd: 25 });

  it("puts the money first: MRR, paying families, trials, sign-ups", () => {
    expect(funnelTiles(report)).toEqual([
      { key: "mrr", value: "$25", label: "MRR", hint: "1 active subscription × $25" },
      { key: "paying", value: "1", label: "Paying families", hint: "33% of free trials" },
      { key: "trials", value: "3", label: "Free trials", hint: "1 canceled" },
      { key: "signups", value: "5", label: "Sign-ups", hint: "Plus 3 kid profiles, not counted" },
    ]);
    const none = funnelTiles(buildFunnelReport(rpc([]), { monthlyUsd: 25 }));
    expect(none.map((t) => t.hint)).toEqual(["No active subscriptions", "No free trials yet", "None canceled", "No kid profiles yet"]);
  });

  it("draws a bar per stage, scaled to sign-ups, with the share of the step before", () => {
    const bars = funnelBars(report.totals);
    expect(bars.map((b) => b.stage)).toEqual([...FUNNEL_STAGES]);
    expect(bars.map((b) => [b.count, b.ofBefore])).toEqual([
      ["5", null],
      ["4", "80%"],
      ["3", "75%"],
      ["3", "100%"],
      ["2", "67%"],
      ["0", "0%"],
      ["1", "33%"], // paying is a share of the free trials (3), not of week 2 (nobody yet)
    ]);
    expect(bars[6].ofText).toBe(FUNNEL_COPY.ofTrials("33%"));
    expect(bars[1].ratio).toBeCloseTo(0.8);
    expect(bars[2].summary).toBe(`Tried a problem: 3, ${FUNNEL_COPY.ofBefore("75%")}`);
    expect(funnelBars(buildFunnelReport(rpc([]), { monthlyUsd: 25 }).totals).every((b) => b.ratio === 0)).toBe(true);
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

  it("builds the whole page, each table cell with its share of the row's sign-ups", () => {
    const view = buildFunnelView(report, Date.parse("2026-10-09T15:00:00Z"));
    expect(view.empty).toBe(false);
    expect(view.weeks[0].label).toBe("Week of Oct 5");
    const tiktok = view.sources[0];
    expect(tiktok.label).toBe("TikTok");
    expect(tiktok.cells.map((c) => [c.count, c.pct])).toEqual([
      ["3", null],
      ["3", "100%"],
      ["2", "67%"],
      ["2", "67%"],
      ["2", "67%"],
      ["0", "0%"],
      ["1", "33%"],
    ]);
    expect(view.weeksHint).toContain("America/New York");
    expect(buildFunnelView(buildFunnelReport(rpc([]), { monthlyUsd: 25 }), 0).empty).toBe(true);
  });
});
