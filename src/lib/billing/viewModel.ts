/**
 * Pure view models for the credits / plans UI (/account, the dashboard header
 * badge, CreditsBanner). No React, no network, no browser APIs at module scope;
 * unit-tested in src/lib/billing/__tests__/viewModel.test.ts.
 *
 * Data comes from the RPC `credit_summary()` and the `plans` table (see
 * supabase/migrations); the Usage card's model is src/lib/billing/usage.ts.
 * Credits are the unit: for the current calendar month
 * `remaining = monthly_credits + granted - used`.
 */

import { z } from "zod";

/** Path of the account page every credits surface links to. */
export const ACCOUNT_PATH = "/account";

/**
 * PostgREST returns `numeric` columns as strings and `integer` as numbers;
 * coerce so the view never does arithmetic on a string.
 */
const count = z.coerce.number().finite();

export const CreditSummarySchema = z.object({
  plan_id: z.string(),
  plan_name: z.string(),
  monthly_credits: count,
  used: count,
  granted: count,
  remaining: count,
  period_start: z.string(),
  period_end: z.string(),
});

export type CreditSummary = z.infer<typeof CreditSummarySchema>;

/**
 * `credit_summary()` may come back as a single object (returns json / a
 * composite) or as a one-row array (returns table / setof). Accept both and
 * return null when the payload is empty or malformed.
 */
export function parseCreditSummary(payload: unknown): CreditSummary | null {
  const row = Array.isArray(payload) ? payload[0] : payload;
  if (!row || typeof row !== "object") return null;
  const parsed = CreditSummarySchema.safeParse(row);
  return parsed.success ? parsed.data : null;
}

export const PlanSchema = z.object({
  id: z.string(),
  name: z.string(),
  monthly_credits: count,
  price_cents: count.default(0),
  sort: count.default(0),
  active: z.boolean().optional(),
  /** Marketing bullets from the `plans.features` jsonb column; non-string entries are dropped. */
  features: z
    .array(z.unknown())
    .transform((items) => items.filter((f): f is string => typeof f === "string"))
    .optional(),
});

export type Plan = z.infer<typeof PlanSchema>;

/** Rows from `plans`; malformed rows are dropped rather than crashing the page. */
export function parsePlans(payload: unknown): Plan[] {
  if (!Array.isArray(payload)) return [];
  const out: Plan[] = [];
  for (const row of payload) {
    const parsed = PlanSchema.safeParse(row);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/** Checkout / portal URLs from NEXT_PUBLIC_BILLING_LINKS; keys are plan ids plus `portal`. */
export type BillingLinks = Readonly<Record<string, string>>;

const ALLOWED_LINK_PROTOCOLS = new Set(["https:", "http:"]);

/**
 * Parses the JSON in NEXT_PUBLIC_BILLING_LINKS (`{"plus":"https://…","pro":"https://…","portal":"https://…"}`).
 * Never throws: an absent / malformed value yields `{}`, and only absolute
 * http(s) URLs survive so a bad env cannot inject `javascript:` links.
 */
export function parseBillingLinks(envString: string | undefined | null): BillingLinks {
  if (!envString || !envString.trim()) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(envString);
  } catch {
    return {};
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const links: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== "string" || !/^[a-z0-9_-]+$/i.test(key)) continue;
    try {
      const url = new URL(value);
      if (ALLOWED_LINK_PROTOCOLS.has(url.protocol)) links[key] = url.toString();
    } catch {
      /* not an absolute URL: skip */
    }
  }
  return links;
}

/** Whole credits with thousands separators; anything non-finite renders as "0". */
export function formatCredits(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "0";
  return Math.round(n).toLocaleString("en-US");
}

/** Plan price for a card: "Free" or "$9/month" (cents kept only when not whole). */
export function formatPrice(priceCents: number): string {
  if (!Number.isFinite(priceCents) || priceCents <= 0) return "Free";
  const dollars = priceCents / 100;
  const text = Number.isInteger(dollars) ? String(dollars) : dollars.toFixed(2);
  return `$${text}/month`;
}

const MONTH_DAY: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", timeZone: "UTC" };
const MONTH_DAY_YEAR: Intl.DateTimeFormatOptions = { ...MONTH_DAY, year: "numeric" };

/**
 * "Oct 1" (or "Jan 1, 2027" when the reset falls in another year). Periods are
 * calendar months in UTC, so the date is rendered in UTC as well: a local-time
 * render would show "Sep 30" for `2026-10-01T00:00:00Z` in the Americas.
 * Returns "" for a missing / unparsable value.
 */
