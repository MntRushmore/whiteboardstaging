import { describe, expect, it } from "vitest";
import { askedLetters, planFigure, readFromReply, type FigurePlan } from "..";

/**
 * Facts → equations (`planFigure`), with no model and no engine: every configuration the figure
 * path knows, the lines it writes and the value it expects, and every way a read is refused.
 */

type Q = { id: string; what: "angle" | "length"; label?: string | null };
const A = (id: string, label: string | null = null): Q => ({ id, what: "angle", label });
const S = (id: string, label: string | null = null): Q => ({ id, what: "length", label });
const plan = (quantities: Q[], facts: unknown[], opts: { labels?: string[]; column?: string[] } = {}): FigurePlan =>
  planFigure(readFromReply({ quantities, facts }), opts);

function ok(p: FigurePlan): { lines: string[]; value: number; letter: string }[] {
  if (!p.ok) throw new Error(`refused: ${p.reason}`);
  return p.stages.map((s) => ({ lines: s.lines, value: s.value, letter: s.letter }));
}
function one(p: FigurePlan): { lines: string[]; value: number } {
  const stages = ok(p);
  expect(stages).toHaveLength(1);
  return { lines: stages[0].lines, value: stages[0].value };
}
function refused(p: FigurePlan): string {
  if (p.ok) throw new Error(`expected a refusal, got ${JSON.stringify(p.stages)}`);
  return p.reason;
}

describe("planFigure: angles of a triangle and on lines", () => {
  it("a triangle's angles: the unknown first, then what is given", () => {
    const s = one(plan([A("a", "40^{\\circ}"), A("b", "65°"), A("c", "x")], [{ type: "triangle", items: ["a", "b", "c"] }]));
    expect(s).toEqual({ lines: ["x + 40 + 65 = 180"], value: 75 });
  });

  it("the exterior angle equals the two remote interior angles, whichever is asked", () => {
    expect(one(plan([A("e", "x"), A("r1", "40"), A("r2", "65")], [{ type: "exterior_angle", items: ["e", "r1", "r2"] }]))).toEqual({ lines: ["x = 40 + 65"], value: 105 });
    expect(one(plan([A("e", "115"), A("r1", "x"), A("r2", "50")], [{ type: "exterior_angle", items: ["e", "r1", "r2"] }]))).toEqual({ lines: ["x + 50 = 115"], value: 65 });
  });

  it("a linear pair, and three angles on a straight line", () => {
    expect(one(plan([A("a", "65"), A("b", "x")], [{ type: "linear_pair", items: ["a", "b"] }]))).toEqual({ lines: ["x + 65 = 180"], value: 115 });
    expect(one(plan([A("a", "x"), A("b", "50"), A("c", "60")], [{ type: "straight_line", items: ["a", "b", "c"] }]))).toEqual({ lines: ["x + 50 + 60 = 180"], value: 70 });
  });

  it("vertical angles: a number, or another expression", () => {
    expect(one(plan([A("a", "2x + 10"), A("b", "70^{\\circ}")], [{ type: "vertical", items: ["a", "b"] }]))).toEqual({ lines: ["2x + 10 = 70"], value: 30 });
    expect(one(plan([A("a", "(2x+10)^{\\circ}"), A("b", "3 x-20")], [{ type: "vertically_opposite", items: ["a", "b"] }]))).toEqual({ lines: ["2x + 10 = 3x - 20"], value: 30 });
  });

  it("angles around a point, and the parts of a right angle", () => {
    expect(one(plan([A("a", "x"), A("b", "100"), A("c", "120")], [{ type: "around_point", items: ["a", "b", "c"] }]))).toEqual({ lines: ["x + 100 + 120 = 360"], value: 140 });
    expect(one(plan([A("a", "x"), A("b", "25")], [{ type: "complementary", items: ["a", "b"] }]))).toEqual({ lines: ["x + 25 = 90"], value: 65 });
  });

  it("an expression in the unknown in a triangle", () => {
    expect(one(plan([A("a", "2x"), A("b", "x"), A("c", "30")], [{ type: "triangle", items: ["a", "b", "c"] }]))).toEqual({ lines: ["2x + x + 30 = 180"], value: 50 });
    expect(one(plan([A("a", "3x - 5"), A("b", "2x + 15"), A("c", "50")], [{ type: "triangle", items: ["a", "b", "c"] }]))).toEqual({ lines: ["3x - 5 + 2x + 15 + 50 = 180"], value: 24 });
  });
});

