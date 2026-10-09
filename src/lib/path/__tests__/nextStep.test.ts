import { describe, expect, it } from "vitest";
import { nextStepIndex } from "../nextStep";

describe("nextStepIndex", () => {
  it("the first skill not mastered, in order", () => {
    expect(nextStepIndex(["mastered", "almost", "practicing", "new"])).toBe(1);
    expect(nextStepIndex(["new", "new", "new"])).toBe(0);
    expect(nextStepIndex(["mastered", "new", "practicing"])).toBe(1);
  });

  it("skips a skill never tried behind one the student is Almost there on (an Algebra 1 student is not sent back to review)", () => {
    // order of operations, negative numbers: new; two-step equations: almost; inequalities: practicing
    expect(nextStepIndex(["new", "new", "almost", "practicing", "new"])).toBe(2);
    expect(nextStepIndex(["new", "new", "mastered", "practicing", "new"])).toBe(3);
  });

  it("keeps a skill already being practiced, wherever it is", () => {
    expect(nextStepIndex(["practicing", "new", "almost"])).toBe(0);
  });

  it("-1 once every skill is mastered; the first not mastered when everything else is behind", () => {
    expect(nextStepIndex(["mastered", "mastered"])).toBe(-1);
    expect(nextStepIndex([])).toBe(-1);
    expect(nextStepIndex(["new", "mastered"])).toBe(0);
  });
});
