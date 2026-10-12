/**
 * K–8 problem sets for the board chat's interlock (`k8Corpus.test.ts`): what the chat route's gate
 * (`gateChatProblems`) and the board (`ChatDesk.writeProblems`) are both asked to write for the
 * kids who use Ask — adding, subtracting, times tables, fractions, money, word problems as plain
 * equations — plus some algebra.
 */

/** Forms a model writes for K–8 that the board must write: [kind, problem lines]. */
export const K8_CHECKABLE: ReadonlyArray<readonly [string, readonly string[]]> = [
  ...(["7 + 5", "7 + 5 =", "345 + 278", "1{,}234 + 567", "12 - 8 =", "1000 - 467", "8 + 6 + 4", "1{,}000{,}000 - 1"] as const).map((p) => ["add & subtract", [p]] as const),
  ...(["6 \\times 7", "6 \\times 7 =", "56 \\div 8", "3 \\cdot 4", "234 \\times 56", "1{,}234 \\times 5", "48 \\times 25", "12 \\times 12"] as const).map((p) => ["times & divide", [p]] as const),
  // missing numbers: a box, a question mark, a line to write on — and a letter from grade 3
  ...([
    "7 + \\square = 12",
    "\\square + 5 = 12",
    "? \\times 6 = 42",
    "7 + ? = 12",
    "42 \\div \\square = 6",
    "7 + \\_\\_ = 12",
    "7 + \\underline{\\quad} = 12",
    "\\boxed{\\phantom{0}} + 3 = 8",
    "12 = 7 + \\square",
    "\\square \\times 8 = 56",
    "15 - \\square = 9",
    "63 \\div ? = 9",
    "7 \\times \\boxed{} = 56",
    "1 + 2 = \\square",
    "25 + 17 = ?",
    "?= 48 - 19",
    "8 - n = 3",
    "n \\times 6 = 42",
    "a + 9 = 17",
  ] as const).map((p) => ["missing number", [p]] as const),
  // comparisons: a blank between two numbers
  ...(["\\frac{3}{4} \\; ? \\; \\frac{2}{3}", "\\frac{3}{4} \\bigcirc \\frac{5}{8}", "0.5 \\; \\square \\; 0.45", "345 \\; \\_ \\; 354", "345 \\square 354", "0.7 \\;\\bigcirc\\; 0.70", "-3 \\; ? \\; -5"] as const).map(
    (p) => ["compare", [p]] as const,
  ),
  ...([
    "\\frac{1}{2} + \\frac{1}{3}",
    "\\frac{3}{4} - \\frac{1}{8}",
    "\\frac{2}{3} \\times \\frac{3}{5}",
    "\\frac{3}{4} \\div \\frac{1}{2}",
    "2\\frac{1}{2} + 1\\frac{3}{4}",
    "3\\frac{1}{3} - 1\\frac{2}{3}",
    "1\\frac{1}{2} \\times 2\\frac{2}{3}",
    "\\frac{1}{4} \\times 12",
    "\\frac{6}{8}",
    "\\frac{6}{8} = \\frac{?}{4}",
    "\\frac{2}{3} = \\frac{\\square}{12}",
    "2 \\frac{3}{4} = \\frac{\\square}{4}",
    "4 \\div \\frac{1}{3}",
    "\\frac{12}{16} = \\frac{3}{\\square}",
  ] as const).map((p) => ["fractions", [p]] as const),
  ...(["\\$3.25 + \\$1.50", "\\$5.00 - \\$2.75", "3.25 + 1.50", "\\$10 - \\$3.45", "4 \\times \\$1.25", "\\$20.00 - \\$7.65", "15\\% \\times \\$40"] as const).map((p) => ["money", [p]] as const),
  ...(["300 + 40 + 7", "3 \\times 100 + 4 \\times 10 + 7", "4{,}582 = 4000 + \\square + 80 + 2", "5{,}000 + 300 + 20 + 1", "4582 = 4000 + 500 + \\square + 2"] as const).map((p) => ["place value", [p]] as const),
  ...(["47 \\div 5", "125 \\div 4", "\\frac{84}{7}", "1{,}248 \\div 6", "952 \\div 8 =", "100 \\div 7"] as const).map((p) => ["division", [p]] as const),
  ...(["3 + 4 \\times 2", "(3 + 4) \\times 2", "2 + 3^{2} \\times 4 - 1", "20 - 4 \\div 2 + 3", "[2 + (3 \\times 4)] \\div 7", "\\{2 + [3 \\times (4 - 1)]\\} \\times 2", "5 + 3 \\times (8 - 6)^{2}"] as const).map(
    (p) => ["order of operations", [p]] as const,
  ),
  // word problems, written as the plain-number equation a student writes for them
  ...(["24 \\div 6", "5 \\times 3 + 2", "48 - 19 = n", "n = 48 - 19", "3 \\times 4 = n", "25 + 17 = \\square"] as const).map((p) => ["word problem", [p]] as const),
  ...(["2.5 + 3.75", "4.2 \\times 0.3", "7.5 \\div 0.5", "10 - 3.6", "0.25 \\times 100", "0.1 + 0.2"] as const).map((p) => ["decimals", [p]] as const),
  ...(["25\\% \\times 80", "0.25 \\times 80", "\\frac{25}{100} \\times 80", "20\\% \\times 50 =", "\\frac{x}{100} \\times 50 = 10", "0.15 \\times 40 = x"] as const).map((p) => ["percents", [p]] as const),
  ...(["3:4 = 9:x", "\\frac{3}{4} = \\frac{x}{12}", "2 : 5 = 6 : \\square", "\\frac{x}{5} = \\frac{12}{20}", "3 : 4 = x : 20", "\\frac{4}{x} = \\frac{8}{10}"] as const).map((p) => ["ratios", [p]] as const),
  ...(["-3 + 7", "-5 - (-2)", "(-4)(-6)", "-18 \\div 3", "|-7| + 3", "(-3) \\times 4 ="] as const).map((p) => ["integers", [p]] as const),
  ...(["2^{3}", "3^{2} + 4^{2}", "\\sqrt{49}", "\\sqrt{144} - \\sqrt{25}", "(2^{3})^{2}", "5^{0}", "3.2 \\times 10^{4}"] as const).map((p) => ["exponents", [p]] as const),
  ...(["x + 5 = 12", "3x = 21", "2x + 3 = 11", "\\frac{x}{4} = 3", "5x - 7 = 3x + 9", "3(x + 2) = 18", "-2x + 5 = 13", "0.5x + 2 = 7", "3x + 2x - 5", "2(x + 4)"] as const).map((p) => ["algebra", [p]] as const),
  ...(["x + 3 > 7", "2x - 1 \\le 9", "-3x < 12", "x - 4 \\geq 2", "5 - x > 2"] as const).map((p) => ["inequalities", [p]] as const),
  ...(["A = 5 \\times 3", "P = 2(5) + 2(3)", "A = \\frac{1}{2}(6)(4)", "A = \\pi (3)^{2}", "3^{2} + 4^{2} = c^{2}", "x + 50 + 60 = 180", "\\frac{4 + 8 + 6 + 10}{4}"] as const).map(
    (p) => ["geometry & stats", [p]] as const,
  ),
  ...(["\\gcd(12, 18)", "\\operatorname{lcm}(4, 6)"] as const).map((p) => ["gcf & lcm", [p]] as const),
  ["evaluate", ["x = 3", "2x + 5 ="]],
  ["system", ["x + y = 10", "x - y = 2"]],
];

