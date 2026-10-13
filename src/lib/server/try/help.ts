/**
 * "Show me a step" on the try board (src/lib/try/contracts.ts, `POST /api/try/help`): the next line
 * under the visitor's work, from the engine's local solve, the way the board's Suggest writes one
 * under a problem the tutor wrote (`LiveLoop.workProblem`). No model is ever called.
 *
 *  - Nothing right written yet (or only slips and half lines): the tutor works the problem itself —
 *    `localSolve` over the problem and `problemSteps` at depth `step`, the first step the engine
 *    ticks straight under it (`ticked`, as `LiveLoop.problemStepsFor` and courses.test.ts).
 *  - Right work under it: the board's Solve on the student's own column (`kind: "student"`):
 *    `localSolve` from the problem down to the visitor's last right line, its first step the
 *    visitor has not written; when that has nothing, `problemSteps` after the last of the
 *    problem's own steps already written.
 *  - Solved already, or nothing local: null.
 *
 * Whatever it picks, the try board's own check must tick it under the visitor's work
 * (`judgeTryLine` → `check` / `solved`): the tutor never writes a line it would then ring. `solves`
 * is that check saying `solved`.
 *
 * Pure, the engine injected.
 */
import type { LiveEngine } from "@/lib/live/contracts";
import { problemSteps } from "@/lib/live/chat/work";
import { judgeColumn } from "@/lib/live/engine/columnWork";
import { analyzeColumn, localSolve } from "@/lib/live/localSolve";
import { badgeFor } from "@/lib/live/policy";
import { stepKey } from "@/lib/live/solveSteps";
import type { TryProblem } from "@/lib/try/contracts";
import { judgeTryLine } from "./judge";

export interface TryStep {
  /** the next line; null when the problem is solved already or the engine has none */
  latex: string | null;
  /** the line finishes the problem */
  solves: boolean;
}

const NONE: TryStep = { latex: null, solves: false };

/** `normalizeStep` in liveLoop.ts (the loop's comparable form of a step), without importing the loop. */
const normalize = stepKey;

/** Would the engine tick this step straight under the problem (`LiveLoop.problemStepsFor`'s `ticked`). */
function tickedUnder(engine: LiveEngine, problem: TryProblem) {
  return (step: string): boolean => {
    const a = analyzeColumn(engine, [...problem.lines, step], "feedback").at(-1) ?? null;
    // the interval written again is ticked, but it is not a step
    if (a?.domain && !a.math) return false;
    return ["ok", "solved"].includes(badgeFor("feedback", a));
  };
}

/** The next step after `work` under `problem` (see the file comment). */
export function nextTryStep(engine: LiveEngine, problem: TryProblem, work: readonly string[]): TryStep {
  const lines = work.map((l) => l.trim());
  const judged = judgeColumn(engine, { problem: problem.lines, lines: [...lines] }, "feedback");
  if (judged.some((a) => badgeFor("feedback", a) === "solved")) return NONE;
  // the visitor's right lines, top to bottom: what the work goes on from
  const right = lines.filter((l, i) => l && badgeFor("feedback", judged[i] ?? null) === "ok");

  const seen = new Set([...problem.lines, ...lines].map(normalize));
  const candidates: string[] = [];
  const add = (steps: readonly string[]) => {
    for (const s of steps) if (s.trim() && !seen.has(normalize(s)) && !candidates.includes(s)) candidates.push(s);
  };

  const solution = localSolve(engine, [...problem.lines]).steps;
  if (right.length > 0) {
    // Solve on the student's own work: from their last right line
    add(localSolve(engine, [...problem.lines, ...right]).steps);
    add(problemSteps({ solution, head: problem.lines, written: right, depth: "step", normalize }));
  } else {
    add(problemSteps({ solution, head: problem.lines, written: [], depth: "step", normalize, ticked: tickedUnder(engine, problem) }));
  }
  // the rest of the problem's own solution, as a last resort (a step the visitor's route skipped)
  add(problemSteps({ solution, head: problem.lines, written: right, depth: "solve", normalize }));

  for (const step of candidates) {
    const { verdict } = judgeTryLine(engine, problem, lines, step);
    if (verdict === "check" || verdict === "solved") return { latex: step, solves: verdict === "solved" };
  }
  return NONE;
}
