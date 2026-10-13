import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PEN_UP_POLL_MS, PEN_UP_WAIT_MS, whenPenUp } from "../whenPenUp";

describe("whenPenUp", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** settles `p` as far as the timers allow; true once it resolved */
  async function settled(p: Promise<void>): Promise<boolean> {
    let done = false;
    void p.then(() => (done = true));
    await vi.advanceTimersByTimeAsync(0);
    return done;
  }

  it("resolves at once when no pointer is down (the save is not delayed)", async () => {
    const isPointing = vi.fn(() => false);
    expect(await settled(whenPenUp(isPointing))).toBe(true);
    expect(isPointing).toHaveBeenCalledTimes(1);
  });

  it("waits while the pen is down and resolves soon after it lifts", async () => {
    let pointing = true;
    const p = whenPenUp(() => pointing);
    expect(await settled(p)).toBe(false);
    await vi.advanceTimersByTimeAsync(PEN_UP_POLL_MS * 5);
    expect(await settled(p)).toBe(false);
    pointing = false;
    await vi.advanceTimersByTimeAsync(PEN_UP_POLL_MS);
    expect(await settled(p)).toBe(true);
  });

  it("gives up after the cap: a long drawing still saves", async () => {
    const p = whenPenUp(() => true);
    await vi.advanceTimersByTimeAsync(PEN_UP_WAIT_MS - PEN_UP_POLL_MS);
    expect(await settled(p)).toBe(false);
    await vi.advanceTimersByTimeAsync(PEN_UP_POLL_MS);
    expect(await settled(p)).toBe(true);
  });

  it("treats an editor that throws (already gone) as the pen up", async () => {
    expect(
      await settled(
        whenPenUp(() => {
          throw new Error("disposed");
        }),
      ),
    ).toBe(true);
  });
});
