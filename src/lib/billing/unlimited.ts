/**
 * Agathon Unlimited: THE plan. There is no free plan (owner, 2026-10-05): a new student gets the
 * guided first board (its starter ink covers it), then the plan screen, which they cannot skip.
 *
 *  - $25 a month after a 3-day free trial (7 days until 2026-10-06: the owner heard a week was too
 *    long; trials started before keep their 7 days, Stripe fixes a trial's length at checkout).
 *    Nothing is charged today. A grown-up's card is taken up front at Stripe Checkout, through a
 *    subscription Payment Link with the trial on it (NEXT_PUBLIC_UNLIMITED_LINK, made by
 *    scripts/stripe-setup.mjs), opened with this account's CHECKOUT REFERENCE (not its user id:
 *    `unlimitedCheckoutUrl`), which the webhook resolves to the account.
 *  - While the subscription is trialing or active, help spends no ink (a fair-use limit instead).
 *  - Without a plan (`hasPlan`), the home, the boards and Progress send the student to the plan
 *    screen (`usePlanGate`). Ink packs are no longer sold.
 *
 * Pure: no React, no network. The subscription row and the hook that reads it live beside this
 * (`useUnlimited`), written by the Stripe webhook.
 */
import { checkoutUrl } from "@/lib/billing/checkout";

export const UNLIMITED_PLAN = {
  id: "unlimited",
  name: "Agathon Unlimited",
  monthlyUsd: 25,
  trialDays: 3,
} as const;

/** Query parameter the Payment Link's after-completion redirect sets: `/?unlimited=started`. */
export const UNLIMITED_RETURN_PARAM = "unlimited";
export const UNLIMITED_RETURN_VALUE = "started";

/**
 * A Stripe subscription's status, as the webhook stores it; `none` without a subscription.
 * `repeat_trial`: Stripe says trialing, but the account had a plan before, and a free trial is for a
 * first plan only (has_unlimited() in 20261003040000_go_live_gaps.sql): help spends ink until the
 * first charge, when it turns `active`.
 */
export type UnlimitedStatus = "none" | "trialing" | "repeat_trial" | "active" | "past_due" | "canceled" | "incomplete";

export interface UnlimitedState {
  status: UnlimitedStatus;
  /** when the free trial ends (ISO), while trialing */
  trialEnd: string | null;
  /** when the current period ends (ISO): the next charge, or the end of a cancelled plan */
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  /**
   * This account's checkout reference (`profiles.checkout_ref`, readable only by its owner): what the
   * Unlimited Payment Link sends as `client_reference_id`. Null until the summary is read (or on a
   * database without it): the start button then waits, it never falls back to the user id.
   */
  checkoutRef: string | null;
}

export const NO_UNLIMITED: UnlimitedState = { status: "none", trialEnd: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, checkoutRef: null };

/** Help spends no ink: the plan is in its free trial or paid up. */
export function isUnlimited(state: Pick<UnlimitedState, "status"> | null | undefined): boolean {
  return state?.status === "trialing" || state?.status === "active";
}

/**
 * The account has a plan, so the app is open: in its free trial or paid up, a second plan waiting
 * for its first charge (repeat_trial), one being set up (incomplete), or one with a payment to fix
 * (past_due: the account page and the ink dialog say how). Never offered a second checkout either:
 * that would be a second $25 a month. `none` and `canceled` have no plan: the plan screen.
 */
