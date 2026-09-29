import { describe, expect, it } from "vitest";
import type { Pt } from "../geometry";
import { MAX_PATH_SEGMENTS, parsePathData } from "../pathData";

/** The polyline's closest approach to `p`. */
function distanceTo(points: readonly Pt[], p: Pt): number {
  let best = Infinity;
  for (let i = 0; i + 1 < points.length; i++) {
    const [a, b] = [points[i], points[i + 1]];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
    best = Math.min(best, Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)));
  }
  return best;
}
const last = (pts: readonly Pt[]) => pts[pts.length - 1];
const near = (a: Pt, b: Pt, eps = 1e-6) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= eps;

describe("path data: every command, absolute and relative", () => {
  it("M L H V Z, absolute and relative, and the implicit lines after a move", () => {
    expect(parsePathData("M 10 20 L 30 40", 0.5)).toEqual([{ points: [[10, 20], [30, 40]], closed: false }]);
    expect(parsePathData("M0 0 10 0 10 10", 0.5)[0].points).toEqual([[0, 0], [10, 0], [10, 10]]);
    expect(parsePathData("m5 5 10 0 0 10", 0.5)[0].points).toEqual([[5, 5], [15, 5], [15, 15]]);
    expect(parsePathData("M0 0 H10 V10 h-10 v-10 Z", 0.5)).toEqual([{ points: [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], closed: true }]);
  });

  it("several subpaths; a relative move after Z starts from the subpath's start; a line after Z opens a new subpath there", () => {
    const sp = parsePathData("M10 10 l10 0 l0 10 z m5 5 l1 1 Z L 0 0", 0.5);
    expect(sp).toHaveLength(3);
    expect(sp[0].closed).toBe(true);
    expect(sp[1].points).toEqual([[15, 15], [16, 16]]);
    expect(sp[2].points).toEqual([[15, 15], [0, 0]]);
  });

  it("C and S: on the curve within the tolerance, the reflected control point for S (and none without a C before it)", () => {
    const [c] = parsePathData("M0 0 C0 100 100 100 100 0", 0.5);
    expect(last(c.points)).toEqual([100, 0]);
    expect(distanceTo(c.points, [50, 75])).toBeLessThan(0.5); // B(½) of this cubic
    const [s] = parsePathData("M0 0 C 0 100 100 100 100 0 S 200 -100 200 0", 0.5);
    expect(distanceTo(s.points, [150, -75])).toBeLessThan(0.5); // (100,-100) is the reflection of (100,100)
    const [rel] = parsePathData("M0 0 c 0 100 100 100 100 0 s 100 -100 100 0", 0.5);
    expect(distanceTo(rel.points, [150, -75])).toBeLessThan(0.5);
    const [lone] = parsePathData("M0 0 S 100 100 100 0", 0.5); // first control = the current point
    expect(distanceTo(lone.points, [50, 37.5])).toBeLessThan(0.5);
  });

  it("Q and T: the quadratic, and T's reflected control point", () => {
    const [q] = parsePathData("M0 0 Q 50 100 100 0 T 200 0", 0.5);
    expect(distanceTo(q.points, [50, 50])).toBeLessThan(0.5);
    expect(distanceTo(q.points, [150, -50])).toBeLessThan(0.5);
    expect(last(q.points)).toEqual([200, 0]);
    const [t] = parsePathData("M0 0 q 50 100 100 0 t 100 0", 0.5);
    expect(distanceTo(t.points, [150, -50])).toBeLessThan(0.5);
  });

  it("A and a: the sweep flag's side, the large-arc flag, radii scaled up when too small, a zero radius a line", () => {
    const [up] = parsePathData("M0 0 A 50 50 0 0 1 100 0", 0.5);
    expect(near(last(up.points), [100, 0])).toBe(true);
    expect(distanceTo(up.points, [50, -50])).toBeLessThan(0.5); // sweep 1 goes over the top (y is down)
    const [down] = parsePathData("M0 0 A 50 50 0 0 0 100 0", 0.5);
    expect(distanceTo(down.points, [50, 50])).toBeLessThan(0.5);
    const [rel] = parsePathData("M10 10 a 50 50 0 0 1 100 0", 0.5);
    expect(near(last(rel.points), [110, 10])).toBe(true);
    expect(distanceTo(rel.points, [60, -40])).toBeLessThan(0.5);
    // radius 100 from (0,0) to (100,0): the small arc bulges ~13.4, the large one ~186.6
    const small = parsePathData("M0 0 A 100 100 0 0 1 100 0", 0.5)[0].points;
    const large = parsePathData("M0 0 A 100 100 0 1 1 100 0", 0.5)[0].points;
    expect(Math.min(...small.map((p) => p[1]))).toBeCloseTo(-13.4, 0);
    expect(Math.min(...large.map((p) => p[1]))).toBeCloseTo(-186.6, 0);
    const [scaled] = parsePathData("M0 0 A 10 10 0 0 1 100 0", 0.5);
    expect(distanceTo(scaled.points, [50, -50])).toBeLessThan(0.5);
    expect(parsePathData("M0 0 A 0 50 0 0 1 100 0", 0.5)[0].points).toEqual([[0, 0], [100, 0]]);
    // a rotated ellipse lands on its endpoint
    expect(near(last(parsePathData("M0 0 A 80 30 45 1 0 60 60", 0.5)[0].points), [60, 60])).toBe(true);
  });

  it("packed numbers and packed arc flags read as the grammar allows", () => {
    expect(parsePathData("M.5.5L-1e2-1e2", 0.5)[0].points).toEqual([[0.5, 0.5], [-100, -100]]);
    expect(parsePathData("M0,0L10,10,20,20", 0.5)[0].points).toEqual([[0, 0], [10, 10], [20, 20]]);
    const packed = parsePathData("M0 0a50 50 0 01100 0", 0.5)[0].points;
    const spaced = parsePathData("M0 0a50 50 0 0 1 100 0", 0.5)[0].points;
    expect(packed).toEqual(spaced);
  });

  it("stops at the first error and keeps what came before; numbers before any command are nothing", () => {
    expect(parsePathData("M0 0 L10 10 L20 x L30 30", 0.5)[0].points).toEqual([[0, 0], [10, 10]]);
    expect(parsePathData("10 10 L 5 5", 0.5)).toEqual([]);
    expect(parsePathData("M0 0 L10 10 Z 5 5", 0.5)).toHaveLength(1);
    expect(parsePathData("", 0.5)).toEqual([]);
    expect(parsePathData("M0 0 A 50 50 0 2 1 100 0", 0.5)[0].points).toEqual([[0, 0]]); // a flag must be 0 or 1
  });

  it("non-finite numbers end the path; a hostile path is bounded", () => {
    expect(parsePathData("M0 0 L1e400 0 L5 5", 0.5)[0].points).toEqual([[0, 0]]);
    expect(parsePathData("M0 0 LNaN 5", 0.5)[0].points).toEqual([[0, 0]]);
    const huge = "M0 0" + " L1 1 L0 0".repeat(50_000);
    const t0 = performance.now();
    const pts = parsePathData(huge, 0.5)[0].points;
    expect(pts.length).toBeLessThanOrEqual(MAX_PATH_SEGMENTS + 1);
    expect(performance.now() - t0).toBeLessThan(1000);
    // a curve with absurd control points is still a bounded number of pieces
    expect(parsePathData("M0 0 C 1e12 1e12 -1e12 -1e12 100 0", 0.5)[0].points.length).toBeLessThanOrEqual(97);
  });
});
