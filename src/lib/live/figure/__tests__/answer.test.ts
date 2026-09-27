import { beforeAll, describe, expect, it } from "vitest";
import type { LiveEngine } from "../../contracts";
import { getEngine } from "../../engine";
import { finalValue, numberValue, planFigure, readFromReply, renameLetter, sensibleSize, solveFallbackLines, solveStages, type FigureStage } from "..";

/**
 * The engine's side of the figure path: every stage the planner writes, solved by `localSolve` to
 * the planner's own value, and the model's free-form lines kept only when they solve to a sensible
 * size.
 */
let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

const stage = (lines: string[], value: number, letter = "x", kind: FigureStage["kind"] = "angle"): FigureStage => ({ letter, lines, value, kind });

describe("numberValue and finalValue", () => {
  it("reads the numbers the engine writes", () => {
    expect(numberValue("5")).toBe(5);
    expect(numberValue("-2.5")).toBe(-2.5);
    expect(numberValue("\\frac{170}{7}")).toBeCloseTo(170 / 7, 12);
    expect(numberValue("2\\sqrt{13}")).toBeCloseTo(2 * Math.sqrt(13), 12);
    expect(numberValue("\\frac{3\\sqrt{2}}{2}")).toBeCloseTo((3 * Math.SQRT2) / 2, 12);
    expect(numberValue("70^{\\circ}")).toBe(70);
    expect(numberValue("4\\pi")).toBeCloseTo(4 * Math.PI, 12);
    expect(numberValue("x + 1")).toBeNull();
    expect(numberValue("")).toBeNull();
  });

  it("the last line that gives the letter a number", () => {
    expect(finalValue(["x + 65 = 180", "x = 180 - 65", "x = 115"], "x")).toBe(115);
    expect(finalValue(["x^{2} = 74", "x = \\sqrt{74}"], "x")).toBeCloseTo(Math.sqrt(74), 12);
    expect(finalValue(["x = \\sqrt{74} \\approx 8.60"], "x")).toBeCloseTo(Math.sqrt(74), 12);
    expect(finalValue(["x \\approx 8.6"], "x")).toBe(8.6);
    expect(finalValue(["\\theta = 130"], "\\theta")).toBe(130);
    expect(finalValue(["y = 70", "x + 70 = 180"], "x")).toBeNull();
  });

  it("renames a letter only where it stands alone", () => {
    expect(renameLetter("x + 50 = 180", "x", "\\theta")).toBe("\\theta + 50 = 180");
    expect(renameLetter("x \\approx 8.6", "x", "y")).toBe("y \\approx 8.6");
    expect(renameLetter("\\frac{x}{2} = \\max", "x", "y")).toBe("\\frac{y}{2} = \\max");
    expect(renameLetter("\\theta + 2\\theta = 90", "\\theta", "x")).toBe("x + 2x = 90");
  });

  it("a sensible size: positive, an angle under a full turn", () => {
    expect(sensibleSize(70, "angle")).toBe(true);
    expect(sensibleSize(-10, "angle")).toBe(false);
    expect(sensibleSize(0, "length")).toBe(false);
    expect(sensibleSize(400, "angle")).toBe(false);
    expect(sensibleSize(400, "length")).toBe(true);
    expect(sensibleSize(Number.NaN, null)).toBe(false);
  });
});

