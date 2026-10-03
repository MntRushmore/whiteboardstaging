import { describe, expect, it } from "vitest";
import { CONFETTI_COLORS, confettiPieces } from "../confetti";

/** a fixed sequence, so the burst is the same every run */
function seeded(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

describe("a burst of confetti", () => {
  it("has as many pieces as asked, in every colour in turn, one in three a dot", () => {
    const pieces = confettiPieces(14, 100, seeded([0.5]));
    expect(pieces).toHaveLength(14);
    expect(pieces.map((p) => p.color)).toEqual(Array.from({ length: 14 }, (_, i) => CONFETTI_COLORS[i % CONFETTI_COLORS.length]));
    expect(pieces.filter((p) => p.round)).toHaveLength(5);
  });

  it("flies out round a circle about `spread` wide, a little upwards, starting within 80 ms", () => {
    const pieces = confettiPieces(36, 120, seeded([0, 0.25, 0.5, 0.75, 0.99]));
    for (const p of pieces) {
      const dist = Math.hypot(p.dx, p.dy + 120 * 0.35);
      expect(dist).toBeGreaterThanOrEqual(120 * 0.5 - 1e-9);
      expect(dist).toBeLessThanOrEqual(120 * 1.1 + 1e-9);
      expect(p.delay).toBeGreaterThanOrEqual(0);
      expect(p.delay).toBeLessThan(80);
      expect(Math.abs(p.rot)).toBeLessThanOrEqual(360);
    }
    // on balance upwards (negative dy)
    expect(pieces.reduce((n, p) => n + p.dy, 0)).toBeLessThan(0);
  });

  it("is the same burst for the same random sequence, and nothing for nothing", () => {
    expect(confettiPieces(8, 60, seeded([0.1, 0.7]))).toEqual(confettiPieces(8, 60, seeded([0.1, 0.7])));
    expect(confettiPieces(0, 60)).toEqual([]);
    expect(confettiPieces(-3, 60)).toEqual([]);
  });
});
