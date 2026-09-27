import { beforeAll, describe, expect, it } from "vitest";
import type { LineAnalysis, LiveEngine } from "../../contracts";
import { planHandwriting } from "../../handwriting";
import { localSolve } from "../../localSolve";
import { getEngine } from "..";
import { allowComplexRoots, usesImaginaryUnit } from "../complexSetting";

/**
 * Algebra 1 and Algebra 2 (`courses.ts` and the modules it routes to): every step a line of maths
 * a teacher writes, exact, word-free and drawable by the tutor's hand; a line an older path would
 * misread (`f(4)` as `4f`) answered from its definition or not at all; and the student's own
 * steps checked — a right one `ok`, a wrong one `mismatch`, a correct rearrangement never flagged.
 * The scoreboard (`src/__eval__/courses/*.ts`) holds the wider problem sets.
 */

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

const simplify = (latex: string) => engine.simplifySteps!(latex);
const fromLines = (lines: string[]) => engine.solveFromLines!(lines)?.steps ?? null;
const solveIn = (lines: string[]) => localSolve(engine, lines).steps;

function expectDrawable(steps: readonly string[] | null) {
  expect(steps).not.toBeNull();
  const plan = planHandwriting(steps!, { size: 28, seed: 1 });
  expect(plan.unsupported).toEqual([]);
  for (const s of steps!) expect(s).not.toMatch(/\\text/);
}

/** The verdict of the last line under the ones above, as the board analyzes a column. */
function verdictOf(lines: string[]): LineAnalysis["verdict"] {
  let previous: LineAnalysis | undefined;
  let original: LineAnalysis | undefined;
  let last: LineAnalysis | undefined;
  for (const l of lines) {
    last = engine.analyzeLine(l, { mode: "feedback", previous, original });
    if (!["label", "incomplete", "unknown"].includes(last.kind)) previous = last;
    if (!original && (last.kind === "equation" || last.kind === "inequality")) original = last;
  }
  return last!.verdict;
}

describe("function notation: from the definition above, never `4f`", () => {
  it.each([
    [["f(x) = 2x + 3", "f(4) ="], ["= 2(4) + 3", "= 8 + 3", "= 11"]],
    [["f(x) = 2x + 3", "f(a + 1) ="], ["= 2(a + 1) + 3", "= 2a + 2 + 3", "= 2a + 5"]],
    [["f(x) = x^{2} - 3x", "f(-2) ="], ["= (-2)^{2} - 3(-2)", "= 4 + 6", "= 10"]],
    [["f(x) = 2x + 3", "g(x) = x^{2}", "f(g(x)) ="], ["= f(x^{2})", "= 2(x^{2}) + 3", "= 2x^{2} + 3"]],
    [["f(x) = 2x + 3", "g(x) = x^{2}", "f(g(2)) ="], ["= f(2^{2})", "= f(4)", "= 2(4) + 3", "= 8 + 3", "= 11"]],
    [["f(x) = x^{2} - 3x", "\\frac{f(4) - f(1)}{4 - 1} ="], ["= \\frac{(4^{2} - 3(4)) - (1^{2} - 3(1))}{4 - 1}", "= \\frac{4 - (-2)}{4 - 1}", "= \\frac{6}{3}", "= 2"]],
    [["f(x) = \\begin{cases} x^{2} & x < 0 \\\\ 2x + 1 & x \\ge 0 \\end{cases}", "f(3) ="], ["3 \\ge 0", "= 2(3) + 1", "= 6 + 1", "= 7"]],
    [["f(x) = -x^{2} + 4", "f(3) ="], ["= -(3)^{2} + 4", "= -9 + 4", "= -5"]],
  ])("%j", (lines, steps) => {
    expect(fromLines(lines)).toEqual(steps);
    expectDrawable(steps);
  });

  it("an inverse by swapping x and y", () => {
    const steps = fromLines(["f(x) = \\frac{x + 1}{x - 2}", "f^{-1}(x) ="]);
    expect(steps).toEqual(["y = \\frac{x + 1}{x - 2}", "x = \\frac{y + 1}{y - 2}", "x(y - 2) = y + 1", "xy - 2x = y + 1", "xy - y = 2x + 1", "y(x - 1) = 2x + 1", "y = \\frac{2x + 1}{x - 1}", "f^{-1}(x) = \\frac{2x + 1}{x - 1}"]);
    expectDrawable(steps);
    // an even power has no inverse function without a restricted domain: nothing written
    expect(fromLines(["f(x) = x^{2}", "f^{-1}(x) ="])).toBeNull();
  });

  it("where a function takes a value, and where two meet", () => {
    expect(fromLines(["f(x) = 2x + 3", "f(x) = 7"])).toEqual(["2x + 3 = 7", "2x = 4", "x = 2"]);
    expect(fromLines(["f(x) = x^{2}", "g(x) = x + 6", "f(x) = g(x)"])).toEqual(["x^{2} = x + 6", "x^{2} - x - 6 = 0", "(x + 2)(x - 3) = 0", "x = -2, \\ x = 3"]);
  });

  it("never reads a call as a product (it used to write `= 4f` and `3f = 9`, `f = 3`)", () => {
    expect(solveIn(["f(4) ="])).toEqual([]);
    expect(solveIn(["f(x) = x^{2}", "f(3) = 9"])).toEqual([]);
    // `(f + g)(2)` is f(2) + g(2), not 2f + 2g
    const sum = solveIn(["f(x) = 2x + 3", "g(x) = x^{2}", "(f + g)(2) ="]);
    expect(sum.at(-1)).toBe("= 11");
    expect(sum[0]).toBe("= f(2) + g(2)");
    expect(sum.join(" ")).not.toMatch(/\d[fg]/);
  });

  it("checks a claim right under the definition", () => {
    expect(verdictOf(["f(x) = 2x + 3", "f(4) = 11"])).toBe("ok");
    expect(verdictOf(["f(x) = 2x + 3", "f(4) = 12"])).toBe("mismatch");
    expect(verdictOf(["f(x) = 2x + 3", "f(a + 1) = 2a + 5"])).toBe("ok");
  });
});

