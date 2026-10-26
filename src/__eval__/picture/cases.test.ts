import { describe, expect, it } from "vitest";
import { renderBoard, plainText } from "./board";
import { benchCases, extraCases, FRAMES } from "./cases";

describe("picture bench cases", () => {
  it("covers every frame, placement, hand and mode, with unique ids", () => {
    const cases = [...benchCases(), ...extraCases()];
    expect(benchCases()).toHaveLength(72);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    for (const key of ["frame", "placement", "hand", "mode"] as const) {
      const seen = new Set(benchCases().map((c) => c[key]));
      expect(seen.size, key).toBeGreaterThanOrEqual(key === "mode" ? 3 : key === "hand" ? 4 : key === "frame" ? 4 : 5);
    }
  });

  it("renders a board at its frame's size (portrait, crammed, a figure)", async () => {
    for (const c of benchCases().filter((c) => c.frame === "portrait" || c.placement === "crammed" || c.problem.figure).slice(0, 3)) {
      const b = await renderBoard(c);
      expect([b.width, b.height]).toEqual([FRAMES[c.frame].w, FRAMES[c.frame].h]);
      expect(b.png.length).toBeGreaterThan(1000);
    }
  });

  it("types LaTeX as a worksheet would", () => {
    expect(plainText("\\frac{3}{4} + 2^{3} \\times 5 \\le 9")).toBe("3/4 + 2³ × 5 ≤ 9");
  });
});
