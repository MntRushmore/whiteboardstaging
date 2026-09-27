import { beforeAll, describe, expect, it } from "vitest";
import type { LineAnalysis, LiveEngine } from "../../contracts";
import { planHandwriting } from "../../handwriting";
import { localAnswerStep } from "../../solveSteps";
import { getEngine } from "..";

/**
 * The algebra of a strong high-school student (`advanced.ts` and the solvers it routes to):
 * quadratics, absolute value, rational, radical, exponential and log equations, factoring,
 * and linear systems by elimination — every step a line of maths a teacher writes, exact, no
 * words (several answers are `x = 2, \ x = 3`), and every line drawable by the tutor's hand.
 */

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

const solve = (latex: string) => engine.solveLatex(latex)?.steps ?? null;
const simplify = (latex: string) => engine.simplifySteps!(latex);
const system = (lines: string[]) => engine.solveFromLines!(lines);

describe("quadratics: standard form, factor, or the formula with the values in", () => {
  it.each([
    ["x^2-5x+6=0", ["(x - 2)(x - 3) = 0", "x = 2, \\ x = 3"]],
    ["x(x+1)=12", ["x^{2} + x = 12", "x^{2} + x - 12 = 0", "(x + 4)(x - 3) = 0", "x = -4, \\ x = 3"]],
    ["x^2+4x=5", ["x^{2} + 4x - 5 = 0", "(x + 5)(x - 1) = 0", "x = -5, \\ x = 1"]],
    ["x^2=2x", ["x^{2} - 2x = 0", "x(x - 2) = 0", "x = 0, \\ x = 2"]],
    ["2x^2+3x-2=0", ["(x + 2)(2x - 1) = 0", "x = -2, \\ x = \\frac{1}{2}"]],
    ["2x^2-10x+12=0", ["x^{2} - 5x + 6 = 0", "(x - 2)(x - 3) = 0", "x = 2, \\ x = 3"]],
    ["-x^2+5x-6=0", ["x^{2} - 5x + 6 = 0", "(x - 2)(x - 3) = 0", "x = 2, \\ x = 3"]],
    ["\\frac{x^2}{2}-x=4", ["x^{2} - 2x = 8", "x^{2} - 2x - 8 = 0", "(x + 2)(x - 4) = 0", "x = -2, \\ x = 4"]],
    // a double root once
    ["x^2-6x+9=0", ["(x - 3)^{2} = 0", "x = 3"]],
    ["4x^2-12x+9=0", ["(2x - 3)^{2} = 0", "x = \\frac{3}{2}"]],
    // the formula, the surd simplified, the fraction reduced
    [
      "x^2-2x-1=0",
      [
        "x = \\frac{2 \\pm \\sqrt{(-2)^{2} - 4 \\cdot 1 \\cdot (-1)}}{2 \\cdot 1}",
        "x = \\frac{2 \\pm \\sqrt{8}}{2}",
        "x = \\frac{2 \\pm 2\\sqrt{2}}{2}",
        "x = 1 \\pm \\sqrt{2}",
      ],
    ],
    [
      "2x^2-4x-1=0",
      [
        "x = \\frac{4 \\pm \\sqrt{(-4)^{2} - 4 \\cdot 2 \\cdot (-1)}}{2 \\cdot 2}",
        "x = \\frac{4 \\pm \\sqrt{24}}{4}",
        "x = \\frac{4 \\pm 2\\sqrt{6}}{4}",
        "x = \\frac{2 \\pm \\sqrt{6}}{2}",
      ],
    ],
    ["x^2-3x+1=0", ["x = \\frac{3 \\pm \\sqrt{(-3)^{2} - 4 \\cdot 1 \\cdot 1}}{2 \\cdot 1}", "x = \\frac{3 \\pm \\sqrt{5}}{2}"]],
    // no real roots: the negative number under the root, then the empty set
    ["x^2+x+1=0", ["x = \\frac{-1 \\pm \\sqrt{1^{2} - 4 \\cdot 1 \\cdot 1}}{2 \\cdot 1}", "x = \\frac{-1 \\pm \\sqrt{-3}}{2}", "\\varnothing"]],
    // ax^2 + c = 0 by square roots
    ["2x^2-18=0", ["2x^{2} = 18", "x^{2} = 9", "x = \\pm 3"]],
    ["x^2=8", ["x = \\pm \\sqrt{8}", "x = \\pm 2\\sqrt{2}"]],
    ["x^2+1=0", ["x^{2} = -1", "\\varnothing"]],
  ])("%s", (latex, steps) => {
    expect(solve(latex)).toEqual(steps);
  });

  it.each([
    // the line is already (x + a)^2 = b: completing the square's last steps
    ["(x+3)^2=16", ["x + 3 = \\pm 4", "x = -3 \\pm 4", "x = -7, \\ x = 1"]],
    ["(x-1)^2=2", ["x - 1 = \\pm \\sqrt{2}", "x = 1 \\pm \\sqrt{2}"]],
    ["2(x-1)^2-8=0", ["2(x - 1)^{2} = 8", "(x - 1)^{2} = 4", "x - 1 = \\pm 2", "x = 1 \\pm 2", "x = -1, \\ x = 3"]],
    ["(2x-1)^2=5", ["2x - 1 = \\pm \\sqrt{5}", "2x = 1 \\pm \\sqrt{5}", "x = \\frac{1 \\pm \\sqrt{5}}{2}"]],
    // a product equal to zero is split, never expanded
    ["(x-2)(x+3)=0", ["x - 2 = 0, \\ x + 3 = 0", "x = 2, \\ x = -3"]],
    ["2x(x+1)(x-4)=0", ["x = 0, \\ x + 1 = 0, \\ x - 4 = 0", "x = 0, \\ x = -1, \\ x = 4"]],
  ])("square and product forms: %s", (latex, steps) => {
    expect(solve(latex)).toEqual(steps);
  });

  it.each([
    ["x^3-6x^2+11x-6=0", ["(x - 1)(x^{2} - 5x + 6) = 0", "(x - 1)(x - 2)(x - 3) = 0", "x = 1, \\ x = 2, \\ x = 3"]],
    ["x^3-4x=0", ["x(x^{2} - 4) = 0", "x(x + 2)(x - 2) = 0", "x = -2, \\ x = 0, \\ x = 2"]],
    ["x^4-5x^2+4=0", ["(x^{2} - 1)(x^{2} - 4) = 0", "(x + 2)(x + 1)(x - 1)(x - 2) = 0", "x = -2, \\ x = -1, \\ x = 1, \\ x = 2"]],
    ["x^3=8", ["x = \\sqrt[3]{8}", "x = 2"]],
  ])("cubics and quartics that factor: %s", (latex, steps) => {
    expect(solve(latex)).toEqual(steps);
  });

  it("the answer line carries no words", () => {
    expect(engine.solveLatex("x^2-5x+6=0")?.latex).toBe("x = 2, \\ x = 3");
    expect(engine.solveLatex("x^2-2x-1=0")?.latex).toBe("x = 1 \\pm \\sqrt{2}");
    expect(engine.solveLatex("x^2+x+1=0")?.latex).toBe("\\varnothing");
    for (const latex of ["x^2-5x+6=0", "x^3-6x^2+11x-6=0", "0.5x^2+x-2=0", "x^3+x-1=0"]) {
      expect(engine.solveLatex(latex)?.latex ?? "").not.toMatch(/\\text|\bor\b/);
    }
  });
});

