import { describe, expect, it } from "vitest";
import type { Rect } from "../../../contracts";
import type { HandPlan } from "../../../handwriting";
import type { VisualModel, VisualModelKind } from "../../contracts";
import { legibleBoxes } from "../../place";
import { MODEL_BOXES, planModel, sketchModel, type ModelSketch } from "..";
import { handAngles } from "../clock";
import { autoStep, equationHolds, evaluate, labelNumber, placeParts, stepDenominator } from "../maths";
import { GALLERY } from "./gallery";

/**
 * The planners' geometry and arithmetic, kind by kind, and the rules every model keeps: its ink
 * inside its box, no two labels touching, no line through a label, nothing at all when the box is
 * too small to draw it legibly.
 */

const sketch = (model: VisualModel, box = MODEL_BOXES[model.kind][0]): ModelSketch => {
  const s = sketchModel(model, box, 7);
  if (!s) throw new Error(`${model.kind} not drawn in ${box.w}×${box.h}`);
  return s;
};
const texts = (s: ModelSketch) => s.texts.map((t) => t.text);
const linesOf = (plan: HandPlan, prefix: string) => plan.lines.filter((l) => l.part === prefix || l.part?.startsWith(`${prefix}~`));
const partsLike = (plan: HandPlan, re: RegExp) => plan.lines.filter((l) => re.test(l.part ?? ""));
/** every point of a plan line, in plan px */
const points = (l: HandPlan["lines"][number]) => l.strokes.flatMap((s) => s.points.map((p) => ({ x: p.x + l.x, y: p.y + l.y })));
const shrink = (r: Rect, by: number): Rect => ({ x: r.x + by, y: r.y + by, w: r.w - 2 * by, h: r.h - 2 * by });
const inRect = (p: { x: number; y: number }, r: Rect) => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

describe("every model: in its box, labels apart, no line through a label", () => {
  for (const g of GALLERY) {
    it(g.title, () => {
      const boxes = MODEL_BOXES[g.model.kind];
      for (const box of g.big ? [boxes[0]] : [boxes[0], boxes[boxes.length - 1]]) {
        const s = sketch(g.model, box);
        const b = s.plan.bounds;
        expect(b.x).toBe(0);
        expect(b.y).toBe(0);
        expect(b.w).toBeLessThanOrEqual(box.w + 0.5);
        expect(b.h).toBeLessThanOrEqual(box.h + 0.5);
        for (const l of s.plan.lines) for (const p of points(l)) expect(inRect(p, { x: -0.5, y: -0.5, w: b.w + 1, h: b.h + 1 }), `${g.title}: ${l.part}`).toBe(true);
        // the writing: inside, apart, and clear of every line that is not writing
        const labelParts = new Set(s.texts.map((t) => t.part));
        for (const t of s.texts) {
          expect(t.rect.x).toBeGreaterThanOrEqual(-0.5);
          expect(t.rect.x + t.rect.w).toBeLessThanOrEqual(b.w + 0.5);
          for (const u of s.texts) if (u !== t) expect(overlap(t.rect, u.rect), `${g.title}: "${t.text}" and "${u.text}"`).toBe(false);
          for (const l of s.plan.lines) {
            if (labelParts.has(l.part ?? "")) continue;
            expect(points(l).some((p) => inRect(p, shrink(t.rect, 1.5))), `${g.title}: ${l.part} through "${t.text}"`).toBe(false);
          }
        }
        // every line a named part, at a pace a hand keeps
        expect(s.plan.lines.every((l) => Boolean(l.part))).toBe(true);
        expect(s.plan.totalMs / (s.plan.pace ?? 1)).toBeLessThanOrEqual(7500);
      }
    });
  }

  it("nothing at all in a box too small to draw it legibly", () => {
    for (const g of GALLERY) expect(planModel(g.model, { w: 120, h: 80 }, 7), g.title).toBeNull();
  });

  it("each kind's boxes go from its largest down to its legible minimum, every one planned by placeDrawing", () => {
    for (const [kind, boxes] of Object.entries(MODEL_BOXES) as Array<[VisualModelKind, readonly { w: number; h: number }[]]>) {
      expect(legibleBoxes(boxes), kind).toEqual(boxes);
      for (let i = 1; i < boxes.length; i++) expect(boxes[i].w * boxes[i].h, kind).toBeLessThan(boxes[i - 1].w * boxes[i - 1].h);
    }
  });

  it("the same spec and seed draw the same model", () => {
    const m: VisualModel = { kind: "area_model", a: 23, b: 14 };
    expect(sketch(m).plan).toEqual(sketch(m).plan);
  });
});