describe("planFigure: parallel lines cut by a transversal", () => {
  it("corresponding, alternate interior and alternate exterior angles are equal", () => {
    expect(one(plan([A("a", "70°"), A("b", "x")], [{ type: "corresponding", items: ["a", "b"] }]))).toEqual({ lines: ["x = 70"], value: 70 });
    expect(one(plan([A("a", "x"), A("b", "55")], [{ type: "alternate_interior", items: ["a", "b"] }]))).toEqual({ lines: ["x = 55"], value: 55 });
    expect(one(plan([A("a", "3x - 20"), A("b", "100")], [{ type: "alternate_exterior", items: ["a", "b"] }]))).toEqual({ lines: ["3x - 20 = 100"], value: 40 });
  });

  it("co-interior (same-side interior) angles add to 180", () => {
    expect(one(plan([A("a", "x"), A("b", "70")], [{ type: "same_side_interior", items: ["a", "b"] }]))).toEqual({ lines: ["x + 70 = 180"], value: 110 });
    expect(one(plan([A("a", "2x + 20"), A("b", "3x - 40")], [{ type: "co_interior", items: ["a", "b"] }]))).toEqual({ lines: ["2x + 20 + 3x - 40 = 180"], value: 40 });
  });

  it("a chain through an unlabelled angle: corresponding, then a linear pair", () => {
    const s = one(plan([A("a", "70°"), A("u"), A("b", "x")], [{ type: "corresponding", items: ["a", "u"] }, { type: "straight_line", items: ["u", "b"] }]));
    expect(s).toEqual({ lines: ["x + 70 = 180"], value: 110 });
  });
});

describe("planFigure: isosceles, equilateral and right angles", () => {
  it("isosceles: the base angles are equal (apex given, or base given)", () => {
    expect(one(plan([A("apex", "40°"), A("b1", "x"), A("b2")], [{ type: "isosceles", items: ["apex", "b1", "b2"] }]))).toEqual({ lines: ["2x + 40 = 180"], value: 70 });
    expect(one(plan([A("apex", "x"), A("b1", "50"), A("b2")], [{ type: "isosceles", items: ["apex", "b1", "b2"] }]))).toEqual({ lines: ["x + 2(50) = 180"], value: 80 });
  });

  it("isosceles by tick marks on two sides: the sides are equal", () => {
    expect(one(plan([S("s1", "2x + 3"), S("s2", "11")], [{ type: "equal_sides", items: ["s1", "s2"] }]))).toEqual({ lines: ["2x + 3 = 11"], value: 4 });
  });

  it("equilateral: every angle is 60, every side the same", () => {
    expect(one(plan([A("a", "x"), A("b"), A("c")], [{ type: "equilateral", items: ["a", "b", "c"] }]))).toEqual({ lines: ["x = 60"], value: 60 });
    expect(one(plan([A("a", "2x + 10")], [{ type: "equilateral", items: ["a"] }]))).toEqual({ lines: ["2x + 10 = 60"], value: 25 });
    expect(one(plan([S("a", "2x + 1"), S("b", "7"), S("c")], [{ type: "equilateral_triangle", items: ["a", "b", "c"] }]))).toEqual({ lines: ["2x + 1 = 7"], value: 3 });
  });

  it("a right-angle mark is 90 in the triangle's sum", () => {
    const s = one(plan([A("a", "x"), A("b", "35"), A("r")], [{ type: "triangle", items: ["a", "b", "r"] }, { type: "right_angle", items: ["r"] }]));
    expect(s).toEqual({ lines: ["x + 35 + 90 = 180"], value: 55 });
    expect(one(plan([A("r", "x")], [{ type: "perpendicular", items: ["r"] }]))).toEqual({ lines: ["x = 90"], value: 90 });
  });

  it("a right triangle: Pythagoras for the hypotenuse or a leg", () => {
    expect(one(plan([S("a", "3"), S("b", "4"), S("c", "x")], [{ type: "right_triangle", items: ["a", "b", "c"] }]))).toEqual({ lines: ["x^{2} = 3^{2} + 4^{2}"], value: 5 });
    expect(one(plan([S("a", "5"), S("b", "x"), S("c", "13")], [{ type: "pythagoras", items: ["a", "b", "c"] }]))).toEqual({ lines: ["x^{2} + 5^{2} = 13^{2}"], value: 12 });
    const irrational = one(plan([S("a", "5 cm"), S("b", "7"), S("c", "x")], [{ type: "right_triangle", items: ["a", "b", "c"] }]));
    expect(irrational.lines).toEqual(["x^{2} = 5^{2} + 7^{2}"]);
    expect(irrational.value).toBeCloseTo(Math.sqrt(74), 9);
  });
});