describe("absolute value: isolate the bars, then split", () => {
  it.each([
    ["|2x-3|=5", ["2x - 3 = 5, \\ 2x - 3 = -5", "2x = 8, \\ 2x = -2", "x = 4, \\ x = -1"]],
    // Mathpix's three spellings of the bars
    ["\\lvert x - 1 \\rvert = 2", ["x - 1 = 2, \\ x - 1 = -2", "x = 3, \\ x = -1"]],
    ["\\left|x-1\\right|=2", ["x - 1 = 2, \\ x - 1 = -2", "x = 3, \\ x = -1"]],
    ["2|x-1|+3=7", ["2|x - 1| = 4", "|x - 1| = 2", "x - 1 = 2, \\ x - 1 = -2", "x = 3, \\ x = -1"]],
    ["|x|=3", ["x = \\pm 3"]],
    ["|x-1|=-2", ["\\varnothing"]],
    ["|x+2|=0", ["x + 2 = 0", "x = -2"]],
    // against an expression in x: the root that makes that side negative fails its check
    ["|x-1|=2x+1", ["x - 1 = 2x + 1, \\ x - 1 = -(2x + 1)", "x - 2x = 1 + 1, \\ x - 1 = -2x - 1", "-x = 2, \\ x + 2x = -1 + 1", "x = -2, \\ 3x = 0", "x = -2, \\ x = 0", "|-3| \\neq -3", "x = 0"]],
  ])("%s", (latex, steps) => {
    expect(solve(latex)).toEqual(steps);
  });

  it.each([
    ["\\left|x-1\\right|<3", ["-3 < x - 1 < 3", "-2 < x < 4"]],
    ["|2x-3| < 5", ["-5 < 2x - 3 < 5", "-2 < 2x < 8", "-1 < x < 4"]],
    ["|x| \\le 5", ["-5 \\le x \\le 5"]],
    ["|2x+1| \\ge 5", ["2x + 1 \\le -5, \\ 2x + 1 \\ge 5", "2x \\le -6, \\ 2x \\ge 4", "x \\le -3, \\ x \\ge 2"]],
    ["|x| > 2", ["x < -2, \\ x > 2"]],
    ["|x-3| > 0", ["x - 3 \\neq 0", "x \\neq 3"]],
    ["|x| \\ge -1", ["-\\infty < x < \\infty"]],
    ["|x-1| < -2", ["\\varnothing"]],
  ])("inequality %s", (latex, steps) => {
    expect(solve(latex)).toEqual(steps);
  });
});

