/**
 * PICTURE BENCH cases: the picture tutor's real pipeline (src/lib/server/boardDraw/run.ts) on
 * synthetic boards, many kinds of maths, in every frame and corner it meets on an iPad (the owner,
 * 2026-10-26: "stress testing the picture with different types of math, different orientations and
 * all"). Synthetic only: the kid's writing is the hand engine's (./board.ts), never a real child's.
 *
 * Each problem is run four ways (feedback on right work, feedback on a planted mistake, suggest and
 * answer on unfinished work), each in a different frame, placement and hand, so 18 problems cover
 * every frame × placement × hand several times.
 */

export type BenchMode = "feedback" | "suggest" | "answer";
export type Frame = "landscape" | "portrait" | "fourThree" | "zoom";
export type Placement = "topLeft" | "bottomRight" | "rightEdge" | "crammed" | "center";
export type Hand = "clean" | "slanted" | "messy" | "font";

/** A drawing beside the lines (axes and a line, or a labelled triangle). */
export type Figure =
  | { kind: "graph"; slope: number; intercept: number }
  | { kind: "triangle"; labels: [string, string, string] };

export type Problem = {
  id: string;
  type: string;
  /** printed on the board in the worksheet's light ink (as a problem page shows it) */
  printed: string;
  /** the finished, right work, line by line (LaTeX); `col:` lines are a column sum (see board.ts) */
  right: string[];
  /** the same work with one planted mistake */
  wrong: string[];
  /** how many lines of `right` an unfinished page shows (suggest, answer) */
  partial: number;
  /** numbers the right final answer must show (Solve must write them; Suggest must not) */
  answer: string[];
  /** written as a stacked column sum: right-aligned rows and a rule above the last */
  column?: boolean;
  figure?: Figure;
  /** the mistake, said plainly (for the report) */
  mistake: string;
  /** Solve on plain arithmetic: the server writes this itself (a `write` event), no painting */
  expectWrite?: string;
  /** feedback on the kid's own wrong sum: the tutor quotes it, so no recheck may fire */
  expectNoRecheck?: boolean;
};

