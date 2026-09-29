import { describe, expect, it } from "vitest";
import { placeStrokes } from "@/lib/hand";
import { planChart, planHeading } from "../plan";
import { wordsWeight, writeWords } from "../words";

/**
 * The pen of lecture sketches: words are written with a pen as fine as their size (a chart's labels
 * with about half the tutor's), and that weight has to survive every step between the planner and
 * the board — the first time on the board it did not (`placeStrokes` rebuilt each stroke without
 * it), and every label came out with the full pen, its letters filled in.
 */
describe("the pen weight of lecture words", () => {
  it("thins with the writing, from the tutor's full pen for a heading down to about a third", () => {
    expect(wordsWeight(80)).toBe(1);
    expect(wordsWeight(52)).toBeGreaterThan(0.85);
    expect(wordsWeight(27)).toBeLessThan(0.5);
    expect(wordsWeight(10)).toBe(0.36);
  });

  it("is on every stroke writeWords writes", () => {
    const w = writeWords("Connect rates", { x: 0, y: 0 }, "left", "top", 26, 7);
    expect(w).not.toBeNull();
    expect(w!.strokes.length).toBeGreaterThan(0);
    expect(w!.strokes.every((s) => s.weight === wordsWeight(w!.size))).toBe(true);
  });

  it("survives placeStrokes", () => {
    const w = writeWords("Fix problems", { x: 0, y: 0 }, "left", "top", 24, 3)!;
    const placed = placeStrokes(w.strokes, { x: 40, y: 12 });
    expect(placed.every((s) => s.weight === w.strokes[0].weight)).toBe(true);
  });

  it("reaches the plan: a chart's labels are finer than its heading's words", () => {
    const chart = planChart({ kind: "bar", title: "Connect rates", labels: ["Mon", "Tue", "Wed"], series: [{ values: [8, 10, 14] }], unit: "%" }, { seed: 1, box: { w: 520, h: 380 } });
    const heading = planHeading("Cold calling in B2B sales", { seed: 1, maxW: 1100 });
    const labels = chart!.lines.filter((l) => l.part?.startsWith("label")).flatMap((l) => l.strokes);
    const words = heading!.lines.flatMap((l) => l.strokes).filter((s) => s.kind === "glyph");
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.every((s) => typeof s.weight === "number" && s.weight < 0.6)).toBe(true);
    expect(words.every((s) => typeof s.weight === "number" && s.weight > 0.8)).toBe(true);
  });
});