describe("inequalities past linear: critical values, then the intervals (inequality.ts)", () => {
  it.each([
    // quadratic: factor, the critical values, the sign between them
    ["x^{2} - 4 < 0", ["(x + 2)(x - 2) < 0", "x = -2, \\ x = 2", "-2 < x < 2"]],
    ["x^2-5x+6>0", ["(x - 2)(x - 3) > 0", "x = 2, \\ x = 3", "x < 2, \\ x > 3"]],
    ["x^2-5x+6 \\le 0", ["(x - 2)(x - 3) \\le 0", "x = 2, \\ x = 3", "2 \\le x \\le 3"]],
    ["x^2 < 9", ["x^{2} - 9 < 0", "(x + 3)(x - 3) < 0", "x = -3, \\ x = 3", "-3 < x < 3"]],
    // a negative leading coefficient: every term to the other side, the sign turned round
    ["4 - x^2 > 0", ["x^{2} - 4 < 0", "(x + 2)(x - 2) < 0", "x = -2, \\ x = 2", "-2 < x < 2"]],
    ["2x^2-8 \\ge 0", ["x^{2} - 4 \\ge 0", "(x + 2)(x - 2) \\ge 0", "x = -2, \\ x = 2", "x \\le -2, \\ x \\ge 2"]],
    ["x(x+1) \\ge 6", ["x^{2} + x \\ge 6", "x^{2} + x - 6 \\ge 0", "(x + 3)(x - 2) \\ge 0", "x = -3, \\ x = 2", "x \\le -3, \\ x \\ge 2"]],
    // no rational roots: the equation by the formula
    [
      "x^2-2x-1<0",
      ["x^{2} - 2x - 1 = 0", "x = \\frac{2 \\pm \\sqrt{(-2)^{2} - 4 \\cdot 1 \\cdot (-1)}}{2 \\cdot 1}", "x = \\frac{2 \\pm \\sqrt{8}}{2}", "x = \\frac{2 \\pm 2\\sqrt{2}}{2}", "x = 1 \\pm \\sqrt{2}", "1 - \\sqrt{2} < x < 1 + \\sqrt{2}"],
    ],
    ["x^2+1>0", ["x^{2} + 1 = 0", "x^{2} = -1", "-\\infty < x < \\infty"]],
    ["x^2+x+1<0", ["x^{2} + x + 1 = 0", "x = \\frac{-1 \\pm \\sqrt{1^{2} - 4 \\cdot 1 \\cdot 1}}{2 \\cdot 1}", "x = \\frac{-1 \\pm \\sqrt{-3}}{2}", "\\varnothing"]],
    // already factored: straight to the critical values; a double root
    ["(x-1)^2 > 0", ["x = 1", "x \\neq 1"]],
    ["(x-1)^2 \\le 0", ["x = 1"]],
    ["x^3-x>0", ["x(x + 1)(x - 1) > 0", "x = -1, \\ x = 0, \\ x = 1", "-1 < x < 0, \\ x > 1"]],
    // one fraction: times the denominator squared, its zero excluded
    ["\\frac{x-1}{x+2} > 0", ["x \\neq -2", "(x + 2)(x - 1) > 0", "x = -2, \\ x = 1", "x < -2, \\ x > 1"]],
    ["\\frac{3-x}{x+1} \\ge 0", ["x \\neq -1", "(x + 1)(x - 3) \\le 0", "x = -1, \\ x = 3", "-1 < x \\le 3"]],
    [
      "\\frac{x+1}{x-3} \\le 2",
      ["x \\neq 3", "(x + 1)(x - 3) \\le 2(x - 3)^{2}", "x^{2} - 2x - 3 \\le 2x^{2} - 12x + 18", "x^{2} - 10x + 21 \\ge 0", "(x - 3)(x - 7) \\ge 0", "x = 3, \\ x = 7", "x < 3, \\ x \\ge 7"],
    ],
    ["\\frac{1}{x} > 2", ["x \\neq 0", "x > 2x^{2}", "2x^{2} - x < 0", "x(2x - 1) < 0", "x = 0, \\ x = \\frac{1}{2}", "0 < x < \\frac{1}{2}"]],
  ])("%s", (latex, steps) => {
    expect(solve(latex)).toEqual(steps);
  });

  it.each([
    ["-3 < 2x + 1 < 7", ["-4 < 2x < 6", "-2 < x < 3"]],
    // dividing by a negative turns the chain round
    ["1 \\le 3 - 2x < 7", ["-2 \\le -2x < 4", "-2 < x \\le 1"]],
    ["7 > 2x + 1 > -3", ["-3 < 2x + 1 < 7", "-4 < 2x < 6", "-2 < x < 3"]],
    ["-1 < \\frac{x - 1}{2} \\le 3", ["-2 < x - 1 \\le 6", "-1 < x \\le 7"]],
    ["5 < 2x < 3", ["\\frac{5}{2} < x < \\frac{3}{2}", "\\varnothing"]],
  ])("a chain: %s", (latex, steps) => {
    expect(solve(latex)).toEqual(steps);
  });

  it("the answer line is the last step", () => {
    expect(engine.solveLatex("x^2-5x+6>0")?.latex).toBe("x < 2, \\ x > 3");
    expect(engine.solveLatex("-3 < 2x + 1 < 7")?.latex).toBe("-2 < x < 3");
  });
});

