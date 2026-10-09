/**
 * The plan in the landing page's words (2026-10-09). Every price, trial length and plan name on
 * /parents comes from UNLIMITED_PLAN through here, so changing the price or the trial is one edit in
 * src/lib/billing/unlimited.ts and the page, its metadata and its FAQ all follow (owner, 2026-10-09:
 * the monthly price will go up later). Nothing on the page writes a price or a number of days itself.
 *
 * Pure: no React, no network. Unit-tested in `__tests__/plan.test.ts`.
 */
import { UNLIMITED_PLAN } from "@/lib/billing/unlimited";

/** The plan facts the page uses: UNLIMITED_PLAN's, or another price in a test. */
export interface LandingPlan {
  name: string;
  monthlyUsd: number;
  trialDays: number;
}

const SMALL = ["", "one", "two", "three", "four"] as const;

/**
 * The free trial as a parent says it: "week" for 7 days, "two weeks" for 14, else "10 days". It
 * follows "free", as in "Start your free week".
 */
export function freeTrialName(days: number): string {
  if (days % 7 === 0 && days / 7 >= 1 && days / 7 < SMALL.length) {
    const weeks = days / 7;
    return weeks === 1 ? "week" : `${SMALL[weeks]} weeks`;
  }
  return `${days} ${days === 1 ? "day" : "days"}`;
}

/** "$25": whole dollars without cents, cents when there are any. */
export function priceText(usd: number): string {
  return Number.isInteger(usd) ? `$${usd}` : `$${usd.toFixed(2)}`;
}

/** The plan's words, from the plan (UNLIMITED_PLAN unless a test passes another). */
export function planWords(plan: LandingPlan = UNLIMITED_PLAN) {
  const price = priceText(plan.monthlyUsd);
  const trial = freeTrialName(plan.trialDays);
  const days = `${plan.trialDays} ${plan.trialDays === 1 ? "day" : "days"}`;
  return {
    name: plan.name,
    /** "$25" */
    price,
    /** "a month" */
    per: "a month",
    /** "week": after "free" */
    trial,
    /** "7 days" */
    days,
    /** "Start your free week" */
    start: `Start your free ${trial}`,
    /** "Free for 7 days, then $25 a month for the whole family. Cancel anytime." */
    terms: `Free for ${days}, then ${price} a month for the whole family. Cancel anytime.`,
  };
}
