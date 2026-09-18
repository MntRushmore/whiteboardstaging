import { describe, expect, it } from "vitest";

import {
  layoutMath,
  placeStrokes,
  strokeBounds,
  strokeDurationMs,
  totalDurationMs,
  type MathLayout,
  type Stroke,
  type StrokeKind,
} from "@/lib/hand/mathLayout";

const EPS = 1e-6;

function of(layout: MathLayout, kind: StrokeKind): Stroke[] {
  return layout.strokes.filter((s) => s.kind === kind);
}

function bounds(strokes: Stroke[]) {
  const b = strokeBounds(strokes);
  expect(b, "expected ink").not.toBeNull();
  return b!;
}

/** Merge strokes into glyph-shaped clusters by overlapping x intervals. */
function xClusters(strokes: Stroke[]): { min: number; max: number }[] {
  const spans = strokes
    .map((s) => ({ min: Math.min(...s.points.map((p) => p.x)), max: Math.max(...s.points.map((p) => p.x)) }))
    .sort((a, b) => a.min - b.min);
  const out: { min: number; max: number }[] = [];
  for (const span of spans) {
    const last = out[out.length - 1];
    if (last && span.min <= last.max) last.max = Math.max(last.max, span.max);
    else out.push({ ...span });
  }
  return out;
}

function gapsBetweenClusters(strokes: Stroke[]): number[] {
  const clusters = xClusters(strokes);
  const gaps: number[] = [];
  for (let i = 1; i < clusters.length; i++) gaps.push(clusters[i].min - clusters[i - 1].max);
  return gaps;
}

const SUPPORTED = [
  "2x+3=11",
  "\\frac{1}{2}",
  "\\frac{x+1}{2x-3}",
  "x^{2}+y_{1}",
  "x^2",
  "\\sqrt{x+1}",
  "\\sqrt[3]{8}",
  "31.36\\,\\mathrm{N}",
  "\\boxed{x = 4}",
  "\\frac{\\frac{1}{2}}{3}",
  "x = \\frac{-b \\pm \\sqrt{b^{2} - 4ac}}{2a}",
  "y \\approx 3.5 \\text{ or } y \\le -2",
  "(x+1)(x-2) = 0",
  "2 \\cdot 3 \\times 10^{5} \\div 4",
  "\\pi r^{2} + \\theta - \\Delta \\rightarrow 7",
  "a \\ne b \\ge c",
  "\\left(\\frac{1}{2}\\right)",
];

describe("layoutMath — contract", () => {
  it("renders every construct our engine emits with an empty `unsupported`", () => {
    for (const latex of SUPPORTED) {
      const layout = layoutMath(latex, { seed: 5 });
      expect(layout.unsupported, latex).toEqual([]);
      expect(layout.strokes.length, latex).toBeGreaterThan(0);
    }
  });

  it("reports the bounding box exactly — nothing renders outside it", () => {
    for (const latex of SUPPORTED) {
      const layout = layoutMath(latex, { seed: 5 });
      const b = bounds(layout.strokes);
      expect(b.minX, latex).toBeCloseTo(0, 6);
      expect(b.minY, latex).toBeCloseTo(0, 6);
      expect(b.maxX, latex).toBeCloseTo(layout.width, 6);
      expect(b.maxY, latex).toBeCloseTo(layout.height, 6);
      expect(layout.baseline, latex).toBeGreaterThan(0);
      expect(layout.baseline, latex).toBeLessThanOrEqual(layout.height + EPS);
      for (const stroke of layout.strokes) {
        expect(stroke.points.length, latex).toBeGreaterThanOrEqual(2);
        for (const p of stroke.points) {
          expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z), latex).toBe(true);
          expect(p.x).toBeGreaterThanOrEqual(-EPS);
          expect(p.x).toBeLessThanOrEqual(layout.width + EPS);
          expect(p.y).toBeGreaterThanOrEqual(-EPS);
          expect(p.y).toBeLessThanOrEqual(layout.height + EPS);
        }
      }
    }
  });

  it("numbers its strokes in drawing order", () => {
    const layout = layoutMath("\\frac{1}{2}", { seed: 5 });
    expect(layout.strokes.map((s) => s.order)).toEqual(layout.strokes.map((_, i) => i));
  });

  it("is deterministic for a fixed seed and varies with the seed", () => {
    const a = layoutMath("2x+3=11", { seed: 9 });
    const b = layoutMath("2x+3=11", { seed: 9 });
    const c = layoutMath("2x+3=11", { seed: 10 });
    expect(b.strokes).toEqual(a.strokes);
    expect(b.width).toBe(a.width);
    expect(c.strokes).not.toEqual(a.strokes);
  });

  it("scales with `size`", () => {
    const small = layoutMath("2x+3=11", { seed: 3, size: 22 });
    const big = layoutMath("2x+3=11", { seed: 3, size: 44 });
    expect(big.width / small.width).toBeGreaterThan(1.9);
    expect(big.width / small.width).toBeLessThan(2.1);
  });

  it("grows with content", () => {
    const seed = 4;
    const one = layoutMath("x", { seed });
    const two = layoutMath("x+1", { seed });
    const three = layoutMath("x+1+2", { seed });
    expect(two.width).toBeGreaterThan(one.width);
    expect(three.width).toBeGreaterThan(two.width);
    expect(layoutMath("\\frac{x+1}{2x-3}", { seed }).width).toBeGreaterThan(layoutMath("\\frac{1}{2}", { seed }).width);
  });

  it("never throws, whatever it is handed", () => {
    for (const junk of ["", "\\frac{", "}{", "\\", "^{", "_", "\\left(", "\\sqrt[", "{{{{", "\\frac{1}{}", "&&&"]) {
      expect(() => layoutMath(junk)).not.toThrow();
      const layout = layoutMath(junk);
      expect(Array.isArray(layout.strokes)).toBe(true);
      expect(Number.isFinite(layout.width) && Number.isFinite(layout.height)).toBe(true);
    }
    expect(layoutMath("").strokes).toEqual([]);
  });
});