describe("rational equations: exclusions, the LCD shown, the extraneous root dropped", () => {
  it.each([
    [
      "\\frac{1}{x}+\\frac{1}{2}=\\frac{3}{4}",
      ["x \\neq 0", "4x \\cdot \\frac{1}{x} + 4x \\cdot \\frac{1}{2} = 4x \\cdot \\frac{3}{4}", "4 + 2x = 3x", "2x - 3x = -4", "-x = -4", "x = 4"],
    ],
    [
      "\\frac{3}{x}+\\frac{2}{x-2}=1",
      [
        "x \\neq 0, \\ x \\neq 2",
        "x(x - 2) \\cdot \\frac{3}{x} + x(x - 2) \\cdot \\frac{2}{x - 2} = x(x - 2) \\cdot 1",
        "3(x - 2) + 2x = x(x - 2)",
        "3x - 6 + 2x = x^{2} - 2x",
        "x^{2} - 7x + 6 = 0",
        "(x - 1)(x - 6) = 0",
        "x = 1, \\ x = 6",
      ],
    ],
    ["\\frac{x}{x-1}=\\frac{1}{x-1}", ["x \\neq 1", "(x - 1) \\cdot \\frac{x}{x - 1} = (x - 1) \\cdot \\frac{1}{x - 1}", "x = 1", "\\varnothing"]],
    ["\\frac{x+1}{x-2}=3", ["x \\neq 2", "(x - 2) \\cdot \\frac{x + 1}{x - 2} = (x - 2) \\cdot 3", "x + 1 = 3(x - 2)", "x + 1 = 3x - 6", "x - 3x = -6 - 1", "-2x = -7", "x = \\frac{7}{2}"]],
    [
      "\\frac{2}{x+1}+\\frac{1}{x-1}=\\frac{4}{x^2-1}",
      [
        "x \\neq -1, \\ x \\neq 1",
        "(x + 1)(x - 1) \\cdot \\frac{2}{x + 1} + (x + 1)(x - 1) \\cdot \\frac{1}{x - 1} = (x + 1)(x - 1) \\cdot \\frac{4}{x^{2} - 1}",
        "2(x - 1) + (x + 1) = 4",
        "2x - 2 + x + 1 = 4",
        "3x - 1 = 4",
        "3x = 5",
        "x = \\frac{5}{3}",
      ],
    ],
    ["\\frac{1}{x}=x", ["x \\neq 0", "x \\cdot \\frac{1}{x} = x \\cdot x", "1 = x^{2}", "x^{2} = 1", "x = \\pm 1"]],
  ])("%s", (latex, steps) => {
    expect(solve(latex)).toEqual(steps);
  });
});

