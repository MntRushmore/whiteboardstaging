/**
 * The problem forms the board checks and writes, for a prompt to ask for (Ask's `prompts/ask.ts`,
 * docs/ASK-V2.md): one per K–8 kind of problem, each with an example the board verifies — the
 * route's gate and the board run the same check (`verifyForBoard`, `k8Corpus.test.ts` holds every
 * example to it). Nothing here is imported by the board.
 *
 * Measured 2026-10-11 on 39 K–8 asks through the old chat prompt (gpt-5.4-mini, claude-haiku-5.5):
 * 269 problems, of which the board checks all but clock times and finished facts — the two to
 * steer away from (`BOARD_PROBLEM_AVOID`).
 */

export interface BoardProblemForm {
  kind: string;
  /** how to write it, when the example alone does not say */
  write?: string;
  /** a problem in that form (a system or a given value and its expression: several lines) */
  example: string | readonly string[];
}

export const BOARD_PROBLEM_FORMS: readonly BoardProblemForm[] = [
  { kind: "add, subtract, multiply, divide", example: "345 + 278" },
  { kind: "fill in the blank, missing number (K–3)", write: "a box where the number goes", example: "4 + \\square = 9" },
  { kind: "the answer's box", example: "7 \\times 8 = \\square" },
  { kind: "missing number with a letter (grade 3 and up)", example: "n \\times 6 = 42" },
  { kind: "compare with <, >, =", write: "a circle between the two sides", example: "\\frac{3}{4} \\bigcirc \\frac{5}{8}" },
  { kind: "fractions and mixed numbers", example: "2\\frac{1}{2} + 1\\frac{3}{4}" },
  { kind: "equivalent fractions", example: "\\frac{2}{3} = \\frac{\\square}{12}" },
  { kind: "money", write: "dollars and cents as decimals, the dollar sign escaped", example: "\\$3.25 + \\$1.50" },
  { kind: "big numbers", write: "thousands with {,}", example: "1{,}234 + 567" },
  { kind: "place value", example: "4{,}582 = 4000 + \\square + 80 + 2" },
  { kind: "division with a remainder", write: "the division alone: the student writes the remainder", example: "47 \\div 5" },
  { kind: "order of operations", example: "5 + 3 \\times (8 - 6)^{2}" },
  { kind: "word problem", write: "the plain-number equation a student writes for it, with a box (or a letter from grade 3)", example: "48 - 19 = \\square" },
  { kind: "decimals", example: "4.2 \\times 0.3" },
  { kind: "percent", write: "as a product", example: "25\\% \\times 80" },
  { kind: "ratio and proportion", example: "\\frac{3}{4} = \\frac{x}{12}" },
  { kind: "negative numbers", example: "-5 - (-2)" },
  { kind: "exponents and roots", example: "3^{2} + \\sqrt{16}" },
  { kind: "GCF and LCM", example: "\\gcd(12, 18)" },
  { kind: "evaluate an expression", write: "the value on the first line, the expression ending in = on the next", example: ["x = 3", "2x + 5 ="] },
  { kind: "area, perimeter, volume", write: "the formula with the numbers in", example: "A = 8 \\times 5" },
  { kind: "equations and inequalities", example: "2x + 3 = 11" },
  { kind: "a system of equations", example: ["x + y = 10", "x - y = 2"] },
];

/** What the board cannot check as a problem: never asked for as one (teach it, or answer in the reply). */
export const BOARD_PROBLEM_AVOID: readonly string[] = [
  "a clock time (9{:}20 - 7{:}45): write the minutes, or teach it as a word problem",
  "a finished fact (3 + 7 = 10): put a box for the missing number (3 + \\square = 10)",
  "a remainder written in (17 \\div 5 = 3 R 2): write 17 \\div 5",
  "rounding or estimating (347 \\approx \\square)",
  "units or words (3 \\text{ ft} = \\square \\text{ in}, 25\\% \\text{ of } 80): write the arithmetic (3 \\times 12, 25\\% \\times 80)",
  "a long-division bracket: write 125 \\div 4",
  "cents with ¢: write \\$0.50",
  "a lone fraction to rewrite (\\frac{7}{4})",
];
