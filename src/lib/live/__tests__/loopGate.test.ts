import { afterEach, describe, expect, it, vi } from "vitest";
import { createLoopGate, type LoopReadiness } from "../loopGate";

/** A promise's state now, without waiting on it. */
async function peek(p: Promise<LoopReadiness>): Promise<LoopReadiness | "pending"> {
  return Promise.race([p, new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 0))]);
}

/** The microtask the gate defers its "gone for good" to. */
const turn = () => Promise.resolve();

/**
 * A board's Live loop, for runs that outlive a render (`useLiveMath`'s `whenReady` / `boardClosed`).
 * On 2026-10-12 a practice run outlived its board (the kid left during the look at the worked
 * example) and, unable to tell "not up yet" from "gone", toasted and reported a failure from "/".
 */
describe("loop gate", () => {
  afterEach(() => vi.useRealTimers());

  it("a loop not up yet: whenReady waits for it, and resolves the moment it opens (no polling)", async () => {
    const gate = createLoopGate();
    const ready = gate.whenReady("b1", 15_000);
    expect(await peek(ready)).toBe("pending");
    expect(gate.closed("b1")).toBe(false);
    gate.open("b1");
    await expect(ready).resolves.toBe("ready");
    // up: at once from now on
    await expect(gate.whenReady("b1", 15_000)).resolves.toBe("ready");
  });

  it("the effect run again in the same turn (React's development double effects, a new editor) never closes the board", async () => {
    const gate = createLoopGate();
    gate.open("b1");
    gate.close();
    gate.open("b1");
    await turn();
    expect(gate.closed("b1")).toBe(false);
    await expect(gate.whenReady("b1", 15_000)).resolves.toBe("ready");
  });

  it("between a cleanup and the next run, a waiter waits for the new loop", async () => {
    const gate = createLoopGate();
    gate.open("b1");
    gate.close();
    const ready = gate.whenReady("b1", 15_000);
    gate.open("b1");
    await expect(ready).resolves.toBe("ready");
  });

  it("the board unmounted for good: closed, and a waiter hears so at once", async () => {
    const gate = createLoopGate();
    const waiting = gate.whenReady("b1", 15_000);
    gate.open("b1");
    await expect(waiting).resolves.toBe("ready");
    gate.close();
    const later = gate.whenReady("b1", 15_000);
    await turn();
    expect(gate.closed("b1")).toBe(true);
    await expect(later).resolves.toBe("closed");
    await expect(gate.whenReady("b1", 15_000)).resolves.toBe("closed");
  });

  it("another board's loop in its place: a run for the first one is for a board that is gone", async () => {
    const gate = createLoopGate();
    gate.open("b1");
    gate.close();
    gate.open("b2");
    await turn();
    expect(gate.closed("b1")).toBe(true);
    expect(gate.closed("b2")).toBe(false);
    await expect(gate.whenReady("b1", 15_000)).resolves.toBe("closed");
    await expect(gate.whenReady("b2", 15_000)).resolves.toBe("ready");
  });

  it("a loop that never comes up: timeout at the ceiling, not before", async () => {
    vi.useFakeTimers();
    const gate = createLoopGate();
    let result: LoopReadiness | null = null;
    void gate.whenReady("b1", 15_000).then((r) => (result = r));
    await vi.advanceTimersByTimeAsync(14_999);
    expect(result).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(result).toBe("timeout");
    // the waiter is gone with it: opening later wakes nothing stale
    gate.open("b1");
    await expect(gate.whenReady("b1", 15_000)).resolves.toBe("ready");
  });

  it("a board shown again after it was closed (the same controller, reopened) is up again", async () => {
    const gate = createLoopGate();
    gate.open("b1");
    gate.close();
    await turn();
    expect(gate.closed("b1")).toBe(true);
    gate.open("b1");
    expect(gate.closed("b1")).toBe(false);
    await expect(gate.whenReady("b1", 15_000)).resolves.toBe("ready");
  });
});
