import { describe, expect, it } from "vitest";
import { LANDING_COPY } from "@/components/landing/copy";
import { handInk } from "../handInk";

describe("handInk", () => {
  it("writes every problem in the strip, stroke after stroke", () => {
    for (const { latex } of LANDING_COPY.strip.items) {
      const ink = handInk(latex, { size: 40, seed: 3 });
      expect(ink.strokes.length, latex).toBeGreaterThan(2);
      for (let i = 1; i < ink.strokes.length; i++) {
        expect(ink.strokes[i].atMs).toBeGreaterThanOrEqual(ink.strokes[i - 1].atMs + ink.strokes[i - 1].forMs);
      }
      expect(ink.durationMs).toBe(ink.strokes.at(-1)!.atMs + ink.strokes.at(-1)!.forMs);
      expect(ink.width).toBeGreaterThan(0);
    }
  });

  it("writes the same strokes for the same seed, and faster at a higher speed", () => {
    expect(handInk("8+6=14", { seed: 5 })).toEqual(handInk("8+6=14", { seed: 5 }));
    expect(handInk("8+6=14", { speed: 2 }).durationMs).toBeLessThan(handInk("8+6=14").durationMs);
  });

  it("refuses a line the hand cannot write, rather than half-writing it", () => {
    expect(() => handInk("\\unknowncmd{x}")).toThrow(/cannot write/);
  });
});