describe("planFigure: polygons", () => {
  it("a pentagon's interior angles: the sum worked out first", () => {
    const s = one(plan([A("a", "x"), A("b", "100"), A("c", "120"), A("d", "110"), A("e", "95")], [{ type: "polygon", sides: 5, items: ["a", "b", "c", "d", "e"] }]));
    expect(s).toEqual({ lines: ["(5 - 2) \\cdot 180 = 540", "x + 100 + 120 + 110 + 95 = 540"], value: 115 });
  });

  it("a quadrilateral's angles make 360 (no sum line: it is well known)", () => {
    expect(one(plan([A("a", "x"), A("b", "90"), A("c", "90"), A("d", "110")], [{ type: "interior_angles", items: ["a", "b", "c", "d"] }]))).toEqual({ lines: ["x + 90 + 90 + 110 = 360"], value: 70 });
  });

  it("a regular polygon's interior and exterior angle", () => {
    expect(one(plan([A("a", "x")], [{ type: "regular_polygon", sides: 6, angle: "interior", items: ["a"] }]))).toEqual({ lines: ["(6 - 2) \\cdot 180 = 720", "6x = 720"], value: 120 });
    expect(one(plan([A("a", "x")], [{ type: "regular_polygon", sides: "8", angle: "exterior", items: ["a"] }]))).toEqual({ lines: ["8x = 360"], value: 45 });
  });

  it("a polygon's exterior angles make 360", () => {
    expect(one(plan([A("a", "x"), A("b", "100"), A("c", "80"), A("d", "90")], [{ type: "exterior_angles", items: ["a", "b", "c", "d"] }]))).toEqual({ lines: ["x + 100 + 80 + 90 = 360"], value: 90 });
  });
});

describe("planFigure: circles", () => {
  it("the central angle is twice the inscribed angle on the same arc", () => {
    expect(one(plan([A("i", "x"), A("c", "100°")], [{ type: "inscribed_central", items: ["i", "c"] }]))).toEqual({ lines: ["2x = 100"], value: 50 });
    expect(one(plan([A("i", "35"), A("c", "x")], [{ type: "inscribed_central", items: ["i", "c"] }]))).toEqual({ lines: ["x = 2(35)"], value: 70 });
    expect(one(plan([A("i", "2x + 10"), A("c", "100")], [{ type: "inscribed_central", items: ["i", "c"] }]))).toEqual({ lines: ["2(2x + 10) = 100"], value: 20 });
  });

  it("inscribed angles on the same arc are equal", () => {
    expect(one(plan([A("a", "x"), A("b", "40")], [{ type: "same_arc", items: ["a", "b"] }]))).toEqual({ lines: ["x = 40"], value: 40 });
  });

  it("a tangent meets the radius at 90°, in the triangle it makes", () => {
    const s = one(plan([A("a", "x"), A("b", "50"), A("t")], [{ type: "triangle", items: ["a", "b", "t"] }, { type: "tangent_radius", items: ["t"] }]));
    expect(s).toEqual({ lines: ["x + 50 + 90 = 180"], value: 40 });
  });

  it("the angle in a semicircle is 90°", () => {
    const s = one(plan([A("a", "x"), A("b", "35"), A("s")], [{ type: "triangle", items: ["a", "b", "s"] }, { type: "angle_in_semicircle", items: ["s"] }]));
    expect(s).toEqual({ lines: ["x + 35 + 90 = 180"], value: 55 });
  });

  it("a cyclic quadrilateral's opposite angles add to 180", () => {
    expect(one(plan([A("a", "x"), A("b", "95")], [{ type: "cyclic_opposite", items: ["a", "b"] }]))).toEqual({ lines: ["x + 95 = 180"], value: 85 });
  });
});

