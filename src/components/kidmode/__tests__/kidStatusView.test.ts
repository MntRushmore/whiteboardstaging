import { describe, expect, it } from "vitest";
import type { LiveError } from "@/lib/live/liveStore";
import { LIVE_COPY } from "@/components/live/copy";
import { KID_STATUS_COPY, kidStatusView } from "../kidStatusView";

/** The simple board's status: what a 6-year-old reads in the bar when the tutor is busy or something failed. */

const NOW = 1_000_000;
function err(patch: Partial<LiveError>): LiveError {
  return { id: "e1", kind: "recognize", code: "upstream", message: LIVE_COPY.errors.upstream, at: NOW, ...patch };
}

describe("kidStatusView", () => {
  it("says nothing while all is well", () => {
    expect(kidStatusView({ error: null, now: NOW, solving: false, canRetry: false })).toBeNull();
  });

  it("while Help me is worked out: Thinking…, with nothing to tap", () => {
    expect(kidStatusView({ error: null, now: NOW, solving: true, canRetry: false })).toEqual({ kind: "thinking", words: KID_STATUS_COPY.thinking, action: null });
  });

  it("a failed read: one calm line and one big Try again, never the grown-up's words", () => {
    const view = kidStatusView({ error: err({}), now: NOW, solving: false, canRetry: true });
    expect(view).toEqual({ kind: "error", words: KID_STATUS_COPY.oops, action: { kind: "retry", label: KID_STATUS_COPY.tryAgain, enabled: true } });
    expect(view?.words).not.toMatch(/service|hiccup|upstream|error/i);
  });

  it("an error outranks Thinking…", () => {
    expect(kidStatusView({ error: err({ code: "network" }), now: NOW, solving: true, canRetry: true })?.kind).toBe("error");
  });

  it("nothing to retry: Try again clears it, and the kid writes again", () => {
    expect(kidStatusView({ error: err({ code: "timeout" }), now: NOW, solving: false, canRetry: false })?.action).toEqual({ kind: "dismiss", label: KID_STATUS_COPY.tryAgain, enabled: true });
  });

  it("a short rate limit counts down on the button, then lets them try again", () => {
    const limited = err({ code: "rate_limited", retryAfterMs: 12_000 });
    expect(kidStatusView({ error: limited, now: NOW, solving: false, canRetry: true })).toEqual({
      kind: "error",
      words: KID_STATUS_COPY.pause,
      action: { kind: "retry", label: KID_STATUS_COPY.tryAgainIn(12), enabled: false },
    });
    expect(kidStatusView({ error: limited, now: NOW + 12_000, solving: false, canRetry: true })?.action).toEqual({ kind: "retry", label: KID_STATUS_COPY.tryAgain, enabled: true });
  });

  it("a long one (a day's fair use) is not counted down: come back later, and OK puts it away", () => {
    const view = kidStatusView({ error: err({ code: "rate_limited", retryAfterMs: 3 * 3600_000 }), now: NOW, solving: false, canRetry: true });
    expect(view).toEqual({ kind: "error", words: KID_STATUS_COPY.later, action: { kind: "dismiss", label: KID_STATUS_COPY.ok, enabled: true } });
  });

  it("signed out and out of help are for a grown-up, and say so", () => {
    expect(kidStatusView({ error: err({ code: "unauthorized" }), now: NOW, solving: false, canRetry: true })?.action?.kind).toBe("signin");
    const ink = kidStatusView({ error: err({ code: "ink" }), now: NOW, solving: false, canRetry: true });
    expect(ink?.words).toBe(KID_STATUS_COPY.unlock);
    expect(ink?.action?.kind).toBe("ink");
  });

  it("every word is short and plain enough for a young reader", () => {
    for (const words of [KID_STATUS_COPY.oops, KID_STATUS_COPY.pause, KID_STATUS_COPY.later, KID_STATUS_COPY.signIn, KID_STATUS_COPY.unlock]) {
      expect(words.split(" ").length).toBeLessThanOrEqual(7);
    }
  });
});