describe("lines: slope, point-slope, slope-intercept", () => {
  it.each([
    [["(2, 3), (5, 9)"], ["m = \\frac{9 - 3}{5 - 2}", "m = \\frac{6}{3}", "m = 2", "y - 3 = 2(x - 2)", "y - 3 = 2x - 4", "y = 2x - 1"]],
    [["(2, 3), (5, 9)", "m = ?"], ["m = \\frac{9 - 3}{5 - 2}", "m = \\frac{6}{3}", "m = 2"]],
    [["(2, 3), (2, 7)"], ["m = \\frac{7 - 3}{2 - 2}", "m = \\frac{4}{0}", "x = 2"]],
    [["m = -\\frac{1}{2}", "(4, -1)", "y = ?"], ["y + 1 = -\\frac{1}{2}(x - 4)", "y + 1 = -\\frac{1}{2}x + 2", "y = -\\frac{1}{2}x + 1"]],
    [["2x + 3y = 6", "y = ?"], ["3y = -2x + 6", "y = -\\frac{2}{3}x + 2"]],
    [["y - 3 = 2(x - 1)"], ["y - 3 = 2x - 2", "y = 2x + 1"]],
  ])("%j", (lines, steps) => {
    expect(solveIn(lines)).toEqual(steps);
    expectDrawable(steps);
  });

  it("a bare equation in x and y is left alone (it may be one equation of a problem in two unknowns)", () => {
    expect(localSolve(engine, ["x + y = 10"]).source).toBeNull();
  });
});

describe("laws of exponents, one rule a line", () => {
  it.each([
    ["x^{3} \\cdot x^{4}", ["x^{3 + 4}", "x^{7}"]],
    ["(x^{2})^{3}", ["x^{2 \\cdot 3}", "x^{6}"]],
    ["\\frac{x^{5}}{x^{2}}", ["x^{5 - 2}", "x^{3}"]],
    ["(2x^{3}y)^{2}", ["2^{2}x^{3 \\cdot 2}y^{2}", "4x^{6}y^{2}"]],
    ["\\frac{12x^{5}y^{2}}{4x^{2}y^{5}}", ["3x^{5 - 2}y^{2 - 5}", "3x^{3}y^{-3}", "\\frac{3x^{3}}{y^{3}}"]],
    ["x^{-2}", ["\\frac{1}{x^{2}}"]],
    ["2^{-3}", ["\\frac{1}{2^{3}}", "\\frac{1}{8}"]],
    ["(-3a^{2})^{3}", ["(-3)^{3}a^{2 \\cdot 3}", "-27a^{6}"]],
  ])("%s", (latex, steps) => {
    expect(simplify(latex)).toEqual(steps);
    expectDrawable(steps);
  });

  it("leaves a line no law applies to", () => {
    for (const latex of ["2x", "x^{2}", "7 \\times 8"]) expect(simplify(latex), latex).toBeNull();
  });
});

