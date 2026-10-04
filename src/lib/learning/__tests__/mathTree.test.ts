import { describe, expect, it } from "vitest";
import { evaluate, polyDegree, readLatex, readRelation, termsOf, variablesOf, type Node } from "../mathTree";

const side = (latex: string, i = 0): Node => {
  const r = readRelation(latex);
  if (!r || !r.sides[i]) throw new Error(`unread: ${latex}`);
  return r.sides[i]!;
};
const value = (latex: string, scope: Record<string, number> = {}) => evaluate(side(latex), scope);

describe("mathTree: reading", () => {
  it.each([
    ["2x + 3", { x: 4 }, 11],
    ["3(x - 2)", { x: 5 }, 9],
    ["\\frac{x}{2} - 5", { x: 12 }, 1],
    ["x^{2} - 5x + 6", { x: 4 }, 2],
    ["x^2-5x+6", { x: 4 }, 2],
    ["-x^{2}", { x: 3 }, -9],
    ["(-3)^{2} + 4 \\times 5", {}, 29],
    ["3 + 4 \\times 2 - 6 \\div 3", {}, 9],
    ["2 \\frac{1}{2} + 1 \\frac{3}{4}", {}, 4.25],
    ["\\sqrt{x + 3}", { x: 22 }, 5],
    ["\\sqrt[3]{-8}", {}, -2],
    ["|x - 3|", { x: 1 }, 2],
    ["\\left|x-3\\right| + 3|x - 1|", { x: 0 }, 6],
    ["2^{x + 1}", { x: 3 }, 16],
    ["\\log_{2}(x)", { x: 32 }, 5],
    ["\\log_{2} 8 + \\log_{2} 4", {}, 5],
    ["\\sin 30^{\\circ}", {}, 0.5],
    ["2\\cos x - 1", { x: Math.PI / 3 }, 0],
    ["\\sin^{2} x + \\cos^{2} x", { x: 0.7 }, 1],
    ["15\\%", {}, 0.15],
    ["\\frac12", {}, 0.5],
    ["x^23", { x: 2 }, 12],
    ["\\dfrac{3}{4} \\cdot 8", {}, 6],
    ["4!", {}, 24],
  ] as const)("%s", (latex, scope, want) => {
    expect(value(latex, scope)).toBeCloseTo(want, 9);
  });

  it("relations, empty sides and parts", () => {
    expect(readRelation("2x + 3 = 11")?.ops).toEqual(["="]);
    expect(readRelation("-3 < 2x + 1 \\le 7")?.ops).toEqual(["<", "<="]);
    expect(readRelation("2x + 3 =")?.sides[1]).toBeNull();
    expect(readRelation("x = ?")?.sides[1]).toBeNull();
    expect(readLatex("2\\cos x = 1, 0 \\le x < 2\\pi")?.items).toHaveLength(2);
    expect(readRelation("(2, 3)")?.sides[0]?.t).toBe("tuple");
  });

  it("what it does not read is null, never an error", () => {
    for (const latex of ["\\text{Find } x", "5 \\mathrm{~km}", "\\int x \\, dx", "f'(x)", "\\frac{", "x \\in [0, 2\\pi)", "\\begin{cases} x \\end{cases}", ""]) expect(readLatex(latex)).toBeNull();
    expect(readLatex("\\text{ }x + 1")).not.toBeNull();
  });
});

describe("mathTree: looking at a tree", () => {
  it("letters, terms and degree", () => {
    expect(variablesOf(side("x + y = 10"))).toEqual(["x", "y"]);
    expect(variablesOf(side("x_{1} + \\theta"))).toEqual(["x_1", "theta"]);
    expect(termsOf(side("4x + 3y - 2x + y")).map((t) => t.neg)).toEqual([false, false, true, false]);
    expect(polyDegree(side("3(x - 1) - 3x"))).toBe(1);
    expect(polyDegree(side("(x + 1)(x - 2)"))).toBe(2);
    expect(polyDegree(side("x^{2}y"))).toBe(3);
    expect(polyDegree(side("\\frac{x}{2}"))).toBe(1);
    expect(polyDegree(side("\\frac{2}{x}"))).toBeNull();
    expect(polyDegree(side("2^{x}"))).toBeNull();
    expect(polyDegree(side("\\sqrt{x}"))).toBeNull();
    expect(polyDegree(side("\\sqrt{2}x"))).toBe(1);
  });

  it("f(x), angles and the imaginary unit", () => {
    expect(side("f(x) = 2x").t).toBe("fn");
    expect(side("g(f(x))").t).toBe("fn");
    expect(side("3(x + 2)").t).toBe("mul");
    expect(variablesOf(side("m\\angle A + 48 + 67 = 180"))).toEqual(["m", "∠A"]);
    expect(side("i").t).toBe("const");
  });
});
