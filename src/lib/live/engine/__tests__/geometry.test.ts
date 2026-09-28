import { beforeAll, describe, expect, it } from "vitest";
import type { EngineVerdict, LiveEngine } from "@/lib/live/contracts";
import { planHandwriting } from "@/lib/live/handwriting";
import { analyzeColumn, localSolve } from "@/lib/live/localSolve";
import { getEngine } from "..";

/**
 * Geometry on the board (`geometry.ts`, `geometryEquation.ts`, `coordinates.ts`): the lines Solve
 * writes for what a geometry student writes beside a figure — exact, teacher-style, no words,
 * every one drawable by the tutor's hand — and the ticks and rings on the student's own lines.
 */
let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

const drawable = (steps: readonly string[]) => {
  const r = planHandwriting(steps, { size: 28, seed: 1 });
  return r.unsupported.length === 0 && r.plan !== null;
};

const solve = (lines: string[]) => localSolve(engine, lines, undefined, { canDraw: drawable }).steps;
const verdicts = (lines: string[]): EngineVerdict[] => analyzeColumn(engine, lines, "feedback").map((a) => a?.verdict ?? "none");

const WORKED: Array<[string, string[], string[]]> = [
  // angles
  ["a triangle's angles in degrees", ["x + 35^{\\circ} + 75^{\\circ} = 180^{\\circ}"], ["x + 110^{\\circ} = 180^{\\circ}", "x = 180^{\\circ} - 110^{\\circ}", "x = 70^{\\circ}"]],
  ["a named angle", ["\\angle A + 50^{\\circ} + 60^{\\circ} = 180^{\\circ}"], ["\\angle A + 110^{\\circ} = 180^{\\circ}", "\\angle A = 180^{\\circ} - 110^{\\circ}", "\\angle A = 70^{\\circ}"]],
  ["m∠ in the student's own style", ["m\\angle A + 50 + 60 = 180"], ["m\\angle A + 110 = 180", "m\\angle A = 180 - 110", "m\\angle A = 70"]],
  ["degree signs on the expressions: x is a number", ["(2x + 10)^{\\circ} + (3x - 5)^{\\circ} = 180^{\\circ}"], ["2x + 10 + 3x - 5 = 180", "5x + 5 = 180", "5x = 180 - 5", "5x = 175", "x = 35"]],
  ["an octagon's angle", ["\\frac{(8 - 2) \\cdot 180^{\\circ}}{8} ="], ["= \\frac{6 \\cdot 180^{\\circ}}{8}", "= \\frac{1080^{\\circ}}{8}", "= 135^{\\circ}"]],
  ["x° is x degrees: x a number", ["x^{\\circ}+40^{\\circ}=90^{\\circ}"], ["x + 40 = 90", "x = 90 - 40", "x = 50"]],
  ["the knowns substituted", ["\\angle A = 50^{\\circ}", "\\angle B = 60^{\\circ}", "\\angle A + \\angle B + \\angle C = 180^{\\circ}", "\\angle C = ?"], ["50^{\\circ} + 60^{\\circ} + \\angle C = 180^{\\circ}", "110^{\\circ} + \\angle C = 180^{\\circ}", "\\angle C = 180^{\\circ} - 110^{\\circ}", "\\angle C = 70^{\\circ}"]],
  ["angles defined in x", ["m\\angle 1 = 3x + 10", "m\\angle 2 = 5x - 30", "m\\angle 1 = m\\angle 2"], ["3x + 10 = 5x - 30", "5x - 3x = 10 + 30", "2x = 40", "x = 20"]],
  // right triangles
  ["Pythagoras: a length is positive", ["5^{2} + 12^{2} = c^{2}"], ["25 + 144 = c^{2}", "169 = c^{2}", "c = \\sqrt{169}", "c = 13"]],
  ["Pythagoras, the root simplified", ["6^{2} + 6^{2} = c^{2}"], ["36 + 36 = c^{2}", "72 = c^{2}", "c = \\sqrt{72}", "c = 6\\sqrt{2}"]],
  ["a missing leg", ["6^{2} + b^{2} = 10^{2}"], ["36 + b^{2} = 100", "b^{2} = 100 - 36", "b^{2} = 64", "b = \\sqrt{64}", "b = 8"]],
  ["the converse, true", ["5^{2} + 12^{2} = 13^{2}"], ["25 + 144 = 169", "169 = 169"]],
  ["the converse, false", ["6^{2} + 7^{2} = 9^{2}"], ["36 + 49 \\neq 81", "85 \\neq 81"]],
  ["45-45-90: the root out of the denominator", ["x\\sqrt{2} = 10"], ["x = \\frac{10}{\\sqrt{2}}", "x = \\frac{10\\sqrt{2}}{2}", "x = 5\\sqrt{2}"]],
  ["a side from a special angle", ["\\sin 30^{\\circ} = \\frac{x}{10}"], ["x = 10\\sin 30^{\\circ}", "x = 10 \\cdot \\frac{1}{2}", "x = 5"]],
  ["a side from any angle: exact, then ≈", ["\\tan 40^{\\circ} = \\frac{x}{12}"], ["x = 12\\tan 40^{\\circ}", "x \\approx 10.07"]],
  ["the unknown in the denominator", ["\\cos 60^{\\circ} = \\frac{8}{x}"], ["x\\cos 60^{\\circ} = 8", "x = \\frac{8}{\\cos 60^{\\circ}}", "x = 16"]],
  ["a rounded answer keeps its two places", ["\\tan 35^{\\circ}=\\frac{x}{20}"], ["x = 20\\tan 35^{\\circ}", "x \\approx 14.00"]],
  ["a volume in the unit of its radius", ["r = 3 \\mathrm{~m}", "V = \\frac{4}{3}\\pi r^{3}", "V = ?"], ["V = \\frac{4}{3}\\pi(3\\,\\mathrm{m})^{3}", "V = \\frac{4}{3}\\pi \\cdot 27\\,\\mathrm{m}^{3}", "V = 36\\pi\\,\\mathrm{m}^{3}"]],
  ["an angle from its ratio", ["\\tan \\theta = \\frac{3}{4}"], ["\\theta = \\tan^{-1}\\left(\\frac{3}{4}\\right)", "\\theta \\approx 36.87^{\\circ}"]],
  ["a triangle's angle at a special value", ["\\sin A = \\frac{1}{2}"], ["A = \\sin^{-1}\\left(\\frac{1}{2}\\right)", "A = 30^{\\circ}"]],
  ["law of sines: isolate, then evaluate", ["\\frac{a}{\\sin 30^{\\circ}} = \\frac{10}{\\sin 45^{\\circ}}"], ["a\\sin 45^{\\circ} = 10\\sin 30^{\\circ}", "a = \\frac{10\\sin 30^{\\circ}}{\\sin 45^{\\circ}}", "a = 5\\sqrt{2}"]],
  [
    "law of cosines: an angle",
    ["7^{2} = 5^{2} + 8^{2} - 2(5)(8)\\cos C"],
    ["49 = 25 + 64 - 80\\cos C", "49 = 89 - 80\\cos C", "80\\cos C = 89 - 49", "80\\cos C = 40", "\\cos C = \\frac{1}{2}", "C = \\cos^{-1}\\left(\\frac{1}{2}\\right)", "C = 60^{\\circ}"],
  ],
  ["law of cosines: a side", ["c^{2} = 5^{2} + 7^{2} - 2(5)(7)\\cos 60^{\\circ}"], ["c^{2} = 25 + 49 - 2(5)(7) \\cdot \\frac{1}{2}", "c^{2} = 25 + 49 - 35", "c^{2} = 39", "c = \\sqrt{39}"]],
  ["Heron's formula", ["A = \\sqrt{9(9 - 5)(9 - 6)(9 - 7)}"], ["A = \\sqrt{9(4)(3)(2)}", "A = \\sqrt{216}", "A = 6\\sqrt{6}"]],
  // measure
  ["a formula under its value", ["r = 5", "A = \\pi r^{2}", "A = ?"], ["A = \\pi(5)^{2}", "A = \\pi(25)", "A = 25\\pi"]],
  ["like terms in π", ["SA = 2\\pi r^{2} + 2\\pi r h", "r = 3", "h = 5", "SA = ?"], ["SA = 2\\pi(3)^{2} + 2\\pi(3)(5)", "SA = 2\\pi(9) + 2\\pi(3)(5)", "SA = 18\\pi + 30\\pi", "SA = 48\\pi"]],
  ["decimals: exact in π, then ≈", ["A = \\pi (2.5)^{2}"], ["A = \\pi(6.25)", "A = 6.25\\pi", "A \\approx 19.63"]],
  ["a radius from an area", ["A = \\pi r^{2}", "A = 50", "r = ?"], ["50 = \\pi r^{2}", "r^{2} = \\frac{50}{\\pi}", "r = \\sqrt{\\frac{50}{\\pi}}", "r \\approx 3.99"]],
  ["arc length in degrees", ["s = \\frac{60^{\\circ}}{360^{\\circ}} \\cdot 2\\pi (6)"], ["s = \\frac{1}{6} \\cdot 2\\pi(6)", "s = 2\\pi"]],
  ["units carried", ["r = 5 \\mathrm{~cm}", "A = \\pi r^{2}", "A = ?"], ["A = \\pi(5\\,\\mathrm{cm})^{2}", "A = \\pi \\cdot 25\\,\\mathrm{cm}^{2}", "A = 25\\pi\\,\\mathrm{cm}^{2}"]],
  [
    "segment addition, then the part asked for",
    ["AB = 2x + 3", "BC = 3x - 1", "AC = 22", "AB + BC = AC", "AB = ?"],
    ["(2x + 3) + (3x - 1) = 22", "5x + 2 = 22", "5x = 22 - 2", "5x = 20", "x = 4", "AB = 2(4) + 3", "AB = 8 + 3", "AB = 11"],
  ],
  // similarity
  ["a proportion, cross-multiplied", ["\\frac{x}{6} = \\frac{8}{12}"], ["12x = 6(8)", "12x = 48", "x = 4"]],
  ["named sides in proportion", ["\\frac{AB}{DE} = \\frac{BC}{EF}", "AB = 6", "DE = 9", "BC = 8", "EF = ?"], ["\\frac{6}{9} = \\frac{8}{EF}", "6EF = 9(8)", "6EF = 72", "EF = 12"]],
  ["the geometric mean", ["\\frac{4}{CD} = \\frac{CD}{9}"], ["CD^{2} = 4(9)", "CD^{2} = 36", "CD = \\sqrt{36}", "CD = 6"]],
  // coordinates
  ["distance between named points", ["A(-2, 3), \\ B(4, -5)", "AB ="], ["AB = \\sqrt{(4 - (-2))^{2} + (-5 - 3)^{2}}", "AB = \\sqrt{6^{2} + (-8)^{2}}", "AB = \\sqrt{36 + 64}", "AB = \\sqrt{100}", "AB = 10"]],
  ["midpoint", ["A(1, 2), \\ B(4, 6)", "M = ?"], ["M = \\left(\\frac{1 + 4}{2}, \\frac{2 + 6}{2}\\right)", "M = \\left(\\frac{5}{2}, \\frac{8}{2}\\right)", "M = \\left(\\frac{5}{2}, 4\\right)"]],
  ["the perpendicular slope", ["A(1, 2), \\ B(5, 5)", "m_{\\perp} = ?"], ["m = \\frac{5 - 2}{5 - 1}", "m = \\frac{3}{4}", "m_{\\perp} = -\\frac{4}{3}"]],
  ["a segment in a ratio", ["A(1, 2), \\ B(11, 12)", "AP : PB = 2 : 3", "P = ?"], ["P = \\left(1 + \\frac{2}{5}(11 - 1), 2 + \\frac{2}{5}(12 - 2)\\right)", "P = \\left(1 + \\frac{2}{5}(10), 2 + \\frac{2}{5}(10)\\right)", "P = (1 + 4, 2 + 4)", "P = (5, 6)"]],
  ["rotation", ["R_{90^{\\circ}}(2, 3)"], ["(x, y) \\to (-y, x)", "(2, 3) \\to (-3, 2)"]],
  ["translation", ["T_{\\langle 3, -2 \\rangle}(1, 4)"], ["(x, y) \\to (x + 3, y - 2)", "(1, 4) \\to (1 + 3, 4 - 2)", "(1, 4) \\to (4, 2)"]],
  ["reflection in x = 2", ["r_{x = 2}(5, 3)"], ["(x, y) \\to (4 - x, y)", "(5, 3) \\to (4 - 5, 3)", "(5, 3) \\to (-1, 3)"]],
  ["a mapping rule beside a point", ["(x, y) \\to (x + 3, y - 2)", "(1, 4)"], ["(x, y) \\to (x + 3, y - 2)", "(1, 4) \\to (1 + 3, 4 - 2)", "(1, 4) \\to (4, 2)"]],
  // circles
  ["completing the square", ["x^{2} + y^{2} - 6x + 4y - 12 = 0"], ["x^{2} - 6x + y^{2} + 4y = 12", "x^{2} - 6x + 9 + y^{2} + 4y + 4 = 12 + 9 + 4", "(x - 3)^{2} + (y + 2)^{2} = 25", "(h, k) = (3, -2), \\ r = 5"]],
  ["the standard form, asked", ["(x - 1)^{2} + (y + 2)^{2} = 20", "r = ?"], ["(h, k) = (1, -2), \\ r = \\sqrt{20}", "(h, k) = (1, -2), \\ r = 2\\sqrt{5}"]],
  ["the equation from the centre", ["h = 2", "k = -3", "r = 5", "(x - h)^{2} + (y - k)^{2} = r^{2}"], ["(x - 2)^{2} + (y + 3)^{2} = 5^{2}", "(x - 2)^{2} + (y + 3)^{2} = 25"]],
];