describe("number line", () => {
  it("ticks every step, a jump's arc from where it starts to where it lands, its size worked out", () => {
    const s = sketch({ kind: "number_line", from: 0, to: 10, marks: [], jumps: [{ from: 3, to: 7 }] });
    expect(texts(s)).toEqual(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "+4"]);
    const ticks = linesOf(s.plan, "ticks")[0];
    expect(ticks.strokes.length).toBe(11);
    // the arc starts over 3 and lands over 7: the numbers' centres
    const at = (t: string) => s.texts.find((x) => x.text === t)!.rect;
    const arc = points(linesOf(s.plan, "jump:0")[0]);
    const mid = (r: Rect) => r.x + r.w / 2;
    expect(Math.abs(arc[0].x - mid(at("3")))).toBeLessThan(3);
    expect(Math.min(...arc.map((p) => Math.abs(p.x - mid(at("7")))))).toBeLessThan(3);
    // the size above the arc's top
    const top = Math.min(...arc.map((p) => p.y));
    expect(at("+4").y + at("+4").h).toBeLessThanOrEqual(top);
  });

  it("counting back: each jump's size negative, labelled above its own arc", () => {
    const s = sketch({ kind: "number_line", from: 0, to: 20, marks: [], jumps: [{ from: 15, to: 10 }, { from: 10, to: 8 }] });
    expect(texts(s)).toContain("-5");
    expect(texts(s)).toContain("-2");
  });

  it("skip counting numbers the multiples of the jump; every tick is still drawn", () => {
    for (const box of [MODEL_BOXES.number_line[0], MODEL_BOXES.number_line.at(-1)!]) {
      const s = sketch({ kind: "number_line", from: 0, to: 20, marks: [], jumps: [0, 5, 10, 15].map((f) => ({ from: f, to: f + 5 })) }, box);
      expect(texts(s).filter((t) => !t.startsWith("+"))).toEqual(["0", "5", "10", "15", "20"]);
      expect(linesOf(s.plan, "ticks")[0].strokes.length).toBe(21);
    }
  });

  it("a fraction step is written in its denominator; a many-tick line is thinned, never crowded", () => {
    const s = sketch({ kind: "number_line", from: 0, to: 1, step: 0.25, marks: [], jumps: [] });
    expect(texts(s)).toEqual(["0", "\\frac{1}{4}", "\\frac{2}{4}", "\\frac{3}{4}", "1"]);
    const long = sketch({ kind: "number_line", from: 0, to: 40, marks: [], jumps: [] }, MODEL_BOXES.number_line.at(-1)!);
    expect(texts(long)[0]).toBe("0");
    expect(texts(long).at(-1)).toBe("40");
    expect(long.texts.length).toBeLessThan(12);
  });

  it("a mark: a dot on the line, its label above it", () => {
    const s = sketch({ kind: "number_line", from: -5, to: 5, marks: [{ at: -3, label: "A" }], jumps: [] });
    const dot = points(linesOf(s.plan, "mark:0")[0]);
    const label = s.texts.find((t) => t.text === "A")!.rect;
    expect(label.y + label.h).toBeLessThan(Math.min(...dot.map((p) => p.y)));
    expect(linesOf(s.plan, "mark:0")[0].style).toEqual({ color: "violet", fill: "fill", closed: true });
  });

  it("too many ticks for a board: nothing", () => {
    expect(planModel({ kind: "number_line", from: 0, to: 100, step: 1, marks: [], jumps: [] }, MODEL_BOXES.number_line[0], 7)).toBeNull();
  });
});

