/**
 * The plan screen: the last screen of onboarding, once, after the guided board and before the
 * home (owner, 2026-10-03). It offers Agathon Unlimited (`src/lib/billing/unlimited.ts`) with its
 * free beta week — the price crossed out, nothing charged today — and says plainly that a
 * grown-up's card is charged when the week ends. A student who skipped the tour never sees it
 * (they asked to get going; the pitch can wait for a grown-up and the account page).
 *
 * Pure: what the screen shows, its words, and the dates and URLs it needs. The route is
 * src/app/(platform)/welcome/plan; the device marker that it is due lives in `marker.ts`.
 */
import { UNLIMITED_PLAN, UNLIMITED_RETURN_PARAM, isUnlimited, type UnlimitedState } from "@/lib/billing/unlimited";
import type { PlanMarker } from "./marker";

export const PLAN_PATH = "/welcome/plan";
export const HOME_PATH = "/";

/**
 * - `checking`: the subscription is still being read (nothing shows: a subscriber is never pitched);
 * - `skip`: already on the plan (trialing or paid up): straight on to the home;
 * - `offer`: the pitch, with Start my free week;
 * - `soon`: the pitch without a checkout (the Payment Link is not configured): "Coming soon".
 */
export type PlanView = "checking" | "skip" | "offer" | "soon";

export function planView({ loading, unlimited, checkoutUrl }: { loading: boolean; unlimited: Pick<UnlimitedState, "status"> | null; checkoutUrl: string | null }): PlanView {
  if (loading) return "checking";
  if (isUnlimited(unlimited)) return "skip";
  return checkoutUrl ? "offer" : "soon";
}

/** The home sends the student to the plan screen only while it is due and has not shown (`marker.ts`). */
export function planDue(marker: PlanMarker | null): boolean {
  return marker === "pending";
}

/** "$25", for a whole-dollar price. */
export function dollars(usd: number): string {
  return Number.isInteger(usd) ? `$${usd}` : `$${usd.toFixed(2)}`;
}

/**
 * The day the card is first charged, in the reader's words: "Saturday, October 10" (en-US),
 * "Saturday 10 October" (en-GB). `locale` undefined is the browser's own.
 */
export function chargeDateText(date: Date, locale?: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { weekday: "long", month: "long", day: "numeric" }).format(date);
  } catch {
    // an unknown locale tag: the default format is still a date
    return new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(date);
  }
}

const PRICE = dollars(UNLIMITED_PLAN.monthlyUsd);

export const PLAN_COPY = {
  kicker: "One more thing",
  title: UNLIMITED_PLAN.name,
  /** the struck-through price, and what a screen reader hears before it */
  price: `${PRICE}/month`,
  priceWas: "Usually",
  free: "Free for your beta week",
  then: `Then ${PRICE}/month. Cancel anytime.`,
  perksTitle: "What you get",
  perks: [
    { id: "help", text: "Unlimited Help me and Solve" },
    { id: "ask", text: "Ask your tutor anything" },
    { id: "check", text: "Checks every line you write" },
    { id: "courses", text: "Every course, from Algebra to Calculus" },
  ],
  grownUp: "Ask a grown-up to start your free week",
  grownUpHint: "They add a card at checkout. It takes a minute.",
  start: "Start my free week",
  opening: "Opening checkout…",
  /** the auto-renewal disclosure, right under the button */
  disclosure: (date: string) => `You won't be charged today. Your grown-up's card is charged ${PRICE} on ${date} unless you cancel before then.`,
  later: "Maybe later",
  soon: "Coming soon",
  /** without a checkout, in place of the grown-up's line */
  soonTitle: "Unlimited isn't open yet",
  soonNote: "Your starter ink is ready to use. Have fun!",
  continue: "Continue",
  /** back from checkout on the home (`?unlimited=started`) */
  started: "Your free week has started!",
  startedHint: "Help me, Solve and Ask are unlimited now. Have fun!",
} as const;

/**
 * The query string without `?unlimited=…` (and with everything else kept), for replacing the URL
 * once the home has said welcome back: a reload must not cheer again. "" when nothing is left.
 */
export function withoutUnlimitedReturn(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(UNLIMITED_RETURN_PARAM);
  const rest = params.toString();
  return rest ? `?${rest}` : "";
}
