import { describe, expect, it } from "vitest";
import { apply, clipPolygon, clipPolyline, ellipseArcPoints, flattenCubic, IDENTITY, MAX_PIECES, maxScale, parseTransform, simplify, type Pt } from "../geometry";

const close = (a: Pt, b: Pt, eps = 1e-9) => Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps;
const area = (pts: readonly Pt[]) => Math.abs(pts.reduce((n, [x, y], i) => n + x * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * y, 0)) / 2;

describe("transforms", () => {
  it("translate, scale, rotate (about a point), skewX/Y, matrix", () => {
    expect(parseTransform("translate(10)")).toEqual([1, 0, 0, 1, 10, 0]);
    expect(apply(parseTransform("translate(10,20) scale(2)"), [1, 1])).toEqual([12, 22]);
    expect(close(apply(parseTransform("rotate(90)"), [1, 0]), [0, 1])).toBe(true);
    expect(close(apply(parseTransform("rotate(90 10 10)"), [20, 10]), [10, 20])).toBe(true);
    expect(apply(parseTransform("matrix(1 0 0 1 5 5)"), [0, 0])).toEqual([5, 5]);
    expect(close(apply(parseTransform("skewX(45)"), [0, 10]), [10, 10])).toBe(true);
    expect(close(apply(parseTransform("skewY(45)"), [10, 0]), [10, 10])).toBe(true);
    expect(apply(parseTransform("scale(2, 3)"), [1, 1])).toEqual([2, 3]);
  });

  it("composed left to right, as SVG applies a list", () => {
    expect(apply(parseTransform("translate(10 0) scale(2)"), [1, 0])).toEqual([12, 0]);
    expect(apply(parseTransform("scale(2) translate(10 0)"), [1, 0])).toEqual([22, 0]);
    expect(apply(parseTransform("translate(10,0)rotate(90)"), [1, 0]).map((n) => Math.round(n))).toEqual([10, 1]);
  });

  it("anything malformed or non-finite is the identity (as browsers treat an invalid transform)", () => {
    for (const bad of ["translate(10, 20, 30)", "rotate(abc)", "scale(1e400)", "matrix(1 2 3)", "rotate(90 10)", "", undefined])
      expect(parseTransform(bad), String(bad)).toEqual(IDENTITY);
    expect(parseTransform("translate(10) bogus(3)")).toEqual([1, 0, 0, 1, 10, 0]);
  });

  it("maxScale: the largest stretch of a matrix", () => {
    expect(maxScale(parseTransform("scale(2, 3)"))).toBeCloseTo(3);
    expect(maxScale(parseTransform("rotate(33)"))).toBeCloseTo(1);
    expect(maxScale(parseTransform("rotate(30) scale(4)"))).toBeCloseTo(4);
  });
});

describe("curves", () => {
  it("a cubic is flattened within the tolerance, adaptively (a flat one in one piece)", () => {
    const p0: Pt = [0, 0];
    const [p1, p2, p3]: Pt[] = [[0, 300], [300, 300], [300, 0]];
    for (const tol of [2, 0.5]) {
      const pts = [p0, ...flattenCubic(p0, p1, p2, p3, tol)];
      for (let i = 0; i <= 200; i++) {
        const t = i / 200;
        const u = 1 - t;
        const q: Pt = [3 * u * t * t * 300 + t ** 3 * 300, 3 * u * u * t * 300 + 3 * u * t * t * 300];
        let d = Infinity;
        for (let k = 0; k + 1 < pts.length; k++) {
          const [a, b] = [pts[k], pts[k + 1]];
          const dx = b[0] - a[0];
          const dy = b[1] - a[1];
          const s = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / (dx * dx + dy * dy)));
          d = Math.min(d, Math.hypot(q[0] - a[0] - s * dx, q[1] - a[1] - s * dy));
        }
        expect(d).toBeLessThanOrEqual(tol * 1.01);
      }
    }
    expect(flattenCubic([0, 0], [10, 0], [20, 0], [30, 0], 1)).toEqual([[30, 0]]);
    expect(flattenCubic([0, 0], [0, 300], [300, 300], [300, 0], 2).length).toBeLessThan(flattenCubic([0, 0], [0, 300], [300, 300], [300, 0], 0.5).length);
  });

  it("an ellipse's chords stay within the tolerance, and never more than MAX_PIECES", () => {
    const pts = ellipseArcPoints(0, 0, 100, 100, 0, 0, 2 * Math.PI, 1);
    for (let i = 0; i + 1 < pts.length; i++) {
      const mid: Pt = [(pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2];
      expect(100 - Math.hypot(...mid)).toBeLessThanOrEqual(1.01);
    }
    expect(ellipseArcPoints(0, 0, 1e9, 1e9, 0, 0, 2 * Math.PI, 0.001).length).toBe(MAX_PIECES);
  });
});

describe("polylines", () => {
  it("Douglas–Peucker: collinear points go, corners stay, the ends always stay", () => {
    expect(simplify([[0, 0], [1, 0], [2, 0], [3, 0]], 0.5)).toEqual([[0, 0], [3, 0]]);
    expect(simplify([[0, 0], [5, 0.2], [10, 0], [10, 10]], 0.5)).toEqual([[0, 0], [10, 0], [10, 10]]);
    // a long zig-zag does not overflow the stack
    const zig: Pt[] = Array.from({ length: 200_000 }, (_, i) => [i, i % 2]);
    expect(simplify(zig, 5)).toEqual([[0, 0], [199_999, 1]]);
  });

  it("an open line is cut where it leaves the box, into runs (never drawn along the edge)", () => {
    const box = { x0: 0, y0: 0, x1: 100, y1: 100 };
    expect(clipPolyline([[-50, 50], [150, 50]], box)).toEqual([[[0, 50], [100, 50]]]);
    const runs = clipPolyline([[10, 10], [10, 150], [50, 150], [50, 10]], box);
    expect(runs).toEqual([[[10, 10], [10, 100]], [[50, 100], [50, 10]]]);
    expect(clipPolyline([[200, 200], [300, 300]], box)).toEqual([]);
    expect(clipPolyline([[10, 10], [20, 20], [30, 30]], box)).toEqual([[[10, 10], [20, 20], [30, 30]]]);
  });

  it("a filled polygon is clipped closed (Sutherland–Hodgman)", () => {
    const box = { x0: 0, y0: 0, x1: 100, y1: 100 };
    const clipped = clipPolygon([[50, 50], [150, 50], [150, 150], [50, 150]], box);
    expect(area(clipped)).toBeCloseTo(2500);
    expect(clipPolygon([[200, 200], [300, 200], [300, 300]], box)).toEqual([]);
  });
});
