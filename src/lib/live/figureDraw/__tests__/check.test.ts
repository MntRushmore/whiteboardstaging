import { describe, expect, it } from "vitest";
import { checkFigure, type FigureSpec } from "..";
import { degreesOf, lengthOf, nameLatex } from "../labels";
import { FIGURE_GALLERY } from "./gallery";

/** A 3-4-5 right triangle, right angle at B, every label true to the drawing. */
const triangle = (): FigureSpec => ({
  points: { A: { x: 0, y: 3 }, B: { x: 0, y: 0 }, C: { x: 4, y: 0 } },
  polygons: [{ vertices: ["A", "B", "C"] }],
  segments: [
    { from: "A", to: "B", label: "3" },
    { from: "B", to: "C", label: "4" },
    { from: "C", to: "A", label: "5" },
  ],
  angles: [{ at: "B", from: "A", to: "C", right: true }],
});

const one = (spec: FigureSpec): string => {
  const out = checkFigure(spec);
  expect(out, JSON.stringify(out)).toHaveLength(1);
  return out[0];
};

describe("checkFigure", () => {
  it("passes a sound figure, and every gallery figure", () => {
    expect(checkFigure(triangle())).toEqual([]);
    for (const g of FIGURE_GALLERY) expect(checkFigure(g.spec), g.title).toEqual([]);
  });

  it("names a point that is used but not defined, with what uses it", () => {
    const spec = triangle();
    spec.segments!.push({ from: "C", to: "D" });
    spec.angles!.push({ at: "D", from: "C", to: "A" });
    expect(one(spec)).toBe("Point D is used by segment CD, angle CDA but is not defined in points; add D with its x and y, or remove it from those.");
  });

  it("says when a circle goes through a point that is not defined", () => {
    const msg = one({ points: { O: { x: 0, y: 0 } }, circles: [{ center: "O", through: "P" }] });
    expect(msg).toContain("Point P is used by the circle centred at O (as the point it goes through) but is not defined in points");
  });

  it("finds a zero-length side, a side from a point to itself, and a line with no direction", () => {
    const spec: FigureSpec = {
      points: { A: { x: 1, y: 2 }, B: { x: 1, y: 2 }, C: { x: 4, y: 0 } },
      segments: [{ from: "A", to: "B" }, { from: "C", to: "C" }],
      lines: [{ through: ["A", "B"] }],
    };
    const out = checkFigure(spec);
    expect(out).toContain("Segment AB has zero length: A and B are both at (1, 2); move one of them.");
    expect(out).toContain("Segment CC joins C to itself; a segment needs two different points.");
    expect(out.some((m) => m.startsWith("The line AB has no direction"))).toBe(true);
    expect(out.some((m) => m.startsWith("Points A and B are at the same place"))).toBe(true);
  });

  it("finds a zero-length polygon side", () => {
    const out = checkFigure({ points: { A: { x: 0, y: 0 }, B: { x: 0, y: 0 }, C: { x: 1, y: 1 } }, polygons: [{ vertices: ["A", "B", "C"] }] });
    expect(out).toContain("Polygon ABC has a zero-length side AB: A and B are both at (0, 0); move one of them.");
  });

  it("finds degenerate angles: 0°, 180°, an arm of no length", () => {
    const points = { A: { x: -2, y: 0 }, B: { x: 0, y: 0 }, C: { x: 2, y: 0 }, D: { x: 3, y: 0 } };
    expect(one({ points, angles: [{ at: "B", from: "A", to: "C" }] })).toMatch(/^Angle ABC is a straight angle \(A, B and C are in a line\)/);
    expect(one({ points, angles: [{ at: "B", from: "C", to: "D" }] })).toMatch(/^Angle CBD is 0°/);
    expect(one({ points, angles: [{ at: "B", from: "B", to: "C" }] })).toMatch(/^Angle BBC has no size/);
  });

  it("refuses a right-angle mark more than 3° from 90°, allows one within", () => {
    const at = (deg: number): FigureSpec => ({
      points: { A: { x: 4, y: 0 }, B: { x: 0, y: 0 }, C: { x: 4 * Math.cos((deg * Math.PI) / 180), y: 4 * Math.sin((deg * Math.PI) / 180) } },
      angles: [{ at: "B", from: "A", to: "C", right: true }],
    });
    expect(one(at(72))).toBe("Angle ABC is marked as a right angle but is drawn 72°; move the points so it is 90° (within 3°), or drop right.");
    expect(checkFigure(at(92))).toEqual([]);
  });

  it("compares numeric side labels with the drawn lengths", () => {
    const spec: FigureSpec = {
      points: { A: { x: 0, y: 0 }, B: { x: 3, y: 0 }, C: { x: 3, y: 6.3 } },
      segments: [
        { from: "A", to: "B", label: "3" },
        { from: "B", to: "C", label: "4" },
      ],
    };
    expect(one(spec)).toBe(
      "AB is labelled 3 and BC 4, but BC is drawn 2.1 times AB (it should be 1.33 times); move the points so the lengths match the labels.",
    );
    // within 10 %: fine; a letter or an expression is not a length
    spec.points.C.y = 4.3;
    expect(checkFigure(spec)).toEqual([]);
    spec.segments![1].label = "2x + 1";
    spec.points.C.y = 9;
    expect(checkFigure(spec)).toEqual([]);
  });

  it("blames the one side that disagrees, not the ones that agree", () => {
    const out = checkFigure({
      points: { A: { x: 0, y: 3 }, B: { x: 0, y: 0 }, C: { x: 4, y: 0 } },
      segments: [
        { from: "A", to: "B", label: "3" },
        { from: "B", to: "C", label: "4" },
        { from: "C", to: "A", label: "9" },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/^AB is labelled 3 and CA 9, but CA is drawn 1.67 times AB \(it should be 3 times\)/);
  });

  it("compares an angle's degree label with the drawn angle, beyond 5°", () => {
    const spec: FigureSpec = {
      points: { A: { x: 4, y: 0 }, B: { x: 0, y: 0 }, C: { x: 4 * Math.cos(0.9076), y: 4 * Math.sin(0.9076) } },
      angles: [{ at: "B", from: "A", to: "C", label: "70^{\\circ}" }],
    };
    expect(one(spec)).toBe("Angle ABC is labelled 70° but is drawn 52°; move the points so it measures 70° (within 5°).");
    spec.angles![0].label = "55°";
    expect(checkFigure(spec)).toEqual([]);
    // a bare number names the angle; it is not a size
    spec.angles![0].label = "1";
    expect(checkFigure(spec)).toEqual([]);
    spec.angles![0].label = "250^{\\circ}";
    expect(one(spec)).toMatch(/labelled 250°, but an angle mark shows the smaller angle \(52° here\)/);
  });

  it("checks equal ticks, equal arcs and parallel arrows against the drawing", () => {
    const out = checkFigure({
      points: { A: { x: 0, y: 0 }, B: { x: 4, y: 0 }, C: { x: 1, y: 3 }, D: { x: 5, y: 3.8 } },
      segments: [
        { from: "A", to: "B", ticks: 1, arrows: 1 },
        { from: "A", to: "C", ticks: 1 },
        { from: "C", to: "D", arrows: 1 },
      ],
      angles: [
        { at: "A", from: "B", to: "C", arcs: 2 },
        { at: "B", from: "C", to: "A", arcs: 2 },
      ],
    });
    expect(out.some((m) => m.startsWith("AC and AB are marked equal (1 tick each), but AB is drawn 1.26 times AC"))).toBe(true);
    expect(out.some((m) => /^Angles .* are marked equal \(2 arcs each\), but are drawn/.test(m))).toBe(true);
    expect(out.some((m) => m.startsWith("AB and CD are marked parallel (1 arrow each), but are drawn 11.31° apart"))).toBe(true);
  });

  it("refuses a label the hand cannot write, and a label that is a word", () => {
    const spec = triangle();
    spec.segments![0].label = "\\foo";
    spec.segments![1].label = "base";
    const out = checkFigure(spec);
    expect(out).toContain('The label "\\foo" on segment AB cannot be written by hand (\\foo); use short maths such as 3, x, 2x + 1 or 70^{\\circ}.');
    expect(out).toContain('The label "base" on segment BC is a word ("base"); the board carries no words — use a letter or a number, such as b, h or 3.');
    // maths words and units are fine
    spec.segments![0].label = "3";
    spec.segments![1].label = "4\\,\\mathrm{cm}";
    expect(checkFigure(spec)).toEqual([]);
  });

  it("says when there is too much to read", () => {
    const points: FigureSpec["points"] = {};
    for (let i = 0; i < 24; i++) points[`P${i}`] = { x: Math.cos(i / 4), y: Math.sin(i / 4) * 2 + i * 0.1 };
    expect(one({ points })).toBe("The figure has 24 points; at most 20 stay readable — leave out points nothing needs.");

    // 16 names + 16 side labels
    const ring: FigureSpec["points"] = {};
    const names = Array.from({ length: 16 }, (_, i) => `P${i}`);
    names.forEach((n, i) => (ring[n] = { x: 5 * Math.cos((i * Math.PI) / 8), y: 5 * Math.sin((i * Math.PI) / 8) }));
    const sides = names.map((n, i) => ({ from: n, to: names[(i + 1) % 16], label: "a" }));
    expect(one({ points: ring, segments: sides })).toBe(
      "The figure has 32 names and labels; at most 28 fit legibly — hide names nothing refers to (label: false) or drop labels.",
    );
  });

  it("reports a spec that does not fit the schema instead of throwing", () => {
    expect(checkFigure(null as unknown as FigureSpec)[0]).toMatch(/^The figure needs points/);
    const out = checkFigure({ points: { "A-1": { x: 0, y: 0 } } } as FigureSpec);
    expect(out.some((m) => m.startsWith("The spec does not fit the figure schema at points"))).toBe(true);
  });

  it("is fast: the whole gallery in a few milliseconds each", () => {
    const t0 = performance.now();
    for (let k = 0; k < 5; k++) for (const g of FIGURE_GALLERY) checkFigure(g.spec);
    expect((performance.now() - t0) / (5 * FIGURE_GALLERY.length)).toBeLessThan(20);
  });
});

describe("figure label text", () => {
  it("reads lengths, degrees and names", () => {
    expect(lengthOf("3")).toBe(3);
    expect(lengthOf("4.5")).toBe(4.5);
    expect(lengthOf("3\\sqrt{2}")).toBeCloseTo(4.2426, 3);
    expect(lengthOf("\\frac{5}{2}")).toBe(2.5);
    expect(lengthOf("6\\,\\mathrm{cm}")).toBe(6);
    expect(lengthOf("6 cm")).toBe(6);
    expect(lengthOf("x")).toBeNull();
    expect(lengthOf("2x + 1")).toBeNull();
    expect(degreesOf("70^{\\circ}")).toBe(70);
    expect(degreesOf("70°")).toBe(70);
    expect(degreesOf("70")).toBeNull();
    expect(degreesOf("(2x + 10)^{\\circ}")).toBeNull();
    expect(nameLatex("P1")).toBe("P_{1}");
    expect(nameLatex("B'")).toBe("B'");
    expect(nameLatex("A")).toBe("A");
  });
});
