/**
 * Algebra 2 on the scoreboard: complex numbers (N-CN), polynomial division and the remainder
 * theorem (A-APR), function composition and inverses (F-BF), logarithm properties and exponential
 * equations (F-LE, F-BF.5), rational expressions (A-APR.6/7), series (A-SSE.4), the binomial
 * theorem (A-APR.5), variation (A-CED), rational functions — domain, holes, asymptotes (F-IF.7d,
 * `expect.rational`) — and transformations of functions (F-BF.3, `expect.transform`), both judged
 * by `../functionFeatures.ts`. The original corpus's rational, radical, exponential,
 * log and 3×3 topics count towards Algebra 2 from `../corpus.ts`; this file adds the rest.
 * `complexValues` is a non-real solution set, [re, im] per root: complex roots are written only
 * when the column already uses `i` (`src/lib/live/engine/complexSetting.ts`).
 */
import type { EvalProblem } from "../corpus";

const LN2 = Math.log(2);
const LN3 = Math.log(3);
const LN5 = Math.log(5);
const SQRT2 = Math.SQRT2;
/** the running example: a hole at (2, 4/3), x = -1, y = 1 */
const RF = "f(x) = \\frac{x^{2} - 4}{x^{2} - x - 2}";

export const ALGEBRA_2: readonly EvalProblem[] = [
  // ---------------------------------------------------------------- complex numbers (N-CN.1–2, N-CN.7)
  { id: "a2-cx-01", topic: "complex-numbers", lines: ["(2 + 3i)(1 - i)"], expect: { answer: "5 + i" }, note: "FOIL, then i² = -1" },
  { id: "a2-cx-02", topic: "complex-numbers", lines: ["i^{23}"], expect: { answer: "-i" }, note: "powers of i by fours" },
  { id: "a2-cx-03", topic: "complex-numbers", lines: ["\\frac{2 + 3i}{1 - i}"], expect: { answer: "-\\frac{1}{2} + \\frac{5}{2}i" }, note: "times the conjugate" },
  { id: "a2-cx-04", topic: "complex-numbers", lines: ["(3 + 2i) + (1 - 4i)"], expect: { answer: "4 - 2i" } },
  { id: "a2-cx-05", topic: "complex-numbers", lines: ["(5 - 2i) - (3 + 4i)"], expect: { answer: "2 - 6i" } },
  { id: "a2-cx-06", topic: "complex-numbers", lines: ["(1 + i)^{2}"], expect: { answer: "2i" } },
  { id: "a2-cx-07", topic: "complex-numbers", lines: ["\\sqrt{-16}"], expect: { answer: "4i" } },
  { id: "a2-cx-08", topic: "complex-numbers", lines: ["\\sqrt{-4} \\cdot \\sqrt{-9}"], expect: { answer: "-6" }, note: "i · i, not √36" },
  { id: "a2-cx-09", topic: "complex-numbers", lines: ["\\frac{5}{2i}"], expect: { answer: "-\\frac{5}{2}i" } },
  { id: "a2-cx-10", topic: "complex-numbers", lines: ["(4 - 3i)(4 + 3i) ="], expect: { answer: "25" } },
  { id: "a2-cx-11", topic: "complex-numbers", lines: ["|3 + 4i|"], expect: { answer: "5" }, note: "the modulus" },
  { id: "a2-cx-12", topic: "complex-numbers", lines: ["i^{2} = -1", "x^{2} + 2x + 5 = 0"], expect: { complexValues: { x: [[-1, 2], [-1, -2]] }, answer: "x = -1 \\pm 2i" }, note: "i in the column: complex roots" },
  { id: "a2-cx-13", topic: "complex-numbers", lines: ["i^{2} = -1", "x^{2} + 9 = 0"], expect: { complexValues: { x: [[0, 3], [0, -3]] }, answer: "x = \\pm 3i" } },
  { id: "a2-cx-14", topic: "complex-numbers", lines: ["i^{2} = -1", "x^{2} - 2x + 3 = 0"], expect: { complexValues: { x: [[1, SQRT2], [1, -SQRT2]] }, answer: "x = 1 \\pm i\\sqrt{2}" } },
  { id: "a2-cx-15", topic: "complex-numbers", lines: ["x^{2} + 2x + 5 = 0"], expect: { values: { x: [] } }, note: "no i in the column: no real roots, \\varnothing (the default)" },

  // ---------------------------------------------------------------- polynomial division, remainder and factor theorems (A-APR.2, A-APR.6)
  { id: "a2-pd-01", topic: "poly-division", lines: ["\\frac{x^{3} - 2x^{2} + 4}{x - 3}"], expect: { answer: "x^{2} + x + 3 + \\frac{13}{x - 3}" }, note: "long division, with the working" },
  { id: "a2-pd-02", topic: "poly-division", lines: ["\\frac{2x^{3} + 3x^{2} - x + 5}{x + 2}"], expect: { answer: "2x^{2} - x + 1 + \\frac{3}{x + 2}" } },
  { id: "a2-pd-03", topic: "poly-division", lines: ["(x^{3} + 1) \\div (x - 1)"], expect: { answer: "x^{2} + x + 1 + \\frac{2}{x - 1}" } },
  { id: "a2-pd-04", topic: "poly-division", lines: ["P(x) = x^{3} - 2x^{2} + 4", "P(3) ="], expect: { answer: "13" }, note: "the remainder theorem" },
  { id: "a2-pd-05", topic: "poly-division", lines: ["P(x) = 2x^{3} - 5x + 1", "P(-2) ="], expect: { answer: "-5" } },
  { id: "a2-pd-06", topic: "poly-division", lines: ["2x^{3} - 3x^{2} - 11x + 6"], expect: { answer: "(x + 2)(2x - 1)(x - 3)", form: "factored" }, note: "rational roots, factored completely" },
  { id: "a2-pd-07", topic: "poly-division", lines: ["x^{4} - 2x^{3} - 7x^{2} + 8x + 12"], expect: { answer: "(x + 2)(x + 1)(x - 2)(x - 3)", form: "factored" } },
  { id: "a2-pd-08", topic: "poly-division", lines: ["2x^{3} - 3x^{2} - 11x + 6 = 0"], expect: { values: { x: [-2, 0.5, 3] } } },
  { id: "a2-pd-09", topic: "poly-division", lines: ["\\frac{x^{3} - 8}{x - 2}"], expect: { answer: "x^{2} + 2x + 4" }, note: "divides exactly" },

  // ---------------------------------------------------------------- composition, inverses, piecewise (F-BF.1c, F-BF.4, F-IF.7b)
  { id: "a2-fo-01", topic: "function-ops", lines: ["f(x) = 2x + 3", "g(x) = x^{2}", "f(g(x)) ="], expect: { answer: "2x^{2} + 3" } },
  { id: "a2-fo-02", topic: "function-ops", lines: ["f(x) = 2x + 3", "g(x) = x^{2}", "g(f(x)) ="], expect: { answer: "4x^{2} + 12x + 9", form: "expanded" } },
  { id: "a2-fo-03", topic: "function-ops", lines: ["f(x) = 2x + 3", "g(x) = x^{2}", "(f \\circ g)(x) ="], expect: { answer: "2x^{2} + 3" } },
  { id: "a2-fo-04", topic: "function-ops", lines: ["f(x) = 2x + 3", "g(x) = x^{2}", "f(g(2)) ="], expect: { answer: "11" } },
  { id: "a2-fo-05", topic: "function-ops", lines: ["f(x) = x^{2} + 1", "g(x) = x - 3", "(f + g)(2) ="], expect: { answer: "4" } },
  { id: "a2-fo-06", topic: "function-ops", lines: ["f(x) = 2x + 3", "f^{-1}(x) ="], expect: { answer: "\\frac{x - 3}{2}" }, note: "swap x and y, solve for y" },
  { id: "a2-fo-07", topic: "function-ops", lines: ["f(x) = 3x - 4", "f^{-1}(x) = ?"], expect: { answer: "\\frac{x + 4}{3}" } },
  { id: "a2-fo-08", topic: "function-ops", lines: ["f(x) = \\frac{x + 1}{x - 2}", "f^{-1}(x) ="], expect: { answer: "\\frac{2x + 1}{x - 1}" }, note: "y in two terms: factored out" },
  { id: "a2-fo-09", topic: "function-ops", lines: ["f(x) = x^{3} - 1", "f^{-1}(x) ="], expect: { answer: "\\sqrt[3]{x + 1}" } },
  { id: "a2-fo-10", topic: "function-ops", lines: ["f(x) = \\begin{cases} x^{2} & x < 0 \\\\ 2x + 1 & x \\ge 0 \\end{cases}", "f(3) ="], expect: { answer: "7" }, note: "piecewise: the case that holds" },
  { id: "a2-fo-11", topic: "function-ops", lines: ["f(x) = \\left\\{\\begin{array}{ll} x^{2} & x<0 \\\\ 2 x+1 & x \\geq 0\\end{array}\\right.", "f(-2) ="], expect: { answer: "4" }, note: "Mathpix's array form" },

  // ---------------------------------------------------------------- logarithms: properties, change of base, equations (F-LE.4, F-BF.5)
  { id: "a2-lg-01", topic: "log-properties", lines: ["\\log(x^{2} y)"], expect: { answer: "2\\log x + \\log y" }, note: "expand" },
  { id: "a2-lg-02", topic: "log-properties", lines: ["\\ln\\frac{x^{3}}{y}"], expect: { answer: "3\\ln x - \\ln y" } },
  { id: "a2-lg-03", topic: "log-properties", lines: ["\\log_{2}(8x^{3})"], expect: { answer: "3 + 3\\log_{2} x" } },
  { id: "a2-lg-04", topic: "log-properties", lines: ["\\log\\sqrt{x}"], expect: { answer: "\\frac{1}{2}\\log x" } },
  { id: "a2-lg-05", topic: "log-properties", lines: ["2\\log x + \\log y"], expect: { answer: "\\log(x^{2}y)" }, note: "condense" },
  { id: "a2-lg-06", topic: "log-properties", lines: ["\\log_{2} 8 + \\log_{2} 4"], expect: { answer: "5" } },
  { id: "a2-lg-07", topic: "log-properties", lines: ["\\log_{3} 54 - \\log_{3} 2"], expect: { answer: "3" } },
  { id: "a2-lg-08", topic: "log-properties", lines: ["\\log 25 + \\log 4"], expect: { answer: "2" } },
  { id: "a2-lg-09", topic: "log-properties", lines: ["\\log_{3} 7 ="], expect: { answer: "\\frac{\\ln 7}{\\ln 3}" }, note: "change of base, exact" },
  { id: "a2-lg-10", topic: "log-properties", lines: ["3^{x} = 2^{x + 1}"], expect: { values: { x: [LN2 / (LN3 - LN2)] }, answer: "x = \\frac{\\ln 2}{\\ln 3 - \\ln 2}" }, note: "different bases: logs of both sides" },
  { id: "a2-lg-11", topic: "log-properties", lines: ["2^{x} = 5"], expect: { values: { x: [LN5 / LN2] }, answer: "x = \\frac{\\ln 5}{\\ln 2}" } },
  { id: "a2-lg-12", topic: "log-properties", lines: ["5^{2x} = 3^{x - 1}"], expect: { values: { x: [-LN3 / (2 * LN5 - LN3)] }, answer: "x = \\frac{-\\ln 3}{2\\ln 5 - \\ln 3}" } },

  // ---------------------------------------------------------------- rational expressions (A-APR.6–7)
  { id: "a2-re-01", topic: "rational-expressions", lines: ["\\frac{2}{x} + \\frac{3}{x + 1}"], expect: { answer: "\\frac{5x + 2}{x(x + 1)}" } },
  { id: "a2-re-02", topic: "rational-expressions", lines: ["\\frac{1}{x^{2} - 1} + \\frac{1}{x + 1}"], expect: { answer: "\\frac{x}{(x + 1)(x - 1)}" }, note: "a denominator factored first" },
  { id: "a2-re-03", topic: "rational-expressions", lines: ["\\frac{3}{x} - \\frac{2}{x + 2}"], expect: { answer: "\\frac{x + 6}{x(x + 2)}" } },
  { id: "a2-re-04", topic: "rational-expressions", lines: ["\\frac{x^{2} - 4}{x + 3} \\cdot \\frac{x + 3}{x - 2}"], expect: { answer: "x + 2" } },
  { id: "a2-re-05", topic: "rational-expressions", lines: ["\\frac{x + 1}{x} \\div \\frac{x^{2} - 1}{x^{2}}"], expect: { answer: "\\frac{x}{x - 1}" }, note: "times the reciprocal" },
  { id: "a2-re-06", topic: "rational-expressions", lines: ["\\frac{x}{x + 1} + 2"], expect: { answer: "\\frac{3x + 2}{x + 1}" } },
  { id: "a2-re-07", topic: "rational-expressions", lines: ["\\frac{2x}{x^{2} - 9} \\cdot \\frac{x + 3}{4}"], expect: { answer: "\\frac{x}{2(x - 3)}" } },
  { id: "a2-re-08", topic: "rational-expressions", lines: ["\\frac{x}{x - 2} - \\frac{2}{x - 2}"], expect: { answer: "1" } },

  // ---------------------------------------------------------------- series (A-SSE.4)
  { id: "a2-se-01", topic: "series", lines: ["2, 6, 18, \\ldots", "S_{6} = ?"], expect: { values: { S_6: [728] } }, oracle: ["S_{6} = \\frac{2(1 - 3^{6})}{1 - 3}"], note: "a finite geometric sum" },
  { id: "a2-se-02", topic: "series", lines: ["3, 7, 11, 15, \\ldots", "S_{10} = ?"], expect: { values: { S_10: [210] } }, oracle: ["S_{10} = \\frac{10}{2}(3 + 39)"], note: "a finite arithmetic sum" },
  { id: "a2-se-03", topic: "series", lines: ["8, 4, 2, 1, \\ldots", "S = ?"], expect: { values: { S: [16] } }, oracle: ["S = \\frac{8}{1 - \\frac{1}{2}}"], note: "an infinite geometric sum, |r| < 1" },
  { id: "a2-se-04", topic: "series", lines: ["\\sum_{n=1}^{10} (2n + 1) ="], expect: { answer: "120" } },
  { id: "a2-se-05", topic: "series", lines: ["\\sum_{k=1}^{5} 3 \\cdot 2^{k - 1}"], expect: { answer: "93" } },
  { id: "a2-se-06", topic: "series", lines: ["\\sum_{n=1}^{\\infty} 3\\left(\\frac{1}{2}\\right)^{n - 1}"], expect: { answer: "6" }, oracle: ["\\frac{3}{1 - \\frac{1}{2}}"] },
  { id: "a2-se-07", topic: "series", lines: ["27, 9, 3, 1, \\ldots", "S = ?"], expect: { values: { S: [40.5] } }, oracle: ["S = \\frac{27}{1 - \\frac{1}{3}}"] },

  // ---------------------------------------------------------------- the binomial theorem (A-APR.5)
  { id: "a2-bn-01", topic: "binomial", lines: ["(x + 2)^{4}"], expect: { answer: "x^{4} + 8x^{3} + 24x^{2} + 32x + 16", form: "expanded" }, note: "Pascal's row 1 4 6 4 1" },
  { id: "a2-bn-02", topic: "binomial", lines: ["(2x - 1)^{3}"], expect: { answer: "8x^{3} - 12x^{2} + 6x - 1", form: "expanded" } },
  { id: "a2-bn-03", topic: "binomial", lines: ["(x + y)^{3}"], expect: { answer: "x^{3} + 3x^{2}y + 3xy^{2} + y^{3}", form: "expanded" } },
  { id: "a2-bn-04", topic: "binomial", lines: ["(a - 2b)^{4}"], expect: { answer: "a^{4} - 8a^{3}b + 24a^{2}b^{2} - 32ab^{3} + 16b^{4}", form: "expanded" } },
  { id: "a2-bn-05", topic: "binomial", lines: ["(x - 3)^{5}"], expect: { answer: "x^{5} - 15x^{4} + 90x^{3} - 270x^{2} + 405x - 243", form: "expanded" } },

  // ---------------------------------------------------------------- variation (A-CED.2)
  { id: "a2-va-01", topic: "variation", lines: ["y = kx", "y = 12", "x = 4", "k = ?"], expect: { values: { k: [3] } }, note: "direct" },
  { id: "a2-va-02", topic: "variation", lines: ["y = \\frac{k}{x}", "x = 2", "y = 6", "k = ?"], expect: { values: { k: [12] } }, note: "inverse" },
  { id: "a2-va-03", topic: "variation", lines: ["y = \\frac{12}{x}", "x = 3", "y = ?"], expect: { values: { y: [4] } } },
  { id: "a2-va-04", topic: "variation", lines: ["z = kxy", "z = 60", "x = 3", "y = 4", "k = ?"], expect: { values: { k: [5] } }, note: "joint" },
  { id: "a2-va-05", topic: "variation", lines: ["y = kx^{2}", "y = 50", "x = 5", "k = ?"], expect: { values: { k: [2] } } },

  // ---------------------------------------------------------------- literal equations with the letter below the bar (A-CED.4)
  { id: "a2-le-01", topic: "literal-equations", course: "algebra-2", lines: ["\\frac{1}{f} = \\frac{1}{u} + \\frac{1}{v}", "f = ?"], expect: { answer: "f = \\frac{uv}{u + v}" }, note: "the lens formula" },
  { id: "a2-le-02", topic: "literal-equations", course: "algebra-2", lines: ["A = Pe^{rt}", "t = ?"], expect: { answer: "t = \\frac{\\ln \\frac{A}{P}}{r}" }, note: "the letter in an exponent" },
  // rational roots on radicals with a binomial below (Algebra 2's rationalizing)
  { id: "a2-rd-01", topic: "radicals", course: "algebra-2", lines: ["\\frac{3}{2 + \\sqrt{3}}"], expect: { answer: "6 - 3\\sqrt{3}", form: "radical" }, note: "times the conjugate" },
  { id: "a2-rd-02", topic: "radicals", course: "algebra-2", lines: ["(2 + \\sqrt{3})(1 - \\sqrt{3})"], expect: { answer: "-1 - \\sqrt{3}", form: "radical" } },
  { id: "a2-rd-03", topic: "radicals", course: "algebra-2", lines: ["\\frac{4}{\\sqrt{5} - 1}"], expect: { answer: "1 + \\sqrt{5}", form: "radical" } },

  // ---------------------------------------------------------------- rational functions: domain, holes, asymptotes (F-IF.7d, A-APR.6)
  { id: "a2-rf-01", topic: "rational-functions", lines: [RF], expect: { rational: { domain: [-1, 2], holes: [[2, 4 / 3]], vertical: [-1], horizontal: 1 } }, note: "Solve on the function: factor, cancel with x ≠ 2, the hole, the asymptotes" },
  { id: "a2-rf-02", topic: "rational-functions", lines: ["y = \\frac{2x + 1}{x - 3}"], expect: { rational: { domain: [3], holes: [], vertical: [3], horizontal: 2 } } },
  { id: "a2-rf-03", topic: "rational-functions", lines: ["f(x) = \\frac{x^{2} + 1}{x - 1}"], expect: { rational: { domain: [1], holes: [], vertical: [1], horizontal: null, oblique: "x + 1" } }, note: "a slant asymptote by division" },
  { id: "a2-rf-04", topic: "rational-functions", lines: ["f(x) = \\frac{x^{2} - 4}{x - 2}"], expect: { rational: { domain: [2], holes: [[2, 4]], vertical: [], horizontal: null } }, note: "a line with a hole, no asymptote" },
  { id: "a2-rf-05", topic: "rational-functions", lines: ["y = \\frac{3x^{2}}{x^{2} - 9}"], expect: { rational: { domain: [-3, 3], holes: [], vertical: [-3, 3], horizontal: 3 } } },
  { id: "a2-rf-06", topic: "rational-functions", lines: ["y = \\frac{x + 1}{x^{2} + 1}"], expect: { rational: { domain: [], holes: [], vertical: [], horizontal: 0 } }, note: "the bottom never zero; the bottom's degree wins" },
  { id: "a2-rf-07", topic: "rational-functions", lines: ["f(x) = \\frac{2x^{2} - 8}{x^{2} + x - 6}"], expect: { rational: { domain: [-3, 2], holes: [[2, 1.6]], vertical: [-3], horizontal: 2 } } },
  { id: "a2-rf-08", topic: "rational-functions", lines: ["f(x) = \\frac{x - 3}{x^{2} - 9}"], expect: { rational: { domain: [-3, 3], holes: [[3, 1 / 6]], vertical: [-3], horizontal: 0 } } },
  { id: "a2-rf-09", topic: "rational-functions", lines: ["y = \\frac{2x^{2} - 3x - 2}{x - 2}"], expect: { rational: { domain: [2], holes: [[2, 5]], vertical: [], horizontal: null } } },
  { id: "a2-rf-10", topic: "rational-functions", lines: ["f(x) = \\frac{x^{2} - x - 6}{x + 1}"], expect: { rational: { domain: [-1], holes: [], vertical: [-1], horizontal: null, oblique: "x - 2" } } },
  { id: "a2-rf-11", topic: "rational-functions", lines: ["f(x) = \\frac{x^{3}}{x^{2} - 1}"], expect: { rational: { domain: [-1, 1], holes: [], vertical: [-1, 1], horizontal: null, oblique: "x" } } },
  { id: "a2-rf-12", topic: "rational-functions", lines: ["y = \\frac{x^{2} - x - 2}{x^{2} - 4}"], expect: { rational: { domain: [-2, 2], holes: [[2, 0.75]], vertical: [-2], horizontal: 1 } } },
  { id: "a2-rf-13", topic: "rational-functions", lines: ["f(x) = \\frac{4x - 2}{2x + 1}"], expect: { rational: { domain: [-0.5], holes: [], vertical: [-0.5], horizontal: 2 } } },
  { id: "a2-rf-14", topic: "rational-functions", lines: [RF, "\\text{VA} = ?"], expect: { rational: { vertical: [-1] } }, note: "an ask under the function" },
  { id: "a2-rf-15", topic: "rational-functions", lines: [RF, "x = ?"], expect: { rational: { vertical: [-1] } }, note: "x = ? under a function with no value given: where it cannot be evaluated" },
  { id: "a2-rf-16", topic: "rational-functions", lines: [RF, "\\text{HA} = ?"], expect: { rational: { horizontal: 1 } } },
  { id: "a2-rf-17", topic: "rational-functions", lines: [RF, "\\text{holes}"], expect: { rational: { holes: [[2, 4 / 3]] } } },
  { id: "a2-rf-18", topic: "rational-functions", lines: [RF, "D = ?"], expect: { rational: { domain: [-1, 2] } } },
  { id: "a2-rf-19", topic: "rational-functions", lines: ["f(x) = \\frac{x^{2} + 3x}{x^{2} - 9}", "\\text{domain}"], expect: { rational: { domain: [-3, 3] } } },
  { id: "a2-rf-20", topic: "rational-functions", lines: ["y = \\frac{5}{x + 4}", "\\text{HA} = ?"], expect: { rational: { horizontal: 0 } } },
  { id: "a2-rf-21", topic: "rational-functions", lines: [RF, "\\lim_{x \\to \\infty} f(x) ="], expect: { answer: "1" }, note: "the limit at ∞ under the definition: the horizontal asymptote's level" },
  { id: "a2-rf-22", topic: "rational-functions", lines: [RF, "\\lim_{x \\to 2} f(x) ="], expect: { answer: "\\frac{4}{3}" }, note: "the limit at the hole: its height" },

  // ---------------------------------------------------------------- transformations of functions (F-BF.3)
  { id: "a2-tr-01", topic: "transformations", lines: ["f(x) = x^{2}", "g(x) = f(x - 3) + 1"], expect: { transform: { image: "(x - 3)^{2} + 1", rule: ["x + 3", "y + 1"], point: [[0, 0], [3, 1]] } } },
  { id: "a2-tr-02", topic: "transformations", lines: ["f(x) = x^{2}", "g(x) = -2f(x)"], expect: { transform: { image: "-2x^{2}", rule: ["x", "-2y"], point: [[1, 1], [1, -2]] } }, note: "the vertex stays put: (1, 1) shows the flip and the stretch" },
  { id: "a2-tr-03", topic: "transformations", lines: ["f(x) = x^{2}", "g(x) = f(2x)"], expect: { transform: { image: "4x^{2}", rule: ["\\frac{1}{2}x", "y"], point: [[1, 1], [0.5, 1]] } }, note: "f(2x) shrinks by ½" },
  { id: "a2-tr-04", topic: "transformations", lines: ["f(x) = x^{2}", "g(x) = \\frac{1}{2}f(x + 1) - 4"], expect: { transform: { image: "\\frac{1}{2}(x + 1)^{2} - 4", rule: ["x - 1", "\\frac{1}{2}y - 4"], point: [[0, 0], [-1, -4]] } } },
  { id: "a2-tr-05", topic: "transformations", lines: ["f(x) = |x|", "g(x) = -f(x + 2) + 3"], expect: { transform: { image: "-|x + 2| + 3", rule: ["x - 2", "-y + 3"], point: [[0, 0], [-2, 3]] } } },
  { id: "a2-tr-06", topic: "transformations", lines: ["f(x) = \\sqrt{x}", "g(x) = f(2x - 6)"], expect: { transform: { image: "\\sqrt{2x - 6}", rule: ["\\frac{1}{2}x + 3", "y"], point: [[0, 0], [3, 0]] } }, note: "f(2(x - 3)): three to the right, not six" },
  { id: "a2-tr-07", topic: "transformations", lines: ["f(x) = \\frac{1}{x}", "g(x) = f(x - 2) + 3"], expect: { transform: { image: "\\frac{1}{x - 2} + 3", rule: ["x + 2", "y + 3"], point: [[1, 1], [3, 4]] } } },
  { id: "a2-tr-08", topic: "transformations", lines: ["f(x) = 2^{x}", "g(x) = 3f(x) - 1"], expect: { transform: { image: "3 \\cdot 2^{x} - 1", rule: ["x", "3y - 1"], point: [[0, 1], [0, 2]] } } },
  { id: "a2-tr-09", topic: "transformations", lines: ["f(x) = x^{3}", "g(x) = f(-x) + 2"], expect: { transform: { image: "-x^{3} + 2", rule: ["-x", "y + 2"], point: [[0, 0], [0, 2]] } } },
  { id: "a2-tr-10", topic: "transformations", lines: ["f(x) = x^{2} - 4x", "g(x) = f(x + 1)"], expect: { transform: { image: "(x + 1)^{2} - 4(x + 1)", rule: ["x - 1", "y"], point: [[2, -4], [1, -4]] } }, note: "any quadratic parent: its vertex" },
  { id: "a2-tr-11", topic: "transformations", lines: ["f(x) = x^{2}", "g(x) = f(\\frac{1}{2}x)"], expect: { transform: { image: "\\frac{1}{4}x^{2}", rule: ["2x", "y"], point: [[1, 1], [2, 1]] } }, note: "f(½x) stretches by 2" },
  { id: "a2-tr-12", topic: "transformations", lines: ["f(x) = |x|", "g(x) = f(3x + 6)"], expect: { transform: { image: "|3x + 6|", rule: ["\\frac{1}{3}x - 2", "y"], point: [[0, 0], [-2, 0]] } }, note: "f(3(x + 2)): two to the left" },
  { id: "a2-tr-13", topic: "transformations", lines: ["f(x) = \\sqrt{x}", "g(x) = -f(-x)"], expect: { transform: { image: "-\\sqrt{-x}", rule: ["-x", "-y"], point: [[1, 1], [-1, -1]] } } },
  { id: "a2-tr-14", topic: "transformations", lines: ["y = 2(x - 1)^{2} + 3"], expect: { transform: { image: "2(x - 1)^{2} + 3", rule: ["x + 1", "2y + 3"], point: [[0, 0], [1, 3]] } }, note: "read directly against its parent x²" },
  { id: "a2-tr-15", topic: "transformations", lines: ["y = -|x + 2| + 1"], expect: { transform: { image: "-|x + 2| + 1", rule: ["x - 2", "-y + 1"], point: [[0, 0], [-2, 1]] } } },
  { id: "a2-tr-16", topic: "transformations", lines: ["y = \\sqrt{x - 4} + 1"], expect: { transform: { image: "\\sqrt{x - 4} + 1", rule: ["x + 4", "y + 1"], point: [[0, 0], [4, 1]] } } },
  { id: "a2-tr-17", topic: "transformations", lines: ["y = 2^{x + 1} - 3"], expect: { transform: { image: "2^{x + 1} - 3", rule: ["x - 1", "y - 3"], point: [[0, 1], [-1, -2]] } } },
  { id: "a2-tr-18", topic: "transformations", lines: ["y = \\frac{1}{x - 2} + 3"], expect: { transform: { image: "\\frac{1}{x - 2} + 3", rule: ["x + 2", "y + 3"], point: [[1, 1], [3, 4]] } } },
  { id: "a2-tr-19", topic: "transformations", lines: ["g(x) = 4x^{2}"], expect: { transform: { image: "4x^{2}", rule: ["x", "4y"], point: [[1, 1], [1, 4]] } } },
  { id: "a2-tr-20", topic: "transformations", lines: ["f(x) = x^{3}", "g(x) = \\frac{1}{2}f(x - 1) + 2"], expect: { transform: { image: "\\frac{1}{2}(x - 1)^{3} + 2", rule: ["x + 1", "\\frac{1}{2}y + 2"], point: [[0, 0], [1, 2]] } } },
];
