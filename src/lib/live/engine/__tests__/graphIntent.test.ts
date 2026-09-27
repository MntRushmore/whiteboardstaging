import { beforeAll, describe, expect, it } from "vitest";
import type { GraphIntent, LiveEngine, NumberLineIntent, PlaneGraphIntent } from "../../contracts";
import { getEngine } from "../index";
import { niceLatex, pointLabel } from "../graphIntent";

/**
 * `graphFor`: what the tutor graphs for a column of work. The maths only — the sketch is
 * src/lib/live/graphing's job (graphing.test.ts).
 */
let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

const plane = (lines: string[]): PlaneGraphIntent => {
  const g = engine.graphFor!(lines);
  if (!g || g.kind !== "plane") throw new Error(`expected a plane graph for ${lines.join(" / ")}, got ${g?.kind ?? "null"}`);
  return g;
};
const line = (lines: string[]): NumberLineIntent => {
  const g = engine.graphFor!(lines);
  if (!g || g.kind !== "numberLine") throw new Error(`expected a number line for ${lines.join(" / ")}, got ${g?.kind ?? "null"}`);
  return g;
};
const labels = (g: GraphIntent) => (g.kind === "plane" ? g.points.map((p) => p.label).filter(Boolean) : []);

describe("graphFor — what gets a graph", () => {
  it.each([
    ["y = 2x + 1"],
    ["f(x) = x^{2} - 4"],
    ["g(t) = 3t - 2"],
    ["2x + 3y = 6"],
    ["y < 2x + 1"],
    ["2x + 3y \\ge 6"],
    ["x^{2} + y^{2} = 25"],
    ["(x - 1)^{2} + (y + 2)^{2} = 9"],
    ["y = \\frac{1}{x - 2}"],
    ["y = 2^{x} + 1"],
    ["y = \\log_{2}(x)"],
    ["y = \\sqrt{x + 4}"],
    ["y = |x - 2| + 1"],
  ])("%s is a plane graph", (latex) => {
    expect(plane([latex]).curves).toHaveLength(1);
  });

  it.each([["2x + 3 = 11"], ["x^{2} - 5x + 6 = 0"], ["3(x + 2) - x"], ["y = 9"], ["x = 4"], ["2x + 3 > 11"], ["\\text{hello there}"], ["2a + b = 8"]])(
    "%s gets nothing",
    (latex) => {
      expect(engine.graphFor!([latex])).toBeNull();
    },
  );

  it("a line's intercepts are its labelled points, exactly", () => {
    const g = plane(["y = 2x + 1"]);
    expect(labels(g)).toEqual(expect.arrayContaining(["(0, 1)", "(-\\frac{1}{2}, 0)"]));
    expect(plane(["2x + 3y = 6"]).points.map((p) => p.label)).toEqual(expect.arrayContaining(["(3, 0)", "(0, 2)"]));
  });

  it("a rewrite of the same relation is the same graph (same key); a different one is a system", () => {
    const a = plane(["2x + 3y = 6"]);
    const b = plane(["2x + 3y = 6", "3y = 6 - 2x", "y = 2 - \\frac{2}{3}x"]);
    expect(b.key).toBe(a.key);
    expect(b.curves).toHaveLength(1);
    const sys = plane(["y = 2x + 1", "y = -x + 4"]);
    expect(sys.curves).toHaveLength(2);
    expect(sys.key).not.toBe(plane(["y = 2x + 1"]).key);
  });

  it("a parabola: the vertex and both roots; an absolute value: its corner", () => {
    const g = plane(["y = x^{2} - 2x - 3"]);
    expect(g.points.find((p) => p.role === "vertex")).toMatchObject({ x: 1, y: -4, label: "(1, -4)" });
    expect(labels(g)).toEqual(expect.arrayContaining(["(-1, 0)", "(3, 0)"]));
    expect(labels(plane(["y = |x - 2| + 1"]))).toContain("(2, 1)");
  });

  it("an irrational point is a dot without coordinates, never an approximation", () => {
    const g = plane(["y = x^{2} - 2"]);
    const roots = g.points.filter((p) => p.role === "intercept" && p.y === 0);
    expect(roots).toHaveLength(2);
    for (const r of roots) expect(r.label).toBe("");
    expect(labels(g)).toContain("(0, -2)");
  });

  it("asymptotes: where a rational function blows up and where it levels off; a log's wall; an exponential's floor", () => {
    expect(plane(["y = \\frac{2x + 1}{x - 1}"]).asymptotes).toEqual(
      expect.arrayContaining([
        { axis: "vertical", at: 1 },
        { axis: "horizontal", at: 2 },
      ]),
    );
    expect(plane(["y = 2^{x} + 1"]).asymptotes).toEqual([{ axis: "horizontal", at: 1 }]);
    expect(plane(["y = \\log(x - 2)"]).asymptotes).toEqual([{ axis: "vertical", at: 2 }]);
    expect(plane(["y = \\frac{1}{x^{2}}"]).asymptotes).toEqual(expect.arrayContaining([{ axis: "vertical", at: 0 }]));
    expect(plane(["y = x^{2}"]).asymptotes).toEqual([]);
  });

  it("a square root starts at its end point", () => {
    expect(plane(["y = \\sqrt{x + 4}"]).points.find((p) => p.role === "endpoint")).toMatchObject({ x: -4, y: 0, label: "(-4, 0)" });
  });

  it("a system: the point where the lines cross, labelled; no intercepts to crowd it", () => {
    const g = plane(["x + y = 18", "x - y = 4"]);
    expect(g.points).toEqual([{ x: 11, y: 7, label: "(11, 7)", role: "intersection" }]);
    const circle = plane(["x^{2} + y^{2} = 25", "y = x + 1"]);
    expect(labels(circle)).toEqual(expect.arrayContaining(["(3, 4)", "(-4, -3)"]));
    // parallel lines never meet
    expect(plane(["y = 2x + 1", "y = 2x - 3"]).points).toEqual([]);
  });

  it("regions: the side is normalised to y op f(x), whichever way round it was written", () => {
    const below = plane(["y < 2x + 1"]).curves[0];
    expect(below).toMatchObject({ kind: "function", op: "<" });
    const above = plane(["2x + 3y \\ge 6"]).curves[0];
    expect(above).toMatchObject({ kind: "function", op: ">=" });
    const flipped = plane(["-y > 2x - 1"]).curves[0];
    expect(flipped).toMatchObject({ kind: "function", op: "<" });
    const inside = plane(["x^{2} + y^{2} < 9"]).curves[0];
    expect(inside).toMatchObject({ kind: "circle", op: "<", r: 3 });
  });

  it("a circle, in either form: its centre and radius", () => {
    expect(plane(["(x - 1)^{2} + (y + 2)^{2} = 9"]).curves[0]).toMatchObject({ kind: "circle", cx: 1, cy: -2, r: 3 });
    expect(plane(["x^{2} + y^{2} - 2x + 4y - 4 = 0"]).curves[0]).toMatchObject({ kind: "circle", cx: 1, cy: -2, r: 3 });
    expect(labels(plane(["(x - 1)^{2} + (y + 2)^{2} = 9"]))).toEqual(["(1, -2)"]);
  });

  it("substitution is not graphing: one relation with a value given or asked for", () => {
    expect(engine.graphFor!(["x + y = 18", "y = 9", "x = ?"])).toBeNull();
    expect(engine.graphFor!(["y = 2x + 1", "x = 3"])).toBeNull();
    // a system solved to its values is still a system
    expect(plane(["x + y = 18", "x - y = 4", "x = 11", "y = 7"]).curves).toHaveLength(2);
  });

  it("at most three relations, the latest ones", () => {
    const g = plane(["y = x", "y = x + 1", "y = x + 2", "y = x + 3"]);
    expect(g.curves.map((c) => c.latex)).toEqual(["y = x + 1", "y = x + 2", "y = x + 3"]);
  });
});

