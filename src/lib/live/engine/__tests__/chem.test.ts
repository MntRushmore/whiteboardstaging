import { describe, expect, it } from "vitest";
import { ELEMENT_COUNT, balance, integerNullspace, isBalanced, molarMass, parseEquation, parseFormula } from "../chem";

describe("chem: formulas", () => {
  it("has all 118 elements", () => {
    expect(ELEMENT_COUNT).toBe(118);
  });
  it("parses subscripts, parentheses, hydrates, charges and states", () => {
    expect(Object.fromEntries(parseFormula("Fe_2O_3")!.counts)).toEqual({ Fe: 2, O: 3 });
    expect(Object.fromEntries(parseFormula("Cu(OH)_2")!.counts)).toEqual({ Cu: 1, O: 2, H: 2 });
    expect(Object.fromEntries(parseFormula("CuSO_4 \\cdot 5H_2O")!.counts)).toEqual({ Cu: 1, S: 1, O: 9, H: 10 });
    expect(Object.fromEntries(parseFormula("Ca_3(PO_4)_2")!.counts)).toEqual({ Ca: 3, P: 2, O: 8 });
    expect(Object.fromEntries(parseFormula("C_6H_{12}O_6")!.counts)).toEqual({ C: 6, H: 12, O: 6 });
    expect(parseFormula("SO_4^{2-}")!.charge).toBe(-2);
    expect(parseFormula("NaCl(aq)")!.state).toBe("aq");
    expect(parseFormula("2H_2O")!.coefficient).toBe(2);
    expect(parseFormula("\\mathrm{CO}_2")!.counts.get("O")).toBe(2);
  });
  it("rejects non-formulas", () => {
    expect(parseFormula("xyz")).toBeNull();
    expect(parseFormula("2x")).toBeNull();
    expect(parseFormula("Xx")).toBeNull();
    expect(parseFormula("")).toBeNull();
  });
  it("computes molar masses", () => {
    expect(molarMass("H_2O")).toBeCloseTo(18.015, 2);
    expect(molarMass("CO_2")).toBeCloseTo(44.009, 2);
    expect(molarMass("NaCl")).toBeCloseTo(58.44, 2);
    expect(molarMass("C_6H_{12}O_6")).toBeCloseTo(180.156, 1);
  });
});

describe("chem: balancing", () => {
  it("Fe + O_2 -> Fe_2O_3 -> [4, 3, 2]", () => {
    const r = balance("Fe + O_2 \\rightarrow Fe_2O_3");
    expect(r?.coeffs).toEqual([4, 3, 2]);
    expect(r?.latex).toBe("4\\,\\mathrm{Fe} + 3\\,\\mathrm{O_{2}} \\rightarrow 2\\,\\mathrm{Fe_{2}O_{3}}");
    expect(r?.alreadyBalanced).toBe(false);
  });
  it("C_3H_8 + O_2 -> CO_2 + H_2O -> [1, 5, 3, 4]", () => {
    expect(balance("C_3H_8 + O_2 \\rightarrow CO_2 + H_2O")?.coeffs).toEqual([1, 5, 3, 4]);
  });
  it("Al + HCl -> AlCl_3 + H_2 -> [2, 6, 2, 3]", () => {
    expect(balance("Al + HCl -> AlCl3 + H2")?.coeffs).toEqual([2, 6, 2, 3]);
  });
  it("KMnO_4 + HCl -> KCl + MnCl_2 + H_2O + Cl_2 -> [2, 16, 2, 2, 8, 5]", () => {
    expect(balance("KMnO_4 + HCl \\rightarrow KCl + MnCl_2 + H_2O + Cl_2")?.coeffs).toEqual([2, 16, 2, 2, 8, 5]);
  });
  it("accepts plain-text arrows and unicode", () => {
    expect(balance("H2 + O2 → H2O")?.coeffs).toEqual([2, 1, 2]);
    expect(balance("N2 + H2 -> NH3")?.coeffs).toEqual([1, 3, 2]);
  });
  it("already balanced input passes", () => {
    const eq = parseEquation("2H_2 + O_2 \\rightarrow 2H_2O")!;
    expect(isBalanced(eq)).toBe(true);
    const r = balance("2H_2 + O_2 \\rightarrow 2H_2O");
    expect(r?.coeffs).toEqual([2, 1, 2]);
    expect(r?.alreadyBalanced).toBe(true);
    expect(isBalanced(parseEquation("4Fe + 3O_2 \\rightarrow 2Fe_2O_3")!)).toBe(true);
    expect(isBalanced(parseEquation("Fe + O_2 \\rightarrow Fe_2O_3")!)).toBe(false);
  });
  it("impossible equations return null", () => {
    expect(balance("H_2 \\rightarrow O_2")).toBeNull();
    expect(balance("NaCl \\rightarrow KCl")).toBeNull();
    expect(balance("x + y -> z")).toBeNull();
    expect(balance("Fe + O_2")).toBeNull();
  });
  it("balances charges in ionic equations", () => {
    expect(balance("Ag^+ + Cu -> Ag + Cu^{2+}")?.coeffs).toEqual([2, 1, 2, 1]);
  });
  it("integerNullspace scales to the smallest positive integers", () => {
    expect(integerNullspace([[1, 0, -2], [0, 2, -3]])).toEqual([4, 3, 2]);
    expect(integerNullspace([[1, -1], [1, 1]])).toBeNull();
  });
});