describe("fraction bars and circles", () => {
  it("bars the same length, parts at exactly k/parts, the shaded ones coloured in inside their part, the fraction worked out", () => {
    const s = sketch({ kind: "fraction_bars", bars: [{ parts: 4, shaded: 3 }, { parts: 8, shaded: 5 }] });
    expect(texts(s)).toEqual(["\\frac{3}{4}", "\\frac{5}{8}"]);
    const bar = (i: number) => points(linesOf(s.plan, `bar:${i}`)[0]);
    const span = (pts: { x: number }[]) => Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x));
    expect(Math.abs(span(bar(0)) - span(bar(1)))).toBeLessThan(2);
    const left = Math.min(...bar(0).map((p) => p.x));
    const length = span(bar(0));
    // the 8 parts' lines at exactly 1/8, 2/8 … of the bar
    const cuts = linesOf(s.plan, "bar:1:parts")[0].strokes.map((st) => st.points[0].x + linesOf(s.plan, "bar:1:parts")[0].x);
    cuts.forEach((x, k) => expect(Math.abs(x - (left + (length * (k + 1)) / 8))).toBeLessThan(1.5));
    expect(partsLike(s.plan, /^bar:0:shade:/)).toHaveLength(3);
    expect(partsLike(s.plan, /^bar:1:shade:/)).toHaveLength(5);
    // each fill inside its own part, in the bar's own light colour
    for (const [k, l] of partsLike(s.plan, /^bar:1:shade:/).entries()) {
      for (const p of points(l)) expect(p.x > left + (length * k) / 8 && p.x < left + (length * (k + 1)) / 8).toBe(true);
      expect(l.style).toEqual({ color: "green", fill: "solid", closed: true });
    }
  });

  it("circles divided exactly: radii for an odd number of parts, diameters for an even one, all through the centre", () => {
    const s = sketch({ kind: "fraction_circles", circles: [{ parts: 3, shaded: 1 }, { parts: 8, shaded: 5 }] });
    expect(texts(s)).toEqual(["\\frac{1}{3}", "\\frac{5}{8}"]);
    expect(linesOf(s.plan, "circle:0:parts")[0].strokes.length).toBe(3);
    expect(partsLike(s.plan, /^circle:1:shade:/)).toHaveLength(5);
    // every cut of the eighths passes through the centre of its circle
    const rim = points(linesOf(s.plan, "circle:1")[0]);
    const c = { x: (Math.min(...rim.map((p) => p.x)) + Math.max(...rim.map((p) => p.x))) / 2, y: (Math.min(...rim.map((p) => p.y)) + Math.max(...rim.map((p) => p.y))) / 2 };
    const cuts = linesOf(s.plan, "circle:1:parts")[0];
    expect(cuts.strokes).toHaveLength(4);
    for (const st of cuts.strokes) {
      const nearest = Math.min(...st.points.map((p) => Math.hypot(p.x + cuts.x - c.x, p.y + cuts.y - c.y)));
      expect(nearest).toBeLessThan(1.5);
    }
  });

  it("a circle of many parts is never drawn small: its slices could not be read", () => {
    const twelfths: VisualModel = { kind: "fraction_circles", circles: [{ parts: 12, shaded: 7 }] };
    expect(planModel(twelfths, MODEL_BOXES.fraction_circles.at(-1)!, 7)).toBeNull();
    expect(planModel(twelfths, MODEL_BOXES.fraction_circles[0], 7)).not.toBeNull();
  });
});

describe("arrays and equal groups", () => {
  it("an array: rows × columns of counters on an even grid, labelled rows × columns (never the product)", () => {
    const s = sketch({ kind: "array", rows: 4, cols: 6 });
    expect(texts(s)).toEqual(["4 \\times 6"]);
    const rows = partsLike(s.plan, /^row:\d+$/);
    expect(rows).toHaveLength(4);
    const centres = rows.map((r) => r.strokes.map((st) => st.points.reduce((a, p) => a + p.x + r.x, 0) / st.points.length));
    for (const cs of centres) expect(cs).toHaveLength(6);
    const gaps = centres[0].slice(1).map((x, i) => x - centres[0][i]);
    for (const g of gaps) expect(Math.abs(g - gaps[0])).toBeLessThan(1);
    expect(texts(s).join(" ")).not.toContain("24");
  });

  it("equal groups: each group a circle holding the same counters, labelled in words", () => {
    const s = sketch({ kind: "equal_groups", groups: 6, each: 5 });
    expect(texts(s)).toEqual(["6 groups of 5"]);
    expect(partsLike(s.plan, /^group:\d+$/)).toHaveLength(6);
    for (const g of partsLike(s.plan, /^group:\d+:counters$/)) expect(g.strokes).toHaveLength(5);
    // empty plates for sharing
    const share = sketch({ kind: "equal_groups", groups: 4, each: 0 });
    expect(partsLike(share.plan, /counters/)).toHaveLength(0);
    expect(texts(share)).toEqual(["4 groups of 0"]);
  });
});

