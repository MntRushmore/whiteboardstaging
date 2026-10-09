import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KICKOFF_DELAY_MS, resetKickoffs, startKickoff } from "../BoardChatPanel";

describe("Ask's kickoff (the topic picker's words, sent as the first ask)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetKickoffs();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends the words once, a moment after the panel opens, and says so first (the board clears its marker)", () => {
    const order: string[] = [];
    const send = vi.fn((t: string) => order.push(`send:${t}`));
    const sent = vi.fn(() => order.push("sent"));
    startKickoff("b1:1", "test on quadratics Friday", { send, sent });
    vi.advanceTimersByTime(KICKOFF_DELAY_MS - 1);
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(order).toEqual(["sent", "send:test on quadratics Friday"]);
  });

  it("React's double effects (start, clean up, start) and a remount send it once", () => {
    const send = vi.fn();
    const cancel = startKickoff("b1:1", "fractions", { send });
    cancel();
    startKickoff("b1:1", "fractions", { send });
    vi.runAllTimers();
    startKickoff("b1:1", "fractions", { send });
    vi.runAllTimers();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("a closed panel before the moment passes sends nothing; a new kickoff (the board's sheet again) sends again", () => {
    const send = vi.fn();
    startKickoff("b1:1", "fractions", { send })();
    vi.runAllTimers();
    expect(send).not.toHaveBeenCalled();
    startKickoff("b1:2", "area of triangles", { send });
    vi.runAllTimers();
    expect(send).toHaveBeenCalledWith("area of triangles");
  });

  it("no kickoff, or no words: nothing", () => {
    const send = vi.fn();
    startKickoff(null, "fractions", { send });
    startKickoff("b1:3", "   ", { send });
    vi.runAllTimers();
    expect(send).not.toHaveBeenCalled();
  });
});
