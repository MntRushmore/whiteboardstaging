/**
 * What running out of credits looks like on the board, as pure logic: the words (shared by the
 * board's dialog and the Ask panel), the reset date and the upgrade choices. When the dialog may
 * open is creditsDialog.ts (that part is in the board's first load; this one only in the lazy
 * dialog). No React, no network: unit-tested in __tests__/outOfCredits.test.ts.
 *
 * The path of a 402: a Live route answers `402 credits_exhausted` -> classifyLiveFailure
 * (src/components/live/errorView.ts) records a LiveError with code 'credits' -> the board's
 * OutOfCreditsWatcher opens the dialog once the pen has rested, at most once per visit to the
 * board. The Ask panel maps its own 402 with chatErrorFor (src/components/chat/chatView.ts) and
 * shows the same panel inline.
 */
import {
  formatCredits,
  formatPrice,
  hasSubscription,
  periodEndLabel,
  type BillingLinks,
  type CreditSummary,
  type Plan,
} from "@/lib/billing/viewModel";

export const OUT_OF_CREDITS_COPY = {
  title: "You've used this month's credits",
  body: (reset: string) =>
    `The tutor has stopped checking and answering until your credits reset on ${reset}. Your board is saved, and you can keep writing.`,
  upgradeLead: "Want the tutor back now? A bigger plan's credits start the moment you upgrade.",
  switchLead: "Want the tutor back now? Switch to a bigger plan and its credits start at once.",
  noUpgrade: "You're on the biggest plan. Your credits come back on the 1st.",
  upgradeTo: (plan: string) => `Upgrade to ${plan}`,
  switchTo: (plan: string) => `Switch to ${plan}`,
  planDetail: (credits: string, price: string) => `${credits} credits a month · ${price}`,
  notNow: "Not now",
  seePlans: "See your plan",
} as const;

/** The first instant of next month in UTC: credits are counted per UTC calendar month. */
export function nextCreditReset(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

/**
 * "Oct 1": credit_summary's period_end when it is known, else the 1st of next month (UTC), so
 * the dialog can say when credits return even before the summary has loaded.
 */
export function creditsResetLabel(summary: Pick<CreditSummary, "period_end"> | null | undefined, now: Date = new Date()): string {
  return periodEndLabel(summary?.period_end, now) || periodEndLabel(nextCreditReset(now).toISOString(), now);
}

export type UpgradeOption = {
  planId: string;
  name: string;
  /** "12,000 credits a month · $29/month" */
  detail: string;
  /** "Upgrade to Pro" (a Payment Link) or "Switch to Pro" (the portal, for a subscriber) */
  label: string;
  href: string;
};

/**
 * The plans bigger than the current one, each with where its button goes: its Payment Link for a
 * user without a subscription, the customer portal for a subscriber (a second Payment Link would
 * start a second subscription). `links` must already carry the user (checkout.ts payerLinks);
 * a plan with nowhere to go is left out.
 */
export function upgradeOptionsFor(
  plans: ReadonlyArray<Plan>,
  summary: CreditSummary | null | undefined,
  links: BillingLinks,
): UpgradeOption[] {
  const active = plans.filter((p) => p.active !== false);
  const current = summary ? active.find((p) => p.id === summary.plan_id) : undefined;
  const floor = current?.monthly_credits ?? summary?.monthly_credits ?? 0;
  const subscribed = hasSubscription(summary);
  const out: UpgradeOption[] = [];
  for (const plan of [...active].sort((a, b) => a.monthly_credits - b.monthly_credits)) {
    if (plan.monthly_credits <= floor || plan.price_cents <= 0) continue;
    const href = subscribed ? links.portal : links[plan.id];
    if (!href) continue;
    out.push({
      planId: plan.id,
      name: plan.name,
      detail: OUT_OF_CREDITS_COPY.planDetail(formatCredits(plan.monthly_credits), formatPrice(plan.price_cents)),
      label: subscribed ? OUT_OF_CREDITS_COPY.switchTo(plan.name) : OUT_OF_CREDITS_COPY.upgradeTo(plan.name),
      href,
    });
  }
  return out;
}

/** The lead line above the upgrade choices (or instead of them). */
export function upgradeLeadFor(options: ReadonlyArray<UpgradeOption>, summary: CreditSummary | null | undefined): string | null {
  if (options.length === 0) return hasSubscription(summary) ? OUT_OF_CREDITS_COPY.noUpgrade : null;
  return hasSubscription(summary) ? OUT_OF_CREDITS_COPY.switchLead : OUT_OF_CREDITS_COPY.upgradeLead;
}
