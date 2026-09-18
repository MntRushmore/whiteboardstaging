import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIVE_TIMING, type BurstState } from "../contracts";
import { legacyShouldSkip, liveStore, markBurst, resetLiveStore, setLiveError } from "../liveStore";

/**
 * The gate between Live and the paid legacy image pipeline: only an 'unhandled' burst
 * (Live read the ink and has nothing to say) lets the image pipeline auto-fire.
 */
describe("liveStore.legacyShouldSkip", () => {
  const idle = LIVE_TIMING.legacyIdleMs;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    resetLiveStore();
  });
  afterEach(() => vi.useRealTimers());

  it("no burst yet: the legacy pipeline may run", () => {
    expect(liveStore.lastBurst.get()).toBeNull();
    expect(legacyShouldSkip(idle)).toBe(false);
  });

  it.each<[BurstState, boolean]>([
    ["pending", true],
    ["handled", true],
    ["failed", true],
    ["unhandled", false],
  ])("a fresh %s burst -> skip %s", (state, skip) => {
    markBurst(state);
    expect(legacyShouldSkip(idle)).toBe(skip);
  });

  it("a burst older than the idle window (+1 s grace) no longer gates anything", () => {
    for (const state of ["pending", "handled", "failed"] as const) {
      markBurst(state);
      vi.advanceTimersByTime(idle + 1000);
      expect(legacyShouldSkip(idle)).toBe(true);
      vi.advanceTimersByTime(1);
      expect(legacyShouldSkip(idle)).toBe(false);
    }
  });

  it("resetLiveStore clears the burst", () => {
    markBurst("failed");
    resetLiveStore();
    expect(legacyShouldSkip(idle)).toBe(false);
  });
});

describe("liveStore.setLiveError", () => {
  beforeEach(() => resetLiveStore());

  it("keeps the optional second line (detail) and stamps id/at", () => {
    const err = setLiveError({ kind: "recognize", code: "upstream", message: "m", detail: "paused", at: 5 });
    expect(err).toMatchObject({ kind: "recognize", code: "upstream", message: "m", detail: "paused", at: 5 });
    expect(err.id).toMatch(/^e_\d+$/);
    expect(liveStore.lastError.get()).toBe(err);
    const plain = setLiveError({ kind: "check", code: "unknown", message: "m" });
    expect(plain.detail).toBeUndefined();
  });
});
