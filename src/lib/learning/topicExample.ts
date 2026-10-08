/**
 * A topic board's worked example ("Watch me do one"): the tutor writes it as problem 1 and works it
 * under it the way Solve works one of the chat's problems (`help_problem`, `LiveLoop.workProblem`).
 * That is free — no model, no ink — whenever the engine answers it on the device (`localSolve`), and
 * only then is an example written: of the topic's candidates, the first the engine works out with
 * steps left to write under the problem. None: the board writes the problems alone.
 *
 * Loaded on a topic board only, after the board (the engine is the one the board already loaded).
 */
import { problemSteps } from "@/lib/live/chat/work";
import type { LiveEngine } from "@/lib/live/contracts";
import { localSolve } from "@/lib/live/localSolve";
import { unwrapBoxed } from "@/lib/live/solveSteps";
import type { PracticeProblem } from "./contracts";

/** Spacing, `\left`, `\cdot` ignored: `normalizeStep` (liveLoop.ts; a test holds them equal), here so this file does not import the loop. */
export function sameStep(latex: string): string {
  return unwrapBoxed(latex)
    .replace(/\\(?:left|right|,|;|!|quad|qquad)|~|\s/g, "")
    .replace(/[{}]/g, "")
    .replace(/\\cdot|\\times|\*/g, "");
}

/** The steps the tutor would write under this problem working it, from the engine alone ([] when it would ask a model). */
export function localWorkFor(engine: LiveEngine, problem: PracticeProblem): string[] {
  try {
    const local = localSolve(engine, problem);
    if (!local.source || local.steps.length === 0) return [];
    return problemSteps({ solution: local.steps, head: problem, written: [], depth: "solve", normalize: sameStep });
  } catch {
    return [];
  }
}

/** The first candidate the engine works out on the device, or null. */
export function pickLocalExample(engine: LiveEngine, candidates: readonly PracticeProblem[]): PracticeProblem | null {
  for (const c of candidates) if (c.length > 0 && localWorkFor(engine, c).length > 0) return [...c];
  return null;
}
