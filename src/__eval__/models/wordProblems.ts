/**
 * JOB 1 — word problem → equations. "The model understands, the engine calculates": the model
 * reads a school word problem and returns ONLY the equations / assignments that set it up (JSON,
 * no prose, no arithmetic done); `localSolve` — the board's own local Solve — then solves that
 * setup, and the answer it writes is compared numerically with the known answer.
 *
 * `reference` is a setup a teacher would write; the unit test checks that the engine solves every
 * reference to the known answer, so a model is only ever marked down for its own setup.
 */
import type { LiveEngine } from "@/lib/live/contracts";
import { localSolve } from "@/lib/live/localSolve";
import { wordsIn } from "../judge";
import { assignmentsIn, close, finalNumber } from "./answers";
import type { BenchMessage } from "./client";
import { parseModelJson } from "./json";

export interface WordProblem {
  id: string;
  /** the problem as the board receives it: one `\text{…}` line per written line */
  lines: string[];
  /** the letter the reference setup uses for the asked-for quantity */
  unknown: string;
  answer: number;
  /**
   * Other values that are the same answer in another unit. The prompt tells the model to write
   * percentages as decimals, so a percentage asked for may come back as its decimal (0.25 for 25%).
   */
  alsoAccept?: number[];
  /** a teacher's setup; the engine must solve it to `answer` */
  reference: string[];
}

const t = (s: string) => `\\text{${s}}`;

export const WORD_PROBLEMS: readonly WordProblem[] = [
  { id: "wp-01", lines: [t("Three consecutive integers add up to 48."), t("What is the smallest of them?")], unknown: "x", answer: 15, reference: ["x + (x + 1) + (x + 2) = 48"] },
  { id: "wp-02", lines: [t("A train travels 150 km in 2.5 hours."), t("What is its average speed in km/h?")], unknown: "v", answer: 60, reference: ["v = \\frac{150}{2.5}"] },
  { id: "wp-03", lines: [t("A jacket costs 80 dollars and is 15% off."), t("How many dollars do you save?")], unknown: "s", answer: 12, reference: ["s = 0.15 \\times 80"] },
  { id: "wp-04", lines: [t("Adult tickets cost 5 dollars and child tickets 3 dollars."), t("200 tickets were sold for 800 dollars."), t("How many adult tickets were sold?")], unknown: "a", answer: 100, reference: ["a + c = 200", "5a + 3c = 800"] },
  { id: "wp-05", lines: [t("A rectangle is 3 cm longer than it is wide."), t("Its area is 40 square cm. How wide is it?")], unknown: "w", answer: 5, reference: ["w(w + 3) = 40"] },
  { id: "wp-06", lines: [t("Maria is 3 times as old as her son."), t("Together their ages add up to 36."), t("How old is her son?")], unknown: "s", answer: 9, reference: ["m = 3s", "m + s = 36", "s = ?"] },
  { id: "wp-07", lines: [t("A phone plan costs 12 dollars a month plus 0.50 dollars per GB."), t("Last month's bill was 20 dollars. How many GB were used?")], unknown: "g", answer: 16, reference: ["12 + 0.5g = 20"] },
  { id: "wp-08", lines: [t("After a 20% discount a bike costs 64 dollars."), t("What was the original price?")], unknown: "p", answer: 80, reference: ["0.8p = 64"] },
  { id: "wp-09", lines: [t("A rectangle's length is three times its width."), t("Its perimeter is 48 m. Find its length.")], unknown: "l", answer: 18, reference: ["l = 3w", "2l + 2w = 48"] },
  { id: "wp-10", lines: [t("Sam scored 85, 90 and 78 on three tests."), t("What must he score on the fourth test to average 85?")], unknown: "x", answer: 87, reference: ["\\frac{85 + 90 + 78 + x}{4} = 85"] },
  { id: "wp-11", lines: [t("What is the weight in newtons of a 5 kg bag?"), t("Use g = 9.8 m/s^2.")], unknown: "W", answer: 49, reference: ["W = 5 \\times 9.8"] },
  { id: "wp-12", lines: [t("A car moving at 3 m/s accelerates at 2 m/s^2 for 5 seconds."), t("What is its final speed?")], unknown: "v", answer: 13, reference: ["v = 3 + 2 \\times 5"] },
  { id: "wp-13", lines: [t("2000 dollars is invested at 5% interest compounded yearly."), t("How much is in the account after 3 years?")], unknown: "A", answer: 2315.25, reference: ["A = 2000(1.05)^{3}"] },
  { id: "wp-14", lines: [t("The foot of a ladder is 6 m from a wall and its top is 8 m up the wall."), t("How long is the ladder?")], unknown: "c", answer: 10, reference: ["c^{2} = 6^{2} + 8^{2}"] },
  { id: "wp-15", lines: [t("Two angles are supplementary."), t("One is 30 degrees more than the other. Find the smaller angle.")], unknown: "x", answer: 75, reference: ["x + (x + 30) = 180"] },
  { id: "wp-16", lines: [t("The angles of a triangle are x, 2x and 3x degrees."), t("Find x.")], unknown: "x", answer: 30, reference: ["x + 2x + 3x = 180"] },
  { id: "wp-17", lines: [t("A recipe uses 3 cups of flour for 12 cookies."), t("How many cups are needed for 20 cookies?")], unknown: "f", answer: 5, reference: ["\\frac{f}{20} = \\frac{3}{12}"] },
  { id: "wp-18", lines: [t("Pipe A fills a tank in 3 hours and pipe B in 6 hours."), t("How many hours do they take together?")], unknown: "t", answer: 2, reference: ["\\frac{1}{3} + \\frac{1}{6} = \\frac{1}{t}"] },
  { id: "wp-19", lines: [t("A jar has 25 coins, all nickels (5 cents) and dimes (10 cents)."), t("They are worth 185 cents. How many dimes are there?")], unknown: "d", answer: 12, reference: ["n + d = 25", "5n + 10d = 185"] },
  { id: "wp-20", lines: [t("A number is doubled and then decreased by 7."), t("The result is 29. Find the number.")], unknown: "n", answer: 18, reference: ["2n - 7 = 29"] },
  { id: "wp-21", lines: [t("A cyclist rides at 18 km/h."), t("How many hours does it take to ride 63 km?")], unknown: "t", answer: 3.5, reference: ["t = \\frac{63}{18}"] },
  { id: "wp-22", lines: [t("The product of two consecutive positive integers is 132."), t("Find the smaller integer.")], unknown: "n", answer: 11, reference: ["n(n + 1) = 132"] },
  { id: "wp-23", lines: [t("The price of a shirt rises from 40 dollars to 50 dollars."), t("What is the percentage increase?")], unknown: "p", answer: 25, alsoAccept: [0.25], reference: ["p = \\frac{50 - 40}{40} \\times 100"] },
  { id: "wp-24", lines: [t("How many litres of a 20% salt solution must be added"), t("to 10 litres of a 50% solution to make a 30% solution?")], unknown: "x", answer: 20, reference: ["0.2x + 0.5 \\times 10 = 0.3(x + 10)"] },
  { id: "wp-25", lines: [t("Two trains leave a station in opposite directions at 60 km/h and 80 km/h."), t("After how many hours are they 490 km apart?")], unknown: "t", answer: 3.5, reference: ["60t + 80t = 490"] },
];

