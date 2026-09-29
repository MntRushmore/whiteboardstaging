import { describe, expect, it } from "vitest";
import { getSnapshot } from "tldraw";
import type { Stroke } from "@/lib/hand";
import { createFakeEditor } from "../../__fixtures__/fakeEditor";
import { joinPlans } from "../../chat/layout";
import { HandWriter, planFromStrokes, planHandwriting, placeHandPlan, type HandPlan } from "../../handwriting";
import { estimateBytes, roundPlan } from "../desk";

/**
 * What a lecture sketch weighs in the saved board. tldraw 4.2 keeps a draw shape's points as JSON
 * `{"x":…,"y":…,"z":…}` (no packed encoding), one shape per stroke, points every 2 px — so the
 * board grows by tens of kilobytes a sketch, and the autosave refuses a board over 4 MB. Measured
 * on a real (headless) store: the layout's full-precision coordinates, the desk's 1/100 px, and
 * the desk's own estimate (`estimateBytes`, what its size guard adds up).
 */

function rule(pts: Array<[number, number]>, order: number): Stroke {
  return { points: pts.map(([x, y]) => ({ x, y, z: 0.5 })), order, kind: "rule" } as Stroke;
}

/** A bar chart as the planners draw one: axes and bars (long ruled strokes) and handwritten labels. */
function barChart(): HandPlan {
  const strokes: Stroke[] = [rule([[40.123456, 20.987654], [40.123456, 340.55555]], 0), rule([[40.123456, 340.55555], [500.3333, 340.55555]], 1)];
  for (let i = 0; i < 6; i++) {
    const x = 70 + i * 70 + 0.3719;
    const h = 60 + i * 40.1234;
    strokes.push(rule([[x, 340.5], [x, 340.5 - h], [x + 44.4, 340.5 - h], [x + 44.4, 340.5]], 2 + i));
  }
  const parts: HandPlan[] = [planFromStrokes("chart", strokes, 30)!];
  for (let i = 0; i < 6; i++) parts.push(placeHandPlan(planHandwriting([`${2019 + i}`], { size: 22, seed: i }).plan!, { x: 70 + i * 70, y: 350 }));
  for (let i = 0; i < 5; i++) parts.push(placeHandPlan(planHandwriting([`${i * 20}`], { size: 20, seed: i }).plan!, { x: 5, y: 330 - i * 70 }));
  parts.push(placeHandPlan(planHandwriting(["GDPgrowthbyyear"], { size: 34, seed: 9 }).plan!, { x: 60, y: 0 }));
  return placeHandPlan(joinPlans(parts)!, { x: 716.3417, y: 152.7291 });
}

function savedBytes(plan: HandPlan): number {
  const editor = createFakeEditor();
  const before = JSON.stringify(getSnapshot(editor.store)).length;
  const writer = new HandWriter(
    { write: (fn) => fn(), createShapes: (s) => editor.createShapes(s), updateShapes: (s) => editor.updateShapes(s), getShape: (id) => editor.getShape(id) },
    { reducedMotion: () => true },
  );
  writer.start(plan, {
    meta: { live: true, source: "ai", lineId: "chat", createdAt: 1_790_000_000_000 },
    extraMeta: { lectureBlock: "chart", lectureWhat: "bar chart: GDP growth by year" },
    whole: true,
  });
  return JSON.stringify(getSnapshot(editor.store)).length - before;
}

describe("the weight of a sketch in the saved board", () => {
  it("the writer saves ink at 1/100 px (rounding again changes nothing), and the desk's estimate is within a quarter of what is saved", () => {
    const plan = barChart();
    const raw = savedBytes(plan);
    const rounded = savedBytes(roundPlan(plan));
    // HandWriter rounds every plan it writes (HAND_WRITE.inkPrecision), so the desk's own rounding is a no-op on what is saved
    expect(rounded).toBe(raw);
    expect(Math.abs(estimateBytes(plan) - rounded) / rounded).toBeLessThan(0.25);
  });
});
