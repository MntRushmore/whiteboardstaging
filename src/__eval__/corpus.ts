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
 *  - `interval`: a trig equation's interval, in radians (`[0, 2π)` for 0° ≤ x < 360°): its steps
 *    are compared on the roots inside it, not on the infinitely many elsewhere. `values` are
 *    radians too — `x = 30^{\circ}` is read as π/6. A length is `(0, ∞)`: only its positive root.
 *  - `point`: the answer is a point (a midpoint, an image, a circle's centre), the last one on the
 *    final line; every step with a numeric point on it must be that point.
 *  - `complexValues`: the solution set when it is not real (`x = -1 \pm 2i`), as [re, im] pairs,
 *    for a column where the student is working with `i` (N-CN.7).
 *
 * Every problem belongs to a COURSE (`courseOf`): its topic's course (`TOPIC_COURSE`) unless it
 * says otherwise. The course files (`src/__eval__/courses/*.ts`) hold the problems written for
 * the school courses; this file holds the original scoreboard.
 */
import { COURSE_PROBLEMS } from "./courses";

/** The school courses the scoreboard reports on (`docs/eval/courses.md` lists their skills). */
export const COURSES = ["algebra-1", "algebra-2", "geometry", "precalc-calc", "general"] as const;
export type Course = (typeof COURSES)[number];

import { GEOMETRY_TOPICS } from "./courses/geometry";

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
  "trig-equation",
  "trig-identity",
  // Algebra 1 (src/__eval__/courses/algebra1.ts)
  "linear-functions",
  "function-notation",
  "exponent-rules",
  "radicals",
  "polynomial-ops",
  "literal-equations",
  "sequences",
  "exponential-models",
  "statistics",
  // Algebra 2 (src/__eval__/courses/algebra2.ts)
  "complex-numbers",
  "poly-division",
  "function-ops",
  "log-properties",
  "rational-expressions",
  "series",
  "binomial",
  "variation",
  // Geometry (src/__eval__/courses/geometry.ts)
  ...GEOMETRY_TOPICS,
] as const;
export type Topic = (typeof TOPICS)[number];

/** The course a topic belongs to, unless a problem names its own (`EvalProblem.course`). */
export const TOPIC_COURSE: Record<Topic, Course> = {
  arithmetic: "general",
  "units-percent": "general",
  linear: "algebra-1",
  inequality: "algebra-1",
  "system-2x2": "algebra-1",
  substitution: "algebra-1",
  quadratic: "algebra-1",
  absolute: "algebra-1",
  "expand-factor": "algebra-1",
  "system-3x3": "algebra-2",
  rational: "algebra-2",
  radical: "algebra-2",
  exponential: "algebra-2",
  logarithmic: "algebra-2",
  derivative: "precalc-calc",
  "integral-indefinite": "precalc-calc",
  "integral-definite": "precalc-calc",
  limit: "precalc-calc",
  trig: "precalc-calc",
  "trig-equation": "precalc-calc",
  "trig-identity": "precalc-calc",
  "linear-functions": "algebra-1",
  "function-notation": "algebra-1",
  "exponent-rules": "algebra-1",
  radicals: "algebra-1",
  "polynomial-ops": "algebra-1",
  "literal-equations": "algebra-1",
  sequences: "algebra-1",
  "exponential-models": "algebra-1",
  statistics: "algebra-1",
  "complex-numbers": "algebra-2",
  "poly-division": "algebra-2",
  "function-ops": "algebra-2",
  "log-properties": "algebra-2",
  "rational-expressions": "algebra-2",
  series: "algebra-2",
  binomial: "algebra-2",
  variation: "algebra-2",
  ...(Object.fromEntries(GEOMETRY_TOPICS.map((t) => [t, "geometry"])) as Record<(typeof GEOMETRY_TOPICS)[number], Course>),
};

export interface Expectation {
  answer?: string;
  values?: Record<string, number[]>;
  /** non-real solutions, [re, im] per value (`x = -1 \pm 2i` is [[-1, -2], [-1, 2]]) */
  complexValues?: Record<string, Array<[number, number]>>;
  equivalentTo?: string;
  upToConstant?: boolean;
  /**
   * `radical`: simplest radical form — no square left under a root, no root below the bar;
   * `standard`: a line as `Ax + By = C` (whole numbers, A > 0, no common factor); `vertex`: a
   * quadratic as `y = a(x - h)^{2} + k`
   */
  form?: "factored" | "expanded" | "radical" | "standard" | "vertex";
  /** the answer is a list of numbers, in order (a five-number summary, the modes); [] is `\varnothing` */
  list?: number[];
  approxOk?: boolean;
  interval?: { lo: number; hi: number; loIn?: boolean; hiIn?: boolean };
  /** the answer is a point (a midpoint, an image, a circle's centre): the last point on the final line */
  point?: number[];
}

