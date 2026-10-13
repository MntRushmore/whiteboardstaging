import { describe, expect, it } from "vitest";
import { tear, tornEdge, tornOutline } from "../torn";

/** The numbers in a path or a polygon, in order. */
const numbers = (s: string) => [...s.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));

describe("tear", () => {
  it("runs the whole length, in order, never biting deeper than its depth", () => {
    for (const seed of [1, 7, 42, 9001]) {
      const points = tear(1920, { seed, depth: 10 });
      expect(points[0].at).toBe(0);
      expect(points.at(-1)!.at).toBe(1920);
      for (let i = 1; i < points.length; i++) {
        const step = points[i].at - points[i - 1].at;
        expect(step).toBeGreaterThan(0);
        expect(step).toBeLessThanOrEqual(8.05);
      }
      for (const p of points) {
        expect(p.bite).toBeGreaterThanOrEqual(0);
        expect(p.bite).toBeLessThanOrEqual(10);
      }
    }
  });

  it("is irregular: it wanders over most of its depth, not a flat line or a regular zigzag", () => {
    const bites = tear(1920, { seed: 3, depth: 10 }).map((p) => p.bite);
    expect(Math.max(...bites) - Math.min(...bites)).toBeGreaterThan(5);
    const steps = new Set(tear(1920, { seed: 3, depth: 10 }).slice(1, 40).map((p, i, a) => (i ? Math.round((p.at - a[i - 1].at) * 10) : 0)));
    expect(steps.size).toBeGreaterThan(10);
  });
});

describe("tornEdge", () => {
  it("tears the same edge for the same seed, and another for another seed", () => {
    expect(tornEdge({ seed: 21, depth: 10, fiber: true })).toEqual(tornEdge({ seed: 21, depth: 10, fiber: true }));
    expect(tornEdge({ seed: 21 }).d).not.toBe(tornEdge({ seed: 22 }).d);
  });

  it("is a closed sheet: flat along the bottom of its box, torn along the top, within the box", () => {
    for (const fiber of [false, true]) {
      const edge = tornEdge({ seed: 5, depth: 9, fiber });
      expect(edge.width).toBe(1920);
      expect(edge.d.startsWith(`M0 ${edge.height}V`)).toBe(true);
      expect(edge.d.endsWith(`L1920 ${edge.height}Z`)).toBe(true);
      expect(numbers(edge.d).every(Number.isFinite)).toBe(true);
      // walk the relative steps: every point stays inside the box
      let x = 0;
      let y = Number(edge.d.match(/V(-?[\d.]+)/)![1]);
      for (const [, dx, dy] of edge.d.matchAll(/l(-?[\d.]+)\s?(-?[\d.]+)/g)) {
        x += Number(dx);
        y += Number(dy);
        expect(y).toBeGreaterThanOrEqual(-0.05);
        expect(y).toBeLessThanOrEqual(edge.height + 0.05);
      }
      expect(x).toBeCloseTo(1920, 0);
      expect(edge.fiber === null).toBe(!fiber);
    }
  });
});

describe("tornOutline", () => {
  it("is a CSS polygon round all four edges, the same for the same seed", () => {
    const a = tornOutline({ seed: 71, width: 540, height: 226 });
    expect(a).toBe(tornOutline({ seed: 71, width: 540, height: 226 }));
    expect(a).not.toBe(tornOutline({ seed: 72, width: 540, height: 226 }));
    expect(a.startsWith("polygon(")).toBe(true);
    const points = a.slice("polygon(".length, -1).split(",");
    expect(points.length).toBeGreaterThan(40);
    // bites are px and never more than the depth; places along an edge are 0 to 100%
    for (const n of [...a.matchAll(/(-?[\d.]+)px/g)].map((m) => Number(m[1]))) expect(n).toBeLessThanOrEqual(6);
    for (const n of [...a.matchAll(/(-?[\d.]+)%/g)].map((m) => Number(m[1]))) {
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(100);
    }
  });
});
