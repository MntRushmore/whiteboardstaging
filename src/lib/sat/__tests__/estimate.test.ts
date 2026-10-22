/**
 * The estimate (src/lib/sat/estimate.ts): null below 15 answers, always within 200..800, a band
 * that narrows as more are answered, higher for harder questions answered right, and the honest note.
 */
import { describe, expect, it } from "vitest";
import { abilityOf, estimateBand, ESTIMATE_NOTE, type EstimateAnswer } from "@/lib/sat/estimate";

const answers = (n: number, difficulty: number, rightEvery: number): EstimateAnswer[] =>
  Array.from({ length: n }, (_, i) => ({ difficulty, correct: i % rightEvery !== 0 }));

describe("estimateBand", () => {
  it("is null until 15 answers", () => {
    expect(estimateBand(answers(14, 2, 2))).toBeNull();
    expect(estimateBand(answers(15, 2, 2))).not.toBeNull();
  });
  it("is a band within 200..800, rounded to tens, labelled as a rough estimate", () => {
    for (const set of [answers(15, 1, 1), answers(40, 3, 1000), answers(60, 2, 2), Array(100).fill({ difficulty: 1, correct: false })]) {
      const b = estimateBand(set)!;
      expect(b.low).toBeGreaterThanOrEqual(200);
      expect(b.high).toBeLessThanOrEqual(800);
      expect(b.low).toBeLessThan(b.high);
      expect(b.low % 10).toBe(0);
      expect(b.high % 10).toBe(0);
      expect(b.note).toBe(ESTIMATE_NOTE);
    }
  });
  it("narrows as more questions are answered", () => {
    const w = (n: number) => {
      const b = estimateBand(answers(n, 2, 3))!;
      return b.high - b.low;
    };
    expect(w(15)).toBeGreaterThan(w(40));
    expect(w(40)).toBeGreaterThan(w(120));
    expect(w(15)).toBeLessThanOrEqual(170);
    expect(w(120)).toBeGreaterThanOrEqual(80);
  });
  it("rates hard questions answered right above easy ones answered right", () => {
    const hard = estimateBand(answers(30, 3, 4))!;
    const easy = estimateBand(answers(30, 1, 4))!;
    expect(hard.low + hard.high).toBeGreaterThan(easy.low + easy.high);
  });
  it("reads only the newest 120 answers", () => {
    const recentGood = [...Array(120).fill({ difficulty: 3, correct: true }), ...Array(300).fill({ difficulty: 1, correct: false })];
    expect(estimateBand(recentGood)!.low).toBeGreaterThan(600);
  });
});

describe("abilityOf", () => {
  it("sits at 0 for half right on medium questions, and is finite when everything is right", () => {
    expect(abilityOf(answers(40, 2, 2)).theta).toBeCloseTo(0, 5);
    const all = abilityOf(Array(50).fill({ difficulty: 3, correct: true }));
    expect(Number.isFinite(all.theta)).toBe(true);
    expect(all.se).toBeGreaterThan(0);
  });
});
