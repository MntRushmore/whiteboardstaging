import { describe, expect, it } from "vitest";
import { SKILLS, type SkillId } from "../contracts";
import { classifyProblem } from "../skills";
import { STARTER_PROBLEMS } from "@/lib/onboarding/courses";
import { CORPUS } from "@/__eval__/corpus";
import { CHAT_CORPUS } from "@/__eval__/chat/corpus";
import { TEACH_EXAMPLES } from "@/lib/server/prompts/chat";

/** One labelled problem: its lines (a string is one line), the skill, and the course when it matters. */
type Case = readonly [lines: string | readonly string[], skill: SkillId, course?: string];

const lines = (c: Case): readonly string[] => (typeof c[0] === "string" ? [c[0]] : c[0]);
/** An eval scoreboard problem's lines by id (`src/__eval__/corpus.ts`), so the corpus follows the real fixtures. */
const evalLines = (id: string): readonly string[] => {
  const p = CORPUS.find((x) => x.id === id);
  if (!p) throw new Error(`no eval problem ${id}`);
  return p.lines;
};
const evalCase = (id: string, skill: SkillId, course?: string): Case => [evalLines(id), skill, course];

/** The task's own examples, word for word. */
const SPEC: Case[] = [
  ["x + 5 = 9", "one_step_equations"],
  ["2x + 3 = 11", "two_step_equations"],
  ["\\frac{x}{2} - 5 = 1", "two_step_equations"],
  ["3(x - 2) = 2x + 4", "multi_step_equations"],
  ["3 - 2x > 7", "inequalities"],
  ["|x - 3| = 5", "absolute_value"],
  [["x + y = 10", "x - y = 2"], "systems"],
  ["x^{3} \\cdot x^{4}", "exponent_rules"],
  ["\\frac{12x^{5}}{3x^{2}}", "exponent_rules"],
  ["(x + 3)(x - 2)", "polynomials"],
  ["(x+3)^{2}", "polynomials"],
  ["x^{2} + 5x + 6", "factoring"],
  ["x^{2} - 5x + 6 = 0", "quadratic_equations"],
  ["4(2x - 1) - 3x", "simplify_expressions"],
  ["\\sqrt{x + 3} = 5", "radicals"],
  ["\\frac{2}{x} + \\frac{3}{x + 1}", "rational_expressions"],
  ["(3 + 2i)(1 - i)", "complex_numbers"],
  ["2^{x + 1} = 16", "exponential_equations"],
  ["\\log_{2}(x) = 5", "logarithms"],
  ["f(x) = 3x - 1", "functions"],
  ["f(3)", "functions"],
  [["f(x) = 2x + 3", "g(x) = x^{2}", "f(g(x)) ="], "functions"],
  ["y = 2x + 1", "linear_functions"],
  [["(1, 2), (4, 8)", "m = ?"], "linear_functions"],
  ["\\sin 30^{\\circ}", "trig_values"],
  ["2\\cos x - 1 = 0, \\ 0 \\le x < 2\\pi", "trig_equations"],
  ["\\lim_{x \\to 2} \\frac{x^{2} - 4}{x - 2}", "limits"],
  ["\\frac{d}{dx}(x^{3} + 2x)", "derivatives"],
  [["f(x) = x^{2} - 3x", "f'(x) ="], "derivatives"],
  ["\\int (3x^{2} + 1) \\, dx", "integrals"],
  ["3^{2} + 4^{2} = c^{2}", "pythagorean"],
  ["x + 40 + 65 = 180", "triangles"],
  ["x + 65^{\\circ} = 180^{\\circ}", "angles"],
  ["A = \\pi r^{2}", "circles"],
  [["A = \\frac{1}{2} b h", "b = 10", "h = 7", "A = ?"], "area_perimeter"],
  [["A(1, 2), \\ B(4, 6)", "AB = ?"], "coordinate_geometry"],
  ["60 \\mathrm{~km/h} \\text{ to } \\mathrm{m/s}", "units"],
  ["Fe + O_2 \\rightarrow Fe_2O_3", "chemistry"],
  ["\\text{A train travels 120 km in 2 hours. How fast is it going?}", "word_problems"],
];

