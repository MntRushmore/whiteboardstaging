import { describe, expect, it } from "vitest";
import {
  fixtureDetachedCrossbar,
  fixtureFloatingMark,
  fixtureFraction,
  fixtureSingleLine,
  fixtureSuperscript,
  fixtureTwoColumns,
  fixtureTwoLines,
  toInkStrokes,
  translateShapes,
} from "../__fixtures__/strokes";
import {
  clusterLines,
  inflateRect,
  inflationFor,
  isFractionBar,
  isSuperscriptOf,
  medianStrokeHeight,
  rebuildFromMathShapes,
} from "../strokeClusters";
import type { Rect } from "../contracts";

describe("clusterLines", () => {
  it("groups '2x+3=11' into one line with all strokes", () => {
    const strokes = toInkStrokes(fixtureSingleLine());
    const lines = clusterLines(strokes);
    expect(lines).toHaveLength(1);
    expect(lines[0].strokeIds).toHaveLength(strokes.length);
    expect(lines[0].column).toBe(0);
    expect(lines[0].row).toBe(0);
    expect(lines[0].id).toMatch(/^ln_[0-9a-f]{8}$/);
  });

  it("separates two stacked lines into rows of one column", () => {
    const lines = clusterLines(toInkStrokes(fixtureTwoLines()));
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.column)).toEqual([0, 0]);
    expect(lines.map((l) => l.row)).toEqual([0, 1]);
    expect(lines[0].bounds.y).toBeLessThan(lines[1].bounds.y);
  });

  it("merges numerator, fraction bar and denominator into one line", () => {
    const strokes = toInkStrokes(fixtureFraction());
    const medianH = medianStrokeHeight(strokes);
    const bar = strokes[1];
    expect(isFractionBar(bar, strokes, medianH)).toBe(true);
    const lines = clusterLines(strokes);
    expect(lines).toHaveLength(1);
    expect(lines[0].strokeIds).toHaveLength(strokes.length);
  });

  it("does not treat an '=' sign as a fraction bar", () => {
    const strokes = toInkStrokes(fixtureSingleLine());
    const medianH = medianStrokeHeight(strokes);
    const flats = strokes.filter((s) => s.bounds.w > 3 * s.bounds.h);
    expect(flats.length).toBeGreaterThanOrEqual(2);
    for (const f of flats) expect(isFractionBar(f, strokes, medianH)).toBe(false);
  });

  it("puts side-by-side work into two columns", () => {
    const lines = clusterLines(toInkStrokes(fixtureTwoColumns()));
    expect(lines).toHaveLength(4);
    const columns = new Set(lines.map((l) => l.column));
    expect(columns.size).toBe(2);
    const col0 = lines.filter((l) => l.column === 0).map((l) => l.row).sort();
    expect(col0).toEqual([0, 1]);
  });

  it("keeps line ids stable when >= 50 % of strokes overlap and assigns new ids otherwise", () => {
    const shapes = fixtureTwoLines();
    const first = clusterLines(toInkStrokes(shapes));
    const byRow = [...first].sort((a, b) => a.row - b.row);
    // Add one more glyph stroke to line 2 -> id must persist, hash resets.
    const extra = translateShapes([shapes[shapes.length - 1]], 40, 0).map((s) => ({ ...s, id: `${s.id}_dup` as typeof s.id }));
    const second = clusterLines(toInkStrokes([...shapes, ...extra]), first.map((l) => ({ ...l, hash: "abc" })));
    const secondByRow = [...second].sort((a, b) => a.row - b.row);
    expect(secondByRow[0].id).toBe(byRow[0].id);
    expect(secondByRow[0].hash).toBe("abc");
    expect(secondByRow[1].id).toBe(byRow[1].id);
    expect(secondByRow[1].hash).toBe("");
    // A brand-new line far away gets a fresh id.
    const third = clusterLines(toInkStrokes([...shapes, ...fixtureSingleLine().map((s) => ({ ...s, y: s.y + 400 }))]), second);
    const ids = new Set(third.map((l) => l.id));
    expect(ids.size).toBe(3);
    expect(ids.has(byRow[0].id)).toBe(true);
  });

  it("returns [] for no ink", () => {
    expect(clusterLines([])).toEqual([]);
  });
});