export function periodEndLabel(periodEnd: string | null | undefined, now: Date = new Date()): string {
  if (!periodEnd) return "";
  const date = new Date(periodEnd);
  if (Number.isNaN(date.getTime())) return "";
  const sameYear = date.getUTCFullYear() === now.getUTCFullYear();
  return date.toLocaleDateString("en-US", sameYear ? MONTH_DAY : MONTH_DAY_YEAR);
}

export type RemainingTone = "ok" | "low" | "empty";

/** Low-credit threshold as a fraction of the month's total (monthly + granted). */
export const LOW_CREDITS_FRACTION = 0.1;

/** Total credits available this month before usage. */
export function monthlyTotal(summary: Pick<CreditSummary, "monthly_credits" | "granted">): number {
  return Math.max(0, summary.monthly_credits + summary.granted);
}

/**
 * 'empty' at zero (or below), 'low' at or under 10 % of the month's total,
 * otherwise 'ok'. No summary means nothing to warn about.
 */
export function remainingTone(summary: CreditSummary | null | undefined): RemainingTone {
  if (!summary) return "ok";
  if (summary.remaining <= 0) return "empty";
  const total = monthlyTotal(summary);
  if (total > 0 && summary.remaining <= total * LOW_CREDITS_FRACTION) return "low";
  return "ok";
}

/** 0..100 share of this month's credits already used, for the progress bar. */
export function usedPercent(summary: CreditSummary | null | undefined): number {
  if (!summary) return 0;
  const total = monthlyTotal(summary);
  if (total <= 0) return summary.used > 0 ? 100 : 0;
  const pct = (summary.used / total) * 100;
  return Math.min(100, Math.max(0, Math.round(pct)));
}

export type PlanAction = "current" | "upgrade" | "coming-soon" | "downgrade";

export type PlanCard = {
  id: string;
  name: string;
  /** "Free" | "$9/month" */
  price: string;
  /** Monthly credits, formatted. */
  credits: string;
  current: boolean;
  action: PlanAction;
  /** Present when the action is a real link (checkout for upgrades, portal for the current/downgrade plan). */
  href?: string;
  /** Bullets to list under the price; empty when the plan has none. */
  features: string[];
};

/** "300 credits / month" style bullets duplicate the card's own credits line; hide them. */
function restatesCredits(feature: string): boolean {
  return /^[\d,.]+\s*credits?\s*(\/|per)\s*month$/i.test(feature.trim());
}

function planRank(plan: Plan): number {
  // `sort` orders the grid; monthly_credits breaks ties so equal sorts still compare.
  return plan.sort * 1_000_000_000 + plan.monthly_credits;
}

/**
 * Cards for the plans grid. Upgrades link to their checkout URL when the env
 * provides one and are 'coming-soon' otherwise; the current plan and any
 * cheaper plan link to the portal when present. Without a summary (still
 * loading, or the RPC failed) no card is marked current.
 */
export function planCardsFor(
  plans: ReadonlyArray<Plan>,
  summary: CreditSummary | null | undefined,
  links: BillingLinks = {},
): PlanCard[] {
  const active = plans.filter((p) => p.active !== false).slice().sort((a, b) => planRank(a) - planRank(b));
  const current = summary ? active.find((p) => p.id === summary.plan_id) ?? null : null;
  const currentRank = current ? planRank(current) : Number.NEGATIVE_INFINITY;
  const portal = links.portal;

  return active.map((plan) => {
    const isCurrent = current?.id === plan.id;
    let action: PlanAction;
    let href: string | undefined;
    if (isCurrent) {
      action = "current";
      href = portal;
    } else if (planRank(plan) > currentRank) {
      href = links[plan.id];
      action = href ? "upgrade" : "coming-soon";
    } else {
      href = portal;
      action = href ? "downgrade" : "coming-soon";
    }
    return {
      id: plan.id,
      name: plan.name,
      price: formatPrice(plan.price_cents),
      credits: formatCredits(plan.monthly_credits),
      current: isCurrent,
      action,
      ...(href ? { href } : {}),
      features: (plan.features ?? []).filter((f) => !restatesCredits(f)),
    };
  });
}

/**
 * Canonical key for a metered route: leading "/api/" removed, "/" and "_" folded to
 * "-", lower-case (so "live/recognize", "/api/live/recognize" and "live_recognize"
 * all match). The Usage card's kinds (src/lib/billing/usage.ts) are keyed by it.
 */
