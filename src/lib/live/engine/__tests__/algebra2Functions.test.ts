import * as mathjs from "mathjs";
import { beforeAll, describe, expect, it } from "vitest";
import type { LineAnalysis, LiveEngine } from "../../contracts";
import { planHandwriting } from "../../handwriting";
import { analyzeColumn, localSolve } from "../../localSolve";
import { getEngine } from "..";
import type { CourseDeps } from "../courseKit";
import { createMathInstance, translate } from "../math";
import { askOf, rationalFeatures, readRationalFunction } from "../rationalFunctions";
import { familyOf, mapPoint, ruleLatex } from "../transformations";
import { q } from "../algebra";

/**
 * Algebra 2's rational functions (`rationalFunctions.ts`) and transformations of functions
 * (`transformations.ts`): the steps Solve writes, the asks under a function, and the student's
 * own rewrite checked. The sketches are graphIntent.test.ts / graphing.test.ts; the wider problem
 * sets are on the scoreboard (`src/__eval__/courses/algebra2.ts`).
 */

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

const math = createMathInstance(mathjs);
const deps: CourseDeps = { math, translate: (l) => translate(math, l, { letterUnits: false }), normalize: (s) => s.replace(/\s+/g, ""), solveOne: () => null };

const solveIn = (lines: string[]) => localSolve(engine, lines).steps;

function expectDrawable(steps: readonly string[]) {
  expect(steps.length).toBeGreaterThan(0);
  expect(planHandwriting(steps, { size: 28, seed: 1 }).unsupported).toEqual([]);
  for (const s of steps) expect(s).not.toMatch(/\\text/);
}

/** The analysis of each line of a column, as the board holds it. */
const analyses = (lines: string[]): LineAnalysis[] => analyzeColumn(engine, lines, "feedback") as LineAnalysis[];

describe("rational functions: Solve on the function", () => {
  it.each([
    [
      "f(x) = \\frac{x^{2} - 4}{x^{2} - x - 2}",
      [
        "f(x) = \\frac{(x + 2)(x - 2)}{(x + 1)(x - 2)}",
        "x \\neq -1, \\ x \\neq 2",
        "f(x) = \\frac{x + 2}{x + 1}, \\ x \\neq 2",
        "\\frac{2 + 2}{2 + 1} = \\frac{4}{3}",
        "(2, \\frac{4}{3})",
        "x = -1",
        "y = 1",
      ],
    ],
    ["y = \\frac{2x + 1}{x - 3}", ["x \\neq 3", "x = 3", "y = 2"]],
    ["f(x) = \\frac{x^{2} + 1}{x - 1}", ["x \\neq 1", "x = 1", "f(x) = x + 1 + \\frac{2}{x - 1}", "y = x + 1"]],
    ["f(x) = \\frac{x^{2} - 4}{x - 2}", ["f(x) = \\frac{(x + 2)(x - 2)}{x - 2}", "x \\neq 2", "f(x) = x + 2, \\ x \\neq 2", "2 + 2 = 4", "(2, 4)"]],
    ["y = \\frac{x + 1}{x^{2} + 1}", ["x \\in \\mathbb{R}", "y = 0"]],
    ["y = \\frac{3x^{2}}{x^{2} - 9}", ["y = \\frac{3x^{2}}{(x + 3)(x - 3)}", "x \\neq -3, \\ x \\neq 3", "x = -3, \\ x = 3", "y = 3"]],
    ["f(x) = \\frac{x^{3}}{x - 1}", ["x \\neq 1", "x = 1"]],
  ])("%s", (line, steps) => {
    expect(solveIn([line])).toEqual(steps);
    expectDrawable(steps);
  });

  it("the features, exactly: holes where a factor cancels, asymptotes from the zeros left and the degrees", () => {
    const f = rationalFeatures(readRationalFunction(deps, "f(x) = \\frac{2x^{2} - 8}{x^{2} + x - 6}")!)!;
    expect(f.excluded).toEqual([q(-3), q(2)]);
    expect(f.holes).toEqual([{ x: q(2), y: q(8, 5) }]);
    expect(f.vertical).toEqual([q(-3)]);
    expect(f.horizontal).toEqual(q(2));
    expect(f.oblique).toBeNull();
    // a double factor below, one cancelled: still a vertical asymptote there, not a hole
    const g = rationalFeatures(readRationalFunction(deps, "y = \\frac{x - 1}{(x - 1)^{2}}")!)!;
    expect(g.holes).toEqual([]);
    expect(g.vertical).toEqual([q(1)]);
  });

  it("refuses rather than guesses: an irrational zero below, a letter besides x, an equation", () => {
    expect(readRationalFunction(deps, "y = \\frac{1}{x^{2} - 2}") && rationalFeatures(readRationalFunction(deps, "y = \\frac{1}{x^{2} - 2}")!)).toBeNull();
    expect(readRationalFunction(deps, "y = \\frac{k}{x}")).toBeNull();
    expect(readRationalFunction(deps, "\\frac{x + 1}{x - 2} = 3")).toBeNull();
    expect(solveIn(["y = \\frac{1}{x^{2} - 2}"]).some((s) => /\\neq|\\to/.test(s))).toBe(false);
  });

  it("a rational function that is one equation of a system is left to the system", () => {
    expect(solveIn(["y = \\frac{12}{x}", "x = 3", "y = ?"]).at(-1)).toBe("y = 4");
    const sys = localSolve(engine, ["y = x + 1", "y = \\frac{6}{x}"]);
    expect(sys.source).toBe("solveFromLines");
    expect(sys.steps.slice(-2)).toEqual(["x = -3, \\ x = 2", "y = -2, \\ y = 3"]);
  });
});