export const PROBLEMS: Problem[] = [
  { id: "col-add", type: "column addition (carries)", printed: "268 + 457", column: true,
    right: ["268", "+457", "725"], wrong: ["268", "+457", "715"], partial: 2, answer: ["725"], mistake: "forgot the carry: 715" },
  { id: "col-sub", type: "column subtraction (borrowing)", printed: "503 − 268", column: true,
    right: ["503", "-268", "235"], wrong: ["503", "-268", "365"], partial: 2, answer: ["235"], mistake: "subtracted the smaller digit: 365" },
  { id: "long-mult", type: "long multiplication", printed: "34 × 26", column: true,
    right: ["34", "\\times 26", "204", "680", "884"], wrong: ["34", "\\times 26", "204", "680", "874"], partial: 3, answer: ["884"], mistake: "adding the partials: 874" },
  { id: "long-div", type: "long division", printed: "864 ÷ 6",
    right: ["6 \\overline{)864}", "864 \\div 6 = 144"], wrong: ["6 \\overline{)864}", "864 \\div 6 = 134"], partial: 1, answer: ["144"], mistake: "quotient 134" },
  { id: "frac-add", type: "fractions: adding", printed: "3/4 + 2/3",
    right: ["\\frac{3}{4} + \\frac{2}{3}", "= \\frac{9}{12} + \\frac{8}{12}", "= \\frac{17}{12}"], wrong: ["\\frac{3}{4} + \\frac{2}{3}", "= \\frac{5}{7}"], partial: 1, answer: ["17", "12"], mistake: "added tops and bottoms: 5/7" },
  { id: "frac-mult", type: "fractions: multiply and simplify", printed: "2/3 × 3/5 (simplify)",
    right: ["\\frac{2}{3} \\times \\frac{3}{5} = \\frac{6}{15}", "= \\frac{2}{5}"], wrong: ["\\frac{2}{3} \\times \\frac{3}{5} = \\frac{5}{8}"], partial: 1, answer: ["2", "5"], mistake: "added instead of multiplying: 5/8" },
  { id: "decimals", type: "decimals", printed: "3.75 + 1.6",
    right: ["3.75 + 1.6 = 5.35"], wrong: ["3.75 + 1.6 = 3.91"], partial: 0, answer: ["5.35"], mistake: "lined up the last digits: 3.91" },
  { id: "negatives", type: "negative numbers", printed: "−7 + 3 − (−5)",
    right: ["-7 + 3 - (-5)", "= -4 + 5", "= 1"], wrong: ["-7 + 3 - (-5)", "= -4 - 5", "= -9"], partial: 1, answer: ["1"], mistake: "minus a negative kept as minus: −9" },
  { id: "exponents", type: "exponents", printed: "2³ × 2⁴",
    right: ["2^{3} \\times 2^{4} = 2^{7}", "= 128"], wrong: ["2^{3} \\times 2^{4} = 2^{12}"], partial: 0, answer: ["128"], mistake: "multiplied the powers: 2^12" },
  { id: "one-step", type: "one-step equation", printed: "x + 9 = 25",
    right: ["x + 9 = 25", "x = 16"], wrong: ["x + 9 = 25", "x = 34"], partial: 1, answer: ["16"], mistake: "added 9: 34" },
  { id: "two-step", type: "two-step equation", printed: "3x − 7 = 8",
    right: ["3x - 7 = 8", "3x = 15", "x = 5"], wrong: ["3x - 7 = 8", "3x = 1", "x = \\frac{1}{3}"], partial: 1, answer: ["5"], mistake: "subtracted 7: 3x = 1" },
  { id: "distribute", type: "distributing", printed: "5(x + 2) = 3x − 4",
    right: ["5(x + 2) = 3x - 4", "5x + 10 = 3x - 4", "2x = -14", "x = -7"], wrong: ["5(x + 2) = 3x - 4", "5x + 2 = 3x - 4", "2x = -6", "x = -3"], partial: 1, answer: ["7"], mistake: "didn't distribute to the 2" },
  { id: "inequality", type: "inequality", printed: "2x + 3 > 11",
    right: ["2x + 3 > 11", "2x > 8", "x > 4"], wrong: ["2x + 3 > 11", "2x > 14", "x > 7"], partial: 1, answer: ["4"], mistake: "added 3: 2x > 14" },
  { id: "system", type: "system of two equations", printed: "x + y = 10,  x − y = 4",
    right: ["x + y = 10", "x - y = 4", "2x = 14", "x = 7,\\ y = 3"], wrong: ["x + y = 10", "x - y = 4", "2x = 14", "x = 7,\\ y = 17"], partial: 2, answer: ["7", "3"], mistake: "y = 17 from 7 + y = 10" },
  { id: "quadratic", type: "factoring a quadratic", printed: "x² + 5x + 6 = 0",
    right: ["x^{2} + 5x + 6 = 0", "(x + 2)(x + 3) = 0", "x = -2,\\ x = -3"], wrong: ["x^{2} + 5x + 6 = 0", "(x + 1)(x + 6) = 0", "x = -1,\\ x = -6"], partial: 1, answer: ["2", "3"], mistake: "factors multiply to 6 but add to 7" },
  { id: "graph", type: "graph y = mx + b", printed: "Graph y = 2x − 3",
    right: ["y = 2x - 3"], wrong: ["y = 2x - 3"], partial: 1, answer: [], figure: { kind: "graph", slope: 2, intercept: -3 }, mistake: "drawn through (0, 3) (see board.ts)" },
  { id: "triangle", type: "geometry: angle sum", printed: "Find x (angles 65°, 40°, x)",
    right: ["180 - 65 - 40 = 75", "x = 75"], wrong: ["180 - 65 - 40 = 85", "x = 85"], partial: 0, answer: ["75"], figure: { kind: "triangle", labels: ["65", "40", "x"] }, mistake: "subtraction: 85" },
  { id: "word", type: "word problem", printed: "Sam has 3 bags of 12 apples. He eats 5. How many are left?",
    right: ["3 \\times 12 = 36", "36 - 5 = 31"], wrong: ["3 \\times 12 = 36", "36 - 5 = 41"], partial: 1, answer: ["31"], mistake: "36 − 5 = 41" },
];

/**
 * The plain-arithmetic path (the coordinator, 2026-10-26): Solve on "1 + 1 =" or "47 + 38" is worked
 * out by the server and written as a `write` event, not painted; feedback that quotes the kid's own
 * wrong sum must not set off the arithmetic recheck.
 */