/** Arithmetic for young students. */
const ARITHMETIC: Case[] = [
  ["36 + 2 =", "add_within_100"],
  ["100 - 37", "subtract_within_100"],
  ["7 \\times 8", "times_tables"],
  ["144 \\div 12 =", "division_facts"],
  ["7 x 8", "times_tables"],
  ["12 \\cdot 4", "times_tables"],
  ["-4 + 7", "negative_numbers"],
  ["3 - 8 =", "negative_numbers"],
  ["2 - (-3)", "negative_numbers"],
  ["(-3)^{2} + 4 \\times 5 =", "negative_numbers"],
  ["3 + 4 \\times 2 - 6 \\div 3 =", "order_of_operations"],
  ["(5 + 3) \\times 2", "order_of_operations"],
  ["2 + 3 \\cdot 4 - 1", "order_of_operations"],
  ["\\frac{3}{4} + \\frac{1}{6}", "add_fractions_unlike"],
  ["\\frac{1}{2} \\times 8", "multiply_fractions"],
  ["2 \\frac{1}{2} + 1 \\frac{3}{4} =", "add_fractions_unlike"],
  ["0.5 + 0.25", "decimals_add_subtract"],
  ["4.2 \\times 3", "decimals_multiply"],
  ["20\\% \\text{ of } 150", "percents"],
  ["2^{5} - 3^{2} =", "powers_roots"],
  ["\\sqrt{144} =", "powers_roots"],
  ["\\sqrt{81} + 2", "powers_roots"],
  evalCase("ar-05", "multiply_fractions"),
  evalCase("ar-06", "add_fractions_unlike"),
  evalCase("ar-07", "divide_fractions"),
  evalCase("ar-13", "add_fractions_unlike"),
  evalCase("g2-38", "add_fractions_like"),
  evalCase("g2-39", "multiply_fractions"),
  // a fraction and a decimal, a fraction over a negative: no one finer skill, the coarse one
  evalCase("g2-40", "fractions"),
  evalCase("g2-41", "negative_numbers"),
  evalCase("g2-42", "fractions"),
  evalCase("g2-43", "negative_numbers"),
  evalCase("d3-03", "decimals_add_subtract"),
  evalCase("up-01", "percents"),
  evalCase("up-07", "decimals_multiply"),
  evalCase("g2-35", "percents"),
];

/**
 * The K–8 path's skills, by their numbers (2026-10-09). The first block is real problems from prod,
 * word for word; then each skill's edges (10 is within 10, 11 is not; 12 × 12 is a fact, 13 × 2 is
 * not) and the coarse skills a mix keeps.
 */
