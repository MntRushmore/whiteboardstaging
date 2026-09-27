/**
 * The maths scoreboard's problem set: what a student writes on the board, one LaTeX string per
 * written line (top to bottom, in the same column), and what a teacher would accept as the
 * answer to pressing Solve on the LAST line.
 *
 * Written the way it arrives from Mathpix — `\frac`, `^{}`, `\left( \right)` as a student's
 * hand produces them — not the way the engine would like it. Many of these are NOT implemented
 * locally yet (limits, indefinite integrals, factoring, logarithmic equations…): that is the
 * point, the scoreboard shows them failing until they are.
 *
 * `expect` is judged semantically by `oracle.ts`, never by string equality:
 *  - `values`: the solution set, per unknown. `{ x: [2, 3] }` is "x = 2 or x = 3"; `{ x: [] }`
 *    is "no real solution"; several unknowns are one solution point of a system.
 *  - `answer`: the teacher's final line, as LaTeX. An expression (`6x + 2`) is compared by
 *    sampling, a relation (`x > 4`, `-2 < x < 2`, `y = 18 - x`) by its solution set, and
 *    `\varnothing` / `\mathbb{R}` mean "no solution" / "every real number". Next to `values` it
 *    is only how the answer is SHOWN in the report (`x = 1 \pm \sqrt{2}`); `values` is judged.
 *  - `equivalentTo`: what the answer is compared with, when the teacher's form is not one the
 *    oracle reads (`\sec^2 x` is compared as `\frac{1}{\cos^{2}(x)}`).
 *  - `upToConstant`: an antiderivative; `+ C` is dropped and any constant difference is fine.
 *  - `form`: the answer must also LOOK like this (a factorisation must be a product).
 *  - `approxOk`: a decimal is an acceptable final answer (otherwise a decimal where the teacher
 *    writes `\frac{11}{12}` or `1 + \sqrt{2}` is scored `approx`, not `ok`).
 */

export const TOPICS = [
  "arithmetic",
  "linear",
  "inequality",
  "system-2x2",
  "system-3x3",
  "substitution",
  "quadratic",
  "absolute",
  "rational",
  "radical",
  "exponential",
  "logarithmic",
  "expand-factor",
  "derivative",
  "integral-indefinite",
  "integral-definite",
  "limit",
  "units-percent",
  "trig",
] as const;
export type Topic = (typeof TOPICS)[number];

export interface Expectation {
  answer?: string;
  values?: Record<string, number[]>;
  equivalentTo?: string;
  upToConstant?: boolean;
  form?: "factored" | "expanded";
  approxOk?: boolean;
}

export interface EvalProblem {
  id: string;
  topic: Topic;
  /** LaTeX as the student writes it, one entry per line, top to bottom */
  lines: string[];
  expect: Expectation;
  note?: string;
}

const SQRT2 = Math.SQRT2;
const SQRT3 = Math.sqrt(3);

