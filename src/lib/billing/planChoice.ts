/**
 * Which checkout a grown-up is sent to (2026-10-09, Phase 2): the monthly plan, the one that exists
 * today, or, for a family a friend invited ("give a month, get a month", src/lib/referral), the same
 * plan with its first month free: a second Payment Link for the monthly price with a 30-day trial
 * (NEXT_PUBLIC_UNLIMITED_REFERRAL_LINK, made by scripts/stripe-setup.mjs). Without that link a
 * referred family gets the usual trial, and nothing on screen promises a month Stripe will not give.
 *
 * "Referred" is the account's OWN `profiles.attribution`: saved once after sign-up from the
 * device's `?ref=` (src/lib/funnel/capture.ts), it holds a well-formed referral code. The plan
 * screen and the account's Billing card read it (useReferred) and open `planLink`.
 *
 * A yearly plan was planned here and dropped by the owner the same day (the monthly price will
 * change instead), so there is one price: UNLIMITED_PLAN.monthlyUsd, read wherever a price is said.
 *
 * The link is a literal `process.env` reference, which Next inlines at build time, so it must stay
 * a direct reference. Pure apart from reading it: no React, no network. Shared contract for Phase 2
 * (docs/KIDS-COME-BACK.md).
 */
import { isReferralCode } from "@/lib/referral/contracts";
import { UNLIMITED_PLAN, parseUnlimitedLink, unlimitedCheckoutUrl, unlimitedLink, type UnlimitedPayer } from "./unlimited";

/**
 * A referred family's free first month: the referral Payment Link's trial. Stripe counts days, not
 * calendar months, so the first charge the screens show is this many days away.
 */
export const REFERRAL_TRIAL_DAYS = 30;

/** A referred family's link: the monthly plan with a 30-day trial (NEXT_PUBLIC_UNLIMITED_REFERRAL_LINK). */
export function referralLink(): string | null {
  return parseUnlimitedLink(process.env.NEXT_PUBLIC_UNLIMITED_REFERRAL_LINK);
}

/**
 * The Payment Link for this account: the referral link when a friend invited it and the link is
 * set, else the monthly link. Null when the plan can't be bought on this deployment.
 */
export function planLink(choice: { referred: boolean }): string | null {
  if (choice.referred) return referralLink() ?? unlimitedLink();
  return unlimitedLink();
}

/**
 * The account was referred: its own `profiles.attribution` holds a well-formed referral code in
 * `ref`. Anything else (no attribution, no ref, a malformed one) is not.
 */
export function isReferredAttribution(attribution: unknown): boolean {
  if (!attribution || typeof attribution !== "object" || Array.isArray(attribution)) return false;
  return isReferralCode((attribution as { ref?: unknown }).ref);
}

/**
 * The friend's free first month applies: a referred account on a deployment with the referral link.
 * Callers pass `referred: false` for a plan started again (the free trial, and so the free month, is
 * for a first plan only: has_unlimited()).
 */
export function referralApplies(choice: { referred: boolean }): boolean {
  return choice.referred && referralLink() !== null;
}

/** The free days before the first charge: 30 with the friend's month, else the plan's 7. */
export function trialDaysOf(choice: { referred: boolean }): number {
  return referralApplies(choice) ? REFERRAL_TRIAL_DAYS : UNLIMITED_PLAN.trialDays;
}

/**
 * The checkout for this account: `planLink` opened with the account's checkout reference
 * (unlimitedCheckoutUrl: never the user id). Null without the link or the reference, so a button
 * never opens a checkout no account would get.
 */
export function planCheckoutUrl(payer: UnlimitedPayer | null | undefined, choice: { referred: boolean }): string | null {
  const link = planLink(choice);
  return link ? unlimitedCheckoutUrl(payer, link) : null;
}

const FRIEND_LEAD = "Your first month is free";
const FRIEND_WHY = "(a friend invited you)";

/** What the plan screen and the Billing card say about a friend's free month. */
export const PLAN_REFERRAL_COPY = {
  /** why the first month is free, as one line */
  friend: `${FRIEND_LEAD} ${FRIEND_WHY}`,
  /** the same in its two halves, so a narrow screen breaks it before the reason, never inside it */
  friendLead: FRIEND_LEAD,
  friendWhy: FRIEND_WHY,
  /** the plan screen's big line, in place of "Free for 7 days" */
  friendFree: "First month free",
} as const;
