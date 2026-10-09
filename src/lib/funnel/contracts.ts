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

/** How far an account got, in order. Each stage counts accounts that reached it. */
export const FUNNEL_STAGES = [
  "signed_up",
  "onboarded",
  "first_problem",
  "trial_started",
  "came_back_day2",
  "came_back_week2",
  "paid",
] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

export interface FunnelRow {
  /** a cohort (the Monday of the sign-up week, YYYY-MM-DD) or a source ("tiktok", "utm:newsletter", "unknown") */
  key: string;
  counts: Record<FunnelStage, number>;
  /** trials that were canceled (set to cancel, or ended) */
  canceled: number;
}

/** GET /api/admin/funnel */
export interface FunnelReport {
  generatedAt: string;
  totals: FunnelRow;
  byWeek: FunnelRow[];
  bySource: FunnelRow[];
  /** monthly recurring revenue now, in dollars: active subscriptions × the plan's price */
  mrrUsd: number;
}