export function hasPlan(state: Pick<UnlimitedState, "status"> | null | undefined): boolean {
  const s = state?.status;
  return s === "trialing" || s === "active" || s === "repeat_trial" || s === "incomplete" || s === "past_due";
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

/** Who starts the plan: the account's checkout reference (UnlimitedState.checkoutRef) and the email to prefill. */
export type UnlimitedPayer = { checkoutRef: string | null | undefined; email?: string | null };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The plan's checkout for this account: `client_reference_id` is its checkout reference, which the
 * webhook resolves to the account (a user id would link nobody: anyone can learn one, and a plan
 * started on someone else's account could neither be cancelled by them nor let them delete it).
 * Null without a link or a reference: the button waits for the reference rather than open a
 * checkout no account would get.
 */
export function unlimitedCheckoutUrl(payer: UnlimitedPayer | null | undefined, link: string | null = unlimitedLink()): string | null {
  const ref = payer?.checkoutRef?.trim();
  if (!ref || !UUID_RE.test(ref)) return null;
  // checkoutUrl sets `client_reference_id` from `userId`: here it carries the ref, never the id.
  // No prefilled email: the account's is often the child's, and the checkout's email is where the
  // billing emails and the portal's sign-in go — the grown-up who pays types their own.
  return checkoutUrl(link, { userId: ref, email: null });
}

/** The day the free trial ends if it starts now, for "You won't be charged until Friday, 10 October". */
export function trialEndsOn(now: Date, days: number = UNLIMITED_PLAN.trialDays): Date {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Back from checkout: `?unlimited=started` on the home. */
export function isUnlimitedReturn(search: string | URLSearchParams | null | undefined): boolean {
  if (!search) return false;
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  return params.get(UNLIMITED_RETURN_PARAM) === UNLIMITED_RETURN_VALUE;
}

/* ------------------------------------------------------------------------- */
/* The plan as the server reports it (ink_summary().unlimited)                */
/* ------------------------------------------------------------------------- */

const isoOrNull = (v: unknown): string | null => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : null);

/**
 * `ink_summary().unlimited` (supabase/migrations/20261003020000_unlimited.sql) as the app shows it:
 * `{ status, unlimited, trial_end, current_period_end, cancel_at_period_end, cancel_at }`, where
 * status is Stripe's. Never throws; anything missing or malformed (an older database, a failed
 * read) is NO_UNLIMITED, so nobody is told they have a plan they may not have.
 *
 *  - trialing with `repeat_trial: true` (a free trial on a second plan, which grants nothing) ->
 *    repeat_trial: help spends ink until the first charge
 *  - trialing / active -> as they are, unless the server says `unlimited: false` (the renewal is
 *    overdue past the grace): then past_due, the "check your payment" state, matching the server,
 *    which is spending ink again
 *  - past_due, unpaid, paused -> past_due (a payment problem; help spends ink meanwhile)
 *  - canceled, incomplete_expired -> canceled
 *  - incomplete, or null (the checkout is linked, the subscription's own event is not in yet) -> incomplete
 *  - none or anything else -> none
 * A plan set to cancel (`cancel_at_period_end`, or Stripe's `cancel_at`) reads cancelAtPeriodEnd,
 * and currentPeriodEnd is then the day it ends. `checkout_ref` (a uuid) is read whatever the status.
 */
export function parseUnlimitedState(raw: unknown): UnlimitedState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return NO_UNLIMITED;
  const r = raw as Record<string, unknown>;
  const checkoutRef = typeof r.checkout_ref === "string" && UUID_RE.test(r.checkout_ref) ? r.checkout_ref.toLowerCase() : null;
  if (!("status" in r)) return { ...NO_UNLIMITED, checkoutRef };
  const stripe = typeof r.status === "string" ? r.status : null;
  let status: UnlimitedStatus;
  switch (stripe) {
    case "trialing":
    case "active":
      status = stripe === "trialing" && r.repeat_trial === true ? "repeat_trial" : r.unlimited === false ? "past_due" : stripe;
      break;
    case "past_due":
    case "unpaid":
    case "paused":
      status = "past_due";
      break;
    case "canceled":
    case "incomplete_expired":
      status = "canceled";
      break;
    case "incomplete":
    case null:
      status = "incomplete";
      break;
    default:
      return { ...NO_UNLIMITED, checkoutRef };
  }
  const cancelAt = isoOrNull(r.cancel_at);
  const periodEnd = isoOrNull(r.current_period_end);
  return {
    status,
    trialEnd: isoOrNull(r.trial_end),
    currentPeriodEnd: cancelAt ?? periodEnd,
    cancelAtPeriodEnd: r.cancel_at_period_end === true || cancelAt !== null,
    checkoutRef,
  };
}

/**
 * True while the plan would charge the card again (in its free trial, paid up, or retrying a failed
 * payment) and is not set to cancel. Deleting the account then must wait until it is cancelled in
 * the portal: nothing in the app can cancel a Stripe subscription (no server key), and
 * delete_own_account() refuses too.
 */
export function mustCancelBeforeDeleting(state: Pick<UnlimitedState, "status" | "cancelAtPeriodEnd"> | null | undefined): boolean {
  if (!state || state.cancelAtPeriodEnd) return false;
  return state.status === "trialing" || state.status === "repeat_trial" || state.status === "active" || state.status === "past_due";
}

/* ------------------------------------------------------------------------- */
/* The customer portal (manage or cancel)                                     */
/* ------------------------------------------------------------------------- */

/**
 * The customer portal's login page, from NEXT_PUBLIC_BILLING_PORTAL_URL (made and printed by
 * scripts/stripe-setup.mjs): the grown-up signs in with the checkout's email and a one-time code,
 * then cancels or changes the card. Inlined at build time like unlimitedLink(). Null when unset or
 * not an absolute http(s) URL.
 */
export function billingPortalLink(): string | null {
  return parseUnlimitedLink(process.env.NEXT_PUBLIC_BILLING_PORTAL_URL);
}

/** The portal's login page with the email prefilled (it can be changed there); null without a link. */
export function billingPortalUrl(email: string | null | undefined, link: string | null = billingPortalLink()): string | null {
  const safe = parseUnlimitedLink(link);
  if (!safe) return null;
  const url = new URL(safe);
  const e = email?.trim();
  if (e) url.searchParams.set("prefilled_email", e);
  return url.toString();
}

/** The ink meter's words for a subscriber (the board bar and the app header). */
export const UNLIMITED_METER_COPY = {
  word: "Unlimited",
  label: `${UNLIMITED_PLAN.name}: help uses no ink`,
} as const;
