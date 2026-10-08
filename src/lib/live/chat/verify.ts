import type { LineAnalysis, LiveEngine } from "../contracts";
import { analyzeColumn, localSolve } from "../localSolve";

/**
 * The board chat's interlock: nothing a model proposed reaches the board until the local engine
 * has read it. Pure (engine in, verdict out), so the board (`ChatDesk`) and the chat eval
 * (`src/__eval__/chat`) judge a problem exactly the same way.
 */

/** Words on the board: `\text{…}` and friends, or a run of plain letters that is not maths. */
export function hasWords(latex: string): boolean {
  if (/\\(?:text[a-z]*|mbox)\b/.test(latex)) return true;
  if (/\\mathrm\{[A-Za-z]{3,}\}/.test(latex)) return true;
  // five letters in a row outside a command (`\frac`, `\sqrt`, `\sin`…) is a word
  return /(?:^|[^\\A-Za-z])[A-Za-z]{5,}/.test(latex);
}

/** Kinds the engine returns for a line it cannot reason about. */
const UNREADABLE: ReadonlySet<LineAnalysis["kind"]> = new Set(["unknown", "text", "label", "incomplete"]);

export type ProblemVerdict =
  | { ok: true; steps: string[] }
  | { ok: false; reason: "words" | "unreadable" | "false" | "unsolved" | "unwritable" };

/**
 * A problem the tutor may write for the student: every line reads as maths, none is false on its
 * face (`2 + 2 = 5`), and `localSolve` — the very function Solve uses — answers it. `steps` is
 * the engine's worked solution (never written; it is the proof the problem has an answer).
 * `canDraw` is the hand's interlock (every glyph drawable); default yes.
 */