export function canonicalRouteKey(route: string): string {
  return route
    .trim()
    .toLowerCase()
    .replace(/^\/+/, "")
    .replace(/^api\//, "")
    .replace(/[/_]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const BILLING_COPY = {
  /** Banner when the tone is 'low'. */
  low: (remaining: number) =>
    `You have ${formatCredits(remaining)} credit${Math.round(remaining) === 1 ? "" : "s"} left this month`,
  /** Banner when the tone is 'empty'; `resetLabel` from periodEndLabel(). */
  empty: (resetLabel: string) =>
    resetLabel
      ? `You've used this month's credits — upgrade or wait until ${resetLabel}`
      : "You've used this month's credits — upgrade or wait for next month",
  /** 402 without a usable server message (toasts, inline errors). */
  exhausted: "You've used this month's credits. Upgrade or wait for the reset in your account.",
  viewAccount: "View plan",
  comingSoon: "Coming soon",
  comingSoonNote: "Paid plans aren't open yet. Your Free credits reset every month.",
  currentPlan: "Current plan",
  manage: "Manage",
  upgrade: "Upgrade",
  downgrade: "Switch",
} as const;

/** Banner sentence for a summary, or null when nothing should be shown. */
export function bannerMessageFor(summary: CreditSummary | null | undefined, now: Date = new Date()): string | null {
  const tone = remainingTone(summary);
  if (!summary || tone === "ok") return null;
  if (tone === "empty") return BILLING_COPY.empty(periodEndLabel(summary.period_end, now));
  return BILLING_COPY.low(summary.remaining);
}

export type BannerState = "loading" | "hidden" | "hidden-error" | "visible";

/** Mirrors the convention in src/lib/bannerState.ts: hidden-on-error is a named state. */
export function creditsBannerStateFor(summary: CreditSummary | null | undefined, failed: boolean): BannerState {
  if (failed) return "hidden-error";
  if (!summary) return "loading";
  return remainingTone(summary) === "ok" ? "hidden" : "visible";
}

/* ------------------------------------------------------------------------- */
/* Plan & credits card (/account)                                             */
/* ------------------------------------------------------------------------- */

/** "September" for the period starting `2026-09-01T00:00:00Z` (UTC, like periodEndLabel); "" when unparsable. */
export function periodMonthLabel(periodStart: string | null | undefined): string {
  if (!periodStart) return "";
  const date = new Date(periodStart);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
}

export type CreditsNotice = { tone: Exclude<RemainingTone, "ok">; message: string };

/**
 * The calm notice inside the plan card when credits run low or out; null while they are
 * fine. Same tones as CreditsBanner, but no "upgrade": paid plans may not be open yet.
 */
export function creditsNoticeFor(summary: CreditSummary | null | undefined, now: Date = new Date()): CreditsNotice | null {
  const tone = remainingTone(summary);
  if (!summary || tone === "ok") return null;
  const resets = periodEndLabel(summary.period_end, now);
  const when = resets ? `on ${resets}` : "next month";
  if (tone === "empty") {
    return { tone, message: `You've used all of this month's credits. The tutor can't read new work until they reset ${when}.` };
  }
  return { tone, message: `${BILLING_COPY.low(summary.remaining)}. They reset ${when}.` };
}

export type AllowanceLine = { key: "plan" | "extra" | "used"; label: string; value: string };

/**
 * Where this month's credits come from, as ledger lines that add up to `remaining`:
 * the plan's monthly allowance, any extra grant (or correction) for this month, and
 * what has been used.
 */
export function allowanceLinesFor(summary: CreditSummary): AllowanceLine[] {
  const month = periodMonthLabel(summary.period_start);
  const lines: AllowanceLine[] = [
    { key: "plan", label: `${summary.plan_name} plan, every month`, value: formatCredits(summary.monthly_credits) },
  ];
  if (summary.granted > 0) {
    lines.push({ key: "extra", label: month ? `Extra for ${month}` : "Extra this month", value: `+${formatCredits(summary.granted)}` });
  } else if (summary.granted < 0) {
    lines.push({
      key: "extra",
      label: month ? `Correction for ${month}` : "Correction this month",
      value: `−${formatCredits(-summary.granted)}`,
    });
  }
  lines.push({ key: "used", label: "Used so far", value: summary.used > 0 ? `−${formatCredits(summary.used)}` : "0" });
  return lines;
}

/** Plain words for the reset: extra credits are for this month only and nothing carries over. */
export function resetSentenceFor(summary: CreditSummary, now: Date = new Date()): string {
  const resets = periodEndLabel(summary.period_end, now);
  const month = periodMonthLabel(summary.period_start);
  const lead = summary.granted > 0 ? `Extra credits count for ${month || "this month"} only, and unused` : "Unused";
  return `${lead} credits don't carry over: ${resets ? `on ${resets}` : "next month"} you start again with ${formatCredits(summary.monthly_credits)}.`;
}
