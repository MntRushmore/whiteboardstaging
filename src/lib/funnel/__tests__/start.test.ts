/**
 * The admin Funnel's "Before the account" (2026-10-13): admin_funnel() v3's `start` journeys
 * (supabase/migrations/20261013020000_start_steps.sql) added up per cohort (src/lib/funnel/report.ts
 * `startReached`, `buildStartFunnel`) and drawn (src/lib/funnel/funnelView.ts `startBars`,
 * `buildStartView`), from made-up answers. The migration's list of events is checked against the
 * contract's.
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { START_EVENTS, type StartEvent } from "@/lib/start/contracts";
import { PAYWALL_AT, START_STAGES, type StartStage } from "../contracts";
import { FUNNEL_COPY, START_STAGE_LABELS, buildFunnelView, buildStartView, startBars } from "../funnelView";
import { FunnelReportSchema, FunnelRpcSchema, buildFunnelReport, buildStartFunnel, startReached, type FunnelRpc } from "../report";

const TRACKING = "2026-10-12T19:30:42Z";
const WINDOW = "2026-08-14T14:07Z";

const J = (first_at: string, events: StartEvent[], n = 1) => ({ first_at, events, n });

const FULL: StartEvent[] = ["start_shown", "start_who", "start_name", "start_grade", "start_focus", "start_proof", "start_try_shown", "start_try_checked", "start_plan", "start_account_shown", "start_account"];

const START: NonNullable<FunnelRpc["start"]> = {
  since: WINDOW,
  journeys: [
    // before the paywall: in "all" only
    J("2026-10-04T12:00Z", ["start_shown"], 2),
    // left on the first screen
    J("2026-10-13T10:00Z", ["start_shown"], 3),
    // left after the grade
    J("2026-10-13T10:01Z", ["start_grade", "start_shown", "start_who"], 2),
    // skipped the try, left on the plan
    J("2026-10-13T10:02Z", ["start_grade", "start_name", "start_plan", "start_shown", "start_try_shown", "start_who"]),
    // all the way, with a checked line
    J("2026-10-13T10:03Z", FULL),
    // a kid who sent the plan to a grown-up
    J("2026-10-13T10:04Z", ["start_account_shown", "start_grade", "start_handoff", "start_plan", "start_shown", "start_try_shown", "start_who"]),
    // the grown-up who opened it and made the account; and one who opened it and left
    J("2026-10-13T11:00Z", ["start_account", "start_account_shown", "start_handoff_opened", "start_plan"]),
    J("2026-10-13T11:05Z", ["start_handoff_opened"]),
    // a journey whose earlier steps never arrived: the account stands for every step before it
    J("2026-10-13T11:06Z", ["start_account"]),
  ],
};

function rpc(start: FunnelRpc["start"], over: Partial<FunnelRpc> = {}): FunnelRpc {
  return {
    time_zone: "America/New_York",
    generated_at: "2026-10-13T23:00:00Z",
    tracking_since: TRACKING,
    active_subscriptions: 0,
    kid_profiles: 0,
    accounts: [{ week: "2026-10-12", signed_up_at: "2026-10-13T11:01Z", source: "x", stages: ["signed_up"], steps: [], trial_ended: false, canceled: false }],
    start,
    ...over,
  };
}

const counts = (c: Record<StartStage, number>) => START_STAGES.map((s) => c[s]);
const reached = (events: StartEvent[]) => {
  const r = startReached(events);
  return r === null ? null : [...r];
};

describe("startReached", () => {
  it("closes the chain: the furthest step stands for every step before it", () => {
    expect(reached(["start_plan"])).toEqual(["start_shown", "start_who", "start_grade", "start_try_shown", "start_plan"]);
    expect(reached(["start_account"])).toEqual(["start_shown", "start_who", "start_grade", "start_try_shown", "start_plan", "start_account_shown", "start_account"]);
    expect(reached(["start_shown"])).toEqual(["start_shown"]);
    expect(reached([])).toEqual([]);
  });

  it("reads the screens that are not bars as the step they come after", () => {
    expect(reached(["start_name"])).toEqual(["start_shown", "start_who"]);
    expect(reached(["start_focus"])).toEqual(["start_shown", "start_who", "start_grade"]);
    expect(reached(["start_proof"])).toEqual(["start_shown", "start_who", "start_grade"]);
    expect(reached(["start_handoff"])).toEqual(["start_shown", "start_who", "start_grade", "start_try_shown", "start_plan", "start_account_shown"]);
  });

  it("counts a checked line only when it was recorded: the try can be skipped", () => {
    expect(reached(["start_account"])).not.toContain("start_try_checked");
    expect(reached(["start_try_checked"])).toEqual(["start_shown", "start_who", "start_grade", "start_try_shown", "start_try_checked"]);
    expect(reached(["start_plan", "start_try_checked"])).toEqual(["start_shown", "start_who", "start_grade", "start_try_shown", "start_try_checked", "start_plan"]);
  });

  it("places the iPad's own steps on the same chain: the kid hand-off after the grade, the hand-back and the gate after the plan, the rest after the account", () => {
    expect(reached(["start_handoff_kid"])).toEqual(["start_shown", "start_who", "start_grade"]);
    expect(reached(["start_handoff_grownup"])).toEqual(["start_shown", "start_who", "start_grade", "start_try_shown", "start_plan"]);
    expect(reached(["start_gate", "start_try_checked"])).toEqual(["start_shown", "start_who", "start_grade", "start_try_shown", "start_try_checked", "start_plan"]);
    for (const event of ["start_trial_shown", "start_trial_started", "start_trial_pending", "start_trial_declined", "start_pin_set", "start_kid_added", "start_first_board"] as const) {
      expect(reached([event]), event).toEqual(["start_shown", "start_who", "start_grade", "start_try_shown", "start_plan", "start_account_shown", "start_account"]);
    }
  });

  it("leaves out a journey opened from a grown-up's link (it continues a kid's)", () => {
    expect(startReached(["start_handoff_opened", "start_plan", "start_account"])).toBeNull();
  });
});

describe("buildStartFunnel / the report's start", () => {
  it("counts the journeys of the cohort since the paywall, each at every step it reached", () => {
    const r = buildFunnelReport(rpc(START), { monthlyUsd: 25 });
    expect(r.start?.since).toBe(PAYWALL_AT);
    // started, who, grade, try board, checked line, plan, account screen, account
    expect(counts(r.start!.counts)).toEqual([9, 6, 6, 4, 1, 4, 3, 2]);
    expect(r.start?.handoff).toEqual({ sent: 1, opened: 2, accounts: 1 });
    expect(FunnelReportSchema.safeParse(r).success).toBe(true);
  });

  it("counts every journey the database lists for all time, from its 60-day window", () => {
    const r = buildFunnelReport(rpc(START), { monthlyUsd: 25, cohort: "all" });
    expect(r.start?.since).toBe(WINDOW);
    expect(counts(r.start!.counts)).toEqual([11, 6, 6, 4, 1, 4, 3, 2]);
  });

  it("starts at the later of the cohort and the window, to the minute", () => {
    const tracked = buildStartFunnel(START, "tracked", TRACKING);
    expect([tracked?.since, tracked?.counts.start_shown]).toEqual([TRACKING, 9]);
    const narrow = buildStartFunnel({ ...START, since: "2026-10-13T10:03Z" }, "paywall", PAYWALL_AT);
    expect(narrow?.since).toBe("2026-10-13T10:03Z");
    // the journeys from 10:03 on: the full one, the kid's and the lost one (the grown-ups are apart)
    expect(counts(narrow!.counts)).toEqual([3, 3, 3, 3, 1, 3, 3, 2]);
    // a journey in the very minute the cohort begins is in it (the cohort's start is to the second)
    const minute = buildStartFunnel({ since: WINDOW, journeys: [J("2026-10-12T19:30Z", ["start_shown"])] }, "tracked", TRACKING);
    expect(minute?.counts.start_shown).toBe(1);
  });

  it("has nobody for a cohort with no start, and is null on a database without the steps", () => {
    const none = buildStartFunnel(START, "tracked", null);
    expect(none?.since).toBeNull();
    expect(counts(none!.counts)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(buildStartFunnel(null, "paywall", PAYWALL_AT)).toBeNull();
  });
});

describe("admin_funnel()'s start, as the route reads it", () => {
  it("is null when the answer has none (v2), and drops unknown events", () => {
    const v2 = FunnelRpcSchema.parse({ ...rpc(null), start: undefined });
    expect(v2.start).toBeNull();
    expect(buildFunnelReport(v2, { monthlyUsd: 25 }).start).toBeNull();
    const v3 = FunnelRpcSchema.parse({ ...rpc(null), start: { since: WINDOW, journeys: [{ first_at: "2026-10-13T10:00Z", events: ["start_shown", "start_teleported"], n: 2 }] } });
    expect(v3.start?.journeys[0].events).toEqual(["start_shown"]);
  });

  it("refuses a group of the wrong shape", () => {
    expect(FunnelRpcSchema.safeParse({ ...rpc(null), start: { since: WINDOW, journeys: [{ first_at: "2026-10-13T10:00Z", events: [], n: 0 }] } }).success).toBe(false);
    expect(FunnelRpcSchema.safeParse({ ...rpc(null), start: { journeys: [] } }).success).toBe(false);
  });

  it("the page takes a report from a route without the start (null)", () => {
    const report = buildFunnelReport(rpc(START), { monthlyUsd: 25 });
    const { start: _omit, ...older } = report;
    void _omit;
    const parsed = FunnelReportSchema.safeParse(older);
    expect(parsed.success && parsed.data.start).toBeNull();
  });
});

describe("the section", () => {
  const report = buildFunnelReport(rpc(START), { monthlyUsd: 25 });

  it("draws a bar per step, scaled to the visits that started, each a share of the step before", () => {
    const bars = startBars(report.start!);
    expect(bars.map((b) => b.label)).toEqual(START_STAGES.map((s) => START_STAGE_LABELS[s]));
    expect(bars.map((b) => [b.stage, b.count, b.ofBefore])).toEqual([
      ["start_shown", "9", null],
      ["start_who", "6", "67%"],
      ["start_grade", "6", "100%"],
      ["start_try_shown", "4", "67%"],
      ["start_try_checked", "1", "25%"],
      ["start_plan", "4", "100%"],
      ["start_account_shown", "3", "75%"],
      ["start_account", "2", "67%"],
    ]);
    expect(bars[1].ratio).toBeCloseTo(6 / 9);
    expect(bars.map((b) => b.branch)).toEqual([false, false, false, false, true, false, false, false]);
  });

  it("puts the plan against the try board, not the checked line (the try can be skipped)", () => {
    const bars = startBars(report.start!);
    expect(bars[4].ofText).toBe(FUNNEL_COPY.ofBefore("25%"));
    expect(bars[5].ofText).toBe(FUNNEL_COPY.ofTryBoard("100%"));
    expect(bars[5].summary).toBe("Saw the plan: 4, 100% of those who saw the try board");
  });

  it("says where the count begins, the try's note, and the quiet hand-off line", () => {
    const view = buildStartView(report);
    expect([view.missing, view.empty]).toEqual([false, false]);
    expect(view.hint).toBe(FUNNEL_COPY.startHint(PAYWALL_AT, "America/New_York"));
    expect(view.hint).toContain("since Oct 5");
    expect(view.notes).toEqual([
      FUNNEL_COPY.startTryNote,
      "1 kid sent their plan to a grown-up; 2 opened it, and 1 of them made the account. Visits opened from a grown-up's link are counted here, not in the bars.",
    ]);
    expect(FUNNEL_COPY.startHandoff(0, 0, 0)).toBe("No kid has sent their plan to a grown-up yet.");
    expect(FUNNEL_COPY.startHandoff(3, 0, 0)).toBe("3 kids sent their plan to a grown-up; 0 opened it. Visits opened from a grown-up's link are counted here, not in the bars.");
  });

  it("is empty before any journey, and says so when the database does not count them", () => {
    const empty = buildStartView(buildFunnelReport(rpc({ since: WINDOW, journeys: [] }), { monthlyUsd: 25 }));
    expect([empty.missing, empty.empty, empty.bars, empty.notes]).toEqual([false, true, [], []]);
    const missing = buildStartView(buildFunnelReport(rpc(null), { monthlyUsd: 25 }));
    expect([missing.missing, missing.empty, missing.bars]).toEqual([true, true, []]);
    // only grown-ups' links opened: not empty (the line says so), and the bars are all zero
    const opened = buildStartView(buildFunnelReport(rpc({ since: WINDOW, journeys: [J("2026-10-13T11:05Z", ["start_handoff_opened"])] }), { monthlyUsd: 25 }));
    expect([opened.empty, opened.bars.every((b) => b.ratio === 0 && b.ofBefore === null)]).toEqual([false, true]);
  });

  it("is part of the page's view", () => {
    const view = buildFunnelView(report, Date.parse("2026-10-13T23:00:00Z"));
    expect(view.start.bars).toHaveLength(START_STAGES.length);
  });
});

describe("the migration", () => {
  const sql = readFileSync(new URL("../../../../supabase/migrations/20261013020000_start_steps.sql", import.meta.url), "utf8");

  it("knows exactly the contract's events, in its order (the latest migration that sets the check: the iPad's, 20261017210000)", () => {
    const dir = new URL("../../../../supabase/migrations/", import.meta.url);
    const latest = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => readFileSync(new URL(f, dir), "utf8"))
      .filter((text) => text.includes("add constraint start_steps_event_known"))
      .at(-1)!;
    expect(latest).toContain("start_first_board");
    const check = latest.match(/start_steps_event_known check \(event in \(([\s\S]*?)\)\)/)?.[1] ?? "";
    expect([...check.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])).toEqual([...START_EVENTS]);
  });

  it("keeps a meta of at most 500 bytes, and gives admin_funnel no ids", () => {
    expect(sql).toContain("octet_length(meta::text) <= 500");
    const start = sql.slice(sql.indexOf("'start', jsonb_build_object("));
    expect(start).toContain("jsonb_build_object('first_at', g.first_at, 'events', to_jsonb(g.events), 'n', g.n)");
    expect(start.slice(0, start.indexOf("into v_out"))).not.toMatch(/journey_id|user_id/);
  });
});
