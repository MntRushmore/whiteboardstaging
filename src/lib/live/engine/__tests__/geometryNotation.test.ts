import { describe, expect, it } from "vitest";
import { geometryNameOf, isFigureStatement, markGeometry, nameLatex, segmentMode } from "../geometryNotation";
import { latexToMath, preprocessLatex, splitRelations } from "../latex";

/** The unknowns of a whole line, read the way the engine reads it (the line decides the names). */
function unknowns(line: string): string[] {
  const { sides } = splitRelations(line);
  return [...new Set(sides.flatMap((s) => latexToMath(s).variables))].sort();
}

describe("geometry notation: named angles, segments, arcs", () => {
  it("reads an angle's name as one quantity, with or without m", () => {
    expect(unknowns("\\angle A + \\angle B + \\angle C = 180^{\\circ}")).toEqual(["angle_A", "angle_B", "angle_C"]);
    expect(unknowns("m\\angle ABC = 2x + 10")).toEqual(["angle_ABC", "x"]);
    expect(unknowns("m \\angle 1 + m\\angle 2 = 180")).toEqual(["angle_1", "angle_2"]);
    expect(unknowns("\\measuredangle B = 40^{\\circ}")).toEqual(["angle_B"]);
    expect(unknowns("\\angle \\theta = 30")).toEqual(["angle_theta"]);
  });

  it("reads two capitals together as one length in a geometry line", () => {
    expect(unknowns("AB = 5")).toEqual(["AB"]);
    expect(unknowns("AB + BC = AC")).toEqual(["AB", "AC", "BC"]);
    expect(unknowns("AB = 3x - 1")).toEqual(["AB", "x"]);
    expect(unknowns("\\frac{AD}{DB} = \\frac{AE}{EC}")).toEqual(["AD", "AE", "DB", "EC"]);
    expect(unknowns("PA \\cdot PB = PC \\cdot PD")).toEqual(["PA", "PB", "PC", "PD"]);
    // a single capital beside them: the argument of a ratio, or a figure's own sides sharing a letter
    expect(unknowns("\\sin A = \\frac{BC}{AB}")).toEqual(["A", "AB", "BC"]);
    expect(unknowns("A = AB \\cdot BC")).toEqual(["A", "AB", "BC"]);
    expect(unknowns("\\overline{AB} = 7")).toEqual(["AB"]);
    expect(unknowns("m\\widehat{AC} = 80^{\\circ}")).toEqual(["arc_AC"]);
  });

  it("leaves physics, chemistry and lowercase products alone", () => {
    // `V = IR`: a single capital that is not an angle, and one pair: current times resistance
    expect(unknowns("V = IR")).toEqual(["I", "R", "V"]);
    expect(unknowns("P = IV")).toEqual(["I", "P", "V"]);
    // a capital glued to a lowercase letter
    expect(unknowns("PV = nRT")).toEqual(["P", "R", "T", "V", "n"]);
    expect(unknowns("ab = 12")).toEqual(["a", "b"]);
    // a formula with a subscript is chemistry
    expect(markGeometry("CO_{2} + H_{2}O = CO")).toBe("CO_{2} + H_{2}O = CO");
    // a side alone never decides (the sides of `V = IR` are read one at a time)
    expect(segmentMode("IR")).toBe(true);
    expect(markGeometry("IR")).toBe("IR");
    // a prefixed unit after a number stays a unit
    expect(markGeometry("F = 5 MN")).toBe("F = 5 MN");
  });

  it("is idempotent and reachable through preprocessLatex", () => {
    const once = preprocessLatex("AB + BC = AC");
    expect(once).toBe("\\overline{AB} + \\overline{BC} = \\overline{AC}");
    expect(preprocessLatex(once)).toBe(once);
    expect(preprocessLatex("m\\angle A = 40^{\\circ}")).toBe("\\angle A = 40^{\\circ}");
    expect(preprocessLatex("\\Delta ABC \\sim \\Delta DEF")).toBe("\\triangle ABC \\sim \\triangle DEF");
  });

  it("keeps a subscript's letters out of the unknowns", () => {
    expect(unknowns("m_{AB} = 2")).toEqual(["m_A_B"]);
    expect(unknowns("m_{\\perp} = -\\frac{1}{2}")).toEqual(["m_perp"]);
    expect(unknowns("v_{f} = v_{i} + at")).toEqual(["a", "t", "v_f", "v_i"]);
  });

  it("names a bare quantity, and writes it back", () => {
    expect(geometryNameOf("\\angle C")).toBe("angle_C");
    expect(geometryNameOf("m\\angle ABC")).toBe("angle_ABC");
    expect(geometryNameOf("\\overline{AB}")).toBe("AB");
    expect(geometryNameOf("\\widehat{AB}")).toBe("arc_AB");
    expect(geometryNameOf("2\\angle C")).toBeNull();
    expect(nameLatex("angle_ABC")).toBe("\\angle ABC");
    expect(nameLatex("angle_ABC", { measure: true })).toBe("m\\angle ABC");
    expect(nameLatex("arc_AC")).toBe("\\widehat{AC}");
    expect(nameLatex("x_1")).toBe("x_{1}");
    expect(nameLatex("theta")).toBe("\\theta");
  });

  it("reads statements about figures, not congruent lengths", () => {
    expect(isFigureStatement("\\triangle ABC \\cong \\triangle DEF")).toBe(true);
    expect(isFigureStatement("\\triangle ABC \\sim \\triangle DEF")).toBe(true);
    expect(isFigureStatement("AB \\parallel CD")).toBe(true);
    expect(isFigureStatement("\\overline{AB} \\perp \\overline{BC}")).toBe(true);
    expect(isFigureStatement("AB \\parallel CD, \\ AB \\perp BC")).toBe(true);
    // two equal lengths are an equation
    expect(isFigureStatement("\\overline{AB} \\cong \\overline{CD}")).toBe(false);
    expect(isFigureStatement("x \\sim 3")).toBe(false);
  });
});