describe("rational functions: the asks under one", () => {
  const F = "f(x) = \\frac{x^{2} - 4}{x^{2} - x - 2}";
  it.each([
    ["\\text{VA} = ?", ["f(x) = \\frac{(x + 2)(x - 2)}{(x + 1)(x - 2)}", "f(x) = \\frac{x + 2}{x + 1}, \\ x \\neq 2", "x = -1"]],
    ["x = ?", ["f(x) = \\frac{(x + 2)(x - 2)}{(x + 1)(x - 2)}", "f(x) = \\frac{x + 2}{x + 1}, \\ x \\neq 2", "x = -1"]],
    ["\\text{HA} = ?", ["y = 1"]],
    ["\\text{holes}", ["f(x) = \\frac{(x + 2)(x - 2)}{(x + 1)(x - 2)}", "f(x) = \\frac{x + 2}{x + 1}, \\ x \\neq 2", "\\frac{2 + 2}{2 + 1} = \\frac{4}{3}", "(2, \\frac{4}{3})"]],
    ["\\text{domain}", ["f(x) = \\frac{(x + 2)(x - 2)}{(x + 1)(x - 2)}", "x \\neq -1, \\ x \\neq 2"]],
    ["D = ?", ["f(x) = \\frac{(x + 2)(x - 2)}{(x + 1)(x - 2)}", "x \\neq -1, \\ x \\neq 2"]],
    ["\\lim_{x \\to \\infty} f(x) =", ["= \\lim_{x \\to \\infty} \\frac{x^{2} - 4}{x^{2} - x - 2}", "= \\lim_{x \\to \\infty} \\frac{1 - \\frac{4}{x^{2}}}{1 - \\frac{1}{x} - \\frac{2}{x^{2}}}", "= \\frac{1 - 0}{1 - 0 - 0}", "= 1"]],
  ])("%s", (ask, steps) => {
    expect(solveIn([F, ask])).toEqual(steps);
    expectDrawable(steps);
  });

  it("the limit at a hole is the hole's height; the HA of a slant one is its line; none is ∅", () => {
    expect(solveIn([F, "\\lim_{x \\to 2} f(x) ="]).at(-1)).toBe("= \\frac{4}{3}");
    expect(solveIn(["f(x) = \\frac{x^{2} + 1}{x - 1}", "\\text{HA} = ?"])).toEqual(["f(x) = x + 1 + \\frac{2}{x - 1}", "y = x + 1"]);
    expect(solveIn(["f(x) = \\frac{x^{3}}{x - 1}", "\\text{HA} = ?"])).toEqual(["\\varnothing"]);
    expect(solveIn(["y = \\frac{2x + 1}{x - 3}", "\\text{holes}"])).toEqual(["\\varnothing"]);
  });

  it("reads the ask words Mathpix writes, and nothing else", () => {
    expect(askOf("\\mathrm{VA}=?")).toBe("vertical");
    expect(askOf("V A=?")).toBe("vertical");
    expect(askOf("\\text{Holes}")).toBe("holes");
    expect(askOf("\\text { domain } = ?")).toBe("domain");
    expect(askOf("x = ?", "t")).toBeNull();
    expect(askOf("d = ?")).toBeNull();
    expect(askOf("x = 3")).toBeNull();
    expect(askOf("\\text{find the holes}")).toBeNull();
  });

  it("a question word under a function is an ask, not prose; alone it is still text", () => {
    expect(analyses([F, "\\text{holes}"])[1].kind).toBe("unknown");
    expect(analyses([F, "\\text{domain}"])[1].kind).toBe("unknown");
    expect(analyses(["\\text{holes}"])[0].kind).toBe("text");
  });
});