describe("geometry: what Solve writes", () => {
  it.each(WORKED)("%s", (_name, lines, want) => {
    const steps = solve(lines);
    expect(steps).toEqual(want);
    expect(drawable(steps)).toBe(true);
    for (const s of steps) expect(s).not.toMatch(/\\text|angle_|arc_|\\overline/);
  });
});

describe("geometry: what stays algebra's", () => {
  it("a plain quadratic keeps both roots", () => {
    expect(engine.solveLatex("x^{2} = 169")?.latex).toBe("x = \\pm 13");
    expect(engine.solveLatex("x^{2} - 9 = 0")?.latex).toBe("x = \\pm 3");
  });

  it("a trig equation in x is trigEquation's: a list over a turn, or nothing", () => {
    expect(engine.solveLatex("\\sin x = \\frac{1}{2}")?.latex).toBe("x = 30^{\\circ}, \\ x = 150^{\\circ}");
    expect(engine.solveLatex("\\sin x = \\frac{1}{3}")).toBeNull();
    expect(engine.solveLatex("\\cos\\theta = -\\frac{1}{2}")?.latex).toBe("\\theta = 120^{\\circ}, \\ \\theta = 240^{\\circ}");
  });

  it("a linear equation in plain numbers keeps its own steps", () => {
    expect(engine.solveLatex("3x + 10 = 5x - 20")?.steps).toEqual(["3x - 5x = -20 - 10", "-2x = -30", "x = 15"]);
  });

  it("a system of a line and a circle is solved, not read as a circle", () => {
    expect(solve(["y = x + 1", "x^{2} + y^{2} = 25"]).at(-1)).toBe("y = -3, \\ y = 4");
  });

  it("a named quantity it cannot solve is refused, never written with its internal name", () => {
    expect(engine.solveLatex("AB = 5")).toBeNull();
    expect(engine.solveFromLines!(["\\angle A + \\angle B = 90", "\\angle C = ?"])).toBeNull();
  });

  it("a non-special angle's value is the calculator's decimal, not a line of working", () => {
    expect(engine.simplifySteps!("\\sin 20^{\\circ}")).toBeNull();
  });
});

