import { beforeAll, describe, expect, it } from "vitest";
import type { LiveEngine } from "../../contracts";
import { planHandwriting } from "../../handwriting";
import { localAnswerFor } from "../../solveSteps";
import { getEngine } from "..";

/**
 * Trigonometry with teacher-quality steps (`engine/trig.ts`, `engine/trigEquation.ts`): exact
 * values at the special angles (the reference angle first when the angle is not in the first
 * quadrant), inverse functions in the line's unit, trig equations solved in an interval, and
 * identities checked line by line. Maths only, exact, drawable by the tutor's hand.
 */

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

const steps = (latex: string) => engine.simplifySteps!(latex);
const solve = (latex: string) => engine.solveLatex(latex);
const feedback = { mode: "feedback" as const };
const answer = { mode: "answer" as const };
const drawable = (lines: readonly string[]) => planHandwriting(lines, { size: 28, seed: 1 }).unsupported;

// ---------------------------------------------------------------------------------------------
// 1. Exact values
// ---------------------------------------------------------------------------------------------

const VALUES: Array<[string, string[]]> = [
  ["\\sin(60^{\\circ}) =", ["\\frac{\\sqrt{3}}{2}"]],
  ["\\tan(60^{\\circ}) =", ["\\sqrt{3}"]],
  ["\\sin(45^{\\circ})", ["\\frac{\\sqrt{2}}{2}"]],
  ["\\tan 30^{\\circ} =", ["\\frac{\\sqrt{3}}{3}"]],
  ["\\cos(\\pi) =", ["-1"]],
  ["\\sin\\left(\\frac{\\pi}{6}\\right) =", ["\\frac{1}{2}"]],
  // outside the first quadrant: the reference angle, with the sign of the quadrant
  ["\\sin(210^{\\circ}) =", ["-\\sin 30^{\\circ}", "-\\frac{1}{2}"]],
  ["\\cos(150^{\\circ}) =", ["-\\cos 30^{\\circ}", "-\\frac{\\sqrt{3}}{2}"]],
  ["\\tan 135^{\\circ} =", ["-\\tan 45^{\\circ}", "-1"]],
  ["\\cos(-45^{\\circ}) =", ["\\cos 45^{\\circ}", "\\frac{\\sqrt{2}}{2}"]],
  ["\\sin 390^{\\circ}", ["\\sin 30^{\\circ}", "\\frac{1}{2}"]],
  ["\\sin\\left(\\frac{5\\pi}{4}\\right) =", ["-\\sin\\frac{\\pi}{4}", "-\\frac{\\sqrt{2}}{2}"]],
  ["\\cos\\left(\\frac{2\\pi}{3}\\right) =", ["-\\cos\\frac{\\pi}{3}", "-\\frac{1}{2}"]],
  ["\\sin\\left(-\\frac{\\pi}{3}\\right) =", ["-\\sin\\frac{\\pi}{3}", "-\\frac{\\sqrt{3}}{2}"]],
  // on an axis: read straight off
  ["\\cos 270^{\\circ} =", ["0"]],
  // reciprocal functions: one over the function they are the reciprocal of
  ["\\sec(60^{\\circ}) =", ["\\frac{1}{\\cos 60^{\\circ}}", "2"]],
  ["\\csc(300^{\\circ}) =", ["\\frac{1}{\\sin 300^{\\circ}}", "-\\frac{1}{\\sin 60^{\\circ}}", "-\\frac{2\\sqrt{3}}{3}"]],
  ["\\cot\\left(\\frac{\\pi}{4}\\right) =", ["\\frac{1}{\\tan\\frac{\\pi}{4}}", "1"]],
  ["\\cot(90^{\\circ}) =", ["\\frac{\\cos 90^{\\circ}}{\\sin 90^{\\circ}}", "0"]],
  // no value: the division by zero, written out (never tan 90° = 1.633 × 10¹⁶, never a word)
  ["\\tan(90^{\\circ}) =", ["\\frac{\\sin 90^{\\circ}}{\\cos 90^{\\circ}}", "\\frac{1}{0}"]],
  ["\\sec(90^{\\circ}) =", ["\\frac{1}{\\cos 90^{\\circ}}", "\\frac{1}{0}"]],
  // inverse functions: the angle, in degrees unless π is on the line
  ["\\sin^{-1}\\left(\\frac{1}{2}\\right) =", ["30^{\\circ}"]],
  ["\\cos^{-1}\\left(-\\frac{1}{2}\\right) =", ["120^{\\circ}"]],
  ["\\tan^{-1}(1) =", ["45^{\\circ}"]],
  ["\\tan^{-1}(\\sqrt{3}) =", ["60^{\\circ}"]],
  ["\\arcsin\\left(\\frac{\\sqrt{2}}{2}\\right) =", ["45^{\\circ}"]],
  ["\\sin^{-1}\\left(\\frac{1}{2}\\right) + \\pi =", ["\\frac{\\pi}{6} + \\pi", "\\frac{7\\pi}{6}"]],
  // several values: written in, each term, the total
  ["\\sin^{2}(30^{\\circ}) + \\cos^{2}(30^{\\circ}) =", ["\\left(\\frac{1}{2}\\right)^{2} + \\left(\\frac{\\sqrt{3}}{2}\\right)^{2}", "\\frac{1}{4} + \\frac{3}{4}", "1"]],
  ["2\\sin 30^{\\circ}\\cos 30^{\\circ} =", ["2 \\cdot \\frac{1}{2} \\cdot \\frac{\\sqrt{3}}{2}", "\\frac{\\sqrt{3}}{2}"]],
];

