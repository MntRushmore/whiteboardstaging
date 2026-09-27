import { describe, expect, it } from "vitest";

import { layoutMath, strokeBounds, type MathLayout, type Stroke, type StrokeKind } from "@/lib/hand/mathLayout";

/**
 * Geometry of the constructs calculus and advanced algebra need: where an integral's
 * limits go, how big its sign is, what a `\lim` does with its subscript, where an
 * evaluation bar puts its bounds, and so on. Positions, not just "it drew something".
 */

const EPS = 1e-6;

function bounds(strokes: Stroke[]) {
  const b = strokeBounds(strokes);
  expect(b, "expected ink").not.toBeNull();
  return b!;
}

function of(layout: MathLayout, kind: StrokeKind): Stroke[] {
  return layout.strokes.filter((s) => s.kind === kind);
}

/** Height of a plain digit at the same size, for "how big is this sign" comparisons. */
function digitHeight(size = 28): number {
  return layoutMath("8", { seed: 1, size }).height;
}

describe("integrals", () => {
  it("draws the sign as ONE tall stroke, about two digits high, on the axis", () => {
    const layout = layoutMath("\\int x\\,dx", { seed: 4, size: 28 });
    expect(layout.unsupported).toEqual([]);
    const sign = layout.strokes[0];
    const b = bounds([sign]);
    expect(b.height).toBeGreaterThan(digitHeight() * 1.8);
    expect(b.height).toBeLessThan(digitHeight() * 2.6);
    // it reaches above the letters and below the writing line
    expect(b.minY).toBeLessThan(layout.baseline - digitHeight());
    expect(b.maxY).toBeGreaterThan(layout.baseline);
    // written top to bottom: the pen starts at the top hook
    expect(sign.points[0].y).toBeLessThan(sign.points[sign.points.length - 1].y);
  });

  it("grows to cover a tall integrand", () => {
    const plain = bounds([layoutMath("\\int x\\,dx", { seed: 4 }).strokes[0]]);
    const tall = layoutMath("\\int \\frac{\\frac{1}{x}}{1 + x^{2}}\\,dx", { seed: 4 });
    const sign = bounds([tall.strokes[0]]);
    expect(sign.height).toBeGreaterThan(plain.height);
    const bar = bounds(of(tall, "rule"));
    const integrand = bounds(tall.strokes.filter((s) => bounds([s]).minX > sign.maxX));
    expect(sign.minY).toBeLessThanOrEqual(integrand.minY + EPS);
    expect(sign.maxY).toBeGreaterThanOrEqual(integrand.maxY - 1);
    expect(bar.minX).toBeGreaterThan(sign.maxX);
  });

  it("puts the limits at the sign's corners, the lower one tucked under the slant", () => {
    const layout = layoutMath("\\int_{0}^{2} x\\,dx", { seed: 4, size: 28 });
    const [sign, ...rest] = layout.strokes;
    const s = bounds([sign]);
    // drawing order: sign, lower limit, upper limit, integrand
    const lower = bounds([rest[0]]);
    const upper = bounds([rest[1]]);
    expect(lower.minY).toBeGreaterThan(s.minY + s.height * 0.6);
    expect(lower.maxY).toBeLessThanOrEqual(s.maxY + 2);
    expect(upper.maxY).toBeLessThan(s.minY + s.height * 0.4);
    expect(upper.minY).toBeGreaterThanOrEqual(s.minY - 2);
    expect(lower.minX).toBeLessThan(upper.minX);
    expect(upper.minX).toBeGreaterThan(s.maxX - 1);
    // the integrand starts clear of both limits
    const integrand = bounds(rest.slice(2));
    expect(integrand.minX).toBeGreaterThan(Math.max(lower.maxX, upper.maxX));
  });

  it("stacks the limits above and below with \\limits", () => {
    const layout = layoutMath("\\int\\limits_{0}^{1} x\\,dx", { seed: 4 });
    const [sign, lower, upper] = layout.strokes.map((st) => bounds([st]));
    expect(lower.minY).toBeGreaterThan(sign.maxY);
    expect(upper.maxY).toBeLessThan(sign.minY);
  });

  it("draws one sign per integral in \\iint and \\iiint", () => {
    const one = layoutMath("\\int f", { seed: 2 });
    const two = layoutMath("\\iint f", { seed: 2 });
    const three = layoutMath("\\iiint f", { seed: 2 });
    expect(two.strokes.length).toBe(one.strokes.length + 1);
    expect(three.strokes.length).toBe(one.strokes.length + 2);
    expect(three.width).toBeGreaterThan(two.width);
  });
});

