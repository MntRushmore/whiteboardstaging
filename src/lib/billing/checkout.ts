/**
 * Pure helpers for paying through Stripe with no server secret: Payment Links for checkout,
 * the customer portal's login page for everything after it (switch plan, cancel, update the
 * card). The links come from NEXT_PUBLIC_BILLING_LINKS (src/lib/billing/links.ts, made by
 * scripts/stripe-setup.mjs); the plan change itself arrives later through the webhook, which
 * is why the account page polls after a return (upgradeReturnState below).
 *
 * No React, no network: unit-tested in __tests__/checkout.test.ts.
 */
import { hasSubscription, periodEndLabel, type BillingLinks, type CreditSummary } from "@/lib/billing/viewModel";

/** Who is paying: the id goes back to us in the webhook, the email is prefilled at Stripe. */
export type Payer = { userId: string; email?: string | null };

/** Query parameter a Payment Link's after-completion redirect sets: /account?upgraded=<plan id>. */
export const UPGRADE_PARAM = "upgraded";

/** Plan ids as the `plans` table allows them (plans_id_format). */
const PLAN_ID_RE = /^[a-z][a-z0-9_-]{0,31}$/;

function withParams(base: string | undefined | null, params: Record<string, string | null | undefined>): string | null {
  if (!base) return null;
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  return url.toString();
}

/**
 * A plan's Payment Link for this user: `client_reference_id` is how the webhook
 * (checkout.session.completed) knows whose plan to change, and `prefilled_email` saves typing.
 * Null without a link or a user id: a checkout that cannot be matched to anyone must not start.
 */
export function checkoutUrl(link: string | undefined | null, payer: Payer | null | undefined): string | null {
  if (!payer?.userId) return null;
  return withParams(link, { client_reference_id: payer.userId, prefilled_email: payer.email?.trim() || null });
}

/** The portal's login page with the email filled in (Stripe then emails a one-time link). */
export function portalUrl(link: string | undefined | null, email?: string | null): string | null {
  return withParams(link, { prefilled_email: email?.trim() || null });
}

/**
 * NEXT_PUBLIC_BILLING_LINKS made ready to follow for this user: every plan's Payment Link
 * carries their id and email, the portal link their email. A link that cannot be used (no
 * user id yet, a malformed URL) is left out, so the UI shows no button rather than a bad one.
 */
export function payerLinks(links: BillingLinks, payer: Payer | null | undefined): BillingLinks {
  const out: Record<string, string> = {};
  for (const [key, link] of Object.entries(links)) {
    const url = key === "portal" ? portalUrl(link, payer?.email) : checkoutUrl(link, payer);
    if (url) out[key] = url;
  }
  return out;
}

/** The plan the student just paid for, from `?upgraded=plus`; null when absent or malformed. */
export function parseUpgradeReturn(search: string | URLSearchParams | null | undefined): string | null {
  if (!search) return null;
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  const value = params.get(UPGRADE_PARAM)?.trim().toLowerCase() ?? "";
  return PLAN_ID_RE.test(value) ? value : null;
}

/* ------------------------------------------------------------------------- */
/* Subscription state (from credit_summary's billing_status / current_period_end) */
/* ------------------------------------------------------------------------- */

type BillingFields = Pick<CreditSummary, "plan_id"> & Partial<Pick<CreditSummary, "billing_status" | "current_period_end">>;

export type SubscriptionView =
  | { kind: "none" }
  | { kind: "active"; line: string }
  | { kind: "canceling"; line: string }
  | { kind: "past_due"; line: string };

/**
 * One line about the subscription for the plan card: when it renews, that it is cancelled
 * and until when the plan lasts, or that a payment failed. `planName` is the current plan's.
 */
export function subscriptionView(summary: (BillingFields & { plan_name?: string }) | null | undefined, now: Date = new Date()): SubscriptionView {
  if (!hasSubscription(summary) || !summary) return { kind: "none" };
  const plan = summary.plan_name ?? "your plan";
  const date = periodEndLabel(summary.current_period_end ?? null, now);
  switch (summary.billing_status) {
    case "canceling":
      return {
        kind: "canceling",
        line: date
          ? `Cancelled: you keep ${plan} until ${date}, then move to Free.`
          : `Cancelled: you keep ${plan} until the end of this billing period, then move to Free.`,
      };
    case "past_due":
    case "unpaid":
    case "incomplete":
      return { kind: "past_due", line: `Your last payment didn't go through. Update your card to keep ${plan}.` };
    default:
      return { kind: "active", line: date ? `${plan} renews on ${date}.` : `${plan} renews every month.` };
  }
}

/* ------------------------------------------------------------------------- */
/* Back from checkout: wait for the webhook                                   */
/* ------------------------------------------------------------------------- */

/** How often the account page re-reads credit_summary while it waits for the webhook. */
export const UPGRADE_POLL_MS = 2_000;
/** After this long the page stops waiting and says so (the webhook may still land later). */
export const UPGRADE_TIMEOUT_MS = 60_000;

export type UpgradeReturnState = "waiting" | "done" | "timeout";

/**
 * Where the "Upgrading…" notice is: done as soon as credit_summary reports the plan paid for,
 * timeout once `timeoutMs` has passed without it, waiting otherwise (also while the first read
 * is still in flight).
 */
export function upgradeReturnState(input: {
  target: string;
  summary: Pick<CreditSummary, "plan_id"> | null | undefined;
  startedAt: number;
  now: number;
  timeoutMs?: number;
}): UpgradeReturnState {
  if (input.summary?.plan_id === input.target) return "done";
  return input.now - input.startedAt >= (input.timeoutMs ?? UPGRADE_TIMEOUT_MS) ? "timeout" : "waiting";
}

export const CHECKOUT_COPY = {
  upgrading: (plan: string) => `Upgrading you to ${plan}…`,
  upgradingDetail: "Your payment went through. Your new credits appear here in a few seconds.",
  done: (plan: string) => `You're on ${plan}`,
  doneDetail: (credits: string) => `${credits} credits a month, starting now.`,
  timeout: "Your plan hasn't updated yet",
  timeoutDetail:
    "Stripe has your payment, but its confirmation hasn't reached us yet. It usually lands within a minute, so check again shortly. If your plan still hasn't changed after a few minutes, report it and we'll switch it by hand.",
  checkAgain: "Check again",
  dismiss: "Dismiss",
  manage: "Manage subscription",
  manageHint: "Change plan, update your card or cancel on Stripe. You'll get a one-time sign-in link by email.",
} as const;