const K8: Case[] = [
  // prod, as students wrote them
  ["6 + 9", "add_within_20"],
  ["18 - 9", "subtract_within_20"],
  ["479 + 36", "add_subtract_within_1000"],
  ["348 + 276 - 129", "add_subtract_within_1000"],
  ["4+3", "add_within_10"],
  ["27 \\times 9", "multiply_multi_digit"],
  ["213 \\times 32", "multiply_multi_digit"],
  ["243 \\div 9", "long_division"],
  ["144 \\div 9", "long_division"],
  ["\\frac{2}{3} + \\frac{1}{4}", "add_fractions_unlike"],
  ["15\\% \\cdot 80", "percents"],
  ["5.4 \\times 0.1", "decimals_multiply"],
  // a fraction written with a slash files as the same fraction written with a bar
  ["68 / 1000", "equivalent_fractions"],
  ["\\frac{68}{1000}", "equivalent_fractions"],
  // adding and taking away, by the biggest number in the working
  ["3 + 4", "add_within_10"],
  ["5 + 5", "add_within_10"],
  ["2 + 3 + 4", "add_within_10"],
  ["0 + 6", "add_within_10"],
  ["7 - 2", "subtract_within_10"],
  ["10 - 4 =", "subtract_within_10"],
  ["6 + 3 - 2", "subtract_within_10"],
  ["7 + 5", "add_within_20"],
  ["8 + 7 = 15", "add_within_20"],
  ["10 + 10", "add_within_20"],
  ["9 + 2 + 4", "add_within_20"],
  ["15 - 8", "subtract_within_20"],
  ["20 - 13", "subtract_within_20"],
  ["8 + 6 - 5", "subtract_within_20"],
  ["40 + 30", "add_tens"],
  ["50 + 50", "add_tens"],
  ["34 + 20", "add_tens"],
  ["20 + 34", "add_tens"],
  ["90 - 40", "add_tens"],
  ["56 - 30", "add_tens"],
  ["20 + 30 + 40", "add_tens"],
  ["47 + 38", "add_within_100"],
  ["23 + 14 + 31", "add_within_100"],
  ["58 + 6 =", "add_within_100"],
  ["72 - 35", "subtract_within_100"],
  ["70 - 35", "subtract_within_100"],
  ["43 - 7", "subtract_within_100"],
  ["386 + 247", "add_subtract_within_1000"],
  ["634 - 278", "add_subtract_within_1000"],
  ["76 + 58", "add_subtract_within_1000"],
  ["700 - 268", "add_subtract_within_1000"],
  ["600 + 400", "add_subtract_within_1000"],
  ["4386 + 2947", "multi_digit_add_subtract"],
  ["7032 - 2847", "multi_digit_add_subtract"],
  ["999 + 2", "multi_digit_add_subtract"],
  ["34386 + 28947", "multi_digit_add_subtract"],
  // thousands written with separators, as Mathpix reads them (`5,032`, `4{,}386`, a thin space): one number
  ["5,032 - 687", "multi_digit_add_subtract"],
  ["5,032 - 687 = 4,345", "multi_digit_add_subtract"],
  ["8,000 - 3,500", "multi_digit_add_subtract"],
  ["1,200 - 300 = 900", "multi_digit_add_subtract"],
  ["1,000 - 250", "add_subtract_within_1000"],
  ["4,386 + 2,947", "multi_digit_add_subtract"],
  ["4{,}386 + 2{,}947", "multi_digit_add_subtract"],
  ["5{,}032 - 687", "multi_digit_add_subtract"],
  ["5\\,032 - 687", "multi_digit_add_subtract"],
  ["1,250,000 + 750,000", "multi_digit_add_subtract"],
  ["6,000 \\div 3", "long_division"],
  ["12,345 \\times 6", "multiply_multi_digit"],
  // column (stacked) sums, as Mathpix reads a 2nd–4th grader's (`parseStacked`): the sum they are,
  // not three lines — a `-17` row is no negative number — and a wrong or missing answer changes nothing
  ["\\begin{array}{c}\n52 \\\\\n-17 \\\\\n\\hline 35\n\\end{array}", "subtract_within_100"],
  ["\\begin{array}{c}\n52 \\\\\n-17 \\\\\n\\hline\n\\end{array}", "subtract_within_100"],
  ["\\begin{array}{c} 53 \\\\ -17 \\\\ \\hline 44 \\end{array}", "subtract_within_100"],
  ["\\begin{array}{r} 503 \\\\ -178 \\\\ \\hline 325 \\end{array}", "add_subtract_within_1000"],
  ["\\begin{array}{r}\n286 \\\\\n+680 \\\\\n\\hline 966\n\\end{array}", "add_subtract_within_1000"],
  ["\\begin{array}{rr} & 286 \\\\ + & 680 \\\\ \\hline & 966 \\end{array}", "add_subtract_within_1000"],
  ["\\begin{array}{r} 286 \\\\ \\underline{+680} \\\\ 966 \\end{array}", "add_subtract_within_1000"],
  ["\\begin{array}{r} { }^{1} 286 \\\\ +680 \\\\ \\hline 966 \\end{array}", "add_subtract_within_1000"],
  ["\\begin{array}{r}\n125 \\\\\n48 \\\\\n+302 \\\\\n\\hline 475\n\\end{array}", "add_subtract_within_1000"],
  ["\\begin{array}{r} 4386 \\\\ +2947 \\\\ \\hline 7333 \\end{array}", "multi_digit_add_subtract"],
  ["\\begin{array}{r} 1{,}250 \\\\ +750 \\\\ \\hline 2{,}000 \\end{array}", "multi_digit_add_subtract"],
  ["\\begin{array}{r} 7 \\\\ +5 \\\\ \\hline 12 \\end{array}", "add_within_20"],
  ["\\begin{array}{r}\n23 \\\\\n\\times 4 \\\\\n\\hline 92\n\\end{array}", "multiply_multi_digit"],
  ["\\begin{array}{r} 23 \\\\ x 4 \\\\ \\hline 92 \\end{array}", "multiply_multi_digit"],
  ["\\begin{array}{r} 46 \\\\ \\times 23 \\\\ \\hline 138 \\\\ 920 \\\\ \\hline 1058 \\end{array}", "multiply_multi_digit"],
  ["\\begin{array}{r}\n3.50 \\\\\n+12.25 \\\\\n\\hline 15.75\n\\end{array}", "decimals_add_subtract"],
  // two equations added under a rule (elimination) are not a column sum
  ["\\begin{array}{r} x+y=10 \\\\ x-y=2 \\\\ \\hline 2x=12 \\end{array}", "systems"],
  // times and sharing
  ["6 \\times 7", "times_tables"],
  ["12 \\times 12", "times_tables"],
  ["3 \\times 4 \\times 2", "times_tables"],
  ["0 \\times 9", "times_tables"],
  ["6 * 7", "times_tables"],
  ["4 \\times 60", "multiply_by_tens"],
  ["30 \\times 50", "multiply_by_tens"],
  ["6 \\times 400", "multiply_by_tens"],
  ["120 \\times 3", "multiply_by_tens"],
  ["13 \\times 2", "multiply_multi_digit"],
  ["46 \\times 7", "multiply_multi_digit"],
  ["46 \\times 23", "multiply_multi_digit"],
  ["13 \\times 10", "multiply_multi_digit"],
  ["42 \\div 6", "division_facts"],
  ["144 \\div 12", "division_facts"],
  ["84 / 7", "division_facts"],
  ["0 \\div 5", "division_facts"],
  ["864 \\div 4", "long_division"],
  ["84 \\div 6", "long_division"],
  ["47 \\div 5", "long_division"],
  ["864 \\div 24", "long_division"],
  ["68 \\div 1000", "decimals_multiply"],
  ["9 \\times 4 \\div 6", "multiply_divide"],
  // fractions
  ["\\frac{6}{8}", "equivalent_fractions"],
  ["\\frac{12}{18} =", "equivalent_fractions"],
  ["2 \\frac{1}{3}", "equivalent_fractions"],
  ["\\frac{3}{4} = \\frac{6}{8}", "equivalent_fractions"],
  ["7 / 3", "equivalent_fractions"],
  ["\\frac{2}{7} + \\frac{3}{7}", "add_fractions_like"],
  ["\\frac{5}{8} - \\frac{3}{8}", "add_fractions_like"],
  ["\\frac{1}{8} + \\frac{3}{8} + \\frac{2}{8}", "add_fractions_like"],
  ["2 \\frac{1}{5} + 1 \\frac{3}{5}", "add_fractions_like"],
  ["3/7 + 2/7", "add_fractions_like"],
  ["\\frac{3}{4} + \\frac{1}{6}", "add_fractions_unlike"],
  ["\\frac{1}{2} + \\frac{1}{4}", "add_fractions_unlike"],
  ["\\frac{3}{4} - \\frac{1}{6}", "add_fractions_unlike"],
  ["1 \\frac{1}{2} + 2 \\frac{1}{3}", "add_fractions_unlike"],
  ["2 + \\frac{1}{3}", "add_fractions_unlike"],
  ["3/4 + 1/6", "add_fractions_unlike"],
  ["\\frac{2}{3} \\times \\frac{3}{5}", "multiply_fractions"],
  ["3 \\times \\frac{2}{5}", "multiply_fractions"],
  ["2 \\frac{1}{2} \\times 3", "multiply_fractions"],
  ["\\frac{2}{3} \\cdot \\frac{9}{4}", "multiply_fractions"],
  ["\\frac{3}{4} \\div \\frac{1}{2}", "divide_fractions"],
  ["6 \\div \\frac{1}{3}", "divide_fractions"],
  ["\\frac{4}{5} \\div 2", "divide_fractions"],
  ["\\frac{1}{2} + \\frac{1}{3} \\times 6", "fractions"],
  // the same written with slashes: a product or a quotient of fractions too, not only a sum
  ["3/4 \\times 8", "multiply_fractions"],
  ["2/3 \\times 3/5", "multiply_fractions"],
  ["2/3 \\times 3/5 = 6/15", "multiply_fractions"],
  ["1/2 \\cdot 1/3", "multiply_fractions"],
  ["3/4 * 8", "multiply_fractions"],
  ["3/4 \\div 1/2", "divide_fractions"],
  ["6 \\div 1/3", "divide_fractions"],
  ["1/2 + 1/3 \\times 6", "fractions"],
  // decimals, percents and ratios
  ["3.45 + 2.8", "decimals_add_subtract"],
  ["5 - 2.3", "decimals_add_subtract"],
  ["1.2 \\times 3", "decimals_multiply"],
  ["0.6 \\times 0.4", "decimals_multiply"],
  ["3.6 \\div 10", "decimals_multiply"],
  ["2.4 \\div 0.6", "decimals_multiply"],
  ["1.5 + 2 \\times 3", "decimals_percents"],
  ["25\\% \\times 80", "percents"],
  ["25\\% \\text{ of } 80", "percents"],
  ["25\\% \\times x = 20", "percents"],
  ["x\\% \\times 80 = 20", "percents"],
  ["\\frac{x}{4} = \\frac{9}{12}", "proportions"],
  ["\\frac{3}{5} = \\frac{x}{20}", "proportions"],
  ["\\frac{6}{x} = \\frac{9}{12}", "proportions"],
  ["x : 4 = 9 : 12", "proportions"],
  ["x/4 = 9/12", "proportions"],
  // not a proportion: the unknown twice, or a side that is not a ratio
  ["\\frac{x}{4} = 3", "one_step_equations"],
  ["\\frac{x}{4} = \\frac{x + 3}{6}", "multi_step_equations"],
  // a running total below zero: no one K–8 skill, the coarse one
  ["3 - 5 + 4", "add_subtract"],
];