describe("solveStages: the engine solves what the plan wrote", () => {
  it("one stage: the setup, then the engine's steps, and the value agrees", () => {
    const r = solveStages(engine, [stage(["x + 40 + 65 = 180"], 75)]);
    expect(r).toEqual({ ok: true, block: ["x + 40 + 65 = 180", "x + 105 = 180", "x = 75"], values: [{ letter: "x", value: 75 }] });
  });

  it("an equation that is already the answer is written as it is", () => {
    expect(solveStages(engine, [stage(["x = 70"], 70)])).toMatchObject({ ok: true, block: ["x = 70"] });
  });

  it("an irrational length: the engine's exact root", () => {
    const r = solveStages(engine, [stage(["x^{2} = 5^{2} + 7^{2}"], Math.sqrt(74), "x", "length")]);
    expect(r).toMatchObject({ ok: true, block: ["x^{2} = 5^{2} + 7^{2}", "x^{2} = 25 + 49", "x^{2} = 74", "x = \\sqrt{74}"] });
  });

  it("an angle found on the way, then the equation", () => {
    const r = solveStages(engine, [stage(["180 - 70 = 110", "x + 110 + 50 = 180"], 20)]);
    expect(r).toMatchObject({ ok: true, block: ["180 - 70 = 110", "x + 110 + 50 = 180", "x + 160 = 180", "x = 20"] });
  });

  it("a regular polygon: the sum, then the angle", () => {
    const r = solveStages(engine, [stage(["(6 - 2) \\cdot 180 = 720", "6x = 720"], 120)]);
    expect(r).toMatchObject({ ok: true, block: ["(6 - 2) \\cdot 180 = 720", "6x = 720", "x = 120"] });
  });

  it("a Greek unknown is solved through a stand-in and written back as itself", () => {
    const r = solveStages(engine, [stage(["\\theta + 50 + 60 = 180"], 70, "\\theta")]);
    expect(r).toMatchObject({ ok: true, block: ["\\theta + 50 + 60 = 180", "\\theta + 110 = 180", "\\theta = 70"] });
  });

  it("two stages, one after the other", () => {
    const r = solveStages(engine, [stage(["x + 70 = 180"], 110), stage(["y = 70"], 70, "y")]);
    expect(r).toMatchObject({ ok: true, block: ["x + 70 = 180", "x = 110", "y = 70"] });
  });

  it("refuses when the engine's answer is not the plan's", () => {
    expect(solveStages(engine, [stage(["x + 70 = 180"], 100)])).toMatchObject({ ok: false });
  });

  it("every configuration the planner knows, end to end through the engine", () => {
    const A = (id: string, label: string | null = null) => ({ id, what: "angle", label });
    const S = (id: string, label: string | null = null) => ({ id, what: "length", label });
    const cases: Array<[unknown[], unknown[], number]> = [
      [[A("a", "40"), A("b", "65"), A("c", "x")], [{ type: "triangle", items: ["a", "b", "c"] }], 75],
      [[A("e", "x"), A("r1", "40"), A("r2", "65")], [{ type: "exterior_angle", items: ["e", "r1", "r2"] }], 105],
      [[A("a", "2x + 10"), A("b", "70")], [{ type: "vertical", items: ["a", "b"] }], 30],
      [[A("a", "2x + 10"), A("b", "3x - 20")], [{ type: "vertical", items: ["a", "b"] }], 30],
      [[A("a", "x"), A("b", "70")], [{ type: "co_interior", items: ["a", "b"] }], 110],
      [[A("apex", "40"), A("b1", "x"), A("b2")], [{ type: "isosceles", items: ["apex", "b1", "b2"] }], 70],
      [[A("apex", "x"), A("b1", "50"), A("b2")], [{ type: "isosceles", items: ["apex", "b1", "b2"] }], 80],
      [[A("a", "x"), A("b", "100"), A("c", "120"), A("d", "110"), A("e", "95")], [{ type: "polygon", sides: 5, items: ["a", "b", "c", "d", "e"] }], 115],
      [[A("a", "x")], [{ type: "regular_polygon", sides: 5, items: ["a"] }], 108],
      [[A("i", "x"), A("c", "100")], [{ type: "inscribed_central", items: ["i", "c"] }], 50],
      [[A("i", "35"), A("c", "x")], [{ type: "inscribed_central", items: ["i", "c"] }], 70],
      [[S("a", "x"), S("b", "6"), S("c", "8"), S("d", "12")], [{ type: "similar", items: [["a", "b"], ["c", "d"]] }], 4],
      [[S("m", "x"), S("b", "18")], [{ type: "midsegment", items: ["m", "b"] }], 9],
      [[S("a", "5"), S("b", "x"), S("c", "13")], [{ type: "right_triangle", items: ["a", "b", "c"] }], 12],
      [[A("a", "x"), A("b", "35"), A("s")], [{ type: "triangle", items: ["a", "b", "s"] }, { type: "semicircle", items: ["s"] }], 55],
    ];
    for (const [quantities, facts, want] of cases) {
      const p = planFigure(readFromReply({ quantities, facts }));
      if (!p.ok) throw new Error(`${JSON.stringify(facts)}: ${p.reason}`);
      const r = solveStages(engine, p.stages);
      expect(r.ok, JSON.stringify(facts)).toBe(true);
      if (r.ok) expect(r.values[0].value, JSON.stringify(facts)).toBeCloseTo(want, 9);
    }
  });
});

describe("solveFallbackLines: the model's own lines, only when they solve to a sensible size", () => {
  it("solves them and writes them with the steps", () => {
    expect(solveFallbackLines(engine, ["x + 40 + 65 = 180"], { unknown: "x", kind: "angle" })).toMatchObject({ ok: true, block: ["x + 40 + 65 = 180", "x + 105 = 180", "x = 75"], values: [{ letter: "x", value: 75 }] });
    expect(solveFallbackLines(engine, ["x^{2} = 3^{2} + 4^{2}", "x = \\sqrt{3^{2} + 4^{2}}"], { unknown: "x" })).toMatchObject({ ok: true, values: [{ value: 5 }] });
  });

  it("refuses a negative angle, an angle of a full turn or more, and lines that give no number", () => {
    expect(solveFallbackLines(engine, ["x + 100 + 90 = 180"], { unknown: "x", kind: "angle" })).toMatchObject({ ok: false });
    expect(solveFallbackLines(engine, ["x = 2(200)"], { unknown: "x", kind: "angle" })).toMatchObject({ ok: false });
    expect(solveFallbackLines(engine, ["x + y = 180"], { unknown: "x" })).toMatchObject({ ok: false });
    expect(solveFallbackLines(engine, [], {})).toMatchObject({ ok: false });
  });
});