describe("radical equations: isolate, square, solve, check", () => {
  it.each([
    ["\\sqrt{x+2}=x", ["x + 2 = x^{2}", "x^{2} - x - 2 = 0", "(x + 1)(x - 2) = 0", "x = -1, \\ x = 2", "\\sqrt{1} \\neq -1", "x = 2"]],
    [
      "\\sqrt{x+3}+3=x",
      ["\\sqrt{x + 3} = x - 3", "x + 3 = (x - 3)^{2}", "x + 3 = x^{2} - 6x + 9", "x^{2} - 7x + 6 = 0", "(x - 1)(x - 6) = 0", "x = 1, \\ x = 6", "\\sqrt{4} \\neq -2", "x = 6"],
    ],
    ["2\\sqrt{x+1}=x-2", ["4(x + 1) = (x - 2)^{2}", "4x + 4 = x^{2} - 4x + 4", "x^{2} - 8x = 0", "x(x - 8) = 0", "x = 0, \\ x = 8", "2\\sqrt{1} \\neq -2", "x = 8"]],
    ["\\sqrt{x-5}+2=6", ["\\sqrt{x - 5} = 4", "x - 5 = 16", "x = 21"]],
    ["\\sqrt{2x+1}=\\sqrt{x+4}", ["2x + 1 = x + 4", "2x - x = 4 - 1", "x = 3"]],
    ["\\sqrt[3]{x+1}=2", ["x + 1 = 8", "x = 7"]],
    ["\\sqrt{x}=-2", ["\\varnothing"]],
  ])("%s", (latex, steps) => {
    expect(solve(latex)).toEqual(steps);
  });
});

describe("exponential and log equations: exact answers", () => {
  it.each([
    ["2^x=8", ["2^{x} = 2^{3}", "x = 3"]],
    ["3^{x+1}=27", ["3^{x + 1} = 3^{3}", "x + 1 = 3", "x = 2"]],
    ["4^x=8", ["\\left(2^{2}\\right)^{x} = 2^{3}", "2^{2x} = 2^{3}", "2x = 3", "x = \\frac{3}{2}"]],
    ["2^{x}=\\frac{1}{8}", ["2^{x} = 2^{-3}", "x = -3"]],
    ["2\\cdot3^x=18", ["3^{x} = 9", "3^{x} = 3^{2}", "x = 2"]],
    ["2^{x+1}=4^x", ["2^{x + 1} = 2^{2x}", "x + 1 = 2x", "x - 2x = -1", "-x = -1", "x = 1"]],
    ["e^x=5", ["x = \\ln 5"]],
    ["5^x=7", ["x = \\log_{5} 7"]],
    ["e^{2x}=7", ["2x = \\ln 7", "x = \\frac{\\ln 7}{2}"]],
    ["3^{2x-1}=5", ["2x - 1 = \\log_{3} 5", "2x = \\log_{3} 5 + 1", "x = \\frac{\\log_{3} 5 + 1}{2}"]],
    ["2^x=-8", ["\\varnothing"]],
  ])("%s", (latex, steps) => {
    expect(solve(latex)).toEqual(steps);
  });

  it.each([
    ["\\log_2 x=5", ["x = 2^{5}", "x = 32"]],
    ["\\log_{3}(2x+1)=2", ["2x + 1 = 3^{2}", "2x + 1 = 9", "2x = 8", "x = 4"]],
    ["\\log x=2", ["x = 10^{2}", "x = 100"]],
    ["\\ln x=2", ["x = e^{2}"]],
    ["\\ln(x+1)=1", ["x + 1 = e", "x = e - 1"]],
    ["\\log_2(x)=-1", ["x = 2^{-1}", "x = \\frac{1}{2}"]],
    ["2\\log_3 x=4", ["\\log_{3} x = 2", "x = 3^{2}", "x = 9"]],
    [
      "\\log x+\\log(x-3)=1",
      ["x > 3", "\\log(x(x - 3)) = 1", "x(x - 3) = 10^{1}", "x^{2} - 3x = 10", "x^{2} - 3x - 10 = 0", "(x + 2)(x - 5) = 0", "x = -2, \\ x = 5", "x = 5"],
    ],
    ["\\log_2 x - \\log_2(x-2) = 1", ["x > 2", "\\log_{2} \\frac{x}{x - 2} = 1", "\\frac{x}{x - 2} = 2^{1}", "x = 2(x - 2)", "x = 2x - 4", "x - 2x = -4", "-x = -4", "x = 4"]],
    ["\\log_2(x+3)=\\log_2(2x)", ["x + 3 = 2x", "x - 2x = -3", "-x = -3", "x = 3"]],
  ])("%s", (latex, steps) => {
    expect(solve(latex)).toEqual(steps);
  });
});