// ---------------------------------------------------------------- the prompt

export const WORD_SETUP_SYSTEM_PROMPT = [
  "You turn a school word problem into the maths a student writes under it, so that a calculator can solve it. You never calculate.",
  "",
  "INPUT: the problem as the student's lines (prose arrives as \\text{...}).",
  'OUTPUT: one JSON object and nothing else: {"unknown": "<the letter of the quantity asked for>", "lines": ["<LaTeX>", ...]}',
  "",
  "RULES:",
  "1. lines set the problem up, top to bottom, at most 4: one equation in one unknown, or two or three simultaneous linear equations, or an assignment of the asked-for quantity to an unsimplified expression.",
  "2. One short letter per quantity (x, n, t, v, p, ...). The unknown must appear in the lines.",
  "3. Never compute: leave the arithmetic unsimplified (v = \\frac{150}{2.5}, not v = 60). No line may state the answer.",
  "4. Numbers only: no units, no \\text, no words, no $ delimiters. Write percentages as decimals (15% is 0.15).",
  "5. KaTeX-renderable LaTeX, one equation per line.",
].join("\n");

export function wordSetupMessages(p: WordProblem): BenchMessage[] {
  return [
    { role: "system", content: WORD_SETUP_SYSTEM_PROMPT },
    { role: "user", content: ["Problem lines:", ...p.lines, "", "JSON only."].join("\n") },
  ];
}

// ---------------------------------------------------------------- scoring

export type WordOutcome = "correct" | "wrong-answer" | "engine-cannot-solve" | "answered-itself" | "bad-json";