/** Algebra 1 and 2, from the eval scoreboard and written here. */
const ALGEBRA: Case[] = [
  ["5x = 35", "one_step_equations"],
  ["\\frac{x}{4} = 3", "one_step_equations"],
  ["x - 7 = 12", "one_step_equations"],
  ["12 = x + 5", "one_step_equations"],
  ["-x = 8", "one_step_equations"],
  ["3x + 4 = 19", "two_step_equations"],
  ["\\dfrac{x}{3} + 2 = 7", "two_step_equations"],
  ["2 x+3=11", "two_step_equations"],
  ["2(x + 3) - 4 = 10", "multi_step_equations"],
  ["6x - 2 = 4x + 8", "multi_step_equations"],
  evalCase("li-02", "multi_step_equations"),
  evalCase("li-03", "multi_step_equations"),
  evalCase("li-05", "multi_step_equations"),
  evalCase("li-06", "multi_step_equations"),
  evalCase("li-07", "two_step_equations"),
  evalCase("li-08", "two_step_equations"),
  evalCase("li-09", "multi_step_equations"),
  evalCase("li-10", "multi_step_equations"),
  evalCase("li-13", "one_step_equations"),
  evalCase("g2-01", "multi_step_equations"),
  evalCase("g2-03", "multi_step_equations"),
  evalCase("g2-06", "two_step_equations"),
  evalCase("d3-02", "one_step_equations"),
  evalCase("d3-04", "two_step_equations"),
  evalCase("in-03", "inequalities"),
  evalCase("in-06", "inequalities"),
  evalCase("in-08", "inequalities"),
  evalCase("g2-07", "inequalities"),
  evalCase("g2-10", "inequalities"),
  ["-2x \\le 6", "inequalities"],
  evalCase("in-09", "absolute_value"),
  evalCase("ab-02", "absolute_value"),
  evalCase("ab-05", "absolute_value"),
  evalCase("g2-15", "absolute_value"),
  ["\\left|x-3\\right|=5", "absolute_value"],
  evalCase("sy-04", "systems"),
  evalCase("sy-08", "systems"),
  evalCase("s3-01", "systems"),
  evalCase("s3-03", "systems"),
  evalCase("g2-44", "systems"),
  evalCase("g2-45", "systems"),
  evalCase("g2-47", "systems"),
  ["x + y = 10; x - y = 2", "systems"],
  ["\\begin{cases} 2x + y = 7 \\\\ x - y = 2 \\end{cases}", "systems"],
  ["x + y = 10, \\ x - y = 2", "systems"],
  evalCase("a1-ex-02", "exponent_rules"),
  evalCase("a1-ex-03", "exponent_rules"),
  evalCase("a1-ex-04", "exponent_rules"),
  evalCase("a1-ex-05", "exponent_rules"),
  evalCase("a1-ex-06", "exponent_rules"),
  evalCase("a1-ex-08", "exponent_rules"),
  evalCase("a1-ex-09", "exponent_rules"),
  evalCase("a1-ex-10", "exponent_rules"),
  evalCase("a1-ex-12", "exponent_rules"),
  evalCase("a1-ex-13", "exponent_rules"),
  evalCase("a1-ex-14", "exponent_rules"),
  evalCase("xf-02", "polynomials"),
  evalCase("xf-03", "polynomials"),
  evalCase("xf-06", "polynomials"),
  evalCase("xf-14", "polynomials"),
  evalCase("a1-po-01", "polynomials"),
  evalCase("a1-po-02", "polynomials"),
  evalCase("a1-po-05", "polynomials"),
  evalCase("a2-bn-01", "polynomials"),
  ["x(x + 3)", "polynomials"],
  evalCase("xf-10", "factoring"),
  evalCase("xf-11", "factoring"),
  evalCase("xf-12", "factoring"),
  evalCase("g2-30", "factoring"),
  evalCase("g2-32", "factoring"),
  evalCase("a2-pd-08", "factoring"),
  evalCase("qu-02", "quadratic_equations"),
  evalCase("qu-05", "quadratic_equations"),
  evalCase("qu-11", "quadratic_equations"),
  evalCase("a2-cx-15", "quadratic_equations"),
  ["x^2-5x+6=0", "quadratic_equations"],
  evalCase("xf-01", "simplify_expressions"),
  evalCase("xf-04", "simplify_expressions"),
  evalCase("xf-07", "simplify_expressions"),
  evalCase("xf-16", "simplify_expressions"),
  ["3x + 2x - 4", "simplify_expressions"],
  evalCase("rd-04", "radicals"),
  evalCase("rd-06", "radicals"),
  evalCase("a1-rd-01", "radicals"),
  evalCase("a1-rd-02", "radicals"),
  evalCase("a1-rd-05", "radicals"),
  evalCase("a1-rd-08", "radicals"),
  evalCase("a2-rd-02", "radicals"),
  evalCase("ra-01", "rational_expressions"),
  evalCase("ra-02", "rational_expressions"),
  evalCase("ra-06", "rational_expressions"),
  evalCase("xf-13", "rational_expressions"),
  evalCase("a2-re-04", "rational_expressions"),
  evalCase("a2-pd-03", "rational_expressions"),
  evalCase("a2-cx-02", "complex_numbers"),
  evalCase("a2-cx-03", "complex_numbers"),
  evalCase("a2-cx-07", "complex_numbers"),
  evalCase("a2-cx-11", "complex_numbers"),
  evalCase("a2-cx-12", "complex_numbers"),
  evalCase("ex-05", "exponential_equations"),
  evalCase("ex-06", "exponential_equations"),
  evalCase("a2-lg-10", "exponential_equations"),
  evalCase("a1-em-01", "exponential_equations"),
  evalCase("a1-em-03", "exponential_equations"),
  evalCase("d3-01", "exponential_equations"),
  evalCase("lg-03", "logarithms"),
  evalCase("lg-05", "logarithms"),
  evalCase("lg-07", "logarithms"),
  evalCase("a2-lg-02", "logarithms"),
];

