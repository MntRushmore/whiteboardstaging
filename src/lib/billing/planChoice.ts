/**
 * Which checkout a grown-up is sent to (2026-10-09, Phase 2): the monthly plan ($25/mo, the one
 * that exists today), the yearly family plan ($199/yr, when its Payment Link is set), or a referred
 * family's free first month (when that link is set). Each is a Stripe Payment Link the owner makes
 * (scripts/stripe-setup.mjs); a link that is not set is simply not offered.
 *
 * Each public link is a literal `process.env` reference, which Next inlines at build time, so they
 * must stay direct references.
 *
 * Shared contract for Phase 2 (docs/KIDS-COME-BACK.md). CONTRACT STUB: the annual-plan part fills
 * in the yearly and referral links; until then every choice is the monthly link.
 */
import { parseUnlimitedLink, unlimitedLink } from "./unlimited";

export type PlanInterval = "month" | "year";

export const ANNUAL_PLAN = {
  yearlyUsd: 199,
  /** what a year of the monthly plan costs */
  monthlyEquivalentUsd: 25 * 12,
} as const;

/** The yearly plan's Payment Link (NEXT_PUBLIC_UNLIMITED_ANNUAL_LINK), or null when not set. */
export function annualLink(): string | null {
  return parseUnlimitedLink(process.env.NEXT_PUBLIC_UNLIMITED_ANNUAL_LINK);
}

/** A referred family's link: the monthly plan with a 30-day trial (NEXT_PUBLIC_UNLIMITED_REFERRAL_LINK). */
export function referralLink(): string | null {
  return parseUnlimitedLink(process.env.NEXT_PUBLIC_UNLIMITED_REFERRAL_LINK);
}

/** The Payment Link for a choice; null when that plan can't be bought on this deployment. */
export function planLink(choice: { interval: PlanInterval; referred: boolean }): string | null {
  if (choice.interval === "year") return annualLink();
  if (choice.referred) return referralLink() ?? unlimitedLink();
  return unlimitedLink();
}
