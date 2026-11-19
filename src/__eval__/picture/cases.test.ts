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

describe("K–8 picture bench cases", async () => {
  const { K8_CASES, renderK8Board } = await import("./k8");

  it("has ~25+ boards, unique ids, every mode, and every expected outcome", () => {
    expect(K8_CASES.length).toBeGreaterThanOrEqual(25);
    expect(new Set(K8_CASES.map((c) => c.id)).size).toBe(K8_CASES.length);
    expect(new Set(K8_CASES.map((c) => c.mode))).toEqual(new Set(["answer", "suggest", "feedback"]));
    expect(new Set(K8_CASES.map((c) => c.expect.outcome))).toEqual(new Set(["picture", "check", "note", "quiet"]));
    // Solve shows its answer; Suggest and Feedback never may
    for (const c of K8_CASES) if (c.mode === "answer") expect(c.expect.show?.length, c.id).toBeGreaterThan(0);
  });

  it("renders a board the hand engine can write (words, fractions, the accepted blue picture)", async () => {
    for (const id of ["solve-bars-compare", "right-bars", "feedback-pizza"]) {
      const b = await renderK8Board(K8_CASES.find((c) => c.id === id)!);
      expect([b.width, b.height]).toEqual([1440, 1080]);
      expect(b.png.length).toBeGreaterThan(5000);
    }
  });
});