/** Functions and lines. */
const FUNCTIONS: Case[] = [
  evalCase("a1-fn-01", "functions"),
  evalCase("a1-fn-05", "functions"),
  evalCase("a1-fn-12", "functions"),
  evalCase("a2-fo-03", "functions"),
  evalCase("a2-fo-06", "functions"),
  evalCase("a2-fo-11", "functions"),
  evalCase("a2-pd-04", "functions"),
  evalCase("a2-rf-02", "functions"),
  evalCase("a2-tr-01", "functions"),
  evalCase("a2-tr-15", "functions"),
  evalCase("a2-tr-17", "functions"),
  evalCase("a1-vx-01", "functions"),
  ["y = x^{2}", "functions"],
  evalCase("a1-lf-01", "linear_functions"),
  evalCase("a1-lf-04", "linear_functions"),
  evalCase("a1-lf-09", "linear_functions"),
  evalCase("a1-lf-11", "linear_functions"),
  evalCase("a1-lf-13", "linear_functions"),
  evalCase("a1-lf-18", "linear_functions"),
  evalCase("a1-sf-02", "linear_functions"),
  evalCase("gx-09", "linear_functions"),
  evalCase("gx-11", "linear_functions"),
  ["2x + 3y = 6", "linear_functions"],
];

/** Trig and calculus. */
const PRECALC: Case[] = [
  evalCase("tr-02", "trig_values"),
  evalCase("tr-07", "trig_values"),
  evalCase("t2-05", "trig_values"),
  evalCase("t2-08", "trig_values"),
  evalCase("t2-24", "trig_values"),
  evalCase("t2-11", "trig_equations"),
  evalCase("t2-15", "trig_equations"),
  evalCase("t2-20", "trig_equations"),
  evalCase("t2-22", "trig_equations"),
  evalCase("t2-52", "trig_equations"),
  evalCase("t2-55", "trig_equations"),
  evalCase("t2-57", "trig_equations"),
  evalCase("gr-18", "trig_equations"),
  ["\\sin 45^{\\circ} = \\frac{x}{10}", "trig_values", "precalc_calc"],
  evalCase("lm-05", "limits"),
  evalCase("t2-43", "limits"),
  evalCase("de-02", "derivatives"),
  evalCase("de-12", "derivatives"),
  evalCase("t2-50", "derivatives"),
  ["f^{\\prime}(x) = 3x^{2}", "derivatives"],
  evalCase("ii-03", "integrals"),
  evalCase("di-02", "integrals"),
];

