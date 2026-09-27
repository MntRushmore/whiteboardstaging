import { beforeAll, describe, expect, it } from "vitest";
import type { EngineVerdict, LiveEngine } from "../../contracts";
import { planHandwriting } from "../../handwriting";
import { analyzeColumn, localSolve } from "../../localSolve";
import { getEngine } from "..";

/**
 * A line's standard form `Ax + By = C` (`linearFunctions.ts`): asked for with the template
 * `Ax + By = C` or the student's own `\text{standard form}` under the line (or above the line
 * Solve is pressed on), from slope-intercept, point-slope, two points or a point and a slope;
 * `y = mx + b` asks the other way. Whole numbers, A > 0, no common factor. The template is not a
 * step: the student's next line is checked against the line above it.
 */

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

const solveIn = (lines: string[]) => localSolve(engine, lines);
const verdicts = (lines: string[]): EngineVerdict[] => analyzeColumn(engine, lines, "feedback").map((a) => a?.verdict ?? "none");

function expectDrawable(steps: readonly string[]) {
  const plan = planHandwriting(steps, { size: 28, seed: 1 });
  expect(plan.unsupported).toEqual([]);
  for (const s of steps) expect(s).not.toMatch(/\\text/);
}

describe("standard form Ax + By = C, round by round", () => {
  it.each([
    // slope-intercept: the fractions cleared, then x brought over
    [["y = -\\frac{2}{3}x + 2", "Ax + By = C"], ["3y = -2x + 6", "2x + 3y = 6"]],
    [["y = -\\frac{3}{4}x - \\frac{5}{2}", "Ax + By = C"], ["4y = -3x - 10", "3x + 4y = -10"]],
    // A made positive
    [["y = 2x - 1", "Ax + By = C"], ["-2x + y = -1", "2x - y = 1"]],
    [["y = \\frac{1}{2}x + 3", "Ax + By = C"], ["2y = x + 6", "-x + 2y = 6", "x - 2y = -6"]],
    // a zero intercept, a negative slope of -1
    [["y = 3x", "Ax + By = C"], ["-3x + y = 0", "3x - y = 0"]],
    [["y = -x", "Ax + By = C"], ["x + y = 0"]],
    // point-slope: the bracket expanded first
    [["y - 3 = 2(x - 1)", "\\text{standard form}"], ["y - 3 = 2x - 2", "-2x + y = 1", "2x - y = -1"]],
    [["y + 2 = -\\frac{1}{3}(x - 6)", "Ax + By = C"], ["y + 2 = -\\frac{1}{3}x + 2", "3y + 6 = -x + 6", "x + 3y = 0"]],
    // decimals are cleared like fractions
    [["y = 0.5x + 2", "Ax + By = C"], ["2y = x + 4", "-x + 2y = 4", "x - 2y = -4"]],
    // a common factor divided out
    [["4x + 6y = 12", "Ax + By = C"], ["2x + 3y = 6"]],
    [["6x = 4y + 10", "Ax + By = C"], ["6x - 4y = 10", "3x - 2y = 5"]],
    // two points, and a point with a slope: the line through them, then its standard form
    [["(2, 3), (5, 9)", "Ax + By = C"], ["m = \\frac{9 - 3}{5 - 2}", "m = \\frac{6}{3}", "m = 2", "y - 3 = 2(x - 2)", "y - 3 = 2x - 4", "-2x + y = -1", "2x - y = 1"]],
    [["m = 2", "(1, 3)", "Ax + By = C"], ["y - 3 = 2(x - 1)", "y - 3 = 2x - 2", "-2x + y = 1", "2x - y = -1"]],
    // a vertical line is already standard form
    [["(2, 3), (2, 7)", "Ax + By = C"], ["m = \\frac{7 - 3}{2 - 2}", "m = \\frac{4}{0}", "x = 2"]],
  ])("%j", (lines, steps) => {
    const got = solveIn(lines);
    expect(got.source).toBe("solveFromLines");
    expect(got.steps).toEqual(steps);
    expectDrawable(steps);
  });

  it("asked above the line Solve is pressed on (a template or the word), from the student's own line", () => {
    expect(solveIn(["Ax + By = C", "y = -\\frac{2}{3}x + 2"]).steps).toEqual(["3y = -2x + 6", "2x + 3y = 6"]);
    expect(solveIn(["\\text{standard form}", "y = 2x - 1"]).steps).toEqual(["-2x + y = -1", "2x - y = 1"]);
    // half-way through: the student's line is carried on, not started again
    expect(solveIn(["y = -\\frac{2}{3}x + 2", "Ax + By = C", "3y = -2x + 6"]).steps).toEqual(["2x + 3y = 6"]);
  });

  it("the other way: y = mx + b under a standard-form line", () => {
    expect(solveIn(["2x + 3y = 6", "y = mx + b"]).steps).toEqual(["3y = -2x + 6", "y = -\\frac{2}{3}x + 2"]);
    expect(solveIn(["x - 2y = 8", "\\text{slope-intercept form}"]).steps).toEqual(["-2y = -x + 8", "y = \\frac{1}{2}x - 4"]);
    // the existing ask still works
    expect(solveIn(["2x + 3y = 6", "y = ?"]).steps).toEqual(["3y = -2x + 6", "y = -\\frac{2}{3}x + 2"]);
  });

  it("a form asked above two different lines is a system's heading: the system is still solved", () => {
    expect(solveIn(["\\text{standard form}", "x + y = 10", "x - y = 2"]).steps.slice(-2)).toEqual(["y = 10 - 6", "y = 4"]);
    expect(solveIn(["Ax + By = C", "y = 2x + 1", "y = -x + 4"]).steps.slice(-2)).toEqual(["y = 2(1) + 1", "y = 3"]);
    // a slope and a point above are not a second line
    expect(solveIn(["m = 2", "(1, 3)", "Ax + By = C", "y - 3 = 2(x - 1)"]).steps).toEqual(["y - 3 = 2x - 2", "-2x + y = 1", "2x - y = -1"]);
  });

  it("writes nothing when the line is already in the form asked for (and not a system of the lines above)", () => {
    expect(solveIn(["2x + 3y = 6", "Ax + By = C"]).source).toBeNull();
    expect(solveIn(["y = -\\frac{2}{3}x + 2", "Ax + By = C", "3y = -2x + 6", "2x + 3y = 6"]).source).toBeNull();
  });

  it("changes nothing unasked: a lone line, a lone equation in x and y, the template alone", () => {
    expect(solveIn(["y = -\\frac{2}{3}x + 2"]).source).toBeNull();
    expect(solveIn(["x + y = 10"]).source).toBeNull();
    expect(solveIn(["Ax + By = C"]).source).toBeNull();
    // `y - 3 = 2(x - 1)` alone is still written as y = mx + b
    expect(solveIn(["y - 3 = 2(x - 1)"]).steps).toEqual(["y - 3 = 2x - 2", "y = 2x + 1"]);
  });
});