describe("planFigure: similar triangles and midsegments", () => {
  it("similar triangles: the unknown side over its match equals a known pair", () => {
    expect(one(plan([S("a", "x"), S("b", "6"), S("c", "8"), S("d", "12")], [{ type: "similar", items: [["a", "b"], ["c", "d"]] }]))).toEqual({ lines: ["\\frac{x}{6} = \\frac{8}{12}"], value: 4 });
    // the unknown in the second figure
    expect(one(plan([S("a", "4"), S("b", "x"), S("c", "6"), S("d", "9")], [{ type: "similar_triangles", items: [["a", "b"], ["c", "d"]] }]))).toEqual({ lines: ["\\frac{4}{x} = \\frac{6}{9}"], value: 6 });
  });

  it("a midsegment is half the side it is parallel to", () => {
    expect(one(plan([S("m", "x"), S("b", "18")], [{ type: "midsegment", items: ["m", "b"] }]))).toEqual({ lines: ["2x = 18"], value: 9 });
    expect(one(plan([S("m", "9"), S("b", "x")], [{ type: "midline", items: ["m", "b"] }]))).toEqual({ lines: ["x = 2(9)"], value: 18 });
  });
});

describe("planFigure: unknowns and chains", () => {
  it("an angle found on the way is written first (and only when the equation needs it)", () => {
    const s = one(
      plan(
        [A("x", "x"), A("u"), A("b", "50"), A("e", "70"), A("v"), A("w", "10")],
        [
          { type: "triangle", items: ["x", "u", "b"] },
          { type: "straight_line", items: ["u", "e"] },
          { type: "right_angle_parts", items: ["v", "w"] },
        ],
      ),
    );
    expect(s).toEqual({ lines: ["180 - 70 = 110", "x + 110 + 50 = 180"], value: 20 });
  });

  it("two unknowns: one stage each", () => {
    const stages = ok(plan([A("a", "70"), A("b", "x"), A("c", "y")], [{ type: "straight_line", items: ["a", "b"] }, { type: "vertical", items: ["a", "c"] }]));
    expect(stages).toEqual([
      { letter: "x", lines: ["x + 70 = 180"], value: 110 },
      { letter: "y", lines: ["y = 70"], value: 70 },
    ]);
  });

  it("a letter that needs another one solved first", () => {
    const stages = ok(plan([A("a", "70"), A("b", "x"), A("c", "y")], [{ type: "straight_line", items: ["b", "c"] }, { type: "straight_line", items: ["a", "b"] }]));
    expect(stages.map((s) => [s.letter, s.lines, s.value])).toEqual([
      ["x", ["x + 70 = 180"], 110],
      ["y", ["y + 110 = 180"], 70],
    ]);
  });

  it("a `?` label is solved as x, or as the letter a line asks for", () => {
    expect(one(plan([A("a", "65"), A("b", "?")], [{ type: "straight_line", items: ["a", "b"] }]))).toEqual({ lines: ["x + 65 = 180"], value: 115 });
    expect(one(plan([A("a", "65"), A("b", "\\text{?}")], [{ type: "straight_line", items: ["a", "b"] }], { column: ["y = ?"] }))).toEqual({ lines: ["y + 65 = 180"], value: 115 });
  });

  it("a Greek letter is kept", () => {
    expect(one(plan([A("a", "\\theta"), A("b", "50")], [{ type: "straight_line", items: ["a", "b"] }]))).toEqual({ lines: ["\\theta + 50 = 180"], value: 130 });
  });

  it("a line asking for one letter solves only that one", () => {
    const stages = ok(plan([A("a", "70"), A("b", "x"), A("c", "y")], [{ type: "straight_line", items: ["a", "b"] }, { type: "vertical", items: ["a", "c"] }], { column: ["y=?"] }));
    expect(stages).toEqual([{ letter: "y", lines: ["y = 70"], value: 70 }]);
  });

  it("a capital asked for on a line is the unknown; otherwise a capital is a vertex's name", () => {
    const facts = [{ type: "triangle", items: ["a", "b", "c"] }];
    expect(one(plan([A("a", "A"), A("b", "50"), A("c", "60")], facts, { column: ["m\\angle A = ?"] }))).toEqual({ lines: ["A + 50 + 60 = 180"], value: 70 });
    expect(refused(plan([A("a", "A"), A("b", "50"), A("c", "60")], facts))).toMatch(/nothing is asked/);
  });

  it("reads the lines that ask", () => {
    expect(askedLetters(["x = ?", "m\\angle B=?", "\\theta = ?", "y = 3", "\\angle C^{\\circ} = ?"])).toEqual(["x", "B", "\\theta", "C"]);
  });
});

