import type { WriteProblemsAction } from "@/lib/live/chat/contracts";
import { handCanWrite, verifyProblem, type ProblemVerdict } from "@/lib/live/chat/verify";
import type { LiveEngine } from "@/lib/live/contracts";

/**
 * The chat route's gate for `write_problems` (POST /api/live/chat). The board writes a problem
 * only when its engine verifies it (`verifyProblem`: it reads as maths, is not false, `localSolve`
 * answers it, the hand can write it); one that does not is dropped on the student's screen with "I
 * couldn't check that problem, so I didn't write it." (production 2026-10: 6 times, 2 kids). That
 * check ran only on the board, after the reply — nothing could be done about it any more. The route
 * now runs it first, the SAME check on the same engine, the hand's included (`handCanWrite`):
 *
 *  - every problem verifies: the action goes on, each problem in the board's own form
 *    (`boardProblemLines`: a worksheet's `?` or `\_\_` as the box the hand draws);
 *  - some do not: ONE repair round-trip with each failing problem and why (when the request still
 *    has its repair); a replacement that verifies takes the failing problem's place, one that does
 *    not is dropped;
 *  - none left: the action is dropped (the route notes it and, when nothing else is left, refunds).
 *
 * The board checks every problem again with the same function before its hand writes it. Before
 * 2026-10-11 the route checked without the hand: `1 + 2 = \square` (a first-grader's "fill in the
 * blank") passed here, and the board — whose hand had no box — refused the whole set.
 */

export type ProblemDropReason = Extract<ProblemVerdict, { ok: false }>["reason"];

export type ProblemsRepair = (failed: ReadonlyArray<{ problem: readonly string[]; reason: ProblemDropReason }>) => Promise<string[][] | null>;

export type ChatProblemsOutcome =
  | { ok: true; action: WriteProblemsAction; repaired: boolean; replaced: number; dropped: ProblemDropReason[] }
  | { ok: false; repaired: boolean; dropped: ProblemDropReason[] };

/** What each failing reason tells the repair (and the log): the board's rule the problem broke. */
export const PROBLEM_DROP_WHY: Record<ProblemDropReason, string> = {
  words: "it has words (\\text, units in words, an instruction like Solve): the board writes maths only",
  unreadable:
    "the board's engine cannot read it as maths (\\binom, _nC_r, matrices, clock times like 9{:}20, a remainder written in like 17 \\div 5 = 3 R 2 — write 17 \\div 5 —, a long-division bracket, unusual notation)",
  false: "it is false as written",
  unsolved:
    "the board's engine cannot work it out: an equation in two letters on its own (y = 2x + 3), a system of inequalities, a sequence term, a function or formula with its values given separately (write the arithmetic: 2(4) + 3, \\pi (3)^{2}), a finished fact with nothing left to do (3 + 7 = 10: write 3 + \\square = 10), clock times",
  unwritable: "the board's hand cannot write one of its symbols",
};

/** The board's check, as the route runs it: the engine's, and the hand's. */
export function verifyForBoard(engine: LiveEngine, problem: readonly string[]): ProblemVerdict {
  return verifyProblem(engine, problem, handCanWrite);
}

export async function gateChatProblems(action: WriteProblemsAction, engine: LiveEngine, repair: ProblemsRepair | null): Promise<ChatProblemsOutcome> {
  const judged = action.problems.map((problem) => ({ problem, verdict: verifyForBoard(engine, problem) }));
  const failing = judged.filter((j) => !j.verdict.ok);
  const asWritten = (j: (typeof judged)[number]) => (j.verdict.ok ? j.verdict.lines : [...j.problem]);
  if (failing.length === 0) return { ok: true, action: { type: "write_problems", problems: judged.map(asWritten) }, repaired: false, replaced: 0, dropped: [] };

  const reasons = failing.map((j) => (j.verdict.ok ? "unsolved" : j.verdict.reason));
  let replacements: Array<string[] | null> = failing.map(() => null);
  let repaired = false;
  if (repair) {
    repaired = true;
    const fixed = await repair(failing.map((j, i) => ({ problem: j.problem, reason: reasons[i] }))).catch(() => null);
    if (fixed) {
      // one replacement per failing problem, in order; one that does not verify either is no replacement
      const seen = new Set(judged.flatMap((j) => (j.verdict.ok ? [j.verdict.lines.join(";")] : [])));
      replacements = failing.map((_, i) => {
        const v = fixed[i] ? verifyForBoard(engine, fixed[i]) : null;
        if (!v?.ok) return null;
        const key = v.lines.join(";");
        if (seen.has(key)) return null;
        seen.add(key);
        return v.lines;
      });
    }
  }

  const problems: string[][] = [];
  const dropped: ProblemDropReason[] = [];
  let replaced = 0;
  let f = 0;
  for (const j of judged) {
    if (j.verdict.ok) {
      problems.push(j.verdict.lines);
      continue;
    }
    const replacement = replacements[f];
    const reason = reasons[f];
    f++;
    if (replacement) {
      problems.push(replacement);
      replaced++;
    } else dropped.push(reason);
  }
  if (problems.length === 0) return { ok: false, repaired, dropped };
  return { ok: true, action: { type: "write_problems", problems }, repaired, replaced, dropped };
}
