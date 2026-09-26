import { beforeAll, describe, expect, it } from "vitest";
import type { LiveEngine } from "../../contracts";
import { planHandwriting } from "../../handwriting";
import { localAnswerStep } from "../../solveSteps";
import { getEngine } from "..";

/**
 * Teacher-quality steps (`engine/algebra.ts`): the lines a teacher writes on the board — maths,
 * never words — and every one of them drawable by the tutor's hand.
 */

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

const solve = (latex: string) => engine.solveLatex(latex)?.steps ?? null;
const simplify = (latex: string) => engine.simplifySteps!(latex);
const system = (lines: string[]) => engine.solveFromLines!(lines);

describe("linear equations: expand, clear fractions, collect, divide", () => {
  it.each([
    ["2x+3=11", ["2x = 8", "x = 4"]],
    ["3(x+2)=21", ["3x + 6 = 21", "3x = 15", "x = 5"]],
    ["\\frac{x}{2}+3=7", ["x + 6 = 14", "x = 8"]],
    ["\\frac{2x-1}{3}=5", ["2x - 1 = 15", "2x = 16", "x = 8"]],
    ["5x-3=2x+9", ["5x - 2x = 9 + 3", "3x = 12", "x = 4"]],
    ["3x+1=2", ["3x = 1", "x = \\frac{1}{3}"]],
    ["3\\left(x-2\\right)=2 x+5", ["3x - 6 = 2x + 5", "3x - 2x = 5 + 6", "x = 11"]],
    ["7 = 2(x - 1) + 3x", ["2x - 2 + 3x = 7", "5x - 2 = 7", "5x = 9", "x = \\frac{9}{5}"]],
    ["\\frac{x+1}{2} = \\frac{x}{3}", ["3x + 3 = 2x", "3x - 2x = -3", "x = -3"]],
    ["x = 3x + 4", ["x - 3x = 4", "-2x = 4", "x = -2"]],
    ["12 = 3x + 3", ["3x = 9", "x = 3"]],
    ["-(x-3)=5", ["-x + 3 = 5", "-x = 2", "x = -2"]],
    ["2x=8", ["x = 4"]],
    ["4 = x", ["x = 4"]],
    ["3x = -7", ["x = -\\frac{7}{3}"]],
  ])("%s", (latex, steps) => {
    expect(solve(latex)).toEqual(steps);
  });

  it("the answer line is the last step, exact", () => {
    expect(engine.solveLatex("3x+1=2")?.latex).toBe("x = \\frac{1}{3}");
    expect(engine.solveLatex("\\frac{2x-1}{3}=5")?.latex).toBe("x = 8");
  });

  it("writes nothing for a line already solved, or one whose unknown cancels", () => {
    expect(engine.solveLatex("x = 4")).toBeNull();
    expect(engine.solveLatex("2x + 1 = 2x + 3")).toBeNull();
    expect(engine.solveLatex("2(x+1) = 2x + 2")).toBeNull();
  });

  it("leaves quadratics, decimals and non-polynomials on the CAS path", () => {
    expect(solve("x^2-5x+6=0")).toEqual(["(x - 2)(x - 3) = 0", "x = 2 \\text{ or } x = 3"]);
    expect(engine.solveLatex("0.5x + 1 = 3")?.latex).toBe("x = 4");
    expect(engine.solveLatex("2^x = 8")?.latex).toBe("x \\approx 3");
  });
});

describe("linear inequalities: the sign flips on a negative", () => {
  it.each([
    ["2x+3>11", ["2x > 8", "x > 4"]],
    ["-2x<6", ["x > -3"]],
    ["3 - x \\leq 5", ["-x \\le 2", "x \\ge -2"]],
    ["11 < 2x + 3", ["2x > 8", "x > 4"]],
    ["-\\frac{x}{3} \\ge 2", ["-x \\ge 6", "x \\le -6"]],
    ["2(x-1) \\le x + 4", ["2x - 2 \\le x + 4", "2x - x \\le 4 + 2", "x \\le 6"]],
    ["5x - 1 \\geq 3x + 7", ["5x - 3x \\ge 7 + 1", "2x \\ge 8", "x \\ge 4"]],
  ])("%s", (latex, steps) => {
    expect(solve(latex)).toEqual(steps);
  });

  it("an inequality already solved is not written again (`\\leq` is `\\le`)", () => {
    expect(engine.solveLatex("x > 4")).toBeNull();
    expect(engine.solveLatex("x \\leq 4")).toBeNull();
  });
});

