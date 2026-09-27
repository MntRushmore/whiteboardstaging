/**
 * Algebra 1 on the scoreboard: the skills a high-school Algebra 1 course teaches (Common Core
 * A-SSE, A-APR, A-CED, A-REI, F-IF, F-BF, F-LE, N-RN, S-ID), written as a student writes them on
 * the board — maths only, one LaTeX string per line, Solve pressed on the last. The topics the
 * original corpus already covers (linear equations, inequalities, systems, quadratics,
 * factoring) count towards Algebra 1 from `../corpus.ts`; this file adds the rest.
 * Expectations are judged by `../oracle.ts` exactly as the original corpus is; `oracle` restates
 * a problem the oracle cannot read as written (two points, a list of terms) for the corpus test.
 * `docs/eval/courses.md` maps each group to its standard.
 */
import type { EvalProblem } from "../corpus";

export const ALGEBRA_1: readonly EvalProblem[] = [
  // ---------------------------------------------------------------- lines: slope, point-slope, slope-intercept, intercepts (F-IF.6, F-LE.2, A-CED.2)
  { id: "a1-lf-01", topic: "linear-functions", lines: ["(2, 3), (5, 9)", "m = ?"], expect: { values: { m: [2] } }, oracle: ["m = \\frac{9 - 3}{5 - 2}"], note: "slope from two points" },
  { id: "a1-lf-02", topic: "linear-functions", lines: ["(-1, 4), (3, -4)", "m = ?"], expect: { values: { m: [-2] } }, oracle: ["m = \\frac{-4 - 4}{3 + 1}"] },
  { id: "a1-lf-03", topic: "linear-functions", lines: ["(0, 5)", "(4, 3)", "m ="], expect: { values: { m: [-0.5] } }, oracle: ["m = \\frac{3 - 5}{4 - 0}"], note: "the points on two lines" },
  { id: "a1-lf-04", topic: "linear-functions", lines: ["(2, 3), (5, 9)"], expect: { answer: "y = 2x - 1" }, oracle: ["y - 3 = \\frac{9 - 3}{5 - 2}(x - 2)"], note: "the line through two points" },
  { id: "a1-lf-05", topic: "linear-functions", lines: ["(-1, 4), (3, -4)"], expect: { answer: "y = -2x + 2" }, oracle: ["y - 4 = \\frac{-4 - 4}{3 + 1}(x + 1)"] },
  { id: "a1-lf-06", topic: "linear-functions", lines: ["(-2, -1), (4, 2)"], expect: { answer: "y = \\frac{1}{2}x" }, oracle: ["y + 1 = \\frac{2 + 1}{4 + 2}(x + 2)"] },
  { id: "a1-lf-07", topic: "linear-functions", lines: ["(1, 5), (4, 5)"], expect: { answer: "y = 5" }, oracle: ["y - 5 = 0"], note: "horizontal: m = 0" },
  { id: "a1-lf-08", topic: "linear-functions", lines: ["(2, 3), (2, 7)"], expect: { answer: "x = 2" }, oracle: ["x - 2 = 0"], note: "vertical: the slope's bottom is 0" },
  { id: "a1-lf-09", topic: "linear-functions", lines: ["m = 2", "(1, 3)"], expect: { answer: "y = 2x + 1" }, oracle: ["y - 3 = 2(x - 1)"], note: "a point and a slope" },
  { id: "a1-lf-10", topic: "linear-functions", lines: ["m = -\\frac{1}{2}", "(4, -1)", "y = ?"], expect: { answer: "y = -\\frac{1}{2}x + 1" }, oracle: ["y + 1 = -\\frac{1}{2}(x - 4)"] },
  { id: "a1-lf-11", topic: "linear-functions", lines: ["y - 3 = 2(x - 1)"], expect: { answer: "y = 2x + 1" }, note: "point-slope to slope-intercept" },
  { id: "a1-lf-12", topic: "linear-functions", lines: ["y + 2 = -\\frac{1}{3}(x - 6)"], expect: { answer: "y = -\\frac{1}{3}x" } },
  { id: "a1-lf-13", topic: "linear-functions", lines: ["2x + 3y = 6", "y = ?"], expect: { answer: "y = -\\frac{2}{3}x + 2" }, oracle: ["2x + 3y = 6"], note: "standard form to slope-intercept" },
  { id: "a1-lf-14", topic: "linear-functions", lines: ["x - 2y = 8", "y = ?"], expect: { answer: "y = \\frac{1}{2}x - 4" }, oracle: ["x - 2y = 8"] },
  { id: "a1-lf-15", topic: "linear-functions", lines: ["4x + 2y = 10", "y = ?"], expect: { answer: "y = -2x + 5" }, oracle: ["4x + 2y = 10"] },
  { id: "a1-lf-16", topic: "linear-functions", lines: ["3x + 4y = 12", "y = 0"], expect: { values: { x: [4] } }, note: "the x-intercept" },
  { id: "a1-lf-17", topic: "linear-functions", lines: ["3x + 4y = 12", "x = 0", "y = ?"], expect: { values: { y: [3] } }, note: "the y-intercept" },
  { id: "a1-lf-18", topic: "linear-functions", lines: ["y = \\frac{2}{3}x - 4", "x = 6", "y = ?"], expect: { values: { y: [0] } } },

  // ---------------------------------------------------------------- function notation (F-IF.1–2, F-IF.6)
  { id: "a1-fn-01", topic: "function-notation", lines: ["f(x) = 2x + 3", "f(4) ="], expect: { answer: "11" } },
  { id: "a1-fn-02", topic: "function-notation", lines: ["f(x) = x^{2} - 3x", "f(-2) ="], expect: { answer: "10" }, note: "a negative argument, bracketed" },
  { id: "a1-fn-03", topic: "function-notation", lines: ["f(x) = 2x + 3", "f(a + 1) ="], expect: { answer: "2a + 5", form: "expanded" } },
  { id: "a1-fn-04", topic: "function-notation", lines: ["g(t) = 5t - 2", "g(3) ="], expect: { answer: "13" } },
  { id: "a1-fn-05", topic: "function-notation", lines: ["f(x) = x^{2} - 3x", "\\frac{f(4) - f(1)}{4 - 1} ="], expect: { answer: "2" }, note: "average rate of change" },
  { id: "a1-fn-06", topic: "function-notation", lines: ["f(x) = 3x - 5", "f(2) + f(-1) ="], expect: { answer: "-7" } },
  { id: "a1-fn-07", topic: "function-notation", lines: ["f(x) = 2x + 3", "f(x) = 7"], expect: { values: { x: [2] } }, note: "where does f take the value 7" },
  { id: "a1-fn-08", topic: "function-notation", lines: ["f(x) = x^{2}", "g(x) = x + 6", "f(x) = g(x)"], expect: { values: { x: [-2, 3] } } },
  { id: "a1-fn-09", topic: "function-notation", lines: ["h(x) = \\frac{12}{x}", "h(4) ="], expect: { answer: "3" } },
  { id: "a1-fn-10", topic: "function-notation", lines: ["f(x) = -x^{2} + 4", "f(3) ="], expect: { answer: "-5" } },
  { id: "a1-fn-11", topic: "function-notation", lines: ["f(x) = 4x - 1", "f\\left(\\frac{1}{2}\\right) ="], expect: { answer: "1" } },
  { id: "a1-fn-12", topic: "function-notation", lines: ["P(t) = 100 + 20t", "P(5) ="], expect: { answer: "200" }, note: "any letter can name a function" },

  // ---------------------------------------------------------------- laws of exponents (A-SSE.2, N-RN.2)
  { id: "a1-ex-01", topic: "exponent-rules", lines: ["x^{3} \\cdot x^{4}"], expect: { answer: "x^{7}" } },
  { id: "a1-ex-02", topic: "exponent-rules", lines: ["(x^{2})^{3}"], expect: { answer: "x^{6}" } },
  { id: "a1-ex-03", topic: "exponent-rules", lines: ["\\frac{x^{5}}{x^{2}}"], expect: { answer: "x^{3}" } },
  { id: "a1-ex-04", topic: "exponent-rules", lines: ["x^{-2}"], expect: { answer: "\\frac{1}{x^{2}}" }, note: "a negative exponent" },
  { id: "a1-ex-05", topic: "exponent-rules", lines: ["(2x^{3}y)^{2}"], expect: { answer: "4x^{6}y^{2}" }, note: "power of a product" },
  { id: "a1-ex-06", topic: "exponent-rules", lines: ["3x^{2} \\cdot 4x^{5}"], expect: { answer: "12x^{7}" } },
  { id: "a1-ex-07", topic: "exponent-rules", lines: ["\\frac{12x^{5}y^{2}}{4x^{2}y^{5}}"], expect: { answer: "\\frac{3x^{3}}{y^{3}}" } },
  { id: "a1-ex-08", topic: "exponent-rules", lines: ["2^{3} \\cdot 2^{4} ="], expect: { answer: "128" } },
  { id: "a1-ex-09", topic: "exponent-rules", lines: ["5x^{0}"], expect: { answer: "5" }, note: "a zero exponent" },
  { id: "a1-ex-10", topic: "exponent-rules", lines: ["(-3a^{2})^{3}"], expect: { answer: "-27a^{6}" } },
  { id: "a1-ex-11", topic: "exponent-rules", lines: ["\\frac{(x^{2})^{3}}{x^{4}}"], expect: { answer: "x^{2}" } },
  { id: "a1-ex-12", topic: "exponent-rules", lines: ["2^{-3} ="], expect: { answer: "\\frac{1}{8}" } },
  { id: "a1-ex-13", topic: "exponent-rules", lines: ["x^{\\frac{1}{2}} \\cdot x^{\\frac{1}{3}}"], expect: { answer: "x^{\\frac{5}{6}}" }, note: "rational exponents" },
  { id: "a1-ex-14", topic: "exponent-rules", lines: ["\\frac{x^{3}y^{-2}}{x^{-1}y^{4}} ="], expect: { answer: "\\frac{x^{4}}{y^{6}}" } },

  // ---------------------------------------------------------------- radicals and rational exponents (N-RN.1–2)
  { id: "a1-rd-01", topic: "radicals", lines: ["\\sqrt{50}"], expect: { answer: "5\\sqrt{2}", form: "radical" } },
  { id: "a1-rd-02", topic: "radicals", lines: ["\\sqrt{12} + \\sqrt{27}"], expect: { answer: "5\\sqrt{3}", form: "radical" }, note: "like radicals" },
  { id: "a1-rd-03", topic: "radicals", lines: ["3\\sqrt{8} - \\sqrt{18}"], expect: { answer: "3\\sqrt{2}", form: "radical" } },
  { id: "a1-rd-04", topic: "radicals", lines: ["\\sqrt{6} \\cdot \\sqrt{3}"], expect: { answer: "3\\sqrt{2}", form: "radical" } },
  { id: "a1-rd-05", topic: "radicals", lines: ["\\frac{1}{\\sqrt{2}}"], expect: { answer: "\\frac{\\sqrt{2}}{2}", form: "radical" }, note: "rationalizing the denominator" },
  { id: "a1-rd-06", topic: "radicals", lines: ["\\frac{6}{\\sqrt{3}}"], expect: { answer: "2\\sqrt{3}", form: "radical" } },
  { id: "a1-rd-07", topic: "radicals", lines: ["\\sqrt[3]{54}"], expect: { answer: "3\\sqrt[3]{2}", form: "radical" } },
  { id: "a1-rd-08", topic: "radicals", lines: ["8^{\\frac{2}{3}}"], expect: { answer: "4" } },
  { id: "a1-rd-09", topic: "radicals", lines: ["27^{-\\frac{1}{3}}"], expect: { answer: "\\frac{1}{3}" } },
  { id: "a1-rd-10", topic: "radicals", lines: ["\\sqrt{\\frac{3}{4}}"], expect: { answer: "\\frac{\\sqrt{3}}{2}", form: "radical" } },
  { id: "a1-rd-11", topic: "radicals", lines: ["\\sqrt{75} ="], expect: { answer: "5\\sqrt{3}", form: "radical" } },
  { id: "a1-rd-12", topic: "radicals", lines: ["\\frac{\\sqrt{50}}{\\sqrt{2}}"], expect: { answer: "5" } },
  { id: "a1-rd-13", topic: "radicals", lines: ["2\\sqrt{3} \\cdot 5\\sqrt{6}"], expect: { answer: "30\\sqrt{2}", form: "radical" } },

  // ---------------------------------------------------------------- polynomial arithmetic (A-APR.1)
  { id: "a1-po-01", topic: "polynomial-ops", lines: ["(3x^{2} + 2x - 1) - (x^{2} - 4x + 5)"], expect: { answer: "2x^{2} + 6x - 6", form: "expanded" } },
  { id: "a1-po-02", topic: "polynomial-ops", lines: ["(x + 2)(x^{2} - 3x + 1)"], expect: { answer: "x^{3} - x^{2} - 5x + 2", form: "expanded" } },
  { id: "a1-po-03", topic: "polynomial-ops", lines: ["(2x - 3)(2x + 3)"], expect: { answer: "4x^{2} - 9", form: "expanded" } },
  { id: "a1-po-04", topic: "polynomial-ops", lines: ["(x^{2} + 3x) + (2x^{2} - x + 4)"], expect: { answer: "3x^{2} + 2x + 4", form: "expanded" } },
  { id: "a1-po-05", topic: "polynomial-ops", lines: ["2x(3x^{2} - 4x + 1)"], expect: { answer: "6x^{3} - 8x^{2} + 2x", form: "expanded" } },
  { id: "a1-po-06", topic: "polynomial-ops", lines: ["(a + 3)^{2}"], expect: { answer: "a^{2} + 6a + 9", form: "expanded" } },

  // ---------------------------------------------------------------- literal equations: a formula for one letter (A-CED.4)
  { id: "a1-le-01", topic: "literal-equations", lines: ["A = \\frac{1}{2}bh", "h = ?"], expect: { answer: "h = \\frac{2A}{b}" } },
  { id: "a1-le-02", topic: "literal-equations", lines: ["P = 2l + 2w", "w = ?"], expect: { answer: "w = \\frac{P - 2l}{2}" } },
  { id: "a1-le-03", topic: "literal-equations", lines: ["y = mx + b", "x = ?"], expect: { answer: "x = \\frac{y - b}{m}" } },
  { id: "a1-le-04", topic: "literal-equations", lines: ["C = \\frac{5}{9}(F - 32)", "F = ?"], expect: { answer: "F = \\frac{9C + 160}{5}" } },
  { id: "a1-le-05", topic: "literal-equations", lines: ["I = Prt", "r = ?"], expect: { answer: "r = \\frac{I}{Pt}" }, note: "`rt` is r·t, not a unit" },
  { id: "a1-le-06", topic: "literal-equations", lines: ["v = u + at", "a = ?"], expect: { answer: "a = \\frac{v - u}{t}" } },
  { id: "a1-le-07", topic: "literal-equations", lines: ["A = P + Prt", "P = ?"], expect: { answer: "P = \\frac{A}{1 + rt}" }, note: "the letter in two terms: factored out" },
  { id: "a1-le-08", topic: "literal-equations", lines: ["ax + b = c", "x = ?"], expect: { answer: "x = \\frac{c - b}{a}" } },
  { id: "a1-le-09", topic: "literal-equations", lines: ["A = \\pi r^{2}", "r = ?"], expect: { answer: "r = \\sqrt{\\frac{A}{\\pi}}" }, note: "a length: the positive root" },
  { id: "a1-le-10", topic: "literal-equations", lines: ["V = \\frac{4}{3}\\pi r^{3}", "r = ?"], expect: { answer: "r = \\sqrt[3]{\\frac{3V}{4\\pi}}" } },

  // ---------------------------------------------------------------- sequences: nth term, explicit and recursive (F-BF.2, F-LE.2)
  { id: "a1-sq-01", topic: "sequences", lines: ["3, 7, 11, 15, \\ldots", "a_{10} = ?"], expect: { values: { a_10: [39] } }, oracle: ["a_{10} = 3 + (10 - 1) \\cdot 4"] },
  { id: "a1-sq-02", topic: "sequences", lines: ["3, 7, 11, \\ldots", "a_{n} = ?"], expect: { answer: "a_{n} = 4n - 1" }, oracle: ["a_{n} = 3 + (n - 1) \\cdot 4"], note: "the explicit formula" },
  { id: "a1-sq-03", topic: "sequences", lines: ["2, 6, 18, \\ldots", "a_{6} = ?"], expect: { values: { a_6: [486] } }, oracle: ["a_{6} = 2 \\cdot 3^{5}"], note: "geometric" },
  { id: "a1-sq-04", topic: "sequences", lines: ["a_{1} = 2", "a_{n} = a_{n - 1} + 5", "a_{n} = ?"], expect: { answer: "a_{n} = 5n - 3" }, oracle: ["a_{n} = 2 + (n - 1) \\cdot 5"], note: "recursive to explicit" },
  { id: "a1-sq-05", topic: "sequences", lines: ["a_{1} = 3", "d = 4", "a_{20} = ?"], expect: { values: { a_20: [79] } }, oracle: ["a_{20} = 3 + 19 \\cdot 4"] },
  { id: "a1-sq-06", topic: "sequences", lines: ["a_{1} = 5", "r = 2", "a_{8} = ?"], expect: { values: { a_8: [640] } }, oracle: ["a_{8} = 5 \\cdot 2^{7}"] },
  { id: "a1-sq-07", topic: "sequences", lines: ["a_{n} = 4n - 1", "a_{10} = ?"], expect: { values: { a_10: [39] } }, oracle: ["a_{10} = 4 \\cdot 10 - 1"] },
  { id: "a1-sq-08", topic: "sequences", lines: ["10, 7, 4, \\ldots", "a_{15} = ?"], expect: { values: { a_15: [-32] } }, oracle: ["a_{15} = 10 + 14 \\cdot (-3)"], note: "a negative difference" },
  { id: "a1-sq-09", topic: "sequences", lines: ["a_{1} = 3", "a_{n} = 2a_{n - 1}", "a_{n} = ?"], expect: { answer: "a_{n} = 3 \\cdot 2^{n - 1}" }, oracle: ["a_{n} = 3 \\cdot 2^{n - 1}"] },
  { id: "a1-sq-10", topic: "sequences", lines: ["\\frac{1}{2}, 1, 2, \\ldots", "a_{7} = ?"], expect: { values: { a_7: [32] } }, oracle: ["a_{7} = \\frac{1}{2} \\cdot 2^{6}"] },

  // ---------------------------------------------------------------- exponential models, interest, percent change (F-LE.5, A-CED.1)
  { id: "a1-em-01", topic: "exponential-models", lines: ["A = P(1 + r)^{t}", "P = 1000", "r = 0.05", "t = 3", "A = ?"], expect: { values: { A: [1157.625] } }, note: "growth: the student's decimals, not fractions" },
  { id: "a1-em-02", topic: "exponential-models", lines: ["I = Prt", "P = 500", "r = 0.04", "t = 3", "I = ?"], expect: { values: { I: [60] } }, note: "simple interest" },
  { id: "a1-em-03", topic: "exponential-models", lines: ["A = 500(0.8)^{3}"], expect: { values: { A: [256] } }, note: "decay" },
  { id: "a1-em-04", topic: "exponential-models", lines: ["A = P(1 + \\frac{r}{n})^{nt}", "P = 1000", "r = 0.06", "n = 12", "t = 5", "A = ?"], expect: { values: { A: [1000 * Math.pow(1.005, 60)] }, approxOk: true }, note: "compound interest: to the cent" },
  { id: "a1-em-05", topic: "exponential-models", lines: ["\\frac{60 - 50}{50} \\times 100 ="], expect: { answer: "20" }, note: "percent change" },
  { id: "a1-em-06", topic: "exponential-models", lines: ["y = 200(1.5)^{x}", "x = 2", "y = ?"], expect: { values: { y: [450] } } },
  { id: "a1-em-07", topic: "exponential-models", lines: ["A = P(1 - r)^{t}", "P = 20000", "r = 0.15", "t = 2", "A = ?"], expect: { values: { A: [14450] } }, note: "depreciation" },
  { id: "a1-em-08", topic: "exponential-models", lines: ["1200 \\times 1.035 ="], expect: { answer: "1242" }, note: "a 3.5% increase" },

  // ---------------------------------------------------------------- statistics, as maths (S-ID.2)
  { id: "a1-st-01", topic: "statistics", lines: ["3, 5, 7, 9, 11", "\\bar{x} = ?"], expect: { answer: "7" }, oracle: ["\\frac{3 + 5 + 7 + 9 + 11}{5}"], note: "the mean of a list" },
  { id: "a1-st-02", topic: "statistics", lines: ["12, 15, 9, 20", "\\bar{x} ="], expect: { answer: "14" }, oracle: ["\\frac{12 + 15 + 9 + 20}{4}"] },
  { id: "a1-st-03", topic: "statistics", lines: ["\\frac{85 + 90 + 78}{3} ="], expect: { answer: "\\frac{253}{3}" } },
  { id: "a1-st-04", topic: "statistics", lines: ["2, 4, 4, 5", "\\bar{x} = ?"], expect: { answer: "\\frac{15}{4}" }, oracle: ["\\frac{2 + 4 + 4 + 5}{4}"] },
];
