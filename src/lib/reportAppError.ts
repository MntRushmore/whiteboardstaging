import type { ClientErrorSource } from "@/lib/clientErrors";

/**
 * The front door of client error reporting, and the only part in every page's first load (a few
 * hundred bytes; the board's budget is nearly spent, docs/BUNDLE.md). The reporter itself
 * (src/lib/clientErrors.ts: dedupe, cap, noise, query-string stripping, sending) is a lazy chunk:
 * `preloadErrorReporter` fetches it a few seconds after the page loads, so it is already in memory
 * when a tab left open across a deploy hits an error (the old chunk would be gone by then), and a
 * report made before that simply waits for it. Never throws, never rejects.
 */
const load = () => import("@/lib/clientErrors");

export function reportAppError(source: ClientErrorSource, error: unknown, digest?: string): void {
  load().then(
    (m) => m.reportClientError(source, error, digest),
    () => {},
  );
}

/** Fetch the reporter once the page has settled. */
export function preloadErrorReporter(delayMs = 3000): void {
  setTimeout(() => load().catch(() => {}), delayMs);
}