describe("rebuildFromMathShapes", () => {
  it("seeds lines from echoes' anchorIds and drops dead anchors", () => {
    const bounds = new Map<string, Rect>([
      ["shape:a", { x: 0, y: 0, w: 20, h: 40 }],
      ["shape:b", { x: 30, y: 0, w: 20, h: 40 }],
      ["shape:c", { x: 0, y: 100, w: 20, h: 40 }],
    ]);
    const rebuilt = rebuildFromMathShapes(
      [
        { shapeId: "shape:m1" as never, lineId: "ln_1", anchorIds: ["shape:a", "shape:b", "shape:gone"], latex: "2x" },
        { shapeId: "shape:m2" as never, lineId: "ln_2", anchorIds: ["shape:c"], latex: "x" },
        { shapeId: "shape:m3" as never, lineId: "ln_3", anchorIds: ["shape:gone"], latex: "?" },
      ],
      bounds,
    );
    expect(rebuilt).toHaveLength(2);
    expect(rebuilt[0].line.strokeIds).toEqual(["shape:a", "shape:b"]);
    expect(rebuilt[0].line.bounds).toEqual({ x: 0, y: 0, w: 50, h: 40 });
    expect(rebuilt[0].line.row).toBe(0);
    expect(rebuilt[1].line.row).toBe(1);
    expect(rebuilt[1].latex).toBe("x");
  });
});

describe("clusterLines — inflation and superscripts (B7)", () => {
  it("joins a zero-height cross-bar drawn 2 px above the stem's top (F/E/T bars)", () => {
    const strokes = toInkStrokes(fixtureDetachedCrossbar());
    const medianH = medianStrokeHeight(strokes);
    // The bar has no height at all and no vertical overlap with the stem.
    const bar = strokes[1];
    expect(bar.bounds.h).toBeLessThan(1);
    expect(medianH).toBeLessThan(20);
    const lines = clusterLines(strokes);
    expect(lines).toHaveLength(1);
    expect(lines[0].strokeIds).toHaveLength(strokes.length);
  });

  it("inflates rects by at least 3 px", () => {
    expect(inflationFor(8)).toBe(3);
    expect(inflationFor(40)).toBe(4);
    expect(inflateRect({ x: 10, y: 20, w: 30, h: 0 }, 3)).toEqual({ x: 7, y: 17, w: 36, h: 6 });
  });

  it("joins a raised superscript '2' whose bottom sits above the x's top", () => {
    const strokes = toInkStrokes(fixtureSuperscript());
    const lines = clusterLines(strokes);
    expect(lines).toHaveLength(1);
    expect(lines[0].strokeIds).toHaveLength(3);
  });

  it("recognizes the superscript geometry directly", () => {
    const medianH = 28;
    const base: Rect = { x: 100, y: 212, w: 28, h: 28 };
    expect(isSuperscriptOf({ x: 132, y: 190, w: 13, h: 18 }, base, medianH)).toBe(true);
    // too tall to be a superscript
    expect(isSuperscriptOf({ x: 132, y: 184, w: 13, h: 26 }, base, medianH)).toBe(false);
    // far above: a stray mark, not a superscript
    expect(isSuperscriptOf({ x: 132, y: 150, w: 13, h: 18 }, base, medianH)).toBe(false);
    // far to the right
    expect(isSuperscriptOf({ x: 170, y: 190, w: 13, h: 18 }, base, medianH)).toBe(false);
    // below the base's top by more than a quarter: a normal glyph, not raised
    expect(isSuperscriptOf({ x: 132, y: 210, w: 13, h: 18 }, base, medianH)).toBe(false);
  });

  it("keeps a small mark floating far above the line separate", () => {
    const lines = clusterLines(toInkStrokes(fixtureFloatingMark()));
    expect(lines).toHaveLength(2);
  });

  it("does not merge stacked lines or side-by-side columns after inflation", () => {
    expect(clusterLines(toInkStrokes(fixtureTwoLines()))).toHaveLength(2);
    expect(clusterLines(toInkStrokes(fixtureTwoColumns()))).toHaveLength(4);
  });
});
