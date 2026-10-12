/**
 * The admin Funnel page in words and numbers (2026-10-09, honest chain 2026-10-12): the money at
 * the top, a bar per stage with its share of the stage before, how sign-ups left the welcome and
 * the guided board, and the same stages per sign-up week and per source. Pure like the console's
 * other view modules (no React, no network): the page renders what this returns, and every line is
 * tested (src/lib/funnel/__tests__/report.test.ts).
 *
 * The owner's questions it answers: how much money comes in, which channel brings people who stay,
 * and where they stop.
 */
import { percentOf } from "@/lib/admin/consoleView";
import { formatCount, plural } from "@/lib/admin/view";
import { FUNNEL_COHORTS, FUNNEL_STAGES, HEARD_FROM, type FunnelCohort, type FunnelPath, type FunnelPathRow, type FunnelReport, type FunnelRow, type FunnelStage } from "./contracts";

const DATE = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });

/** "Oct 5", in the viewer's zone when given (the day tracking began is a moment, not a calendar day) */
export function shortDate(iso: string, timeZone?: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: timeZone ?? "UTC", month: "short", day: "numeric" }).format(t);
  } catch {
    return DATE.format(t);
  }
}

export const FUNNEL_COPY = {
  title: "Funnel",
  hint: "Where sign-ups come from and how far they get. Kid profiles and admins are left out; a family counts once, with its kids' practice.",
  loadWhat: "the funnel",
  cohortLabel: "Which sign-ups",
  cohorts: { paywall: "Since the paywall", tracked: "Since tracking began", all: "All time" } satisfies Record<FunnelCohort, string>,
  cohortHint: (cohort: FunnelCohort, since: string | null, timeZone: string): string => {
    if (cohort === "all") return "Every sign-up, including the free weeks before the paywall.";
    if (since === null) return "The app has not recorded a step yet, so there is nobody to count here.";
    const day = shortDate(since, timeZone);
    return cohort === "paywall" ? `Sign-ups since ${day}, when the free plan ended and the trial began.` : `Sign-ups since ${day}, when the app began recording each step.`;
  },
  moneyTitle: "Money",
  moneyHint: "Every sign-up, whichever are picked above.",
  stagesTitle: "From sign-up to paying",
  stagesHint: "How many got this far. Each step counts only accounts that made the steps above it; Paying counts the trials that have ended.",
  week2Note: "Came back in week 2 can only count accounts at least a week old.",
  paidNote: "Paying is a share of the free trials that have ended; a trial still running has not had its chance yet.",
  untrackedNote: (n: number, since: string | null, timeZone: string) =>
    since === null
      ? `The app has not recorded the plan screen or checkout yet, so those steps count only the ${plural(n, "account")} that went on to a trial.`
      : `${plural(n, "account")} here signed up before ${shortDate(since, timeZone)}, when the app began recording the plan screen and checkout. They count there only when a later step shows they got that far.`,
  pathsTitle: "Before the plan screen",
  pathsHint: (since: string | null, timeZone: string) =>
    since === null
      ? "How each account left the welcome and the guided board, and how many went on. Nothing is recorded yet."
      : `How each account left the welcome and the guided board, and how many went on. Only accounts whose steps were recorded (since ${shortDate(since, timeZone)}).`,
  pathsEmpty: "No recorded steps among these sign-ups yet.",
  pathsCaption: "How sign-ups left the welcome and the guided board",
  pathColumn: "What they did",
  pathColumns: { accounts: "Accounts", planShown: "Saw the plan", checkoutOpened: "Opened checkout", trialStarted: "Started a trial" },
  weeksTitle: "By sign-up week",
  weeksHint: (timeZone: string) => `Weeks start on Monday, in ${timeZone.replace(/_/g, " ")}. Each cell: accounts, and the share of that week's sign-ups.`,
  sourcesTitle: "By source",
  sourcesHint: "What they told us at the welcome, else the link's utm_source, else the site that sent them.",
  weekColumn: "Week",
  sourceColumn: "Source",
  canceledColumn: "Canceled",
  emptyTitle: "No sign-ups yet",
  emptyHint: "Once someone makes an account, they show up here.",
  emptyCohortTitle: "No sign-ups in this range",
  emptyCohortHint: "Pick a wider range above, or check back once someone signs up.",
  weeksCaption: "Funnel by sign-up week",
  sourcesCaption: "Funnel by source",
  ofBefore: (pct: string) => `${pct} of the step before`,
  /** the paying bar: a share of the trials that are over */
  ofEnded: (pct: string, ended: number) => `${pct} of ${plural(ended, "ended trial")}`,
  noneEnded: "No free trial has ended yet",
  ofSignups: (pct: string) => `${pct} of sign-ups`,
} as const;

