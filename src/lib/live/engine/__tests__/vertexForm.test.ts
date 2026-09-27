import { beforeAll, describe, expect, it } from "vitest";
import type { EngineVerdict, LiveEngine } from "../../contracts";
import { planHandwriting } from "../../handwriting";
import { analyzeColumn, localSolve } from "../../localSolve";
import { getEngine } from "..";

/**
 * A quadratic's vertex form, vertex and standard form (`quadraticForms.ts`): completing the
 * square round by round (a factored out, half the x coefficient squared, added and subtracted,
 * brought out, collected), the vertex from -b/2a and f(h) or read off a vertex form, and a vertex
 * form expanded back. Asked under the quadratic with a template (`y = a(x - h)^{2} + k`,
 * `y = ax^{2} + bx + c`), `(h, k) = ?`, or the student's own word (`\text{vertex}`,
 * `\text{vertex form}`, `\text{standard form}`). Exact fractions throughout.
 */

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

const solveIn = (lines: string[]) => localSolve(engine, lines);
const verdicts = (lines: string[]): EngineVerdict[] => analyzeColumn(engine, lines, "feedback").map((a) => a?.verdict ?? "none");

/** Drawable, and no word but one the student wrote. */
function expectDrawable(steps: readonly string[], lines: readonly string[]) {
  const plan = planHandwriting(steps, { size: 28, seed: 1 });
  expect(plan.unsupported).toEqual([]);
  const own = lines.join(" ");
  for (const s of steps) for (const m of s.matchAll(/\\text\s*\{([^}]*)\}/g)) expect(own).toContain(m[0]);
}

describe("vertex form by completing the square", () => {
  it.each([
    [["y = x^{2} + 6x + 5", "y = a(x - h)^{2} + k"], ["\\left(\\frac{6}{2}\\right)^{2} = 9", "y = (x^{2} + 6x + 9) - 9 + 5", "y = (x + 3)^{2} - 4"]],
    [["y = x^{2} - 4x", "y = a(x - h)^{2} + k"], ["\\left(\\frac{-4}{2}\\right)^{2} = 4", "y = (x^{2} - 4x + 4) - 4", "y = (x - 2)^{2} - 4"]],
    // a ≠ 1: factored out of the x terms first
    [
      ["y = 2x^{2} - 12x + 7", "y = a(x - h)^{2} + k"],
      ["y = 2(x^{2} - 6x) + 7", "\\left(\\frac{-6}{2}\\right)^{2} = 9", "y = 2(x^{2} - 6x + 9 - 9) + 7", "y = 2(x^{2} - 6x + 9) - 18 + 7", "y = 2(x - 3)^{2} - 11"],
    ],
    // a < 0, asked with the student's own words
    [
      ["y = -x^{2} + 4x + 1", "\\text{vertex form}"],
      ["y = -(x^{2} - 4x) + 1", "\\left(\\frac{-4}{2}\\right)^{2} = 4", "y = -(x^{2} - 4x + 4 - 4) + 1", "y = -(x^{2} - 4x + 4) + 4 + 1", "y = -(x - 2)^{2} + 5"],
    ],
    // fractional h and k stay exact
    [
      ["y = 2x^{2} + 3x - 1", "y = a(x - h)^{2} + k"],
      ["y = 2(x^{2} + \\frac{3}{2}x) - 1", "\\left(\\frac{3}{4}\\right)^{2} = \\frac{9}{16}", "y = 2(x^{2} + \\frac{3}{2}x + \\frac{9}{16} - \\frac{9}{16}) - 1", "y = 2(x^{2} + \\frac{3}{2}x + \\frac{9}{16}) - \\frac{9}{8} - 1", "y = 2(x + \\frac{3}{4})^{2} - \\frac{17}{8}"],
    ],
    [["y = x^{2} + 5x + 1", "y = a(x - h)^{2} + k"], ["\\left(\\frac{5}{2}\\right)^{2} = \\frac{25}{4}", "y = (x^{2} + 5x + \\frac{25}{4}) - \\frac{25}{4} + 1", "y = (x + \\frac{5}{2})^{2} - \\frac{21}{4}"]],
    // f(x) as well as y
    [["f(x) = x^{2} - 2x + 3", "f(x) = a(x - h)^{2} + k"], ["\\left(\\frac{-2}{2}\\right)^{2} = 1", "f(x) = (x^{2} - 2x + 1) - 1 + 3", "f(x) = (x - 1)^{2} + 2"]],
  ])("%j", (lines, steps) => {
    const got = solveIn(lines);
    expect(got.source).toBe("solveFromLines");
    expect(got.steps).toEqual(steps);
    expectDrawable(steps, lines);
  });

  it("asked above the line Solve is pressed on; a half-way line of the student's is finished, not restarted", () => {
    expect(solveIn(["y = a(x - h)^{2} + k", "y = x^{2} + 6x + 5"]).steps).toEqual(["\\left(\\frac{6}{2}\\right)^{2} = 9", "y = (x^{2} + 6x + 9) - 9 + 5", "y = (x + 3)^{2} - 4"]);
    expect(solveIn(["y = x^{2} + 6x + 5", "y = a(x - h)^{2} + k", "y = (x^{2} + 6x + 9) - 9 + 5"]).steps).toEqual(["y = (x + 3)^{2} - 4"]);
    // already in vertex form: nothing to write
    expect(solveIn(["y = a(x - h)^{2} + k", "y = (x + 3)^{2} - 4"]).source).toBeNull();
  });
});