describe("the student's own standard-form work is checked", () => {
  it("ticks each right step and rings a wrong one, with the template between", () => {
    expect(verdicts(["y = -\\frac{2}{3}x + 2", "Ax + By = C", "3y = -2x + 6", "2x + 3y = 6"])).toEqual(["none", "unknown", "ok", "ok"]);
    expect(verdicts(["y = -\\frac{2}{3}x + 2", "Ax + By = C", "3y = -2x + 6", "2x - 3y = 6"])).toEqual(["none", "unknown", "ok", "mismatch"]);
    expect(verdicts(["y = 2x - 1", "\\text{standard form}", "-2x + y = -1", "2x - y = 1"])).toEqual(["none", "unknown", "ok", "ok"]);
    expect(verdicts(["y = 2x - 1", "\\text{standard form}", "2x + y = 1"])).toEqual(["none", "unknown", "mismatch"]);
  });

  it("the template under a line is not a step, not a word problem, and not a label (Solve answers it)", () => {
    const [, template] = analyzeColumn(engine, ["y = -\\frac{2}{3}x + 2", "Ax + By = C"], "answer");
    expect(template?.kind).toBe("unknown");
    const [, word] = analyzeColumn(engine, ["y = -\\frac{2}{3}x + 2", "\\text{standard form}"], "answer");
    expect(word?.kind).toBe("unknown");
  });
});