describe("radicals and rational exponents, exact", () => {
  it.each([
    ["\\sqrt{50}", ["\\sqrt{25 \\cdot 2}", "5\\sqrt{2}"]],
    ["\\sqrt{12} + \\sqrt{27}", ["\\sqrt{4 \\cdot 3} + \\sqrt{9 \\cdot 3}", "2\\sqrt{3} + 3\\sqrt{3}", "5\\sqrt{3}"]],
    ["\\frac{1}{\\sqrt{2}}", ["\\frac{1 \\cdot \\sqrt{2}}{\\sqrt{2} \\cdot \\sqrt{2}}", "\\frac{\\sqrt{2}}{2}"]],
    ["\\frac{3}{2 + \\sqrt{3}}", ["\\frac{3(2 - \\sqrt{3})}{(2 + \\sqrt{3})(2 - \\sqrt{3})}", "\\frac{6 - 3\\sqrt{3}}{4 - 3}", "6 - 3\\sqrt{3}"]],
    ["\\frac{4}{\\sqrt{5} - 1}", ["\\frac{4(\\sqrt{5} + 1)}{(\\sqrt{5} - 1)(\\sqrt{5} + 1)}", "\\frac{4 + 4\\sqrt{5}}{5 - 1}", "1 + \\sqrt{5}"]],
    ["8^{\\frac{2}{3}}", ["(\\sqrt[3]{8})^{2}", "2^{2}", "4"]],
    ["\\sqrt[3]{54}", ["\\sqrt[3]{27 \\cdot 2}", "3\\sqrt[3]{2}"]],
  ])("%s", (latex, steps) => {
    expect(simplify(latex)).toEqual(steps);
    expectDrawable(steps);
  });

  it("checks a step by its exact value", () => {
    expect(verdictOf(["\\sqrt{50}", "= 5\\sqrt{2}"])).toBe("ok");
    expect(verdictOf(["\\sqrt{50}", "= 5\\sqrt{5}"])).toBe("mismatch");
    // a rounded decimal is the calculator's value, not a claim
    expect(verdictOf(["\\sqrt{50}", "= 7.07"])).not.toBe("mismatch");
  });
});

describe("complex numbers", () => {
  it.each([
    ["(2 + 3i)(1 - i)", ["2 - 2i + 3i - 3i^{2}", "2 - 2i + 3i + 3", "5 + i"]],
    ["i^{23}", ["(i^{4})^{5} \\cdot i^{3}", "i^{3}", "-i"]],
    ["\\frac{2 + 3i}{1 - i}", ["\\frac{(2 + 3i)(1 + i)}{(1 - i)(1 + i)}", "\\frac{2 + 2i + 3i + 3i^{2}}{1 - i^{2}}", "\\frac{-1 + 5i}{2}", "-\\frac{1}{2} + \\frac{5}{2}i"]],
    ["\\sqrt{-4} \\cdot \\sqrt{-9}", ["2i \\cdot 3i", "6i^{2}", "-6"]],
  ])("%s", (latex, steps) => {
    expect(simplify(latex)).toEqual(steps);
    expectDrawable(steps);
  });

  it("complex roots only when the column uses i (the default setting)", () => {
    expect(solveIn(["x^{2} + 2x + 5 = 0"]).at(-1)).toBe("\\varnothing");
    const steps = solveIn(["i^{2} = -1", "x^{2} + 2x + 5 = 0"]);
    expect(steps).toEqual(["x = \\frac{-2 \\pm \\sqrt{2^{2} - 4 \\cdot 1 \\cdot 5}}{2 \\cdot 1}", "x = \\frac{-2 \\pm \\sqrt{-16}}{2}", "x = \\frac{-2 \\pm 4i}{2}", "x = -1 \\pm 2i"]);
    expectDrawable(steps);
    expect(localSolve(engine, ["x^{2} + 9 = 0"], undefined, { complexRoots: "always" }).steps).toEqual(["x^{2} = -9", "x = \\pm\\sqrt{-9}", "x = \\pm 3i"]);
    expect(verdictOf(["x^{2} + 2x + 5 = 0", "x = -1 \\pm 2i"])).toBe("ok");
    expect(verdictOf(["x^{2} + 2x + 5 = 0", "x = 1 \\pm 2i"])).toBe("mismatch");
  });

  it("finds the imaginary unit, never the i of a command or a subscript", () => {
    expect(usesImaginaryUnit("i^{2} = -1")).toBe(true);
    expect(usesImaginaryUnit("x = 3 + 2i")).toBe(true);
    expect(usesImaginaryUnit("\\sin x + \\pi = \\int x")).toBe(false);
    expect(usesImaginaryUnit("\\sum_{i=1}^{3} x_{i}")).toBe(false);
    expect(allowComplexRoots("never", ["i^{2} = -1"])).toBe(false);
    expect(allowComplexRoots("always", ["x^{2} = -1"])).toBe(true);
  });
});