describe("area model", () => {
  it("split by place value, every partial product and their sum worked out by the board", () => {
    const s = sketch({ kind: "area_model", a: 23, b: 14 });
    expect(texts(s)).toEqual(["20", "3", "10", "4", "200", "30", "80", "12", "200 + 30 + 80 + 12 = 322"]);
  });

  it("the number with more parts goes across; zeros are left out; one cell has no sum", () => {
    expect(texts(sketch({ kind: "area_model", a: 4, b: 1234 }))).toEqual(["1000", "200", "30", "4", "4", "4000", "800", "120", "16", "4000 + 800 + 120 + 16 = 4936"]);
    expect(texts(sketch({ kind: "area_model", a: 205, b: 3 }))).toEqual(["200", "5", "3", "600", "15", "600 + 15 = 615"]);
    expect(texts(sketch({ kind: "area_model", a: 7, b: 8 }))).toEqual(["7", "8", "56"]);
  });

  it("roughly to scale: the 20 column wider than the 3, the 10 row taller than the 4", () => {
    const s = sketch({ kind: "area_model", a: 23, b: 14 });
    const cell = (r: number, c: number) => points(linesOf(s.plan, `cell:${r}:${c}`)[0]);
    const w = (pts: { x: number }[]) => Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x));
    const h = (pts: { y: number }[]) => Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y));
    expect(w(cell(0, 0))).toBeGreaterThan(2 * w(cell(0, 1)));
    expect(h(cell(0, 0))).toBeGreaterThan(h(cell(1, 0)));
  });
});

describe("base-ten blocks and place value", () => {
  it("flats as 10 × 10 grids, rods of 10 cells, cubes; each place counted in words; a zero place left out", () => {
    const s = sketch({ kind: "base_ten", value: 345 });
    expect(texts(s)).toEqual(["3 hundreds", "4 tens", "5 ones"]);
    expect(partsLike(s.plan, /^flat:\d+$/)).toHaveLength(3);
    expect(partsLike(s.plan, /^rod:\d+$/)).toHaveLength(4);
    expect(partsLike(s.plan, /^cube:\d+$/)).toHaveLength(5);
    for (const g of partsLike(s.plan, /^flat:\d+:grid$/)) expect(g.strokes).toHaveLength(18);
    for (const g of partsLike(s.plan, /^rod:\d+:grid$/)) expect(g.strokes).toHaveLength(9);
    expect(texts(sketch({ kind: "base_ten", value: 305 }))).toEqual(["3 hundreds", "5 ones"]);
    expect(texts(sketch({ kind: "base_ten", value: 110 }))).toEqual(["1 hundred", "1 ten"]);
  });

  it("a place-value chart: the number, its places named, each digit in its place, a point for a decimal", () => {
    const s = sketch({ kind: "place_value", value: 3405.27 });
    expect(texts(s)).toEqual(["3405.27", "Thousands", "Hundreds", "Tens", "Ones", "Tenths", "Hundredths", "3", "4", "0", "5", "2", "7"]);
    expect(linesOf(s.plan, "point")).toHaveLength(1);
    const whole = sketch({ kind: "place_value", value: 582 });
    expect(texts(whole)).toEqual(["582", "Hundreds", "Tens", "Ones", "5", "8", "2"]);
    expect(linesOf(whole.plan, "point")).toHaveLength(0);
    // short headers when the full names do not fit
    expect(texts(sketch({ kind: "place_value", value: 3405.27 }, MODEL_BOXES.place_value.at(-1)!))).toContain("Th");
  });
});

