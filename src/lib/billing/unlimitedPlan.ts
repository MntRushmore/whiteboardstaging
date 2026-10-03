/**
 * The account page's Plan section, as words: what the student's Agathon Unlimited plan is doing
 * and the one thing to do about it. The grown-up who pays reads this too, so it says plainly when
 * money moves. No React, no network: unit-tested in __tests__/unlimitedPlan.test.ts.
 *
 * Loaded with the account page only (not the board), so the copy can be generous.
 */
import { UNLIMITED_PLAN, trialEndsOn, type UnlimitedState } from "@/lib/billing/unlimited";

export type PlanAction =
  /** start the free week (the plan's Payment Link) */
  | "start"
  /** the customer portal: cancel, change the card, invoices */
  | "manage"
  /** the customer portal, to fix a failed payment */
  | "fix-payment"
  /** read the plan again (it is being set up) */
  | "refresh";

export interface PlanView {
  /** for tests and styling: which state the section is in */
  kind: "offer" | "trialing" | "repeat_trial" | "active" | "ending" | "past_due" | "pending" | "ended";
  /** short label next to the title ("Free week", "Active", …); null for none */
  badge: string | null;
  /** the main sentence */
  headline: string;
  /** a second, quieter sentence; null for none */
  detail: string | null;
  action: PlanAction;
  /** the button's or link's words */
  actionLabel: string;
}

const PRICE = `$${UNLIMITED_PLAN.monthlyUsd}`;

/** "Friday, October 10": a long date in the reader's time zone (or the one given, for tests). */
export function planDate(iso: string | null | undefined, timeZone?: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", ...(timeZone ? { timeZone } : {}) });
}

export const PLAN_COPY = {
  title: UNLIMITED_PLAN.name,
  offer: `Help from the tutor without counting ink. Free for ${UNLIMITED_PLAN.trialDays} days, then ${PRICE} a month. Cancel any time.`,
  offerDetail: (firstCharge: string) => `A grown-up's card is needed at checkout. Nothing is charged until ${firstCharge}.`,
  start: `Try Unlimited free for ${UNLIMITED_PLAN.trialDays} days`,
  comingSoon: "Coming soon",
  manage: "Manage or cancel",
  fixPayment: "Update your card",
  refresh: "Check again",
  portalHint: "You'll sign in with the email used at checkout.",
  noPortal: "To manage or cancel your plan, use the link in the email Stripe sent when it started.",
  ended: (on: string | null) => (on ? `Your plan ended on ${on}. Help uses ink again.` : "Your plan has ended. Help uses ink again."),
  /** Delete account, while the plan would charge again (DangerZone). */
  deleteBlockedTitle: `Cancel ${UNLIMITED_PLAN.name} first`,
  deleteBlockedBody:
    "Deleting your account doesn't cancel your plan, so cancel it first. Once it's set to cancel, you won't be charged again and you can delete your account here.",
  /** A second plan's free week (repeat_trial): no free help, said before the reader wonders why. */
  repeatTrial: "The free week is for a first plan only, so help uses ink until then. Cancel before that day and you won't be charged.",
  /** The ink card's note for a subscriber: the balance is not being spent. */
  inkNote: "Agathon Unlimited is on, so help uses no ink. Your ink stays here for later.",
} as const;

/**
 * What the Plan section shows for `state` at `now`. `timeZone` is for tests (the page uses the
 * reader's own).
 */
export function unlimitedPlanView(state: UnlimitedState, opts: { now: Date; timeZone?: string }): PlanView {
  const tz = opts.timeZone;
  const trialEnd = planDate(state.trialEnd ?? state.currentPeriodEnd, tz);
  const periodEnd = planDate(state.currentPeriodEnd, tz);
  const ending = state.cancelAtPeriodEnd;

  switch (state.status) {
    case "trialing":
      return ending
        ? {
            kind: "ending",
            badge: "Free week",
            headline: trialEnd ? `Your free week ends on ${trialEnd}, and your plan ends with it.` : "Your free week is on, and your plan ends with it.",
            detail: "You won't be charged. Until then, help uses no ink.",
            action: "manage",
            actionLabel: PLAN_COPY.manage,
          }
        : {
            kind: "trialing",
            badge: "Free week",
            headline: trialEnd ? `Your free week ends on ${trialEnd}.` : "Your free week is on.",
            detail: trialEnd
              ? `Then ${PRICE} a month, starting that day, until you cancel. Help uses no ink meanwhile.`
              : `Then ${PRICE} a month until you cancel. Help uses no ink meanwhile.`,
            action: "manage",
            actionLabel: PLAN_COPY.manage,
          };
    case "repeat_trial":
      // A second plan's trial: Stripe charges when it ends, but the free help is for a first plan
      // only (has_unlimited()), so help uses ink until then. Said plainly, not as a payment problem.
      return ending
        ? {
            kind: "ending",
            badge: "Starting",
            headline: trialEnd ? `Your plan was set to start on ${trialEnd}, and it is cancelled.` : "Your plan is cancelled before it starts.",
            detail: "You won't be charged. Help uses ink meanwhile.",
            action: "manage",
            actionLabel: PLAN_COPY.manage,
          }
        : {
            kind: "repeat_trial",
            badge: "Starting",
            headline: trialEnd ? `Your plan starts on ${trialEnd}, with the first ${PRICE} charge.` : `Your plan starts with the first ${PRICE} charge.`,
            detail: PLAN_COPY.repeatTrial,
            action: "manage",
            actionLabel: PLAN_COPY.manage,
          };
    case "active":
      return ending
        ? {
            kind: "ending",
            badge: "Active",
            headline: periodEnd ? `Your plan ends on ${periodEnd}.` : "Your plan is set to end.",
            detail: "You won't be charged again. Until then, help uses no ink.",
            action: "manage",
            actionLabel: PLAN_COPY.manage,
          }
        : {
            kind: "active",
            badge: "Active",
            headline: periodEnd ? `Next charge: ${PRICE} on ${periodEnd}.` : `${PRICE} a month until you cancel.`,
            detail: "Help uses no ink while your plan is on.",
            action: "manage",
            actionLabel: PLAN_COPY.manage,
          };
    case "past_due":
      return {
        kind: "past_due",
        badge: "Payment needed",
        headline: "Your last payment didn't go through.",
        detail: "Update your card to keep Unlimited. Until then, help uses your ink.",
        action: "fix-payment",
        actionLabel: PLAN_COPY.fixPayment,
      };
    case "incomplete":
      return {
        kind: "pending",
        badge: null,
        headline: "We're setting up your plan.",
        detail: "This usually takes a few seconds.",
        action: "refresh",
        actionLabel: PLAN_COPY.refresh,
      };
    case "canceled":
      return {
        kind: "ended",
        badge: null,
        headline: PLAN_COPY.ended(periodEnd),
        detail: PLAN_COPY.offer,
        action: "start",
        actionLabel: PLAN_COPY.start,
      };
    default:
      return {
        kind: "offer",
        badge: null,
        headline: PLAN_COPY.offer,
        detail: PLAN_COPY.offerDetail(planDate(trialEndsOn(opts.now).toISOString(), tz) ?? `${UNLIMITED_PLAN.trialDays} days from now`),
        action: "start",
        actionLabel: PLAN_COPY.start,
      };
  }
}
