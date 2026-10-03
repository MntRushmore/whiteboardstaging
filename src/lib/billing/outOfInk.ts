/**
 * The words of the ink dialog and panel (the board's dialog, the Ask and lecture panels): out of
 * ink, or just getting more. When the dialog may open is inkDialog.ts (that part is in the board's
 * first load; this one only arrives with the lazy dialog). No React, no network: unit-tested in
 * __tests__/outOfInk.test.ts.
 *
 * The path of a 402: a Live route answers `402 ink_empty` -> classifyLiveFailure
 * (src/components/live/errorView.ts) records a LiveError with code 'ink' -> the board's
 * OutOfInkWatcher opens the dialog once the pen has rested, at most once per visit to the board.
 * The Ask and lecture panels map their own 402 and show the same panel inline.
 */
import { inkLabel } from "@/lib/billing/inkSummary";

export type InkPanelMood = "empty" | "buy";

export const OUT_OF_INK_COPY = {
  title: "You're out of ink",
  body: "The tutor needs ink to read and check your work. Your board is saved, and drawing on your own is always free.",
  buyTitle: "Get more ink",
  buyBody: (balance: number) => `You have ${inkLabel(balance)} left. Ink never expires, so a pack lasts as long as you need it to.`,
  lead: "Pick a pack to keep the tutor going:",
  newTab: "Checkout opens in a new tab; your ink shows up here when you're done.",
  comingSoon: "Ink packs aren't on sale yet.",
  added: "Ink added",
  addedBody: (balance: number) => `You have ${inkLabel(balance)} now. The tutor is ready when you are.`,
  backToBoard: "Back to the board",
  notNow: "Not now",
  seeAccount: "See your ink",
} as const;

/**
 * Which way the panel reads: 'empty' when the student has no ink (or a 402 brought them here and
 * the balance has not arrived yet), else 'buy'.
 */
export function inkPanelMood(balance: number | null | undefined, outOfInk: boolean): InkPanelMood {
  if (typeof balance === "number" && Number.isFinite(balance)) return balance <= 0 ? "empty" : "buy";
  return outOfInk ? "empty" : "buy";
}

/**
 * True once ink arrived while the panel was open: the balance it opened with was 0 (or unknown
 * at the time) and is now above it. The panel then says "Ink added" instead of asking again.
 */
export function inkArrived(openedWith: number | null, now: number | null | undefined): boolean {
  return typeof now === "number" && now > 0 && (openedWith === null || now > openedWith);
}