describe("limits, sums and named operators", () => {
  it("writes the limit under `lim`, centred, below the writing line", () => {
    const layout = layoutMath("\\lim_{x \\to 2} f(x)", { seed: 4 });
    expect(layout.unsupported).toEqual([]);
    const glyphs = layout.strokes.map((st) => bounds([st]));
    const lim = glyphs.slice(0, 5); // l, i (stem + dot), m (two humps)
    const limB = { minX: Math.min(...lim.map((b) => b.minX)), maxX: Math.max(...lim.map((b) => b.maxX)), maxY: Math.max(...lim.map((b) => b.maxY)) };
    const under = glyphs.filter((b) => b.minY > limB.maxY);
    expect(under.length).toBeGreaterThanOrEqual(4); // x, arrow (2), 2
    const u = { minX: Math.min(...under.map((b) => b.minX)), maxX: Math.max(...under.map((b) => b.maxX)) };
    expect(Math.abs((u.minX + u.maxX) / 2 - (limB.minX + limB.maxX) / 2)).toBeLessThan(4);
    for (const b of under) expect(b.minY).toBeGreaterThan(layout.baseline);
  });

  it("puts a sum's limits above and below a sign bigger than a digit", () => {
    const layout = layoutMath("\\sum_{i=1}^{n} i", { seed: 4, size: 28 });
    const sign = bounds([layout.strokes[0]]);
    expect(sign.height).toBeGreaterThan(digitHeight() * 1.3);
    const others = layout.strokes.slice(1).map((st) => bounds([st]));
    expect(others.some((b) => b.minY > sign.maxY)).toBe(true);
    expect(others.some((b) => b.maxY < sign.minY)).toBe(true);
  });

  it("spaces a function name from its argument, but not from its bracket", () => {
    const gapAfterN = (latex: string): number => {
      const layout = layoutMath(latex, { seed: 4 });
      const xs = layout.strokes.map((st) => bounds([st]));
      // l, n are the first two strokes; the next stroke starts the argument
      return xs[2].minX - xs[1].maxX;
    };
    expect(gapAfterN("\\ln x")).toBeGreaterThan(gapAfterN("\\ln(x)"));
    expect(gapAfterN("\\ln|x|")).toBeGreaterThan(gapAfterN("\\ln(x)"));
  });
});

