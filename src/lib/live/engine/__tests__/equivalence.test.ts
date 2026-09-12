import { beforeAll, describe, expect, it } from "vitest";
import type { LineAnalysis, LiveEngine } from "../../contracts";
import { getEngine } from "..";

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

const feedback = { mode: "feedback" as const };

function chain(lines: string[]): LineAnalysis[] {
  const out: LineAnalysis[] = [];
  let original: LineAnalysis | undefined;
  for (const latex of lines) {
    const previous = out[out.length - 1];
    const a = engine.analyzeLine(latex, { previous, original, mode: "feedback" });
    if (!original && (a.kind === "equation" || a.kind === "inequality")) original = a;
    out.push(a);
  }
  return out;
}

describe("equivalence: linear chain", () => {
  it("2x+3=11 -> 2x=8 -> x=4 is none/ok/solved", () => {
    const [a1, a2, a3] = chain(["2x + 3 = 11", "2x = 8", "x = 4"]);
    expect(a1.kind).toBe("equation");
    expect(a1.variable).toBe("x");
    expect(a1.solutions).toEqual(["4"]);
    expect(a1.verdict).toBe("none");
    expect(a2.verdict).toBe("ok");
    expect(a2.kind).toBe("equation");
    expect(a3.kind).toBe("equation");
    expect(a3.verdict).toBe("ok");
    expect(a3.solved).toBe(true);
  });
  it("sign slip 2x = 14 -> mismatch", () => {
    const [, a2] = chain(["2x + 3 = 11", "2x = 14"]);
    expect(a2.verdict).toBe("mismatch");
  });
  it("division slip x = 5 -> mismatch, not solved", () => {
    const [, , a3] = chain(["2x + 3 = 11", "2x = 8", "x = 5"]);
    expect(a3.verdict).toBe("mismatch");
    expect(a3.solved).toBe(false);
  });
  it("two unknowns -> unknown", () => {
    const [a1, a2] = chain(["x + y = 5", "x = 5 - y"]);
    expect(a1.kind).toBe("equation");
    expect(a1.verdict).toBe("unknown");
    expect(a2.verdict).toBe("unknown");
  });
  it("works with Mathpix spacing, fractions and \\left(", () => {
    const [, a2, a3, a4] = chain(["3\\left(x-2\\right)=2 x+5", "3x - 6 = 2x + 5", "x = 11", "\\frac{x}{11} = 1"]);
    expect(a2.verdict).toBe("ok");
    expect(a3.verdict).toBe("ok");
    expect(a3.solved).toBe(true);
    expect(a4.verdict).toBe("ok");
  });
  it("falls back to the original when the previous line is not a relation", () => {
    const orig = engine.analyzeLine("2x + 3 = 11", feedback);
    const label = engine.analyzeLine("a)", { previous: orig, original: orig, mode: "feedback" });
    const step = engine.analyzeLine("2x = 8", { previous: label, original: orig, mode: "feedback" });
    expect(step.verdict).toBe("ok");
  });
  it("first equation without context has verdict none and a solution", () => {
    const a = engine.analyzeLine("5x - 10 = 0", feedback);
    expect(a.verdict).toBe("none");
    expect(a.solutions).toEqual(["2"]);
  });
});

