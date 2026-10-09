/**
 * What the profile switcher says when POST /api/family/switch refuses or fails, and whether it is
 * worth an error report. A wrong PIN or too many tries is the switcher working (said on the PIN pad,
 * not reported); anything else is an error the person saw. Pure: takes the thrown value
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
  const e = (err ?? {}) as { status?: unknown; retryAfterMs?: unknown; body?: { reason?: unknown; triesLeft?: unknown } };
  const status = typeof e.status === "number" ? e.status : 0;
  const reason = typeof e.body?.reason === "string" ? e.body.reason : null;
  if (status === 403 && reason === "wrong_pin") {
    const left = typeof e.body?.triesLeft === "number" ? e.body.triesLeft : null;
    return { message: FAMILY_COPY.pinWrong(left), code: "wrong_pin", expected: true };
  }
  if (status === 429) {
    const wait = typeof e.retryAfterMs === "number" && e.retryAfterMs > 0 ? e.retryAfterMs : 15 * 60_000;
    return { message: FAMILY_COPY.pinLocked(wait), code: "rate_limited", expected: true };
  }
  if (reason === "no_pin") return { message: FAMILY_COPY.pinNoPin, code: "no_pin", expected: true };
  return { message: FAMILY_COPY.switchFailed, code: status ? `switch_${status}` : "switch_failed", expected: false };
}
