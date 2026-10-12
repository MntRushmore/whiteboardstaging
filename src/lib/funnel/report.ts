/**
 * The admin Funnel's numbers (GET /api/admin/funnel): admin_funnel()'s per-account answer
 * (supabase/migrations/20261012020000_funnel_steps.sql, v2 of 20261009020000_funnel.sql) added up
 * into a FunnelReport for one cohort of sign-ups — the totals, one row per sign-up week, one per
 * source, how they left the welcome and the guided board — and the schema the page checks the
 * route's answer with.
 *
 * Pure (zod only, no network): the server builds the report here and the tests drive it with
 * made-up accounts. The adding up lives here, not in SQL, so every rule of it is one test away.
 */
import { z } from "zod";
import {
  DEFAULT_FUNNEL_COHORT,
  FUNNEL_COHORTS,
  FUNNEL_PATHS,
  FUNNEL_STAGES,
  PAYWALL_AT,
  type FunnelCohort,
  type FunnelPath,
  type FunnelPathRow,
  type FunnelReport,
  type FunnelRow,
  type FunnelStage,
} from "./contracts";
import { FUNNEL_STEPS, type FunnelStep } from "./steps";

/** The page and its route. */
export const FUNNEL_ROUTES = {
  page: "/admin/funnel",
  api: "/api/admin/funnel",
} as const;

/** The zone the weeks are read in when the page does not say (Agathon's families are in the US). */
export const DEFAULT_FUNNEL_TIME_ZONE = "America/New_York";

/** The route's URL for the viewer's zone and a cohort (the default one is left out). */
export function funnelUrl(timeZone: string | null | undefined, cohort: FunnelCohort = DEFAULT_FUNNEL_COHORT): string {
  const query = new URLSearchParams();
  if (timeZone) query.set("tz", timeZone);
  if (cohort !== DEFAULT_FUNNEL_COHORT) query.set("cohort", cohort);
  const text = query.toString();
  return text ? `${FUNNEL_ROUTES.api}?${text}` : FUNNEL_ROUTES.api;
}

/** An IANA zone name the runtime knows ("America/New_York", "UTC"); nothing else reaches the database. */
export function isTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9_+\-/]{0,63}$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ admin_funnel()'s answer

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function known<T extends string>(list: readonly T[]) {
  return z.array(z.string()).transform((items) => items.filter((s): s is T => (list as readonly string[]).includes(s)));
}

/**
 * One account in admin_funnel()'s answer. Unknown stage and step names are dropped, not refused (a
 * newer database). The fields v2 added default to "not known" so the page still shows against a
 * database without 20261012020000_funnel_steps.sql (every account then counts as untracked).
 */
const FunnelAccountSchema = z.object({
  week: z.string().regex(DAY),
  /** the sign-up's instant to the minute (v2); absent before it */
  signed_up_at: z.string().nullish().default(null),
  source: z.string().min(1).max(240),
  stages: known(FUNNEL_STAGES),
  steps: known(FUNNEL_STEPS).nullish().transform((v) => v ?? []),
  trial_ended: z.boolean().nullish().transform((v) => v ?? false),
  canceled: z.boolean(),
});
export type FunnelAccount = z.output<typeof FunnelAccountSchema>;

export const FunnelRpcSchema = z.object({
  time_zone: z.string(),
  generated_at: z.string(),
  tracking_since: z.string().nullish().default(null),
  active_subscriptions: z.number().int().nonnegative(),
  kid_profiles: z.number().int().nonnegative(),
  accounts: z.array(FunnelAccountSchema),
});
export type FunnelRpc = z.output<typeof FunnelRpcSchema>;

// ------------------------------------------------------------------ one account

/** The steps before the trial, in order: reaching one means every one before it was reached too. */
const TO_TRIAL: readonly FunnelStage[] = ["signed_up", "onboarded", "plan_shown", "checkout_opened", "trial_started"];
/** The stages after it: they count only an account that started a trial. */
const ON_TRIAL: readonly FunnelStage[] = ["came_back_day2", "came_back_week2", "paid"];

