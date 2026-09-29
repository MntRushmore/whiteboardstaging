import type { HandPlan } from "../handwriting";
import { sketchChart } from "./chart";
import type { ChartSpec, DiagramSpec } from "./contracts";
import { sketchDiagram } from "./diagram";
import { sketchHeading, sketchNote } from "./text";

/**
 * Lecture mode's planners: a chart, a diagram, a heading or a note in, a `HandPlan` out — the
 * same plan the worked steps and the graphs are written from, so the HandWriter reveals it one
 * pen stroke at a time in the tutor's hand. Pure geometry (no tldraw, no DOM). A plan is in its
 * own px with its ink from (0, 0) (`bounds` = { x: 0, y: 0, w, h }, inside the box it was
 * given); the desk moves it onto the page with `placeHandPlan`. Null when the hand cannot draw
 * it well in that box (the desk tries a smaller box, a new screen, or leaves it out) — never a
 * squashed or overlapping sketch.
 *
 * Each plan carries its `pace`: a heading is on the board in ~1.5–2 s, a note in ~2–3.5 s, a
 * chart in ~5–7 s and a diagram in ~5–8 s of wall time (see `LECTURE_PACE`).
 *
 * How each is drawn: `text.ts` (heading, note), `chart/` (bar, line, pie, scatter, table),
 * `diagram/` (flow, cycle, timeline, hub, tree, venn); the words themselves: `words.ts`.
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

export function planChart(spec: ChartSpec, opts: LecturePlanOptions): HandPlan | null {
  return sketchChart(spec, opts)?.plan ?? null;
}

export function planDiagram(spec: DiagramSpec, opts: LecturePlanOptions): HandPlan | null {
  return sketchDiagram(spec, opts)?.plan ?? null;
}

export function planHeading(text: string, opts: { seed: number; maxW: number }): HandPlan | null {
  return sketchHeading(text, opts)?.plan ?? null;
}

/** A note; `slide`: a slide's bullet (two lines while it fits in two, evenly broken: `LECTURE_WORDS.slide`). */
export function planNote(text: string, opts: { seed: number; maxW: number; slide?: boolean }): HandPlan | null {
  return sketchNote(text, opts)?.plan ?? null;
}