/**
 * Forms the board cannot check, refused on the route AND the board, with the same reason (the repair
 * is told it, `PROBLEM_DROP_WHY`): clock times, a remainder written in, a finished fact with nothing
 * left to do, rounding, words and units, a long-division bracket, a lone improper fraction.
 */
export const K8_UNCHECKABLE: ReadonlyArray<readonly [string, readonly string[], string]> = [
  ["clock time", ["9{:}20 - 7{:}45"], "unsolved"],
  ["remainder written in", ["47 \\div 5 = \\square \\, R \\, \\square"], "unreadable"],
  ["remainder written in", ["17 \\div 5 = 3 R 2"], "unreadable"],
  ["a finished fact", ["1 + 9 = 10"], "unsolved"],
  ["a true comparison", ["\\frac{1}{2} < \\frac{3}{4}"], "unsolved"],
  ["rounding", ["347 \\approx \\square"], "unreadable"],
  ["words", ["25\\% \\text{ of } 80"], "words"],
  ["units", ["3 \\, \\mathrm{ft} = \\square \\, \\mathrm{in}"], "false"],
  ["long-division bracket", ["4 \\overline{)125}"], "unreadable"],
  ["a lone improper fraction", ["\\frac{7}{4}"], "unsolved"],
  ["the hand cannot write it", ["5 \\bmod 3"], "unwritable"],
];

