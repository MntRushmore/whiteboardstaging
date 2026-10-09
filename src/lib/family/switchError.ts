/**
 * What the profile switcher says when POST /api/family/switch refuses or fails, and whether it is
 * worth an error report. A wrong PIN, too many tries or the day's lock is the switcher working (said
 * on the PIN pad, not reported); anything else is an error the person saw. Pure: takes the thrown value
 * (an ApiError from src/lib/api-client.ts, or anything else) by its shape.
 */
import { FAMILY_COPY } from "./copy";

export interface SwitchErrorView {
  message: string;
  /** a short code for `reportUserError` */
  code: string;
  /** an expected answer (a wrong PIN, the limit): shown, not reported */
  expected: boolean;
}

export function switchErrorView(err: unknown): SwitchErrorView {
  const e = (err ?? {}) as { status?: unknown; retryAfterMs?: unknown; body?: { reason?: unknown; triesLeft?: unknown; locked?: unknown } };
  const status = typeof e.status === "number" ? e.status : 0;
  const reason = typeof e.body?.reason === "string" ? e.body.reason : null;
  if (status === 403 && reason === "wrong_pin") {
    // the day's last wrong PIN: no countdown, only the grown-up's own sign-in opens it again
    if (e.body?.locked === true) return { message: FAMILY_COPY.pinWrongLocked, code: "pin_locked", expected: true };
    const left = typeof e.body?.triesLeft === "number" ? e.body.triesLeft : null;
    return { message: FAMILY_COPY.pinWrong(left), code: "wrong_pin", expected: true };
  }
  if (status === 429 && reason === "pin_locked") return { message: FAMILY_COPY.pinLockedDay, code: "pin_locked", expected: true };
  // the server could not count the try, so it refused it: worth a report, said kindly
  if (reason === "pin_unavailable") return { message: FAMILY_COPY.pinUnavailable, code: "pin_unavailable", expected: false };
  if (status === 429) {
    const wait = typeof e.retryAfterMs === "number" && e.retryAfterMs > 0 ? e.retryAfterMs : 15 * 60_000;
    return { message: FAMILY_COPY.pinLocked(wait), code: "rate_limited", expected: true };
  }
  if (reason === "no_pin") return { message: FAMILY_COPY.pinNoPin, code: "no_pin", expected: true };
  return { message: FAMILY_COPY.switchFailed, code: status ? `switch_${status}` : "switch_failed", expected: false };
}