/** Geometry. */
const GEOMETRY: Case[] = [
  ["x + 40 = 90", "angles", "geometry"],
  ["x + 40 = 90", "one_step_equations", "algebra1"],
  ["x + 40 = 90", "one_step_equations"],
  evalCase("ga-02", "angles", "geometry"),
  evalCase("ga-03", "multi_step_equations", "geometry"),
  evalCase("ga-04", "angles", "geometry"),
  evalCase("ga-05", "angles"),
  evalCase("ga-06", "triangles"),
  evalCase("ga-07", "triangles"),
  evalCase("ga-09", "triangles"),
  evalCase("ga-10", "angles"),
  evalCase("ga-12", "angles"),
  evalCase("ga-15", "angles"),
  evalCase("ga-16", "angles"),
  evalCase("ga-17", "angles"),
  evalCase("ga-23", "angles"),
  evalCase("ga-25", "triangles"),
  evalCase("ga-26", "angles"),
  ["x + 40 + 65 = 180", "triangles", "algebra1"],
  evalCase("gr-02", "pythagorean"),
  evalCase("gr-06", "pythagorean"),
  evalCase("gr-09", "pythagorean"),
  evalCase("gr-29", "pythagorean"),
  evalCase("gr-30", "pythagorean"),
  evalCase("gr-11", "triangles", "geometry"),
  evalCase("gr-16", "triangles", "geometry"),
  evalCase("gr-21", "triangles"),
  evalCase("gr-23", "triangles"),
  evalCase("gr-24", "triangles"),
  evalCase("gr-26", "triangles"),
  evalCase("gm-01", "circles"),
  evalCase("gm-02", "circles"),
  evalCase("gm-15", "circles"),
  evalCase("gm-16", "circles"),
  evalCase("gm-24", "circles"),
  evalCase("gc-01", "circles"),
  evalCase("gc-12", "circles"),
  evalCase("gc-14", "circles"),
  evalCase("gc-17", "circles"),
  evalCase("a1-le-09", "circles"),
  evalCase("gm-04", "area_perimeter"),
  evalCase("gm-06", "area_perimeter"),
  evalCase("gm-08", "area_perimeter"),
  evalCase("gm-10", "area_perimeter"),
  evalCase("gm-11", "area_perimeter"),
  evalCase("gm-12", "area_perimeter"),
  evalCase("gm-21", "area_perimeter"),
  evalCase("gm-29", "area_perimeter"),
  evalCase("a1-le-01", "area_perimeter"),
  evalCase("gx-02", "coordinate_geometry"),
  evalCase("gx-03", "coordinate_geometry"),
  evalCase("gx-05", "coordinate_geometry"),
  evalCase("gx-06", "coordinate_geometry"),
  evalCase("gx-08", "coordinate_geometry"),
  evalCase("gx-18", "coordinate_geometry"),
  evalCase("gx-21", "coordinate_geometry"),
  evalCase("gx-25", "coordinate_geometry"),
  evalCase("gx-26", "coordinate_geometry"),
  evalCase("gx-27", "coordinate_geometry"),
  evalCase("gx-14", "coordinate_geometry"),
  evalCase("gx-16", "coordinate_geometry"),
  evalCase("gx-12", "linear_functions"),
  evalCase("ga-21", "angles"),
  evalCase("a1-lf-04", "coordinate_geometry", "geometry"),
  [["E \\text{ is the midpoint of } \\overline{AD}", "\\triangle ABE \\cong \\triangle DCE"], "proofs"],
  ["\\overline{AB} \\cong \\overline{CB}", "proofs"],
  ["\\angle B \\cong \\angle C", "proofs"],
];

