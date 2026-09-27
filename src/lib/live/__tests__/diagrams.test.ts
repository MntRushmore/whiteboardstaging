import { describe, expect, it } from "vitest";
import { boundsOf, DRAWINGS, labelAt, Pen, writeAt, type Drawing } from "@/__eval__/drawings";
import { VARIANTS } from "@/__eval__/handwriting";
import type { InkStroke } from "../contracts";
import { diagramNear, glyphScale, hasRelation, labelPayload, labelStack, parseLabelRead, splitInk, DIAGRAM_RULES } from "../diagrams";
import { clusterLines } from "../strokeClusters";

/**
 * The drawing / writing split (`splitInk`), as a table: writing that looks like drawing must stay
 * writing (in every hand the scoreboard uses), every generated drawing must be taken out whole with
 * its labels, and a line of maths beside a drawing must come out as exactly its own strokes. The
 * scoreboard (src/__eval__/drawings.test.ts) runs the same checks over the whole corpus and every
 * placement; this file pins the cases one by one.
 */

const roleOf = (split: ReturnType<typeof splitInk>, s: InkStroke) => split.roles.get(s.id)?.role;

/** Two level bars 8 px apart, `w` long, at (x, y): an `=` sign written long. */
function longEquals(pen: Pen, x: number, y: number, w: number): InkStroke[] {
  return [pen.stroke({ x, y }, { x: x + w, y: y + 1 }), pen.stroke({ x, y: y + 9 }, { x: x + w, y: y + 10 })];
}

describe("splitInk: writing that looks like a drawing stays writing", () => {
  const WRITING: Array<[string, string]> = [
    ["a long fraction bar", "\\frac{x^{2} - 9}{x^{2} + 6x + 9}"],
    ["a fraction bar with a short numerator", "\\frac{1}{x^{2} + 6x + 9} = 2"],
    ["nested fractions", "\\frac{\\frac{1}{x} + 1}{x - 1}"],
    ["a square root's overbar", "\\sqrt{b^{2} - 4ac}"],
    ["the quadratic formula", "x = \\frac{-b \\pm \\sqrt{b^{2} - 4ac}}{2a}"],
    ["a radical over a fraction", "\\sqrt{\\frac{x + 1}{x - 1}}"],
    ["long division", "3 \\overline{)126}"],
    ["a definite integral", "\\int_{0}^{2} 3x^{2} \\, dx"],
    ["an integral of a fraction", "\\int \\frac{2x}{x^{2} + 1} \\, dx"],
    ["big brackets", "\\left( \\frac{x + 1}{2} \\right)^{2}"],
    ["absolute value bars round a fraction", "\\left| \\frac{x}{2} - 1 \\right| = 3"],
    ["an evaluation bracket", "\\left[ x^{3} \\right]_{0}^{2}"],
    ["a matrix", "\\begin{bmatrix} 1 & 2 \\\\ 3 & 4 \\end{bmatrix}"],
    ["a system in a brace", "\\begin{cases} x + y = 3 \\\\ x - y = 1 \\end{cases}"],
    ["a limit with its arrow", "\\lim_{x \\to 2} \\frac{x^{2} - 4}{x - 2}"],
    ["a sum", "\\sum_{i=1}^{10} i^{2}"],
    ["an overline", "\\overline{AB} = 5"],
    // subscripts above and below the end of the bar, leaning back along it in a steep hand: not an arrowhead
    ["the slope formula", "m = \\frac{y_{2} - y_{1}}{x_{2} - x_{1}}"],
  ];

  describe.each(VARIANTS.map((v) => [v.name, v] as const))("in the %s hand", (_name, variant) => {
    it.each(WRITING)("%s: %s", (_what, latex) => {
      const ink = writeAt(latex, 200, 300, variant);
      const split = splitInk(ink);
      expect(ink.filter((s) => roleOf(split, s) !== "writing").map((s) => split.roles.get(s.id))).toEqual([]);
      expect(split.diagrams).toEqual([]);
    });
  });

  it("a long `=` between two sides of a line", () => {
    const pen = new Pen("eq", 3);
    const ink = [...writeAt("2x + 3", 100, 300), ...longEquals(pen, 200, 312, 90), ...writeAt("11", 310, 300)];
    const split = splitInk(ink);
    expect(split.writing).toHaveLength(ink.length);
  });

  it("a box drawn round the answer, and an answer circled", () => {
    const pen = new Pen("box", 5);
    const answer = writeAt("x = 4", 100, 300);
    const r = boundsOf(answer);
    const box = pen.stroke({ x: r.x - 10, y: r.y - 10 }, { x: r.x + r.w + 10, y: r.y - 10 }, { x: r.x + r.w + 10, y: r.y + r.h + 10 }, { x: r.x - 10, y: r.y + r.h + 10 }, { x: r.x - 9, y: r.y - 8 });
    const ring = pen.arc(r.x + r.w / 2, r.y + r.h / 2, r.w / 2 + 14, r.h / 2 + 12);
    for (const mark of [box, ring]) {
      const split = splitInk([...answer, mark]);
      expect(split.writing).toHaveLength(answer.length + 1);
    }
  });

  it("an underlined answer", () => {
    const pen = new Pen("ul", 6);
    const answer = writeAt("x = 12", 100, 300);
    const r = boundsOf(answer);
    const split = splitInk([...answer, pen.stroke({ x: r.x - 4, y: r.y + r.h + 6 }, { x: r.x + r.w + 6, y: r.y + r.h + 7 })]);
    expect(split.diagrams).toEqual([]);
  });
});