describe("polynomials: simplify when there is something to expand, otherwise factor", () => {
  it.each([
    ["(x+2)(x-3)", ["x^{2} - 3x + 2x - 6", "x^{2} - x - 6"]],
    ["(x+1)^2", ["x^{2} + 2x + 1"]],
    ["6x^2+9x", ["3x(2x + 3)"]],
    ["2x+4", ["2(x + 2)"]],
    ["x^2-9", ["(x + 3)(x - 3)"]],
    ["2x^2-18", ["2(x^{2} - 9)", "2(x + 3)(x - 3)"]],
    ["x^2-x-6", ["(x + 2)(x - 3)"]],
    ["x^2+6x+9", ["(x + 3)^{2}"]],
    ["2x^2+7x+3", ["2x^{2} + 6x + x + 3", "2x(x + 3) + (x + 3)", "(x + 3)(2x + 1)"]],
    ["6x^2-x-2", ["6x^{2} + 3x - 4x - 2", "3x(2x + 1) - 2(2x + 1)", "(2x + 1)(3x - 2)"]],
    ["-x^2+5x-6", ["-(x^{2} - 5x + 6)", "-(x - 2)(x - 3)"]],
    ["x^3+2x^2+3x+6", ["x^{2}(x + 2) + 3(x + 2)", "(x + 2)(x^{2} + 3)"]],
    ["x^3-8", ["(x - 2)(x^{2} + 2x + 4)"]],
    ["8x^3+27", ["(2x + 3)(4x^{2} - 6x + 9)"]],
    ["x^3-6x^2+11x-6", ["(x - 1)(x^{2} - 5x + 6)", "(x - 1)(x - 2)(x - 3)"]],
    ["x^4-16", ["(x^{2} + 4)(x^{2} - 4)", "(x + 2)(x - 2)(x^{2} + 4)"]],
    ["x^2-y^2", ["(x + y)(x - y)"]],
    ["6xy+9x", ["3x(2y + 3)"]],
    ["x^2-5x+6=", ["(x - 2)(x - 3)"]],
  ])("%s", (latex, steps) => {
    expect(simplify(latex)).toEqual(steps);
  });

  it("writes nothing for what does not factor over the integers, or is not algebra", () => {
    for (const latex of ["2x + 3", "x^2 + 1", "x^2 + x + 1", "36 + 2 =", "x", "\\frac{x}{2} + 1", "\\sin(x) + x"]) expect(simplify(latex), latex).toBeNull();
  });
});

describe("systems: elimination where substitution would bring fractions, and three unknowns", () => {
  it("two equations with no ±1 coefficient: the multiplied equations, the eliminated one, back-substitution", () => {
    const r = system(["3x+2y=16", "2x+3y=14"]);
    expect(r?.steps).toEqual(["9x + 6y = 48", "4x + 6y = 28", "5x = 20", "x = 4", "3(4)+2y=16", "12 + 2y = 16", "2y = 4", "y = 2"]);
    expect(r?.latex).toBe("x = 4");
    expect(system(["2x+3y=7", "5x-2y=8"])?.steps).toEqual(["4x + 6y = 14", "15x - 6y = 24", "19x = 38", "x = 2", "2(2)+3y=7", "4 + 3y = 7", "3y = 3", "y = 1"]);
  });

  it("the unknown asked for is solved first", () => {
    const r = system(["2x+3y=7", "5x-2y=8", "y=?"]);
    expect(r?.steps.slice(0, 4)).toEqual(["10x + 15y = 35", "10x - 4y = 16", "19y = 19", "y = 1"]);
    expect(r?.latex).toBe("y = 1");
  });

  it("keeps substitution where it writes no fractions (a coefficient ±1)", () => {
    expect(system(["x+y=18", "x-y=4", "x=?"])?.steps).toEqual(["y = 18 - x", "x-(18 - x)=4", "x - 18 + x = 4", "2x - 18 = 4", "2x = 22", "x = 11", "y = 18 - 11", "y = 7"]);
    expect(system(["2x+3y=12", "x-y=1"])?.steps[0]).toBe("y = x - 1");
  });

  it("three equations in three unknowns: the eliminated equations, then the values", () => {
    const r = system(["x+y+z=6", "2x-y+z=3", "x+2y-z=2"]);
    expect(r?.steps).toEqual(["x - 2y = -3", "2x + 3y = 8", "2x - 4y = -6", "7y = 14", "y = 2", "x - 2(2) = -3", "x = 1", "z = 3"]);
    expect(r?.latex).toBe("x = 1, \\ y = 2, \\ z = 3");
    const s = system(["x+y=3", "y+z=5", "x+z=4"]);
    expect(s?.steps).toEqual(["x - y = -1", "2x = 2", "x = 1", "1+y=3", "y = 2", "2+z=5", "z = 3"]);
    expect(system(["x+2y+3z=14", "2x+y+z=7", "3x+2y+z=10"])?.latex).toBe("x = 1, \\ y = 2, \\ z = 3");
  });

  it("stays within the block and refuses what it cannot do", () => {
    const r = system(["2x+3y-z=5", "x-y+2z=3", "3x+y+z=10"]);
    expect(r?.steps.length).toBeLessThanOrEqual(8);
    expect(r?.latex).toBe("x = \\frac{23}{5}, \\ y = -2, \\ z = -\\frac{9}{5}");
    expect(system(["x+y+z=6", "2x+2y+2z=12", "x-y=0"])).toBeNull(); // not independent
    expect(system(["x^2+y+z=6", "x+y=1", "y+z=2"])).toBeNull(); // not linear
  });
});

