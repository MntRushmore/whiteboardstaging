import { describe, expect, it } from "vitest";

import {
  composeAngleArc,
  composeArrow,
  composeCaret,
  composeCircle,
  composeHandwriting,
  composeTickMarks,
  composeUnderline,
  type ComposedInk,
} from "@/lib/hand/compose";
import { polylineToSvgD, samplePath } from "@/lib/hand/path";

function assertSane(ink: ComposedInk, label: string): void {
  expect(ink.segments.length, label).toBeGreaterThan(0);
  expect(ink.width, label).toBeGreaterThan(0);
  expect(ink.height, label).toBeGreaterThan(0);
  for (const segment of ink.segments) {
    expect(segment.points.length, label).toBeGreaterThanOrEqual(2);
    for (const p of segment.points) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z), label).toBe(true);
      expect(p.z, label).toBeGreaterThan(0);
    }
  }
}

describe("composeHandwriting", () => {
  it("writes a line of prose as tremored strokes", () => {
    assertSane(composeHandwriting("nice work", { maxWidth: 400, seed: 3 }), "prose");
  });

  it("wraps at maxWidth instead of running off the edge", () => {
    const text = "check the sign on the second term";
    const wide = composeHandwriting(text, { maxWidth: 4000, seed: 3 });
    const narrow = composeHandwriting(text, { maxWidth: 120, seed: 3 });
    expect(narrow.height).toBeGreaterThan(wide.height);
    expect(narrow.width).toBeLessThan(wide.width);
  });

  it("is deterministic for a fixed seed and varies with the seed", () => {
    const opts = { maxWidth: 400, seed: 3 };
    expect(composeHandwriting("solve for x", opts)).toEqual(composeHandwriting("solve for x", opts));
    expect(composeHandwriting("solve for x", { ...opts, seed: 4 })).not.toEqual(composeHandwriting("solve for x", opts));
  });

  it("skips characters it has no glyph for rather than throwing", () => {
    expect(() => composeHandwriting("a § b", { maxWidth: 400, seed: 3 })).not.toThrow();
  });
});

describe("teacher marks", () => {
  it("draws every mark as finite ink", () => {
    assertSane(composeCircle(60, 30, 7), "circle");
    assertSane(composeCaret(7), "caret");
    assertSane(composeUnderline(80, 7), "underline");
    assertSane(composeAngleArc(60, 60, 7), "angle arc");
    assertSane(composeTickMarks(60, 7), "tick marks");
    assertSane(composeArrow(60, 20, 7), "arrow");
  });

  it("gives an arrow a shaft and a head", () => {
    expect(composeArrow(60, 20, 7).segments).toHaveLength(2);
    expect(composeTickMarks(60, 7).segments).toHaveLength(3);
  });
});

describe("polylineToSvgD", () => {
  it("round-trips a sampled path", () => {
    const [poly] = samplePath("M 1 2 L 3 4 L 5 6");
    const d = polylineToSvgD(poly);
    expect(d).toBe("M 1 2 L 3 4 L 5 6");
    expect(samplePath(d)[0]).toEqual(poly);
    expect(polylineToSvgD([])).toBe("");
  });
});
