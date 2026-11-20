import { describe, expect, it } from "vitest";
import { layoutMath } from "@/lib/hand";
import { youngReadOf } from "@/lib/brain/index";

/** A line in the hand engine's ink, as the brain takes it (`BrainStroke`). */
function strokes(latex: string) {
  return layoutMath(latex, { size: 44, seed: 1 }).strokes.map((st, i) => ({
    id: `s${i}`,
    x: st.points.map((p) => 140 + p.x * 1.36),
    y: st.points.map((p) => 620 + p.y * 1.36),
  }));
}

describe("youngReadOf: a raised dot after a line (v1.0, real-ink bench class: a jaggy mouse's tap after an answer)", () => {
  it("after the problem's right answer it is no times dot still to be followed: the answer stands", () => {
    expect(youngReadOf({ latex: "73", problem: ["70 + 3"], strokes: strokes("73\\cdot") }).latex).toBe("73");
  });
  it("after anything else the line still goes on (`h = 94 ·`)", () => {
    expect(youngReadOf({ latex: "73", problem: ["70 + 4"], strokes: strokes("73\\cdot") }).latex).toBe("73 \\cdot");
    expect(youngReadOf({ latex: "h=94", strokes: strokes("h=94\\cdot") }).latex).toBe("h=94 \\cdot");
  });
});
