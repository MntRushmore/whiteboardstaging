import type { HandPlan } from "../../handwriting";
import type { Rect } from "../../contracts";
import type { SketchDrawing } from "../contracts";

/**
 * Free drawing's planners: an illustrator's drawing in, the tutor's hand-drawn ink out, and the
 * frames of a comic strip (with their captions) that the drawings fill. Pure geometry, like the
 * chart and diagram planners (`../plan.ts`): plans in their own px from (0, 0), inside the box they
 * were given, `part`-named lines; the desk places them with `placeHandPlan`.
 *
 * STUB: the signatures are the contract; the implementations land with the planners.
 */

export interface SketchPlanOptions {
  seed: number;
  box: { w: number; h: number };
}

/** A drawing fitted into the box (aspect kept, centred), as ink. Null when it cannot be drawn well there. */
export function planSketch(_drawing: SketchDrawing, _opts: SketchPlanOptions): HandPlan | null {
  return null;
}

export interface PanelsLayout {
  /** the frames, captions and title as ink (the drawings go inside `frames`) */
  plan: HandPlan;
  /** each panel's drawing area, plan-local, in reading order */
  frames: Rect[];
}

/**
 * The frames of `count` panels (a single picture is one, without a frame drawn round it when
 * `framed` is false), each with its caption under it, and the title above — laid out in the box: a
 * row when they fit, else two by two.
 */
export function planPanels(_layout: { count: number; captions: ReadonlyArray<string | undefined>; title?: string; framed: boolean }, _opts: SketchPlanOptions): PanelsLayout | null {
  return null;
}