describe("checking the student's own lines in these topics", () => {
  const chain = (lines: string[]): LineAnalysis[] => {
    const out: LineAnalysis[] = [];
    let original: LineAnalysis | undefined;
    for (const line of lines) {
      const a = engine.analyzeLine(line, { previous: out.at(-1), original, mode: "feedback" });
      out.push(a);
      if (!original && (a.kind === "equation" || a.kind === "inequality")) original = a;
    }
    return out;
  };
  const verdicts = (lines: string[]) => chain(lines).map((a) => a.verdict);

  it("a correct factoring line is ok, a wrong one a mismatch", () => {
    expect(verdicts(["x^2-5x+6=0", "(x-2)(x-3)=0", "x = 2, \\ x = 3"])).toEqual(["none", "ok", "ok"]);
    expect(verdicts(["x^2-5x+6=0", "(x-2)(x+3)=0"])).toEqual(["none", "mismatch"]);
    expect(verdicts(["x^2 - 2x - 1 = 0", "x = 1 \\pm \\sqrt{2}"])).toEqual(["none", "ok"]);
    expect(verdicts(["x^2 - 2x - 1 = 0", "x = 1 \\pm \\sqrt{3}"])).toEqual(["none", "mismatch"]);
  });

  it("reads the tutor's own answer lines back (`x = 2, \\ x = 3`)", () => {
    const [, a] = chain(["x^2-5x+6=0", "x = 2, \\ x = 3"]);
    expect(a.verdict).toBe("ok");
    expect(a.solved).toBe(true);
  });

  it("squaring may add a root: the squared line is right, the extraneous root dropped is right", () => {
    expect(verdicts(["\\sqrt{x+2} = x", "x + 2 = x^2", "(x-2)(x+1) = 0", "x = -1, \\ x = 2", "x = 2"])).toEqual(["none", "ok", "ok", "ok", "ok"]);
    expect(chain(["\\sqrt{x+2} = x", "x + 2 = x^2", "x = 2"]).at(-1)?.solved).toBe(true);
    // a wrong squaring is still wrong
    expect(verdicts(["\\sqrt{x+2} = x", "x + 2 = x^2 + 1"])).toEqual(["none", "mismatch"]);
  });

  it("a log's invalid root dropped is right; the wrong root kept is not solved", () => {
    const lines = ["\\log x + \\log(x-3) = 1", "\\log(x(x-3)) = 1", "x(x-3) = 10", "x^2 - 3x - 10 = 0", "x = -2, \\ x = 5", "x = 5"];
    const a = chain(lines);
    expect(a.map((x) => x.verdict)).toEqual(["none", "ok", "ok", "ok", "ok", "ok"]);
    expect(a[4].solved).toBe(false);
    expect(a[5].solved).toBe(true);
  });

  it("absolute value: the split on one line, a branch on its own line, a wrong split", () => {
    expect(verdicts(["|2x-3| = 5", "2x - 3 = 5, \\ 2x - 3 = -5", "2x = 8, \\ 2x = -2", "x = 4, \\ x = -1"])).toEqual(["none", "ok", "ok", "ok"]);
    expect(verdicts(["|2x-3| = 5", "2x - 3 = 5", "2x = 8", "x = 4", "2x - 3 = -5"])).toEqual(["none", "ok", "ok", "ok", "ok"]);
    expect(verdicts(["|2x-3| = 5", "2x - 3 = 5, \\ 2x - 3 = 5"])).toEqual(["none", "mismatch"]);
    expect(verdicts(["|2x-3| = 5", "2x - 3 = 5, \\ 2x - 3 = -2"])).toEqual(["none", "mismatch"]);
  });

  it("absolute value inequalities: the chain and the union", () => {
    expect(verdicts(["|x-1| < 3", "-3 < x - 1 < 3", "-2 < x < 4"])).toEqual(["none", "ok", "ok"]);
    expect(verdicts(["|x-1| < 3", "-3 < x - 1 < 3", "-2 < x < 3"])).toEqual(["none", "ok", "mismatch"]);
    expect(verdicts(["|2x+1| \\ge 5", "2x + 1 \\le -5, \\ 2x + 1 \\ge 5", "x \\le -3, \\ x \\ge 2"])).toEqual(["none", "ok", "ok"]);
    expect(verdicts(["|2x+1| \\ge 5", "x \\le -3, \\ x \\ge 3"])).toEqual(["none", "mismatch"]);
  });

  it("exponential and rational steps by their roots", () => {
    expect(verdicts(["2^x = 8", "2^x = 2^3", "x = 3"])).toEqual(["none", "ok", "ok"]);
    expect(verdicts(["2^x = 8", "x = 4"])).toEqual(["none", "mismatch"]);
    expect(verdicts(["\\frac{1}{x}+\\frac{1}{2}=\\frac{3}{4}", "4 + 2x = 3x", "x = 4"])).toEqual(["none", "ok", "ok"]);
    expect(verdicts(["\\frac{1}{x}+\\frac{1}{2}=\\frac{3}{4}", "4 + x = 3x"])).toEqual(["none", "mismatch"]);
  });
});