/**
 * The stages an account reached, as a chain. A later step stands for the ones before it: a free
 * trial means checkout was opened and the plan screen seen, even for an account from before the
 * app recorded those steps, or one that came straight to the plan screen. The stages after the
 * trial need the trial: before the paywall a free account could come back without one, and on
 * this page every bar is a share of the bar above.
 */
export function reachedStages(stages: readonly FunnelStage[]): Set<FunnelStage> {
  const have = new Set(stages);
  const out = new Set<FunnelStage>(["signed_up"]);
  let last = 0;
  TO_TRIAL.forEach((stage, i) => {
    if (have.has(stage)) last = i;
  });
  for (let i = 0; i <= last; i += 1) out.add(TO_TRIAL[i]);
  if (out.has("trial_started")) for (const stage of ON_TRIAL) if (have.has(stage)) out.add(stage);
  return out;
}

/** How an account left the welcome and the guided board (FUNNEL_PATHS), from its recorded steps; null when none were recorded. */
export function funnelPathOf(steps: readonly FunnelStep[]): FunnelPath | null {
  const has = new Set(steps);
  if (has.has("tour_done")) return "finished_tour";
  if (has.has("tour_skipped")) return has.has("tour_checked") ? "skipped_tour_checked" : "skipped_tour";
  if (has.has("welcome_skipped")) return "skipped_welcome";
  if (has.has("welcome_started")) return "left_board";
  if (has.has("welcome_shown")) return "left_welcome";
  return null;
}

/** When a cohort's sign-ups begin (ISO), null for all time; "tracked" before any step was recorded has no start and no accounts. */
export function cohortStart(cohort: FunnelCohort, trackingSince: string | null): string | null {
  if (cohort === "paywall") return PAYWALL_AT;
  if (cohort === "tracked") return trackingSince;
  return null;
}

/** An account's sign-up instant in ms, from `signed_up_at`, else the start of its week (a v1 answer). */
function signedUpMs(account: FunnelAccount): number {
  const at = account.signed_up_at ? Date.parse(account.signed_up_at) : NaN;
  return Number.isFinite(at) ? at : Date.parse(`${account.week}T00:00:00Z`);
}

/**
 * Whether the account belongs to the cohort. Times are compared to the minute (admin_funnel gives
 * the sign-up to the minute): an account from the minute tracking began is in.
 */
function inCohort(account: FunnelAccount, cohort: FunnelCohort, since: string | null): boolean {
  if (cohort === "all") return true;
  if (since === null) return false;
  const start = Date.parse(since);
  if (!Number.isFinite(start)) return false;
  return signedUpMs(account) >= Math.floor(start / 60_000) * 60_000;
}

// ------------------------------------------------------------------ the report

function emptyCounts(): Record<FunnelStage, number> {
  return Object.fromEntries(FUNNEL_STAGES.map((s) => [s, 0])) as Record<FunnelStage, number>;
}

function emptyRow(key: string): FunnelRow {
  return { key, counts: emptyCounts(), canceled: 0, trialsEnded: 0 };
}

function add(row: FunnelRow, account: FunnelAccount, reached: Set<FunnelStage>): void {
  for (const stage of reached) row.counts[stage] += 1;
  if (account.canceled) row.canceled += 1;
  if (account.trial_ended && reached.has("trial_started")) row.trialsEnded += 1;
}

/** The key every account is added to in `totals` and `allTime`. */
export const TOTALS_KEY = "all";

/**
 * admin_funnel()'s answer as the page's report for one cohort: totals, weeks newest first, sources
 * with the most sign-ups first (ties by name), the paths in FUNNEL_PATHS order, and — over every
 * account, whatever the cohort — the all-time row the money tiles read, with MRR at `monthlyUsd`
 * per active subscription.
 */
