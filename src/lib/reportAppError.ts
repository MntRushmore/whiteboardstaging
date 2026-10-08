import type { ClientErrorSource, UserErrorInput } from "@/lib/clientErrors";

/**
 * The front door of client error reporting, and the only part in every page's first load (a few
 * hundred bytes; the board's budget is nearly spent, docs/BUNDLE.md). The reporter itself
 * (src/lib/clientErrors.ts: dedupe, cap, noise, query-string stripping, sending) is a lazy chunk:
 * `preloadErrorReporter` fetches it a few seconds after the page loads, so it is already in memory
 * when a tab left open across a deploy hits an error (the old chunk would be gone by then), and a
 * report made before that simply waits for it. Never throws, never rejects.
 */
const load = () => import("@/lib/clientErrors");

/** A crash: a window error, a rejection, an error boundary. */
export function reportAppError(source: ClientErrorSource, error: unknown, digest?: string): void {
  load().then(
    (m) => m.reportClientError(source, error, digest),
    () => {},
  );
}

/**
 * An error a student SAW — an error card, a failed save, a chat request that failed: what failed
 * (`kind`, `live.<what>`), how (`code`) and the words they were shown (our copy only, never what
 * they wrote or typed). Deduped and capped in src/lib/clientErrors.ts (`createUserReporter`).
 */
export function reportUserError(error: UserErrorInput): void {
  void reportUserErrorBeforeLeaving(error);
}

/**
 * As `reportUserError`, for a page about to go away (a reload): resolves once the report is on its
 * way — a beacon or a keepalive fetch, which outlive the page — or could not be sent. Never rejects.
 */
export function reportUserErrorBeforeLeaving(error: UserErrorInput): Promise<void> {
  return load().then(
    (m) => m.reportUserError(error),
    () => {},
  );
}

/** Fetch the reporter once the page has settled. */
export function preloadErrorReporter(delayMs = 3000): void {
  setTimeout(() => load().catch(() => {}), delayMs);
}
