/**
 * The try board's check (src/lib/try/contracts.ts, `POST /api/try/check`): one line a visitor wrote
 * under a problem, judged with no model, by the rules the real board marks a line by.
 *
 * The column is the problem's lines (looked up by id on the server, never sent by the page), the
 * visitor's lines the tutor already checked, then the new line, and it is judged by `judgeColumn`
 * (`engine/columnWork.ts`): the very rules `LiveLoop.analyze` ticks and rings by (`judgeLine`), as one
 * pure function. That is `analyzeColumn` + `badgeFor` with what the loop adds on top, which the try
 * board needs as much as the board does:
 *
 *  - under a problem with no letters a number alone is the answer, judged as `= 7` (the bare-number
 *    rule of `asJudged` in courses.test.ts), and a young student's working (`40 + 30 = 70` under
 *    `47 + 38`) is judged against the problem, not the line above (`LiveEngine.judgeWork`);
 *  - a right answer to a problem with no letters is the problem solved (`analysis.solved`), as
 *    `analyzeColumn` alone does not say for `\frac{5}{7}` under `\frac{2}{7} + \frac{3}{7}`;
 *  - a ringed line is never what the next line is checked against, and a line carried on from it
 *    (right from the slip, not from the problem) gets no tick (`LineAnalysis.carried`).
 *
 * Then the board's mark as the page's verdict (`TRY_VERDICTS`): a tick `check`, the problem finished
 * `solved`, a ring `ring` (with the engine's note when it is words a child can read), and the two
 * lines the board cannot judge (`unjudgedReason` in policy.ts): `unread` (nothing read, a read the
 * reader was not sure of, a read that is no maths at all) and `unjudged` (half a step, a lone `x`).
 *
 * Pure, the engine injected (the route passes `getEngine()`, loaded once per server instance).
 */
import { LIVE_LIMITS, type LineAnalysis, type LiveEngine } from "@/lib/live/contracts";
import { judgeColumn } from "@/lib/live/engine/columnWork";
import { localSolve } from "@/lib/live/localSolve";
import { badgeFor } from "@/lib/live/policy";
import { stepKey } from "@/lib/live/solveSteps";
import type { TryProblem, TryVerdict } from "@/lib/try/contracts";

export interface TryJudgement {
  verdict: TryVerdict;
  /** the engine's note on a ringed line, in words; null when it has none a child can read */
  note: string | null;
}

/**
 * The note on a line carried on from a ringed line above it: right from the slip, wrong from the
 * problem. The board gives it no mark of its own (the slip is ringed where it was made); the try
 * board has no "no mark" for a line it read, so it is ringed with this.
 */
export const CARRIED_NOTE = "This follows from the circled line. Fix that one first.";

/** A number alone (as a young student writes an answer), an `=` before it allowed: `columnWork.ts`'s `BARE_NUMBER`. */
const BARE_NUMBER = /^\s*=?\s*-?\s*(?:\d+(?:\.\d+)?|\\frac\s*\{\s*\d+\s*\}\s*\{\s*\d+\s*\}|\d+\s*\/\s*\d+)\s*$/;

/** A note a child can read: plain words and a few signs, never LaTeX. */
export function kidNote(note: string | undefined | null): string | null {
  const s = (note ?? "").trim();
  if (!s || s.length > 140) return null;
  if (/[\\$^_{}]/.test(s)) return null;
  if (!/[A-Za-z]{2,}/.test(s)) return null;
  return s;
}

// engine -> problem lines -> its answer's key: the problems are fixed, and a solve can take a
// quarter of a second
const answers = new WeakMap<LiveEngine, Map<string, string>>();

/** The problem's own answer, as the engine works it (`localSolve`'s last step), comparable (`stepKey`). */
function answerKey(engine: LiveEngine, problem: TryProblem): string {
  let known = answers.get(engine);
  if (!known) answers.set(engine, (known = new Map()));
  const id = problem.lines.join("\n");
  const hit = known.get(id);
  if (hit !== undefined) return hit;
  const steps = localSolve(engine, [...problem.lines]).steps;
  const last = steps[steps.length - 1] ?? "";
  const key = last ? stepKey(last.replace(/^\s*=\s*/, "")) : "";
  if (known.size < 500) known.set(id, key);
  return key;
}

/** The last line of the column judged as the board judges it (`judgeColumn`, Feedback). */
export function judgeInColumn(engine: LiveEngine, problem: TryProblem, work: readonly string[], latex: string): LineAnalysis | null {
  return judgeColumn(engine, { problem: problem.lines, lines: [...work, latex] }, "feedback").at(-1) ?? null;
}

/**
 * The tutor's verdict on `latex`, written under `problem` after `work` (see the file comment).
 * `confidence`: the reader's, when it gave one (Mathpix's 0..1); under the board's
 * `LIVE_LIMITS.minConfidence` the line is `unread`, as on the board.
 */
export function judgeTryLine(
  engine: LiveEngine,
  problem: TryProblem,
  work: readonly string[],
  latex: string,
  opts: { confidence?: number } = {},
): TryJudgement {
  const line = latex.trim();
  if (!line) return { verdict: "unread", note: null };
  if (opts.confidence !== undefined && opts.confidence < LIVE_LIMITS.minConfidence) return { verdict: "unread", note: null };

  const a = judgeInColumn(engine, problem, work, line);
  if (!a) return { verdict: "unread", note: null };
  switch (badgeFor("feedback", a)) {
    case "solved":
      return { verdict: "solved", note: null };
    case "ok": {
      // The problem's own answer, ticked, is the problem finished, whatever the path to it.
      const key = answerKey(engine, problem);
      const mine = stepKey(BARE_NUMBER.test(line) ? line.replace(/^\s*=\s*/, "") : line);
      return { verdict: key && mine === key ? "solved" : "check", note: null };
    }
    case "warn":
      return { verdict: "ring", note: kidNote(a.note) };
    default:
      break;
  }
  if (a.carried) return { verdict: "ring", note: CARRIED_NOTE };
  // Read, but no maths the engine can parse, or prose (a scribble read as words): write it again.
  if (a.kind === "unknown" || a.kind === "text") return { verdict: "unread", note: null };
  // A lone symbol (`x`, `\Delta`; a lone number under algebra is a label), half a line (`2x =`,
  // `3 +`, an `=` waiting for its number), or maths with nothing to compare it with: nothing to
  // check yet.
  return { verdict: "unjudged", note: null };
}
