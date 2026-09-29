import { describe, expect, it } from "vitest";
import type { FigureSpec } from "..";
import { dist, resolveFigure } from "../resolve";

/** The resolved radius of the figure's first circle. */
const radiusOf = (spec: FigureSpec): number => resolveFigure(spec).fig.circles[0].r;

// The owner's circle problem as the model drew it on the live site: O the centre, R = O + (√6, 5),
// S a quarter turn round, both joined to O — and the circle given as a number (5) that is not
// OR = √31, so R and S floated outside it.
const S6 = Math.sqrt(6);
const OWNER: FigureSpec = {
  points: { O: { x: 0, y: 0 }, R: { x: S6, y: 5 }, S: { x: -5, y: S6 } },
  segments: [
    { from: "O", to: "R", label: "\\sqrt{31}" },
    { from: "O", to: "S", label: "\\sqrt{31}" },
    { from: "R", to: "S", label: "RS" },
  ],
  angles: [{ at: "O", from: "R", to: "S", right: true }],
  circles: [{ center: "O", radius: 5 }],
};

describe("a circle given by a number, with radii drawn to it", () => {
  it("two radii of one length are the radius: R and S end on the circle", () => {
    const { fig, problems } = resolveFigure(OWNER);
    expect(problems).toEqual([]);
    const c = fig.circles[0];
    expect(c.r).toBeCloseTo(Math.sqrt(31), 6);
    for (const name of ["R", "S"]) expect(dist(c.c, fig.byName.get(name)!)).toBeCloseTo(c.r, 6);
  });

  it("a single spoke a little off the number was meant to end on the circle", () => {
    const spec: FigureSpec = { points: { O: { x: 0, y: 0 }, A: { x: 5.3, y: 0 } }, segments: [{ from: "A", to: "O" }], circles: [{ center: "O", radius: 5 }] };
    expect(radiusOf(spec)).toBeCloseTo(5.3, 6);
  });

  it("a single spoke well off the number is a point off the circle on purpose (a tangent's external point)", () => {
    const spec: FigureSpec = { points: { O: { x: 0, y: 0 }, P: { x: 13, y: 0 } }, segments: [{ from: "O", to: "P", label: "13" }], circles: [{ center: "O", radius: 5 }] };
    expect(radiusOf(spec)).toBe(5);
  });

  it("spokes of different lengths (a radius and the line to an external point) leave the number alone", () => {
    const spec: FigureSpec = {
      points: { O: { x: 0, y: 0 }, T: { x: 0, y: 5 }, P: { x: 12, y: 5 } },
      segments: [{ from: "O", to: "T" }, { from: "O", to: "P" }, { from: "P", to: "T" }],
      circles: [{ center: "O", radius: 5 }],
    };
    expect(radiusOf(spec)).toBe(5);
  });

  it("no spokes, or a circle given by a point it goes through: unchanged", () => {
    expect(radiusOf({ points: { O: { x: 0, y: 0 }, A: { x: 9, y: 9 } }, segments: [{ from: "A", to: "A" }], circles: [{ center: "O", radius: 4 }] })).toBe(4);
    expect(radiusOf({ points: { O: { x: 0, y: 0 }, A: { x: 3, y: 4 } }, segments: [{ from: "O", to: "A" }], circles: [{ center: "O", through: "A" }] })).toBe(5);
  });
});
