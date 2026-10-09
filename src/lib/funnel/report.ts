/**
 * The admin Funnel's numbers (GET /api/admin/funnel): admin_funnel()'s per-account answer
 * (supabase/migrations/20261009020000_funnel.sql) added up into a FunnelReport — the totals, one
 * row per sign-up week, one per source — and the schema the page checks the route's answer with.
 *
 * Pure (zod only, no network): the server builds the report here and the tests drive it with
 * made-up accounts. The adding up lives here, not in SQL, so every rule of it is one test away.
 */
import { z } from "zod";
import { FUNNEL_STAGES, type FunnelReport, type FunnelRow, type FunnelStage } from "./contracts";

/** The page and its route. */
export const FUNNEL_PATHS = {
  page: "/admin/funnel",
  api: "/api/admin/funnel",
} as const;

/** The zone the weeks are read in when the page does not say (Agathon's families are in the US). */
export const DEFAULT_FUNNEL_TIME_ZONE = "America/New_York";

/** The route's URL for the viewer's zone. */
export function funnelUrl(timeZone: string | null | undefined): string {
  return timeZone ? `${FUNNEL_PATHS.api}?tz=${encodeURIComponent(timeZone)}` : FUNNEL_PATHS.api;
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

/** One account in admin_funnel()'s answer. Unknown stage names are dropped, not refused (a newer database). */
const FunnelAccountSchema = z.object({
  week: z.string().regex(DAY),
  source: z.string().min(1).max(240),
  stages: z.array(z.string()).transform((list) => list.filter((s): s is FunnelStage => (FUNNEL_STAGES as readonly string[]).includes(s))),
  canceled: z.boolean(),
});
export type FunnelAccount = z.output<typeof FunnelAccountSchema>;

export const FunnelRpcSchema = z.object({
  time_zone: z.string(),
  generated_at: z.string(),
  active_subscriptions: z.number().int().nonnegative(),
  kid_profiles: z.number().int().nonnegative(),
  accounts: z.array(FunnelAccountSchema),
});
export type FunnelRpc = z.output<typeof FunnelRpcSchema>;

// ------------------------------------------------------------------ the report

function emptyCounts(): Record<FunnelStage, number> {
  return Object.fromEntries(FUNNEL_STAGES.map((s) => [s, 0])) as Record<FunnelStage, number>;
}

function emptyRow(key: string): FunnelRow {
  return { key, counts: emptyCounts(), canceled: 0 };
}

function add(row: FunnelRow, account: FunnelAccount): void {
  // every account signed up, whatever the list says
  row.counts.signed_up += 1;
  for (const stage of new Set(account.stages)) if (stage !== "signed_up") row.counts[stage] += 1;
  if (account.canceled) row.canceled += 1;
}

/** The key every account is added to in `totals`. */
export const TOTALS_KEY = "all";

/**
 * admin_funnel()'s answer as the page's report: totals, weeks newest first, sources with the most
 * sign-ups first (ties by name), and MRR at `monthlyUsd` per active subscription.
 */
export function buildFunnelReport(rpc: FunnelRpc, opts: { monthlyUsd: number }): FunnelReport {
  const totals = emptyRow(TOTALS_KEY);
  const weeks = new Map<string, FunnelRow>();
  const sources = new Map<string, FunnelRow>();
  for (const account of rpc.accounts) {
    add(totals, account);
    const week = weeks.get(account.week) ?? emptyRow(account.week);
    weeks.set(account.week, week);
    add(week, account);
    const source = sources.get(account.source) ?? emptyRow(account.source);
    sources.set(account.source, source);
    add(source, account);
  }
  return {
    generatedAt: rpc.generated_at,
    totals,
    byWeek: [...weeks.values()].sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0)),
    bySource: [...sources.values()].sort((a, b) => b.counts.signed_up - a.counts.signed_up || a.key.localeCompare(b.key)),
    mrrUsd: rpc.active_subscriptions * opts.monthlyUsd,
    activeSubscriptions: rpc.active_subscriptions,
    kidProfiles: rpc.kid_profiles,
    timeZone: rpc.time_zone,
  };
}

// ------------------------------------------------------------------ the route's answer, for the page

const CountsSchema = z.object(Object.fromEntries(FUNNEL_STAGES.map((s) => [s, z.number().int().nonnegative()])) as Record<FunnelStage, z.ZodNumber>);

const FunnelRowSchema = z.object({ key: z.string(), counts: CountsSchema, canceled: z.number().int().nonnegative() });

/** GET /api/admin/funnel's answer, checked by the page before it shows anything. */
export const FunnelReportSchema: z.ZodType<FunnelReport, z.ZodTypeDef, unknown> = z.object({
  generatedAt: z.string(),
  totals: FunnelRowSchema,
  byWeek: z.array(FunnelRowSchema),
  bySource: z.array(FunnelRowSchema),
  mrrUsd: z.number().nonnegative(),
  activeSubscriptions: z.number().int().nonnegative(),
  kidProfiles: z.number().int().nonnegative(),
  timeZone: z.string(),
}) as z.ZodType<FunnelReport, z.ZodTypeDef, unknown>;
