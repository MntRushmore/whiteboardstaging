/**
 * The growth funnel (2026-10-09, "kids come back"): where people come from and how far they get, so
 * the owner can see which channel works and where students drop off. Signup attribution is kept on
 * the profile (`profiles.attribution`, `profiles.heard_from`,
 * supabase/migrations/20261009000000_kids_come_back.sql); the admin console's Funnel page reads it
 * with each account's onboarding, plan and activity.
 *
 * Shared contract for the K–8 build (docs/KIDS-COME-BACK.md).
 */

/** "How did you hear about Agathon?" (the welcome; optional). Stored as the id in `profiles.heard_from`. */
export const HEARD_FROM = [
  { id: "friend", label: "A friend or family" },
  { id: "school", label: "School or a teacher" },
  { id: "tiktok", label: "TikTok" },
  { id: "instagram", label: "Instagram" },
  { id: "youtube", label: "YouTube" },
  { id: "x", label: "X (Twitter)" },
  { id: "search", label: "Google or another search" },
  { id: "other", label: "Somewhere else" },
] as const;
export type HeardFrom = (typeof HEARD_FROM)[number]["id"];

export function isHeardFrom(value: unknown): value is HeardFrom {
  return typeof value === "string" && HEARD_FROM.some((h) => h.id === value);
}

/**
 * Where a visitor first arrived from, captured on their first visit (before sign-up) and saved once
 * to their profile after it (`save_attribution`). Every field optional, strings at most 200 chars.
 */
export interface Attribution {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  /** document.referrer's origin only (never its path or query) */
  referrer?: string;
  /** the first path seen, without its query */
  landingPath?: string;
  /** a referral code from `?ref=` (for the referral program later) */
  ref?: string;
  /** ISO */
  firstSeenAt: string;
}

/**
 * How far an account got, in order (2026-10-12): every stage needs the one before it, so each bar
 * is a share of the bar above. The report closes the chain (`report.ts`): a free trial means the
 * account saw the plan screen and opened checkout even before those steps were recorded, and the
 * stages after the trial count only accounts that started one.
 *
 * - `onboarded`: the welcome finished or skipped (`profiles.onboarded_at`)
 * - `plan_shown`, `checkout_opened`: recorded steps (`steps.ts`)
 * - `came_back_day2` / `came_back_week2`: activity on a later local day / 7 to 14 days after sign-up
 * - `paid`: a subscription that is `active`, measured against the trials that have ended
 */
export const FUNNEL_STAGES = [
  "signed_up",
  "onboarded",
  "plan_shown",
  "checkout_opened",
  "trial_started",
  "came_back_day2",
  "came_back_week2",
  "paid",
] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

/**
 * Which sign-ups the page counts (`?cohort=`):
 * - `paywall`: since the free plan ended (`PAYWALL_AT`), the default: before it nobody needed a trial;
 * - `tracked`: since the app began recording the steps (the report's `trackingSince`);
 * - `all`: everyone.
 */
export const FUNNEL_COHORTS = ["paywall", "tracked", "all"] as const;
export type FunnelCohort = (typeof FUNNEL_COHORTS)[number];
export const DEFAULT_FUNNEL_COHORT: FunnelCohort = "paywall";

export function isFunnelCohort(value: unknown): value is FunnelCohort {
  return typeof value === "string" && (FUNNEL_COHORTS as readonly string[]).includes(value);
}

/** The paywall went up: PR #27 (no free plan) merged 2026-10-05 14:46 New York time. */
export const PAYWALL_AT = "2026-10-05T18:46:00Z";

/**
 * How an account left the welcome and the guided board, from its recorded steps (`report.ts`
 * `funnelPathOf`), first match wins:
 * - `finished_tour`: reached the tour's finish card
 * - `skipped_tour_checked`: skipped the tour after the tutor ticked or ringed a line
 * - `skipped_tour`: skipped the tour before any checked line
 * - `skipped_welcome`: Skip for now on the welcome
 * - `left_board`: opened the guided board, then neither finished nor skipped (closed the tab)
 * - `left_welcome`: saw the welcome and did nothing more there
 */
export const FUNNEL_PATHS = ["left_welcome", "skipped_welcome", "left_board", "skipped_tour", "skipped_tour_checked", "finished_tour"] as const;
export type FunnelPath = (typeof FUNNEL_PATHS)[number];

export interface FunnelRow {
  /** a cohort (the Monday of the sign-up week, YYYY-MM-DD) or a source ("tiktok", "utm:newsletter", "unknown") */
  key: string;
  counts: Record<FunnelStage, number>;
  /** trials that were canceled (set to cancel, or ended) */
  canceled: number;
  /** trials that are over (paid, ended, or past their trial end): what `paid` is a share of */
  trialsEnded: number;
}

/** One path to the plan screen: its accounts, and how many of them went on. */
export interface FunnelPathRow {
  path: FunnelPath;
  accounts: number;
  planShown: number;
  checkoutOpened: number;
  trialStarted: number;
}

/** GET /api/admin/funnel */
export interface FunnelReport {
  generatedAt: string;
  /** the sign-ups counted below (`totals`, the weeks, the sources, the paths) */
  cohort: FunnelCohort;
  /** the cohort's first sign-up time (ISO); null for all time, or "tracked" before any step was recorded */
  cohortSince: string | null;
  /** when the app began recording steps (ISO); null before the first */
  trackingSince: string | null;
  totals: FunnelRow;
  /** accounts in the cohort that signed up before tracking began: their plan screen and checkout are inferred */
  untracked: number;
  byWeek: FunnelRow[];
  bySource: FunnelRow[];
  /** how the cohort's tracked accounts left the welcome and the guided board, in FUNNEL_PATHS order */
  paths: FunnelPathRow[];
  /** every account, whatever the cohort: the money tiles */
  allTime: FunnelRow;
  /** monthly recurring revenue now, in dollars: active subscriptions × the plan's price */
  mrrUsd: number;
  /** subscriptions whose status is `active` right now (what mrrUsd counts) */
  activeSubscriptions: number;
  /** kid profiles (`family_members`): left out of every count above, reported on their own */
  kidProfiles: number;
  /** the IANA zone the sign-up weeks and "another day" were read in */
  timeZone: string;
}