describe("transformations: g written from a parent above", () => {
  it.each([
    [["f(x) = x^{2}", "g(x) = f(x - 3) + 1"], ["g(x) = (x - 3)^{2} + 1", "(x, y) \\to (x + 3, y + 1)", "(0, 0) \\to (3, 1)"]],
    [["f(x) = x^{2}", "g(x) = -2f(x)"], ["g(x) = -2x^{2}", "(x, y) \\to (x, -2y)", "(1, 1) \\to (1, -2)"]],
    [["f(x) = x^{2}", "g(x) = f(2x)"], ["g(x) = (2x)^{2}", "g(x) = 4x^{2}", "(x, y) \\to (\\frac{1}{2}x, y)", "(1, 1) \\to (\\frac{1}{2}, 1)"]],
    [["f(x) = x^{2}", "g(x) = \\frac{1}{2}f(x + 1) - 4"], ["g(x) = \\frac{1}{2}(x + 1)^{2} - 4", "(x, y) \\to (x - 1, \\frac{1}{2}y - 4)", "(0, 0) \\to (-1, -4)"]],
    [["f(x) = |x|", "g(x) = -f(x + 2) + 3"], ["g(x) = -|x + 2| + 3", "(x, y) \\to (x - 2, -y + 3)", "(0, 0) \\to (-2, 3)"]],
    [["f(x) = \\sqrt{x}", "g(x) = f(2x - 6)"], ["g(x) = \\sqrt{2x - 6}", "(x, y) \\to (\\frac{1}{2}x + 3, y)", "(0, 0) \\to (3, 0)"]],
    [["f(x) = \\frac{1}{x}", "g(x) = f(x - 2) + 3"], ["g(x) = \\frac{1}{x - 2} + 3", "(x, y) \\to (x + 2, y + 3)", "(1, 1) \\to (3, 4)"]],
    [["f(x) = 2^{x}", "g(x) = 3f(x) - 1"], ["g(x) = 3 \\cdot 2^{x} - 1", "(x, y) \\to (x, 3y - 1)", "(0, 1) \\to (0, 2)"]],
    [["f(x) = x^{3}", "g(x) = f(-x) + 2"], ["g(x) = (-x)^{3} + 2", "g(x) = 2 - x^{3}", "(x, y) \\to (-x, y + 2)", "(0, 0) \\to (0, 2)"]],
    [["f(x) = x^{2} - 4x", "g(x) = f(x + 1)"], ["g(x) = (x + 1)^{2} - 4(x + 1)", "(x, y) \\to (x - 1, y)", "(2, -4) \\to (1, -4)"]],
  ])("%j", (lines, steps) => {
    expect(solveIn(lines)).toEqual(steps);
    expectDrawable(steps);
  });

  it("the rule moves a point the whole way at once: f(2x - 6) is three to the right, not six", () => {
    const t = { a: q(1), b: q(2), c: q(-6), k: q(0) };
    expect(mapPoint(t, [q(0), q(0)])).toEqual([q(3), q(0)]);
    expect(ruleLatex(t)).toBe("(x, y) \\to (\\frac{1}{2}x + 3, y)");
    expect(ruleLatex({ a: q(-1, 2), b: q(-1), c: q(0), k: q(4) })).toBe("(x, y) \\to (-x, -\\frac{1}{2}y + 4)");
  });

  it("a call the rule cannot describe (two calls, f of f, a power of f) is left alone", () => {
    for (const lines of [
      ["f(x) = x^{2}", "g(x) = f(x) + f(x - 1)"],
      ["f(x) = x^{2}", "g(x) = f(x)^{2}"],
      ["f(x) = x^{2}", "g(x) = f(x^{2})"],
    ]) {
      expect(solveIn(lines).some((s) => /\\to/.test(s)), lines.join(" / ")).toBe(false);
    }
  });
});