describe("tape, ten frame and clock", () => {
  it("a tape: segments as long as their units, the unknown left white, the total under a brace", () => {
    const s = sketch({ kind: "tape", rows: [{ segments: [{ units: 5, label: "5" }, { units: 8, label: "?" }] }], total: "13" });
    expect(texts(s)).toEqual(["5", "?", "13"]);
    const row = points(linesOf(s.plan, "row:0")[0]);
    const left = Math.min(...row.map((p) => p.x));
    const right = Math.max(...row.map((p) => p.x));
    const cut = linesOf(s.plan, "row:0:split")[0];
    const x = cut.strokes[0].points[0].x + cut.x;
    expect(Math.abs((x - left) / (right - left) - 5 / 13)).toBeLessThan(0.01);
    expect(partsLike(s.plan, /^row:0:seg:\d+:fill$/).map((l) => l.part)).toEqual(["row:0:seg:0:fill"]);
    expect(linesOf(s.plan, "total:brace")).toHaveLength(1);
  });

  it("two rows on one scale, names on the left, the total beside a brace down the right", () => {
    const s = sketch({
      kind: "tape",
      rows: [
        { label: "Sam", segments: [{ units: 1, label: "12" }, { units: 1, label: "12" }, { units: 1, label: "12" }] },
        { label: "Ann", segments: [{ units: 1, label: "12" }] },
      ],
      total: "48",
    });
    const w = (p: string) => {
      const pts = points(linesOf(s.plan, p)[0]);
      return Math.max(...pts.map((q) => q.x)) - Math.min(...pts.map((q) => q.x));
    };
    expect(Math.abs(w("row:0") / w("row:1") - 3)).toBeLessThan(0.03);
    const total = s.texts.find((t) => t.text === "48")!.rect;
    const brace = points(linesOf(s.plan, "total:brace")[0]);
    expect(total.x).toBeGreaterThan(Math.max(...brace.map((p) => p.x)));
    // the brace's tip points at the total
    const tip = brace.reduce((a, p) => (p.x > a.x ? p : a));
    expect(tip.y).toBeGreaterThan(total.y);
    expect(tip.y).toBeLessThan(total.y + total.h);
  });

  it("ten frames: counters fill the top row first; past ten, a second frame", () => {
    const s = sketch({ kind: "ten_frame", filled: 13 });
    expect(linesOf(s.plan, "frame:0:counters")[0].strokes).toHaveLength(10);
    expect(linesOf(s.plan, "frame:1:counters")[0].strokes).toHaveLength(3);
    const seven = sketch({ kind: "ten_frame", filled: 7 });
    const ys = linesOf(seven.plan, "frame:0:counters")[0].strokes.map((st) => Math.round(st.points.reduce((a, p) => a + p.y, 0) / st.points.length));
    expect(new Set(ys.slice(0, 5)).size).toBe(1);
    expect(ys[5]).toBeGreaterThan(ys[0]);
    expect(linesOf(seven.plan, "frame:1")).toHaveLength(0);
  });

  it("a clock: twelve numbers, the minute hand on the minute, the hour hand between the hours", () => {
    expect(handAngles(3, 45).hour).toBeCloseTo((3.75 / 12) * Math.PI * 2, 9);
    expect(handAngles(3, 45).minute).toBeCloseTo(Math.PI * 1.5, 9);
    expect(handAngles(12, 0)).toEqual({ hour: 0, minute: 0 });
    const s = sketch({ kind: "clock", hour: 3, minute: 45 });
    expect(texts(s)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"]);
    const face = points(linesOf(s.plan, "face")[0]);
    const c = { x: (Math.min(...face.map((p) => p.x)) + Math.max(...face.map((p) => p.x))) / 2, y: (Math.min(...face.map((p) => p.y)) + Math.max(...face.map((p) => p.y))) / 2 };
    const tipAngle = (part: string) => {
      const pts = points(linesOf(s.plan, part)[0]);
      const far = pts.reduce((a, p) => (Math.hypot(p.x - c.x, p.y - c.y) > Math.hypot(a.x - c.x, a.y - c.y) ? p : a));
      return (Math.atan2(far.x - c.x, -(far.y - c.y)) + Math.PI * 2) % (Math.PI * 2);
    };
    expect(Math.abs(tipAngle("hand:minute") - Math.PI * 1.5)).toBeLessThan(0.08);
    expect(Math.abs(tipAngle("hand:hour") - (3.75 / 12) * Math.PI * 2)).toBeLessThan(0.12);
    // the hour hand is shorter than the minute hand
    const len = (part: string) => Math.max(...points(linesOf(s.plan, part)[0]).map((p) => Math.hypot(p.x - c.x, p.y - c.y)));
    expect(len("hand:hour")).toBeLessThan(len("hand:minute") * 0.8);
  });
});

describe("the models' arithmetic", () => {
  it("steps, denominators, place parts", () => {
    expect(autoStep(0, 10)).toBe(1);
    expect(autoStep(0, 100)).toBe(10);
    expect(autoStep(0, 20)).toBe(1);
    expect(autoStep(0, 1)).toBe(0.1);
    expect(stepDenominator(0.25)).toBe(4);
    expect(stepDenominator(1 / 3)).toBe(3);
    expect(stepDenominator(0.1)).toBe(0);
    expect(stepDenominator(2)).toBe(0);
    expect(placeParts(2305)).toEqual([2000, 300, 5]);
    expect(placeParts(7)).toEqual([7]);
  });

  it("reads labels that are numbers, and judges labels that are equations", () => {
    expect(labelNumber("+4")).toEqual({ value: 4, signed: true });
    expect(labelNumber("−3")).toEqual({ value: -3, signed: true });
    expect(labelNumber("\\frac{3}{4}")).toEqual({ value: 0.75, signed: false });
    expect(labelNumber("1 1/2")).toEqual({ value: 1.5, signed: false });
    expect(labelNumber("1,234")).toEqual({ value: 1234, signed: false });
    for (const not of ["?", "x", "Sam", "3 + 4", "apples"]) expect(labelNumber(not), not).toBeNull();
    expect(equationHolds("3 × 4 = 12")).toMatchObject({ holds: true });
    expect(equationHolds("3 \\times 4 = 13")).toMatchObject({ holds: false, left: 12 });
    expect(equationHolds("x = 12")).toBeNull();
    expect(evaluate("(20 + 3) x 14")).toBe(322);
  });
});
