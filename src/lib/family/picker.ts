/**
 * "Switch profile" from anywhere: the header menu's item (a kid's menu) opens the "Who's practising?"
 * picker, which lives in the lazily loaded ProfileSwitcher. A window event carries the ask, so the
 * header needs nothing of the switcher's code in its first load (AppHeader must never pull in more
 * than it shows; see src/components/app/AppHeader.tsx). No React; never throws.
 *
 * An ask made while the switcher's code is still on its way is kept for a moment (ASK_KEPT_MS) and
 * answered when the switcher arrives: the tap is never silent, and never answered long after.
 */
export const OPEN_PICKER_EVENT = "agathon:family-picker";

/** How long an ask waits for the switcher's code to arrive. */
export const ASK_KEPT_MS = 10_000;

let listening = 0;
let waitingSince: number | null = null;

/** Ask the profile switcher to open its picker (a no-op outside the browser). Takes no arguments: it is an onClick. */
export function openProfilePicker(): void {
  if (typeof window === "undefined") return;
  if (listening === 0) waitingSince = Date.now();
  try {
    window.dispatchEvent(new Event(OPEN_PICKER_EVENT));
  } catch {
    /* an old browser without Event(): the switcher's own button still opens it */
  }
}

/** Call `open` whenever something asks for the picker (and now, for a recent unanswered ask); returns the unsubscribe. */
export function onOpenProfilePicker(open: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(OPEN_PICKER_EVENT, open);
  listening += 1;
  const asked = waitingSince;
  waitingSince = null;
  if (asked !== null && Date.now() - asked <= ASK_KEPT_MS) open();
  return () => {
    window.removeEventListener(OPEN_PICKER_EVENT, open);
    listening = Math.max(0, listening - 1);
  };
}
