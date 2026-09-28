import type { HandPlan } from "../handwriting";
import type { ChartSpec, DiagramSpec } from "./contracts";

/**
 * Lecture mode's planners: a chart, a diagram, a heading or a note in, a `HandPlan` out — the
 * same plan the worked steps and the graphs are written from, so the HandWriter reveals it one
 * pen stroke at a time in the tutor's hand. Pure geometry (no tldraw, no DOM). A plan is in its
 * own px with `bounds` inside the box it was given; the desk moves it onto the page with
 * `placeHandPlan`. Null when the hand cannot draw it well in that box (the desk tries a smaller
 * box, a new screen, or leaves it out) — never a squashed or overlapping sketch.
 *
 * STUB: the signatures are the contract; the implementations land with the planners.
 */

export const LECTURE_BOXES = {
  /** a chart or a diagram, largest first */
  visual: [
    { w: 520, h: 380 },
    { w: 440, h: 320 },
    { w: 360, h: 260 },
  ],
  /** a note wraps at this width */
  note: { maxW: 620 },
  /** a heading is one line at most this wide (it shrinks to fit) */
  heading: { maxW: 1100 },
} as const;

export interface LecturePlanOptions {
  seed: number;
  box: { w: number; h: number };
}

export function planChart(_spec: ChartSpec, _opts: LecturePlanOptions): HandPlan | null {
  return null;
}

export function planDiagram(_spec: DiagramSpec, _opts: LecturePlanOptions): HandPlan | null {
  return null;
}

export function planHeading(_text: string, _opts: { seed: number; maxW: number }): HandPlan | null {
  return null;
}

export function planNote(_text: string, _opts: { seed: number; maxW: number }): HandPlan | null {
  return null;
}