describe("the vertex", () => {
  it.each([
    [["y = x^{2} + 6x + 5", "(h, k) = ?"], ["h = -\\frac{6}{2(1)}", "h = -3", "k = (-3)^{2} + 6(-3) + 5", "k = 9 - 18 + 5", "k = -4", "(h, k) = (-3, -4)"]],
    [["y = -2x^{2} + 8x - 3", "(h, k) ="], ["h = -\\frac{8}{2(-2)}", "h = 2", "k = -2(2)^{2} + 8(2) - 3", "k = -8 + 16 - 3", "k = 5", "(h, k) = (2, 5)"]],
    // read off a vertex form; a negative h shown as x - (-3) first
    [["y = 2(x - 3)^{2} + 1", "(h, k) = ?"], ["(h, k) = (3, 1)"]],
    [["y = 2(x + 3)^{2} - 1", "\\text{vertex} = ?"], ["y = 2(x - (-3))^{2} - 1", "\\text{vertex} = (-3, -1)"]],
    [["y = x^{2} - 3x + 2", "\\text{vertex}"], ["h = -\\frac{-3}{2(1)}", "h = \\frac{3}{2}", "k = (\\frac{3}{2})^{2} - 3(\\frac{3}{2}) + 2", "k = \\frac{9}{4} - \\frac{9}{2} + 2", "k = -\\frac{1}{4}", "\\text{vertex} = (\\frac{3}{2}, -\\frac{1}{4})"]],
  ])("%j", (lines, steps) => {
    const got = solveIn(lines);
    expect(got.steps).toEqual(steps);
    expectDrawable(steps, lines);
  });
});

describe("back to standard form", () => {
  it.each([
    [["y = 2(x - 3)^{2} + 1", "y = ax^{2} + bx + c"], ["y = 2(x^{2} - 6x + 9) + 1", "y = 2x^{2} - 12x + 18 + 1", "y = 2x^{2} - 12x + 19"]],
    [["y = (x + 4)^{2} - 7", "\\text{standard form}"], ["y = x^{2} + 8x + 16 - 7", "y = x^{2} + 8x + 9"]],
    [["y = -(x + 2)^{2} + 5", "y = ax^{2} + bx + c"], ["y = -(x^{2} + 4x + 4) + 5", "y = -x^{2} - 4x - 4 + 5", "y = -x^{2} - 4x + 1"]],
    [["y = \\frac{1}{2}(x - 4)^{2}", "y = ax^{2} + bx + c"], ["y = \\frac{1}{2}(x^{2} - 8x + 16)", "y = \\frac{1}{2}x^{2} - 4x + 8"]],
  ])("%j", (lines, steps) => {
    expect(solveIn(lines).steps).toEqual(steps);
    expectDrawable(steps, lines);
  });

  it("an already-expanded quadratic is left alone", () => {
    expect(solveIn(["y = x^{2} + 6x + 5", "y = ax^{2} + bx + c"]).source).toBeNull();
  });
});