describe("evaluation brackets and bars", () => {
  it("grows `\\bigg|` over the fraction before it and hangs the bounds at its corners", () => {
    const layout = layoutMath("\\frac{x^{3}}{3} \\bigg|_{0}^{2}", { seed: 4 });
    expect(layout.unsupported).toEqual([]);
    const bar = bounds(of(layout, "delimiter"));
    const frac = bounds(layout.strokes.filter((st) => st.kind !== "delimiter" && bounds([st]).maxX < bar.minX));
    expect(bar.minY).toBeLessThan(frac.minY);
    expect(bar.maxY).toBeGreaterThan(frac.maxY);
    const scripts = layout.strokes.filter((st) => bounds([st]).minX > bar.maxX).map((st) => bounds([st]));
    const top = scripts.filter((b) => b.maxY < layout.baseline);
    const bottom = scripts.filter((b) => b.minY > layout.baseline - digitHeight(22) * 0.2);
    expect(top.length).toBeGreaterThan(0);
    expect(bottom.length).toBeGreaterThan(0);
    expect(Math.min(...top.map((b) => b.minY))).toBeLessThan(bar.minY + bar.height * 0.3);
    expect(Math.max(...bottom.map((b) => b.maxY))).toBeGreaterThan(bar.maxY - bar.height * 0.3);
  });

  it("puts `\\left[ … \\right]_a^b` bounds at the top and foot of the bracket", () => {
    const layout = layoutMath("\\left[ x^{3} \\right]_{0}^{2}", { seed: 4 });
    const delims = of(layout, "delimiter").map((st) => bounds([st]));
    expect(delims).toHaveLength(2);
    const close = delims[1];
    const scripts = layout.strokes.filter((st) => bounds([st]).minX > close.maxX).map((st) => bounds([st]));
    const upper = scripts.reduce((a, b) => (a.minY < b.minY ? a : b));
    const lower = scripts.reduce((a, b) => (a.maxY > b.maxY ? a : b));
    expect(upper.minY).toBeLessThan(close.minY + close.height * 0.25);
    expect(lower.maxY).toBeGreaterThan(close.maxY);
  });

  it("sizes `\\big` < `\\Big` < `\\bigg` < `\\Bigg`", () => {
    const h = (cmd: string) => bounds(of(layoutMath(`\\${cmd}( x \\${cmd})`, { seed: 4 }), "delimiter")).height;
    expect(h("big")).toBeLessThan(h("Big"));
    expect(h("Big")).toBeLessThan(h("bigg"));
    expect(h("bigg")).toBeLessThan(h("Bigg"));
  });
});

describe("primes, bars and degrees", () => {
  it("hangs a prime at the top right of its base, one stroke per prime", () => {
    const f = layoutMath("f(x)", { seed: 4 });
    const f1 = layoutMath("f'(x)", { seed: 4 });
    const f2 = layoutMath("f''(x)", { seed: 4 });
    expect(f1.strokes.length).toBe(f.strokes.length + 1);
    expect(f2.strokes.length).toBe(f.strokes.length + 2);
    const y1 = layoutMath("y'", { seed: 4 });
    const prime = bounds([y1.strokes[y1.strokes.length - 1]]);
    const y = bounds(y1.strokes.slice(0, -1));
    expect(prime.maxY).toBeLessThan(y.minY + y.height * 0.5);
    expect(prime.minX).toBeGreaterThan(y.minX + y.width * 0.5);
  });

  it("pairs bare bars into a growing absolute value", () => {
    expect(of(layoutMath("|x|", { seed: 4 }), "delimiter")).toHaveLength(2);
    expect(of(layoutMath("|x - 1| + |y|", { seed: 4 }), "delimiter")).toHaveLength(4);
    expect(of(layoutMath("\\lvert x \\rvert", { seed: 4 }), "delimiter")).toHaveLength(2);
    // a lone bar is a symbol, not half a fence
    expect(of(layoutMath("a | b", { seed: 4 }), "delimiter")).toHaveLength(0);
    const tall = bounds(of(layoutMath("\\left| \\frac{1}{x} \\right|", { seed: 4 }), "delimiter"));
    const flat = bounds(of(layoutMath("|x|", { seed: 4 }), "delimiter"));
    expect(tall.height).toBeGreaterThan(flat.height * 1.2);
  });

  it("writes a degree ring level with the top of the number", () => {
    const layout = layoutMath("30^\\circ", { seed: 4 });
    const ring = bounds([layout.strokes[layout.strokes.length - 1]]);
    const digits = bounds(layout.strokes.slice(0, -1));
    expect(ring.minX).toBeGreaterThan(digits.maxX - 1);
    expect(Math.abs(ring.minY - digits.minY)).toBeLessThan(digits.height * 0.2);
    expect(ring.maxY).toBeLessThan(digits.minY + digits.height * 0.5);
  });

  it("draws an overline clear above its letter", () => {
    const layout = layoutMath("\\overline{x}", { seed: 4 });
    const bar = bounds(of(layout, "rule"));
    const x = bounds(of(layout, "glyph"));
    expect(bar.maxY).toBeLessThan(x.minY);
    expect(bar.width).toBeGreaterThan(x.width * 0.8);
  });
});

