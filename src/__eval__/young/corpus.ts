/**
 * Young kids' working, K–6: the problem the tutor wrote (or the child's own first line), the lines a
 * child writes under it as Mathpix reads them, and the mark a teacher gives each line. The board
 * marks every one of them as it would (`young.ts`, through `engine/columnWork.ts`); the scoreboard
 * says how many columns it marks exactly as a teacher would.
 *
 * Why: prod's learning record (2026-10-03 to 10-08) had young kids' arithmetic going wrong in ways
 * that were the tutor's fault — `18 \times 7` with 8 lines and 3 rings, none right; `27 \times 9`
 * (twice) and `34 \times 7` the same; `8+1` right but unfinished; `5+6` ringed as a "sign" mistake;
 * `144 \div 9`, `42 \div 7`, `30 \div 5` worked and never credited; `5.4 \times 0.1` unfinished. Kids
 * work a multiplication in side calculations (`10 \times 7 = 70`, `8 \times 7 = 56`, `70 + 56 = 126`)
 * or in columns, a division in a bracket, a remainder as `3 R 2`. Those ids say `prod`.
 *
 * Marks: `tick`, `ring`, `none` (no mark at all), `?` (the tutor's question mark), and `calm` — a
 * tick or no mark, never a ring or a `?` (a true line a teacher might tick or let be). `solved`: the
 * column ends with the problem answered (a line ticked as its answer).
 */

export const YOUNG_GRADES = ["K-2", "3-4", "5-6"] as const;
export type YoungGrade = (typeof YOUNG_GRADES)[number];

export const YOUNG_TOPICS = ["add", "sub", "mul", "div", "frac", "dec", "order", "algebra"] as const;
export type YoungTopic = (typeof YOUNG_TOPICS)[number];

export type YoungMark = "tick" | "ring" | "none" | "?" | "calm";

export interface YoungCase {
  id: string;
  grade: YoungGrade;
  topic: YoungTopic;
  /** the problem the tutor wrote over the work; absent: the child's own first line is the problem */
  problem?: string;
  /** the child's lines, top to bottom, each with the mark a teacher gives it */
  work: ReadonlyArray<readonly [latex: string, mark: YoungMark]>;
  /** the column ends with the problem answered */
  solved: boolean;
  note?: string;
}

const STACK = (rows: string) => `\\begin{array}{r} ${rows} \\end{array}`;

