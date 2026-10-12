import type { HandPlan } from "../../handwriting";
import type { VisualModel, VisualModelKind } from "../contracts";
import { planAreaModel } from "./areaModel";
import { planBaseTen } from "./baseTen";
import { modelProblems } from "./check";
import { planClock } from "./clock";
import { planFractionBars, planFractionCircles } from "./fractions";
import { planArray, planEqualGroups } from "./groups";
import type { ModelSketch } from "./kit";
import { planNumberLine } from "./numberLine";
import { planPlaceValue } from "./placeValue";
import { planTape } from "./tape";
import { planTenFrame } from "./tenFrame";

/**
 * The visual models Ask draws (`draw_model`, docs/ASK-V2.md "Drawing"): a spec in, a `HandPlan`
 * out — revealed by the HandWriter one pen stroke at a time in the tutor's hand, like the worked
 * steps, the graphs and the figures. The model says WHAT to draw; these planners lay it out and do
 * every bit of arithmetic in it (an area model's partial products and their sum, a jump's size, the
 * parts shaded, a number's digits by place), so a picture can never show wrong maths. A spec that
 * does not make sense is refused before it gets here (`modelProblems`, which the route's gate runs).
 *
 * Each planner fits its box or says it cannot (null) — never a squashed, overlapping drawing: the
 * desk tries the kind's boxes largest first (`MODEL_BOXES`), down to the smallest that is still
 * legible, beside the problem it goes with (`placeDrawing`). A plan's ink starts a few px in from
 * (0, 0), its `bounds` are its own size (often less than the box), and every line is a named part.
 *
 * Loaded on first use (`ChatDesk`), never with the board: the board's first load is budgeted
 * (docs/BUNDLE.md).
 */

export { modelProblems };
export type { ModelSketch };

type Box = { readonly w: number; readonly h: number };

/**
 * The boxes each kind is planned in, largest first, down to the smallest that is still legible: a
 * number line or a tape is long and low, a clock square, fraction circles a row. A planner takes
 * what it needs of a box (a 0–5 line is not stretched to 900 px).
 */
export const MODEL_BOXES: Readonly<Record<VisualModelKind, readonly Box[]>> = {
  number_line: [
    { w: 960, h: 300 },
    { w: 800, h: 270 },
    { w: 660, h: 240 },
    { w: 540, h: 220 },
    { w: 440, h: 200 },
  ],
  fraction_bars: [
    { w: 780, h: 380 },
    { w: 660, h: 330 },
    { w: 540, h: 280 },
    { w: 440, h: 230 },
  ],
  fraction_circles: [
    { w: 880, h: 340 },
    { w: 720, h: 290 },
    { w: 580, h: 250 },
    { w: 460, h: 210 },
  ],
  array: [
    { w: 620, h: 520 },
    { w: 500, h: 420 },
    { w: 400, h: 340 },
    { w: 320, h: 280 },
  ],
  equal_groups: [
    { w: 880, h: 440 },
    { w: 720, h: 370 },
    { w: 580, h: 310 },
    { w: 460, h: 260 },
  ],
  area_model: [
    { w: 720, h: 470 },
    { w: 600, h: 400 },
    { w: 500, h: 340 },
    { w: 420, h: 290 },
  ],
  base_ten: [
    { w: 820, h: 440 },
    { w: 680, h: 370 },
    { w: 560, h: 310 },
    { w: 440, h: 250 },
  ],
  place_value: [
    { w: 900, h: 320 },
    { w: 740, h: 280 },
    { w: 600, h: 250 },
    { w: 460, h: 220 },
  ],
  tape: [
    { w: 900, h: 300 },
    { w: 760, h: 270 },
    { w: 620, h: 240 },
    { w: 480, h: 220 },
  ],
  ten_frame: [
    { w: 560, h: 340 },
    { w: 460, h: 290 },
    { w: 380, h: 240 },
    { w: 300, h: 200 },
  ],
  clock: [
    { w: 400, h: 400 },
    { w: 340, h: 340 },
    { w: 280, h: 280 },
    { w: 220, h: 220 },
  ],
};

/** The model planned in `box`, with its writing (the tests' and the gallery's view); null when it does not fit legibly. */
export function sketchModel(model: VisualModel, box: Box, seed: number): ModelSketch | null {
  const b = { w: box.w, h: box.h };
  try {
    switch (model.kind) {
      case "number_line":
        return planNumberLine(model, b, seed);
      case "fraction_bars":
        return planFractionBars(model, b, seed);
      case "fraction_circles":
        return planFractionCircles(model, b, seed);
      case "array":
        return planArray(model, b, seed);
      case "equal_groups":
        return planEqualGroups(model, b, seed);
      case "area_model":
        return planAreaModel(model, b, seed);
      case "base_ten":
        return planBaseTen(model, b, seed);
      case "place_value":
        return planPlaceValue(model, b, seed);
      case "tape":
        return planTape(model, b, seed);
      case "ten_frame":
        return planTenFrame(model, b, seed);
      case "clock":
        return planClock(model, b, seed);
    }
  } catch {
    // a planner that throws is a drawing that is not made, never a crashed reply
    return null;
  }
}

/** The model's plan in `box` (what the desk places and writes), or null when it does not fit legibly there. */
export function planModel(model: VisualModel, box: Box, seed: number): HandPlan | null {
  return sketchModel(model, box, seed)?.plan ?? null;
}
