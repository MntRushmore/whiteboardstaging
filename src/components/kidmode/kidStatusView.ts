/**
 * What the simple board's bar says while the tutor is busy or something went wrong (`KidStatus`):
 * the kid's face of the status pill. The grown-up pill's words ("The tutor service had a hiccup"),
 * its 24 px Retry and Dismiss and its "…" (Board options, where Simple board can be switched off)
 * are not for a 6-year-old. Here: one calm sentence, one big button, and no menu. Pure, so what a
 * kid reads is pinned by tests.
 */
import type { LiveError } from "@/lib/live/liveStore";
import { secondsLeftFor } from "@/components/live/errorView";

export const KID_STATUS_COPY = {
  thinking: "Thinking…",
  oops: "Oops! Let's try that again.",
  /** a short rate limit: the button counts down */
  pause: "Let's take a little break.",
  /** a long one (a day's fair use): nothing to wait for on the board */
  later: "Lots of help today! Try again later.",
  signIn: "Ask a grown-up to sign in again.",
  unlock: "Ask a grown-up to unlock help.",
  tryAgain: "Try again",
  tryAgainIn: (seconds: number) => `Try again in ${seconds}`,
  ok: "OK",
  signInButton: "Sign in",
  unlockButton: "Unlock help",
} as const;

/** A wait longer than this is not counted down on the button: the kid is told to come back later. */
export const KID_COUNTDOWN_MAX_S = 90;

/**
 * The button's job: `retry` the failed call, `dismiss` the error (no call to retry: the kid just
 * writes again), `signin`, or `ink` (the plan's dialog, for the grown-up).
 */
export type KidStatusAction = "retry" | "dismiss" | "signin" | "ink";

export interface KidStatusView {
  kind: "error" | "thinking";
  words: string;
  action: { kind: KidStatusAction; label: string; enabled: boolean } | null;
}

export interface KidStatusState {
  /** the error the pill would show (`pillError`: not one the card beside its line already shows) */
  error: LiveError | null;
  now: number;
  /** a Help me is being worked out (`liveStore.solving`) */
  solving: boolean;
  /** the failed call can be retried (`liveStore.retryHandler`) */
  canRetry: boolean;
}

export function kidStatusView({ error, now, solving, canRetry }: KidStatusState): KidStatusView | null {
  if (error) {
    const again = { kind: canRetry ? "retry" : "dismiss", label: KID_STATUS_COPY.tryAgain, enabled: true } as const;
    switch (error.code) {
      case "unauthorized":
        return { kind: "error", words: KID_STATUS_COPY.signIn, action: { kind: "signin", label: KID_STATUS_COPY.signInButton, enabled: true } };
      case "ink":
        return { kind: "error", words: KID_STATUS_COPY.unlock, action: { kind: "ink", label: KID_STATUS_COPY.unlockButton, enabled: true } };
      case "rate_limited": {
        const left = secondsLeftFor(error, now);
        if (left > KID_COUNTDOWN_MAX_S) return { kind: "error", words: KID_STATUS_COPY.later, action: { kind: "dismiss", label: KID_STATUS_COPY.ok, enabled: true } };
        if (left > 0) return { kind: "error", words: KID_STATUS_COPY.pause, action: { ...again, label: KID_STATUS_COPY.tryAgainIn(left), enabled: false } };
        return { kind: "error", words: KID_STATUS_COPY.oops, action: again };
      }
      default:
        return { kind: "error", words: KID_STATUS_COPY.oops, action: again };
    }
  }
  return solving ? { kind: "thinking", words: KID_STATUS_COPY.thinking, action: null } : null;
}
