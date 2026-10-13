/**
 * The home's hold on new boards (src/lib/billing/newBoards.ts): while an account is on its free
 * board, whatever makes a board asks first, and the hold sends it to the plan screen instead.
 */
import { describe, expect, it, vi } from "vitest";
import { holdNewBoards, mayMakeBoard } from "@/lib/billing/newBoards";

describe("new boards on the free board", () => {
  it("are allowed with no hold", () => {
    expect(mayMakeBoard()).toBe(true);
  });

  it("run the hold (the plan screen) instead, every time, until it is released", () => {
    const toPlan = vi.fn();
    const release = holdNewBoards(toPlan);
    expect(mayMakeBoard()).toBe(false);
    expect(mayMakeBoard()).toBe(false);
    expect(toPlan).toHaveBeenCalledTimes(2);
    release();
    expect(mayMakeBoard()).toBe(true);
    expect(toPlan).toHaveBeenCalledTimes(2);
  });

  it("an older hold's release never lifts a newer one (the home remounting)", () => {
    const first = vi.fn();
    const second = vi.fn();
    const releaseFirst = holdNewBoards(first);
    const releaseSecond = holdNewBoards(second);
    releaseFirst();
    expect(mayMakeBoard()).toBe(false);
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    releaseSecond();
    expect(mayMakeBoard()).toBe(true);
  });
});
