/**
 * Agathon Unlimited: the monthly plan offered on the last screen of onboarding, after the guided
 * board and before the home (owner, 2026-10-03).
 *
 *  - $25 a month after a 7-day free trial (the "beta week"): the price is shown crossed out and
 *    nothing is charged today. A grown-up's card is taken up front at Stripe Checkout, through a
 *    subscription Payment Link with the trial on it (NEXT_PUBLIC_UNLIMITED_LINK, made by
 *    scripts/stripe-setup.mjs), opened with this user's id like the ink packs (`checkoutUrl`).
 *  - While the subscription is trialing or active, help spends no ink (a fair-use limit instead).
 *    Ink packs stay for everyone who does not subscribe.
 *
 * Pure: no React, no network. The subscription row and the hook that reads it live beside this
 * (`useUnlimited`), written by the Stripe webhook.
 */
import { checkoutUrl, type Payer } from "@/lib/billing/checkout";

export const UNLIMITED_PLAN = {
  id: "unlimited",
  name: "Agathon Unlimited",
  monthlyUsd: 25,
  trialDays: 7,
} as const;

/** Query parameter the Payment Link's after-completion redirect sets: `/?unlimited=started`. */
export const UNLIMITED_RETURN_PARAM = "unlimited";
export const UNLIMITED_RETURN_VALUE = "started";

/** A Stripe subscription's status, as the webhook stores it; `none` without a subscription. */
export type UnlimitedStatus = "none" | "trialing" | "active" | "past_due" | "canceled" | "incomplete";

export interface UnlimitedState {
  status: UnlimitedStatus;
  /** when the free week ends (ISO), while trialing */
  trialEnd: string | null;
  /** when the current period ends (ISO): the next charge, or the end of a cancelled plan */
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

export const NO_UNLIMITED: UnlimitedState = { status: "none", trialEnd: null, currentPeriodEnd: null, cancelAtPeriodEnd: false };

/** Help spends no ink: the plan is in its free week or paid up. */
export function isUnlimited(state: Pick<UnlimitedState, "status"> | null | undefined): boolean {
  return state?.status === "trialing" || state?.status === "active";
}

/**
 * The plan's Payment Link, from NEXT_PUBLIC_UNLIMITED_LINK. The literal `process.env.…` is inlined
 * by Next at build time, so it must stay a direct reference. Null when unset or not an absolute
 * http(s) URL: the plan screen then says "Coming soon" and lets the student go on to the home.
 */
export function unlimitedLink(): string | null {
  return parseUnlimitedLink(process.env.NEXT_PUBLIC_UNLIMITED_LINK);
}

export function parseUnlimitedLink(value: string | undefined | null): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** The plan's checkout for this user (their id comes back in the webhook); null without a link or a user. */
export function unlimitedCheckoutUrl(payer: Payer | null | undefined, link: string | null = unlimitedLink()): string | null {
  return checkoutUrl(link, payer);
}

/** The day the free week ends if it starts now, for "You won't be charged until Friday, 10 October". */
export function trialEndsOn(now: Date, days: number = UNLIMITED_PLAN.trialDays): Date {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Back from checkout: `?unlimited=started` on the home. */
export function isUnlimitedReturn(search: string | URLSearchParams | null | undefined): boolean {
  if (!search) return false;
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  return params.get(UNLIMITED_RETURN_PARAM) === UNLIMITED_RETURN_VALUE;
}
