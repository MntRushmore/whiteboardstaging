import { describe, expect, it } from "vitest";
import {
  DEVICE_ZOOMS,
  fixtureDetachedCrossbar,
  fixtureFloatingMark,
  fixtureFraction,
  fixtureSingleLine,
  fixtureSuperscript,
  fixtureTwoColumns,
  fixtureTwoLines,
  inkAtZoom,
  toInkStrokes,
  translateShapes,
  writeLine,
} from "../__fixtures__/strokes";
import {
  assignColumns,
  clusterLines,
  inflateRect,
  inflationFor,
  isDotStroke,
  isEqualsPair,
  isFractionBar,
  isSuperscriptOf,
  medianStrokeHeight,
  rebuildFromMathShapes,
  unionRects,
} from "../strokeClusters";
import type { InkLine, InkStroke, Rect } from "../contracts";
import { splitInk } from "../diagrams";
import { youngGlyphs, youngInk, youngLine } from "../__fixtures__/youngInk";
import { writeAt } from "@/__eval__/drawings";
import { VARIANTS } from "@/__eval__/handwriting";

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

  it("starts a new column for a problem written well below the last one", () => {
    // problem 1: two lines of working; problem 2 further down the page, same left edge
    const ink = [
      ...writeLine("2x=8", 100, 100),
      ...writeLine("x=4", 100, 160),
      ...writeLine("4x=8", 100, 520),
      ...writeLine("x=1", 100, 580),
    ];
    const lines = clusterLines(toInkStrokes(ink));
    expect(lines).toHaveLength(4);
    expect(lines.map((l) => [l.column, l.row])).toEqual([
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ]);
  });

  it("keeps an ordinary gap between steps in one column", () => {
    const lines = clusterLines(toInkStrokes([...writeLine("2x=8", 100, 100), ...writeLine("x=4", 100, 200)]));
    expect(lines.map((l) => l.column)).toEqual([0, 0]);
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

  it("a second echo on ink another echo already holds is not a second line", () => {
    const bounds = new Map<string, Rect>([
      ["shape:a", { x: 0, y: 0, w: 20, h: 40 }],
      ["shape:b", { x: 30, y: 0, w: 20, h: 40 }],
    ]);
    const rebuilt = rebuildFromMathShapes(
      [
        { shapeId: "shape:m1" as never, lineId: "ln_old", anchorIds: ["shape:a", "shape:b"], latex: "2x" },
        { shapeId: "shape:m2" as never, lineId: "ln_new", anchorIds: ["shape:a", "shape:b"], latex: "2x" },
      ],
      bounds,
    );
    expect(rebuilt.map((r) => r.mathShapeId)).toEqual(["shape:m1"]);
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

describe("clusterLines — what a line of handwriting really is", () => {
  let seq = 0;
  /** a stroke as a straight polyline through `pts` (page coords), in writing order */
  const stroke = (...pts: Array<[number, number]>) => {
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return {
      id: `shape:t${++seq}` as never,
      bounds: { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y },
      segments: [pts.map(([px, py]) => ({ x: px, y: py }))],
    };
  };
  const glyph = (x: number, y = 100, h = 20) => stroke([x, y], [x + 12, y + h]);

  it("the dot of a question mark belongs to it (`x = ?` is one line)", () => {
    const ink = [glyph(0), stroke([30, 108], [44, 108]), stroke([30, 114], [44, 114]), stroke([60, 100], [68, 104], [64, 114]), stroke([64, 124], [64, 125])];
    expect(clusterLines(ink)).toHaveLength(1);
  });

  it("a fraction bar written a few degrees off level still holds its numerator", () => {
    // 70 px bar tilted 4 degrees: 5 px tall, over a quarter of a 14 px glyph
    const ink = [glyph(20, 70, 14), stroke([0, 95], [70, 90]), glyph(20, 100, 14), glyph(90, 85, 14)];
    expect(clusterLines(ink)).toHaveLength(1);
  });

  it("`x \\to 2` written under `lim`, before the rest, is part of the line", () => {
    const lim = [glyph(0), glyph(14), glyph(28)];
    const under = [glyph(0, 124, 12), stroke([14, 130], [28, 130]), glyph(32, 124, 12)];
    const rest = [glyph(60), glyph(74), glyph(88)];
    expect(clusterLines([...lim, ...under, ...rest])).toHaveLength(1);
  });

  it("but the next row, started after the row above was finished, stays its own line", () => {
    const row1 = [glyph(0), glyph(14), glyph(28), glyph(42)];
    const row2 = [glyph(0, 124, 12), glyph(14, 124, 12)];
    expect(clusterLines([...row1, ...row2])).toHaveLength(2);
  });

  it("a last glyph written higher on a slant is still on the row", () => {
    const ink = [glyph(0, 104), glyph(16, 102), stroke([34, 110], [46, 108]), glyph(56, 92, 16)];
    expect(clusterLines(ink)).toHaveLength(1);
  });
});

describe("clusterLines — an operation row under an equation (`mergeOperationRows`)", () => {
  /** `latex` in the tutor's hand writing as the student, `under` placed under the parts of it that start with `at`. */
  function withRow(latex: string, pieces: Array<[string, string]>, variant = VARIANTS[0], next?: string) {
    const eq = writeAt(latex, 300, 300, variant);
    const r = unionRects(eq.map((s) => s.bounds));
    const widthOf = (l: string) => unionRects(writeAt(l, 0, 0, variant).map((s) => s.bounds)).w;
    const row = pieces.map(([piece, before]) => writeAt(piece, r.x + (before ? widthOf(before) + 8 : 0), r.y + r.h + 18, variant, 0.95));
    const rb = unionRects(row.flat().map((s) => s.bounds));
    const after = next ? writeAt(next, r.x, rb.y + rb.h + 26, variant) : [];
    return { eq, row, after, ink: [...eq, ...row.flat(), ...after] };
  }
  const ids = (strokes: InkStroke[]) => strokes.map((s) => s.id as string).sort();
  const linesOf = (ink: InkStroke[]) => clusterLines(ink).map((l) => [...l.strokeIds].sort());

  it.each(VARIANTS.map((v) => [v.name, v] as const))("-3 under + 3 and -3 under 11 is one line, the next line written or not (%s)", (_name, variant) => {
    for (const next of [undefined, "2x = 8"]) {
      const { eq, row, after, ink } = withRow("2x + 3 = 11", [["-3", "2x"], ["-3", "2x + 3 ="]], variant, next);
      const lines = linesOf(ink);
      expect(lines).toContainEqual(ids(row.flat()));
      expect(lines).toContainEqual(ids(eq));
      if (after.length > 0) expect(lines).toContainEqual(ids(after));
    }
  });

  it("÷ 2 under each side, and three pieces under a chain", () => {
    const div = withRow("5x - 7 = 2x + 11", [["\\div 2", ""], ["\\div 2", "5x - 7 = "]]);
    expect(linesOf(div.ink)).toContainEqual(ids(div.row.flat()));
    const chain = withRow("-3 < 2x + 1 < 7", [["-1", ""], ["-1", "-3 < 2x"], ["-1", "-3 < 2x + 1 <"]]);
    expect(linesOf(chain.ink)).toContainEqual(ids(chain.row.flat()));
  });

  it("pieces under two problems side by side stay apart, and so do answers that are not operations", () => {
    const left = withRow("2x + 3 = 11", [["-3", "2x"]]);
    const right = writeAt("4x - 5 = 3", 620, 300);
    const rr = unionRects(right.map((s) => s.bounds));
    const under = writeAt("+5", rr.x + 60, rr.y + rr.h + 18, VARIANTS[0], 0.95);
    const lines = linesOf([...left.ink, ...right, ...under]);
    expect(lines).toContainEqual(ids(left.row.flat()));
    expect(lines).toContainEqual(ids(under));
    const roots = withRow("x^{2} - 5x + 6 = 0", [["x = 2", ""], ["x = 3", "x^{2} - 5x + 6"]]);
    const rootLines = linesOf(roots.ink);
    for (const piece of roots.row) expect(rootLines).toContainEqual(ids(piece));
  });
});

// ---------------------------------------------------------------- columns

const sortedIds = (strokes: readonly InkStroke[]) => strokes.map((s) => s.id as string).sort();
const widthOf = (latex: string) => unionRects(writeAt(latex, 0, 0).map((s) => s.bounds)).w;
const bottomOf = (strokes: readonly InkStroke[]) => {
  const r = unionRects(strokes.map((s) => s.bounds));
  return r.y + r.h;
};
/** A problem worked down the page: one written line per entry, `step` px apart, from (x, y). */
const worked = (latex: string[], x: number, y: number, step = 50) => latex.map((l, i) => writeAt(l, x, y + i * step));
/** Where each written line went: the [column, row] of the line holding exactly its strokes, or null. */
function placed(lines: readonly InkLine[], written: readonly InkStroke[][]): Array<[number, number] | null> {
  return written.map((w) => {
    const want = sortedIds(w).join(",");
    const line = lines.find((l) => [...l.strokeIds].sort().join(",") === want);
    return line ? [line.column, line.row] : null;
  });
}

describe("clusterLines at the board's zoom: lines and columns as the student sees them", () => {
  describe.each(DEVICE_ZOOMS)("on %s", (_device, zoom) => {
    /** the written lines as drawn at this zoom (ids kept), clustered as the loop does */
    const cluster = (written: readonly InkStroke[][]) => clusterLines(inkAtZoom(written.flat(), zoom), [], [], { zoom });

    it("a three-line derivation is one column of three rows", () => {
      const work = worked(["2x + 3 = 11", "2x = 8", "x = 4"], 100, 100);
      expect(placed(cluster(work), work)).toEqual([
        [0, 0],
        [0, 1],
        [0, 2],
      ]);
    });

    it("two problems side by side are two columns", () => {
      const a = worked(["2x + 3 = 11", "2x = 8", "x = 4"], 100, 100);
      const b = worked(["4x - 5 = 3", "4x = 8", "x = 2"], 100 + widthOf("2x + 3 = 11") + 80, 100);
      expect(placed(cluster([...a, ...b]), [...a, ...b])).toEqual([
        [0, 0],
        [0, 1],
        [0, 2],
        [1, 0],
        [1, 1],
        [1, 2],
      ]);
    });

    it("two problems squeezed side by side, their rows level, are two columns too", () => {
      // 30 px apart, inside the same-row join's reach: each row of the two was ONE line, and the
      // second problem's lines were steps of the first
      const a = worked(["2x + 3 = 11", "2x + 1 = 7", "x = 3"], 100, 100);
      const b = worked(["4x - 5 = 3", "4x - 1 = 7", "x = 2"], 100 + widthOf("2x + 3 = 11") + 30, 100);
      expect(placed(cluster([...a, ...b]), [...a, ...b])).toEqual([
        [0, 0],
        [0, 1],
        [0, 2],
        [1, 0],
        [1, 1],
        [1, 2],
      ]);
    });

    it("the next step a little lower is still the next step, and a problem further down a new one", () => {
      // two lines of blank under a ~27 px hand: a student's step can be that far down; three is a
      // new problem's gap ("new problem": nothing above it, so no mark). This used to keep the
      // next step 100 px (nearly four lines) down, inside a break of 120 desktop px, but a gap
      // that wide is the blank a student leaves before a new problem (`problemGapFactor`).
      const first = writeAt("2x = 8", 100, 100);
      const h = bottomOf(first) - 100;
      const next = writeAt("x = 4", 100, bottomOf(first) + 2 * h);
      const far = writeAt("3x = 9", 100, bottomOf(next) + 3 * h);
      expect(placed(cluster([first, next, far]), [first, next, far])).toEqual([
        [0, 0],
        [0, 1],
        [1, 0],
      ]);
    });
  });
});

describe("assignColumns: a blank gap under a column starts a new problem", () => {
  const line = (id: string, y: number, h = 20, x = 0, w = 100): InkLine => ({ id, strokeIds: [], bounds: { x, y, w, h }, column: 0, row: 0, hash: "" });
  const columns = (lines: InkLine[], opts?: Parameters<typeof assignColumns>[1]) => {
    const out = assignColumns(lines, opts);
    return lines.map((l) => out.find((o) => o.id === l.id)?.column);
  };
  /** the same lines, `k` times bigger (a phone shows a hand ~5 times bigger in page px) */
  const scaled = (lines: InkLine[], k: number) => lines.map((l) => ({ ...l, bounds: { x: l.bounds.x * k, y: l.bounds.y * k, w: l.bounds.w * k, h: l.bounds.h * k } }));

  it("measures the gap in the column's own lines, the same at any zoom and in any hand", () => {
    // 20 px lines: 2.4 lines of blank under them is the next step, 2.6 a new problem
    const near = [line("a", 0), line("b", 20 + 48)];
    const far = [line("a", 0), line("b", 20 + 52)];
    for (const k of [1, 1 / 0.52, 5]) {
      expect(columns(scaled(near, k))).toEqual([0, 0]);
      expect(columns(scaled(far, k))).toEqual([0, 1]);
    }
  });

  it("by the median of the column's lines: one tall line (a fraction) does not stretch the gap a problem needs", () => {
    const lines = [line("a", 0), line("frac", 30, 60), line("c", 100), line("d", 130), line("e", 130 + 20 + 55)];
    expect(columns(lines)).toEqual([0, 0, 0, 0, 1]);
  });

  it("a gap the tutor's writing fills is not blank: the student going on under its step is in the same problem", () => {
    const lines = [line("a", 0), line("b", 30), line("c", 30 + 20 + 100)];
    expect(columns(lines)).toEqual([0, 0, 1]);
    // the tutor's step and answer in the gap, written before `c`
    const steps = [
      { x: 0, y: 60, w: 80, h: 20 },
      { x: 0, y: 90, w: 60, h: 20 },
    ];
    expect(columns(lines, { filled: (l) => (l.id === "c" ? steps : []) })).toEqual([0, 0, 0]);
    // ...but only where the column is: the tutor's writing off to the side fills nothing here
    expect(columns(lines, { filled: () => steps.map((s) => ({ ...s, x: 400 })) })).toEqual([0, 0, 1]);
    // ...and a blank stretch under the tutor's writing as tall as a new problem's gap is still one
    expect(columns([line("a", 0), line("b", 30), line("c", 30 + 20 + 160)], { filled: () => steps })).toEqual([0, 0, 1]);
  });

  it("lines that were one problem stay one when a gap opens between them (a step between them rubbed out)", () => {
    const lines = [line("a", 0), line("c", 120)];
    expect(columns(lines)).toEqual([0, 1]);
    expect(columns(lines, { together: (p, q) => [p.id, q.id].sort().join() === "a,c" })).toEqual([0, 0]);
  });

  it("a line under another problem's line is that problem's, not the one above both", () => {
    // `b` was written under `a` past a new problem's gap; `c` under `b`: the tutor's working fills
    // the gap above `b` for `c` (written after it), but `c` is under `b`
    const lines = [line("a", 0), line("b", 80), line("c", 110)];
    expect(columns(lines, { filled: (l) => (l.id === "c" ? [{ x: 0, y: 25, w: 100, h: 50 }] : []) })).toEqual([0, 1, 1]);
  });
});

describe("columns: a line goes under the last row above it, not under a wide line long gone", () => {
  const columnsOf = (written: readonly InkStroke[][]) => placed(clusterLines(written.flat()), written).map((p) => p?.[0] ?? null);

  it("a problem started beside the narrower later lines of one with a wide first line is a column of its own", () => {
    // the first line reaches over where the second problem is written: with the column as wide as
    // all its lines ever were, `y + 1 = 5` and `y = 4` were steps 4 and 5 of the first problem
    const a = worked(["3(x + 2) + 4(x - 1) = 2x + 22", "7x + 2 = 2x + 22", "5x = 20", "x = 4"], 100, 100);
    const b = worked(["y + 1 = 5", "y = 4"], 330, 200);
    expect(placed(clusterLines([...a, ...b].flat()), [...a, ...b])).toEqual([
      [0, 0],
      [0, 1],
      [0, 2],
      [0, 3],
      [1, 0],
      [1, 1],
    ]);
  });

  it("but a derivation is one column however its lines sit under one another", () => {
    // a step indented under the `=`, then the next back at the margin
    const eq = writeAt("2x + 3 = 11", 100, 100);
    const indented = writeAt("2x = 8", 100 + widthOf("2x + 3") - widthOf("2x"), 150);
    expect(columnsOf([eq, indented, writeAt("x = 4", 100, 200)])).toEqual([0, 0, 0]);
    // each line starting further right than the last
    expect(columnsOf([writeAt("3(x - 2) = 2x + 4", 100, 100), writeAt("3x - 6 = 2x + 4", 140, 150), writeAt("x - 6 = 4", 190, 200), writeAt("x = 10", 220, 250)])).toEqual([0, 0, 0, 0]);
    // a wide first line and narrower ones under it
    expect(columnsOf(worked(["3(x + 2) + 4(x - 1) = 2x + 22", "7x + 2 = 2x + 22", "5x = 20", "x = 4"], 100, 100))).toEqual([0, 0, 0, 0]);
    // two answers written apart on one row, then the next line at the margin
    const factored = writeAt("(x - 2)(x - 3) = 0", 100, 100);
    const answers = [writeAt("x = 2", 100, 150), writeAt("x = 3", 100 + widthOf("(x - 2)(x - 3)"), 150)];
    expect(columnsOf([factored, ...answers, writeAt("x = 2", 100, 200)])).toEqual([0, 0, 0, 0]);
  });
});

describe("splitAtGutters: rows of two problems side by side are cut apart, and nothing else is", () => {
  const linesOf = (ink: readonly InkStroke[]) => clusterLines([...ink]).map((l) => [...l.strokeIds].sort());

  it("one row of two equations with nothing above or below it stays one line (nothing shows it is two)", () => {
    const row = [...writeAt("2x + 3 = 11", 100, 100), ...writeAt("4x - 5 = 3", 100 + widthOf("2x + 3 = 11") + 30, 100)];
    expect(linesOf(row)).toEqual([sortedIds(row)]);
  });

  it("a line spaced out round its `=`, the `=` aligned down the page, stays whole: one side is no equation", () => {
    const sides = ["2x + 3", "2x + 1", "4x - 1"];
    const eqX = 100 + Math.max(...sides.map(widthOf)) + 25;
    const rows = sides.map((lhs, i) => [...writeAt(lhs, 100, 100 + 50 * i), ...writeAt("=", eqX, 100 + 50 * i), ...writeAt(String(11 - 2 * i), eqX + widthOf("=") + 25, 100 + 50 * i)]);
    expect(linesOf(rows.flat()).sort()).toEqual(rows.map(sortedIds).sort());
  });

  it("`x = 2   x = 3` under `(x - 2)(x - 3) = 0` stays one line: the line above crosses the gap", () => {
    const factored = writeAt("(x - 2)(x - 3) = 0", 100, 100);
    const answers = [...writeAt("x = 2", 100, 150), ...writeAt("x = 3", 100 + widthOf("x = 2") + 25, 150)];
    expect(linesOf([...factored, ...answers])).toContainEqual(sortedIds(answers));
  });

  it("a system written on one row, worked under its left half, stays one line", () => {
    const system = [...writeAt("x + y = 10", 100, 100), ...writeAt("x - y = 2", 100 + widthOf("x + y = 10") + 25, 100)];
    const work = [...writeAt("2x = 12", 100, 150), ...writeAt("x = 6", 100, 200), ...writeAt("y = 4", 100 + widthOf("x + y = 10") + 25, 200)];
    expect(linesOf([...system, ...work])).toContainEqual(sortedIds(system));
  });

  it("is cut where the next column starts, not at a wider gap round the `=` of a first line longer than the lines under it", () => {
    // `2x + 3 =   11`: the gap before `11` is wider than the one between the problems, and clear
    // all the way down (the lines under it are shorter), with an `=` on both sides of it
    const lhs = writeAt("2x + 3 =", 100, 100);
    const rhs = writeAt("11", 100 + widthOf("2x + 3 =") + 28, 100);
    const a = [[...lhs, ...rhs], writeAt("2x = 8", 100, 150), writeAt("x = 4", 100, 200)];
    const first = unionRects(a[0].map((s) => s.bounds));
    const b = worked(["4x - 5 = 3", "4x = 8", "x = 2"], first.x + first.w + 20, 100);
    expect(placed(clusterLines([...a, ...b].flat()), [...a, ...b]).map((p) => p?.[0] ?? null)).toEqual([0, 0, 0, 1, 1, 1]);
  });

  it("three problems side by side: each row is cut twice", () => {
    const at = (k: number) => 100 + k * (widthOf("2x + 3 = 11") + 30);
    const cols = [
      worked(["2x + 3 = 11", "2x = 8", "x = 4"], at(0), 100),
      worked(["4x - 5 = 3", "4x = 8", "x = 2"], at(1), 100),
      worked(["3x + 1 = 7", "3x = 6", "x = 2"], at(2), 100),
    ];
    const lines = clusterLines(cols.flat(2));
    expect(placed(lines, cols.flat()).map((p) => p?.[0])).toEqual([0, 0, 0, 1, 1, 1, 2, 2, 2]);
  });
});

describe("a young hand: its dots and the bars of its `=` do not set the size of its glyphs", () => {
  // `= 7`, `= 9`, `= 11`, `= 9` beside four sums, a tap of the pen and a row of taps: digits ~100 page
  // px tall (an iPad), the bars of each `=` 6–16 px tall and 40 px apart, the taps 9 px dots
  const answers = () => [youngLine("=7", 230, 80), youngLine("=9", 980, 80), youngLine("=11", 230, 460), youngLine("=9", 980, 480)];
  const taps = () => [...youngGlyphs.dot(1460, 748), ...[0, 8, 24, 33, 45].flatMap((dx) => youngGlyphs.dot(1472 + dx, 405))];
  const board = () => youngInk([...answers().flat(), ...taps()]);

  it("a dot is a tap of the pen — a pen-wide circle it hardly moved in — and no stroke of a glyph is one", () => {
    const [tap, two] = youngInk([...youngGlyphs.dot(100, 100), [{ x: 100, y: 100 }, { x: 103, y: 102 }]]);
    expect(tap.bounds).toMatchObject({ w: 9, h: 9 });
    expect(isDotStroke(tap)).toBe(true);
    expect(isDotStroke(two)).toBe(true);
    const [top, bottom, seven] = youngInk(youngLine("=7", 0, 0));
    for (const s of [top, bottom, seven]) expect(isDotStroke(s)).toBe(false);
    expect(isDotStroke({ id: "shape:z" as never, bounds: { x: 0, y: 0, w: 0, h: 0 }, segments: [[{ x: 0, y: 0 }]] })).toBe(true);
    // a `1` has no width, and is no dot
    expect(isDotStroke(toInkStrokes(writeLine("1", 0, 0, 40))[0])).toBe(false);
  });

  it("the glyph size is the digits', not the taps' or the bars' (it was 12 px on a board of 100 px digits)", () => {
    expect(medianStrokeHeight(board())).toBeGreaterThan(70);
    // the bars alone: there is nothing else to go by
    expect(medianStrokeHeight(youngInk(youngGlyphs.equals(0, 0)))).toBeLessThan(20);
  });

  it("each `= N` is one line, its bars together and its digits writing, not drawings", () => {
    const ink = board();
    const split = splitInk(ink, [], { zoom: 0.49 });
    expect(split.writing).toHaveLength(ink.length);
    const lines = clusterLines(split.writing, [], [], { zoom: 0.49 });
    let at = 0;
    for (const n of answers().map((a) => a.length)) {
      const ids = ink.slice(at, at + n).map((s) => s.id);
      at += n;
      expect(lines.filter((l) => l.strokeIds.some((id) => ids.includes(id))).map((l) => l.strokeIds.length)).toEqual([n]);
    }
  });

  it("the two bars of an `=` are one sign however far apart, even with nothing else on the screen to size the hand by", () => {
    // the first thing written beside the problem: a wobbly `=`, its bars 40 or 48 px apart
    for (const gap of [40, 48]) {
      const ink = youngInk(youngGlyphs.equals(230, 110, { gap, bowTop: 8, bowBottom: -6 }));
      expect(clusterLines(ink), `gap ${gap}`).toHaveLength(1);
      expect(isEqualsPair(ink[0].bounds, ink[1].bounds, ink.map((s) => s.bounds))).toBe(true);
    }
    // ...with a tap of the pen before it, as she wrote it
    const tapped = youngInk([...youngGlyphs.dot(222, 114), ...youngGlyphs.equals(230, 110)]);
    expect(clusterLines(tapped).map((l) => l.strokeIds.length)).toEqual([3]);
  });

  it("…but not two bars a row apart, bars of very different lengths, or bars with writing between them", () => {
    const bar = (x: number, y: number, w: number): Rect => ({ x, y, w, h: 3 });
    // a minus on each of two rows (`x - 3`, then `x - 5` under it): a row apart, further than they are long
    expect(isEqualsPair(bar(100, 100, 18), bar(100, 150, 18), [])).toBe(false);
    // a stacked sum's rule under a `-`: lengths 4x apart
    expect(isEqualsPair(bar(100, 100, 30), bar(90, 130, 120), [])).toBe(false);
    // two fraction bars with a number between them
    const two: Rect = { x: 120, y: 112, w: 20, h: 30 };
    expect(isEqualsPair(bar(100, 100, 60), bar(100, 150, 60), [two])).toBe(false);
    // side by side, not one over the other
    expect(isEqualsPair(bar(100, 100, 40), bar(160, 120, 40), [])).toBe(false);
    // an adult's `=` is a pair too (it was joined anyway)
    expect(isEqualsPair(bar(100, 100, 20), bar(100, 108, 20), [])).toBe(true);
    // rows of `x - 3 = 5` written under each other stay rows
    expect(clusterLines(toInkStrokes([...writeLine("x=4", 100, 100, 40), ...writeLine("x=4", 100, 160, 40)]))).toHaveLength(2);
  });

  it("…written one stroke at a time: the answer joins the `=` before it", () => {
    const ink = board();
    // the first `=` on the screen, after the taps, then its 7
    const taps = ink.slice(-6);
    const lines = clusterLines([...taps, ...ink.slice(0, 3)]);
    expect(lines.find((l) => l.strokeIds.includes(ink[0].id))?.strokeIds).toHaveLength(3);
  });
});