export function verifyProblem(engine: LiveEngine, lines: readonly string[], canDraw: (lines: readonly string[]) => boolean = () => true): ProblemVerdict {
  const clean = lines.map((l) => l.trim()).filter(Boolean);
  if (clean.length === 0) return { ok: false, reason: "unreadable" };
  if (clean.some(hasWords)) return { ok: false, reason: "words" };
  let analyses: (LineAnalysis | null)[];
  try {
    analyses = analyzeColumn(engine, clean, "answer");
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  if (analyses.some((a) => !a || UNREADABLE.has(a.kind))) return { ok: false, reason: "unreadable" };
  if (analyses.some((a) => a?.verdict === "mismatch")) return { ok: false, reason: "false" };
  let steps: string[] = [];
  try {
    const local = localSolve(engine, clean);
    if (!local.source || local.steps.length === 0) return { ok: false, reason: "unsolved" };
    steps = local.steps;
  } catch {
    return { ok: false, reason: "unsolved" };
  }
  if (!canDraw(clean)) return { ok: false, reason: "unwritable" };
  return { ok: true, steps };
}

/** The most common of these reasons (the first on a tie), or null for none: what a report names. */
export function commonestReason<R extends string>(reasons: readonly R[]): R | null {
  if (reasons.length === 0) return null;
  const counts = new Map<R, number>();
  for (const r of reasons) counts.set(r, (counts.get(r) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

export type LinesVerdict = { ok: true } | { ok: false; reason: "words" | "false" | "unchecked" | "unwritable" };

/**
 * Maths written as given (`write_lines`: a formula, a definition, the lines of a derivation the
 * student asked to see). No words, and nothing the engine can show is false: a line that is
 * wrong on its face or does not follow from the line above (`analyzeColumn`'s `mismatch`, the same
 * verdict that rings a student's line) drops the whole block. A formula the engine cannot judge
 * (`x = \frac{-b \pm \sqrt{b^{2} - 4ac}}{2a}`) is written as given.
 *
 * A CHAIN in plain algebra — an expression, then lines that each begin with `=` (an algebra proof:
 * `(2m + 1) + (2n + 1)`, `= 2m + 2n + 2`, `= 2(m + n + 1)`) — is a proof, and is held to more: every step must be
 * shown EQUAL to the line above — the engine's own proof-column check ticks it, or `stepHolds` does
 * — not merely not shown false; one the engine cannot confirm drops the block (`unchecked`).
 */
export function verifyLines(engine: LiveEngine, lines: readonly string[], canDraw: (lines: readonly string[]) => boolean = () => true): LinesVerdict {
  const clean = lines.map((l) => l.trim()).filter(Boolean);
  if (clean.length === 0 || clean.some(hasWords)) return { ok: false, reason: "words" };
  let analyses: (LineAnalysis | null)[] = [];
  try {
    analyses = analyzeColumn(engine, clean, "answer");
    if (analyses.some((a) => a?.verdict === "mismatch")) return { ok: false, reason: "false" };
  } catch {
    // the engine threw on a line it cannot read: a formula it cannot judge, written as given
  }
  if (isChain(clean) && clean.every(isPlainAlgebra)) {
    for (let i = 1; i < clean.length; i++) {
      // the engine's own check of the line under the one above (a proof column) ticked it
      if (analyses[i]?.verdict === "ok") continue;
      const step = stepHolds(engine, stripEquals(clean[i - 1]), stripEquals(clean[i]));
      if (step !== "ok") return { ok: false, reason: step === "mismatch" ? "false" : "unchecked" };
    }
  }
  if (!canDraw(clean)) return { ok: false, reason: "unwritable" };
  return { ok: true };
}

/** An expression and the lines under it that each begin with `=`: a chain of equal expressions. */
export function isChain(lines: readonly string[]): boolean {
  if (lines.length < 2 || /=/.test(lines[0])) return false;
  return lines.slice(1).every((l) => /^=(?!=)/.test(l.trim()) && !/=/.test(stripEquals(l)));
}

function stripEquals(line: string): string {
  return line.trim().replace(/^=\s*/, "");
}

/**
 * Plain algebra: letters that stand for numbers — no subscript, no derivative's d, no integral's or
 * limit's bound variable, no prime. What `stepHolds` can put numbers into.
 */
export function isPlainAlgebra(line: string): boolean {
  return !/[_']|\\(?:int|lim|sum|prod|partial|mathrm)\b|\\frac\{d/.test(stripEquals(line));
}

/** Integer values the letters are given, one set per check (irregular, so a slip does not cancel). */
const STEP_SAMPLES: readonly (readonly number[])[] = [
  [3, 7, 2, 5],
  [-2, 5, 11, -3],
  [11, -4, 6, 13],
];

/** The letters a line uses as its unknowns: single letters outside commands (not `e`, `i`). */
function lettersOf(latex: string): string[] {
  const out = new Set<string>();
  for (const m of latex.matchAll(/\\[a-zA-Z]+|[a-zA-Z]/g)) if (m[0].length === 1 && m[0] !== "e" && m[0] !== "i") out.add(m[0]);
  return [...out];
}

function substitute(latex: string, values: ReadonlyMap<string, number>): string {
  return latex.replace(/\\[a-zA-Z]+|[a-zA-Z]/g, (t) => (t.length === 1 && values.has(t) ? `(${values.get(t)})` : t));
}

/**
 * Is `b` equal to `a` for every value of their letters? Checked by the engine itself: the letters
 * are given the same whole numbers on both sides, three times over, and the engine judges each
 * `a = b` (a closed equation: exact, as it judges `2 + 2 = 5`). `ok` only when all three hold;
 * `mismatch` when one is provably false; `unknown` when the engine cannot tell (subscripts, too
 * many letters, a value it cannot compute).
 */
export function stepHolds(engine: LiveEngine, a: string, b: string): "ok" | "mismatch" | "unknown" {
  if (!a || !b || /=/.test(a + b) || !isPlainAlgebra(a) || !isPlainAlgebra(b)) return "unknown";
  const letters = [...new Set([...lettersOf(a), ...lettersOf(b)])];
  if (letters.length > STEP_SAMPLES[0].length) return "unknown";
  let held = 0;
  for (const sample of STEP_SAMPLES) {
    const values = new Map(letters.map((l, k) => [l, sample[k]] as const));
    let verdict: LineAnalysis["verdict"] | undefined;
    try {
      verdict = engine.analyzeLine(`${substitute(a, values)} = ${substitute(b, values)}`, { mode: "answer" }).verdict;
    } catch {
      return "unknown";
    }
    if (verdict === "mismatch") return "mismatch";
    if (verdict === "ok") held++;
  }
  return held === STEP_SAMPLES.length ? "ok" : "unknown";
}

/** The last line of a verified problem's solution, for "clean answers" in the eval (`x = 4`, `= (x + 3)(x + 2)`). */
export function answerOf(steps: readonly string[]): string {
  return steps[steps.length - 1] ?? "";
}

/**
 * A clean answer: integers, simple fractions, a factored form — no decimals past two places, no
 * irrational surds unless the problem is about them. Informational (the eval reports it); the
 * board writes any verified problem.
 */
export function isCleanAnswer(answer: string): boolean {
  if (!answer) return false;
  if (/\d\.\d{3,}/.test(answer)) return false;
  if (/\\approx/.test(answer)) return false;
  return true;
}