describe("simplifying an expression", () => {
  it.each([
    ["3(x+2)-x", ["3x + 6 - x", "2x + 6"]],
    ["3(x+2)-x=", ["3x + 6 - x", "2x + 6"]],
    ["(x+1)(x+2)", ["x^{2} + 2x + x + 2", "x^{2} + 3x + 2"]],
    ["(x+1)^2", ["x^{2} + 2x + 1"]],
    ["3 - (x+1)", ["3 - x - 1", "2 - x"]],
    ["2(x+3y) - x + y", ["2x + 6y - x + y", "x + 7y"]],
    ["4x + 3 - x + 2", ["3x + 5"]],
    ["\\frac{x}{2}+\\frac{x}{3}", ["\\frac{5}{6}x"]],
  ])("%s", (latex, steps) => {
    expect(simplify(latex)).toEqual(steps);
  });

  it("returns null when there is nothing to do, or no unknown, or a relation", () => {
    expect(simplify("2x + 3")).toBeNull();
    expect(simplify("36 + 2 =")).toBeNull();
    expect(simplify("2x + 3 = 11")).toBeNull();
    expect(simplify("\\sin(x) + x")).toBeNull();
  });
});

describe("systems whose unknown cancels", () => {
  it("the same line twice: `0 = 0`, then the relation every solution satisfies", () => {
    const r = system(["x+y=18", "2x+2y=36"]);
    expect(r?.steps).toEqual(["y = 18 - x", "2x+2(18 - x)=36", "2x + 36 - 2x = 36", "0 = 0", "y = 18 - x"]);
    expect(r?.latex).toBe("y = 18 - x");
  });

  it("parallel lines: a false statement, then the empty set", () => {
    const r = system(["x+y=18", "x+y=20"]);
    expect(r?.steps).toEqual(["y = 18 - x", "x+(18 - x)=20", "x + 18 - x = 20", "0 = 2", "\\varnothing"]);
    expect(r?.latex).toBe("\\varnothing");
  });

  it("keeps a long elimination within the block budget, answer included", () => {
    const steps = system(["3x+2y=16", "2x+3y=14"])!.steps;
    expect(steps.length).toBeLessThanOrEqual(8);
    expect(steps).toContain("x = 4");
    expect(steps.at(-1)).toBe("y = 2");
  });
});

/** Every step a solver produced must be drawable by the tutor's hand: no `unsupported`. */
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
    "2x+3=11",
    "3(x+2)=21",
    "\\frac{x}{2}+3=7",
    "\\frac{2x-1}{3}=5",
    "5x-3=2x+9",
    "3x+1=2",
    "3\\left(x-2\\right)=2 x+5",
    "7 = 2(x - 1) + 3x",
    "\\frac{x+1}{2} = \\frac{x}{3}",
    "x = 3x + 4",
    "-(x-3)=5",
    "3x = -7",
    "4(2x - 3) - 2(x + 1) = 10",
    "\\frac{3x}{4} - \\frac{1}{2} = \\frac{x}{4}",
    "x^2-5x+6=0",
    "x^2-2x-1=0",
    "2x^2 + 3x - 2 = 0",
    "x^3 - 6x^2 + 11x - 6 = 0",
    "2x+3>11",
    "-2x<6",
    "3 - x \\leq 5",
    "-\\frac{x}{3} \\ge 2",
    "2(x-1) \\le x + 4",
    "\\frac{x}{2} - 1 > \\frac{x}{3}",
  ];
  it.each(equations)("solveLatex(%s)", (latex) => {
    const r = engine.solveLatex(latex);
    expect(r).not.toBeNull();
    expectDrawable(r!.steps);
  });

  const expressions = ["3(x+2)-x", "(x+1)(x+2)", "(x+1)^2", "3 - (x+1)", "2(x+3y) - x + y", "\\frac{x}{2}+\\frac{x}{3}", "5(2x - 1) - 3(x - 4)", "(2x - 3)(x + 4)"];
  it.each(expressions)("simplifySteps(%s), as written under the line", (latex) => {
    const steps = simplify(latex);
    expect(steps).not.toBeNull();
    expectDrawable(steps!.map(localAnswerStep));
  });

  const systems = [
    ["x+y=18", "x-y=4", "x=?"],
    ["x+y=18", "x-y=4", "y=?"],
    ["3x+2y=16", "2x+3y=14"],
    ["2x+3y=12", "x-y=1"],
    ["2x+3y=12", "y=2", "x="],
    ["x+y=18", "y=9", "x=?"],
    ["x+y=18", "2x+2y=36"],
    ["x+y=18", "x+y=20"],
  ];
  it.each(systems)("solveFromLines(%s | %s)", (...lines) => {
    const r = system(lines as string[]);
    expect(r).not.toBeNull();
    expectDrawable(r!.steps);
  });
});