describe("splitInk: every generated drawing, alone", () => {
  it.each(Object.entries(DRAWINGS))("%s", (_name, make) => {
    const d: Drawing = make(300, 250, 7);
    const ink = [...d.strokes, ...d.labels.flat()];
    const split = splitInk(ink);
    expect(split.diagrams).toHaveLength(1);
    const [diagram] = split.diagrams;
    // the drawing's strokes are the drawing (or marks on it); nothing is left to be read as writing
    expect(d.strokes.map((s) => roleOf(split, s)).every((r) => r === "drawing" || r === "mark")).toBe(true);
    expect(split.writing).toEqual([]);
    // each label is attached, whole, as one label
    expect(diagram.labels.map((l) => [...l].sort())).toEqual(expect.arrayContaining(d.labels.map((l) => l.map((s) => s.id).sort())));
    expect(diagram.labels).toHaveLength(d.labels.length);
    expect(diagram.kinds).toEqual(expect.arrayContaining(d.kinds));
    expect(diagram.id).toMatch(/^dg_[0-9a-f]{8}$/);
  });

  it("the table of what each drawing is read as", () => {
    const kinds = Object.fromEntries(Object.entries(DRAWINGS).map(([name, make]) => {
      const d = make(300, 250, 9);
      return [name, splitInk([...d.strokes, ...d.labels.flat()]).diagrams.flatMap((x) => x.kinds).sort()];
    }));
    expect(kinds).toEqual({
      triangle: ["triangle"],
      triangleOneStroke: ["triangle"],
      rightTriangle: ["triangle"],
      circle: ["circle"],
      numberLine: ["arrow", "numberLine"],
      axesAndLine: ["axes"],
      arrow: ["arrow"],
      rectangle: ["quadrilateral"],
    });
  });

  it("the first side of a triangle, drawn before the others, is already a drawing", () => {
    const math = writeAt("a^{2} + b^{2} = c^{2}", 100, 300);
    const side = DRAWINGS.rightTriangle(500, 250, 3).strokes[0];
    const split = splitInk([...math, side]);
    expect(roleOf(split, side)).toBe("drawing");
    expect(split.writing).toHaveLength(math.length);
    // ...while a bar drawn before its fraction is writing again once the fraction is there
    const pen = new Pen("bar", 2);
    const bar = pen.stroke({ x: 300, y: 600 }, { x: 420, y: 601 });
    expect(roleOf(splitInk([...math, bar]), bar)).toBe("drawing");
    const fraction = [...writeAt("x + 1", 320, 570), ...writeAt("x - 1", 322, 612)];
    expect(roleOf(splitInk([...math, bar, ...fraction]), bar)).toBe("writing");
  });

  it("measures a screen with nothing but a drawing against the glyph cap", () => {
    const d = DRAWINGS.triangle(300, 250, 3);
    expect(glyphScale(d.strokes)).toBe(DIAGRAM_RULES.glyphMax);
    expect(splitInk(d.strokes).diagrams).toHaveLength(1);
  });
});