describe("layoutMath — operator spacing", () => {
  it("separates operators and relations more than it separates letters", () => {
    const layout = layoutMath("2x+3=11", { seed: 5 });
    // clusters: 2 | x | + | 3 | = | 1 | 1
    const gaps = gapsBetweenClusters(layout.strokes);
    expect(gaps).toHaveLength(6);
    const [twoToX, xToPlus, plusToThree, threeToEq, eqToOne, oneToOne] = gaps;
    expect(xToPlus).toBeGreaterThan(twoToX);
    expect(plusToThree).toBeGreaterThan(twoToX);
    expect(Math.min(threeToEq, eqToOne)).toBeGreaterThan(Math.max(twoToX, oneToOne));
  });

  it("keeps the digits of a number tight and the unit off to the side", () => {
    const layout = layoutMath("31.36\\,\\mathrm{N}", { seed: 5 });
    expect(layout.unsupported).toEqual([]);
    const gaps = gapsBetweenClusters(layout.strokes);
    // 3 1 . 3 6 N -> five gaps; the last one (before the unit) is the widest.
    expect(gaps).toHaveLength(5);
    const digitGaps = gaps.slice(0, 4);
    expect(gaps[4]).toBeGreaterThan(Math.max(...digitGaps));
  });

  it("treats a leading minus as a sign, not an operation", () => {
    const signed = layoutMath("-2", { seed: 5 });
    const subtracted = layoutMath("3-2", { seed: 5 });
    const plain = layoutMath("32", { seed: 5 });
    expect(signed.width).toBeLessThan(subtracted.width - (plain.width - layoutMath("2", { seed: 5 }).width));
  });
});

describe("layoutMath — fractions", () => {
  it("stacks the numerator above the bar and the denominator below, bar spanning both", () => {
    const layout = layoutMath("\\frac{x+1}{2x-3}", { seed: 5 });
    expect(layout.unsupported).toEqual([]);
    const rules = of(layout, "rule");
    expect(rules).toHaveLength(1);
    const bar = bounds(rules);
    const glyphs = of(layout, "glyph");
    expect(glyphs.length).toBeGreaterThan(4);

    let above = 0;
    let below = 0;
    for (const stroke of glyphs) {
      const b = bounds([stroke]);
      if (b.maxY < bar.minY) above += 1;
      else if (b.minY > bar.maxY) below += 1;
      else throw new Error("a glyph straddles the fraction bar");
      expect(b.minX).toBeGreaterThanOrEqual(bar.minX - EPS);
      expect(b.maxX).toBeLessThanOrEqual(bar.maxX + EPS);
    }
    expect(above).toBeGreaterThan(0);
    expect(below).toBeGreaterThan(0);
  });

  it("centres numerator and denominator on the bar", () => {
    const layout = layoutMath("\\frac{1}{2x-3}", { seed: 5 });
    const bar = bounds(of(layout, "rule"));
    const glyphs = of(layout, "glyph");
    const num = bounds(glyphs.filter((s) => bounds([s]).maxY < bar.minY));
    const den = bounds(glyphs.filter((s) => bounds([s]).minY > bar.maxY));
    const barMid = (bar.minX + bar.maxX) / 2;
    expect(Math.abs((num.minX + num.maxX) / 2 - barMid)).toBeLessThan(bar.width * 0.12);
    expect(Math.abs((den.minX + den.maxX) / 2 - barMid)).toBeLessThan(bar.width * 0.12);
  });

  it("puts the bar on the math axis, above the baseline", () => {
    const layout = layoutMath("\\frac{1}{2}", { seed: 5 });
    const bar = bounds(of(layout, "rule"));
    expect(bar.maxY).toBeLessThan(layout.baseline);
  });

  it("nests, with the inner bar strictly shorter than the outer one", () => {
    const layout = layoutMath("\\frac{\\frac{1}{2}}{3}", { seed: 5 });
    expect(layout.unsupported).toEqual([]);
    const rules = of(layout, "rule");
    expect(rules).toHaveLength(2);
    const [a, b] = rules.map((r) => bounds([r]));
    const outer = a.width >= b.width ? a : b;
    const inner = a.width >= b.width ? b : a;
    expect(inner.width).toBeLessThan(outer.width);
    expect(inner.minX).toBeGreaterThanOrEqual(outer.minX - EPS);
    expect(inner.maxX).toBeLessThanOrEqual(outer.maxX + EPS);
    expect(layout.height).toBeGreaterThan(layoutMath("\\frac{1}{2}", { seed: 5 }).height);
  });
});

