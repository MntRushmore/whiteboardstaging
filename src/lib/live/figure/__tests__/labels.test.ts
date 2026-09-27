import { describe, expect, it } from "vitest";
import { formatNumber, isValueLabel, labelKey, looksLikeUnknown, parseLabel } from "..";

const value = (raw: string, asked?: Set<string>) => {
  const p = parseLabel(raw, asked);
  if (p.kind !== "value") throw new Error(`${raw}: ${p.kind}`);
  return p.value;
};

describe("parseLabel", () => {
  it("numbers, with or without a degree mark or a unit", () => {
    expect(value("70^{\\circ}")).toEqual({ a: 0, b: 70, letter: null, latex: "70", degrees: true });
    expect(value("70°")).toMatchObject({ b: 70, degrees: true });
    expect(value("70^\\circ")).toMatchObject({ b: 70, degrees: true });
    expect(value("70^{0}")).toMatchObject({ b: 70, degrees: true });
    expect(value("4.5 cm")).toMatchObject({ b: 4.5, latex: "4.5", degrees: false });
    expect(value("5 \\text{ cm}")).toMatchObject({ b: 5, latex: "5" });
    expect(value("12")).toMatchObject({ b: 12, latex: "12" });
  });

  it("the unknown and expressions in it, printed tidily in the student's order", () => {
    expect(value("x")).toEqual({ a: 1, b: 0, letter: "x", latex: "x", degrees: false });
    expect(value("x^{\\circ}")).toMatchObject({ a: 1, letter: "x", degrees: true });
    expect(value("2 x+10^{\\circ}")).toEqual({ a: 2, b: 10, letter: "x", latex: "2x + 10", degrees: true });
    expect(value("(3x-5)^{\\circ}")).toEqual({ a: 3, b: -5, letter: "x", latex: "3x - 5", degrees: true });
    expect(value("\\left(3 x-5\\right)^{\\circ}")).toMatchObject({ a: 3, b: -5, latex: "3x - 5" });
    expect(value("\\frac{x}{2}")).toMatchObject({ a: 0.5, b: 0, latex: "\\frac{x}{2}" });
    expect(value("\\frac{1}{2}x + 4")).toMatchObject({ a: 0.5, b: 4, latex: "\\frac{1}{2}x + 4" });
    expect(value("2(x + 5)")).toMatchObject({ a: 2, b: 10, latex: "2(x + 5)" });
    expect(value("10 + 2x")).toMatchObject({ a: 2, b: 10, latex: "10 + 2x" });
    expect(value("-x + 20")).toMatchObject({ a: -1, b: 20, latex: "-x + 20" });
    expect(value("\\theta")).toMatchObject({ a: 1, letter: "\\theta", latex: "\\theta" });
    expect(value("2\\alpha")).toMatchObject({ a: 2, letter: "\\alpha", latex: "2\\alpha" });
    expect(value("y")).toMatchObject({ letter: "y" });
  });

  it("`?`, names, and what is not a value", () => {
    expect(parseLabel("?")).toEqual({ kind: "unknown", degrees: false });
    expect(parseLabel("?^{\\circ}")).toEqual({ kind: "unknown", degrees: true });
    expect(parseLabel("\\text{?}")).toEqual({ kind: "unknown", degrees: false });
    expect(parseLabel("A")).toEqual({ kind: "name", name: "A" });
    expect(parseLabel("\\text{B}")).toEqual({ kind: "name", name: "B" });
    expect(value("A", new Set(["A"]))).toMatchObject({ letter: "A" });
    expect(parseLabel("AB")).toEqual({ kind: "name", name: "AB" });
    expect(parseLabel("x^{2}").kind).toBe("unreadable");
    expect(parseLabel("2x + 3y").kind).toBe("unreadable");
    expect(parseLabel("x \\cdot x").kind).toBe("unreadable");
    expect(parseLabel("").kind).toBe("unreadable");
    expect(parseLabel("\\frac{1}{0}").kind).toBe("unreadable");
    expect(parseLabel("\\sqrt{2}").kind).toBe("unreadable");
  });
});

describe("labelKey, looksLikeUnknown, isValueLabel, formatNumber", () => {
  it("compares labels whatever their degree marks, spacing, braces and case", () => {
    expect(labelKey("70^{\\circ}")).toBe(labelKey("70°"));
    expect(labelKey("2 x+10")).toBe(labelKey("2x + 10^{\\circ}"));
    expect(labelKey("(3x-5)^{\\circ}")).toBe(labelKey("3x-5"));
    expect(labelKey("X")).toBe(labelKey("x"));
    expect(labelKey("70")).not.toBe(labelKey("76"));
  });

  it("an unknown to find: `?`, a letter that is not a line's name, an expression", () => {
    for (const l of ["x", "?", "2x + 10", "x^{\\circ}", "\\theta", "y", "a", "(3x-5)^{\\circ}"]) expect(looksLikeUnknown(l), l).toBe(true);
    for (const l of ["l", "m", "t", "70^{\\circ}", "A", "5", "AB", "k"]) expect(looksLikeUnknown(l), l).toBe(false);
  });

  it("a value label must be in the read; a name or a line's letter need not", () => {
    for (const l of ["70^{\\circ}", "x", "?", "2x + 10", "5"]) expect(isValueLabel(l), l).toBe(true);
    for (const l of ["A", "l", "m", "AB"]) expect(isValueLabel(l), l).toBe(false);
  });

  it("formats a number the way the tutor writes it", () => {
    expect(formatNumber(110)).toBe("110");
    expect(formatNumber(67.5)).toBe("67.5");
    expect(formatNumber(1 / 3)).toBe("0.3333");
    expect(formatNumber(109.99999999999)).toBe("110");
  });
});
