/**
 * The admin Funnel page in words and numbers (2026-10-09): the money at the top, a bar per stage
 * with its share of the stage before, and the same stages per sign-up week and per source. Pure
 * like the console's other view modules (no React, no network): the page renders what this
 * returns, and every line is tested (src/lib/funnel/__tests__/funnelView.test.ts).
 *
 * The owner's questions it answers: how much money comes in, which channel brings people who stay,
 * and where they stop.
 */
import { percentOf } from "@/lib/admin/consoleView";
import { formatCount, plural } from "@/lib/admin/view";
import { FUNNEL_STAGES, HEARD_FROM, type FunnelReport, type FunnelRow, type FunnelStage } from "./contracts";

export const FUNNEL_COPY = {
  title: "Funnel",
  hint: "Where sign-ups come from and how far they get. Kid profiles and admins are left out; a family counts once, with its kids' practice.",
  loadWhat: "the funnel",
  moneyTitle: "Money",
  stagesTitle: "From sign-up to paying",
  stagesHint: "How many accounts got this far, and the share of the step before.",
  week2Note: "Came back in week 2 can only count accounts at least a week old.",
  weeksTitle: "By sign-up week",
  weeksHint: (timeZone: string) => `Weeks start on Monday, in ${timeZone.replace(/_/g, " ")}. Each cell: accounts, and the share of that week's sign-ups.`,
  sourcesTitle: "By source",
  sourcesHint: "What they told us at the welcome, else the link's utm_source, else the site that sent them.",
  weekColumn: "Week",
  sourceColumn: "Source",
  canceledColumn: "Canceled",
  emptyTitle: "No sign-ups yet",
  emptyHint: "Once someone makes an account, they show up here.",
  weeksCaption: "Funnel by sign-up week",
  sourcesCaption: "Funnel by source",
  ofBefore: (pct: string) => `${pct} of the step before`,
  /** the paying bar: paying is measured against free trials, since not every payer came back in week 2 */
  ofTrials: (pct: string) => `${pct} of free trials`,
  ofSignups: (pct: string) => `${pct} of sign-ups`,
} as const;

/** Each stage as the owner reads it. */
export const STAGE_LABELS: Record<FunnelStage, string> = {
  signed_up: "Signed up",
  onboarded: "Finished the welcome",
  first_problem: "Tried a problem",
  trial_started: "Started the free trial",
  came_back_day2: "Came back another day",
  came_back_week2: "Came back in week 2",
  paid: "Paying",
};

/** The table headers: short enough for a column. */
export const STAGE_SHORT: Record<FunnelStage, string> = {
  signed_up: "Signed up",
  onboarded: "Welcome",
  first_problem: "Problem",
  trial_started: "Trial",
  came_back_day2: "Day 2",
  came_back_week2: "Week 2",
  paid: "Paying",
};

// ------------------------------------------------------------------ money

export interface FunnelTile {
  key: "mrr" | "paying" | "trials" | "signups";
  value: string;
  label: string;
  hint: string;
}

const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** "$1,000" */
export function formatUsd(amount: number): string {
  return USD.format(Math.max(0, Math.round(amount)));
}

/** MRR and paying families first, then trials and sign-ups. */
export function funnelTiles(report: FunnelReport): FunnelTile[] {
  const t = report.totals;
  const perSub = report.activeSubscriptions > 0 ? report.mrrUsd / report.activeSubscriptions : null;
  const trialPct = percentOf(t.counts.paid, t.counts.trial_started);
  return [
    {
      key: "mrr",
      value: formatUsd(report.mrrUsd),
      label: "MRR",
      hint: perSub === null ? "No active subscriptions" : `${plural(report.activeSubscriptions, "active subscription")} × ${formatUsd(perSub)}`,
    },
    { key: "paying", value: formatCount(t.counts.paid), label: "Paying families", hint: trialPct ? `${trialPct} of free trials` : "No free trials yet" },
    { key: "trials", value: formatCount(t.counts.trial_started), label: "Free trials", hint: t.canceled > 0 ? `${formatCount(t.canceled)} canceled` : "None canceled" },
    {
      key: "signups",
      value: formatCount(t.counts.signed_up),
      label: "Sign-ups",
      hint: report.kidProfiles > 0 ? `Plus ${plural(report.kidProfiles, "kid profile")}, not counted` : "No kid profiles yet",
    },
  ];
}

// ------------------------------------------------------------------ the bars

export interface FunnelBarView {
  stage: FunnelStage;
  label: string;
  count: string;
  /** of sign-ups, 0..1: the bar's length */
  ratio: number;
  /** "62%" of the stage before (of free trials for the paying bar); null for the first stage or when that stage had none */
  ofBefore: string | null;
  /** that share in words: "62% of the step before", "40% of free trials" */
  ofText: string | null;
  /** the whole bar for a screen reader: "Tried a problem: 12, 62% of the step before" */
  summary: string;
}

