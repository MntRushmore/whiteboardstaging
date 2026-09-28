import type { Rect } from "../contracts";
import { rectMaxX, rectMaxY, rectsIntersect } from "../placement";
import type { ProblemCell } from "./cells";

/**
 * The tutor working a problem it wrote (the board chat's, the onboarding's starter): a student
 * who has written nothing under `1. 2\sin x = 1` and presses Solve steps, switches the dial to
 * Solve or Suggest, taps Help, or asks the chat "help me with 3", gets the problem worked — or its
 * next step written — under it, in the tutor's hand, by the same local engine Solve uses on the
 * student's own work. Pure: which problem, which steps, where. The loop (`LiveLoop.workProblem`)
 * does the writing.
 *
 * One problem at a time, never every problem on a screen of five: "the current problem" is the
 * one the student last wrote in, else the first in reading order the student has not worked on
 * and the tutor has not solved. (The chat writes a problem set only on an empty screen, so the
 * problems on a screen are one set — the most recent — and its first open problem is the one the
 * student works next.)
 */

/**
 * meta on everything the tutor writes working a problem: `step` (a step of it, the next one each
 * time) or `solution` (the rest of it, worked out). The problem is solved once a `solution` is on
 * the page; neither is written twice (a reload or the dial moved again finds it there).
 */
export const PROBLEM_WORK_META = "problemWork";
export type ProblemWorkKind = "step" | "solution";

/** How much the tutor writes: the next step, or the rest worked out. */
export type ProblemDepth = "step" | "solve";

/**
 * The `meta.lineId` of the tutor's work on a problem: stable across a reload, because the cell's
 * key is the problem's own hand block (`readProblemCells`). No student line has it.
 */
export function problemLineId(cell: Pick<ProblemCell, "key">): string {
  return `problem:${cell.key}`;
}

/** What is under a problem now. */
export interface ProblemState {
  /** the student has written a line under it the tutor can judge (a lone `2` is not one) */
  work: boolean;
  /** the tutor has worked it out under it, or is writing that now */
  solved: boolean;
  /** the tutor has written anything under it — a step, the solution — or is writing it now */
  started: boolean;
}

/**
 * What to help with: the student's own work under the problem (`student`: continue from their last
 * good line, as Solve and Help always have), the problem itself (`tutor`: the tutor works it from
 * the problem), or nothing (`none`: no problem is open).
 */
export type ProblemPick = { kind: "student"; cell: ProblemCell } | { kind: "tutor"; cell: ProblemCell } | { kind: "none" };

const NONE: ProblemPick = { kind: "none" };

/**
 * "The current problem": the one whose cell the student last wrote in (`touched`, a cell key), else
 * the first in reading order with no work of the student's under it and no solution of the tutor's.
 * Null when there is none.
 */
export function currentProblem(cells: readonly ProblemCell[], touched: string | null, state: (cell: ProblemCell) => ProblemState): ProblemCell | null {
  const mine = touched ? cells.find((c) => c.key === touched) : undefined;
  if (mine) return mine;
  return cells.find((c) => {
    const s = state(c);
    return !s.work && !s.solved;
  }) ?? null;
}

/**
 * Solve (Solve steps, the dial moved to Solve, Help in Solve): the current problem — the student's
 * work under it when they have some, else the problem worked out. Asked again once it is solved,
 * the next problem that is not, after it in reading order; none left, nothing.
 */
export function pickForSolve(cells: readonly ProblemCell[], touched: string | null, state: (cell: ProblemCell) => ProblemState): ProblemPick {
  const cur = currentProblem(cells, touched, state);
  if (!cur) return NONE;
  const s = state(cur);
  if (s.work) return { kind: "student", cell: cur };
  if (!s.solved) return { kind: "tutor", cell: cur };
  const at = cells.indexOf(cur);
  for (let k = 1; k < cells.length; k++) {
    const c = cells[(at + k) % cells.length];
    const cs = state(c);
    if (!cs.work && !cs.solved) return { kind: "tutor", cell: c };
  }
  return NONE;
}