export interface WordScore {
  id: string;
  outcome: WordOutcome;
  correct: boolean;
  /** the model's setup */
  lines: string[];
  unknown: string;
  /** what the engine wrote for it */
  source: string | null;
  steps: string[];
  got: string;
  /** rule breaks that do not decide the score: prose in a line, the answer stated */
  words: boolean;
  stated: boolean;
}

/** A setup line that already states a bare number for the unknown (`v = 60`): the model did the arithmetic. */
function statesAnswer(lines: readonly string[], unknown: string, answer: number): boolean {
  return lines.some((l) => {
    const m = /^\s*([A-Za-z])\s*=\s*(-?\d+(?:\.\d+)?)\s*$/.exec(l);
    return Boolean(m && m[1] === unknown && close(Number(m[2]), answer));
  });
}

function accepts(p: WordProblem, v: number): boolean {
  return [p.answer, ...(p.alsoAccept ?? [])].some((a) => close(v, a));
}

/** The engine's value for `unknown` from its steps: the last step that assigns it, else a final `= value`. */
export function engineAnswer(steps: readonly string[], unknown: string): number[] {
  for (let i = steps.length - 1; i >= 0; i--) {
    const vals = assignmentsIn(steps[i])[unknown];
    if (vals && vals.length > 0) return vals;
  }
  const last = steps[steps.length - 1] ?? "";
  if (/^\s*=/.test(last)) {
    const n = finalNumber(last);
    if (n !== null) return [n];
  }
  return [];
}

/** Solve the setup with the local engine (exactly as Solve would) and judge the answer. */
export function scoreSetup(engine: LiveEngine, p: WordProblem, setup: { lines: string[]; unknown: string }): Omit<WordScore, "id"> {
  const lines = setup.lines.map((l) => l.replace(/^\$+|\$+$/g, "").trim()).filter(Boolean);
  const unknown = setup.unknown.replace(/[\\{}\s$]/g, "");
  const words = lines.some((l) => wordsIn(l).length > 0);
  const stated = statesAnswer(lines, unknown, p.answer);
  const base = { lines, unknown, words, stated };
  if (lines.length === 0) return { ...base, outcome: "bad-json", correct: false, source: null, steps: [], got: "" };
  let result: ReturnType<typeof localSolve>;
  try {
    result = localSolve(engine, lines);
  } catch {
    result = { source: null, steps: [] };
  }
  if (!result.source) {
    // the model answered in its own line and the engine had nothing left to do
    const own = engineAnswer(lines, unknown);
    const outcome: WordOutcome = own.some((v) => accepts(p, v)) ? "answered-itself" : "engine-cannot-solve";
    return { ...base, outcome, correct: false, source: null, steps: [], got: own.join(", ") };
  }
  const values = engineAnswer(result.steps, unknown);
  // a length from a quadratic: the positive root is the answer, the other is rejected by the student
  const correct = values.some((v) => accepts(p, v));
  return {
    ...base,
    outcome: correct ? "correct" : "wrong-answer",
    correct,
    source: result.source,
    steps: result.steps,
    got: values.map((v) => String(Math.round(v * 1e6) / 1e6)).join(", "),
  };
}

/** Parse the model's reply and score it. */
export function scoreWordReply(engine: LiveEngine, p: WordProblem, content: string): WordScore {
  const parsed = parseModelJson(content);
  const obj = parsed && typeof parsed === "object" ? (parsed as { lines?: unknown; unknown?: unknown }) : null;
  const lines = Array.isArray(obj?.lines) ? obj.lines.filter((l): l is string => typeof l === "string") : null;
  if (!obj || !lines || lines.length === 0) {
    return { id: p.id, outcome: "bad-json", correct: false, lines: [], unknown: "", source: null, steps: [], got: "", words: false, stated: false };
  }
  // no `unknown` named: the letter of the last line's left side, else the reference's
  let unknown = typeof obj.unknown === "string" ? obj.unknown : "";
  if (!unknown) unknown = /^\s*([A-Za-z])\s*=/.exec(lines[lines.length - 1])?.[1] ?? p.unknown;
  return { id: p.id, ...scoreSetup(engine, p, { lines, unknown }) };
}

/** For the unit test: does the reference setup really solve to the answer? */
export function referenceSolves(engine: LiveEngine, p: WordProblem): boolean {
  return scoreSetup(engine, p, { lines: p.reference, unknown: p.unknown }).correct;
}