/** Science, words and the rest. */
const OTHER: Case[] = [
  evalCase("up-03", "units"),
  evalCase("up-06", "units"),
  evalCase("g2-36", "units"),
  ["2H_2 + O_2 \\to 2H_2O", "chemistry"],
  ["CH_4 + 2O_2 \\rightarrow CO_2 + 2H_2O", "chemistry"],
  ["\\mathrm{Na} + \\mathrm{Cl}_{2} \\rightarrow \\mathrm{NaCl}", "chemistry"],
  ["\\text{Sam has 12 apples and gives away 5. How many are left?}", "word_problems"],
  ["A rectangle is 3 times as long as it is wide and its perimeter is 48. Find its width.", "word_problems"],
  ["\\text{Find the area of a circle with radius } 5", "circles"],
  ["\\text{Solve } 2x + 3 = 11", "two_step_equations"],
  ["\\text{Solve: } 3x - 7 = 11", "two_step_equations"],
  ["solve 5x = 20", "one_step_equations"],
  ["sin x = 0.5", "trig_equations"],
  ["y = 2\\sin x + 1", "functions"],
  ["speed = \\frac{distance}{time}", "units"],
  ["1) 2x + 3 = 11", "two_step_equations"],
  evalCase("a1-st-01", "other"),
  evalCase("a1-st-05", "other"),
  evalCase("a1-sq-01", "other"),
  evalCase("a2-se-04", "other"),
  ["", "other"],
  ["\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}", "other"],
  ["hello", "other"],
  // an answer or a given is not a problem to practise
  ["x = 4", "other"],
  [["x = 4", "y = 2"], "other"],
];

/** The onboarding starters (`src/lib/onboarding/courses.ts`), each with its course. */
const STARTER_SKILLS: Record<string, SkillId> = {
  "2x + 3 = 11": "two_step_equations",
  "5x - 4 = 21": "two_step_equations",
  "3(x + 2) = 18": "multi_step_equations",
  "3^{2} + 4^{2} = c^{2}": "pythagorean",
  "6^{2} + 8^{2} = c^{2}": "pythagorean",
  "x + 65^{\\circ} = 180^{\\circ}": "angles",
  "x^{2} - 5x + 6 = 0": "quadratic_equations",
  "\\sqrt{x + 3} = 5": "radicals",
  "2^{x} = 32": "exponential_equations",
  "\\log_{2} x = 5": "logarithms",
  "3^{x - 1} = 27": "exponential_equations",
  "2\\sin x = 1": "trig_equations",
  "4x - 7 = 13": "two_step_equations",
  "\\frac{3}{4} + \\frac{1}{6}": "add_fractions_unlike",
  "2(x - 1) = 10": "multi_step_equations",
};
const STARTERS: Case[] = Object.entries(STARTER_PROBLEMS).flatMap(([course, list]) => list.map((s): Case => [s.lines, STARTER_SKILLS[s.lines.join("; ")], course]));

/** The board chat's prompt examples and the chat eval's problems (`prompts/chat.ts`, `__eval__/chat/corpus.ts`). */
const CHAT_SKILLS: Record<string, SkillId> = {
  "2x + 3 = 11": "two_step_equations",
  "5x - 4 = 16": "two_step_equations",
  "\\frac{x}{3} + 2 = 7": "two_step_equations",
  "x^{2} + 5x + 6": "factoring",
  "x^{2} - 9": "factoring",
  "2\\cos x = 1, 0^{\\circ} \\le x < 360^{\\circ}": "trig_equations",
  "\\tan x = \\sqrt{3}, 0^{\\circ} \\le x < 360^{\\circ}": "trig_equations",
  "\\sin x = -\\frac{1}{2}, 0^{\\circ} \\le x < 360^{\\circ}": "trig_equations",
  "2\\sin x = 1": "trig_equations",
};
const CHAT: Case[] = [
  ...[...new Set(CHAT_CORPUS.flatMap((c) => c.screen?.problems ?? []))].map((p): Case => [p, CHAT_SKILLS[p]]),
  ["3x + 4 = 19", "two_step_equations"],
  ["7 - 2x = 13", "two_step_equations"],
  ["\\int_{0}^{2} x^{2} \\, dx", "integrals"],
  [TEACH_EXAMPLES[1].action.steps[0].math![0], "two_step_equations"],
  [["x + y = 3", "x - y = 1"], "systems"],
];

const ALL: Case[] = [...SPEC, ...ARITHMETIC, ...K8, ...ALGEBRA, ...FUNCTIONS, ...PRECALC, ...GEOMETRY, ...OTHER, ...STARTERS, ...CHAT];

