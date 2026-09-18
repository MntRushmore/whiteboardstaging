import { describe, expect, it } from "vitest";

import { strokeBounds, type Stroke } from "@/lib/hand/mathLayout";
import { layoutSteps } from "@/lib/hand/writeSteps";

function bounds(strokes: Stroke[]) {
  const b = strokeBounds(strokes);
  expect(b, "expected ink").not.toBeNull();
  return b!;
}

const SOLVE = ["2x + 3 = 11", "2x = 8", "x = 4"];

describe("layoutSteps", () => {
  it("stacks the lines down the page without overlapping", () => {
    const block = layoutSteps(SOLVE, { seed: 2 });
    expect(block.lines).toHaveLength(3);
    expect(block.unsupported).toEqual([]);

    for (let i = 1; i < block.lines.length; i++) {
      const above = bounds(block.lines[i - 1].strokes);
      const below = bounds(block.lines[i].strokes);
      expect(above.maxY, `line ${i - 1} collides with line ${i}`).toBeLessThan(below.minY);
      expect(block.lines[i].y).toBeGreaterThan(block.lines[i - 1].y);
    }
  });

  it("keeps one left margin for every line", () => {
    const left = 40;
    const size = 24;
    const block = layoutSteps(SOLVE, { seed: 2, left, size });
    for (const line of block.lines) {
      const b = bounds(line.strokes);
      expect(b.minX).toBeGreaterThanOrEqual(left - 1e-6);
      // Only the glyph's own side bearing may separate the ink from the margin.
      expect(b.minX).toBeLessThan(left + size * 0.3);
    }
  });

  it("reports a block big enough to hold every line", () => {
    const block = layoutSteps(SOLVE, { seed: 2, left: 10 });
    for (const line of block.lines) {
      const b = bounds(line.strokes);
      expect(b.maxX).toBeLessThanOrEqual(block.width + 1e-6);
      expect(b.minY).toBeGreaterThanOrEqual(-1e-6);
      expect(b.maxY).toBeLessThanOrEqual(block.height + 1e-6);
    }
    expect(block.width).toBeGreaterThan(10);
    expect(block.height).toBeGreaterThan(0);
  });

  it("honours an explicit line height", () => {
    const tight = layoutSteps(SOLVE, { seed: 2, lineHeight: 30 });
    const loose = layoutSteps(SOLVE, { seed: 2, lineHeight: 90 });
    expect(loose.height).toBeGreaterThan(tight.height);
    expect(loose.lines[1].y - loose.lines[0].y).toBeCloseTo(90, 6);
  });

  it("never lets a tall line run into the next one", () => {
    const block = layoutSteps(["\\frac{x+1}{2x-3}", "\\frac{1}{2}", "x = \\sqrt{\\frac{9}{4}}"], {
      seed: 6,
      lineHeight: 4,
    });
    for (let i = 1; i < block.lines.length; i++) {
      expect(bounds(block.lines[i - 1].strokes).maxY).toBeLessThan(bounds(block.lines[i].strokes).minY);
    }
  });

  it("writes each line in a different hand", () => {
    const block = layoutSteps(["x = 4", "x = 4"], { seed: 2 });
    expect(block.lines[0].strokes).not.toEqual(block.lines[1].strokes);
  });

  it("is deterministic for a fixed seed", () => {
    expect(layoutSteps(SOLVE, { seed: 2 })).toEqual(layoutSteps(SOLVE, { seed: 2 }));
    expect(layoutSteps(SOLVE, { seed: 3 })).not.toEqual(layoutSteps(SOLVE, { seed: 2 }));
  });

  it("surfaces a line it could not draw, per line and for the block", () => {
    const block = layoutSteps(["x = 4", "\\sum_{i=1}^{n} i"], { seed: 2 });
    expect(block.lines[0].unsupported).toEqual([]);
    expect(block.lines[1].unsupported).toContain("\\sum");
    expect(block.unsupported).toContain("\\sum");
    expect(block.lines[1].latex).toBe("\\sum_{i=1}^{n} i");
  });

  it("handles an empty list", () => {
    expect(layoutSteps([])).toEqual({ lines: [], width: 0, height: 0, unsupported: [] });
  });
});
