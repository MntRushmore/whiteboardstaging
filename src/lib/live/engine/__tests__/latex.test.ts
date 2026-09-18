import { describe, expect, it } from "vitest";
import { create, all } from "mathjs";
import { latexToMath, preprocessLatex, splitRelations, UnsupportedLatex } from "../latex";
import { valueToLatex } from "../format";

const math = create(all);
const isUnit = (name: string) => math.Unit.isValuelessUnit(name);

function value(latex: string): unknown {
  const t = latexToMath(latex, { isUnit });
  return math.evaluate(t.source);
}

function num(latex: string): number {
  const v = value(latex);
  if (typeof v === "number") return v;
  if (typeof v === "object" && v !== null && "toNumber" in (v as object)) return (v as { toNumber: () => number }).toNumber();
  throw new Error(`not a number: ${String(v)}`);
}

describe("latexToMath: LaTeX -> value", () => {
  const cases: Array<[string, number]> = [
    ["\\frac{1}{2} + \\frac{1}{3}", 5 / 6],
    ["\\frac{3}{4} \\div \\frac{1}{2}", 1.5],
    ["\\dfrac{2}{5}", 0.4],
    ["\\frac{2 \\cdot 6}{4}", 3],
    ["\\sqrt{16}", 4],
    ["\\sqrt[3]{27}", 3],
    ["\\sqrt[4]{16}", 2],
    ["\\sqrt 9", 3],
    ["\\frac{\\sqrt{3}}{2}", Math.sqrt(3) / 2],
    ["3 \\cdot 4", 12],
    ["2 \\times 3 + 4 \\times 5", 26],
    ["12 \\div 4", 3],
    ["10 - 2 \\cdot 3", 4],
    ["2^{10}", 1024],
    ["2 ^ 3", 8],
    ["\\left(\\frac{1}{2}\\right)^{2}", 0.25],
    ["\\left( 2 + 3 \\right) \\cdot 4", 20],
    ["(2+3)(4-1)", 15],
    ["2\\pi", 2 * Math.PI],
    ["\\cos \\pi", -1],
    ["\\sin \\frac{\\pi}{2}", 1],
    ["e^{2}", Math.E ** 2],
    ["\\sin 30^{\\circ}", 0.5],
    ["\\cos 60^\\circ", 0.5],
    ["\\tan(45^{\\circ})", 1],
    ["\\tan 45^\\circ", 1],
    ["\\sin^{-1} 0.5", Math.PI / 6],
    ["\\log 100", 2],
    ["\\log_{10} 1000", 3],
    ["\\log_{2} 8", 3],
    ["\\log_2 8", 3],
    ["\\ln e", 1],
    ["\\ln(e^2)", 2],
    ["|{-3}|", 3],
    ["\\left| -3 \\right|", 3],
    ["\\lvert -5 \\rvert", 5],
    ["50\\%", 0.5],
    ["5!", 120],
    ["7 \\bmod 3", 1],
    ["2,000 + 1", 2001],
    ["0.5 \\cdot 8", 4],
    ["3 \\times 4 \\times 5", 60],
    ["\\frac{1}{2} \\cdot \\frac{2}{3}", 1 / 3],
    ["\\frac{6}{2}", 3],
    ["2^10", 1024],
    ["\\text{ } 4 \\cdot 5", 20],
    ["\\left[ 2 + 1 \\right] \\cdot 2", 6],
    ["-\\frac{1}{2} + 1", 0.5],
    ["2(3+1)", 8],
    ["\\frac{10}{4} \\cdot 2", 5],
  ];
  it.each(cases)("%s", (latex, expected) => {
    expect(num(latex)).toBeCloseTo(expected, 9);
  });
  it("has at least 40 value cases", () => {
    expect(cases.length).toBeGreaterThanOrEqual(40);
  });
});