export interface EvalProblem {
  id: string;
  topic: Topic;
  /** the school course, when not its topic's (`TOPIC_COURSE`) */
  course?: Course;
  /** LaTeX as the student writes it, one entry per line, top to bottom */
  lines: string[];
  expect: Expectation;
  note?: string;
  /**
   * The same question restated in lines the oracle can read, for a problem whose own lines it
   * cannot (two points, a list of terms, a question under a formula): the corpus test checks the
   * expectation against these instead. Never shown to the engine.
   */
  oracle?: string[];
}

export function courseOf(p: Pick<EvalProblem, "topic" | "course">): Course {
  return p.course ?? TOPIC_COURSE[p.topic];
}

const SQRT2 = Math.SQRT2;
const SQRT3 = Math.sqrt(3);

/** The original scoreboard (every course); the course files add to it. */
export const BASE_CORPUS: readonly EvalProblem[] = [
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
  { id: "in-08", topic: "inequality", course: "algebra-2", lines: ["x^{2} - 4 < 0"], expect: { answer: "-2 < x < 2" }, note: "quadratic inequality" },
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
  { id: "xf-13", topic: "expand-factor", course: "algebra-2", lines: ["\\frac{x^{2} - 1}{x - 1}"], expect: { answer: "x + 1" }, note: "cancel a common factor" },

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
  { id: "up-04", topic: "units-percent", lines: ["2.5 \\mathrm{~h} \\text{ to } \\mathrm{min}"], expect: { answer: "150 \\mathrm{~min}", equivalentTo: "9000 \\mathrm{~s}" }, note: "`\\mathrm{min}` is minutes here, not the min() function" },
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

  // ================================================================ hardening (g2-): edge cases
  // ---------------------------------------------------------------- linear edge cases
  { id: "g2-01", topic: "linear", lines: ["\\frac{x}{3} + \\frac{x}{6} = 3"], expect: { values: { x: [6] } } },
  { id: "g2-02", topic: "linear", lines: ["5(x - 2) = 3(x + 4)"], expect: { values: { x: [11] } } },
  { id: "g2-03", topic: "linear", lines: ["4 - (x + 1) = 2x"], expect: { values: { x: [1] } }, note: "a minus in front of a bracket" },
  { id: "g2-04", topic: "linear", lines: ["3(x - 1) - 3x = 5"], expect: { answer: "\\varnothing" }, note: "the unknown cancels after expanding" },
  { id: "g2-05", topic: "linear", lines: ["\\frac{x + 2}{4} = \\frac{x}{4} + \\frac{1}{2}"], expect: { answer: "\\mathbb{R}" }, note: "identity once the fractions are cleared" },
  { id: "g2-06", topic: "linear", lines: ["0.2x - 1 = 0.6"], expect: { values: { x: [8] } }, note: "decimals" },

  // ---------------------------------------------------------------- inequalities
  { id: "g2-07", topic: "inequality", lines: ["-3 < 2x + 1 \\le 7"], expect: { answer: "-2 < x \\le 3" }, note: "compound (a chain)" },
  { id: "g2-08", topic: "inequality", course: "algebra-2", lines: ["x^{2} - x - 6 \\ge 0"], expect: { answer: "x \\le -2, \\ x \\ge 3" }, note: "quadratic, outside the roots" },
  { id: "g2-09", topic: "inequality", course: "algebra-2", lines: ["x^{2} + 2x < 8"], expect: { answer: "-4 < x < 2" }, note: "quadratic, not in standard form" },
  { id: "g2-10", topic: "inequality", course: "algebra-2", lines: ["\\frac{x - 3}{x + 1} \\le 0"], expect: { answer: "-1 < x \\le 3" }, note: "rational: the denominator's zero is excluded" },
  { id: "g2-11", topic: "inequality", lines: ["2 - 3x > 8"], expect: { answer: "x < -2" }, note: "dividing by a negative" },
  { id: "g2-12", topic: "inequality", lines: ["|2x - 1| \\ge 3"], expect: { answer: "x \\le -1, \\ x \\ge 2" }, note: "absolute value, a union" },
  { id: "g2-13", topic: "inequality", course: "algebra-2", lines: ["x^{2} + 4 < 0"], expect: { answer: "\\varnothing" }, note: "never true" },
  { id: "g2-14", topic: "inequality", course: "algebra-2", lines: ["\\frac{2}{x - 1} > 1"], expect: { answer: "1 < x < 3" }, note: "rational against a number" },

  // ---------------------------------------------------------------- absolute value
  { id: "g2-15", topic: "absolute", course: "algebra-2", lines: ["|x + 2| = |x - 4|"], expect: { values: { x: [1] } }, note: "one branch has no solution" },
  { id: "g2-16", topic: "absolute", lines: ["2|x - 3| + 1 = 9"], expect: { values: { x: [-1, 7] } } },

  // ---------------------------------------------------------------- rational / radical / exponential / log, extraneous roots
  { id: "g2-17", topic: "rational", lines: ["\\frac{x^{2}}{x - 2} = \\frac{4}{x - 2}"], expect: { values: { x: [-2] } }, note: "x = 2 is extraneous" },
  { id: "g2-18", topic: "rational", lines: ["\\frac{1}{x} + \\frac{1}{x + 1} = \\frac{5}{6}"], expect: { values: { x: [-0.6, 2] } }, note: "a quadratic after clearing" },
  { id: "g2-19", topic: "radical", lines: ["\\sqrt{2x + 3} = x"], expect: { values: { x: [3] } }, note: "x = -1 is extraneous" },
  { id: "g2-20", topic: "radical", lines: ["\\sqrt{x + 5} = x - 1"], expect: { values: { x: [4] } }, note: "x = -1 is extraneous" },
  { id: "g2-21", topic: "exponential", lines: ["9^{x} = 27"], expect: { values: { x: [1.5] } }, note: "a common base 3" },
  { id: "g2-22", topic: "exponential", lines: ["2^{x + 1} = 16"], expect: { values: { x: [3] } } },
  { id: "g2-23", topic: "logarithmic", lines: ["\\log_{3}(x) + \\log_{3}(x + 6) = 3"], expect: { values: { x: [3] } }, note: "x = -9 is extraneous" },
  { id: "g2-24", topic: "logarithmic", lines: ["\\ln(x + 1) - \\ln(x) = \\ln(2)"], expect: { values: { x: [1] } }, note: "a quotient of logs against a log" },

  // ---------------------------------------------------------------- systems
  { id: "g2-25", topic: "system-3x3", lines: ["x + y + z = 6", "x + y + z = 7", "x - y + z = 2"], expect: { answer: "\\varnothing" }, note: "inconsistent: two parallel planes" },
  { id: "g2-26", topic: "system-2x2", lines: ["\\frac{x}{2} + \\frac{y}{3} = 4", "x - y = 3"], expect: { values: { x: [6], y: [3] } }, note: "fractions" },
  { id: "g2-27", topic: "system-3x3", lines: ["2x + y - z = 2", "x - y + 2z = 7", "3x + 2y + z = 11"], expect: { values: { x: [2], y: [1], z: [3] } } },
  { id: "g2-28", topic: "system-2x2", lines: ["2x - 3y = 7", "4x - 6y = 14"], expect: { answer: "y = \\frac{2x - 7}{3}" }, note: "dependent: the same line" },
  // one linear, one not: substitution, then every root put back (`values[v][i]` is the i-th point)
  { id: "g2-44", topic: "system-2x2", course: "algebra-2", lines: ["l = w + 3", "l \\cdot w = 40"], expect: { values: { w: [-8, 5], l: [-5, 8] } }, note: "a rectangle's sides: the maths has both points (the rectangle takes w = 5)" },
  { id: "g2-45", topic: "system-2x2", course: "algebra-2", lines: ["y = x + 1", "x^{2} + y^{2} = 25"], expect: { values: { x: [-4, 3], y: [-3, 4] } }, note: "a line and a circle" },
  { id: "g2-46", topic: "system-2x2", course: "algebra-2", lines: ["x + y = 7", "xy = 12"], expect: { values: { x: [3, 4], y: [4, 3] } } },
  { id: "g2-47", topic: "system-2x2", course: "algebra-2", lines: ["y = x^{2}", "y = 2x + 3"], expect: { values: { x: [-1, 3], y: [1, 9] } }, note: "a line and a parabola" },
  { id: "g2-48", topic: "system-2x2", course: "algebra-2", lines: ["y = x + 5", "x^{2} + y^{2} = 4"], expect: { answer: "\\varnothing" }, note: "the line misses the circle" },
  { id: "g2-49", topic: "system-2x2", course: "algebra-2", lines: ["x - y = 1", "x^{2} - y^{2} = 5"], expect: { values: { x: [3], y: [2] } }, note: "the squares cancel after substituting" },

  // ---------------------------------------------------------------- factoring
  { id: "g2-29", topic: "expand-factor", course: "algebra-2", lines: ["x^{3} + 3x^{2} + 2x + 6"], expect: { answer: "(x + 3)(x^{2} + 2)", form: "factored" }, note: "grouping" },
  { id: "g2-30", topic: "expand-factor", course: "algebra-2", lines: ["27x^{3} - 8"], expect: { answer: "(3x - 2)(9x^{2} + 6x + 4)", form: "factored" }, note: "difference of cubes" },
  { id: "g2-31", topic: "expand-factor", course: "algebra-2", lines: ["x^{3} + 64"], expect: { answer: "(x + 4)(x^{2} - 4x + 16)", form: "factored" }, note: "sum of cubes" },
  { id: "g2-32", topic: "expand-factor", lines: ["3x^{2} - 12"], expect: { answer: "3(x - 2)(x + 2)", form: "factored" }, note: "common factor, then a difference of squares" },
  { id: "g2-33", topic: "expand-factor", course: "algebra-2", lines: ["\\frac{x^{2} - 9}{x^{2} + 6x + 9}"], expect: { answer: "\\frac{x - 3}{x + 3}" }, note: "cancel a common factor" },

  // ---------------------------------------------------------------- units & percent
  { id: "g2-34", topic: "units-percent", lines: ["3.5 \\mathrm{~kg} \\text{ to } \\mathrm{g}"], expect: { answer: "3500 \\mathrm{~g}" } },
  { id: "g2-35", topic: "units-percent", lines: ["12\\% \\text{ of } 250 ="], expect: { answer: "30" } },
  { id: "g2-36", topic: "units-percent", lines: ["90 \\mathrm{~min} \\text{ to } \\mathrm{h}"], expect: { answer: "1.5 \\mathrm{~h}" }, note: "`\\mathrm{min}` is minutes" },
  { id: "g2-37", topic: "units-percent", lines: ["72 \\mathrm{~km/h} \\text{ to } \\mathrm{m/s}"], expect: { answer: "20 \\mathrm{~m/s}" } },

  // ---------------------------------------------------------------- arithmetic: mixed numbers, negatives, decimals and fractions
  { id: "g2-38", topic: "arithmetic", lines: ["3\\frac{1}{3} - 1\\frac{2}{3} ="], expect: { answer: "\\frac{5}{3}" }, note: "mixed numbers" },
  { id: "g2-39", topic: "arithmetic", lines: ["1\\frac{1}{2} \\times 2\\frac{2}{3} ="], expect: { answer: "4" }, note: "mixed numbers" },
  { id: "g2-40", topic: "arithmetic", lines: ["-\\frac{3}{4} + 0.5 ="], expect: { answer: "-\\frac{1}{4}" }, note: "a fraction and a decimal" },
  { id: "g2-41", topic: "arithmetic", lines: ["(-2)^{3} - (-3)^{2} ="], expect: { answer: "-17" } },
  { id: "g2-42", topic: "arithmetic", lines: ["\\frac{2}{3} \\div (-4) ="], expect: { answer: "-\\frac{1}{6}" } },
  { id: "g2-43", topic: "arithmetic", lines: ["-4 \\times (-2.5) + 3 ="], expect: { answer: "13" } },
  // decimals must come out exact: a 4-significant-figure display once wrote 1234.5 + 1 as 1236
  { id: "d3-01", topic: "linear", lines: ["A = 2000(1.05)^{3}"], expect: { values: { A: [2315.25] } } },
  { id: "d3-02", topic: "linear", lines: ["2x = 4631.5"], expect: { values: { x: [2315.75] } } },
  { id: "d3-03", topic: "arithmetic", lines: ["1234.5 + 1 ="], expect: { answer: "1235.5" } },
  { id: "d3-04", topic: "linear", lines: ["0.04x + 12.5 = 100.9"], expect: { values: { x: [2210] } } },

  // ================================================================ t2: trig and deeper calculus
  // ---------------------------------------------------------------- exact trig values
  { id: "t2-01", topic: "trig", lines: ["\\sin(45^{\\circ}) ="], expect: { answer: "\\frac{\\sqrt{2}}{2}" } },
  { id: "t2-02", topic: "trig", lines: ["\\cos(150^{\\circ}) ="], expect: { answer: "-\\frac{\\sqrt{3}}{2}" }, note: "second quadrant: through the reference angle" },
  { id: "t2-03", topic: "trig", lines: ["\\tan\\left(\\frac{\\pi}{3}\\right) ="], expect: { answer: "\\sqrt{3}" } },
  { id: "t2-04", topic: "trig", lines: ["\\sin\\left(\\frac{5\\pi}{4}\\right) ="], expect: { answer: "-\\frac{\\sqrt{2}}{2}" } },
  { id: "t2-05", topic: "trig", lines: ["\\sec(60^{\\circ}) ="], expect: { answer: "2" }, note: "a reciprocal function" },
  { id: "t2-06", topic: "trig", lines: ["\\cos(-60^{\\circ}) ="], expect: { answer: "\\frac{1}{2}" }, note: "a negative angle" },
  { id: "t2-07", topic: "trig", lines: ["\\sin(390^{\\circ}) ="], expect: { answer: "\\frac{1}{2}" }, note: "more than a turn" },
  { id: "t2-08", topic: "trig", lines: ["\\sin^{-1}\\left(\\frac{1}{2}\\right) ="], expect: { answer: "30^{\\circ}" }, note: "inverse: degrees, the school default" },
  { id: "t2-09", topic: "trig", lines: ["\\cos^{-1}\\left(-\\frac{1}{2}\\right) ="], expect: { answer: "120^{\\circ}" } },
  { id: "t2-10", topic: "trig", lines: ["2\\sin(30^{\\circ})\\cos(30^{\\circ}) ="], expect: { answer: "\\frac{\\sqrt{3}}{2}" }, note: "values written in, then multiplied" },

  // ---------------------------------------------------------------- trig equations (radians in `values`)
  { id: "t2-11", topic: "trig-equation", lines: ["\\sin x = \\frac{1}{2}"], expect: { values: { x: [Math.PI / 6, (5 * Math.PI) / 6] }, answer: "x = 30^{\\circ}, \\ x = 150^{\\circ}", interval: { lo: 0, hi: 2 * Math.PI } }, note: "no interval written: 0° ≤ x < 360°" },
  { id: "t2-12", topic: "trig-equation", lines: ["2\\cos x - 1 = 0"], expect: { values: { x: [Math.PI / 3, (5 * Math.PI) / 3] }, answer: "x = 60^{\\circ}, \\ x = 300^{\\circ}", interval: { lo: 0, hi: 2 * Math.PI } } },
  { id: "t2-13", topic: "trig-equation", lines: ["\\tan x = 1"], expect: { values: { x: [Math.PI / 4, (5 * Math.PI) / 4] }, answer: "x = 45^{\\circ}, \\ x = 225^{\\circ}", interval: { lo: 0, hi: 2 * Math.PI } } },
  { id: "t2-14", topic: "trig-equation", lines: ["\\sin^{2} x = \\frac{1}{4}"], expect: { values: { x: [Math.PI / 6, (5 * Math.PI) / 6, (7 * Math.PI) / 6, (11 * Math.PI) / 6] }, interval: { lo: 0, hi: 2 * Math.PI } }, note: "± two values of sin x" },
  { id: "t2-15", topic: "trig-equation", lines: ["2\\sin^{2} x - \\sin x - 1 = 0"], expect: { values: { x: [Math.PI / 2, (7 * Math.PI) / 6, (11 * Math.PI) / 6] }, interval: { lo: 0, hi: 2 * Math.PI } }, note: "a quadratic in sin x" },
  { id: "t2-16", topic: "trig-equation", lines: ["\\sin x = \\frac{\\sqrt{3}}{2}, \\ 0 \\le x < 2\\pi"], expect: { values: { x: [Math.PI / 3, (2 * Math.PI) / 3] }, answer: "x = \\frac{\\pi}{3}, \\ x = \\frac{2\\pi}{3}", interval: { lo: 0, hi: 2 * Math.PI } }, note: "the interval written, in radians" },
  { id: "t2-17", topic: "trig-equation", lines: ["2\\sin x + \\sqrt{3} = 0"], expect: { values: { x: [(4 * Math.PI) / 3, (5 * Math.PI) / 3] }, interval: { lo: 0, hi: 2 * Math.PI } }, note: "a surd: third and fourth quadrants" },
  { id: "t2-18", topic: "trig-equation", lines: ["\\cos\\theta = -\\frac{1}{2}"], expect: { values: { theta: [(2 * Math.PI) / 3, (4 * Math.PI) / 3] }, interval: { lo: 0, hi: 2 * Math.PI } } },
  { id: "t2-19", topic: "trig-equation", lines: ["\\sin 2x = \\frac{\\sqrt{3}}{2}"], expect: { values: { x: [Math.PI / 6, Math.PI / 3, (7 * Math.PI) / 6, (4 * Math.PI) / 3] }, interval: { lo: 0, hi: 2 * Math.PI } }, note: "a double angle: 2x over two turns" },
  { id: "t2-20", topic: "trig-equation", lines: ["\\sin x = \\cos x"], expect: { values: { x: [Math.PI / 4, (5 * Math.PI) / 4] }, interval: { lo: 0, hi: 2 * Math.PI } }, note: "through tan x = 1" },
  { id: "t2-21", topic: "trig-equation", lines: ["2\\cos^{2} x + \\cos x - 1 = 0"], expect: { values: { x: [Math.PI / 3, Math.PI, (5 * Math.PI) / 3] }, interval: { lo: 0, hi: 2 * Math.PI } } },
  { id: "t2-22", topic: "trig-equation", lines: ["\\cos(x - 30^{\\circ}) = \\frac{1}{2}"], expect: { values: { x: [Math.PI / 2, (11 * Math.PI) / 6] }, interval: { lo: 0, hi: 2 * Math.PI } }, note: "a shifted angle" },
  { id: "t2-23", topic: "trig-equation", lines: ["2\\sin^{2} x + 3\\cos x - 3 = 0"], expect: { values: { x: [0, Math.PI / 3, (5 * Math.PI) / 3] }, interval: { lo: 0, hi: 2 * Math.PI } }, note: "sin² = 1 - cos² first" },

  // ---------------------------------------------------------------- simplifying with identities
  { id: "t2-24", topic: "trig-identity", lines: ["\\frac{\\sin 2x}{\\sin x}"], expect: { answer: "2\\cos x" }, note: "double angle, then cancel" },
  { id: "t2-25", topic: "trig-identity", lines: ["1 - \\sin^{2} x"], expect: { answer: "\\cos^{2} x" } },
  { id: "t2-26", topic: "trig-identity", lines: ["\\frac{1 - \\cos 2x}{\\sin 2x}"], expect: { answer: "\\tan x" }, note: "the form of cos 2x that cancels" },
  { id: "t2-27", topic: "trig-identity", lines: ["\\tan x \\cos x"], expect: { answer: "\\sin x" } },
  { id: "t2-28", topic: "trig-identity", lines: ["\\sec^{2} x - 1"], expect: { answer: "\\tan^{2} x" } },

  // ---------------------------------------------------------------- integration techniques
  { id: "t2-29", topic: "integral-indefinite", lines: ["\\int 2x(x^{2}+1)^{5} \\, dx"], expect: { answer: "\\frac{(x^{2} + 1)^{6}}{6} + C", upToConstant: true }, note: "substitution u = x² + 1, shown" },
  { id: "t2-30", topic: "integral-indefinite", lines: ["\\int x e^{x} \\, dx"], expect: { answer: "x e^{x} - e^{x} + C", upToConstant: true }, note: "by parts" },
  { id: "t2-31", topic: "integral-indefinite", lines: ["\\int x \\sin x \\, dx"], expect: { answer: "-x\\cos x + \\sin x + C", upToConstant: true }, note: "by parts" },
  { id: "t2-32", topic: "integral-indefinite", lines: ["\\int \\ln x \\, dx"], expect: { answer: "x\\ln x - x + C", upToConstant: true }, note: "by parts, dv = dx" },
  { id: "t2-33", topic: "integral-indefinite", lines: ["\\int \\sin^{2} x \\, dx"], expect: { answer: "\\frac{x}{2} - \\frac{\\sin 2x}{4} + C", upToConstant: true }, note: "double angle first" },
  { id: "t2-34", topic: "integral-indefinite", lines: ["\\int \\tan x \\, dx"], expect: { answer: "-\\ln|\\cos x| + C", upToConstant: true }, note: "sin/cos, then u = cos x" },
  { id: "t2-35", topic: "integral-indefinite", lines: ["\\int \\frac{1}{1 + x^{2}} \\, dx"], expect: { answer: "\\tan^{-1} x + C", upToConstant: true } },
  { id: "t2-36", topic: "integral-indefinite", lines: ["\\int \\frac{1}{x^{2} - 1} \\, dx"], expect: { answer: "\\frac{1}{2}\\ln|x - 1| - \\frac{1}{2}\\ln|x + 1| + C", upToConstant: true }, note: "partial fractions" },
  { id: "t2-37", topic: "integral-indefinite", lines: ["\\int \\frac{2x}{x^{2} + 1} \\, dx"], expect: { answer: "\\ln(x^{2} + 1) + C", upToConstant: true }, note: "f'/f" },
  { id: "t2-38", topic: "integral-indefinite", lines: ["\\int \\sin x \\cos x \\, dx"], expect: { answer: "\\frac{\\sin^{2} x}{2} + C", upToConstant: true } },
  { id: "t2-39", topic: "integral-definite", lines: ["\\int_{0}^{1} 2x(x^{2}+1)^{5} \\, dx ="], expect: { answer: "\\frac{21}{2}" }, note: "substitution: the limits change" },
  { id: "t2-40", topic: "integral-definite", lines: ["\\int_{0}^{1} x e^{x} \\, dx ="], expect: { answer: "1" }, note: "by parts with limits" },
  { id: "t2-41", topic: "integral-definite", lines: ["\\int_{0}^{\\pi} \\sin^{2} x \\, dx ="], expect: { answer: "\\frac{\\pi}{2}" } },
  { id: "t2-42", topic: "integral-definite", lines: ["\\int_{0}^{1} \\frac{1}{1 + x^{2}} \\, dx ="], expect: { answer: "\\frac{\\pi}{4}" } },

  // ---------------------------------------------------------------- harder limits
  { id: "t2-43", topic: "limit", lines: ["\\lim_{x \\to 0}\\frac{\\sqrt{x+4}-2}{x}"], expect: { answer: "\\frac{1}{4}" }, note: "the conjugate" },
  { id: "t2-44", topic: "limit", lines: ["\\lim_{x \\to 4}\\frac{\\sqrt{x}-2}{x-4}"], expect: { answer: "\\frac{1}{4}" }, note: "the conjugate" },
  { id: "t2-45", topic: "limit", lines: ["\\lim_{x \\to 0}\\frac{e^{x}-1}{x}"], expect: { answer: "1" }, note: "L'Hôpital" },
  { id: "t2-46", topic: "limit", lines: ["\\lim_{x \\to 0}\\frac{1 - \\cos x}{x^{2}} ="], expect: { answer: "\\frac{1}{2}" }, note: "L'Hôpital twice" },
  { id: "t2-47", topic: "limit", lines: ["\\lim_{x \\to 0}\\frac{\\sin 3x}{\\sin 2x}"], expect: { answer: "\\frac{3}{2}" } },

  // ---------------------------------------------------------------- harder derivatives
  { id: "t2-48", topic: "derivative", lines: ["\\frac{d}{dx}\\tan^{-1} x ="], expect: { answer: "\\frac{1}{1 + x^{2}}" } },
  { id: "t2-49", topic: "derivative", lines: ["\\frac{d^{3}}{dx^{3}} x^{5} ="], expect: { answer: "60x^{2}" }, note: "each earlier stage under the derivatives still to take" },
  { id: "t2-50", topic: "derivative", lines: ["x^{2} + y^{2} = 25", "\\frac{dy}{dx} ="], expect: { answer: "-\\frac{x}{y}" }, note: "implicit differentiation" },
  { id: "t2-51", topic: "derivative", lines: ["\\frac{d}{dx} x^{x} ="], expect: { answer: "x^{x}(\\ln x + 1)" }, note: "logarithmic differentiation" },
];

/** Every problem on the scoreboard: the original set, then the course files. */
export const CORPUS: readonly EvalProblem[] = [...BASE_CORPUS, ...COURSE_PROBLEMS];
