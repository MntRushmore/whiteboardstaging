import { describe, expect, it } from "vitest";
import type { HandPlan } from "../../handwriting";
import { LECTURE_BOXES, planChart, planDiagram, planHeading, planNote } from "../plan";
import { CHART_GALLERY, DIAGRAM_GALLERY } from "./gallery";

/** A plan as the desk and the HandWriter expect it: ink from (0, 0), each line's strokes relative to its origin, a clock. */
function expectPlan(plan: HandPlan | null, box: { w: number; h: number }, what: string): void {
  expect(plan, what).not.toBeNull();
  const p = plan!;
  expect(p.bounds.x, what).toBe(0);
  expect(p.bounds.y, what).toBe(0);
  expect(p.bounds.w, what).toBeLessThanOrEqual(box.w);
  expect(p.bounds.h, what).toBeLessThanOrEqual(box.h);
  expect(p.lines.length, what).toBeGreaterThan(0);
  expect(p.totalMs, what).toBeGreaterThan(0);
  expect(p.pace ?? 1, what).toBeGreaterThanOrEqual(1);
  let t = -1;
  for (const l of p.lines) {
    expect(l.strokes.length, what).toBeGreaterThan(0);
    expect(l.startMs, what).toBeGreaterThan(t);
    t = l.startMs;
    expect(l.startMs + l.durationMs, what).toBeLessThanOrEqual(p.totalMs + 1e-6);
    const xs = l.strokes.flatMap((s) => s.points.map((q) => q.x));
    const ys = l.strokes.flatMap((s) => s.points.map((q) => q.y));
    expect(Math.min(...xs), what).toBeCloseTo(0, 6);
    expect(Math.min(...ys), what).toBeCloseTo(0, 6);
  }
}

describe("lecture planners (the desk's API)", () => {
  it("offers the desk three boxes for a visual, largest first", () => {
    const areas = LECTURE_BOXES.visual.map((b) => b.w * b.h);
    expect([...areas].sort((a, b) => b - a)).toEqual(areas);
    expect(LECTURE_BOXES.visual[0]).toEqual({ w: 520, h: 380 });
  });

  it("plans charts and diagrams inside the box, ink from (0, 0)", () => {
    const box = LECTURE_BOXES.visual[0];
    for (const [i, c] of CHART_GALLERY.entries()) expectPlan(planChart(c.spec, { seed: i, box }), box, c.title);
    for (const [i, d] of DIAGRAM_GALLERY.entries()) expectPlan(planDiagram(d.spec, { seed: i, box }), box, d.title);
  });

  it("plans a heading and a note within their widths", () => {
    expectPlan(planHeading("The Industrial Revolution", { seed: 1, maxW: LECTURE_BOXES.heading.maxW }), { w: LECTURE_BOXES.heading.maxW, h: 120 }, "heading");
    expectPlan(planNote("Steam power let factories be built away from rivers.", { seed: 1, maxW: LECTURE_BOXES.note.maxW }), { w: LECTURE_BOXES.note.maxW, h: 200 }, "note");
  });

  it("is null, never an overflow, when the box is too small", () => {
    const tiny = { w: 90, h: 70 };
    for (const c of CHART_GALLERY) expect(planChart(c.spec, { seed: 1, box: tiny }), c.title).toBeNull();
    for (const d of DIAGRAM_GALLERY) expect(planDiagram(d.spec, { seed: 1, box: tiny }), d.title).toBeNull();
    expect(planHeading("Photosynthesis", { seed: 1, maxW: 60 })).toBeNull();
    expect(planNote("Mitochondria make ATP.", { seed: 1, maxW: 60 })).toBeNull();
  });
});