/** Every step must be drawable by the tutor's hand: no `unsupported`. */
function expectDrawable(steps: readonly string[]): void {
  for (const step of steps) {
    const { unsupported } = planHandwriting([step], { size: 28, seed: 1 });
    expect(unsupported, step).toEqual([]);
  }
  const { plan, unsupported } = planHandwriting(steps, { size: 28, seed: 1 });
  expect(unsupported).toEqual([]);
  expect(plan).not.toBeNull();
}

describe("the hand can write every step", () => {
  const equations = [
    "x^2-5x+6=0",
    "x(x+1)=12",
    "2x^2+3x-2=0",
    "x^2-6x+9=0",
    "x^2-2x-1=0",
    "2x^2-4x-1=0",
    "x^2+x+1=0",
    "2x^2-18=0",
    "x^2=8",
    "(x+3)^2=16",
    "(2x-1)^2=5",
    "(x-2)(x+3)=0",
    "x^3-6x^2+11x-6=0",
    "x^4-5x^2+4=0",
    "x^3=8",
    "|2x-3|=5",
    "\\lvert x - 1 \\rvert = 2",
    "|x-1|=2x+1",
    "\\left|x-1\\right|<3",
    "|2x+1| \\ge 5",
    "|x-3| > 0",
    "|x| \\ge -1",
    "x^2-5x+6>0",
    "x^2-2x-1<0",
    "x^3-x>0",
    "\\frac{x+1}{x-3} \\le 2",
    "\\frac{3-x}{x+1} \\ge 0",
    "1 \\le 3 - 2x < 7",
    "(x-1)^2 > 0",
    "\\frac{1}{x}+\\frac{1}{2}=\\frac{3}{4}",
    "\\frac{3}{x}+\\frac{2}{x-2}=1",
    "\\frac{x}{x-1}=\\frac{1}{x-1}",
    "\\sqrt{x+2}=x",
    "\\sqrt{x+3}+3=x",
    "2\\sqrt{x+1}=x-2",
    "\\sqrt[3]{x+1}=2",
    "2^x=8",
    "4^x=8",
    "e^x=5",
    "5^x=7",
    "3^{2x-1}=5",
    "\\log_2 x=5",
    "\\ln(x+1)=1",
    "\\log x+\\log(x-3)=1",
    "\\log_2 x - \\log_2(x-2) = 1",
  ];
  it.each(equations)("solveLatex(%s)", (latex) => {
    const r = engine.solveLatex(latex);
    expect(r).not.toBeNull();
    expect(r!.steps.length).toBeLessThanOrEqual(8);
    expectDrawable(r!.steps);
  });

  const expressions = ["6x^2+9x", "2x^2+7x+3", "x^3+2x^2+3x+6", "x^3-8", "x^4-16", "x^2-y^2", "-x^2+5x-6"];
  it.each(expressions)("simplifySteps(%s), as written under the line", (latex) => {
    expectDrawable(simplify(latex)!.map(localAnswerStep));
  });

  const systems = [
    ["3x+2y=16", "2x+3y=14"],
    ["2x+3y=7", "5x-2y=8", "y=?"],
    ["x+y+z=6", "2x-y+z=3", "x+2y-z=2"],
    ["2x+3y-z=5", "x-y+2z=3", "3x+y+z=10"],
  ];
  it.each(systems)("solveFromLines(%s | %s | …)", (...lines) => {
    expectDrawable(system(lines as string[])!.steps);
  });
});