/**
 * What the production chat prompt (`prompts/chat.ts`, gpt-5.4-mini and claude-haiku-5.5) proposed for
 * 39 K–8 asks on 2026-10-11, each problem once: [the ask, its problems].
 */
export const K8_MODEL_PROBLEMS: ReadonlyArray<readonly [string, ReadonlyArray<string | readonly string[]>]> = [
  ["give me 5 addition problems", ["7 + 8", "14 + 9", "23 + 16", "35 + 27", "48 + 19", "\\frac{3}{4} + \\frac{1}{6}", "\\frac{2}{5} + \\frac{3}{10}", "\\frac{5}{8} + \\frac{1}{4}", "\\frac{7}{12} + \\frac{1}{3}", "\\frac{1}{2} + \\frac{4}{9}"]],
  ["subtraction with regrouping", ["52 - 19", "73 - 28", "406 - 178", "1002 - 589", "523 - 287", "741 - 358", "900 - 474", "615 - 238"]],
  ["times tables practice", ["7 \\times 8", "6 \\times 9", "4 \\times 12", "8 \\times 7", "12 \\times 4"]],
  ["7 times table", ["7 \\times 1", "7 \\times 2", "7 \\times 3", "7 \\times 4", "7 \\times 5", "7 \\times 6", "7 \\times 7", "7 \\times 9", "7 \\times 10", "7 \\times 11", "7 \\times 12"]],
  ["division problems with remainders", ["17 \\div 5", "29 \\div 4", "53 \\div 6", "68 \\div 7", "23 \\div 4", "37 \\div 5", "50 \\div 7", "64 \\div 9"]],
  ["long division practice", ["48 \\div 6", "84 \\div 7", "96 \\div 8", "135 \\div 9", "156 \\div 12", "252 \\div 14", "368 \\div 16", "595 \\div 17"]],
  ["missing number problems", ["x + 7 = 15", "9 - x = 4", "3x = 21", "\\frac{x}{5} = 6", "x + 7 = 12", "5x = 35", "\\frac{x}{4} = 6"]],
  ["fill in the blank addition for 1st grade", ["1 + 2 = \\square", "3 + 1 = \\square", "2 + 4 = \\square", "5 + 0 = \\square", "4 + \\square = 9", "\\square + 6 = 10", "7 + \\square = 12", "\\square + 5 = 8"]],
  ["adding fractions with unlike denominators", ["\\frac{1}{2} + \\frac{1}{3}", "\\frac{2}{5} + \\frac{1}{10}", "\\frac{3}{4} + \\frac{2}{3}", "\\frac{5}{6} + \\frac{1}{4}", "\\frac{2}{3} + \\frac{1}{4}"]],
  ["mixed numbers", ["1\\frac{1}{2} + 2\\frac{3}{4}", "3\\frac{2}{5} - 1\\frac{1}{5}", "2\\frac{1}{3} \\times 1\\frac{1}{2}", "4\\frac{3}{4} \\div 1\\frac{1}{2}", "2\\frac{1}{2} + 1\\frac{1}{3}", "3\\frac{3}{4} - 1\\frac{1}{2}", "1\\frac{2}{3} \\times 2\\frac{1}{4}", "4\\frac{1}{5} \\div 2"]],
  ["comparing fractions", ["\\frac{3}{4} \\ ? \\ \\frac{5}{8}", "\\frac{2}{3} \\ ? \\ \\frac{3}{5}", "\\frac{7}{10} \\ ? \\ \\frac{2}{3}", "\\frac{5}{6} \\ ? \\ \\frac{4}{5}"]],
  ["money problems", ["\\frac{3}{4} + \\frac{1}{2}", "5x + 12 = 47", "\\frac{18}{3} + 7", "2(x + 9) = 34", "3 \\times 2.75 + 4.50", "\\frac{18.60}{6}", "20.00 - 4 \\times 3.25", "0.20x = 3.60"]],
  ["elapsed time problems", ["15{:}40 - 13{:}55", "9{:}20 - 7{:}45", "18{:}10 - 16{:}35", "12{:}05 - 10{:}50", "(6 \\cdot 60 + 50) - (3 \\cdot 60 + 20)", "(9 \\cdot 60 + 5) - (7 \\cdot 60 + 40)", "(4 \\cdot 60 + 35) - (1 \\cdot 60 + 50)", "(11 \\cdot 60 + 15) - (8 \\cdot 60 + 45)"]],
  ["multi-digit multiplication", ["34 \\cdot 27", "48 \\cdot 16", "125 \\cdot 14", "206 \\cdot 3", "23 \\times 14", "36 \\times 25", "47 \\times 32", "58 \\times 16"]],
  ["decimals", ["3.4 + 2.7", "8.5 - 3.9", "0.6 \\times 0.8", "7.2 \\div 0.9", "2.4 + 1.75", "5.6 - 2.37", "0.6 \\times 0.5", "9.6 \\div 0.8"]],
  ["ratios and proportions", ["\\frac{3}{5} = \\frac{x}{20}", "\\frac{7}{9} = \\frac{21}{x}", "4:6 = x:15", "\\frac{5}{8} = \\frac{15}{x}", "\\frac{x}{4} = \\frac{9}{12}", "3 : 5 = x : 20", "\\frac{2}{7} = \\frac{x}{21}", "\\frac{x}{6} = \\frac{15}{18}"]],
  ["simple equations", ["x + 3 = 11", "2x - 5 = 9", "3x + 4 = 19", "\\frac{x}{2} + 6 = 10", "\\frac{x}{4} = 5", "2x - 6 = 10"]],
  ["negative numbers", ["-7 + 12", "15 - 23", "(-4)(6)", "\\frac{-18}{3}", "-3 + 7", "4 - 9", "-5 - (-2)", "(-6) \\times 3"]],
  ["exponents", ["2^{3}", "5^{2}", "(3^{2})^{2}", "2^{4} \\cdot 2^{3}", "3^{2} \\cdot 3^{5}", "\\frac{x^{7}}{x^{3}}", "(y^{2})^{4}", "2^{-3}"]],
  ["GCF and LCM", ["\\gcd(12,18)", "\\operatorname{lcm}(6,15)", "\\gcd(24,36)", "\\operatorname{lcm}(8,12)", "\\gcd(12, 18)", "\\gcd(20, 35)", "\\operatorname{lcm}(4, 6)", "\\operatorname{lcm}(9, 15)"]],
  ["i'm in 3rd grade give me hard math", ["746 + 589", "900 - 467", "\\frac{1}{2} + \\frac{1}{4}", "47 \\times 6", "382 + 519", "720 \\div 8", "\\frac{2}{5} + \\frac{1}{5}"]],
  ["2 digit by 1 digit multiplication", ["34 \\times 6", "57 \\times 4", "23 \\times 4", "67 \\times 8"]],
  ["skip counting by 5s", ["0 + 5", "5 + 5", "10 + 5", "15 + 5", "5 \\times 1", "5 \\times 3", "5 \\times 4", "5 \\times 6", "5 \\times 8", "5 \\times 10"]],
  ["345 + 278", ["345 + 278"]],
  ["dividing fractions", ["\\frac{3}{4} \\div \\frac{2}{5}", "\\frac{7}{8} \\div \\frac{1}{2}", "\\frac{5}{6} \\div \\frac{3}{4}", "\\frac{9}{10} \\div \\frac{3}{5}", "\\frac{2}{3} \\div \\frac{4}{5}", "\\frac{3}{4} \\div \\frac{3}{8}", "\\frac{5}{6} \\div \\frac{2}{3}", "\\frac{7}{10} \\div \\frac{7}{5}"]],
  ["practice for 2nd grade", ["7 + 2", "10 - 4", "3 + 5", "8 - 1", "45 + 36", "82 - 47"]],
  ["number bonds to 10", ["1 + 9 = 10", "2 + 8 = 10", "3 + 7 = 10", "4 + 6 = 10", "3 + x = 10", "7 + x = 10", "x + 6 = 10", "x + 9 = 10"]],
  ["adding and subtracting money", ["12.50 + 3.75", "20.00 - 8.46", "5.90 + 14.35", "30.00 - 12.80", "20.00 - 6.45", "8.30 + 14.85", "25.00 - 11.25"]],
  ["4th grade math practice", ["38 + 27", "64 - 19", "\\frac{3}{4} + \\frac{1}{4}", "325 + 268", "4 \\times 37", "\\frac{2}{7} + \\frac{3}{7}"]],
  ["algebra for 7th grade", ["2x + 5 = 17", "3(x + 4) = 21", "x/4 - 3 = 1", "5x - 7 = 18", "\\frac{x}{2} - 5 = 1", "7 - 2x = 13", "4(2x - 1) - 3x"]],
  ["place value", ["5 \\times 10^{2} + 3 \\times 10 + 8", "4 \\times 10^{3} + 6 \\times 10 + 9", "7 \\times 10^{2} + 2 + 5 \\times \\frac{1}{10}", "3 \\times 10^{4} + 8 \\times 10^{2} + 1"]],
  ["greater than less than", ["2x + 3 < 11", "5x - 4 \\ge 16", "3 - 2x > 7", "\\frac{x}{3} + 1 > 4"]],
  ["order of operations", ["3 + 4 \\times 2", "(6 + 2) \\div 4 - 1", "2^{3} + 10 \\div 5", "5 \\times (7 - 3) + 6"]],
  ["give me some word problems", ["3x + 5 = 26", "\\frac{x}{4} + 7 = 12", "2(x + 6) = 30", "48 - 5x = 13"]],
  ["percent problems", ["\\frac{3}{4} \\cdot 100\\%", "15\\% \\cdot 60 + 60", "\\frac{30}{120} \\cdot 100\\%"]],
  ["inequalities", ["3x + 4 > 19", "5 - 2x \\le 11", "\\frac{x}{3} - 2 < 1", "4(x - 1) \\ge 2x + 6"]],
  ["area and perimeter", ["2(7 + 4)", "8 \\times 5", "2(9 + 3)", "\\frac{1}{2} \\times 6 \\times 5"]],
  ["unit conversions inches and feet", ["3 \\times 12", "\\frac{60}{12}", "2 \\times 12 + 7", "\\frac{84}{12}"]],
  ["write 6 x 7 on the board", ["6 \\times 7"]],
];

/** The model's problems the board cannot check (and should not be asked for): clock times, finished facts. */
export const K8_MODEL_UNCHECKABLE: ReadonlySet<string> = new Set([
  "15{:}40 - 13{:}55",
  "9{:}20 - 7{:}45",
  "18{:}10 - 16{:}35",
  "12{:}05 - 10{:}50",
  "1 + 9 = 10",
  "2 + 8 = 10",
  "3 + 7 = 10",
  "4 + 6 = 10",
]);