describe("geometry: checking the student's lines", () => {
  it("a length's positive root is right; its negative root is not", () => {
    expect(verdicts(["5^{2} + 12^{2} = c^{2}", "169 = c^{2}", "c = 13"])).toEqual(["none", "ok", "ok"]);
    expect(verdicts(["5^{2} + 12^{2} = c^{2}", "c = \\sqrt{169}"])).toEqual(["none", "ok"]);
    expect(verdicts(["5^{2} + 12^{2} = c^{2}", "c = -13"])).toEqual(["none", "mismatch"]);
    expect(verdicts(["c^{2} = 5^{2} + 7^{2} - 2(5)(7)\\cos 60^{\\circ}", "c^{2} = 39", "c = \\sqrt{39}"])).toEqual(["none", "ok", "ok"]);
  });

  it("an angle equation in degrees is compared as numbers of degrees", () => {
    expect(verdicts(["x + 35^{\\circ} + 75^{\\circ} = 180^{\\circ}", "x + 110^{\\circ} = 180^{\\circ}", "x = 70^{\\circ}"])).toEqual(["none", "ok", "ok"]);
    expect(verdicts(["x + 35^{\\circ} + 75^{\\circ} = 180^{\\circ}", "x = 80^{\\circ}"])).toEqual(["none", "mismatch"]);
    expect(verdicts(["\\angle A + 50^{\\circ} + 60^{\\circ} = 180^{\\circ}", "\\angle A = 70^{\\circ}"])).toEqual(["none", "ok"]);
    expect(verdicts(["(2x + 10)^{\\circ} + (3x - 5)^{\\circ} = 180^{\\circ}", "5x + 5 = 180", "x = 35"])).toEqual(["none", "ok", "ok"]);
  });

  it("one angle of a trig equation is a right answer", () => {
    expect(verdicts(["\\tan \\theta = \\frac{3}{4}", "\\theta = \\tan^{-1}\\left(\\frac{3}{4}\\right)", "\\theta \\approx 36.87^{\\circ}"])).toEqual(["none", "ok", "ok"]);
    expect(verdicts(["\\sin x = \\frac{1}{2}", "x = 30^{\\circ}"])).toEqual(["none", "ok"]);
    expect(verdicts(["\\sin x = \\frac{1}{2}", "x = 45^{\\circ}"])).toEqual(["none", "mismatch"]);
  });

  it("points are points, and a point worked out is ticked or ringed by value", () => {
    const read = (latex: string) => engine.analyzeLine(latex, { mode: "feedback" });
    expect(read("A(1, 2), \\ B(4, 6)").kind).toBe("point");
    expect(read("M = \\left(\\frac{5}{2}, 4\\right)").math).toBe("[2.5, 4]");
    expect(verdicts(["M = \\left(\\frac{1 + 4}{2}, \\frac{2 + 6}{2}\\right)", "M = \\left(\\frac{5}{2}, 4\\right)"])).toEqual(["none", "ok"]);
    expect(verdicts(["M = \\left(\\frac{1 + 4}{2}, \\frac{2 + 6}{2}\\right)", "M = (5, 8)"])).toEqual(["none", "mismatch"]);
  });

  it("transformation notation, a rule, a figure's name: read (never 'cannot read')", () => {
    for (const latex of ["R_{90^{\\circ}}(2, 3)", "T_{\\langle 3, -2 \\rangle}(1, 4)", "(x, y) \\to (x + 3, y - 2)", "(2, 3) \\to (-3, 2)", "\\odot O", "(h, k) = (3, -2), \\ r = 5"]) {
      expect(engine.analyzeLine(latex, { mode: "feedback" }).kind, latex).toBe("label");
    }
  });

  it("the answer to a trailing = with π in it is exact, as Solve writes it", () => {
    expect(engine.analyzeLine("\\pi(5)^{2} =", { mode: "answer" }).resultLatex).toBe("25\\pi");
    expect(engine.analyzeLine("\\sqrt{72} =", { mode: "answer" }).resultLatex).toBe("6\\sqrt{2}");
    // nothing exact to add: the decimal stays
    expect(engine.analyzeLine("\\sqrt{2} =", { mode: "answer" }).resultLatex).toBe("1.414");
    expect(engine.analyzeLine("2\\pi", { mode: "feedback" }).resultLatex).toBe("6.283");
  });

  it("a named quantity, its value and a trailing =: the value is answered, and worked", () => {
    const answer = (latex: string) => engine.analyzeLine(latex, { mode: "answer" }).resultLatex;
    expect(answer("A = \\pi(5)^{2} =")).toBe("25\\pi");
    expect(answer("V = \\frac{4}{3}\\pi(3)^{3} =")).toBe("36\\pi");
    expect(answer("SA = 2(3)(4) + 2(4)(5) + 2(3)(5) =")).toBe("94");
    expect(answer("c = \\sqrt{3^{2} + 4^{2}} =")).toBe("5");
    expect(answer("f(3) = 2(3) + 1 =")).toBe("7");
    expect(engine.simplifySteps!("A = \\pi(5)^{2} =")).toEqual(["= \\pi(25)", "= 25\\pi"]);
    // an equation, or a value with a letter still in it, is not a quantity to work out
    expect(engine.analyzeLine("2x + 3 = 11 =", { mode: "answer" }).kind).toBe("incomplete");
    expect(engine.analyzeLine("A = \\pi r^{2} =", { mode: "answer" }).kind).toBe("incomplete");
    expect(engine.simplifySteps!("2x + 3 = 11 =")).toBeNull();
  });

  it("facts about a figure are read, not ringed", () => {
    expect(engine.analyzeLine("\\triangle ABC \\sim \\triangle DEF", { mode: "feedback" }).kind).toBe("label");
    expect(engine.analyzeLine("AB \\parallel CD", { mode: "feedback" }).kind).toBe("label");
    expect(verdicts(["AB = 2x + 3", "BC = 3x - 1", "AB + BC = 22"])).toEqual(["none", "none", "none"]);
    // a check written as a question is not a claim
    expect(verdicts(["6^{2} + 7^{2} \\stackrel{?}{=} 9^{2}"])).toEqual(["none"]);
    expect(verdicts(["6^{2} + 7^{2} = 9^{2}"])).toEqual(["mismatch"]);
  });
});