describe("splitInk: a drawing beside a line of maths", () => {
  /** the line at (600, 420); the drawing `gap` px to its right (or below), centred on it */
  function scene(name: keyof typeof DRAWINGS, latex: string, where: "right" | "below" | "left", gap = 24) {
    const math = writeAt(latex, 600, 420);
    const line = boundsOf(math);
    const raw = DRAWINGS[name](0, 0, 11);
    const rb = boundsOf([...raw.strokes, ...raw.labels.flat()]);
    const at =
      where === "right"
        ? { x: line.x + line.w + gap, y: line.y + line.h / 2 - rb.h / 2 }
        : where === "left"
          ? { x: line.x - rb.w - gap, y: line.y + line.h / 2 - rb.h / 2 }
          : { x: line.x, y: line.y + line.h + gap };
    const d = DRAWINGS[name](at.x - rb.x, at.y - rb.y, 11);
    return { math, drawing: d, ink: [...math, ...d.strokes, ...d.labels.flat()] };
  }

  it.each([
    ["triangle", "a^{2} + b^{2} = c^{2}", "right"],
    ["rightTriangle", "3^{2} + 4^{2} = x^{2}", "left"],
    ["triangleOneStroke", "x + 40 + 65 = 180", "below"],
    ["circle", "A = \\pi r^{2}", "right"],
    ["numberLine", "2x + 3 > 11", "right"],
    ["numberLine", "x > 2", "below"],
    ["axesAndLine", "y = 2x + 1", "left"],
    ["arrow", "\\frac{x}{2} + 3 = 7", "left"],
    ["rectangle", "A = 7 \\times 3", "right"],
  ] as const)("%s beside `%s` (%s): the line is exactly its strokes, the drawing is out", (name, latex, where) => {
    const { math, drawing, ink } = scene(name, latex, where);
    const before = clusterLines(ink);
    const split = splitInk(ink);
    const lines = clusterLines(split.writing);
    const mathIds = new Set<string>(math.map((s) => s.id));
    const mathLines = lines.filter((l) => l.strokeIds.some((id) => mathIds.has(id)));
    expect(mathLines).toHaveLength(1);
    expect([...mathLines[0].strokeIds].sort()).toEqual([...mathIds].sort());
    // nothing of the drawing, its marks or its labels is left to be recognized
    expect(lines).toHaveLength(1);
    expect(split.diagrams).toHaveLength(1);
    expect(split.diagrams[0].labels).toHaveLength(drawing.labels.length);
    // (before: the drawing was clustered into the line or read as lines of its own)
    expect(before.length > 1 || before[0].strokeIds.length > math.length).toBe(true);
  });

  it("`x = ?` right beside a triangle is a question, not a label", () => {
    const { math, ink } = scene("triangle", "x = ?", "right", 10);
    const split = splitInk(ink);
    expect(math.every((s) => roleOf(split, s) === "writing")).toBe(true);
  });

  it("a lone number beside a drawing is one of its labels", () => {
    const d = DRAWINGS.triangle(300, 250, 5);
    const extra = labelAt("12", 560, 420);
    const split = splitInk([...d.strokes, ...d.labels.flat(), ...extra]);
    expect(extra.every((s) => roleOf(split, s) === "label")).toBe(true);
  });

  it("maths far from the drawing is not touched by it", () => {
    const { math, ink } = scene("circle", "2x + 3 = 11", "right", 400);
    const split = splitInk(ink);
    expect(math.every((s) => roleOf(split, s) === "writing")).toBe(true);
    expect(split.diagrams[0].labels).toHaveLength(2);
  });

  it("keeps a drawing's id while it is drawn on, and gives a new drawing a new one", () => {
    const d = DRAWINGS.triangle(300, 250, 5);
    const first = splitInk(d.strokes);
    const second = splitInk([...d.strokes, ...d.labels.flat()], first.diagrams);
    expect(second.diagrams[0].id).toBe(first.diagrams[0].id);
    const other = DRAWINGS.circle(900, 250, 5);
    const third = splitInk([...d.strokes, ...other.strokes], second.diagrams);
    expect(third.diagrams.map((x) => x.id)).toContain(first.diagrams[0].id);
    expect(new Set(third.diagrams.map((x) => x.id)).size).toBe(2);
  });

  it("finds the drawing nearest a box", () => {
    const d = DRAWINGS.triangle(300, 250, 5);
    const split = splitInk([...d.strokes, ...d.labels.flat()]);
    const b = split.diagrams[0].bounds;
    expect(diagramNear(split.diagrams, { x: b.x + b.w + 30, y: b.y, w: 40, h: 30 }, 60)?.id).toBe(split.diagrams[0].id);
    expect(diagramNear(split.diagrams, { x: b.x + b.w + 300, y: b.y, w: 40, h: 30 }, 60)).toBeNull();
  });
});

