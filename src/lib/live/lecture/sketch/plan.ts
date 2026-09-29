import type { Rect } from "../../contracts";
import type { HandPlan } from "../../handwriting";
import type { SketchDrawing } from "../contracts";
import { sketchDrawing } from "./ink";
import { sketchPanels } from "./panels";

/**
 * Free drawing's planners: an illustrator's drawing in, the tutor's hand-drawn ink out, and the
 * frames of a comic strip (with their captions) that the drawings fill. Pure geometry, like the
 * chart and diagram planners (`../plan.ts`): plans in their own px from (0, 0), inside the box they
 * were given, `part`-named lines; the desk places them with `placeHandPlan`.
 *
 * How a comic goes on the board: `planPanels` for the strip's box first (frames, captions, title,
 * ~2–3 s of wall time); each frame's drawing area (`frames[i]`, plan-local) is the box the
 * illustrator draws panel i for (aspect `w / h`), and when the drawing arrives `planSketch` fits it
 * into that area's size and the desk places it at the strip's origin plus the area's corner. A
 * drawing takes ~4–6 s. How each is drawn: `ink.ts` (the drawing), `panels.ts` (the strip).
 */

export interface SketchPlanOptions {
  seed: number;
  box: { w: number; h: number };
}

/** A drawing fitted into the box (aspect kept, centred), as ink. Null when it cannot be drawn well there. */
export function planSketch(drawing: SketchDrawing, opts: SketchPlanOptions): HandPlan | null {
  return sketchDrawing(drawing, opts)?.plan ?? null;
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
export function planPanels(layout: { count: number; captions: ReadonlyArray<string | undefined>; title?: string; framed: boolean }, opts: SketchPlanOptions): PanelsLayout | null {
  const out = sketchPanels(layout, opts);
  return out ? { plan: out.sketch.plan, frames: out.frames } : null;
}
