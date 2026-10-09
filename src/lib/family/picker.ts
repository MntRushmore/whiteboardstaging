/**
 * "Switch profile" from anywhere: the header menu's item (a kid's menu) opens the "Who's practising?"
 * picker, which lives in the lazily loaded ProfileSwitcher. A window event carries the ask, so the
 * header needs nothing of the switcher's code in its first load (AppHeader must never pull in more
 * than it shows; see src/components/app/AppHeader.tsx). No React; never throws.
 */
export const OPEN_PICKER_EVENT = "agathon:family-picker";

/** Ask the profile switcher to open its picker (a no-op outside the browser). */
export function openProfilePicker(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(OPEN_PICKER_EVENT));
  } catch {
    /* an old browser without Event(): the switcher's own button still opens it */
  }
}

/** Call `open` whenever something asks for the picker; returns the unsubscribe. */
export function onOpenProfilePicker(open: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(OPEN_PICKER_EVENT, open);
  return () => window.removeEventListener(OPEN_PICKER_EVENT, open);
}
