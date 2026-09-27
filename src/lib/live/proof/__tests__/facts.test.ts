import { describe, expect, it } from "vitest";
import { factLatex, parseStatement, statementLatex, type Fact } from "../facts";

const one = (latex: string): Fact => {
  const st = parseStatement(latex);
  expect(st.complete, latex).toBe(true);
  expect(st.facts, latex).toHaveLength(1);
  return st.facts[0];
};

describe("proof statements: Mathpix's LaTeX → facts", () => {
  it("congruent segments, however they are written", () => {
    for (const latex of [
      "\\overline{AB} \\cong \\overline{CD}",
      "\\overline{A B} \\cong \\overline{C D}",
      "AB \\cong CD",
      "A B=C D",
      "\\overline{AB} = \\overline{CD}",
      "\\overline{AB} \\simeq \\overline{CD}",
      "\\overline{A B} \\stackrel{\\sim}{=} \\overline{C D}",
      "\\overline{AB} ≅ \\overline{CD}",
    ])
      expect(one(latex), latex).toEqual({ t: "segCong", x: { k: "seg", a: "A", b: "B" }, y: { k: "seg", a: "C", b: "D" } });
  });

  it("angles by three letters, by the vertex, by a number; measures", () => {
    expect(one("\\angle ABD \\cong \\angle CDB")).toEqual({ t: "angCong", x: { k: "ang", a: "A", v: "B", c: "D" }, y: { k: "ang", a: "C", v: "D", c: "B" } });
    expect(one("\\angle A B D \\cong \\angle C D B")).toMatchObject({ t: "angCong" });
    expect(one("\\angle A \\cong \\angle C")).toEqual({ t: "angCong", x: { k: "angv", v: "A" }, y: { k: "angv", v: "C" } });
    expect(one("\\angle 1 \\cong \\angle 2")).toEqual({ t: "angCong", x: { k: "angn", n: "1" }, y: { k: "angn", n: "2" } });
    expect(one("m \\angle 1=m \\angle 2")).toMatchObject({ t: "angCong" });
    expect(one("\\measuredangle ABC \\cong \\measuredangle DEF")).toMatchObject({ t: "angCong" });
    expect(one("m \\angle A B C=90^{\\circ}")).toEqual({ t: "angMeasure", x: { k: "ang", a: "A", v: "B", c: "C" }, deg: 90 });
    expect(one("\\mathrm{m} \\angle B=90^{\\circ}")).toMatchObject({ t: "angMeasure", deg: 90 });
    expect(one("m\\angle 1 = 40^{o}")).toMatchObject({ t: "angMeasure", deg: 40 });
    expect(one("m \\angle 1+m \\angle 2=180^{\\circ}")).toMatchObject({ t: "supp" });
    expect(one("AB = 5")).toEqual({ t: "segLength", x: { k: "seg", a: "A", b: "B" }, len: 5 });
  });

  it("triangles keep their vertex order (the correspondence)", () => {
    expect(one("\\triangle ABD \\cong \\triangle CDB")).toEqual({ t: "triCong", x: ["A", "B", "D"], y: ["C", "D", "B"] });
    expect(one("\\triangle A B D \\cong \\triangle C D B")).toMatchObject({ t: "triCong", y: ["C", "D", "B"] });
    expect(one("\\Delta ABC \\cong \\Delta DEF")).toMatchObject({ t: "triCong" });
    expect(one("\\triangle ABC \\sim \\triangle DEF")).toMatchObject({ t: "triSim" });
  });

  it("parallel and perpendicular lines", () => {
    expect(one("\\overline{AB} \\parallel \\overline{CD}")).toEqual({ t: "parallel", x: { k: "line", a: "A", b: "B" }, y: { k: "line", a: "C", b: "D" } });
    expect(one("AB \\| CD")).toMatchObject({ t: "parallel" });
    expect(one("\\overleftrightarrow{AB} // \\overleftrightarrow{CD}")).toMatchObject({ t: "parallel" });
    expect(one("l \\parallel m")).toEqual({ t: "parallel", x: { k: "lname", n: "l" }, y: { k: "lname", n: "m" } });
    expect(one("\\overline{BD} \\perp \\overline{AC}")).toMatchObject({ t: "perp" });
  });

  it("statements in words: midpoints, bisectors, right angles, vertical angles", () => {
    expect(one("M \\text { is the midpoint of } \\overline{A B}")).toEqual({ t: "midpoint", m: "M", s: { k: "seg", a: "A", b: "B" } });
    expect(one("\\text{M is the midpoint of AB}")).toMatchObject({ t: "midpoint", m: "M" });
    expect(one("M \\text{ is midpt of } \\overline{AB}")).toMatchObject({ t: "midpoint" });
    expect(one("\\overline{BD} \\text { bisects } \\angle A B C")).toEqual({ t: "angBisect", ray: ["B", "D"], ang: { k: "ang", a: "A", v: "B", c: "C" } });
    expect(one("\\overrightarrow{BD} \\text{ bisects } \\angle ABC")).toMatchObject({ t: "angBisect", ray: ["B", "D"] });
    expect(one("\\overline{CD} \\text{ bisects } \\overline{AB} \\text{ at } M")).toMatchObject({ t: "segBisect", at: "M" });
    expect(one("\\angle B \\text{ is a right angle}")).toEqual({ t: "angMeasure", x: { k: "angv", v: "B" }, deg: 90 });
    expect(one("\\angle B \\text{ is a rt. } \\angle")).toMatchObject({ t: "angMeasure", deg: 90 });
    expect(one("\\angle 1 \\text{ and } \\angle 2 \\text{ are vertical angles}")).toMatchObject({ t: "vertical" });
    expect(one("\\triangle ABC \\text{ is isosceles}")).toMatchObject({ t: "isosceles" });
    const two = parseStatement("\\angle ADB \\text{ and } \\angle CDB \\text{ are right angles}");
    expect(two).toEqual({ complete: true, facts: [expect.objectContaining({ t: "angMeasure", deg: 90 }), expect.objectContaining({ t: "angMeasure", deg: 90 })] });
  });

  it("several facts on one line: a list, a chain, `and`", () => {
    expect(parseStatement("\\overline{AB} \\cong \\overline{CD}, \\ \\overline{AB} \\parallel \\overline{CD}").facts.map((f) => f.t)).toEqual(["segCong", "parallel"]);
    expect(parseStatement("\\overline{AB} \\cong \\overline{BC} \\cong \\overline{CD}").facts).toHaveLength(2);
    expect(parseStatement("\\overline{AB} \\cong \\overline{CD} \\text{ and } \\overline{AD} \\cong \\overline{CB}").facts).toHaveLength(2);
  });

  it("Mathpix's text mode (words outside, maths in \\( \\)), and two facts run together with no comma", () => {
    expect(one("\\( E \\) is the midpoint of \\( \\overline{A D} \\)")).toEqual({ t: "midpoint", m: "E", s: { k: "seg", a: "A", b: "D" } });
    expect(one("\\( \\angle B \\) is a right angle")).toMatchObject({ t: "angMeasure", deg: 90 });
    // a Given continued on the next line, clustered as one line
    const both = parseStatement("\\( E \\) is the midpoint of \\( \\overline{A D} E \\) is midpoint of \\( \\overline{B C}");
    expect(both.complete).toBe(true);
    expect(both.facts.map((f) => (f.t === "midpoint" ? `${f.m}:${f.s.a}${f.s.b}` : f.t))).toEqual(["E:AD", "E:BC"]);
  });

  it("what it cannot read makes the statement incomplete (so nothing is ringed on it)", () => {
    const partial = parseStatement("\\overline{AB} \\cong \\overline{CD}, \\ x^{2} + 3");
    expect(partial.complete).toBe(false);
    expect(partial.facts).toHaveLength(1);
    expect(parseStatement("A'B' \\cong AB").complete).toBe(false);
    expect(parseStatement("\\text{it looks the same}").complete).toBe(false);
    expect(parseStatement("").complete).toBe(false);
  });

  it("prints facts as the tutor writes them (maths only; a fact that needs words has no print)", () => {
    expect(factLatex(one("AB \\cong CD"))).toBe("\\overline{AB} \\cong \\overline{CD}");
    expect(factLatex(one("\\angle 1 \\cong \\angle 2"))).toBe("\\angle 1 \\cong \\angle 2");
    expect(factLatex(one("m \\angle ADB = 90^{\\circ}"))).toBe("m\\angle ADB = 90^{\\circ}");
    expect(factLatex(one("\\triangle ABD \\cong \\triangle CDB"))).toBe("\\triangle ABD \\cong \\triangle CDB");
    expect(factLatex(one("M \\text{ is the midpoint of } \\overline{AB}"))).toBeNull();
    expect(statementLatex(parseStatement("\\overline{AB} \\cong \\overline{CD}, \\ \\overline{AB} \\parallel \\overline{CD}").facts)).toBe("\\overline{AB} \\cong \\overline{CD}, \\ \\overline{AB} \\parallel \\overline{CD}");
    // and what it prints reads back as the same fact
    for (const latex of ["\\overline{AB} \\cong \\overline{CD}", "\\angle ABD \\cong \\angle CDB", "\\triangle ABD \\cong \\triangle CDB", "m\\angle ADB = 90^{\\circ}", "\\overline{AB} \\parallel \\overline{DC}"])
      expect(one(factLatex(one(latex))!)).toEqual(one(latex));
  });
});
