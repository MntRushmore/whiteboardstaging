import { describe, expect, it } from "vitest";
import { boundsOf, DRAWINGS, labelAt, Pen, writeAt, type Drawing } from "@/__eval__/drawings";
import { VARIANTS } from "@/__eval__/handwriting";
import type { InkStroke } from "../contracts";
import { barGroups, diagramNear, glyphScale, hasRelation, labelPayload, labelStack, parseLabelRead, splitInk, DIAGRAM_RULES } from "../diagrams";
import { clusterLines, inkScale } from "../strokeClusters";
import { DEVICE_ZOOMS, inkAtZoom } from "../__fixtures__/strokes";

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

describe("splitInk at the board's zoom: handwriting is as big as it looks on the student's screen", () => {
  it("scales the cap of the glyph scale, and nothing on a desktop", () => {
    expect([undefined, 1, 1.4].map(inkScale)).toEqual([1, 1, 1]);
    expect(inkScale(0.5)).toBe(2);
    expect(inkScale(0.2)).toBe(5);
    expect(inkScale(0.05)).toBe(6);
    const tri = DRAWINGS.triangle(300, 250, 3).strokes;
    expect(glyphScale(tri, 1)).toBe(DIAGRAM_RULES.glyphMax);
    expect(glyphScale(inkAtZoom(tri, 0.2), 0.2)).toBe(5 * DIAGRAM_RULES.glyphMax);
  });

  it("the owner's board: `2x2` written 50 px tall on a phone is one line of maths, not two drawings and a label", () => {
    // 250 page px tall: the board on a phone held upright is shown at ~0.2
    const ink = writeAt("2x2", 100, 100, VARIANTS[0], 250 / boundsOf(writeAt("2x2", 0, 0)).h);
    const split = splitInk(ink, [], { zoom: 0.2 });
    expect(split.diagrams).toEqual([]);
    expect(split.writing).toHaveLength(ink.length);
    expect(clusterLines(split.writing, [], [], { zoom: 0.2 })).toHaveLength(1);
    // (judged in desktop page px, none of it was writing: both 2s "big curves", and the x two "long
    // diagonals". Now three glyph columns in a row are a row of writing, its own scale on any screen)
    expect(splitInk(ink).writing).toHaveLength(ink.length);
  });

  describe.each(DEVICE_ZOOMS)("on %s", (_device, zoom) => {
    it.each(["2x2", "2x + 3 = 11", "x = \\frac{-b \\pm \\sqrt{b^{2} - 4ac}}{2a}"])("`%s` is writing, one line", (latex) => {
      const ink = inkAtZoom(writeAt(latex, 200, 300), zoom);
      const split = splitInk(ink, [], { zoom });
      expect(split.diagrams).toEqual([]);
      expect(split.writing).toHaveLength(ink.length);
      const lines = clusterLines(split.writing, [], [], { zoom });
      expect(lines.map((l) => l.strokeIds.length)).toEqual([ink.length]);
    });

    it("writing that looks like a drawing stays writing", () => {
      for (const latex of ["\\frac{x^{2} - 9}{x^{2} + 6x + 9}", "\\sqrt{\\frac{x + 1}{x - 1}}", "3 \\overline{)126}", "\\int_{0}^{2} 3x^{2} \\, dx", "\\left| \\frac{x}{2} - 1 \\right| = 3"]) {
        const ink = inkAtZoom(writeAt(latex, 200, 300), zoom);
        expect(splitInk(ink, [], { zoom }).diagrams, latex).toEqual([]);
      }
    });

    it.each(["triangle", "axesAndLine", "numberLine", "circle"] as const)("a %s with its labels is still a drawing, its labels attached", (name) => {
      const d = DRAWINGS[name](300, 250, 7);
      const ink = inkAtZoom([...d.strokes, ...d.labels.flat()], zoom);
      const split = splitInk(ink, [], { zoom });
      expect(split.writing).toEqual([]);
      expect(split.diagrams).toHaveLength(1);
      expect(split.diagrams[0].kinds).toEqual(expect.arrayContaining(d.kinds));
      expect(split.diagrams[0].labels).toHaveLength(d.labels.length);
    });

    it("a triangle with nothing else on the screen is a drawing (measured against the cap)", () => {
      const split = splitInk(inkAtZoom(DRAWINGS.triangle(300, 250, 3).strokes, zoom), [], { zoom });
      expect(split.writing).toEqual([]);
      expect(split.diagrams.map((x) => x.kinds)).toEqual([["triangle"]]);
    });

    it("a graph sketched beside `y = 2x + 1`: the line is exactly its strokes, the axes a drawing", () => {
      const math = writeAt("y = 2x + 1", 600, 420);
      const line = boundsOf(math);
      const raw = DRAWINGS.axesAndLine(0, 0, 11);
      const rb = boundsOf([...raw.strokes, ...raw.labels.flat()]);
      const d = DRAWINGS.axesAndLine(line.x - rb.w - 24 - rb.x, line.y + line.h / 2 - rb.h / 2 - rb.y, 11);
      const ink = inkAtZoom([...math, ...d.strokes, ...d.labels.flat()], zoom);
      const split = splitInk(ink, [], { zoom });
      expect(split.diagrams.map((x) => x.kinds)).toEqual([["axes"]]);
      const lines = clusterLines(split.writing, [], [], { zoom });
      expect(lines.map((l) => [...l.strokeIds].sort())).toEqual([math.map((s) => s.id as string).sort()]);
    });
  });
});