describe("latexToMath: units and constants", () => {
  it("multiplies units from \\mathrm groups", () => {
    const t = latexToMath("3.2 \\mathrm{~kg} \\cdot 9.8 \\mathrm{~m} / \\mathrm{s}^{2}", { isUnit });
    expect(t.hasUnits).toBe(true);
    expect(t.variables).toEqual([]);
    const v = math.evaluate(t.source) as { toNumber: (u: string) => number };
    expect(v.toNumber("N")).toBeCloseTo(31.36, 6);
  });
  it("promotes single-letter units next to numbers when the line carries units", () => {
    const t = latexToMath("3.2 kg \\cdot 9.8 m/s^2", { isUnit });
    expect(t.variables).toEqual([]);
    expect(t.source).toBe("3.2 kg * 9.8 m / s ^ 2");
  });
  it("keeps single letters as variables in algebra", () => {
    const t = latexToMath("2x + 3m", { isUnit });
    expect(t.variables).toEqual(["x", "m"]);
    expect(t.hasUnits).toBe(false);
  });
  it("reads m + cm as two units", () => {
    const t = latexToMath("m + cm", { isUnit });
    expect(t.units).toEqual(expect.arrayContaining(["m", "cm"]));
    expect(t.variables).toEqual([]);
  });
  it("converts with \\to", () => {
    const t = latexToMath("10 \\mathrm{~km} / \\mathrm{h} \\to \\mathrm{m} / \\mathrm{s}", { isUnit });
    const v = math.evaluate(t.source) as { toNumber: (u: string) => number };
    expect(v.toNumber("m/s")).toBeCloseTo(2.7778, 3);
  });
  it("maps 20^{\\circ}C to degC", () => {
    expect(preprocessLatex("20^{\\circ} C")).toContain("\\mathrm{degC}");
    const t = latexToMath("20^{\\circ}C", { isUnit });
    expect(t.units).toContain("degC");
  });
  it("marks degrees", () => {
    const t = latexToMath("\\sin 30^{\\circ}", { isUnit });
    expect(t.hasDegrees).toBe(true);
    expect(t.functions).toContain("sin");
  });
  it("recognizes constants and subscripted constants", () => {
    expect(latexToMath("2\\pi", { isUnit }).constants).toContain("pi");
    expect(latexToMath("k_B T", { isUnit }).constants).toContain("k_B");
    expect(latexToMath("\\hbar", { isUnit }).constants).toContain("hbar");
    expect(latexToMath("\\epsilon_0", { isUnit }).constants).toContain("epsilon_0");
    expect(latexToMath("N_A", { isUnit }).constants).toContain("N_A");
  });
  it("keeps subscripted identifiers together", () => {
    const t = latexToMath("v_0 t + \\frac{1}{2} a t^2", { isUnit });
    expect(t.variables).toEqual(["v_0", "t", "a"]);
  });
  it("handles greek letters and Delta", () => {
    expect(latexToMath("\\theta + \\alpha", { isUnit }).variables).toEqual(["theta", "alpha"]);
    expect(latexToMath("\\Delta x", { isUnit }).variables).toEqual(["Delta_x"]);
  });
  it("expands \\pm into two branches", () => {
    const t = latexToMath("3 \\pm 1", { isUnit });
    expect(t.hasPm).toBe(true);
    expect(t.branches.map((b) => math.evaluate(b))).toEqual([4, 2]);
  });
});

describe("latexToMath: calculus, plain mode and failures", () => {
  it("translates \\frac{d}{dx} to derivative()", () => {
    const t = latexToMath("\\frac{d}{dx} x^3", { isUnit });
    expect(t.source).toBe('derivative("x ^ 3", "x")');
    expect(String(math.evaluate(t.source))).toBe("3 * x ^ 2");
  });
  it("translates definite integrals to integral()", () => {
    const t = latexToMath("\\int_{0}^{1} x^2 \\, dx", { isUnit });
    expect(t.source).toBe('integral("x ^ 2", "x", 0, 1)');
  });
  it("plain mode keeps words together and treats h as hours", () => {
    const t = latexToMath("5 km/h to m/s", { isUnit, plain: true });
    expect(t.source).toBe("5 km / hour to m / s");
    const v = math.evaluate(t.source) as { toNumber: (u: string) => number };
    expect(v.toNumber("m/s")).toBeCloseTo(1.3889, 3);
  });
  it("plain mode handles unicode operators", () => {
    const t = latexToMath("3 × 4 ÷ 2", { isUnit, plain: true });
    expect(math.evaluate(t.source)).toBe(6);
  });
  it("throws UnsupportedLatex for constructs the LLM must handle", () => {
    for (const bad of ["\\sum_{i=1}^{n} i", "f'(x)", "\\frac{dy}{dx}", "\\begin{matrix} 1 \\end{matrix}", "\\lim_{x \\to 0} x"]) {
      expect(() => latexToMath(bad, { isUnit })).toThrow(UnsupportedLatex);
    }
  });
  it("splits relations at the top level only", () => {
    expect(splitRelations("2x + 3 = 11")).toEqual({ sides: ["2x + 3", "11"], ops: ["=="] });
    expect(splitRelations("x \\le 3")).toEqual({ sides: ["x", "3"], ops: ["<="] });
    expect(splitRelations("\\frac{a}{b} = c = d").sides).toEqual(["\\frac{a}{b}", "c", "d"]);
    expect(splitRelations("y = x^2 \\Rightarrow x = 1").ops).toEqual(["==", "=>", "=="]);
    expect(splitRelations("\\left( a = b \\right)").ops).toEqual([]);
  });
});

describe("format", () => {
  it("formats numbers with 4 significant figures and exact integers", () => {
    expect(valueToLatex(31.360000000000003)).toBe("31.36");
    expect(valueToLatex(2.2352)).toBe("2.235");
    expect(valueToLatex(1024)).toBe("1024");
    expect(valueToLatex(1 / 3)).toBe("0.3333");
    expect(valueToLatex(1 / 3, { preferFraction: true })).toBe("\\frac{1}{3}");
    expect(valueToLatex(6.02214076e23)).toBe("6.022 \\times 10^{23}");
  });
  it("formats units as \\,\\mathrm{...}", () => {
    expect(valueToLatex(math.evaluate("31.36 N"))).toBe("31.36\\,\\mathrm{N}");
    expect(valueToLatex(math.evaluate("2.2352 m/s"))).toBe("2.235\\,\\mathrm{m/s}");
    expect(valueToLatex(math.evaluate("30 deg"))).toBe("30^{\\circ}");
  });
  it("formats fractions and complex numbers", () => {
    expect(valueToLatex(math.fraction(3, 4))).toBe("\\frac{3}{4}");
    expect(valueToLatex(math.complex(1, -2))).toBe("1 - 2i");
  });
});