/** Each stage as the owner reads it. */
export const STAGE_LABELS: Record<FunnelStage, string> = {
  signed_up: "Signed up",
  onboarded: "Finished or skipped the welcome",
  plan_shown: "Saw the plan screen",
  checkout_opened: "Opened checkout",
  trial_started: "Started the free trial",
  came_back_day2: "Came back another day",
  came_back_week2: "Came back in week 2",
  paid: "Paying",
};

/** The table headers: short enough for a column. */
export const STAGE_SHORT: Record<FunnelStage, string> = {
  signed_up: "Signed up",
  onboarded: "Welcome",
  plan_shown: "Plan",
  checkout_opened: "Checkout",
  trial_started: "Trial",
  came_back_day2: "Day 2",
  came_back_week2: "Week 2",
  paid: "Paying",
};

/** How each path reads (FUNNEL_PATHS). */
export const PATH_LABELS: Record<FunnelPath, string> = {
  left_welcome: "Left during the welcome",
  skipped_welcome: "Skipped the welcome",
  left_board: "Left the guided board",
  skipped_tour: "Skipped the tour before a checked line",
  skipped_tour_checked: "Skipped the tour after a checked line",
  finished_tour: "Finished the tour",
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

/** MRR and paying families first, then trials and sign-ups: every account, whatever the cohort. */
export function funnelTiles(report: FunnelReport): FunnelTile[] {
  const t = report.allTime;
  const perSub = report.activeSubscriptions > 0 ? report.mrrUsd / report.activeSubscriptions : null;
  const endedPct = percentOf(t.counts.paid, t.trialsEnded);
  return [
    {
      key: "mrr",
      value: formatUsd(report.mrrUsd),
      label: "MRR",
      hint: perSub === null ? "No active subscriptions" : `${plural(report.activeSubscriptions, "active subscription")} × ${formatUsd(perSub)}`,
    },
    { key: "paying", value: formatCount(t.counts.paid), label: "Paying families", hint: endedPct ? FUNNEL_COPY.ofEnded(endedPct, t.trialsEnded) : FUNNEL_COPY.noneEnded },
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
  /** "62%" of the stage before (of the ended trials for the paying bar); null for the first stage or when that stage had none */
  ofBefore: string | null;
  /** that share in words: "62% of the step before", "40% of 5 ended trials", "No free trial has ended yet" */
  ofText: string | null;
  /** the whole bar for a screen reader: "Tried a problem: 12, 62% of the step before" */
  summary: string;
}

/** One bar per stage, in order, each scaled to the sign-ups. */
export function funnelBars(row: FunnelRow): FunnelBarView[] {
  const total = row.counts.signed_up;
  return FUNNEL_STAGES.map((stage, i) => {
    const n = row.counts[stage];
    // paying is a share of the trials that are over: a payer need not have come back in week 2
    // (the bar before), and a trial still running has not had its chance to pay
    if (stage === "paid") {
      const ofBefore = percentOf(n, row.trialsEnded);
      const ofText = ofBefore === null ? (row.counts.trial_started > 0 ? FUNNEL_COPY.noneEnded : null) : FUNNEL_COPY.ofEnded(ofBefore, row.trialsEnded);
      const label = STAGE_LABELS[stage];
      return { stage, label, count: formatCount(n), ratio: total > 0 ? Math.min(1, n / total) : 0, ofBefore, ofText, summary: `${label}: ${formatCount(n)}${ofText ? `, ${ofText}` : ""}` };
    }
    const base: FunnelStage | null = i === 0 ? null : FUNNEL_STAGES[i - 1];
    const ofBefore = base === null ? null : percentOf(n, row.counts[base]);
    const ofText = ofBefore === null ? null : FUNNEL_COPY.ofBefore(ofBefore);
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

// ------------------------------------------------------------------ before the plan screen

export interface FunnelPathCellView {
  count: string;
  /** share of the path's accounts ("40%"); null when it had none */
  pct: string | null;
  zero: boolean;
}

export interface FunnelPathRowView {
  path: FunnelPath;
  label: string;
  accounts: string;
  planShown: FunnelPathCellView;
  checkoutOpened: FunnelPathCellView;
  trialStarted: FunnelPathCellView;
}

function pathCell(n: number, of: number): FunnelPathCellView {
  return { count: formatCount(n), pct: percentOf(n, of), zero: n === 0 };
}

/** The paths, in FUNNEL_PATHS order, without the ones nobody took. */
export function pathRows(paths: readonly FunnelPathRow[]): FunnelPathRowView[] {
  return paths
    .filter((p) => p.accounts > 0)
    .map((p) => ({
      path: p.path,
      label: PATH_LABELS[p.path],
      accounts: formatCount(p.accounts),
      planShown: pathCell(p.planShown, p.accounts),
      checkoutOpened: pathCell(p.checkoutOpened, p.accounts),
      trialStarted: pathCell(p.trialStarted, p.accounts),
    }));
}

// ------------------------------------------------------------------ the page

export interface FunnelCohortOption {
  value: FunnelCohort;
  label: string;
}

/** The cohort switch's options, in FUNNEL_COHORTS order. */
export function cohortOptions(): FunnelCohortOption[] {
  return FUNNEL_COHORTS.map((value) => ({ value, label: FUNNEL_COPY.cohorts[value] }));
}

export interface FunnelView {
  /** nobody has signed up at all: the page's calm empty state */
  empty: boolean;
  /** nobody in the picked cohort (the money still shows) */
  emptyCohort: boolean;
  cohortHint: string;
  tiles: FunnelTile[];
  bars: FunnelBarView[];
  /** the notes under the bars: week 2's, paying's, and the untracked accounts' when some are counted */
  notes: string[];
  paths: FunnelPathRowView[];
  pathsHint: string;
  weeks: FunnelTableRowView[];
  sources: FunnelTableRowView[];
  weeksHint: string;
}

/** Everything the page shows, from the route's report. */
export function buildFunnelView(report: FunnelReport, now: number): FunnelView {
  const notes: string[] = [FUNNEL_COPY.week2Note, FUNNEL_COPY.paidNote];
  if (report.untracked > 0) notes.push(FUNNEL_COPY.untrackedNote(report.untracked, report.trackingSince, report.timeZone));
  return {
    empty: report.allTime.counts.signed_up === 0,
    emptyCohort: report.totals.counts.signed_up === 0,
    cohortHint: FUNNEL_COPY.cohortHint(report.cohort, report.cohort === "all" ? null : report.cohortSince, report.timeZone),
    tiles: funnelTiles(report),
    bars: funnelBars(report.totals),
    notes,
    paths: pathRows(report.paths),
    pathsHint: FUNNEL_COPY.pathsHint(report.trackingSince, report.timeZone),
    weeks: weekRows(report, now),
    sources: sourceRows(report),
    weeksHint: FUNNEL_COPY.weeksHint(report.timeZone),
  };
}