describe("layoutMath — scripts", () => {
  it("raises a superscript clear of the writing line and lowers a subscript below it", () => {
    const layout = layoutMath("x^{2}+y_{1}", { seed: 5 });
    expect(layout.unsupported).toEqual([]);
    const clusters = xClusters(layout.strokes);
    // x | 2 | + | y | 1
    expect(clusters).toHaveLength(5);

    const sup = bounds(layout.strokes.filter((s) => clusterIndex(layout.strokes, s) === 1));
    const sub = bounds(layout.strokes.filter((s) => clusterIndex(layout.strokes, s) === 4));
    expect(sup.maxY).toBeLessThan(layout.baseline);
    expect(sub.maxY).toBeGreaterThan(layout.baseline);
  });

  it("draws a script smaller than its base", () => {
    const layout = layoutMath("2^{2}", { seed: 5 });
    const clusters = xClusters(layout.strokes);
    expect(clusters).toHaveLength(2);
    const base = bounds(layout.strokes.filter((s) => clusterIndex(layout.strokes, s) === 0));
    const sup = bounds(layout.strokes.filter((s) => clusterIndex(layout.strokes, s) === 1));
    expect(sup.height).toBeLessThan(base.height * 0.85);
    expect(sup.width).toBeLessThan(base.width * 0.85);
    expect(sup.maxY).toBeLessThan(base.maxY);
  });

  it("accepts a braceless script", () => {
    const braced = layoutMath("x^{2}", { seed: 5 });
    const bare = layoutMath("x^2", { seed: 5 });
    expect(bare.unsupported).toEqual([]);
    expect(bare.width).toBeCloseTo(braced.width, 6);
  });

  it("stacks a superscript and a subscript on the same base without collision", () => {
    const layout = layoutMath("x_{1}^{2}", { seed: 5 });
    expect(layout.unsupported).toEqual([]);
    const clusters = xClusters(layout.strokes);
    expect(clusters.length).toBeGreaterThanOrEqual(2);
  });
});

/** Which x-cluster a stroke belongs to, for the script tests. */
function clusterIndex(all: Stroke[], stroke: Stroke): number {
  const clusters = xClusters(all);
  const min = Math.min(...stroke.points.map((p) => p.x));
  for (let i = 0; i < clusters.length; i++) {
    if (min >= clusters[i].min - EPS && min <= clusters[i].max + EPS) return i;
  }
  return -1;
}

describe("layoutMath — radicals", () => {
  it("stretches the vinculum over the whole radicand", () => {
    const layout = layoutMath("\\sqrt{x+1}", { seed: 5 });
    expect(layout.unsupported).toEqual([]);
    const radicals = of(layout, "radical");
    expect(radicals).toHaveLength(1);
    const radical = bounds(radicals);
    const radicand = bounds(of(layout, "glyph"));
    expect(radical.maxX).toBeGreaterThanOrEqual(radicand.maxX);
    expect(radical.minX).toBeLessThan(radicand.minX);
    expect(radical.minY).toBeLessThan(radicand.minY);
    expect(radical.maxY).toBeGreaterThanOrEqual(radicand.maxY - EPS);
  });

  it("grows the radical with a taller radicand", () => {
    const short = layoutMath("\\sqrt{x}", { seed: 5 });
    const tall = layoutMath("\\sqrt{\\frac{1}{2}}", { seed: 5 });
    expect(bounds(of(tall, "radical")).height).toBeGreaterThan(bounds(of(short, "radical")).height);
  });

  it("raises the index of a cube root above and left of the radical", () => {
    const plain = layoutMath("\\sqrt{8}", { seed: 5 });
    const cube = layoutMath("\\sqrt[3]{8}", { seed: 5 });
    expect(cube.unsupported).toEqual([]);
    expect(of(cube, "glyph").length).toBe(of(plain, "glyph").length + 1);
    expect(cube.width).toBeGreaterThan(plain.width);

    const radical = bounds(of(cube, "radical"));
    const index = of(cube, "glyph")
      .map((s) => bounds([s]))
      .reduce((a, b) => (a.minX <= b.minX ? a : b));
    expect(index.minX).toBeLessThan(radical.minX + radical.width * 0.5);
    expect(index.maxY).toBeLessThan(cube.baseline);
  });
});