export const CORPUS: readonly EvalProblem[] = [
  // ---------------------------------------------------------------- arithmetic & fractions
  { id: "ar-01", topic: "arithmetic", lines: ["36 + 2 ="], expect: { answer: "38" } },
  { id: "ar-02", topic: "arithmetic", lines: ["7 \\times 8"], expect: { answer: "56" }, note: "no trailing =" },
  { id: "ar-03", topic: "arithmetic", lines: ["144 \\div 12 ="], expect: { answer: "12" } },
  { id: "ar-04", topic: "arithmetic", lines: ["\\frac{3}{4} + \\frac{1}{6}"], expect: { answer: "\\frac{11}{12}" } },
  { id: "ar-05", topic: "arithmetic", lines: ["\\frac{2}{3} \\times \\frac{9}{10} ="], expect: { answer: "\\frac{3}{5}" } },
  { id: "ar-06", topic: "arithmetic", lines: ["\\frac{5}{6} - \\frac{1}{4} ="], expect: { answer: "\\frac{7}{12}" } },
  { id: "ar-07", topic: "arithmetic", lines: ["\\frac{3}{4} \\div \\frac{9}{8} ="], expect: { answer: "\\frac{2}{3}" } },
  { id: "ar-08", topic: "arithmetic", lines: ["2^{5} - 3^{2} ="], expect: { answer: "23" } },
  { id: "ar-09", topic: "arithmetic", lines: ["\\sqrt{144} ="], expect: { answer: "12" } },
  { id: "ar-10", topic: "arithmetic", lines: ["(-3)^{2} + 4 \\times 5 ="], expect: { answer: "29" } },
  { id: "ar-11", topic: "arithmetic", lines: ["2 \\frac{1}{2} + 1 \\frac{3}{4} ="], expect: { answer: "\\frac{17}{4}" }, note: "mixed numbers: 2½ is 2 + ½, not 2 × ½" },
  { id: "ar-12", topic: "arithmetic", lines: ["3 + 4 \\times 2 - 6 \\div 3 ="], expect: { answer: "9" } },
  { id: "ar-13", topic: "arithmetic", lines: ["\\frac{1}{2} + \\frac{1}{3} + \\frac{1}{6} ="], expect: { answer: "1" } },

  // ---------------------------------------------------------------- linear equations
  { id: "li-01", topic: "linear", lines: ["2x + 3 = 11"], expect: { values: { x: [4] } } },
  { id: "li-02", topic: "linear", lines: ["3(x + 2) = 21"], expect: { values: { x: [5] } } },
  { id: "li-03", topic: "linear", lines: ["5x - 3 = 2x + 9"], expect: { values: { x: [4] } } },
  { id: "li-04", topic: "linear", lines: ["\\frac{x}{2} + 3 = 7"], expect: { values: { x: [8] } } },
  { id: "li-05", topic: "linear", lines: ["\\frac{x + 1}{3} = \\frac{x - 1}{2}"], expect: { values: { x: [5] } } },
  { id: "li-06", topic: "linear", lines: ["4(2x - 1) - 3(x + 2) = 5"], expect: { values: { x: [3] } } },
  { id: "li-07", topic: "linear", lines: ["7 - 2x = 15"], expect: { values: { x: [-4] } } },
  { id: "li-08", topic: "linear", lines: ["0.5x + 1.5 = 4"], expect: { values: { x: [5] } }, note: "decimals take the CAS path" },
  { id: "li-09", topic: "linear", lines: ["\\frac{2x}{3} - \\frac{x}{4} = 5"], expect: { values: { x: [12] } } },
  { id: "li-10", topic: "linear", lines: ["3x + 7 = 3x - 2"], expect: { answer: "\\varnothing" }, note: "no solution" },
  { id: "li-11", topic: "linear", lines: ["2(x + 3) = 2x + 6"], expect: { answer: "\\mathbb{R}" }, note: "identity: every x" },
  { id: "li-12", topic: "linear", lines: ["2(3 - x) + 4 = 3(x + 1) - 7"], expect: { values: { x: [14 / 5] } } },
  { id: "li-13", topic: "linear", lines: ["-3y = 12"], expect: { values: { y: [-4] } } },

  // ---------------------------------------------------------------- inequalities
  { id: "in-01", topic: "inequality", lines: ["2x + 3 > 11"], expect: { answer: "x > 4" } },
  { id: "in-02", topic: "inequality", lines: ["-2x < 6"], expect: { answer: "x > -3" }, note: "dividing by a negative flips the sign" },
  { id: "in-03", topic: "inequality", lines: ["3 - x \\geq 5"], expect: { answer: "x \\leq -2" } },
  { id: "in-04", topic: "inequality", lines: ["4x - 5 \\leq 2x + 7"], expect: { answer: "x \\leq 6" } },
  { id: "in-05", topic: "inequality", lines: ["\\frac{x}{3} - 1 < 2"], expect: { answer: "x < 9" } },
  { id: "in-06", topic: "inequality", lines: ["-3(x - 2) > 9"], expect: { answer: "x < -1" } },
  { id: "in-07", topic: "inequality", lines: ["5 - 2x \\le -1"], expect: { answer: "x \\ge 3" } },
  { id: "in-08", topic: "inequality", lines: ["x^{2} - 4 < 0"], expect: { answer: "-2 < x < 2" }, note: "quadratic inequality" },
  { id: "in-09", topic: "inequality", lines: ["|x - 1| < 3"], expect: { answer: "-2 < x < 4" }, note: "absolute-value inequality" },

  // ---------------------------------------------------------------- 2×2 systems
  { id: "sy-01", topic: "system-2x2", lines: ["x + y = 18", "x - y = 4"], expect: { values: { x: [11], y: [7] } } },
  { id: "sy-02", topic: "system-2x2", lines: ["2x + y = 7", "x - y = 2"], expect: { values: { x: [3], y: [1] } } },
  { id: "sy-03", topic: "system-2x2", lines: ["3x + 2y = 12", "x + 2y = 8"], expect: { values: { x: [2], y: [3] } } },
  { id: "sy-04", topic: "system-2x2", lines: ["y = 2x + 1", "y = -x + 7"], expect: { values: { x: [2], y: [5] } } },
  { id: "sy-05", topic: "system-2x2", lines: ["2x + 3y = 13", "5x - 2y = 4"], expect: { values: { x: [2], y: [3] } }, note: "no ±1 coefficient to isolate" },
  { id: "sy-06", topic: "system-2x2", lines: ["x + y = 18", "2x + 2y = 36"], expect: { answer: "y = 18 - x" }, note: "the same line twice" },
  { id: "sy-07", topic: "system-2x2", lines: ["x + y = 18", "x + y = 20"], expect: { answer: "\\varnothing" }, note: "parallel lines" },
  { id: "sy-08", topic: "system-2x2", lines: ["\\frac{x}{2} + y = 4", "x - y = 2"], expect: { values: { x: [4], y: [2] } } },

  // ---------------------------------------------------------------- 3×3 systems
  { id: "s3-01", topic: "system-3x3", lines: ["x + y + z = 6", "x - y + z = 2", "2x + y - z = 1"], expect: { values: { x: [1], y: [2], z: [3] } } },
  { id: "s3-02", topic: "system-3x3", lines: ["x + 2y + z = 8", "2x - y + z = 3", "x + y - z = 0"], expect: { values: { x: [1], y: [2], z: [3] } } },
  { id: "s3-03", topic: "system-3x3", lines: ["a + b + c = 9", "a - b = 1", "b - c = 1"], expect: { values: { a: [4], b: [3], c: [2] } } },
  { id: "s3-04", topic: "system-3x3", lines: ["x + y + z = 3", "2x - y + 3z = 11", "x + 2y - z = -2"], expect: { values: { x: [2], y: [-1], z: [2] } } },

  // ---------------------------------------------------------------- known-value substitution
  { id: "su-01", topic: "substitution", lines: ["x + y = 18", "y = 9", "x = ?"], expect: { values: { x: [9] } } },
  { id: "su-02", topic: "substitution", lines: ["3x + 2y = 20", "y = 4", "x = ?"], expect: { values: { x: [4] } } },
  { id: "su-03", topic: "substitution", lines: ["a = 5", "b = 2a - 3", "b = ?"], expect: { values: { b: [7] } } },
  { id: "su-04", topic: "substitution", lines: ["2x - y = 3", "x = 4", "y ="], expect: { values: { y: [5] } } },
  { id: "su-05", topic: "substitution", lines: ["v = u + a t", "u = 3", "a = 2", "t = 5", "v = ?"], expect: { values: { v: [13] } }, note: "several knowns into one formula" },

  // ---------------------------------------------------------------- quadratics
  { id: "qu-01", topic: "quadratic", lines: ["x^{2} - 5x + 6 = 0"], expect: { values: { x: [2, 3] } } },
  { id: "qu-02", topic: "quadratic", lines: ["x^{2} + 2x - 15 = 0"], expect: { values: { x: [-5, 3] } } },
  { id: "qu-03", topic: "quadratic", lines: ["x^{2} - 9 = 0"], expect: { values: { x: [-3, 3] } } },
  { id: "qu-04", topic: "quadratic", lines: ["2x^{2} - 8 = 0"], expect: { values: { x: [-2, 2] } } },
  { id: "qu-05", topic: "quadratic", lines: ["x^{2} = 4x"], expect: { values: { x: [0, 4] } } },
  { id: "qu-06", topic: "quadratic", lines: ["x^{2} - 2x - 1 = 0"], expect: { values: { x: [1 - SQRT2, 1 + SQRT2] }, answer: "x = 1 \\pm \\sqrt{2}" }, note: "surd roots: 1 ± √2" },
  { id: "qu-07", topic: "quadratic", lines: ["x^{2} + 4x + 1 = 0"], expect: { values: { x: [-2 - SQRT3, -2 + SQRT3] }, answer: "x = -2 \\pm \\sqrt{3}" }, note: "surd roots: -2 ± √3" },
  { id: "qu-08", topic: "quadratic", lines: ["x^{2} + x + 1 = 0"], expect: { values: { x: [] } }, note: "no real roots (complex roots are not a school answer)" },
  { id: "qu-09", topic: "quadratic", lines: ["x^{2} - 6x + 9 = 0"], expect: { values: { x: [3] } }, note: "double root" },
  { id: "qu-10", topic: "quadratic", lines: ["2x^{2} + 3x - 2 = 0"], expect: { values: { x: [-2, 0.5] } } },
  { id: "qu-11", topic: "quadratic", lines: ["(x - 3)(x + 4) = 0"], expect: { values: { x: [-4, 3] } } },
  { id: "qu-12", topic: "quadratic", lines: ["x^{2} + 5x = -6"], expect: { values: { x: [-3, -2] } } },
  { id: "qu-13", topic: "quadratic", lines: ["3x^{2} - 5x - 2 = 0"], expect: { values: { x: [-1 / 3, 2] } } },
  { id: "qu-14", topic: "quadratic", lines: ["x^{2} - 2 = 0"], expect: { values: { x: [-SQRT2, SQRT2] }, answer: "x = \\pm \\sqrt{2}" }, note: "x = ±√2" },

  // ---------------------------------------------------------------- absolute value
  { id: "ab-01", topic: "absolute", lines: ["|x - 3| = 5"], expect: { values: { x: [-2, 8] } } },
  { id: "ab-02", topic: "absolute", lines: ["|2x + 1| = 7"], expect: { values: { x: [-4, 3] } } },
  { id: "ab-03", topic: "absolute", lines: ["|x| + 2 = 6"], expect: { values: { x: [-4, 4] } } },
  { id: "ab-04", topic: "absolute", lines: ["|x + 4| = -2"], expect: { values: { x: [] } }, note: "an absolute value is never negative" },
  { id: "ab-05", topic: "absolute", lines: ["3|x - 1| = 12"], expect: { values: { x: [-3, 5] } } },

  // ---------------------------------------------------------------- rational equations
  { id: "ra-01", topic: "rational", lines: ["\\frac{3}{x} = 6"], expect: { values: { x: [0.5] } } },
  { id: "ra-02", topic: "rational", lines: ["\\frac{x + 2}{x - 1} = 4"], expect: { values: { x: [2] } } },
  { id: "ra-03", topic: "rational", lines: ["\\frac{1}{x} + \\frac{1}{2} = 1"], expect: { values: { x: [2] } } },
  { id: "ra-04", topic: "rational", lines: ["\\frac{2}{x - 3} = \\frac{4}{x + 1}"], expect: { values: { x: [7] } } },
  { id: "ra-05", topic: "rational", lines: ["\\frac{x}{x - 2} = \\frac{2}{x - 2} + 3"], expect: { values: { x: [] } }, note: "x = 2 is extraneous" },
  { id: "ra-06", topic: "rational", lines: ["\\frac{x^{2} - 4}{x - 2} = 5"], expect: { values: { x: [3] } } },

  // ---------------------------------------------------------------- radical equations
  { id: "rd-01", topic: "radical", lines: ["\\sqrt{x} = 5"], expect: { values: { x: [25] } } },
  { id: "rd-02", topic: "radical", lines: ["\\sqrt{x + 3} = 4"], expect: { values: { x: [13] } } },
  { id: "rd-03", topic: "radical", lines: ["\\sqrt{2x - 1} = 3"], expect: { values: { x: [5] } } },
  { id: "rd-04", topic: "radical", lines: ["\\sqrt{x + 2} = x"], expect: { values: { x: [2] } }, note: "x = -1 is extraneous" },
  { id: "rd-05", topic: "radical", lines: ["\\sqrt{x} + 2 = 7"], expect: { values: { x: [25] } } },
  { id: "rd-06", topic: "radical", lines: ["\\sqrt[3]{x} = 2"], expect: { values: { x: [8] } } },

  // ---------------------------------------------------------------- exponential equations
  { id: "ex-01", topic: "exponential", lines: ["2^{x} = 32"], expect: { values: { x: [5] } } },
  { id: "ex-02", topic: "exponential", lines: ["3^{x + 1} = 81"], expect: { values: { x: [3] } } },
  { id: "ex-03", topic: "exponential", lines: ["5^{2x} = 125"], expect: { values: { x: [1.5] } } },
  { id: "ex-04", topic: "exponential", lines: ["4^{x} = 8"], expect: { values: { x: [1.5] } } },
  { id: "ex-05", topic: "exponential", lines: ["100 \\cdot 2^{x} = 800"], expect: { values: { x: [3] } } },
  { id: "ex-06", topic: "exponential", lines: ["e^{x} = 10"], expect: { values: { x: [Math.log(10)] }, answer: "x = \\ln 10", approxOk: true }, note: "x = ln 10" },
  { id: "ex-07", topic: "exponential", lines: ["2^{x} = 10"], expect: { values: { x: [Math.log2(10)] }, answer: "x = \\log_{2} 10", approxOk: true }, note: "x = log₂ 10" },

  // ---------------------------------------------------------------- logarithmic equations
  { id: "lg-01", topic: "logarithmic", lines: ["\\log_{2}(x) = 5"], expect: { values: { x: [32] } } },
  { id: "lg-02", topic: "logarithmic", lines: ["\\log(x) = 2"], expect: { values: { x: [100] } }, note: "log is base 10" },
  { id: "lg-03", topic: "logarithmic", lines: ["\\ln(x) = 3"], expect: { values: { x: [Math.exp(3)] }, answer: "x = e^{3}" }, note: "x = e^3" },
  { id: "lg-04", topic: "logarithmic", lines: ["\\log_{3}(x + 1) = 2"], expect: { values: { x: [8] } } },
  { id: "lg-05", topic: "logarithmic", lines: ["\\log_{2}(x) + \\log_{2}(x - 2) = 3"], expect: { values: { x: [4] } }, note: "x = -2 is extraneous" },
  { id: "lg-06", topic: "logarithmic", lines: ["2\\ln(x) = \\ln(9)"], expect: { values: { x: [3] } } },
  { id: "lg-07", topic: "logarithmic", lines: ["\\log_{2}(8) ="], expect: { answer: "3" }, note: "evaluation" },

  // ---------------------------------------------------------------- expand / factor / simplify
  { id: "xf-01", topic: "expand-factor", lines: ["3(x + 2) - x"], expect: { answer: "2x + 6", form: "expanded" } },
  { id: "xf-02", topic: "expand-factor", lines: ["(x + 1)(x + 2)"], expect: { answer: "x^{2} + 3x + 2", form: "expanded" } },
  { id: "xf-03", topic: "expand-factor", lines: ["(x - 3)^{2}"], expect: { answer: "x^{2} - 6x + 9", form: "expanded" } },
  { id: "xf-04", topic: "expand-factor", lines: ["2(x + 4) + 3(x - 1)"], expect: { answer: "5x + 5", form: "expanded" } },
  { id: "xf-05", topic: "expand-factor", lines: ["(2x + 1)(x - 3)"], expect: { answer: "2x^{2} - 5x - 3", form: "expanded" } },
  { id: "xf-06", topic: "expand-factor", lines: ["(a + b)^{2}"], expect: { answer: "a^{2} + 2ab + b^{2}", form: "expanded" } },
  { id: "xf-07", topic: "expand-factor", lines: ["4x + 3y - 2x + y"], expect: { answer: "2x + 4y", form: "expanded" } },
  { id: "xf-08", topic: "expand-factor", lines: ["(x + 2)(x - 2)"], expect: { answer: "x^{2} - 4", form: "expanded" } },
  { id: "xf-09", topic: "expand-factor", lines: ["x^{2} + 5x + 6"], expect: { answer: "(x + 2)(x + 3)", form: "factored" }, note: "a bare quadratic: the teacher factorises it" },
  { id: "xf-10", topic: "expand-factor", lines: ["x^{2} - 9"], expect: { answer: "(x - 3)(x + 3)", form: "factored" } },
  { id: "xf-11", topic: "expand-factor", lines: ["6x^{2} + 9x"], expect: { answer: "3x(2x + 3)", form: "factored" } },
  { id: "xf-12", topic: "expand-factor", lines: ["2x^{2} - 7x + 3"], expect: { answer: "(2x - 1)(x - 3)", form: "factored" } },
  { id: "xf-13", topic: "expand-factor", lines: ["\\frac{x^{2} - 1}{x - 1}"], expect: { answer: "x + 1" }, note: "cancel a common factor" },

  // ---------------------------------------------------------------- derivatives
  { id: "de-01", topic: "derivative", lines: ["\\frac{d}{dx}(3x^{2} + 2x) ="], expect: { answer: "6x + 2" } },
  { id: "de-02", topic: "derivative", lines: ["\\frac{d}{dx} x^{5}"], expect: { answer: "5x^{4}" }, note: "no trailing =" },
  { id: "de-03", topic: "derivative", lines: ["\\frac{d}{dx}(x^{3} - 4x + 7) ="], expect: { answer: "3x^{2} - 4" } },
  { id: "de-04", topic: "derivative", lines: ["\\frac{d}{dx}(x^{2} \\sin x) ="], expect: { answer: "2x \\sin x + x^{2} \\cos x" }, note: "product rule" },
  { id: "de-05", topic: "derivative", lines: ["\\frac{d}{dx}\\left(\\frac{x}{x + 1}\\right) ="], expect: { answer: "\\frac{1}{(x + 1)^{2}}" }, note: "quotient rule" },
  { id: "de-06", topic: "derivative", lines: ["\\frac{d}{dx}(2x + 1)^{3} ="], expect: { answer: "6(2x + 1)^{2}" }, note: "chain rule; the student's brackets" },
  { id: "de-07", topic: "derivative", lines: ["\\frac{d}{dx} \\sin(3x) ="], expect: { answer: "3\\cos(3x)" } },
  { id: "de-08", topic: "derivative", lines: ["\\frac{d}{dx} e^{2x} ="], expect: { answer: "2e^{2x}" } },
  { id: "de-09", topic: "derivative", lines: ["\\frac{d}{dx} \\ln(x^{2} + 1) ="], expect: { answer: "\\frac{2x}{x^{2} + 1}" } },
  { id: "de-10", topic: "derivative", lines: ["\\frac{d}{dx}(x e^{x}) ="], expect: { answer: "e^{x} + x e^{x}" } },
  { id: "de-11", topic: "derivative", lines: ["\\frac{d}{dx} \\sqrt{x} ="], expect: { answer: "\\frac{1}{2\\sqrt{x}}" } },
  { id: "de-12", topic: "derivative", lines: ["y = x^{3} + 2x", "\\frac{dy}{dx} ="], expect: { answer: "3x^{2} + 2" }, note: "needs the line above" },
  { id: "de-13", topic: "derivative", lines: ["f(x) = x^{2} - 3x", "f'(x) ="], expect: { answer: "2x - 3" }, note: "needs the line above" },
  { id: "de-14", topic: "derivative", lines: ["\\frac{d^{2}}{dx^{2}}(x^{4}) ="], expect: { answer: "12x^{2}" } },
  { id: "de-15", topic: "derivative", lines: ["\\frac{d}{dx} \\tan x ="], expect: { answer: "\\sec^{2} x", equivalentTo: "\\frac{1}{\\cos^{2}(x)}" } },
  { id: "de-16", topic: "derivative", lines: ["\\frac{d}{dx}\\left(\\frac{1}{x}\\right) ="], expect: { answer: "-\\frac{1}{x^{2}}" } },

  // ---------------------------------------------------------------- indefinite integrals
  { id: "ii-01", topic: "integral-indefinite", lines: ["\\int x^{2} \\, dx"], expect: { answer: "\\frac{x^{3}}{3} + C", upToConstant: true } },
  { id: "ii-02", topic: "integral-indefinite", lines: ["\\int (3x^{2} + 2x) \\, dx"], expect: { answer: "x^{3} + x^{2} + C", upToConstant: true } },
  { id: "ii-03", topic: "integral-indefinite", lines: ["\\int \\cos x \\, dx"], expect: { answer: "\\sin x + C", upToConstant: true } },
  { id: "ii-04", topic: "integral-indefinite", lines: ["\\int e^{x} \\, dx"], expect: { answer: "e^{x} + C", upToConstant: true } },
  { id: "ii-05", topic: "integral-indefinite", lines: ["\\int \\frac{1}{x} \\, dx"], expect: { answer: "\\ln|x| + C", upToConstant: true } },
  { id: "ii-06", topic: "integral-indefinite", lines: ["\\int (4x^{3} - 6x + 1) \\, dx"], expect: { answer: "x^{4} - 3x^{2} + x + C", upToConstant: true } },
  { id: "ii-07", topic: "integral-indefinite", lines: ["\\int \\sin(2x) \\, dx"], expect: { answer: "-\\frac{1}{2}\\cos(2x) + C", upToConstant: true } },
  { id: "ii-08", topic: "integral-indefinite", lines: ["\\int x e^{x^{2}} \\, dx"], expect: { answer: "\\frac{1}{2} e^{x^{2}} + C", upToConstant: true }, note: "substitution u = x²" },
  { id: "ii-09", topic: "integral-indefinite", lines: ["\\int \\sqrt{x} \\, dx"], expect: { answer: "\\frac{2}{3} x^{\\frac{3}{2}} + C", upToConstant: true } },

  // ---------------------------------------------------------------- definite integrals
  { id: "di-01", topic: "integral-definite", lines: ["\\int_{0}^{1} x^{2} \\, dx ="], expect: { answer: "\\frac{1}{3}" } },
  { id: "di-02", topic: "integral-definite", lines: ["\\int_{0}^{\\pi} \\sin x \\, dx ="], expect: { answer: "2" } },
  { id: "di-03", topic: "integral-definite", lines: ["\\int_{1}^{3} (2x + 1) \\, dx ="], expect: { answer: "10" } },
  { id: "di-04", topic: "integral-definite", lines: ["\\int_{0}^{2} (x^{3} - x) \\, dx ="], expect: { answer: "2" } },
  { id: "di-05", topic: "integral-definite", lines: ["\\int_{1}^{e} \\frac{1}{x} \\, dx ="], expect: { answer: "1" } },
  { id: "di-06", topic: "integral-definite", lines: ["\\int_{0}^{1} e^{x} \\, dx ="], expect: { answer: "e - 1" }, note: "exact: e - 1, not 1.718" },
  { id: "di-07", topic: "integral-definite", lines: ["\\int_{-1}^{1} x^{3} \\, dx ="], expect: { answer: "0" } },
  { id: "di-08", topic: "integral-definite", lines: ["\\int_{0}^{\\frac{\\pi}{2}} \\cos x \\, dx ="], expect: { answer: "1" } },

  // ---------------------------------------------------------------- limits
  { id: "lm-01", topic: "limit", lines: ["\\lim_{x \\to 2} (3x + 1)"], expect: { answer: "7" }, note: "direct substitution" },
  { id: "lm-02", topic: "limit", lines: ["\\lim_{x \\to 3} \\frac{x^{2} - 9}{x - 3}"], expect: { answer: "6" }, note: "0/0: factor and cancel" },
  { id: "lm-03", topic: "limit", lines: ["\\lim_{x \\to 1} \\frac{x^{2} - 1}{x - 1} ="], expect: { answer: "2" }, note: "0/0: factor and cancel" },
  { id: "lm-04", topic: "limit", lines: ["\\lim_{x \\to 2} \\frac{x^{2} - 5x + 6}{x - 2}"], expect: { answer: "-1" }, note: "0/0: factor and cancel" },
  { id: "lm-05", topic: "limit", lines: ["\\lim_{x \\to \\infty} \\frac{2x + 1}{x - 3}"], expect: { answer: "2" }, note: "at infinity" },
  { id: "lm-06", topic: "limit", lines: ["\\lim_{x \\to \\infty} \\frac{3x^{2}}{x^{2} + 1}"], expect: { answer: "3" }, note: "at infinity" },
  { id: "lm-07", topic: "limit", lines: ["\\lim_{x \\to 0} \\frac{\\sin x}{x}"], expect: { answer: "1" }, note: "standard limit" },
  { id: "lm-08", topic: "limit", lines: ["\\lim_{x \\to 4} \\sqrt{x}"], expect: { answer: "2" }, note: "direct substitution" },

  // ---------------------------------------------------------------- units & percent
  { id: "up-01", topic: "units-percent", lines: ["15\\% \\text{ of } 80 ="], expect: { answer: "12" } },
  { id: "up-02", topic: "units-percent", lines: ["20\\% \\text{ of } 150"], expect: { answer: "30" } },
  { id: "up-03", topic: "units-percent", lines: ["5 \\mathrm{~km} \\text{ to } \\mathrm{m}"], expect: { answer: "5000 \\mathrm{~m}" } },
  { id: "up-04", topic: "units-percent", lines: ["2.5 \\mathrm{~h} \\text{ to } \\mathrm{min}"], expect: { answer: "150 \\mathrm{~min}", equivalentTo: "9000 \\mathrm{~s}" }, note: "`\\mathrm{min}` is read as the min() function" },
  { id: "up-05", topic: "units-percent", lines: ["60 \\mathrm{~km/h} \\text{ to } \\mathrm{m/s}"], expect: { answer: "16.67 \\mathrm{~m/s}", approxOk: true } },
  { id: "up-06", topic: "units-percent", lines: ["3 \\mathrm{~kg} \\times 9.8 \\mathrm{~m/s^{2}} ="], expect: { answer: "29.4 \\mathrm{~N}" } },
  { id: "up-07", topic: "units-percent", lines: ["80 \\times 1.15 ="], expect: { answer: "92" }, note: "a 15% increase as a multiplier" },
  { id: "up-08", topic: "units-percent", lines: ["250 \\mathrm{~cm} \\text{ to } \\mathrm{m}"], expect: { answer: "2.5 \\mathrm{~m}" } },

  // ---------------------------------------------------------------- trig evaluation
  { id: "tr-01", topic: "trig", lines: ["\\sin(30^{\\circ}) ="], expect: { answer: "\\frac{1}{2}" } },
  { id: "tr-02", topic: "trig", lines: ["\\cos(60^{\\circ}) ="], expect: { answer: "\\frac{1}{2}" } },
  { id: "tr-03", topic: "trig", lines: ["\\tan(45^{\\circ}) ="], expect: { answer: "1" } },
  { id: "tr-04", topic: "trig", lines: ["\\sin(60^{\\circ}) ="], expect: { answer: "\\frac{\\sqrt{3}}{2}" }, note: "exact value" },
  { id: "tr-05", topic: "trig", lines: ["\\cos(\\pi) ="], expect: { answer: "-1" } },
  { id: "tr-06", topic: "trig", lines: ["\\sin\\left(\\frac{\\pi}{6}\\right) ="], expect: { answer: "\\frac{1}{2}" } },
  { id: "tr-07", topic: "trig", lines: ["\\sin^{2}(30^{\\circ}) + \\cos^{2}(30^{\\circ}) ="], expect: { answer: "1" } },
  { id: "tr-08", topic: "trig", lines: ["\\tan(60^{\\circ}) ="], expect: { answer: "\\sqrt{3}" }, note: "exact value" },
];