export const YOUNG_CORPUS: readonly YoungCase[] = [
  // ---------------------------------------------------------------- K–2: small sums, answers alone
  { id: "add-4p3-bare", grade: "K-2", topic: "add", problem: "4+3", work: [["7", "tick"]], solved: true, note: "a lone 7 under 4 + 3" },
  { id: "add-4p3-eq", grade: "K-2", topic: "add", problem: "4+3", work: [["= 7", "tick"]], solved: true },
  { id: "add-4p3-dot", grade: "K-2", topic: "add", problem: "4+3", work: [["7.", "tick"]], solved: true, note: "a wobbly 7 with a stray dot" },
  { id: "add-4p3-wrong", grade: "K-2", topic: "add", problem: "4+3", work: [["8", "ring"]], solved: false },
  { id: "add-4p3-whole", grade: "K-2", topic: "add", problem: "4+3", work: [["4 + 3 = 7", "tick"]], solved: true },
  { id: "add-4p3-turned", grade: "K-2", topic: "add", problem: "4+3", work: [["3 + 4 = 7", "tick"]], solved: true, note: "the sum turned round" },
  { id: "add-8p1-stray", grade: "K-2", topic: "add", problem: "8+1", work: [["= 9.", "tick"]], solved: true, note: "prod: 8+1 ticked but unfinished — a stray dot after the 9" },
  { id: "add-8p1-comma", grade: "K-2", topic: "add", problem: "8+1", work: [["9,", "tick"]], solved: true },
  { id: "add-8p1-prime", grade: "K-2", topic: "add", problem: "8+1", work: [["9^{\\prime}", "tick"]], solved: true, note: "a stray mark read as a prime" },
  { id: "add-8p1-cdot", grade: "K-2", topic: "add", problem: "8+1", work: [["9 \\cdot", "tick"]], solved: true },
  { id: "add-5p6-minus", grade: "K-2", topic: "add", problem: "5+6", work: [["-11", "tick"]], solved: true, note: "prod: 5+6 ringed as a sign mistake — a wobbly = read as a minus" },
  { id: "add-5p6-bare", grade: "K-2", topic: "add", problem: "5+6", work: [["11", "tick"]], solved: true },
  { id: "add-5p6-doubles", grade: "K-2", topic: "add", problem: "5+6", work: [["5 + 5 = 10", "calm"], ["10 + 1 = 11", "tick"]], solved: true, note: "doubles plus one" },
  { id: "add-8p5-ten", grade: "K-2", topic: "add", problem: "8+5", work: [["8 + 2 = 10", "calm"], ["10 + 3 = 13", "tick"]], solved: true, note: "making ten" },
  { id: "add-5p8-bare", grade: "K-2", topic: "add", problem: "5 + 8", work: [["13", "tick"]], solved: true, note: "prod: 5 + 8" },
  { id: "add-7p8-doubles", grade: "K-2", topic: "add", problem: "7 + 8", work: [["7 + 7 = 14", "calm"], ["14 + 1 = 15", "tick"]], solved: true, note: "prod: 7 + 8" },
  { id: "add-7p8-wrong", grade: "K-2", topic: "add", problem: "7 + 8", work: [["14", "ring"]], solved: false },
  { id: "add-47p38-split", grade: "K-2", topic: "add", problem: "47 + 38", work: [["40 + 30 = 70", "tick"], ["7 + 8 = 15", "tick"], ["70 + 15 = 85", "tick"]], solved: true },
  { id: "add-47p38-bare", grade: "K-2", topic: "add", problem: "47 + 38", work: [["70", "none"], ["15", "none"], ["85", "tick"]], solved: true, note: "the partial sums alone are no wrong answers" },
  { id: "add-47p38-slip", grade: "K-2", topic: "add", problem: "47 + 38", work: [["40 + 30 = 70", "tick"], ["7 + 8 = 15", "tick"], ["70 + 5 = 75", "calm"], ["75", "ring"]], solved: false, note: "a true line with the wrong number in it; the wrong answer ringed" },
  { id: "add-47p38-wrong", grade: "K-2", topic: "add", problem: "47 + 38", work: [["75", "ring"]], solved: false },
  { id: "add-25p17-running", grade: "K-2", topic: "add", problem: "25 + 17", work: [["20 + 10 = 30 + 12 = 42", "calm"]], solved: true, note: "a running chain: = used as 'then'" },
  { id: "add-stack-own", grade: "K-2", topic: "add", work: [[STACK("286 \\\\ +680 \\\\ \\hline 966"), "tick"]], solved: true },
  { id: "add-stack-wrong", grade: "K-2", topic: "add", work: [[STACK("286 \\\\ +680 \\\\ \\hline 866"), "ring"]], solved: false },
  { id: "add-36p2-own", grade: "K-2", topic: "add", work: [["36 + 2 = 38", "tick"]], solved: true, note: "the child's own line" },
  { id: "sub-9m4", grade: "K-2", topic: "sub", problem: "9 - 4", work: [["5", "tick"]], solved: true },
  { id: "sub-9m4-wrong", grade: "K-2", topic: "sub", problem: "9 - 4", work: [["6", "ring"]], solved: false },
  { id: "sub-12m5-ten", grade: "K-2", topic: "sub", problem: "12 - 5", work: [["12 - 2 = 10", "calm"], ["10 - 3 = 7", "tick"]], solved: true, note: "back to ten" },
  { id: "sub-52m17-chain", grade: "K-2", topic: "sub", problem: "52 - 17", work: [["52 - 10 = 42", "tick"], ["42 - 7 = 35", "tick"]], solved: true },
  { id: "sub-52m17-bare", grade: "K-2", topic: "sub", problem: "52 - 17", work: [["42", "none"], ["35", "tick"]], solved: true },
  { id: "sub-stack", grade: "K-2", topic: "sub", work: [[STACK("52 \\\\ -17 \\\\ \\hline 35"), "tick"]], solved: true },

  // ---------------------------------------------------------------- 3–4: multiplication, side calculations
  { id: "mul-18x7-split", grade: "3-4", topic: "mul", problem: "18 \\times 7", work: [["10 \\times 7 = 70", "tick"], ["8 \\times 7 = 56", "tick"], ["70 + 56 = 126", "tick"]], solved: true, note: "prod: 18 × 7, 8 lines, 3 rings, none right" },
  { id: "mul-18x7-bare", grade: "3-4", topic: "mul", problem: "18 \\times 7", work: [["70", "none"], ["56", "none"], ["126", "tick"]], solved: true, note: "prod: the partial products alone" },
  { id: "mul-18x7-mixed", grade: "3-4", topic: "mul", problem: "18 \\times 7", work: [["10 \\times 7 = 70", "tick"], ["8 \\times 7 = 56", "tick"], ["126", "tick"]], solved: true },
  { id: "mul-18x7-slip", grade: "3-4", topic: "mul", problem: "18 \\times 7", work: [["10 \\times 7 = 70", "tick"], ["8 \\times 7 = 54", "ring"], ["8 \\times 7 = 56", "tick"], ["70 + 56 = 126", "tick"]], solved: true, note: "a slip, ringed, put right" },
  { id: "mul-18x7-carried", grade: "3-4", topic: "mul", problem: "18 \\times 7", work: [["10 \\times 7 = 70", "tick"], ["8 \\times 7 = 54", "ring"], ["70 + 54 = 124", "calm"], ["124", "none"]], solved: false, note: "carried on from the slip: ringed once, where it was made" },
  { id: "mul-18x7-round", grade: "3-4", topic: "mul", problem: "18 \\times 7", work: [["20 \\times 7 = 140", "tick"], ["2 \\times 7 = 14", "tick"], ["140 - 14 = 126", "tick"]], solved: true, note: "round up and take back" },
  { id: "mul-18x7-chain", grade: "3-4", topic: "mul", problem: "18 \\times 7", work: [["18 \\times 7 = 10 \\times 7 + 8 \\times 7 = 70 + 56 = 126", "tick"]], solved: true },
  { id: "mul-18x7-steps", grade: "3-4", topic: "mul", problem: "18 \\times 7", work: [["10 \\times 7 + 8 \\times 7", "tick"], ["= 70 + 56", "tick"], ["= 126", "tick"]], solved: true },
  { id: "mul-18x7-other", grade: "3-4", topic: "mul", problem: "18 \\times 7", work: [["6 \\times 21 = 126", "calm"]], solved: false, note: "true, the same number, but not this problem: it does not solve it" },
  { id: "mul-18x7-wrong", grade: "3-4", topic: "mul", problem: "18 \\times 7", work: [["10 \\times 7 = 70", "tick"], ["8 \\times 7 = 56", "tick"], ["116", "ring"]], solved: false },
  { id: "mul-27x9-split", grade: "3-4", topic: "mul", problem: "27 \\times 9", work: [["20 \\times 9 = 180", "tick"], ["7 \\times 9 = 63", "tick"], ["180 + 63 = 243", "tick"]], solved: true, note: "prod: 27 × 9, twice" },
  { id: "mul-27x9-bare", grade: "3-4", topic: "mul", problem: "27 \\times 9", work: [["180", "none"], ["63", "none"], ["243", "tick"]], solved: true },
  { id: "mul-27x9-tens", grade: "3-4", topic: "mul", problem: "27 \\times 9", work: [["27 \\times 10 = 270", "tick"], ["270 - 27 = 243", "tick"]], solved: true, note: "times ten, take one 27 back" },
  { id: "mul-34x7-split", grade: "3-4", topic: "mul", problem: "34 \\times 7", work: [["30 \\times 7 = 210", "tick"], ["4 \\times 7 = 28", "tick"], ["210 + 28 = 238", "tick"]], solved: true, note: "prod: 34 × 7" },
  { id: "mul-34x7-bare", grade: "3-4", topic: "mul", problem: "34 \\times 7", work: [["210", "none"], ["28", "none"], ["238", "tick"]], solved: true },
  { id: "mul-13x4-split", grade: "3-4", topic: "mul", problem: "13 \\times 4", work: [["10 \\times 4 = 40", "tick"], ["3 \\times 4 = 12", "tick"], ["40 + 12 = 52", "tick"]], solved: true, note: "prod: 13 × 4" },
  { id: "mul-13x4-wrong", grade: "3-4", topic: "mul", problem: "13 \\times 4", work: [["10 \\times 4 = 40", "tick"], ["3 \\times 4 = 12", "tick"], ["42", "ring"]], solved: false },
  { id: "mul-6x7-bare", grade: "3-4", topic: "mul", problem: "6 \\times 7", work: [["42", "tick"]], solved: true },
  { id: "mul-6x7-wrong", grade: "3-4", topic: "mul", problem: "6 \\times 7", work: [["48", "ring"]], solved: false },
  { id: "mul-46x23-grid", grade: "3-4", topic: "mul", problem: "46 \\times 23", work: [["40 \\times 20 = 800", "tick"], ["40 \\times 3 = 120", "tick"], ["6 \\times 20 = 120", "tick"], ["6 \\times 3 = 18", "tick"], ["800 + 120 + 120 + 18 = 1058", "tick"]], solved: true, note: "the area model" },
  // long multiplication in columns
  { id: "mul-long-46x23", grade: "3-4", topic: "mul", work: [[STACK("46 \\\\ \\times 23 \\\\ \\hline 138 \\\\ 920 \\\\ \\hline 1058"), "tick"]], solved: true },
  { id: "mul-long-46x23-placeholder", grade: "3-4", topic: "mul", work: [[STACK("46 \\\\ \\times 23 \\\\ \\hline 138 \\\\ 92 \\\\ \\hline 1058"), "tick"]], solved: true, note: "the second row shifted, its 0 left out" },
  { id: "mul-long-46x23-plus", grade: "3-4", topic: "mul", work: [[STACK("46 \\\\ \\times 23 \\\\ \\hline 138 \\\\ +920 \\\\ \\hline 1058"), "tick"]], solved: true },
  { id: "mul-long-46x23-row-wrong", grade: "3-4", topic: "mul", work: [[STACK("46 \\\\ \\times 23 \\\\ \\hline 138 \\\\ 820 \\\\ \\hline 958"), "ring"]], solved: false },
  { id: "mul-long-46x23-total-wrong", grade: "3-4", topic: "mul", work: [[STACK("46 \\\\ \\times 23 \\\\ \\hline 138 \\\\ 920 \\\\ \\hline 1048"), "ring"]], solved: false },
  { id: "mul-long-46x23-first-row", grade: "3-4", topic: "mul", work: [[STACK("46 \\\\ \\times 23 \\\\ \\hline 138"), "none"]], solved: false, note: "the first partial product, not a wrong answer" },
  { id: "mul-long-46x23-rows", grade: "3-4", topic: "mul", work: [[STACK("46 \\\\ \\times 23 \\\\ \\hline 138 \\\\ 920"), "none"]], solved: false, note: "both rows, the total still to come" },
  { id: "mul-long-123x45", grade: "3-4", topic: "mul", work: [[STACK("123 \\\\ \\times 45 \\\\ \\hline 615 \\\\ 4920 \\\\ \\hline 5535"), "tick"]], solved: true },
  { id: "mul-long-under-problem", grade: "3-4", topic: "mul", problem: "46 \\times 23", work: [[STACK("46 \\\\ \\times 23 \\\\ \\hline 138 \\\\ 920 \\\\ \\hline 1058"), "tick"]], solved: true },
  // ...set out the other ways a class sets it out (review, 2026-10-09: each of these was ringed)
  { id: "mul-long-46x23-partials", grade: "3-4", topic: "mul", work: [[STACK("46 \\\\ \\times 23 \\\\ \\hline 18 \\\\ 120 \\\\ 120 \\\\ +800 \\\\ \\hline 1058"), "tick"]], solved: true, note: "partial products: 6 × 3, 40 × 3, 6 × 20, 40 × 20" },
  { id: "mul-long-46x23-reversed", grade: "3-4", topic: "mul", work: [[STACK("46 \\\\ \\times 23 \\\\ \\hline 920 \\\\ +138 \\\\ \\hline 1058"), "tick"]], solved: true, note: "the tens row first" },
  { id: "mul-long-46x105-zeros", grade: "3-4", topic: "mul", work: [[STACK("46 \\\\ \\times 105 \\\\ \\hline 230 \\\\ 000 \\\\ +4600 \\\\ \\hline 4830"), "tick"]], solved: true, note: "a row of zeros for the 0 tens" },
  { id: "mul-long-46x205-zeros", grade: "3-4", topic: "mul", work: [[STACK("46 \\\\ \\times 205 \\\\ \\hline 230 \\\\ 000 \\\\ 9200 \\\\ \\hline 9430"), "tick"]], solved: true },
  { id: "mul-long-46x20-zeros", grade: "3-4", topic: "mul", work: [[STACK("46 \\\\ \\times 20 \\\\ \\hline 00 \\\\ 920 \\\\ \\hline 920"), "tick"]], solved: true, note: "a row of zeros for the 0 ones" },
  { id: "mul-long-46x23-partials-total-wrong", grade: "3-4", topic: "mul", work: [[STACK("46 \\\\ \\times 23 \\\\ \\hline 18 \\\\ 120 \\\\ 120 \\\\ 800 \\\\ \\hline 1048"), "ring"]], solved: false },
  { id: "mul-long-46x23-partials-row-wrong", grade: "3-4", topic: "mul", work: [[STACK("46 \\\\ \\times 23 \\\\ \\hline 18 \\\\ 120 \\\\ 120 \\\\ 700 \\\\ \\hline 958"), "ring"]], solved: false, note: "40 × 20 written 700, the rows added right" },
  { id: "mul-long-46x23-partials-so-far", grade: "3-4", topic: "mul", work: [[STACK("46 \\\\ \\times 23 \\\\ \\hline 18 \\\\ 120"), "none"]], solved: false, note: "two partial products, the rest still to come" },
  { id: "mul-long-46x23-reversed-row-wrong", grade: "3-4", topic: "mul", work: [[STACK("46 \\\\ \\times 23 \\\\ \\hline 920 \\\\ 128 \\\\ \\hline 1048"), "ring"]], solved: false },
  { id: "mul-stack-direct", grade: "3-4", topic: "mul", work: [[STACK("46 \\\\ \\times 23 \\\\ \\hline 1058"), "tick"]], solved: true },
  { id: "mul-stack-1digit", grade: "3-4", topic: "mul", work: [[STACK("23 \\\\ \\times 4 \\\\ \\hline 92"), "tick"]], solved: true },

  // ---------------------------------------------------------------- 3–4: division
  { id: "div-144d9-inline", grade: "3-4", topic: "div", problem: "144 \\div 9", work: [["144 \\div 9 = 16", "tick"]], solved: true, note: "prod: 144 ÷ 9 worked and never credited" },
  { id: "div-144d9-bare", grade: "3-4", topic: "div", problem: "144 \\div 9", work: [["16", "tick"]], solved: true },
  { id: "div-144d9-check", grade: "3-4", topic: "div", problem: "144 \\div 9", work: [["9 \\times 16 = 144", "tick"], ["16", "tick"]], solved: true },
  { id: "div-144d9-chunks", grade: "3-4", topic: "div", problem: "144 \\div 9", work: [["9 \\times 10 = 90", "tick"], ["144 - 90 = 54", "tick"], ["9 \\times 6 = 54", "tick"], ["10 + 6 = 16", "tick"]], solved: true, note: "chunking" },
  { id: "div-144d9-bracket", grade: "3-4", topic: "div", problem: "144 \\div 9", work: [[STACK("16 \\\\ 9 \\longdiv { 144 }"), "tick"]], solved: true, note: "the bracket, its quotient over it" },
  { id: "div-144d9-bracket-own", grade: "3-4", topic: "div", work: [[STACK("16 \\\\ 9 \\longdiv { 144 }"), "tick"]], solved: true },
  { id: "div-144d9-bracket-empty", grade: "3-4", topic: "div", problem: "144 \\div 9", work: [["9 \\longdiv { 144 }", "none"]], solved: false, note: "the bracket drawn, nothing over it yet" },
  { id: "div-144d9-bracket-working", grade: "3-4", topic: "div", problem: "144 \\div 9", work: [["9 \\longdiv { 144 }", "none"], ["-9", "none"], ["54", "none"], ["-54", "none"], ["0", "none"], ["16", "tick"]], solved: true, note: "the working under the bracket, line by line" },
  { id: "div-144d9-bracket-block", grade: "3-4", topic: "div", problem: "144 \\div 9", work: [[STACK("16 \\\\ 9 \\longdiv { 144 } \\\\ \\underline{9} \\\\ 54 \\\\ \\underline{54} \\\\ 0"), "tick"]], solved: true, note: "the whole layout read as one block" },
  { id: "div-144d9-bracket-frac", grade: "3-4", topic: "div", problem: "144 \\div 9", work: [["\\frac{16}{9 \\longdiv { 144 }}", "tick"]], solved: true, note: "the quotient over the bracket read as a fraction" },
  { id: "div-144d9-enclose", grade: "3-4", topic: "div", problem: "144 \\div 9", work: [[STACK("16 \\\\ 9 \\enclose{longdiv}{144}"), "tick"]], solved: true },
  { id: "div-144d9-bracket-wrong", grade: "3-4", topic: "div", problem: "144 \\div 9", work: [[STACK("14 \\\\ 9 \\longdiv { 144 }"), "ring"]], solved: false },
  { id: "div-144d9-bracket-started", grade: "3-4", topic: "div", problem: "144 \\div 9", work: [[STACK("1 \\\\ 9 \\longdiv { 144 }"), "none"]], solved: false, note: "the quotient's first digit, right so far" },
  { id: "div-42d7-inline", grade: "3-4", topic: "div", problem: "42 \\div 7", work: [["42 \\div 7 = 6", "tick"]], solved: true, note: "prod: 42 ÷ 7" },
  { id: "div-42d7-check", grade: "3-4", topic: "div", problem: "42 \\div 7", work: [["7 \\times 6 = 42", "tick"], ["6", "tick"]], solved: true },
  { id: "div-42d7-wrong", grade: "3-4", topic: "div", problem: "42 \\div 7", work: [["8", "ring"]], solved: false },
  { id: "div-30d5-inline", grade: "3-4", topic: "div", problem: "30 \\div 5", work: [["30 \\div 5 = 6", "tick"]], solved: true, note: "prod: 30 ÷ 5" },
  { id: "div-30d5-check", grade: "3-4", topic: "div", problem: "30 \\div 5", work: [["5 \\times 6 = 30", "tick"], ["= 6", "tick"]], solved: true },
  { id: "div-17d5-R", grade: "3-4", topic: "div", problem: "17 \\div 5", work: [["3 R 2", "tick"]], solved: true, note: "a remainder" },
  { id: "div-17d5-R-whole", grade: "3-4", topic: "div", problem: "17 \\div 5", work: [["17 \\div 5 = 3 R 2", "tick"]], solved: true },
  { id: "div-17d5-R-text", grade: "3-4", topic: "div", problem: "17 \\div 5", work: [["3 \\text { R } 2", "tick"]], solved: true },
  { id: "div-17d5-R-mathrm", grade: "3-4", topic: "div", problem: "17 \\div 5", work: [["3 \\mathrm{R} 2", "tick"]], solved: true },
  { id: "div-17d5-r", grade: "3-4", topic: "div", problem: "17 \\div 5", work: [["3 r 2", "tick"]], solved: true },
  { id: "div-17d5-mixed", grade: "3-4", topic: "div", problem: "17 \\div 5", work: [["3\\frac{2}{5}", "tick"]], solved: true },
  { id: "div-17d5-decimal", grade: "3-4", topic: "div", problem: "17 \\div 5", work: [["3.4", "tick"]], solved: true },
  { id: "div-17d5-worked", grade: "3-4", topic: "div", problem: "17 \\div 5", work: [["5 \\times 3 = 15", "tick"], ["17 - 15 = 2", "tick"], ["3 R 2", "tick"]], solved: true },
  { id: "div-17d5-R-wrong", grade: "3-4", topic: "div", problem: "17 \\div 5", work: [["3 R 3", "ring"]], solved: false },
  { id: "div-17d5-R-big", grade: "3-4", topic: "div", problem: "17 \\div 5", work: [["2 R 7", "ring"]], solved: false, note: "true, but a remainder must be less than 5" },
  { id: "div-17d5-quotient", grade: "3-4", topic: "div", problem: "17 \\div 5", work: [["3", "none"]], solved: false, note: "the quotient, the remainder still to come" },
  { id: "div-29d4-R", grade: "3-4", topic: "div", problem: "29 \\div 4", work: [["7 R 1", "tick"]], solved: true },
  { id: "div-100d7-bracket-R", grade: "3-4", topic: "div", problem: "100 \\div 7", work: [[STACK("14 R 2 \\\\ 7 \\longdiv { 100 }"), "tick"]], solved: true },

  // ---------------------------------------------------------------- 5–6: fractions and mixed numbers
  { id: "frac-half-third-steps", grade: "5-6", topic: "frac", problem: "\\frac{1}{2} + \\frac{1}{3}", work: [["\\frac{3}{6} + \\frac{2}{6}", "tick"], ["= \\frac{5}{6}", "tick"]], solved: true, note: "rewritten to a common denominator" },
  { id: "frac-half-third-equiv", grade: "5-6", topic: "frac", problem: "\\frac{1}{2} + \\frac{1}{3}", work: [["\\frac{1}{2} = \\frac{3}{6}", "tick"], ["\\frac{1}{3} = \\frac{2}{6}", "tick"], ["\\frac{3}{6} + \\frac{2}{6} = \\frac{5}{6}", "tick"]], solved: true, note: "equivalent fractions first" },
  { id: "frac-half-third-tops", grade: "5-6", topic: "frac", problem: "\\frac{1}{2} + \\frac{1}{3}", work: [["\\frac{2}{5}", "ring"]], solved: false, note: "tops and bottoms added" },
  { id: "frac-half-third-equiv-wrong", grade: "5-6", topic: "frac", problem: "\\frac{1}{2} + \\frac{1}{3}", work: [["\\frac{1}{2} = \\frac{2}{6}", "ring"]], solved: false },
  { id: "frac-half-third-numerators", grade: "5-6", topic: "frac", problem: "\\frac{1}{2} + \\frac{1}{3}", work: [["\\frac{3}{6} + \\frac{2}{6}", "tick"], ["3 + 2 = 5", "calm"], ["\\frac{5}{6}", "tick"]], solved: true },
  { id: "frac-23-14", grade: "5-6", topic: "frac", problem: "\\frac{2}{3} + \\frac{1}{4}", work: [["\\frac{8}{12} + \\frac{3}{12} = \\frac{11}{12}", "tick"]], solved: true },
  { id: "frac-simplify-end", grade: "5-6", topic: "frac", problem: "\\frac{5}{6} - \\frac{1}{3}", work: [["\\frac{5}{6} - \\frac{2}{6} = \\frac{3}{6}", "tick"], ["= \\frac{1}{2}", "tick"]], solved: true, note: "simplified at the end" },
  { id: "frac-not-simplified", grade: "5-6", topic: "frac", problem: "\\frac{5}{6} - \\frac{1}{3}", work: [["\\frac{3}{6}", "tick"]], solved: false, note: "right, not in its simplest form yet" },
  { id: "frac-quarters-one", grade: "5-6", topic: "frac", problem: "\\frac{3}{4} + \\frac{1}{4}", work: [["\\frac{4}{4} = 1", "tick"]], solved: true },
  { id: "frac-quarters-bare", grade: "5-6", topic: "frac", problem: "\\frac{3}{4} + \\frac{1}{4}", work: [["1", "tick"]], solved: true },
  { id: "frac-times", grade: "5-6", topic: "frac", problem: "\\frac{3}{4} \\times \\frac{2}{3}", work: [["\\frac{6}{12}", "tick"], ["= \\frac{1}{2}", "tick"]], solved: true },
  { id: "frac-times-chain", grade: "5-6", topic: "frac", problem: "\\frac{3}{4} \\times \\frac{2}{3}", work: [["\\frac{3 \\times 2}{4 \\times 3} = \\frac{6}{12} = \\frac{1}{2}", "tick"]], solved: true },
  { id: "frac-divide", grade: "5-6", topic: "frac", problem: "\\frac{1}{2} \\div \\frac{1}{4}", work: [["\\frac{1}{2} \\times \\frac{4}{1} = \\frac{4}{2} = 2", "tick"]], solved: true, note: "keep, change, flip" },
  { id: "frac-divide-wrong", grade: "5-6", topic: "frac", problem: "\\frac{1}{2} \\div \\frac{1}{4}", work: [["\\frac{1}{8}", "ring"]], solved: false },
  { id: "frac-simplify-problem", grade: "5-6", topic: "frac", problem: "\\frac{6}{8}", work: [["\\frac{6}{8} = \\frac{3}{4}", "tick"]], solved: true },
  { id: "frac-simplify-bare", grade: "5-6", topic: "frac", problem: "\\frac{6}{8}", work: [["\\frac{3}{4}", "tick"]], solved: true },
  { id: "mixed-add-steps", grade: "5-6", topic: "frac", problem: "2\\frac{1}{3} + 1\\frac{1}{2}", work: [["2\\frac{2}{6} + 1\\frac{3}{6}", "tick"], ["= 3\\frac{5}{6}", "tick"]], solved: true, note: "mixed numbers" },
  { id: "mixed-add-improper", grade: "5-6", topic: "frac", problem: "2\\frac{1}{3} + 1\\frac{1}{2}", work: [["\\frac{7}{3} + \\frac{3}{2}", "tick"], ["= \\frac{14}{6} + \\frac{9}{6}", "tick"], ["= \\frac{23}{6}", "tick"], ["= 3\\frac{5}{6}", "tick"]], solved: true, note: "an improper answer is right and simplest too" },
  { id: "mixed-add-parts", grade: "5-6", topic: "frac", problem: "2\\frac{1}{3} + 1\\frac{1}{2}", work: [["2 + 1 = 3", "calm"], ["\\frac{1}{3} + \\frac{1}{2} = \\frac{5}{6}", "calm"], ["3\\frac{5}{6}", "tick"]], solved: true, note: "wholes and parts apart" },
  { id: "mixed-add-wrong", grade: "5-6", topic: "frac", problem: "2\\frac{1}{3} + 1\\frac{1}{2}", work: [["3\\frac{2}{5}", "ring"]], solved: false },
  { id: "mixed-to-improper", grade: "5-6", topic: "frac", problem: "2\\frac{1}{3}", work: [["\\frac{7}{3}", "tick"]], solved: true },

  // ---------------------------------------------------------------- 5–6: decimals
  { id: "dec-5.4x0.1-bare", grade: "5-6", topic: "dec", problem: "5.4 \\times 0.1", work: [["0.54", "tick"]], solved: true, note: "prod: 5.4 × 0.1 unfinished" },
  { id: "dec-5.4x0.1-point", grade: "5-6", topic: "dec", problem: "5.4 \\times 0.1", work: [[".54", "tick"]], solved: true },
  { id: "dec-5.4x0.1-whole", grade: "5-6", topic: "dec", problem: "5.4 \\times 0.1", work: [["5.4 \\times 0.1 = 0.54", "tick"]], solved: true },
  { id: "dec-5.4x0.1-places", grade: "5-6", topic: "dec", problem: "5.4 \\times 0.1", work: [["54 \\times 1 = 54", "calm"], ["0.54", "tick"]], solved: true, note: "the digits, then the point put back" },
  { id: "dec-5.4x0.1-tenth", grade: "5-6", topic: "dec", problem: "5.4 \\times 0.1", work: [["5.4 \\div 10 = 0.54", "tick"]], solved: true, note: "times a tenth is a tenth of it" },
  { id: "dec-5.4x0.1-dot", grade: "5-6", topic: "dec", problem: "5.4 \\times 0.1", work: [["0 \\cdot 54", "tick"]], solved: true, note: "a big decimal point read as a times dot" },
  { id: "dec-5.4x0.1-wrong", grade: "5-6", topic: "dec", problem: "5.4 \\times 0.1", work: [["5.04", "ring"]], solved: false },
  { id: "dec-add", grade: "5-6", topic: "dec", problem: "3.5 + 1.25", work: [["4.75", "tick"]], solved: true },
  { id: "dec-add-zero", grade: "5-6", topic: "dec", problem: "3.5 + 1.25", work: [["3.50 + 1.25 = 4.75", "tick"]], solved: true },
  { id: "dec-add-misaligned", grade: "5-6", topic: "dec", problem: "3.5 + 1.25", work: [["1.60", "ring"]], solved: false, note: "the points not lined up" },
  { id: "dec-times", grade: "5-6", topic: "dec", problem: "2.4 \\times 3", work: [["24 \\times 3 = 72", "calm"], ["7.2", "tick"]], solved: true },
  { id: "dec-sub", grade: "5-6", topic: "dec", problem: "1.2 - 0.35", work: [["0.85", "tick"]], solved: true },
  { id: "dec-stack", grade: "5-6", topic: "dec", work: [[STACK("3.50 \\\\ +12.25 \\\\ \\hline 15.75"), "tick"]], solved: true },
  // wrong decimal answers are ringed as wrong whole numbers are (the grade starters' skills:
  // decimals_add_subtract, decimals_multiply — a wrong decimal used to be left unmarked)
  { id: "dec-addsub-3.45p2.8-right", grade: "5-6", topic: "dec", problem: "3.45 + 2.8", work: [["= 6.25", "tick"]], solved: true, note: "decimals_add_subtract" },
  { id: "dec-addsub-3.45p2.8-wrong", grade: "5-6", topic: "dec", problem: "3.45 + 2.8", work: [["= 5.25", "ring"]], solved: false, note: "decimals_add_subtract: 5.25 for 6.25" },
  { id: "dec-addsub-3.45p2.8-bare", grade: "5-6", topic: "dec", problem: "3.45 + 2.8", work: [["5.25", "ring"]], solved: false },
  { id: "dec-addsub-3.45p2.8-unaligned", grade: "5-6", topic: "dec", problem: "3.45 + 2.8", work: [["3.73", "ring"]], solved: false, note: "the 8 added to the hundredths" },
  { id: "dec-addsub-3.45p2.8-point", grade: "5-6", topic: "dec", problem: "3.45 + 2.8", work: [["625", "ring"]], solved: false, note: "the point lost" },
  { id: "dec-addsub-3.45p2.8-step", grade: "5-6", topic: "dec", problem: "3.45 + 2.8", work: [["3.45 + 2.80", "tick"], ["= 6.25", "tick"]], solved: true },
  { id: "dec-addsub-3.45p2.8-wrong-step", grade: "5-6", topic: "dec", problem: "3.45 + 2.8", work: [["3.45 + 2.8 = 5.25", "ring"]], solved: false },
  { id: "dec-addsub-5.6m2.75-right", grade: "5-6", topic: "dec", problem: "5.6 - 2.75", work: [["5.60 - 2.75 = 2.85", "tick"]], solved: true, note: "decimals_add_subtract" },
  { id: "dec-addsub-5.6m2.75-wrong", grade: "5-6", topic: "dec", problem: "5.6 - 2.75", work: [["= 2.95", "ring"]], solved: false },
  { id: "dec-addsub-5.6m2.75-flip", grade: "5-6", topic: "dec", problem: "5.6 - 2.75", work: [["3.15", "ring"]], solved: false, note: "the smaller digit taken from the bigger" },
  { id: "dec-mul-1.2x3-right", grade: "5-6", topic: "dec", problem: "1.2 \\times 3", work: [["= 3.6", "tick"]], solved: true, note: "decimals_multiply" },
  { id: "dec-mul-1.2x3-wrong", grade: "5-6", topic: "dec", problem: "1.2 \\times 3", work: [["3.06", "ring"]], solved: false },
  { id: "dec-mul-1.2x3-point", grade: "5-6", topic: "dec", problem: "1.2 \\times 3", work: [["36", "ring"]], solved: false, note: "the point lost" },
  { id: "dec-mul-1.2x3-steps", grade: "5-6", topic: "dec", problem: "1.2 \\times 3", work: [["12 \\times 3 = 36", "calm"], ["3.6", "tick"]], solved: true },
  { id: "dec-mul-5.4x0.1-moved", grade: "5-6", topic: "dec", problem: "5.4 \\times 0.1", work: [["0.054", "ring"]], solved: false, note: "decimals_multiply: the point moved twice" },
  { id: "dec-mul-5.4x0.1-eq-wrong", grade: "5-6", topic: "dec", problem: "5.4 \\times 0.1", work: [["= 54", "ring"]], solved: false },

  // ---------------------------------------------------------------- 5–6: order of operations
  { id: "order-3p4x2", grade: "5-6", topic: "order", problem: "3 + 4 \\times 2", work: [["4 \\times 2 = 8", "tick"], ["3 + 8 = 11", "tick"]], solved: true },
  { id: "order-3p4x2-wrong", grade: "5-6", topic: "order", problem: "3 + 4 \\times 2", work: [["3 + 4 = 7", "calm"], ["7 \\times 2 = 14", "calm"], ["14", "ring"]], solved: false, note: "true lines in the wrong order: the answer is what is ringed" },
  { id: "order-power", grade: "5-6", topic: "order", problem: "2^{3} + 1", work: [["2^{3} = 8", "tick"], ["8 + 1 = 9", "tick"]], solved: true },

  // ---------------------------------------------------------------- wrong answers that must still be ringed
  { id: "wrong-18x7-bare", grade: "3-4", topic: "mul", problem: "18 \\times 7", work: [["136", "ring"]], solved: false },
  { id: "wrong-18x7-eq", grade: "3-4", topic: "mul", problem: "18 \\times 7", work: [["= 136", "ring"]], solved: false },
  { id: "wrong-18x7-whole", grade: "3-4", topic: "mul", problem: "18 \\times 7", work: [["18 \\times 7 = 136", "ring"]], solved: false },
  { id: "wrong-18x7-sum", grade: "3-4", topic: "mul", problem: "18 \\times 7", work: [["10 \\times 7 = 70", "tick"], ["8 \\times 7 = 56", "tick"], ["70 + 56 = 136", "ring"], ["136", "none"]], solved: false, note: "the slip ringed where it is made, not again under it" },
  { id: "wrong-18x7-fact", grade: "3-4", topic: "mul", problem: "18 \\times 7", work: [["10 \\times 7 = 70", "tick"], ["8 \\times 6 = 48", "calm"], ["70 + 48 = 118", "calm"], ["118", "ring"]], solved: false, note: "a true fact of the wrong numbers, then the wrong answer" },
  { id: "wrong-27x9-row", grade: "3-4", topic: "mul", problem: "27 \\times 9", work: [["20 \\times 9 = 160", "ring"]], solved: false },
  { id: "wrong-34x7-row", grade: "3-4", topic: "mul", problem: "34 \\times 7", work: [["30 \\times 7 = 21", "ring"]], solved: false, note: "a zero dropped" },
  { id: "wrong-4p3-joined", grade: "K-2", topic: "add", problem: "4+3", work: [["43", "ring"]], solved: false },
  { id: "wrong-8p5", grade: "K-2", topic: "add", problem: "8+5", work: [["12", "ring"]], solved: false },
  { id: "wrong-5p6-whole", grade: "K-2", topic: "add", problem: "5+6", work: [["5 + 6 = 12", "ring"]], solved: false },
  { id: "wrong-47p38-nocarry", grade: "K-2", topic: "add", problem: "47 + 38", work: [["715", "ring"]], solved: false, note: "each column added, nothing carried" },
  { id: "wrong-52m17-flip", grade: "K-2", topic: "sub", problem: "52 - 17", work: [["45", "ring"]], solved: false, note: "the smaller digit taken from the bigger" },
  { id: "wrong-144d9", grade: "3-4", topic: "div", problem: "144 \\div 9", work: [["15", "ring"]], solved: false },
  { id: "wrong-42d7", grade: "3-4", topic: "div", problem: "42 \\div 7", work: [["5", "ring"]], solved: false },
  { id: "wrong-17d5-R", grade: "3-4", topic: "div", problem: "17 \\div 5", work: [["4 R 3", "ring"]], solved: false },
  { id: "wrong-half-third", grade: "5-6", topic: "frac", problem: "\\frac{1}{2} + \\frac{1}{3}", work: [["\\frac{5}{12}", "ring"]], solved: false },
  { id: "wrong-mixed", grade: "5-6", topic: "frac", problem: "2\\frac{1}{3} + 1\\frac{1}{2}", work: [["3\\frac{1}{6}", "ring"]], solved: false },
  { id: "wrong-dec-add", grade: "5-6", topic: "dec", problem: "3.5 + 1.25", work: [["4.30", "ring"]], solved: false },
  { id: "wrong-order", grade: "5-6", topic: "order", problem: "3 + 4 \\times 2", work: [["3 + 4 \\times 2 = 14", "ring"]], solved: false },
  { id: "right-6x7-turned", grade: "3-4", topic: "mul", problem: "6 \\times 7", work: [["7 \\times 6 = 42", "tick"]], solved: true },
  { id: "right-6x7-doubles", grade: "3-4", topic: "mul", problem: "6 \\times 7", work: [["6 \\times 6 = 36", "calm"], ["36 + 6 = 42", "tick"]], solved: true },
  { id: "right-9x8-tens", grade: "3-4", topic: "mul", problem: "9 \\times 8", work: [["10 \\times 8 = 80", "calm"], ["80 - 8 = 72", "tick"]], solved: true },
  { id: "right-copy", grade: "K-2", topic: "add", problem: "4+3", work: [["4 + 3", "calm"], ["= 7", "tick"]], solved: true, note: "the problem copied, then answered" },

  // ---------------------------------------------------------------- review, 2026-10-09: mistakes that were ticked or let be
  // a line starting with = says the problem is worth what follows it
  { id: "claim-18x7-chain", grade: "3-4", topic: "mul", problem: "18 \\times 7", work: [["= 70 + 8 = 78", "ring"], ["78", "none"]], solved: false, note: "the 8 never multiplied; ringed where it is made" },
  { id: "claim-18x7-own", grade: "3-4", topic: "mul", work: [["18 \\times 7", "none"], ["= 10 \\times 7 + 8 = 78", "ring"]], solved: false, note: "the child's own problem" },
  { id: "claim-6x7-doubles", grade: "3-4", topic: "mul", problem: "6 \\times 7", work: [["= 6 \\times 6 = 36", "ring"]], solved: false },
  { id: "claim-18x7-then", grade: "3-4", topic: "mul", problem: "18 \\times 7", work: [["= 10 \\times 7 = 70", "calm"], ["= 8 \\times 7 = 56", "calm"], ["= 70 + 56 = 126", "tick"]], solved: true, note: "= used as 'then'" },
  // a true line that is no step of the problem: no tick, and the wrong answer under it is ringed
  { id: "mul-18x7-tens-as-ones", grade: "3-4", topic: "mul", problem: "18 \\times 7", work: [["1 \\times 7 = 7", "calm"], ["8 \\times 7 = 56", "tick"], ["7 + 56 = 63", "none"], ["63", "ring"]], solved: false, note: "the 1 ten taken as 1" },
  { id: "mul-18x7-unmultiplied", grade: "3-4", topic: "mul", problem: "18 \\times 7", work: [["10 \\times 7 = 70", "tick"], ["70 + 8 = 78", "none"], ["78", "ring"]], solved: false },
  { id: "mul-18x7-running-slip", grade: "3-4", topic: "mul", problem: "18 \\times 7", work: [["10 \\times 7 = 70 + 8 = 78", "none"], ["78", "ring"]], solved: false },
  { id: "sub-52m17-flip-steps", grade: "K-2", topic: "sub", problem: "52 - 17", work: [["7 - 2 = 5", "calm"], ["50 - 10 = 40", "calm"], ["40 + 5 = 45", "none"], ["45", "ring"]], solved: false, note: "the smaller digit from the bigger, worked in steps" },
  { id: "mul-23x14-placeholder", grade: "3-4", topic: "mul", problem: "23 \\times 14", work: [["23 \\times 4 = 92", "tick"], ["92 + 23 = 115", "none"], ["115", "ring"]], solved: false, note: "the zero holding the place left out" },
  { id: "mul-18x7-wrong-op", grade: "3-4", topic: "mul", problem: "18 \\times 7", work: [["18 + 7 = 25", "none"], ["25", "ring"]], solved: false, note: "added, not multiplied" },
  { id: "sub-52m17-wrong-op", grade: "K-2", topic: "sub", problem: "52 - 17", work: [["52 + 17 = 69", "none"], ["69", "ring"]], solved: false },
  { id: "add-9p5-wrong-op", grade: "K-2", topic: "add", problem: "9 + 5", work: [["9 - 5 = 4", "none"], ["= 4", "ring"]], solved: false },
  { id: "div-24d6-repeated", grade: "3-4", topic: "div", problem: "24 \\div 6", work: [["24 - 6 = 18", "calm"], ["18 - 6 = 12", "calm"], ["12 - 6 = 6", "calm"], ["6 - 6 = 0", "calm"], ["4", "tick"]], solved: true, note: "repeated subtraction: still steps" },
  // the answer with its sign turned, where negative numbers are the work
  { id: "sign-m3xm4", grade: "5-6", topic: "mul", problem: "-3 \\times -4", work: [["-12", "ring"]], solved: false },
  { id: "sign-m3xm4-right", grade: "5-6", topic: "mul", problem: "-3 \\times -4", work: [["12", "tick"]], solved: true },
  { id: "sign-m7p10", grade: "5-6", topic: "add", problem: "-7 + 10", work: [["= -3", "ring"]], solved: false },
  { id: "sign-m24dm6", grade: "5-6", topic: "div", problem: "-24 \\div -6", work: [["-4", "ring"]], solved: false },
  { id: "sign-m3-squared", grade: "5-6", topic: "order", problem: "(-3)^{2}", work: [["-9", "ring"]], solved: false },
  // a decimal product's point lost or moved
  { id: "dec-mul-0.3x0.2-point", grade: "5-6", topic: "dec", problem: "0.3 \\times 0.2", work: [["0.6", "ring"]], solved: false, note: "decimals_multiply: one point counted, not two" },
  { id: "dec-mul-0.3x0.2-eq", grade: "5-6", topic: "dec", problem: "0.3 \\times 0.2", work: [["= 0.6", "ring"]], solved: false },
  { id: "dec-mul-0.3x0.2-lost", grade: "5-6", topic: "dec", problem: "0.3 \\times 0.2", work: [["6", "ring"]], solved: false },
  { id: "dec-mul-0.5x0.5", grade: "5-6", topic: "dec", problem: "0.5 \\times 0.5", work: [["2.5", "ring"]], solved: false },
  { id: "dec-mul-5.4x0.1-same", grade: "5-6", topic: "dec", problem: "5.4 \\times 0.1", work: [["5.4", "ring"]], solved: false, note: "the × 0.1 left out" },
  { id: "dec-mul-0.3x0.2-steps", grade: "5-6", topic: "dec", problem: "0.3 \\times 0.2", work: [["3 \\times 2 = 6", "calm"], ["0.06", "tick"]], solved: true },
  { id: "dec-mul-2.4x0.3-partials", grade: "5-6", topic: "dec", problem: "2.4 \\times 0.3", work: [["0.6", "none"], ["0.12", "none"], ["0.72", "tick"]], solved: true, note: "2 × 0.3 and 0.4 × 0.3 alone are steps" },
  // a fraction written with a slash
  { id: "frac-half-third-slash", grade: "5-6", topic: "frac", problem: "\\frac{1}{2} + \\frac{1}{3}", work: [["5/6", "tick"]], solved: true },
  { id: "frac-half-third-slash-wrong", grade: "5-6", topic: "frac", problem: "\\frac{1}{2} + \\frac{1}{3}", work: [["2/5", "ring"]], solved: false, note: "tops and bottoms added" },
  { id: "frac-half-third-slash-end", grade: "5-6", topic: "frac", problem: "\\frac{1}{2} + \\frac{1}{3}", work: [["\\frac{3}{6} + \\frac{2}{6} = 5/6", "tick"]], solved: true },
  { id: "div-6d4-slash", grade: "5-6", topic: "frac", problem: "6 \\div 4", work: [["3/2", "tick"]], solved: true },
  // a long-division bracket inside a bigger problem
  { id: "order-144d9p3-bracket", grade: "5-6", topic: "order", problem: "144 \\div 9 + 3", work: [["\\frac{16}{9 \\longdiv { 144 }}", "tick"], ["16 + 3 = 19", "tick"]], solved: true, note: "the bracket is the first step, not the answer" },
  { id: "order-144d9p3-bracket-only", grade: "5-6", topic: "order", problem: "144 \\div 9 + 3", work: [[STACK("16 \\\\ 9 \\longdiv { 144 }"), "tick"]], solved: false },
  { id: "dec-14.4d9-bracket", grade: "5-6", topic: "dec", problem: "14.4 \\div 9", work: [[STACK("16 \\\\ 9 \\longdiv { 144 }"), "tick"], ["1.6", "tick"]], solved: true, note: "the digits divided, then the point put back" },
  // a fraction taken across, its value a numerator on the way
  { id: "frac-3q-m-half-across", grade: "5-6", topic: "frac", problem: "\\frac{3}{4} - \\frac{1}{2}", work: [["\\frac{2}{2}", "ring"]], solved: false, note: "tops and bottoms taken away" },
  { id: "frac-7e-m-3q-across", grade: "5-6", topic: "frac", problem: "\\frac{7}{8} - \\frac{3}{4}", work: [["\\frac{4}{4}", "ring"]], solved: false },
  { id: "frac-quarters-across", grade: "5-6", topic: "frac", problem: "\\frac{1}{4} + \\frac{1}{4}", work: [["\\frac{2}{8}", "ring"]], solved: false, note: "tops and bottoms added" },
  { id: "frac-3q-m-half-steps", grade: "5-6", topic: "frac", problem: "\\frac{3}{4} - \\frac{1}{2}", work: [["\\frac{2}{4}", "calm"], ["\\frac{1}{4}", "tick"]], solved: true },

  // ---------------------------------------------------------------- algebra under the same rules (unchanged)
  { id: "alg-2x+3", grade: "5-6", topic: "algebra", problem: "2x + 3 = 11", work: [["2x = 8", "tick"], ["x = 4", "tick"]], solved: true },
  { id: "alg-2x+3-wrong", grade: "5-6", topic: "algebra", problem: "2x + 3 = 11", work: [["2x = 7", "ring"]], solved: false },
  { id: "alg-own", grade: "5-6", topic: "algebra", work: [["3x - 5 = 10", "none"], ["3x = 15", "tick"], ["x = 5", "tick"]], solved: true },
];
