import { describe, expect, it } from "vitest";
import { flatRead, sameRead } from "../sameRead";

describe("sameRead (the recognize route's second opinion)", () => {
  it("agrees on the same maths spelt by two readers", () => {
    expect(sameRead("3 x=15", "3x = 15")).toBe(true);
    expect(sameRead("x^{2}-5 x+6=0", "x^2 - 5x + 6 = 0")).toBe(true);
    expect(sameRead("\\left(a+b\\right)^{2}", "(a+b)^2")).toBe(true);
    expect(sameRead("\\text { 12-5 }", "12-5")).toBe(true);
    expect(sameRead("3 \\cdot 4=12", "3 \\times 4 = 12")).toBe(true);
    expect(sameRead("x \\leq 3", "x \\le 3")).toBe(true);
    expect(sameRead("\\frac{3}{4}+\\frac{1}{8}", "\\frac{3}{4} + \\frac{1}{8}")).toBe(true);
    expect(sameRead("x = 4.", "x=4")).toBe(true);
  });

  it("disagrees on the eval's look-alike misreads", () => {
    expect(sameRead("0=5", "a=5")).toBe(false);
    expect(sameRead("6^{x}=10", "e^{x}=10")).toBe(false);
    expect(sameRead("b=20-3", "b=2 a-3")).toBe(false);
    expect(sameRead("U=3", "u=3")).toBe(false);
    expect(sameRead("4 \\times=12", "4 x=12")).toBe(false);
    expect(sameRead("\\frac{9}{0}", "\\frac{9}{8}")).toBe(false);
  });

  it("never agrees with an empty read", () => {
    expect(sameRead("", "")).toBe(false);
    expect(sameRead("x=1", "")).toBe(false);
    expect(flatRead("  ")).toBe("");
  });
});
