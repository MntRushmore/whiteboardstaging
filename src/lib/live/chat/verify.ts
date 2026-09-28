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

export type LinesVerdict = { ok: true } | { ok: false; reason: "words" | "false" | "unwritable" };

/**
 * Maths written as given (`write_lines`: a formula, a definition, the lines of a derivation the
 * student asked to see). No words, and nothing the engine can show is false: a line that is
 * wrong on its face or does not follow from the line above (`analyzeColumn`'s `mismatch`, the same
 * verdict that rings a student's line) drops the whole block. A formula the engine cannot judge
 * (`x = \frac{-b \pm \sqrt{b^{2} - 4ac}}{2a}`) is written as given.
 */
export function verifyLines(engine: LiveEngine, lines: readonly string[], canDraw: (lines: readonly string[]) => boolean = () => true): LinesVerdict {
  const clean = lines.map((l) => l.trim()).filter(Boolean);
  if (clean.length === 0 || clean.some(hasWords)) return { ok: false, reason: "words" };
  try {
    if (analyzeColumn(engine, clean, "answer").some((a) => a?.verdict === "mismatch")) return { ok: false, reason: "false" };
  } catch {
    // the engine threw on a line it cannot read: a formula it cannot judge, written as given
  }
  if (!canDraw(clean)) return { ok: false, reason: "unwritable" };
  return { ok: true };
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