describe("a formula for one letter", () => {
  it.each([
    [["A = \\frac{1}{2}bh", "h = ?"], ["2A = bh", "h = \\frac{2A}{b}"]],
    [["P = 2l + 2w", "w = ?"], ["P - 2l = 2w", "w = \\frac{P - 2l}{2}"]],
    [["C = \\frac{5}{9}(F - 32)", "F = ?"], ["9C = 5(F - 32)", "9C = 5F - 160", "9C + 160 = 5F", "F = \\frac{9C + 160}{5}"]],
    [["I = Prt", "t = ?"], ["t = \\frac{I}{Pr}"]],
    [["A = \\pi r^{2}", "r = ?"], ["r^{2} = \\frac{A}{\\pi}", "r = \\sqrt{\\frac{A}{\\pi}}"]],
    [["\\frac{1}{f} = \\frac{1}{u} + \\frac{1}{v}", "f = ?"], ["uv = fv + fu", "uv = f(u + v)", "f = \\frac{uv}{u + v}"]],
  ])("%j", (lines, steps) => {
    expect(fromLines(lines)).toEqual(steps);
    expectDrawable(steps);
  });

  it("checks a rearrangement by its solutions", () => {
    expect(verdictOf(["A = \\frac{1}{2}bh", "2A = bh", "h = \\frac{2A}{b}"])).toBe("ok");
    expect(verdictOf(["2x + 3y = 6", "3y = 6 - 2x"])).toBe("ok");
  });
});

describe("sequences, series and a mean", () => {
  it.each([
    [["3, 7, 11, 15, \\ldots", "a_{10} = ?"], ["d = 7 - 3", "d = 4", "a_{10} = 3 + (10 - 1) \\cdot 4", "a_{10} = 3 + 36", "a_{10} = 39"]],
    [["3, 7, 11, \\ldots", "a_{n} = ?"], ["d = 7 - 3", "d = 4", "a_{n} = 3 + (n - 1) \\cdot 4", "a_{n} = 3 + 4n - 4", "a_{n} = 4n - 1"]],
    [["a_{1} = 2", "a_{n} = a_{n - 1} + 5", "a_{n} = ?"], ["d = 5", "a_{n} = 2 + (n - 1) \\cdot 5", "a_{n} = 2 + 5n - 5", "a_{n} = 5n - 3"]],
    [["2, 6, 18, \\ldots", "S_{6} = ?"], ["r = \\frac{6}{2}", "r = 3", "S_{6} = \\frac{2(1 - 3^{6})}{1 - 3}", "S_{6} = \\frac{2(-728)}{-2}", "S_{6} = 728"]],
    [["8, 4, 2, 1, \\ldots", "S = ?"], ["r = \\frac{4}{8}", "r = \\frac{1}{2}", "S = \\frac{8}{1 - \\frac{1}{2}}", "S = \\frac{8}{\\frac{1}{2}}", "S = 16"]],
    [["3, 5, 7, 9, 11", "\\bar{x} = ?"], ["\\bar{x} = \\frac{3 + 5 + 7 + 9 + 11}{5}", "\\bar{x} = \\frac{35}{5}", "\\bar{x} = 7"]],
  ])("%j", (lines, steps) => {
    expect(fromLines(lines)).toEqual(steps);
    expectDrawable(steps);
  });

  it("sigma notation, finite and infinite", () => {
    expect(simplify("\\sum_{n=1}^{10} (2n + 1) =")).toEqual(["\\frac{10}{2}(3 + 21)", "5 \\cdot 24", "120"]);
    expect(simplify("\\sum_{n=1}^{\\infty} 3\\left(\\frac{1}{2}\\right)^{n - 1}")).toEqual(["\\frac{3}{1 - \\frac{1}{2}}", "\\frac{3}{\\frac{1}{2}}", "6"]);
    // |r| ≥ 1 has no sum: nothing written
    expect(simplify("\\sum_{n=1}^{\\infty} 2^{n}")).toBeNull();
  });

  it("a formula with decimals keeps them (not `\\frac{1}{20}`)", () => {
    expect(fromLines(["A = P(1 + r)^{t}", "P = 1000", "r = 0.05", "t = 3", "A = ?"])).toEqual(["A = 1000(1 + 0.05)^{3}", "A = 1000(1.05)^{3}", "A = 1000 \\cdot 1.157625", "A = 1157.625"]);
  });
});