describe("splitInk: big handwriting on a desktop is writing (a row of writing keeps its own scale)", () => {
  /**
   * The owner's board (a desktop, fit zoom ~1): `(x+y)^2 =` written big — the brackets ~220 px
   * tall, the x two crossing ~120 px diagonals, the y ~95 px. Measured against the 30 px cap, the
   * x was two "long diagonals" (a drawing), Solve sent the "figure" to the vision model, which said
   * nothing was asked, and the student got "Couldn't solve this one".
   */
  function ownersLine(): InkStroke[] {
    const pen = new Pen("owner", 5);
    const mid = 310;
    const two = writeAt("2", 560, 170, VARIANTS[0], 90 / boundsOf(writeAt("2", 0, 0)).h);
    return [
      pen.arc(150, mid, 40, 116, 0.6 * Math.PI, 1.4 * Math.PI),
      pen.stroke({ x: 160, y: mid - 50 }, { x: 280, y: mid + 70 }),
      pen.stroke({ x: 280, y: mid - 50 }, { x: 160, y: mid + 70 }),
      pen.stroke({ x: 305, y: mid + 10 }, { x: 385, y: mid + 11 }),
      pen.stroke({ x: 345, y: mid - 30 }, { x: 346, y: mid + 50 }),
      pen.stroke({ x: 410, y: mid - 35 }, { x: 445, y: mid + 25 }),
      pen.stroke({ x: 480, y: mid - 35 }, { x: 420, y: mid + 60 }),
      pen.arc(500, mid, 40, 116, -0.4 * Math.PI, 0.4 * Math.PI),
      ...two,
      ...longEquals(pen, 660, mid - 5, 90),
    ];
  }

  it("the owner's board: `(x+y)^2 =` with 220 px brackets is one line of maths, every stroke of it", () => {
    const ink = ownersLine();
    // the strokes the cap made a drawing of: the x's two diagonals are 120 px, over 3.5 x 30
    expect(Math.max(ink[1].bounds.w, ink[1].bounds.h)).toBeGreaterThan(DIAGRAM_RULES.bigFactor * DIAGRAM_RULES.glyphMax);
    const split = splitInk(ink, [], { zoom: 1 });
    expect(split.glyph).toBeGreaterThan(DIAGRAM_RULES.glyphMax);
    expect(split.diagrams).toEqual([]);
    expect(split.writing).toHaveLength(ink.length);
    expect(clusterLines(split.writing, [], [], { zoom: 1 }).map((l) => [...l.strokeIds].sort())).toEqual([ink.map((s) => s.id as string).sort()]);
  });

  describe.each(VARIANTS.map((v) => [v.name, v] as const))("in the %s hand, on a desktop", (name, variant) => {
    it.each(["(x+y)^{2} =", "2x + 3 = 7", "x^{2} = 9"].flatMap((latex) => [100, 150, 200, 250].map((px) => [latex, px] as const)))("`%s` written %i px tall is writing", (latex, px) => {
      const ink = writeAt(latex, 200, 200, variant, px / boundsOf(writeAt(latex, 0, 0, variant)).h);
      const split = splitInk(ink, [], { zoom: 1 });
      expect(split.diagrams).toEqual([]);
      expect(split.writing).toHaveLength(ink.length);
      // one line (the messy hand's wider gaps can split it in the clusterer, at any zoom: not a drawing matter)
      if (name !== "messy") expect(clusterLines(split.writing, [], [], { zoom: 1 })).toHaveLength(1);
    });
  });

  it.each([
    ["triangle", "a^{2} + b^{2} = c^{2}", "right"],
    ["rightTriangle", "3^{2} + 4^{2} = x^{2}", "left"],
    ["circle", "A = \\pi r^{2}", "right"],
    ["numberLine", "2x + 3 > 11", "right"],
    ["axesAndLine", "y = 2x + 1", "left"],
    ["arrow", "\\frac{x}{2} + 3 = 7", "left"],
    ["rectangle", "A = 7 \\times 3", "right"],
  ] as const)("a %s beside `%s`, both drawn big (x 4): the line is exactly its strokes, the drawing is out with its labels", (name, latex, where) => {
    const math = writeAt(latex, 600, 420);
    const line = boundsOf(math);
    const raw = DRAWINGS[name](0, 0, 11);
    const rb = boundsOf([...raw.strokes, ...raw.labels.flat()]);
    const at = where === "right" ? { x: line.x + line.w + 24, y: line.y + line.h / 2 - rb.h / 2 } : { x: line.x - rb.w - 24, y: line.y + line.h / 2 - rb.h / 2 };
    const d = DRAWINGS[name](at.x - rb.x, at.y - rb.y, 11);
    // a big hand draws big too: the scene four times its size, on a desktop
    const ink = inkAtZoom([...math, ...d.strokes, ...d.labels.flat()], 0.25);
    const split = splitInk(ink, [], { zoom: 1 });
    expect(split.glyph).toBeGreaterThan(DIAGRAM_RULES.glyphMax);
    expect(split.diagrams).toHaveLength(1);
    expect(split.diagrams[0].kinds).toEqual(expect.arrayContaining(d.kinds));
    expect(split.diagrams[0].labels).toHaveLength(d.labels.length);
    const lines = clusterLines(split.writing, [], [], { zoom: 1 });
    expect(lines.map((l) => [...l.strokeIds].sort())).toEqual([math.map((s) => s.id as string).sort()]);
  });

  it.each(Object.keys(DRAWINGS))("a %s alone on the screen, drawn up to five times as big, is still a drawing (measured against the cap)", (name) => {
    for (const k of [1, 2, 3, 5]) {
      const d = DRAWINGS[name](300, 250, 7);
      const split = splitInk(inkAtZoom(d.strokes, 1 / k), [], { zoom: 1 });
      expect(split.writing, `x ${k}`).toEqual([]);
      // (what it looks like is judged against the cap too: five times as big, a triangle's corners are
      // too far apart to pair up, as they always were)
      if (k <= 3) expect(split.diagrams.flatMap((x) => x.kinds), `x ${k}`).toEqual(expect.arrayContaining(d.kinds));
    }
  });

  it("a row of shapes is not a row of writing: three triangles, three circles", () => {
    const tris = [0, 1, 2].flatMap((k) => DRAWINGS.triangle(100 + k * 260, 200, k + 1).strokes);
    expect(splitInk(tris, [], { zoom: 1 }).diagrams.map((x) => x.kinds)).toEqual([["triangle"], ["triangle"], ["triangle"]]);
    const pen = new Pen("rings", 3);
    const rings = [200, 360, 520].map((x) => pen.arc(x, 300, 60, 60));
    expect(splitInk(rings, [], { zoom: 1 }).diagrams.map((x) => x.kinds)).toEqual([["circle"], ["circle"], ["circle"]]);
  });

  it("`a^2 + b^2 = c^2` written 200 px tall beside a triangle drawn in proportion: the line is writing, the triangle a drawing", () => {
    const math = writeAt("a^{2} + b^{2} = c^{2}", 100, 300, VARIANTS[0], 200 / boundsOf(writeAt("a^{2} + b^{2} = c^{2}", 0, 0)).h);
    const line = boundsOf(math);
    // as at an ordinary size (a 170 px triangle beside a 44 px hand): ~4 times the writing's height
    const tri = inkAtZoom(DRAWINGS.triangle(0, 0, 3).strokes, 0.22).map((s) => ({
      ...s,
      bounds: { ...s.bounds, x: s.bounds.x + line.x + line.w + 60 },
      segments: s.segments.map((seg) => seg.map((p) => ({ x: p.x + line.x + line.w + 60, y: p.y }))),
    }));
    const split = splitInk([...math, ...tri], [], { zoom: 1 });
    expect(split.writing.map((s) => s.id).sort()).toEqual(math.map((s) => s.id as string).sort());
    expect(split.diagrams.map((x) => x.kinds)).toEqual([["triangle"]]);
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

describe("splitInk: a bar under a whole equation is \"divide both sides\" (`divisionBars`)", () => {
  /** The tutor's `1. 2\sin x = 1` at hand size 48: its box only, as the loop passes it. */
  const head = boundsOf(writeAt("1. \\quad 2 \\sin x = 1", 600, 200, VARIANTS[0], 48 / 44));
  const barUnder = (pen: Pen, r: { x: number; y: number; w: number; h: number }, gap = 20) =>
    pen.stroke({ x: r.x + 16, y: r.y + r.h + gap }, { x: r.x + r.w + 48, y: r.y + r.h + gap + 1 });
  const centred = (latex: string, bar: InkStroke) => {
    const w = boundsOf(writeAt(latex, 0, 0)).w;
    return writeAt(latex, bar.bounds.x + bar.bounds.w / 2 - w / 2, bar.bounds.y + 10);
  };

  it("the owner's board: a bar under the tutor's 2\\sin x = 1 and a 2 under it", () => {
    const bar = barUnder(new Pen("own", 1), head);
    const two = centred("2", bar);
    const ink = [bar, ...two];
    // without the problem's box it is what it always was: a long line, and a label on it
    const before = splitInk(ink);
    expect(before.bars).toEqual([]);
    expect(roleOf(before, bar)).toBe("drawing");
    // with it, the bar and the 2 are one line of their own
    const split = splitInk(ink, [], { equations: [head] });
    expect(split.bars).toEqual([{ bar: bar.id, divisor: two.map((s) => s.id) }]);
    expect(split.diagrams).toEqual([]);
    expect(ink.map((s) => roleOf(split, s))).toEqual(ink.map(() => "operation"));
    const lines = clusterLines(split.writing, [], barGroups(split.bars, ink));
    expect(lines).toHaveLength(1);
    expect(lines[0].strokeIds).toEqual([bar.id, ...two.map((s) => s.id)]);
  });

  it("under the student's own 2x + 3 = 11: the equation stays one line, the bar and the 2 another", () => {
    const eq = writeAt("2x + 3 = 11", 200, 300);
    const r = boundsOf(eq);
    const bar = new Pen("own2", 2).stroke({ x: r.x - 6, y: r.y + r.h + 14 }, { x: r.x + r.w + 16, y: r.y + r.h + 15 });
    const two = centred("2", bar);
    const next = writeAt("x = 4", r.x + 10, boundsOf(two).y + boundsOf(two).h + 30);
    const ink = [...eq, bar, ...two, ...next];
    // before: a fraction bar, the whole equation over 2
    expect(clusterLines(ink).some((l) => l.strokeIds.includes(bar.id) && l.strokeIds.includes(eq[0].id))).toBe(true);
    const split = splitInk(ink);
    expect(split.bars).toEqual([{ bar: bar.id, divisor: two.map((s) => s.id) }]);
    const lines = clusterLines(split.writing, [], barGroups(split.bars, ink));
    const ids = (strokes: InkStroke[]) => strokes.map((s) => s.id as string).sort();
    expect(lines.map((l) => [...l.strokeIds].sort())).toEqual(expect.arrayContaining([ids(eq), ids([bar, ...two]), ids(next)]));
    expect(lines).toHaveLength(3);
    // top to bottom in one column: the equation, the operation, the next line
    expect([...lines].sort((a, b) => a.row - b.row).map((l) => l.strokeIds.length)).toEqual([eq.length, 1 + two.length, next.length]);
    expect(new Set(lines.map((l) => l.column)).size).toBe(1);
  });

  it("-3 and \\frac{1}{2} under the bar are divisors too", () => {
    for (const d of ["-3", "\\frac{1}{2}"]) {
      const bar = barUnder(new Pen(`d${d.length}`, 3), head);
      const divisor = centred(d, bar);
      const split = splitInk([bar, ...divisor], [], { equations: [head] });
      expect(split.bars.map((b) => [...b.divisor].sort())).toEqual([divisor.map((s) => s.id as string).sort()]);
    }
  });

  it.each([
    ["an underline under the tutor's problem, nothing under it", (bar: InkStroke) => [bar]],
    ["a line of maths right under the rule", (bar: InkStroke) => [bar, ...writeAt("2x = 12", bar.bounds.x, bar.bounds.y + 12)]],
    [
      "a 2 under each end: not one divisor",
      (bar: InkStroke) => [bar, ...writeAt("2", bar.bounds.x + 10, bar.bounds.y + 10), ...writeAt("2", bar.bounds.x + bar.bounds.w - 30, bar.bounds.y + 10)],
    ],
  ])("%s is not a division bar", (_what, make) => {
    const bar = barUnder(new Pen("no", 4), head);
    const split = splitInk(make(bar), [], { equations: [head] });
    expect(split.bars).toEqual([]);
  });

  it("a fraction inside a line of the student's is not one, whatever its numerator", () => {
    for (const latex of ["y = \\frac{k}{x}", "f(x) = \\frac{x^{2} - 4}{x - 2}", "x = \\frac{-b \\pm \\sqrt{b^{2} - 4ac}}{2a}", "\\frac{x^{3} - 2x^{2} + 4}{x - 3}"]) {
      for (const variant of VARIANTS) expect(splitInk(writeAt(latex, 200, 300, variant)).bars, `${latex} (${variant.name})`).toEqual([]);
    }
  });

  it("a bar under an equation with ticks through it is a number line, not a division bar", () => {
    const pen = new Pen("nl", 5);
    const bar = barUnder(pen, head);
    const ticks = [0.2, 0.4, 0.6, 0.8].map((t) => {
      const x = bar.bounds.x + t * bar.bounds.w;
      return pen.stroke({ x, y: bar.bounds.y - 9 }, { x: x + 1, y: bar.bounds.y + 9 });
    });
    const two = centred("2", bar);
    const split = splitInk([bar, ...ticks, ...two], [], { equations: [head] });
    expect(split.bars).toEqual([]);
    expect(split.diagrams.flatMap((d) => d.kinds)).toContain("numberLine");
  });
});
