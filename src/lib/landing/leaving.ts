/**
 * "This document is leaving by a full load" (landing v3, docs/LANDING-V3.md "Root"). `/` is two pages
 * and only a full load lets the server pick between them, so several things leave that way: the
 * boards home's signed-out gate and check, sign-in into `/`, sign-out (src/lib/landing/links.ts,
 * AppHeader). Once one has started, nothing follows it: the gate and the page's own check, or
 * sign-out and a page's own "signed out → /login", would otherwise both go, and whichever lands last
 * wins (WebKit and Chromium disagree). AuthProvider takes no more auth changes into state once it is
 * set, so no page reacts on the way out. The mark is a property of `window`, so it dies with the
 * document. Its own module, with nothing else in it: AuthProvider is on every page, the board's too.
 */
export const LEAVING_FLAG = "__agathonLeaving";

type LeavingWindow = Window & { [LEAVING_FLAG]?: number };

/** True once this document is leaving by a full load. False on the server. */
export function isLeaving(): boolean {
  return typeof window !== "undefined" && Boolean((window as LeavingWindow)[LEAVING_FLAG]);
}

/** Marks this document as leaving by a full load, or (`false`) not after all: a sign-out that failed. */
export function markLeaving(on: boolean): void {
  const w = window as LeavingWindow;
  if (on) w[LEAVING_FLAG] = 1;
  else delete w[LEAVING_FLAG];
}