export const EXTRA: Problem[] = [
  { id: "plain-one", type: "plain arithmetic (server writes)", printed: "1 + 1", right: ["1 + 1 ="], wrong: ["1 + 1 ="], partial: 1,
    answer: ["2"], mistake: "", expectWrite: "2" },
  { id: "plain-no-equals", type: "plain arithmetic (server writes)", printed: "47 + 38", right: ["47 + 38"], wrong: ["47 + 38"], partial: 1,
    answer: ["85"], mistake: "", expectWrite: "85" },
  { id: "quote-kid", type: "feedback quoting the kid's sum", printed: "6 + 4", right: ["6 + 4 = 10"], wrong: ["6 + 4 = 11"], partial: 1,
    answer: ["10"], mistake: "6 + 4 = 11", expectNoRecheck: true },
];

/** The extra cases: the two Solve writes and the feedback that quotes the kid. */
export function extraCases(): BenchCase[] {
  return [
    { id: "plain-one-answer-partial", problem: EXTRA[0], mode: "answer", work: "partial", frame: "landscape", placement: "topLeft", hand: "clean" },
    { id: "plain-no-equals-answer-partial", problem: EXTRA[1], mode: "answer", work: "partial", frame: "portrait", placement: "center", hand: "messy" },
    { id: "quote-kid-feedback-wrong", problem: EXTRA[2], mode: "feedback", work: "wrong", frame: "fourThree", placement: "topLeft", hand: "slanted" },
  ];
}

export type BenchCase = {
  id: string;
  problem: Problem;
  mode: BenchMode;
  /** the kid's work: right, a planted mistake, or unfinished */
  work: "right" | "wrong" | "partial";
  frame: Frame;
  placement: Placement;
  hand: Hand;
};

export const FRAMES: Record<Frame, { w: number; h: number; lineHeight: number }> = {
  landscape: { w: 1440, h: 810, lineHeight: 48 },
  portrait: { w: 1080, h: 1440, lineHeight: 48 },
  fourThree: { w: 1440, h: 1080, lineHeight: 50 },
  // zoomed right in: huge writing, little room
  zoom: { w: 1440, h: 810, lineHeight: 120 },
};

const FRAME_ORDER: Frame[] = ["landscape", "portrait", "fourThree", "zoom"];
const PLACE_ORDER: Placement[] = ["topLeft", "bottomRight", "rightEdge", "crammed", "center"];
const HAND_ORDER: Hand[] = ["clean", "messy", "slanted", "messy", "clean", "font"];

/** Every problem four ways; frames, placements and hands rotate so each meets all of them. */
export function benchCases(): BenchCase[] {
  const out: BenchCase[] = [];
  let k = 0;
  const runs: Array<[BenchMode, BenchCase["work"]]> = [["feedback", "right"], ["feedback", "wrong"], ["suggest", "partial"], ["answer", "partial"]];
  for (const problem of PROBLEMS) {
    for (const [mode, work] of runs) {
      // a zoomed-in page has no room for a long piece of work: keep zoom to the short ones
      let frame = FRAME_ORDER[k % FRAME_ORDER.length];
      const lines = work === "partial" ? Math.max(1, problem.partial) : problem.right.length;
      if (frame === "zoom" && (lines > 3 || problem.figure)) frame = "landscape";
      const placement = frame === "zoom" ? "topLeft" : PLACE_ORDER[(k * 3) % PLACE_ORDER.length];
      out.push({ id: `${problem.id}-${mode}-${work}`, problem, mode, work, frame, placement, hand: HAND_ORDER[(k * 5) % HAND_ORDER.length] });
      k++;
    }
  }
  return out;
}

/** What a case should do, in words (the report says it). */
export function expectation(c: BenchCase): string {
  if (c.problem.expectWrite) return `the server writes "${c.problem.expectWrite}" itself (a write event), nothing painted`;
  if (c.problem.expectNoRecheck) return "point at the mistake; the tutor quotes the kid's wrong sum, so no recheck";
  if (c.mode === "feedback" && c.work === "right") return "nothing to fix: none + a checkmark (correct)";
  if (c.mode === "feedback") return `point at the mistake (${c.problem.mistake}); never write the right answer`;
  if (c.mode === "suggest") return "a hint for the next step; never the final answer";
  return `the worked solution, ending with ${c.problem.answer.join(", ") || "the graph"}`;
}