describe("exact trig values (simplifySteps)", () => {
  it.each(VALUES)("%s", (latex, expected) => {
    expect(steps(latex)).toEqual(expected);
    expect(drawable(expected)).toEqual([]);
  });

  it("not a special angle: nothing exact to write (the calculator's decimal stays the answer)", () => {
    expect(steps("\\sin 20^{\\circ} =")).toBeNull();
    expect(engine.analyzeLine("\\sin 20^{\\circ} =", answer).resultLatex).toBe("0.342");
    expect(steps("\\sin(1) =")).toBeNull();
  });

  it("the answer after `=` is the exact value", () => {
    expect(engine.analyzeLine("\\sin(60^{\\circ}) =", answer).resultLatex).toBe("\\frac{\\sqrt{3}}{2}");
    expect(engine.analyzeLine("\\cos 60^{\\circ} + 1", feedback).resultLatex).toBe("\\frac{3}{2}");
    expect(engine.analyzeLine("\\sin^{-1}\\left(\\frac{1}{2}\\right) =", answer).resultLatex).toBe("30^{\\circ}");
    expect(localAnswerFor(engine, "\\tan(60^{\\circ}) =")).toBe("\\sqrt{3}");
  });

  it("no value is no answer, not a huge number: tan 90°, sin^{-1}(2)", () => {
    expect(engine.analyzeLine("\\tan(90^{\\circ}) =", answer).resultLatex).toBe("");
    expect(engine.calculate("\\tan(90^{\\circ})")).toBeNull();
    expect(localAnswerFor(engine, "\\tan(90^{\\circ}) =")).toBeNull();
    expect(engine.analyzeLine("\\sin^{-1}(2) =", answer).resultLatex).toBe("");
    expect(steps("\\sin^{-1}(2) =")).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// 2. Trig equations
// ---------------------------------------------------------------------------------------------

const EQUATIONS: Array<[string, string[]]> = [
  // no interval written: one turn from 0, degrees — written first, in maths
  ["\\sin x = \\frac{1}{2}", ["0^{\\circ} \\le x < 360^{\\circ}", "\\sin^{-1}\\left(\\frac{1}{2}\\right) = 30^{\\circ}", "x = 30^{\\circ}, \\ x = 180^{\\circ} - 30^{\\circ}", "x = 30^{\\circ}, \\ x = 150^{\\circ}"]],
  [
    "2\\cos x - 1 = 0",
    ["0^{\\circ} \\le x < 360^{\\circ}", "2\\cos x = 1", "\\cos x = \\frac{1}{2}", "\\cos^{-1}\\left(\\frac{1}{2}\\right) = 60^{\\circ}", "x = 60^{\\circ}, \\ x = 360^{\\circ} - 60^{\\circ}", "x = 60^{\\circ}, \\ x = 300^{\\circ}"],
  ],
  ["\\tan x = 1", ["0^{\\circ} \\le x < 360^{\\circ}", "\\tan^{-1}(1) = 45^{\\circ}", "x = 45^{\\circ}, \\ x = 180^{\\circ} + 45^{\\circ}", "x = 45^{\\circ}, \\ x = 225^{\\circ}"]],
  // negative values: the reference angle of the size, the quadrants of the sign
  [
    "2\\sin x + \\sqrt{3} = 0",
    ["0^{\\circ} \\le x < 360^{\\circ}", "2\\sin x = -\\sqrt{3}", "\\sin x = -\\frac{\\sqrt{3}}{2}", "\\sin^{-1}\\left(\\frac{\\sqrt{3}}{2}\\right) = 60^{\\circ}", "x = 180^{\\circ} + 60^{\\circ}, \\ x = 360^{\\circ} - 60^{\\circ}", "x = 240^{\\circ}, \\ x = 300^{\\circ}"],
  ],
  ["\\cos\\theta = -\\frac{1}{2}", ["0^{\\circ} \\le \\theta < 360^{\\circ}", "\\cos^{-1}\\left(\\frac{1}{2}\\right) = 60^{\\circ}", "\\theta = 180^{\\circ} - 60^{\\circ}, \\ \\theta = 180^{\\circ} + 60^{\\circ}", "\\theta = 120^{\\circ}, \\ \\theta = 240^{\\circ}"]],
  ["\\tan x = -\\sqrt{3}", ["0^{\\circ} \\le x < 360^{\\circ}", "\\tan^{-1}(\\sqrt{3}) = 60^{\\circ}", "x = 180^{\\circ} - 60^{\\circ}, \\ x = 360^{\\circ} - 60^{\\circ}", "x = 120^{\\circ}, \\ x = 300^{\\circ}"]],
  ["\\sin x = 0", ["0^{\\circ} \\le x < 360^{\\circ}", "x = 0^{\\circ}, \\ x = 180^{\\circ}"]],
  ["\\sin x = 2", ["-1 \\le \\sin x \\le 1", "\\varnothing"]],
  [
    "(2\\sin x - 1)(\\sin x - 2) = 0",
    [
      "0^{\\circ} \\le x < 360^{\\circ}",
      "2\\sin x - 1 = 0, \\ \\sin x - 2 = 0",
      "2\\sin x = 1, \\ \\sin x = 2",
      "\\sin x = \\frac{1}{2}, \\ \\sin x = 2",
      "-1 \\le \\sin x \\le 1",
      "\\sin^{-1}\\left(\\frac{1}{2}\\right) = 30^{\\circ}",
      "x = 30^{\\circ}, \\ x = 180^{\\circ} - 30^{\\circ}",
      "x = 30^{\\circ}, \\ x = 150^{\\circ}",
    ],
  ],
  // quadratics in the function, through the engine's own factoring
  [
    "\\sin^{2} x = \\frac{1}{4}",
    [
      "0^{\\circ} \\le x < 360^{\\circ}",
      "4\\sin^{2} x = 1",
      "\\sin x = \\frac{1}{2}, \\ \\sin x = -\\frac{1}{2}",
      "\\sin^{-1}\\left(\\frac{1}{2}\\right) = 30^{\\circ}",
      "x = 30^{\\circ}, \\ x = 180^{\\circ} - 30^{\\circ}, \\ x = 180^{\\circ} + 30^{\\circ}, \\ x = 360^{\\circ} - 30^{\\circ}",
      "x = 30^{\\circ}, \\ x = 150^{\\circ}, \\ x = 210^{\\circ}, \\ x = 330^{\\circ}",
    ],
  ],
  [
    "2\\sin^{2} x - \\sin x - 1 = 0",
    [
      "0^{\\circ} \\le x < 360^{\\circ}",
      "(2\\sin x + 1)(\\sin x - 1) = 0",
      "\\sin x = -\\frac{1}{2}, \\ \\sin x = 1",
      "\\sin^{-1}\\left(\\frac{1}{2}\\right) = 30^{\\circ}",
      "x = 90^{\\circ}, \\ x = 180^{\\circ} + 30^{\\circ}, \\ x = 360^{\\circ} - 30^{\\circ}",
      "x = 90^{\\circ}, \\ x = 210^{\\circ}, \\ x = 330^{\\circ}",
    ],
  ],
  // the interval written on the line: its unit, no interval line
  ["\\sin x = \\frac{1}{2}, \\ 0 \\le x < 2\\pi", ["\\sin^{-1}\\left(\\frac{1}{2}\\right) = \\frac{\\pi}{6}", "x = \\frac{\\pi}{6}, \\ x = \\pi - \\frac{\\pi}{6}", "x = \\frac{\\pi}{6}, \\ x = \\frac{5\\pi}{6}"]],
  ["\\sin x = \\frac{1}{2} \\quad 0 \\leq x < 360^{\\circ}", ["\\sin^{-1}\\left(\\frac{1}{2}\\right) = 30^{\\circ}", "x = 30^{\\circ}, \\ x = 180^{\\circ} - 30^{\\circ}", "x = 30^{\\circ}, \\ x = 150^{\\circ}"]],
  ["\\cos x = 1, \\ 0 \\le x \\le 360^{\\circ}", ["x = 0^{\\circ}, \\ x = 360^{\\circ}"]],
  ["\\cos x = \\frac{\\sqrt{2}}{2}, \\ -180^{\\circ} \\le x \\le 180^{\\circ}", ["\\cos^{-1}\\left(\\frac{\\sqrt{2}}{2}\\right) = 45^{\\circ}", "x = -45^{\\circ}, \\ x = 45^{\\circ}"]],
  // a multiple or shifted angle: the argument over its own range, then x
  [
    "\\sin 2x = \\frac{\\sqrt{3}}{2}",
    ["0^{\\circ} \\le x < 360^{\\circ}", "\\sin^{-1}\\left(\\frac{\\sqrt{3}}{2}\\right) = 60^{\\circ}", "2x = 60^{\\circ}, \\ 2x = 120^{\\circ}, \\ 2x = 420^{\\circ}, \\ 2x = 480^{\\circ}", "x = 30^{\\circ}, \\ x = 60^{\\circ}, \\ x = 210^{\\circ}, \\ x = 240^{\\circ}"],
  ],
  ["\\cos(x - 30^{\\circ}) = \\frac{1}{2}", ["0^{\\circ} \\le x < 360^{\\circ}", "\\cos^{-1}\\left(\\frac{1}{2}\\right) = 60^{\\circ}", "x - 30^{\\circ} = 60^{\\circ}, \\ x - 30^{\\circ} = 300^{\\circ}", "x = 90^{\\circ}, \\ x = 330^{\\circ}"]],
  ["\\sin(2x) = 1, \\ 0 \\le x < 2\\pi", ["2x = \\frac{\\pi}{2}, \\ 2x = \\frac{5\\pi}{2}", "x = \\frac{\\pi}{4}, \\ x = \\frac{5\\pi}{4}"]],
  // two functions: through tan, or sin² + cos² = 1
  ["\\sin x = \\cos x", ["0^{\\circ} \\le x < 360^{\\circ}", "\\tan x = 1", "\\tan^{-1}(1) = 45^{\\circ}", "x = 45^{\\circ}, \\ x = 180^{\\circ} + 45^{\\circ}", "x = 45^{\\circ}, \\ x = 225^{\\circ}"]],
  [
    "2\\sin^{2} x + 3\\cos x - 3 = 0",
    [
      "0^{\\circ} \\le x < 360^{\\circ}",
      "2(1 - \\cos^{2} x) + 3\\cos x - 3 = 0",
      "2 - 2\\cos^{2} x + 3\\cos x - 3 = 0",
      "2\\cos^{2} x - 3\\cos x + 1 = 0",
      "\\cos x = \\frac{1}{2}, \\ \\cos x = 1",
      "\\cos^{-1}\\left(\\frac{1}{2}\\right) = 60^{\\circ}",
      "x = 0^{\\circ}, \\ x = 60^{\\circ}, \\ x = 360^{\\circ} - 60^{\\circ}",
      "x = 0^{\\circ}, \\ x = 60^{\\circ}, \\ x = 300^{\\circ}",
    ],
  ],
  ["\\sin x = 0.5", ["0^{\\circ} \\le x < 360^{\\circ}", "\\sin^{-1}\\left(\\frac{1}{2}\\right) = 30^{\\circ}", "x = 30^{\\circ}, \\ x = 180^{\\circ} - 30^{\\circ}", "x = 30^{\\circ}, \\ x = 150^{\\circ}"]],
];

describe("trig equations (solveLatex)", () => {
  it.each(EQUATIONS)("%s", (latex, expected) => {
    const r = solve(latex);
    expect(r?.steps).toEqual(expected);
    expect(r?.latex).toBe(expected[expected.length - 1]);
    expect(drawable(expected)).toEqual([]);
  });

  it("refuses what it cannot do exactly, instead of thirty radians from the root-finder", () => {
    for (const latex of ["\\sin x = \\frac{1}{3}", "\\sin x = x", "\\cos x = 0.3", "\\sin(x^{2}) = \\frac{1}{2}", "\\sin x + \\tan x = 1"]) expect(solve(latex)).toBeNull();
  });

  it("a trig identity the student writes is still checked, not solved", () => {
    for (const latex of ["\\sin^{2} x + \\cos^{2} x = 1", "\\tan x = \\frac{\\sin x}{\\cos x}", "\\sin 2x = 2\\sin x\\cos x", "\\cos 2x = 1 - 2\\sin^{2} x", "\\sec^{2} x - 1 = \\tan^{2} x"]) {
      expect(engine.analyzeLine(latex, feedback).verdict).toBe("ok");
    }
  });
});

// ---------------------------------------------------------------------------------------------
// 3. Simplifying with the identities (simplifySteps)
// ---------------------------------------------------------------------------------------------

const IDENTITIES: Array<[string, string[]]> = [
  // double angle, then cancel
  ["\\frac{\\sin 2x}{\\sin x}", ["\\frac{2\\sin x \\cos x}{\\sin x}", "2\\cos x"]],
  ["\\frac{\\sin 2\\theta}{2\\cos\\theta}", ["\\frac{2\\sin\\theta \\cos\\theta}{2\\cos\\theta}", "\\sin\\theta"]],
  // the form of cos 2x that cancels
  ["\\frac{1 - \\cos 2x}{\\sin 2x}", ["\\frac{1 - (1 - 2\\sin^{2} x)}{2\\sin x \\cos x}", "\\frac{\\sin x}{\\cos x}", "\\tan x"]],
  ["\\frac{\\sin 2x}{1 + \\cos 2x}", ["\\frac{2\\sin x \\cos x}{1 + (2\\cos^{2} x - 1)}", "\\frac{\\sin x}{\\cos x}", "\\tan x"]],
  // Pythagoras
  ["1 - \\sin^{2} x", ["\\cos^{2} x"]],
  ["\\sin^{2} x + \\cos^{2} x", ["1"]],
  ["\\sec^{2} x - 1", ["\\tan^{2} x"]],
  ["1 + \\tan^{2} x", ["\\sec^{2} x"]],
  ["(1 - \\cos x)(1 + \\cos x)", ["1 - \\cos^{2} x", "\\sin^{2} x"]],
  ["\\frac{\\cos^{2} x}{1 - \\sin^{2} x}", ["\\frac{\\cos^{2} x}{\\cos^{2} x}", "1"]],
  // tan as sin over cos, and back
  ["\\frac{\\sin x}{\\cos x}", ["\\tan x"]],
  ["\\tan x \\cos x", ["\\frac{\\sin x}{\\cos x}\\cos x", "\\sin x"]],
];

describe("trig identities (simplifySteps)", () => {
  it.each(IDENTITIES)("%s", (latex, expected) => {
    expect(steps(latex)).toEqual(expected);
    expect(drawable(expected)).toEqual([]);
  });

  it("writes nothing when the identities do not make it simpler", () => {
    for (const latex of ["\\sin x + \\cos x", "2\\sin x", "\\sin x \\cos x", "\\cos^{2} x - \\sin^{2} x"]) expect(steps(latex)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// 4. A proof column: each `= …` line checked against the one above
// ---------------------------------------------------------------------------------------------

const column = (lines: string[]) => {
  const out: string[] = [];
  let previous: ReturnType<LiveEngine["analyzeLine"]> | undefined;
  for (const l of lines) {
    const a = engine.analyzeLine(l, { ...feedback, previous });
    out.push(a.verdict);
    previous = a;
  }
  return out;
};

describe("step-to-step rewrites (analyzeLine)", () => {
  it("a right rewrite is ok, a wrong one is a mismatch", () => {
    expect(column(["\\frac{\\sin 2x}{1 + \\cos 2x}", "= \\frac{2\\sin x\\cos x}{2\\cos^{2} x}", "= \\frac{\\sin x}{\\cos x}", "= \\tan x"])).toEqual(["none", "ok", "ok", "ok"]);
    expect(column(["\\frac{\\sin 2x}{1 + \\cos 2x}", "= \\frac{2\\sin x\\cos x}{2\\cos^{2} x}", "= \\frac{\\sin x}{2\\cos x}"])).toEqual(["none", "ok", "mismatch"]);
    expect(column(["1 - \\sin^{2} x", "\\cos^{2} x"])).toEqual(["none", "ok"]);
    expect(column(["1 - \\sin^{2} x", "= \\sin^{2} x"])).toEqual(["none", "mismatch"]);
  });

  it("a lone `=` is still an unfinished line", () => {
    expect(engine.analyzeLine("=", { ...feedback, previous: engine.analyzeLine("\\sin x", feedback) }).kind).toBe("incomplete");
  });
});