export function buildFunnelReport(rpc: FunnelRpc, opts: { monthlyUsd: number; cohort?: FunnelCohort }): FunnelReport {
  const cohort = opts.cohort ?? DEFAULT_FUNNEL_COHORT;
  const since = cohortStart(cohort, rpc.tracking_since);
  const trackedFrom = rpc.tracking_since ? Date.parse(rpc.tracking_since) : NaN;
  const allTime = emptyRow(TOTALS_KEY);
  const totals = emptyRow(TOTALS_KEY);
  const weeks = new Map<string, FunnelRow>();
  const sources = new Map<string, FunnelRow>();
  const paths = new Map<FunnelPath, FunnelPathRow>(
    FUNNEL_PATHS.map((path) => [path, { path, accounts: 0, planShown: 0, checkoutOpened: 0, trialStarted: 0 }]),
  );
  let untracked = 0;
  for (const account of rpc.accounts) {
    const reached = reachedStages(account.stages);
    add(allTime, account, reached);
    if (!inCohort(account, cohort, since)) continue;
    add(totals, account, reached);
    const week = weeks.get(account.week) ?? emptyRow(account.week);
    weeks.set(account.week, week);
    add(week, account, reached);
    const source = sources.get(account.source) ?? emptyRow(account.source);
    sources.set(account.source, source);
    add(source, account, reached);
    if (!(signedUpMs(account) >= Math.floor(trackedFrom / 60_000) * 60_000)) untracked += 1;
    const path = funnelPathOf(account.steps);
    const row = path ? paths.get(path) : undefined;
    if (row) {
      row.accounts += 1;
      if (reached.has("plan_shown")) row.planShown += 1;
      if (reached.has("checkout_opened")) row.checkoutOpened += 1;
      if (reached.has("trial_started")) row.trialStarted += 1;
    }
  }
  return {
    generatedAt: rpc.generated_at,
    cohort,
    cohortSince: since,
    trackingSince: rpc.tracking_since,
    totals,
    untracked,
    byWeek: [...weeks.values()].sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0)),
    bySource: [...sources.values()].sort((a, b) => b.counts.signed_up - a.counts.signed_up || a.key.localeCompare(b.key)),
    paths: [...paths.values()],
    allTime,
    mrrUsd: rpc.active_subscriptions * opts.monthlyUsd,
    activeSubscriptions: rpc.active_subscriptions,
    kidProfiles: rpc.kid_profiles,
    timeZone: rpc.time_zone,
  };
}

// ------------------------------------------------------------------ the route's answer, for the page

const CountsSchema = z.object(Object.fromEntries(FUNNEL_STAGES.map((s) => [s, z.number().int().nonnegative()])) as Record<FunnelStage, z.ZodNumber>);

const Count = z.number().int().nonnegative();

const FunnelRowSchema = z.object({ key: z.string(), counts: CountsSchema, canceled: Count, trialsEnded: Count });

const FunnelPathRowSchema = z.object({
  path: z.enum(FUNNEL_PATHS),
  accounts: Count,
  planShown: Count,
  checkoutOpened: Count,
  trialStarted: Count,
});

/** GET /api/admin/funnel's answer, checked by the page before it shows anything. */
export const FunnelReportSchema: z.ZodType<FunnelReport, z.ZodTypeDef, unknown> = z.object({
  generatedAt: z.string(),
  cohort: z.enum(FUNNEL_COHORTS),
  cohortSince: z.string().nullable(),
  trackingSince: z.string().nullable(),
  totals: FunnelRowSchema,
  untracked: Count,
  byWeek: z.array(FunnelRowSchema),
  bySource: z.array(FunnelRowSchema),
  paths: z.array(FunnelPathRowSchema),
  allTime: FunnelRowSchema,
  mrrUsd: z.number().nonnegative(),
  activeSubscriptions: Count,
  kidProfiles: Count,
  timeZone: z.string(),
}) as z.ZodType<FunnelReport, z.ZodTypeDef, unknown>;