describe("grids", () => {
  it("stacks the rows of `cases` behind one brace that spans them all", () => {
    const layout = layoutMath("\\begin{cases} x + y = 5 \\\\ x - y = 1 \\\\ 2x = 6 \\end{cases}", { seed: 4 });
    expect(layout.unsupported).toEqual([]);
    const brace = bounds(of(layout, "delimiter"));
    const rows = layout.strokes.filter((st) => st.kind === "glyph");
    const content = bounds(rows);
    expect(brace.minY).toBeLessThanOrEqual(content.minY + EPS);
    expect(brace.maxY).toBeGreaterThanOrEqual(content.maxY - EPS);
    expect(brace.maxX).toBeLessThan(content.minX);
    expect(content.height).toBeGreaterThan(digitHeight(22) * 3);
  });

  it("lays a matrix out in rows and columns between growing brackets", () => {
    const layout = layoutMath("\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}", { seed: 4 });
    expect(of(layout, "delimiter")).toHaveLength(2);
    const cells = of(layout, "glyph").map((st) => bounds([st]));
    // 1, 2 | 3, 4: the second row is below the first, the second column right of the first
    const [one, two] = [cells[0], cells[cells.length - 1]];
    expect(two.minY).toBeGreaterThan(one.maxY);
    expect(two.minX).toBeGreaterThan(one.maxX);
  });
});

describe("formulas and units set upright", () => {
  it("writes `_` and `^` inside `\\mathrm{}` as scripts, never as glyphs", () => {
    const unit = layoutMath("\\mathrm{m/s^{2}}", { seed: 4 });
    const plain = layoutMath("\\mathrm{m/s}", { seed: 4 });
    // m, /, s plus a raised 2 — and no caret
    expect(unit.unsupported).toEqual([]);
    expect(unit.strokes.length).toBe(plain.strokes.length + 1);
    const two = bounds([unit.strokes[unit.strokes.length - 1]]);
    expect(two.maxY).toBeLessThan(unit.baseline - 2);

    const water = layoutMath("\\mathrm{H_{2}O}", { seed: 4 });
    expect(water.unsupported).toEqual([]);
    const sub = water.strokes.map((st) => bounds([st])).filter((b) => b.maxY > water.baseline + 1);
    expect(sub.length).toBeGreaterThan(0);
  });
});

describe("robustness", () => {
  it("never throws on half-written calculus, grids or fences", () => {
    const junk = [
      "\\int_",
      "\\int^{",
      "\\lim_{",
      "\\lim_{x \\to",
      "\\sum\\limits",
      "\\limits_0",
      "|",
      "||",
      "|x",
      "\\left|",
      "\\bigg",
      "\\Big[",
      "\\bigg|_0^",
      "\\begin{cases}",
      "\\begin{pmatrix}1&",
      "\\begin{cases} x \\\\ \\\\",
      "\\end{cases}",
      "'",
      "f'''''",
      "\\overline",
      "\\vec{}",
      "\\mathbb",
      "\\mathrm{H_",
      "\\xrightarrow",
      "\\not",
      "\\lvert x",
      "\\binom{1}",
      "^\\circ",
    ];
    for (const latex of junk) {
      expect(() => layoutMath(latex), latex).not.toThrow();
      const layout = layoutMath(latex);
      expect(Number.isFinite(layout.width) && Number.isFinite(layout.height), latex).toBe(true);
      for (const st of layout.strokes) for (const p of st.points) expect(Number.isFinite(p.x) && Number.isFinite(p.y), latex).toBe(true);
    }
  });
});

describe("words", () => {
  it("draws a short mathematical word and refuses a sentence", () => {
    expect(layoutMath("x = 2 \\text{ or } x = 3").unsupported).toEqual([]);
    expect(layoutMath("\\text{no real solution}").unsupported).toEqual([]);
    expect(layoutMath("\\text{so the answer is two because it balances}").unsupported).toEqual(["\\text"]);
  });
});