describe("relations, and reading the labels", () => {
  it("finds an `=`, a `<` and a `>`, and nothing in a label", () => {
    const G = 12;
    expect(hasRelation(writeAt("x = 5", 0, 0), G)).toBe(true);
    expect(hasRelation(writeAt("x < 5", 0, 0), G)).toBe(true);
    expect(hasRelation(writeAt("2x + 3 > 11", 0, 0), G)).toBe(true);
    for (const label of ["40^{\\circ}", "x", "12", "(2, 3)", "AB", "x + 2"]) expect(hasRelation(writeAt(label, 0, 0), G)).toBe(false);
  });

  it("stacks the labels one per row, in reading order, for one recognizer call", () => {
    const d = DRAWINGS.triangle(300, 250, 5);
    const ink = [...d.strokes, ...d.labels.flat()];
    const split = splitInk(ink);
    const [diagram] = split.diagrams;
    const stack = labelStack(diagram, ink, split.glyph)!;
    expect(stack.line.id).toBe(diagram.id);
    expect(stack.strokes).toHaveLength(d.labels.flat().length);
    // rows do not overlap, and each starts at the left edge
    const rows = diagram.labels.map((ids) => boundsOf(stack.strokes.filter((s) => ids.includes(s.id))));
    for (let k = 1; k < rows.length; k++) expect(rows[k].y).toBeGreaterThan(rows[k - 1].y + rows[k - 1].h);
    for (const r of rows) expect(r.x).toBeCloseTo(0, 5);
    // reading order: the apex label A first
    expect(diagram.labels[0].sort()).toEqual(d.labels[0].map((s) => s.id).sort());
    const payload = labelPayload(diagram, ink, split.glyph)!;
    expect(payload.x.length).toBeGreaterThan(0);
    expect(labelPayload({ ...diagram, labels: [] }, ink, split.glyph)).toBeNull();
  });

  it.each([
    ["\\begin{array}{l}\nA \\\\\nB \\\\\n3\n\\end{array}", ["A", "B", "3"]],
    ["\\begin{array}{c}\n-2 \\\\\n-1 \\\\\n0\n\\end{array}", ["-2", "-1", "0"]],
    ["A\nB\nc", ["A", "B", "c"]],
    ["40^{\\circ}", ["40^{\\circ}"]],
    // what Mathpix really sent back for the generated triangles' stacks
    ["\\begin{array}{l}\n\\text { A } \\\\\n5 \\\\\nB \\\\\nC \\\\\n7\n\\end{array}", ["A", "5", "B", "C", "7"]],
    ["\\begin{array}{l}\n40^{\\circ} \\\\\n\\times \\\\\n65^{\\circ}\n\\end{array}", ["40^{\\circ}", "x", "65^{\\circ}"]],
    ["\\begin{array}{l}\ny \\\\\n(2,3) \\\\\nx\n\\end{array}", ["y", "(2,3)", "x"]],
    // what Mathpix sent back on the board for two-label stacks (the figure browser check)
    ["\\underbrace{2 x+10}_{70^{\\circ}}", ["2 x+10", "70^{\\circ}"]],
    ["70^{\\circ} \\) x", ["70^{\\circ}", "x"]],
    ["\\overbrace{x}^{65^{\\circ}}", ["65^{\\circ}", "x"]],
    ["\\underset{40^{\\circ}}{x}", ["x", "40^{\\circ}"]],
    ["\\stackrel{130^{\\circ}}{x}", ["130^{\\circ}", "x"]],
    ["", []],
  ])("reads the stack %j as %j", (latex, rows) => {
    expect(parseLabelRead(latex)).toEqual(rows);
  });
});