describe("transformations: a school parent read off the line", () => {
  it.each([
    ["y = 2(x - 1)^{2} + 3", ["f(x) = x^{2}", "y = 2f(x - 1) + 3", "(x, y) \\to (x + 1, 2y + 3)", "(0, 0) \\to (1, 3)"]],
    ["y = -|x + 2| + 1", ["f(x) = |x|", "y = -f(x + 2) + 1", "(x, y) \\to (x - 2, -y + 1)", "(0, 0) \\to (-2, 1)"]],
    ["y = \\sqrt{x - 4} + 1", ["f(x) = \\sqrt{x}", "y = f(x - 4) + 1", "(x, y) \\to (x + 4, y + 1)", "(0, 0) \\to (4, 1)"]],
    ["y = 2^{x + 1} - 3", ["f(x) = 2^{x}", "y = f(x + 1) - 3", "(x, y) \\to (x - 1, y - 3)", "(0, 1) \\to (-1, -2)"]],
    ["y = \\frac{1}{x - 2} + 3", ["f(x) = \\frac{1}{x}", "y = f(x - 2) + 3", "(x, y) \\to (x + 2, y + 3)", "(1, 1) \\to (3, 4)"]],
    ["g(x) = 4x^{2}", ["f(x) = x^{2}", "g(x) = 4f(x)", "(x, y) \\to (x, 4y)", "(1, 1) \\to (1, 4)"]],
    ["f(x) = (x + 3)^{3}", ["g(x) = x^{3}", "f(x) = g(x + 3)", "(x, y) \\to (x - 3, y)", "(0, 0) \\to (-3, 0)"]],
  ])("%s", (line, steps) => {
    expect(solveIn([line])).toEqual(steps);
    expectDrawable(steps);
  });

  it("the parent itself, a polynomial in standard form, a line: not transformations", () => {
    for (const line of ["y = x^{2}", "y = x^{2} - 4x + 1", "y = 2x + 1", "y = |x|"]) expect(solveIn([line]).some((s) => /\\to/.test(s)), line).toBe(false);
  });

  it("familyOf reads the moves structurally", () => {
    const at = (latex: string) => familyOf(math.parse(translate(math, latex, { letterUnits: false }).source), "x");
    expect(at("2(x - 1)^{2} + 3")).toMatchObject({ family: "square", a: q(2), b: q(1), c: q(-1), k: q(3) });
    expect(at("-\\frac{3}{x + 1} - 2")).toMatchObject({ family: "reciprocal", a: q(-3), b: q(1), c: q(1), k: q(-2) });
    expect(at("\\sqrt{4 - x}")).toMatchObject({ family: "sqrt", b: q(-1), c: q(4) });
    expect(at("3^{2x} + 1")).toMatchObject({ family: "exp", base: "3", b: q(2) });
    expect(at("x^{2} - 4x")).toBeNull();
    expect(at("(x - 1)(x + 2)")).toBeNull();
  });
});

describe("transformations: the student's rewrite of g is checked", () => {
  const verdicts = (lines: string[]) => analyses(lines).map((a) => a.verdict);
  it("the same function is ✓, a wrong one ringed, and the next rewrite is checked too", () => {
    expect(verdicts(["f(x) = x^{2}", "g(x) = f(x - 3) + 1", "g(x) = (x - 3)^{2} + 1"])).toEqual(["none", "none", "ok"]);
    expect(verdicts(["f(x) = x^{2}", "g(x) = f(x - 3) + 1", "g(x) = (x + 3)^{2} + 1"])).toEqual(["none", "none", "mismatch"]);
    expect(verdicts(["f(x) = x^{2}", "g(x) = f(2x)", "g(x) = 2x^{2}"])).toEqual(["none", "none", "mismatch"]);
    expect(verdicts(["f(x) = x^{2}", "g(x) = f(2x)", "g(x) = 4x^{2}"])).toEqual(["none", "none", "ok"]);
    expect(verdicts(["f(x) = x^{2}", "g(x) = f(x - 3) + 1", "y = (x - 3)^{2} + 1"])).toEqual(["none", "none", "ok"]);
    expect(verdicts(["f(x) = x^{2}", "g(x) = f(x - 3) + 1", "g(x) = (x - 3)^{2} + 1", "g(x) = x^{2} - 6x + 10"])).toEqual(["none", "none", "ok", "ok"]);
    expect(verdicts(["f(x) = x^{2}", "g(x) = f(x - 3) + 1", "g(x) = (x - 3)^{2} + 1", "g(x) = x^{2} - 6x + 9"])).toEqual(["none", "none", "ok", "mismatch"]);
  });

  it("g is read as a function of x, not a product f·(x - 3)", () => {
    const [, g] = analyses(["f(x) = x^{2}", "g(x) = f(x - 3) + 1"]);
    expect(g.kind).toBe("function");
    expect(g.derived).toBe(true);
    expect(g.plot?.expr).toBeDefined();
    expect(math.evaluate(g.plot!.expr, { x: 5 })).toBe(5);
  });

  it("two different functions one under the other are still a system, never ringed", () => {
    expect(verdicts(["y = 2x + 1", "y = -x + 4"])).toEqual(["none", "none"]);
    expect(verdicts(["f(x) = x^{2}", "g(x) = x + 6"])).toEqual(["none", "none"]);
  });
});