describe("classifyProblem: the labelled corpus", () => {
  it("has at least 150 cases and every label is a skill", () => {
    expect(ALL.length).toBeGreaterThanOrEqual(150);
    const ids = new Set<string>(SKILLS.map((s) => s.id));
    for (const c of ALL) expect(ids.has(c[1]), String(c[0])).toBe(true);
  });

  it("files every case under its skill (100%)", () => {
    const wrong = ALL.map((c) => ({ lines: lines(c), want: c[1], course: c[2], got: classifyProblem(lines(c), c[2] ?? null) })).filter((r) => r.got !== r.want);
    expect(wrong).toEqual([]);
  });

  it("covers every skill", () => {
    const seen = new Set(ALL.map((c) => c[1]));
    for (const s of SKILLS) expect(seen.has(s.id), s.id).toBe(true);
  });
});

describe("classifyProblem: behaviour", () => {
  it("the course breaks only the ties a course can", () => {
    expect(classifyProblem(["2x + 3 = 11"], "geometry")).toBe("two_step_equations");
    expect(classifyProblem(["(2, 3), (5, 9)"], "geometry")).toBe("coordinate_geometry");
    expect(classifyProblem(["(2, 3), (5, 9)"], "algebra1")).toBe("linear_functions");
    expect(classifyProblem(["\\sin 45^{\\circ} = \\frac{x}{10}"], "geometry")).toBe("triangles");
    expect(classifyProblem(["\\sin 45^{\\circ} = \\frac{x}{10}"], null)).toBe("trig_values");
    expect(classifyProblem(["x + 125 = 180"], "geometry")).toBe("angles");
    expect(classifyProblem(["x + 125 = 180"], "other")).toBe("one_step_equations");
  });

  it("a comma that is not a thousands separator stays: points and lists", () => {
    // a point alone in brackets, with or without a space
    expect(classifyProblem(["(1,250)"])).toBe(classifyProblem(["(1, 250)"]));
    expect(classifyProblem(["(1,234), (5,678)"])).toBe("linear_functions");
    expect(classifyProblem(["(-2,345)"])).toBe("linear_functions");
    // lists whose items are not all groups of three
    expect(classifyProblem(["2, 4, 6, 8"])).toBe("other");
    expect(classifyProblem(["10,200,30"])).toBe("other");
    expect(classifyProblem(["x + y = 5, x - y = 1"])).toBe("systems");
  });

  it("a fraction written with a slash files as the same fraction with a bar, in a product or a quotient too", () => {
    for (const [slash, bar] of [
      ["3/4 \\times 8", "\\frac{3}{4} \\times 8"],
      ["2/3 \\times 3/5", "\\frac{2}{3} \\times \\frac{3}{5}"],
      ["3/4 \\div 1/2", "\\frac{3}{4} \\div \\frac{1}{2}"],
      ["6 \\div 1/3", "6 \\div \\frac{1}{3}"],
      ["3/4 \\times 0.5", "\\frac{3}{4} \\times 0.5"],
      ["3/4 + 1/6", "\\frac{3}{4} + \\frac{1}{6}"],
    ]) {
      expect(classifyProblem([slash]), slash).toBe(classifyProblem([bar]));
    }
    // a slash alone is still a division or a fraction to simplify
    expect(classifyProblem(["84 / 7"])).toBe("division_facts");
    expect(classifyProblem(["68 / 1000"])).toBe("equivalent_fractions");
  });

  it("a system's lines joined with \"; \" (as the record stores it) file the same", () => {
    for (const c of ALL.filter((x) => lines(x).length > 1 && x[1] === "systems")) expect(classifyProblem([lines(c).join("; ")], c[2])).toBe("systems");
  });

  it("never throws: anything unreadable is other", () => {
    for (const junk of ["\\frac{", "}{", "((((", "\\", "=", "?", "\\begin{array}", "x = = 2", "\\sqrt", "|", "^^", "\\text{", "1/0", "a".repeat(2000)]) {
      expect(() => classifyProblem([junk])).not.toThrow();
    }
    expect(classifyProblem([])).toBe("other");
    expect(classifyProblem(["   "])).toBe("other");
    expect(classifyProblem([null as unknown as string])).toBe("other");
  });

  it("is fast: under a millisecond a problem", () => {
    const all = [...ALL.map(lines), ...CORPUS.map((p) => p.lines)];
    for (const l of all) classifyProblem(l); // warm
    // each problem's time, the best of three (a busy test machine's pauses are not the classifier's)
    const times = all.map((l) => {
      let best = Infinity;
      for (let r = 0; r < 3; r++) {
        const t0 = performance.now();
        classifyProblem(l);
        best = Math.min(best, performance.now() - t0);
      }
      return best;
    });
    times.sort((a, b) => a - b);
    expect(times[Math.floor(times.length / 2)]).toBeLessThan(0.25);
    expect(times[Math.floor(times.length * 0.99)]).toBeLessThan(1);
  });
});