describe("planFigure: the labels read on the figure", () => {
  const quantities = [A("a", "70°"), A("b", "x")];
  const facts = [{ type: "straight_line", items: ["a", "b"] }];

  it("the same labels (degree marks, spacing and braces aside): used", () => {
    expect(one(plan(quantities, facts, { labels: ["70^{\\circ}", "x", "A", "l"] })).value).toBe(110);
  });

  it("a number on the figure the read left out: refused", () => {
    expect(refused(plan(quantities, facts, { labels: ["70^{\\circ}", "x", "40^{\\circ}"] }))).toMatch(/"40\^\{\\circ\}" is not in the read/);
  });

  it("a label in the read that is not on the figure (a misread): refused", () => {
    expect(refused(plan([A("a", "76°"), A("b", "x")], facts, { labels: ["70^{\\circ}", "x"] }))).toMatch(/not in the read|not on the figure/);
  });

  it("a label the read uses in no fact: refused (every label that matters is used)", () => {
    expect(refused(plan([A("a", "70°"), A("b", "x"), A("c", "40°")], facts))).toMatch(/"40°" is in no fact/);
  });
});

describe("planFigure: refusals", () => {
  it("a triangle whose known angles already make 180 or more", () => {
    expect(refused(plan([A("a", "x"), A("b", "100"), A("c", "90")], [{ type: "triangle", items: ["a", "b", "c"] }]))).toMatch(/not a positive angle/);
    expect(refused(plan([A("a", "x"), A("b", "100"), A("c", "80")], [{ type: "triangle", items: ["a", "b", "c"] }]))).toMatch(/not a positive angle/);
  });

  it("facts that contradict each other", () => {
    const p = plan([A("a", "x"), A("b", "40"), A("c", "65")], [{ type: "triangle", items: ["a", "b", "c"] }, { type: "straight_line", items: ["a", "c"] }]);
    expect(refused(p)).toMatch(/inconsistent/);
  });

  it("a right-angle mark on an angle labelled something else", () => {
    expect(refused(plan([A("a", "80"), A("b", "x"), A("c", "30")], [{ type: "triangle", items: ["a", "b", "c"] }, { type: "right_angle", items: ["a"] }]))).toMatch(/inconsistent/);
  });

  it("an isosceles triangle whose base angles would be 90 or more", () => {
    expect(refused(plan([A("apex", "x"), A("b1", "95"), A("b2")], [{ type: "isosceles", items: ["apex", "b1", "b2"] }]))).toMatch(/not a positive angle|too big/);
  });

  it("a leg longer than the hypotenuse", () => {
    expect(refused(plan([S("a", "13"), S("b", "x"), S("c", "5")], [{ type: "right_triangle", items: ["a", "b", "c"] }]))).toMatch(/no fact ties/);
  });

  it("an angle too big for where it is", () => {
    expect(refused(plan([A("a", "x"), A("b", "2x")], [{ type: "straight_line", items: ["a", "b"] }, { type: "vertical", items: ["a", "b"] }]))).toBeTruthy();
    expect(refused(plan([A("a", "x"), A("b", "20")], [{ type: "exterior_angles", items: ["a", "b", "b2"] }]))).toMatch(/not a quantity/);
  });

  it("a fact naming a side where it needs angles, or naming a quantity that is not there", () => {
    expect(refused(plan([A("a", "x"), S("b", "5"), A("c", "60")], [{ type: "triangle", items: ["a", "b", "c"] }]))).toMatch(/names a side/);
    expect(refused(plan([A("a", "x"), A("b", "60")], [{ type: "straight_line", items: ["a", "zz"] }]))).toMatch(/not a quantity/);
    expect(refused(plan([S("a", "x"), S("b", "3"), S("c", "4")], [{ type: "straight_line", items: ["a", "b"] }]))).toMatch(/names a side/);
  });

  it("the same quantity twice in one fact", () => {
    expect(refused(plan([A("a", "x"), A("b", "60")], [{ type: "triangle", items: ["a", "a", "b"] }]))).toMatch(/twice/);
  });

  it("no facts, no unknown, an unreadable label, a letter the line asks for that is not there", () => {
    expect(refused(plan([A("a", "x")], []))).toMatch(/no facts/);
    expect(refused(plan([A("a", "70"), A("b", "110")], [{ type: "straight_line", items: ["a", "b"] }]))).toMatch(/nothing is asked/);
    expect(refused(plan([A("a", "x^{2}"), A("b", "110")], [{ type: "straight_line", items: ["a", "b"] }]))).toMatch(/not a value/);
    expect(refused(plan([A("a", "x"), A("b", "110")], [{ type: "straight_line", items: ["a", "b"] }], { column: ["z = ?"] }))).toMatch(/asks for z/);
  });

  it("an unknown no fact reaches", () => {
    expect(refused(plan([A("a", "x"), A("b"), A("c", "40")], [{ type: "triangle", items: ["a", "b", "c"] }]))).toMatch(/no fact ties/);
  });

  it("a polygon with the wrong number of angles", () => {
    expect(refused(plan([A("a", "x"), A("b", "90"), A("c", "90")], [{ type: "polygon", sides: 4, items: ["a", "b", "c"] }]))).toMatch(/4-sided polygon with 3/);
  });
});