describe("equivalence: quadratics, cubics, roots", () => {
  it("x^2 - 5x + 6 = 0 -> (x-2)(x-3) = 0 -> x = 2, 3", () => {
    const [a1, a2, a3] = chain(["x^2 - 5x + 6 = 0", "(x - 2)(x - 3) = 0", "x = 2, 3"]);
    expect(a1.solutions?.slice().sort()).toEqual(["2", "3"]);
    expect(a2.verdict).toBe("ok");
    expect(a3.verdict).toBe("ok");
    expect(a3.solved).toBe(true);
  });
  it("x^2 = 4 -> x = \\pm 2 is solved; x = 2 alone drops a root", () => {
    const [, a2] = chain(["x^2 = 4", "x = \\pm 2"]);
    expect(a2.verdict).toBe("ok");
    expect(a2.solved).toBe(true);
    const [, b2] = chain(["x^2 = 4", "x = 2"]);
    expect(b2.verdict).toBe("mismatch");
  });
  it("x = 2 \\text{ or } x = -2 counts as a value list", () => {
    const [, a2] = chain(["x^2 - 4 = 0", "x = 2 \\text{ or } x = -2"]);
    expect(a2.verdict).toBe("ok");
    expect(a2.solved).toBe(true);
  });
  it("handles a cubic with integer roots", () => {
    const a = engine.analyzeLine("x^3 - 6x^2 + 11x - 6 = 0", feedback);
    expect(a.solutions?.map(Number).sort()).toEqual([1, 2, 3]);
  });
  it("fractions in the equation", () => {
    const [, a2] = chain(["\\frac{x}{2} + 1 = 4", "x = 6"]);
    expect(a2.verdict).toBe("ok");
    expect(a2.solved).toBe(true);
  });
  it("non-polynomial equations use numeric roots", () => {
    const [a1, a2] = chain(["2^x = 8", "x = 3"]);
    expect(a1.solutions).toEqual(["3"]);
    expect(a2.solved).toBe(true);
    const [, b2] = chain(["\\sqrt{x + 1} = 3", "x = 8"]);
    expect(b2.verdict).toBe("ok");
  });
  it("contradictions and identities", () => {
    const [, a2] = chain(["2x + 3 = 2x + 5", "3 = 5"]);
    expect(a2.kind).toBe("equation");
    expect(a2.verdict).toBe("mismatch"); // 3 = 5 is arithmetically false
    const [b1] = chain(["x + 1 = x + 1"]);
    expect(b1.kind).toBe("equation");
  });
});

describe("equivalence: inequalities, arithmetic, expressions", () => {
  it("inequality chain", () => {
    const [a1, a2, a3] = chain(["2x + 1 < 7", "2x < 6", "x < 3"]);
    expect(a1.kind).toBe("inequality");
    expect(a2.verdict).toBe("ok");
    expect(a3.verdict).toBe("ok");
    const [, b2] = chain(["2x + 1 < 7", "x > 3"]);
    expect(b2.verdict).toBe("mismatch");
    const [, c2] = chain(["-2x < 6", "x > -3"]);
    expect(c2.verdict).toBe("ok");
    const [, d2] = chain(["-2x < 6", "x < -3"]);
    expect(d2.verdict).toBe("mismatch");
  });
  it("numeric equations check the arithmetic", () => {
    expect(engine.analyzeLine("36 + 2 = 38", feedback).verdict).toBe("ok");
    const bad = engine.analyzeLine("36 + 2 = 39", feedback);
    expect(bad.verdict).toBe("mismatch");
    expect(bad.note).not.toMatch(/wrong|!/i);
    expect(engine.analyzeLine("\\frac{1}{2} + \\frac{1}{3} = \\frac{5}{6}", feedback).verdict).toBe("ok");
    expect(engine.analyzeLine("3 \\cdot 4 = 7 + 5 = 12", feedback).verdict).toBe("ok");
  });
  it("numeric inequalities", () => {
    expect(engine.analyzeLine("3 < 5", feedback).verdict).toBe("ok");
    expect(engine.analyzeLine("3 \\ge 5", feedback).verdict).toBe("mismatch");
  });
  it("symbolic expression chains compare by sampling", () => {
    const [a1, a2] = chain(["(x+1)(x-1)", "x^2 - 1"]);
    expect(a1.kind).toBe("expression");
    expect(a2.verdict).toBe("ok");
    const [, b2] = chain(["(x+1)(x-1)", "x^2 + 1"]);
    expect(b2.verdict).toBe("mismatch");
    const [, c2] = chain(["(x+1)(x-1)", "y^2 - 1"]);
    expect(c2.verdict).toBe("none");
  });
  it("numeric expression chains only ever say ok", () => {
    const [, a2] = chain(["3 \\cdot 40 + 2", "122"]);
    expect(a2.verdict).toBe("ok");
    const [, b2] = chain(["3 \\cdot 40 + 2", "123"]);
    expect(b2.verdict).toBe("none");
  });
  it("assignment chains compare values", () => {
    const [a1, a2] = chain(["F = 2 \\mathrm{~kg} \\cdot 9.8 \\mathrm{~m/s^2}", "F = 19.6 \\mathrm{~N}"]);
    expect(a1.kind).toBe("assignment");
    expect(a1.resultLatex).toBe("19.6\\,\\mathrm{N}");
    expect(a2.verdict).toBe("ok");
    const [, b2] = chain(["F = 2 \\mathrm{~kg} \\cdot 9.8 \\mathrm{~m/s^2}", "F = 19.6 \\mathrm{~J}"]);
    expect(b2.verdict).toBe("mismatch");
  });
});