/** One bar per stage, in order, each scaled to the sign-ups. */
export function funnelBars(row: FunnelRow): FunnelBarView[] {
  const total = row.counts.signed_up;
  return FUNNEL_STAGES.map((stage, i) => {
    const n = row.counts[stage];
    // paying is a share of the free trials: a payer need not have come back in week 2 (the stage before)
    const base: FunnelStage | null = stage === "paid" ? "trial_started" : i === 0 ? null : FUNNEL_STAGES[i - 1];
    const ofBefore = base === null ? null : percentOf(n, row.counts[base]);
    const ofText = ofBefore === null ? null : stage === "paid" ? FUNNEL_COPY.ofTrials(ofBefore) : FUNNEL_COPY.ofBefore(ofBefore);
    const label = STAGE_LABELS[stage];
    return {
      stage,
      label,
      count: formatCount(n),
      ratio: total > 0 ? Math.min(1, n / total) : 0,
      ofBefore,
      ofText,
      summary: `${label}: ${formatCount(n)}${ofText ? `, ${ofText}` : ""}`,
    };
  });
}

// ------------------------------------------------------------------ the tables

export interface FunnelCellView {
  stage: FunnelStage;
  count: string;
  /** share of the row's sign-ups ("40%"); null for the sign-ups column itself, or none */
  pct: string | null;
  zero: boolean;
}

export interface FunnelTableRowView {
  key: string;
  label: string;
  /** a second line: what kind of source it is, or the week's dates */
  note: string | null;
  cells: FunnelCellView[];
  canceled: string;
}

function cells(row: FunnelRow): FunnelCellView[] {
  return FUNNEL_STAGES.map((stage) => ({
    stage,
    count: formatCount(row.counts[stage]),
    pct: stage === "signed_up" ? null : percentOf(row.counts[stage], row.counts.signed_up),
    zero: row.counts[stage] === 0,
  }));
}

const MONTH_DAY = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
const MONTH_DAY_YEAR = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });

/** "Week of Oct 5" (with the year when it is not `thisYear`), and "Oct 5 – Oct 11". */
export function weekLabel(monday: string, thisYear: number): { label: string; note: string | null } {
  const t = Date.parse(`${monday}T00:00:00Z`);
  if (!Number.isFinite(t)) return { label: monday, note: null };
  const start = new Date(t);
  const end = new Date(t + 6 * 86_400_000);
  const fmt = start.getUTCFullYear() === thisYear ? MONTH_DAY : MONTH_DAY_YEAR;
  return { label: `Week of ${fmt.format(start)}`, note: `${MONTH_DAY.format(start)} – ${MONTH_DAY.format(end)}` };
}

const HEARD = new Map<string, string>(HEARD_FROM.map((h) => [h.id, h.label]));

/** A source key in words: what they told us, a utm_source, a site that linked, or unknown. */
export function sourceLabel(key: string): { label: string; note: string } {
  const heard = HEARD.get(key);
  if (heard) return { label: heard, note: "told us at the welcome" };
  if (key.startsWith("utm:")) return { label: key.slice(4) || "(empty)", note: "utm_source" };
  if (/^https?:\/\//i.test(key)) {
    let host = key.replace(/^https?:\/\//i, "");
    host = host.replace(/^www\./i, "");
    return { label: host, note: "linked from" };
  }
  if (key === "unknown") return { label: "Unknown", note: "no answer, no link" };
  return { label: key, note: "other" };
}

/** The weeks, newest first, as table rows. */
export function weekRows(report: FunnelReport, now: number): FunnelTableRowView[] {
  const year = new Date(now).getUTCFullYear();
  return report.byWeek.map((row) => {
    const { label, note } = weekLabel(row.key, year);
    return { key: row.key, label, note, cells: cells(row), canceled: formatCount(row.canceled) };
  });
}

/** The sources, most sign-ups first, as table rows. */
export function sourceRows(report: FunnelReport): FunnelTableRowView[] {
  return report.bySource.map((row) => {
    const { label, note } = sourceLabel(row.key);
    return { key: row.key, label, note, cells: cells(row), canceled: formatCount(row.canceled) };
  });
}

// ------------------------------------------------------------------ the page

export interface FunnelView {
  empty: boolean;
  tiles: FunnelTile[];
  bars: FunnelBarView[];
  weeks: FunnelTableRowView[];
  sources: FunnelTableRowView[];
  weeksHint: string;
}

/** Everything the page shows, from the route's report. */
export function buildFunnelView(report: FunnelReport, now: number): FunnelView {
  return {
    empty: report.totals.counts.signed_up === 0,
    tiles: funnelTiles(report),
    bars: funnelBars(report.totals),
    weeks: weekRows(report, now),
    sources: sourceRows(report),
    weeksHint: FUNNEL_COPY.weeksHint(report.timeZone),
  };
}
