type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

/** How long an idle moment is waited for before `fn` runs anyway. */
const IDLE_TIMEOUT_MS = 4_000;
/** Without `requestIdleCallback` (Safari): this long from now. */
const FALLBACK_DELAY_MS = 1_500;

/**
 * Runs `fn` in the page's next idle moment (within IDLE_TIMEOUT_MS), or FALLBACK_DELAY_MS from now
 * where there is no `requestIdleCallback`. For what the board loads once it is up rather than with
 * it (docs/BUNDLE.md). Returns the cancel; does nothing on the server.
 */
export function whenIdle(fn: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const w = window as IdleWindow;
  if (typeof w.requestIdleCallback === "function") {
    const handle = w.requestIdleCallback(fn, { timeout: IDLE_TIMEOUT_MS });
    return () => w.cancelIdleCallback?.(handle);
  }
  const timer = setTimeout(fn, FALLBACK_DELAY_MS);
  return () => clearTimeout(timer);
}
