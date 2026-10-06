/**
 * The plan screen: where every student without a plan ends up. There is no free plan (owner,
 * 2026-10-05): it comes right after the guided board, and the home, the boards and Progress send
 * anyone without Agathon Unlimited back to it (`usePlanGate`). It offers the plan
 * (`src/lib/billing/unlimited.ts`) with its free trial — the price crossed out, nothing charged
 * today — says plainly that a grown-up's card is charged when the trial ends, and has no "Maybe
 * later": the way on is the free trial (or the app header's menu: Account, Sign out).
 *
 * Pure: what the screen shows, its words, and the date it needs. The route is
 * src/app/(platform)/welcome/plan; where it is, `planMarker.ts`; the home's welcome back from
 * checkout, `arrival.ts`.
 */
import { UNLIMITED_PLAN, hasPlan, type UnlimitedState } from "@/lib/billing/unlimited";

/**
 * - `checking`: the subscription is still being read (nothing shows: a subscriber is never pitched);
 * - `skip`: the account has a plan (`hasPlan`: in its free trial, paid up, a second plan waiting for
 *   its first charge, one being set up or with a payment to fix): straight on to the home;
 * - `offer`: the pitch, with Start the free trial;
 * - `restart`: a plan that ended, offered again: a second plan has no free trial (`has_unlimited`'s
 *   first-plan rule), so nothing is crossed out;
 * - `soon`: the pitch without a checkout (the Payment Link is not configured): "Coming soon", and
 *   Continue goes home (the paywall is off without a checkout too: `planGate`).
 */
export type PlanView = "checking" | "skip" | "offer" | "restart" | "soon";

export function planView({ loading, unlimited, checkoutUrl }: { loading: boolean; unlimited: Pick<UnlimitedState, "status"> | null; checkoutUrl: string | null }): PlanView {
  if (loading) return "checking";
  // A subscription that exists but is not (yet) unlimited — being set up, or a payment to fix — is
  // never offered a second checkout: that would be a second $25 a month.
  if (hasPlan(unlimited)) return "skip";
  if (!checkoutUrl) return "soon";
  return unlimited?.status === "canceled" ? "restart" : "offer";
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
  return formatDay(date, { weekday: "long", month: "long", day: "numeric" }, locale);
}

/** The same day, short, for the bill's date column: "Sat, Oct 10" (en-US), "Sat 10 Oct" (en-GB). */
export function chargeDayText(date: Date, locale?: string): string {
  return formatDay(date, { weekday: "short", month: "short", day: "numeric" }, locale);
}

function formatDay(date: Date, options: Intl.DateTimeFormatOptions, locale?: string): string {
  try {
    return new Intl.DateTimeFormat(locale, options).format(date);
  } catch {
    // an unknown locale tag: the default format is still a date
    return new Intl.DateTimeFormat(undefined, options).format(date);
  }
}

const PRICE = dollars(UNLIMITED_PLAN.monthlyUsd);

export const PLAN_COPY = {
  title: UNLIMITED_PLAN.name,
  lede: "Your tutor checks every line you write, and helps the moment you're stuck.",
  /** a plan that ended, offered again (`restart`) */
  welcomeBack: "Welcome back. Your boards are where you left them.",
  /**
   * The board, as the student just saw it: their working, and the tutor's ticks and note. Written
   * in the board's own handwriting face; the label is what a screen reader hears for the figure.
   */
  sheet: {
    label: "An example of the tutor at work: each right step gets a tick.",
    prompt: "Solve for x",
    problem: "3x + 5 = 20",
    steps: ["3x = 15", "x = 5"],
    note: "Nice. Want three more like this?",
  },
  perksTitle: "What you get",
  perks: [
    { id: "help", text: "Help me and Solve", detail: "as often as you need" },
    { id: "ask", text: "Ask your tutor anything", detail: "practice, graphs and figures" },
    { id: "check", text: "Every line checked", detail: "as you write it" },
    { id: "courses", text: "Every course", detail: "Algebra to Calculus" },
  ],
  // Said TO the grown-up, not "ask a grown-up": guidance on advertising to children (CARU) is
  // against urging a child to ask a parent to buy.
  grownUp: "This part is for a grown-up",
  /** the offer, plainly: no struck-through price, no gradient */
  offer: `${UNLIMITED_PLAN.trialDays} days free, then ${PRICE} a month.`,
  /** a plan that ended has no free trial (`has_unlimited`'s first-plan rule): from the first charge */
  restartOffer: (day: string) => `${PRICE} a month, starting ${day}.`,
  grownUpHint: "A parent or guardian adds a card at checkout.",
  /** the bill: when the card is charged, and how much */
  bill: {
    label: "When the card is charged",
    today: "Today",
    starts: "Free trial starts",
    /** a plan that ended: Stripe charges nothing until the first charge, but help uses ink until then */
    restartStarts: "Your ink until then",
    first: "First charge",
    restartFirst: "Unlimited starts, first charge",
    monthly: "Every month",
    untilCancel: "Until you cancel",
    nothing: "$0",
    price: PRICE,
  },
  start: "Start the free trial",
  opening: "Opening checkout…",
  /** the auto-renewal disclosure, right under the button */
  disclosure: (date: string) =>
    `Nothing is charged today. The card is charged ${PRICE} on ${date}, then every month, unless you cancel before then.`,
  restart: "Start Unlimited again",
  restartNote: "The free trial is for a first plan only, so help uses your ink until the first charge.",
  /** under the disclosure: the plan's terms, and the fair-use limit "Unlimited" is subject to */
  termsLink: { href: "/terms#unlimited", text: "How the plan works" },
  fairUseLink: { href: "/terms#fair-use", text: "Fair use" },
  /** without a checkout (the Payment Link is not configured): the offer line, and a way on */
  soonTitle: "Unlimited isn't open yet.",
  soonNote: "Your starter ink is ready to use.",
  continue: "Continue",
} as const;