describe("layoutMath — fences and boxes", () => {
  it("grows a delimiter with the height of its content", () => {
    const flat = layoutMath("(x)", { seed: 5 });
    const tall = layoutMath("(\\frac{1}{2})", { seed: 5 });
    const flatDelims = bounds(of(flat, "delimiter"));
    const tallDelims = bounds(of(tall, "delimiter"));
    expect(of(flat, "delimiter").length).toBe(2);
    expect(tallDelims.height).toBeGreaterThan(flatDelims.height * 1.3);
  });

  it("supports \\left( … \\right)", () => {
    const layout = layoutMath("\\left(\\frac{1}{2}\\right)", { seed: 5 });
    expect(layout.unsupported).toEqual([]);
    expect(of(layout, "delimiter")).toHaveLength(2);
  });

  it("draws a box that encloses the boxed content", () => {
    const layout = layoutMath("\\boxed{x = 4}", { seed: 5 });
    expect(layout.unsupported).toEqual([]);
    const boxStrokes = of(layout, "box");
    expect(boxStrokes).toHaveLength(1);
    const box = bounds(boxStrokes);
    const content = bounds(of(layout, "glyph"));
    expect(box.minX).toBeLessThan(content.minX);
    expect(box.maxX).toBeGreaterThan(content.maxX);
    expect(box.minY).toBeLessThan(content.minY);
    expect(box.maxY).toBeGreaterThan(content.maxY);
    expect(layout.width).toBeGreaterThan(layoutMath("x = 4", { seed: 5 }).width);
  });
});

describe("layoutMath — unsupported reporting", () => {
  it("refuses to pretend it can draw a sum", () => {
    const layout = layoutMath("\\sum_{i=1}^{n} i", { seed: 5 });
    expect(layout.unsupported).toContain("\\sum");
  });

  it("refuses to pretend it can draw a matrix", () => {
    const layout = layoutMath("\\begin{pmatrix}1 & 2 \\\\ 3 & 4\\end{pmatrix}", { seed: 5 });
    expect(layout.unsupported.length).toBeGreaterThan(0);
    expect(layout.unsupported[0]).toContain("\\begin{pmatrix}");
  });

  it("reports an unknown command and an undrawable character once each", () => {
    const layout = layoutMath("\\bogus x \\bogus §§", { seed: 5 });
    expect(layout.unsupported).toEqual(["\\bogus", "§"]);
  });

  it("reports a fraction it could not complete", () => {
    expect(layoutMath("\\frac{1}").unsupported).toContain("\\frac");
  });
});

describe("stroke helpers", () => {
  const layout = layoutMath("2x+3=11", { seed: 5 });

  it("times a stroke from its length, within human bounds", () => {
    for (const stroke of layout.strokes) {
      const ms = strokeDurationMs(stroke);
      expect(ms).toBeGreaterThanOrEqual(60);
      expect(ms).toBeLessThanOrEqual(900);
    }
    const long = layoutMath("\\frac{x+1}{2x-3}", { seed: 5 });
    const bar = long.strokes.find((s) => s.kind === "rule")!;
    const dot = layoutMath("2x+3=11", { seed: 5 }).strokes[0];
    expect(strokeDurationMs(bar)).toBeGreaterThan(0);
    expect(strokeDurationMs(dot)).toBeGreaterThan(0);
    expect(totalDurationMs(layout.strokes)).toBeGreaterThan(strokeDurationMs(layout.strokes[0]));
    expect(totalDurationMs([])).toBe(0);
  });

  it("places a layout without distorting it", () => {
    const moved = placeStrokes(layout.strokes, { x: 100, y: 50, scale: 2 });
    const before = bounds(layout.strokes);
    const after = bounds(moved);
    expect(after.minX).toBeCloseTo(before.minX * 2 + 100, 6);
    expect(after.minY).toBeCloseTo(before.minY * 2 + 50, 6);
    expect(after.width).toBeCloseTo(before.width * 2, 6);
    expect(moved[0].points[0].z).toBe(layout.strokes[0].points[0].z);
    expect(strokeBounds([])).toBeNull();
  });
});
