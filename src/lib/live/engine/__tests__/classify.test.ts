import { describe, expect, it } from "vitest";
import { bracketsBalanced, functionInfo, incompleteInfo, isLabel, looksLikeProse, pointInfo, preClassify } from "../classify";

describe("classify: labels", () => {
  it.each(["1)", "2.", "(3)", "12:", "a)", "b.", "(c)", "x", "3", "42", "1a", "Q3", "Problem 2", "#4", "iv)"])("label %s", (s) => {
    expect(isLabel(s)).toBe(true);
    expect(preClassify(s).kind).toBe("label");
  });
  it.each(["2x + 3", "100", "3 + 4", "x = 4", "\\frac{1}{2}", "3.5"])("not a label %s", (s) => {
    expect(isLabel(s)).toBe(false);
  });
});

describe("classify: incomplete", () => {
  it.each(["2x + 3 =", "2x +", "3 \\cdot", "\\frac{1}{2} -", "x^", "2x + (3", "\\left( 2 + 3", "\\frac{1}{}", "|x", "= 4", "\\sqrt{"])("incomplete %s", (s) => {
    expect(incompleteInfo(s).incomplete).toBe(true);
    expect(preClassify(s).kind).toBe("incomplete");
  });
  it("records the trailing-equals left side", () => {
    const info = incompleteInfo("36 + 2 =");
    expect(info).toEqual({ incomplete: true, trailingEquals: true, lhs: "36 + 2" });
  });
  it("accepts balanced brackets", () => {
    expect(bracketsBalanced("\\left( \\frac{1}{2} \\right) + [3] + |x|")).toBe(true);
    expect(bracketsBalanced("(2 + 3))")).toBe(false);
    expect(incompleteInfo("-3 + 4").incomplete).toBe(false);
    expect(incompleteInfo("x \\ne 3").incomplete).toBe(false);
  });
});

describe("classify: functions, points, chem, prose", () => {
  it("detects y = f(x) and f(x) = ...", () => {
    expect(functionInfo("y = 2x + 1")).toEqual({ name: "y", param: "x", rhs: "2x + 1" });
    expect(functionInfo("f(x) = x^2 - 4")).toEqual({ name: "f", param: "x", rhs: "x^2 - 4" });
    expect(functionInfo("g\\left(t\\right) = \\sin t")).toEqual({ name: "g", param: "t", rhs: "\\sin t" });
    expect(functionInfo("y = 3")).toBeNull();
    expect(functionInfo("y = mx + b")?.param).toBe("x");
    expect(preClassify("y = x^2").kind).toBe("function");
  });
  it("detects points", () => {
    expect(pointInfo("(3, 4)")).toEqual({ x: "3", y: "4" });
    expect(pointInfo("\\left(-1, \\frac{1}{2}\\right)")).toEqual({ x: "-1", y: "\\frac{1}{2}" });
    expect(pointInfo("(3, 4, 5)")).toBeNull();
    expect(preClassify("(2, -3)").kind).toBe("point");
  });
  it("detects chemical equations only with an arrow and element formulas", () => {
    expect(preClassify("Fe + O_2 \\rightarrow Fe_2O_3").kind).toBe("chem");
    expect(preClassify("2H_2 + O_2 \\to 2H_2O").kind).toBe("chem");
    expect(preClassify("x + y \\rightarrow z").kind).not.toBe("chem");
    expect(preClassify("H_2O").kind).toBe("chemFormula");
    expect(preClassify("x_2 + 1").kind).toBeNull();
  });
  it("detects prose", () => {
    expect(looksLikeProse("\\text{solve for } x")).toBe(true);
    expect(looksLikeProse("Answer: 4")).toBe(true);
    expect(looksLikeProse("x = 2 \\text{ or } x = -2")).toBe(false);
    expect(looksLikeProse("3 \\mathrm{~kg}")).toBe(false);
    expect(looksLikeProse("\\sin x + \\cos x")).toBe(false);
    expect(preClassify("\\text{Find the area of the circle}").kind).toBe("text");
  });
  it("leaves ordinary math unclassified for the engine", () => {
    expect(preClassify("2x + 3 = 11").kind).toBeNull();
    expect(preClassify("\\frac{1}{2} + \\frac{1}{3}").kind).toBeNull();
    expect(preClassify("x \\le 3").kind).toBeNull();
    expect(preClassify("").kind).toBe("empty");
  });
});