describe("equivalence: rounding, approximations, identities", () => {
  it("accepts values rounded to the written precision", () => {
    const [, a2] = chain(["A = \\pi (3)^2", "A = 28.27"]);
    expect(a2.verdict).toBe("ok");
    const [, b2] = chain(["A = \\pi (3)^2", "A = 28.3"]);
    expect(b2.verdict).toBe("ok");
    const [, c2] = chain(["A = \\pi (3)^2", "A = 28.1"]);
    expect(c2.verdict).toBe("mismatch");
    const [, d2] = chain(["x^2 = 2", "x = \\pm 1.414"]);
    expect(d2.verdict).toBe("ok");
    expect(d2.solved).toBe(true);
  });
  it("\\approx compares loosely; = with decimals expects correct rounding", () => {
    expect(engine.analyzeLine("\\frac{2}{3} \\approx 0.67", feedback).verdict).toBe("ok");
    expect(engine.analyzeLine("\\frac{2}{3} = 0.67", feedback).verdict).toBe("ok");
    expect(engine.analyzeLine("\\frac{2}{3} = 0.6", feedback).verdict).toBe("mismatch");
    expect(engine.analyzeLine("\\frac{2}{3} \\approx 0.7", feedback).verdict).toBe("ok");
    expect(engine.analyzeLine("\\pi \\approx 3.14", feedback).verdict).toBe("ok");
    expect(engine.analyzeLine("\\pi = 3", feedback).verdict).toBe("mismatch");
  });
  it("identities are ok on their own; derivative claims are checked", () => {
    expect(engine.analyzeLine("\\sin^{2} \\theta + \\cos^{2} \\theta = 1", feedback).verdict).toBe("ok");
    expect(engine.analyzeLine("(x+1)(x-1) = x^2 - 1", feedback).verdict).toBe("ok");
    expect(engine.analyzeLine("\\frac{d}{dx}\\left(x^{2}\\right) = 2x", feedback).verdict).toBe("ok");
    expect(engine.analyzeLine("\\frac{d}{dx}\\left(x^{2}\\right) = x", feedback).verdict).toBe("mismatch");
    expect(engine.analyzeLine("\\frac{d}{dx}\\left(a x^{2}\\right) = 2 a x", feedback).verdict).toBe("ok");
    expect(engine.analyzeLine("\\frac{d}{dx}\\left(a x^{2}\\right) = a x", feedback).verdict).toBe("mismatch");
    expect(engine.analyzeLine("\\int_0^1 x^2 \\, dx = \\frac{1}{3}", feedback).verdict).toBe("ok");
    const [, a2] = chain(["\\frac{d}{dx} x^3 = 3x^2", "\\frac{d}{dx}\\left(x^{2}\\right) = 3x"]);
    expect(a2.verdict).toBe("mismatch");
  });
  it("\\pm answers keep both roots in `math` for the next line", () => {
    const [, a2, a3] = chain(["x^2 + 3x - 10 = 0", "x = \\frac{-3 \\pm \\sqrt{9 + 40}}{2}", "x = 2 \\quad x = -5"]);
    expect(a2.verdict).toBe("ok");
    expect(a2.solved).toBe(true);
    expect(a2.math).toContain("(x - (2))");
    expect(a3.verdict).toBe("ok");
    expect(a3.solved).toBe(true);
  });
  it("function evaluations like f(2) = 4 are left to the LLM", () => {
    const a = engine.analyzeLine("f(2) = 4", feedback);
    expect(a.kind).toBe("equation");
    expect(a.verdict).toBe("unknown");
  });
  it("ignores decorations such as \\checkmark and \\therefore", () => {
    const [, a2] = chain(["2x = 8", "\\therefore x = 4 \\checkmark"]);
    expect(a2.verdict).toBe("ok");
    expect(a2.solved).toBe(true);
  });
});