/**
 * A step (the dial moved to Suggest, Help in Feedback / Suggest): the current problem — the
 * student's work under it when they have some, else the problem. It never moves on to another
 * problem: a step the student has not used yet is the help, not a step of the next problem.
 */
export function pickForStep(cells: readonly ProblemCell[], touched: string | null, state: (cell: ProblemCell) => ProblemState): ProblemPick {
  const cur = currentProblem(cells, touched, state);
  if (!cur) return NONE;
  return state(cur).work ? { kind: "student", cell: cur } : { kind: "tutor", cell: cur };
}

/**
 * The lines the tutor writes next under a problem, from the engine's worked solution of it
 * (`localSolve` over the problem's lines, or the model's checked steps):
 *
 *  - a step that only writes the problem out again (`2\sin x = 1` under `1. 2\sin x = 1`) is not
 *    written — the problem is right above;
 *  - the work continues after the last of its steps the tutor already wrote there, so each step
 *    asked for is the next one, and "solve" after a step writes the rest, not the whole again;
 *  - `step`, with nothing written yet: the first step a student would get a tick for straight
 *    under the problem (`\sin x = \frac{1}{2}`, not the `0^{\circ} \le x < 360^{\circ}` Solve
 *    starts a trig equation with), else simply the first;
 *  - `solve`: all of the rest.
 *
 * [] when there is nothing left to write: the problem is worked out on the page.
 */
export function problemSteps(args: {
  solution: readonly string[];
  head: readonly string[];
  written: readonly string[];
  depth: ProblemDepth;
  /** comparable form of a line (`normalizeStep`): spacing, `\left`, `\cdot` ignored */
  normalize: (latex: string) => string;
  /** would the engine tick this line written straight under the problem */
  ticked?: (step: string) => boolean;
}): string[] {
  const norm = args.normalize;
  const head = new Set(args.head.map(norm));
  const body = args.solution.filter((s) => !head.has(norm(s)));
  const written = new Set(args.written.map(norm));
  let last = -1;
  body.forEach((s, i) => {
    if (written.has(norm(s))) last = i;
  });
  const rest = body.slice(last + 1);
  if (args.depth === "solve" || rest.length === 0) return rest;
  if (last >= 0 || !args.ticked) return rest.slice(0, 1);
  return [rest.find((s) => args.ticked!(s)) ?? rest[0]];
}

export const WORK_PLACE = {
  /** space kept to the cell's edges */
  margin: 12,
  /** between the problem (or the tutor's last block) and the next block */
  gap: 16,
  /** how far a block slides right, each try, when the column is blocked all the way down */
  stepX: 48,
} as const;

/**
 * Where a block of the tutor's work goes in a problem's cell: at `at` (the problem's left edge,
 * under what is written there), moved down just past whatever is in the way, then — when the
 * column is blocked to the bottom of the cell — a little to the right and down again. Never over
 * anything in `avoid`, never outside `cell`. Null when it does not fit.
 */
export function placeInCell(size: { w: number; h: number }, at: { x: number; y: number }, cell: Rect, avoid: readonly Rect[]): Rect | null {
  const left = cell.x + WORK_PLACE.margin;
  const right = rectMaxX(cell) - WORK_PLACE.margin;
  const bottom = rectMaxY(cell) - WORK_PLACE.margin;
  if (size.w > right - left || size.h > bottom - at.y) return null;
  const x0 = Math.max(left, Math.min(at.x, right - size.w));
  for (let x = x0; x + size.w <= right; x += WORK_PLACE.stepX) {
    let r: Rect = { x, y: at.y, w: size.w, h: size.h };
    for (let k = 0; k < 40 && rectMaxY(r) <= bottom; k++) {
      const hits = avoid.filter((a) => rectsIntersect(r, a));
      if (hits.length === 0) return r;
      r = { ...r, y: Math.max(...hits.map(rectMaxY)) + WORK_PLACE.gap / 2 };
    }
  }
  return null;
}