describe("unasked, nothing changes", () => {
  it("a lone quadratic, a template alone, a circle's centre", () => {
    expect(solveIn(["y = x^{2} + 6x + 5"]).source).toBeNull();
    expect(solveIn(["y = a(x - h)^{2} + k"]).source).toBeNull();
    expect(solveIn(["x^{2} + 6x + 5 = 0"]).steps.at(-1)).toBe("x = -5, \\ x = -1");
    // `(h, k)` under a circle is still the geometry's
    expect(solveIn(["x^{2} + y^{2} - 6x + 4y - 12 = 0", "(h, k) = ?"]).steps.at(-1)).not.toMatch(/^h = /);
  });
});

describe("the student's own vertex-form work is checked", () => {
  it("ticks a right rewrite; rings a slip in the constant or in the sign of h", () => {
    expect(verdicts(["y = x^{2} + 6x + 5", "y = (x^{2} + 6x + 9) - 9 + 5", "y = (x + 3)^{2} - 4"])).toEqual(["none", "ok", "ok"]);
    expect(verdicts(["y = x^{2} + 6x + 5", "y = a(x - h)^{2} + k", "y = (x + 3)^{2} - 4"])).toEqual(["none", "unknown", "ok"]);
    // 9 added and not taken away
    expect(verdicts(["y = x^{2} + 6x + 5", "y = (x^{2} + 6x + 9) + 5"])).toEqual(["none", "mismatch"]);
    expect(verdicts(["y = x^{2} + 6x + 5", "y = (x + 3)^{2} + 4"])).toEqual(["none", "mismatch"]);
    // the sign of h
    expect(verdicts(["y = x^{2} + 6x + 5", "y = (x - 3)^{2} - 4"])).toEqual(["none", "mismatch"]);
    // a not multiplied back in
    expect(verdicts(["y = 2x^{2} - 12x + 7", "y = 2(x - 3)^{2} - 2"])).toEqual(["none", "mismatch"]);
    // expanding back, the constant dropped
    expect(verdicts(["y = 2(x - 3)^{2} + 1", "y = 2x^{2} - 12x + 18"])).toEqual(["none", "mismatch"]);
    expect(verdicts(["y = 2(x - 3)^{2} + 1", "y = 2x^{2} - 12x + 19"])).toEqual(["none", "ok"]);
  });

  it("never rings a new function: a translation, or the next parabola", () => {
    expect(verdicts(["y = x^{2}", "y = (x - 2)^{2} + 3"])).toEqual(["none", "none"]);
    expect(verdicts(["y = (x - 2)^{2}", "y = (x - 2)^{2} + 3"])).toEqual(["none", "none"]);
    expect(verdicts(["y = x^{2} + 6x + 5", "y = 2x^{2} - 8x + 1"])).toEqual(["none", "none"]);
    expect(verdicts(["y = 2x + 1", "y = -x + 4"])).toEqual(["none", "none"]);
  });

  it("a vertex claimed under the quadratic", () => {
    expect(verdicts(["y = x^{2} + 6x + 5", "(h, k) = (-3, -4)"])).toEqual(["none", "ok"]);
    expect(verdicts(["y = x^{2} + 6x + 5", "(h, k) = (-3, 4)"])).toEqual(["none", "mismatch"]);
    expect(verdicts(["y = 2(x - 3)^{2} + 1", "\\text{vertex} = (3, 1)"])).toEqual(["none", "ok"]);
    expect(verdicts(["y = 2(x - 3)^{2} + 1", "\\text{vertex} = (-3, 1)"])).toEqual(["none", "mismatch"]);
  });

  it("an ask under the quadratic is not a label or a word problem: Solve answers it", () => {
    for (const ask of ["(h, k) = ?", "\\text{vertex} = ?", "\\text{vertex form}", "y = a(x - h)^{2} + k"]) {
      const [, a] = analyzeColumn(engine, ["y = x^{2} + 6x + 5", ask], "answer");
      expect(a?.kind, ask).toBe("unknown");
    }
  });
});