describe("graphFor — number lines for one-variable inequality answers", () => {
  it.each([
    ["x > 4", [{ from: 4, to: null, fromClosed: false, toClosed: false }]],
    ["x \\le -1", [{ from: null, to: -1, fromClosed: false, toClosed: true }]],
    ["3 < x", [{ from: 3, to: null, fromClosed: false, toClosed: false }]],
    ["-2 \\le x < 3", [{ from: -2, to: 3, fromClosed: true, toClosed: false }]],
    ["5 > x \\ge 1", [{ from: 1, to: 5, fromClosed: true, toClosed: false }]],
    [
      "x < 2, \\ x \\ge 3",
      [
        { from: null, to: 2, fromClosed: false, toClosed: false },
        { from: 3, to: null, fromClosed: true, toClosed: false },
      ],
    ],
    [
      "x \\neq 1",
      [
        { from: null, to: 1, fromClosed: false, toClosed: false },
        { from: 1, to: null, fromClosed: false, toClosed: false },
      ],
    ],
    ["-\\infty < x < \\infty", [{ from: null, to: null, fromClosed: false, toClosed: false }]],
  ])("%s", (latex, intervals) => {
    expect(line([latex]).intervals).toEqual(intervals);
  });

  it("keeps each end point's LaTeX as the answer wrote it", () => {
    expect(line(["x > \\frac{3}{2}"]).marks).toEqual([{ at: 1.5, latex: "\\frac{3}{2}" }]);
    const surd = line(["1 - \\sqrt{2} < x < 1 + \\sqrt{2}"]);
    expect(surd.marks.map((m) => m.latex)).toEqual(["1 - \\sqrt{2}", "1 + \\sqrt{2}"]);
  });

  it("the column's last answer counts; a later inequality that is not an answer withdraws it", () => {
    expect(line(["2x + 3 > 11", "2x > 8", "x > 4"]).key).toBe("n:x:(4,inf)");
    expect(line(["2x + 3 > 11", "2x > 8", "x > 4", "x = 5"]).key).toBe("n:x:(4,inf)");
    expect(engine.graphFor!(["x > 4", "3x - 1 > 5"])).toBeNull();
    expect(engine.graphFor!(["\\varnothing"])).toBeNull();
  });
});

describe("coordinates", () => {
  it("exact values only", () => {
    expect(niceLatex(0.5)).toBe("\\frac{1}{2}");
    expect(niceLatex(-0.25)).toBe("-\\frac{1}{4}");
    expect(niceLatex(3)).toBe("3");
    expect(niceLatex(Math.SQRT2)).toBeNull();
    expect(pointLabel(-0.5, 0)).toBe("(-\\frac{1}{2}, 0)");
    expect(pointLabel(Math.SQRT2, 0)).toBe("");
  });
});