describe("Algebra 2: division, logs, rational expressions, the binomial theorem", () => {
  it("long division with the working", () => {
    const steps = simplify("\\frac{x^{3} - 2x^{2} + 4}{x - 3}");
    expect(steps).toEqual(["\\frac{x^{2}(x - 3) + x^{2} + 4}{x - 3}", "x^{2} + \\frac{x^{2} + 4}{x - 3}", "x^{2} + \\frac{x(x - 3) + 3x + 4}{x - 3}", "x^{2} + x + \\frac{3x + 4}{x - 3}", "x^{2} + x + \\frac{3(x - 3) + 13}{x - 3}", "x^{2} + x + 3 + \\frac{13}{x - 3}"]);
    expectDrawable(steps);
    expect(fromLines(["P(x) = x^{3} - 2x^{2} + 4", "P(3) ="])?.at(-1)).toBe("= 13");
  });

  it.each([
    ["\\log(x^{2} y)", ["\\log x^{2} + \\log y", "2\\log x + \\log y"]],
    ["2\\log x + \\log y", ["\\log x^{2} + \\log y", "\\log(x^{2}y)"]],
    ["\\log_{2} 8 + \\log_{2} 4", ["\\log_{2}(8 \\cdot 4)", "\\log_{2} 32", "\\log_{2} 2^{5}", "5"]],
    ["\\log_{3} 7 =", ["\\frac{\\ln 7}{\\ln 3}"]],
  ])("%s", (latex, steps) => {
    expect(simplify(latex)).toEqual(steps);
    expectDrawable(steps);
  });

  it("exponential equations over two bases, exact", () => {
    const steps = engine.solveLatex("3^{x} = 2^{x + 1}")?.steps ?? null;
    expect(steps).toEqual(["\\ln 3^{x} = \\ln 2^{x + 1}", "x\\ln 3 = (x + 1)\\ln 2", "x\\ln 3 = x\\ln 2 + \\ln 2", "x\\ln 3 - x\\ln 2 = \\ln 2", "x(\\ln 3 - \\ln 2) = \\ln 2", "x = \\frac{\\ln 2}{\\ln 3 - \\ln 2}"]);
    expectDrawable(steps);
    expect(engine.solveLatex("2^{x} = 5")?.steps).toEqual(["x = \\log_{2} 5", "x = \\frac{\\ln 5}{\\ln 2}"]);
  });

  it.each([
    ["\\frac{2}{x} + \\frac{3}{x + 1}", ["x \\neq -1, \\ x \\neq 0", "\\frac{2(x + 1)}{x(x + 1)} + \\frac{3x}{x(x + 1)}", "\\frac{2(x + 1) + 3x}{x(x + 1)}", "\\frac{2x + 2 + 3x}{x(x + 1)}", "\\frac{5x + 2}{x(x + 1)}"]],
    ["\\frac{x^{2} - 4}{x + 3} \\cdot \\frac{x + 3}{x - 2}", ["x \\neq -3, \\ x \\neq 2", "\\frac{(x + 2)(x - 2)}{x + 3} \\cdot \\frac{x + 3}{x - 2}", "\\frac{(x + 2)(x - 2)(x + 3)}{(x + 3)(x - 2)}", "x + 2"]],
    ["(x + 2)^{4}", ["x^{4} + 4x^{3}(2) + 6x^{2}(2)^{2} + 4x(2)^{3} + 2^{4}", "x^{4} + 8x^{3} + 24x^{2} + 32x + 16"]],
  ])("%s", (latex, steps) => {
    expect(simplify(latex)).toEqual(steps);
    expectDrawable(steps);
  });
});
