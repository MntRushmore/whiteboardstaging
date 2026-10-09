import { describe, expect, it } from "vitest";
import { inSimplestForm, numbersIn, parseArithmetic, q, stepValues, tidyArithmetic, valueOf, type Node } from "../exactArithmetic";

/**
 * Grade-school arithmetic read exactly (`engine/exactArithmetic.ts`): values as fractions in lowest
 * terms (so `5.4 \times 0.1` is 0.54, not 0.5400000000000001), and the shape of what was written —
 * which numbers, a fraction in its lowest terms or not — which is what a teacher looks at.
 */

const value = (latex: string) => {
  const n = parseArithmetic(latex);
  return n ? valueOf(n) : null;
};

describe("reading arithmetic exactly", () => {
  it.each<[string, [number, number]]>([
    ["18 \\times 7", [126, 1]],
    ["10 \\times 7 + 8 \\times 7", [126, 1]],
    ["5.4 \\times 0.1", [27, 50]],
    [".54", [27, 50]],
    ["0.540", [27, 50]],
    ["3 + 4 \\times 2", [11, 1]],
    ["(3 + 4) \\times 2", [14, 1]],
    ["\\left(3 + 4\\right) \\cdot 2", [14, 1]],
    ["2^{3} + 1", [9, 1]],
    ["8 x 7", [56, 1]],
    ["144 / 9", [16, 1]],
    ["144 \\div 9", [16, 1]],
    ["17 \\div 5", [17, 5]],
    ["1,250 + 750", [2000, 1]],
    ["-3 - 7", [-10, 1]],
    ["(-6)(-9)", [54, 1]],
    ["2(3 + 4)", [14, 1]],
    ["\\frac{1}{2} + \\frac{1}{3}", [5, 6]],
    ["\\dfrac{3}{4} \\times \\dfrac{2}{3}", [1, 2]],
    ["2\\frac{1}{3} + 1\\frac{1}{2}", [23, 6]],
    ["\\frac{3 \\times 2}{4 \\times 3}", [1, 2]],
    ["\\frac{1}{2} \\div \\frac{1}{4}", [2, 1]],
  ])("%s", (latex, [n, d]) => {
    expect(value(latex)).toEqual({ n, d });
  });

  it.each(["x + 1", "\\sqrt{4}", "3 R 2", "", "2\\frac{x}{2}", "10 \\% of 80", "3 = 4", "9 \\longdiv { 144 }", "1 \\div 0", "2^{20}"])("not plain arithmetic: %s", (latex) => {
    expect(parseArithmetic(latex)).toBeNull();
  });

  it("keeps how each number was written: whole, decimal, fraction, mixed", () => {
    const n = parseArithmetic("2\\frac{1}{3} + \\frac{3}{6} + 0.25 + 7") as Node;
    expect(numbersIn(n).map((w) => [w.form, w.value])).toEqual([
      ["mixed", { n: 7, d: 3 }],
      ["frac", { n: 1, d: 2 }],
      ["dec", { n: 1, d: 4 }],
      ["int", { n: 7, d: 1 }],
    ]);
    expect(numbersIn(n)[1]).toMatchObject({ top: 3, bottom: 6 });
  });

  it("its steps: the value of every operation, innermost first", () => {
    expect(stepValues(parseArithmetic("3 + 4 \\times 2") as Node)).toEqual([q(8), q(11)]);
  });

  it("tidies the signs a young hand's read comes with", () => {
    expect(tidyArithmetic("8 x 7")).toBe("8 × 7");
    expect(tidyArithmetic("12 : 4")).toBe("12 ÷ 4");
    expect(tidyArithmetic("5 \\cdot 3")).toBe("5 × 3");
  });
});

describe("the simplest form an answer is written in", () => {
  const written = (latex: string) => numbersIn(parseArithmetic(latex) as Node)[0];

  it.each([
    ["126", true],
    ["0.54", true],
    ["\\frac{5}{6}", true],
    ["\\frac{23}{6}", true],
    ["3\\frac{5}{6}", true],
    ["\\frac{3}{6}", false],
    ["\\frac{4}{4}", false],
    ["\\frac{6}{1}", false],
    ["2\\frac{4}{3}", false],
    ["2\\frac{2}{6}", false],
  ])("%s: %s", (latex, simplest) => {
    expect(inSimplestForm(written(latex))).toBe(simplest);
  });
});