describe("readFromReply: the model's reply, leniently", () => {
  it("takes synonyms, numbers as labels and empty labels; drops what does not validate", () => {
    const r = readFromReply({
      quantities: [
        { id: "a", what: "Angle", label: 70 },
        { id: "b", what: "angle", label: "" },
        { id: "c", what: "side", label: "x" },
        { id: "d", what: "colour" },
        { id: "a", what: "angle", label: "5" },
      ],
      facts: [
        { type: "Linear Pair", items: ["a", "b"] },
        { fact: "vertically-opposite", items: ["a", "b"] },
        { type: "polygon", items: ["a", "b", "c"] },
        { type: "regular_polygon", items: ["a"] },
        { type: "similar", items: [["a", "b"], ["c", "d"]] },
        { type: "triangle", items: ["a", "b"] },
        { type: "banana", items: ["a"] },
        "nonsense",
      ],
    });
    expect(r.quantities).toEqual([
      { id: "a", what: "angle", label: "70" },
      { id: "b", what: "angle", label: null },
      { id: "c", what: "length", label: "x" },
    ]);
    expect(r.droppedQuantities).toBe(2);
    expect(r.facts).toEqual([
      { type: "straight_line", items: ["a", "b"] },
      { type: "vertical", items: ["a", "b"] },
      { type: "polygon", items: ["a", "b", "c"], sides: 3 },
      { type: "similar", items: [["a", "b"], ["c", "d"]] },
    ]);
    expect(r.dropped).toBe(4);
  });
});
