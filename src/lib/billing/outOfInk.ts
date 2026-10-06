/**
 * The words of the ink dialog and panel (the board's dialog, the Ask and lecture panels). There is
 * no free plan and no ink packs any more (owner, 2026-10-05): a 402 means help needs Agathon
 * Unlimited, so the panel is about the plan. When the dialog may open is inkDialog.ts (that part
 * is in the board's first load; this one only arrives with the lazy dialog). No React, no
 * network: unit-tested in __tests__/outOfInk.test.ts.
 *
 * The path of a 402: a Live route answers `402 ink_empty` -> classifyLiveFailure
 * (src/components/live/errorView.ts) records a LiveError with code 'ink' -> the board's
 * OutOfInkWatcher opens the dialog once the pen has rested, at most once per visit to the board.
 * The Ask and lecture panels map their own 402 and show the same panel inline.
 *
 * Who meets it: a student on the guided first board whose starter ink ran out (`offer`), and one
 * whose plan is not giving free help right now — a second plan before its first charge, a payment
 * to fix, a plan being set up — whose help spends what ink they have (`plan`).
 */
import { UNLIMITED_PLAN, hasPlan, isUnlimited, type UnlimitedState } from "@/lib/billing/unlimited";

/**
 * - `unlimited`: the plan is on (it arrived while the panel was open): all set;
 * - `offer`: no plan: start the free trial (the plan screen);
 * - `plan`: a plan that is not giving free help yet or any more: what it is doing, and the fix.
 */
export type InkPanelMood = "unlimited" | "offer" | "plan";

export function inkPanelMood(state: Pick<UnlimitedState, "status">): InkPanelMood {
  if (isUnlimited(state)) return "unlimited";
  return hasPlan(state) ? "plan" : "offer";
}

export const OUT_OF_INK_COPY = {
  /** the 402's title, here and in the Ask and lecture panels (literals there keep the panel lazy) */
  title: `Help needs ${UNLIMITED_PLAN.name}`,
  offerBody: `Help me, Solve and Ask come with ${UNLIMITED_PLAN.name}: free for ${UNLIMITED_PLAN.trialDays} days, then $${UNLIMITED_PLAN.monthlyUsd} a month. Your board is saved.`,
  start: "Start the free trial",
  restart: "Start Unlimited again",
  comingSoon: "Coming soon",
  /** a plan whose help spends ink right now, with none left */
  outOfInk: "You're out of ink",
  planTitle: UNLIMITED_PLAN.name,
  allSet: "You're all set",
  allSetBody: `${UNLIMITED_PLAN.name} is on, so help is unlimited. The tutor is ready when you are.`,
  backToBoard: "Back to the board",
  notNow: "Not now",
  seePlan: "See your plan",
} as const;
