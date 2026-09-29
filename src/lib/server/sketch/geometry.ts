/**
 * The illustrator's geometry, pure: 2-D affine matrices (SVG's `transform`), curves flattened to
 * polylines within a tolerance, Douglas–Peucker simplification, and clipping to the drawing's box.
 *
 * Every function here is total: a non-finite input gives an empty or identity result, never a
 * throw and never NaN on the way out, because the numbers come from a model's SVG.
 */

export type Pt = [number, number];

/** SVG's matrix(a b c d e f): x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Matrix = [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** `m` then `n` applied in SVG order: the result maps a point by `n` first, then `m` (m × n). */
export function multiply(m: Matrix, n: Matrix): Matrix {
  const [a, b, c, d, e, f] = m;
  const [A, B, C, D, E, F] = n;
  return [a * A + c * B, b * A + d * B, a * C + c * D, b * C + d * D, a * E + c * F + e, b * E + d * F + f];
}

export function apply(m: Matrix, p: Pt): Pt {
  return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
}

/** How much the matrix scales lengths, at most (the larger singular value): for curve tolerances. */
export function maxScale(m: Matrix): number {
  const [a, b, c, d] = m;
  const s = a * a + b * b + c * c + d * d;
  const det = a * d - b * c;
  const disc = Math.sqrt(Math.max(0, s * s - 4 * det * det));
  return Math.sqrt(Math.max(0, (s + disc) / 2));
}

/** Its area factor (|det|): 0 flattens everything to a line, and then nothing is drawn. */
export function areaScale(m: Matrix): number {
  return Math.abs(m[0] * m[3] - m[1] * m[2]);
}

export function isFiniteMatrix(m: Matrix): boolean {
  return m.every(Number.isFinite);
}

const NUMBER_RE = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;

/** The numbers in an attribute ("10, 20 -5e1" → [10, 20, -50]); at most `max` of them. */
export function numbers(text: string, max = 64): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(NUMBER_RE)) {
    out.push(Number(m[0]));
    if (out.length >= max) break;
  }
  return out;
}

const deg = (a: number) => (a * Math.PI) / 180;

/**
 * SVG's `transform` list: translate, scale, rotate (about a point), skewX, skewY, matrix, applied
 * left to right as SVG composes them. Anything malformed or non-finite makes the whole list the
 * identity, as browsers treat an invalid transform.
 */
export function parseTransform(text: string | undefined): Matrix {
  if (!text) return IDENTITY;
  let m: Matrix = IDENTITY;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let found = false;
  for (const [, fn, args] of text.slice(0, 2000).matchAll(re)) {
    found = true;
    const n = numbers(args, 8);
    let t: Matrix | null = null;
    switch (fn) {
      case "matrix":
        if (n.length === 6) t = [n[0], n[1], n[2], n[3], n[4], n[5]];
        break;
      case "translate":
        if (n.length === 1 || n.length === 2) t = [1, 0, 0, 1, n[0], n[1] ?? 0];
        break;
      case "scale":
        if (n.length === 1 || n.length === 2) t = [n[0], 0, 0, n[1] ?? n[0], 0, 0];
        break;
      case "rotate":
        if (n.length === 1 || n.length === 3) {
          const r = deg(n[0]);
          const cos = Math.cos(r);
          const sin = Math.sin(r);
          const [cx, cy] = [n[1] ?? 0, n[2] ?? 0];
          // translate(cx, cy) rotate(a) translate(-cx, -cy)
          t = [cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy];
        }
        break;
      case "skewX":
        if (n.length === 1) t = [1, 0, Math.tan(deg(n[0])), 1, 0, 0];
        break;
      case "skewY":
        if (n.length === 1) t = [1, Math.tan(deg(n[0])), 0, 1, 0, 0];
        break;
    }
    if (!t) return IDENTITY;
    m = multiply(m, t);
  }
  if (!found || !isFiniteMatrix(m)) return IDENTITY;
  return m;
}

// ------------------------------------------------------------------ curves

/** A curve is cut into at most this many pieces (a hostile control point cannot make millions). */
export const MAX_PIECES = 96;

/**
 * Pieces for a Bézier of degree n with control points `p` so that the polyline is within `tol` of
 * the curve (Wang's formula: n(n-1)/8 · max |second difference| / tol, square-rooted).
 */
function bezierPieces(p: readonly Pt[], tol: number): number {
  const deg = p.length - 1;
  let m = 0;
  for (let i = 0; i + 2 < p.length; i++) {
    const dx = p[i][0] - 2 * p[i + 1][0] + p[i + 2][0];
    const dy = p[i][1] - 2 * p[i + 1][1] + p[i + 2][1];
    m = Math.max(m, Math.hypot(dx, dy));
  }
  const n = Math.ceil(Math.sqrt((deg * (deg - 1) * m) / (8 * Math.max(tol, 1e-6))));
  return Number.isFinite(n) ? Math.min(MAX_PIECES, Math.max(1, n)) : MAX_PIECES;
}

/** The points after `p0` of a cubic Bézier, within `tol`. */
export function flattenCubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, tol: number): Pt[] {
  const n = bezierPieces([p0, p1, p2, p3], tol);
  const out: Pt[] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    out.push([a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]]);
  }
  return out;
}

/** The points after `p0` of a quadratic Bézier, within `tol`. */
export function flattenQuad(p0: Pt, p1: Pt, p2: Pt, tol: number): Pt[] {
  const n = bezierPieces([p0, p1, p2], tol);
  const out: Pt[] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]);
  }
  return out;
}

/** Pieces for an arc of `sweep` radians on radius `r`, each chord within `tol` of the arc. */
function arcPieces(r: number, sweep: number, tol: number): number {
  const step = r > tol ? 2 * Math.acos(Math.max(-1, Math.min(1, 1 - tol / r))) : Math.PI / 2;
  const n = Math.ceil(Math.abs(sweep) / Math.max(step, 1e-3));
  return Number.isFinite(n) ? Math.min(MAX_PIECES, Math.max(1, n)) : MAX_PIECES;
}

/** Points of an ellipse centred (cx, cy), radii rx, ry, rotated `phi`, from angle θ1 through Δθ (radians); the start point is left out. */
export function ellipseArcPoints(cx: number, cy: number, rx: number, ry: number, phi: number, theta1: number, dTheta: number, tol: number): Pt[] {
  const n = arcPieces(Math.max(rx, ry), dTheta, tol);
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const out: Pt[] = [];
  for (let i = 1; i <= n; i++) {
    const t = theta1 + (dTheta * i) / n;
    const x = rx * Math.cos(t);
    const y = ry * Math.sin(t);
    out.push([cx + cos * x - sin * y, cy + sin * x + cos * y]);
  }
  return out;
}

/**
 * SVG's endpoint arc (`A rx ry rotation large-arc sweep x y`) from `p0`, flattened: the
 * implementation notes' conversion to a centre (F.6.5), radii scaled up when too small (F.6.6),
 * a zero radius a straight line (F.6.2). The start point is left out.
 */
export function flattenArc(p0: Pt, rxIn: number, ryIn: number, rotationDeg: number, largeArc: boolean, sweep: boolean, p1: Pt, tol: number): Pt[] {
  if (p0[0] === p1[0] && p0[1] === p1[1]) return [];
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (!(rx > 0) || !(ry > 0) || !Number.isFinite(rx) || !Number.isFinite(ry)) return [p1];
  const phi = deg(Number.isFinite(rotationDeg) ? rotationDeg % 360 : 0);
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (p0[0] - p1[0]) / 2;
  const dy = (p0[1] - p1[1]) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  let k = den > 0 ? Math.sqrt(Math.max(0, num / den)) : 0;
  if (largeArc === sweep) k = -k;
  const cx1 = (k * rx * y1) / ry;
  const cy1 = (-k * ry * x1) / rx;
  const cx = cos * cx1 - sin * cy1 + (p0[0] + p1[0]) / 2;
  const cy = sin * cx1 + cos * cy1 + (p0[1] + p1[1]) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const theta1 = angle(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let dTheta = angle((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI;
  else if (sweep && dTheta < 0) dTheta += 2 * Math.PI;
  const pts = ellipseArcPoints(cx, cy, rx, ry, phi, theta1, dTheta, tol);
  if (!pts.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))) return [p1];
  // land exactly on the endpoint the path continues from
  if (pts.length) pts[pts.length - 1] = [p1[0], p1[1]];
  return pts;
}

// ------------------------------------------------------------------ polylines

export function bbox(points: readonly Pt[]): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of points) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

/** The length of the bounding box's diagonal: how big a stroke looks, the measure of a "detail". */
export function extent(points: readonly Pt[]): number {
  if (!points.length) return 0;
  const b = bbox(points);
  return Math.hypot(b.x1 - b.x0, b.y1 - b.y0);
}

function segDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Douglas–Peucker: the fewest points within `tol` of the polyline (its ends always kept). Iterative, so a long stroke cannot overflow the stack. */
export function simplify(points: readonly Pt[], tol: number): Pt[] {
  if (points.length <= 2 || !(tol > 0)) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    let worst = -1;
    let at = -1;
    for (let k = i + 1; k < j; k++) {
      const d = segDistance(points[k], points[i], points[j]);
      if (d > worst) {
        worst = d;
        at = k;
      }
    }
    if (at >= 0 && worst > tol) {
      keep[at] = 1;
      stack.push([i, at], [at, j]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

/** Consecutive points closer than `eps` merged (the first kept). */
export function dedupe(points: readonly Pt[], eps = 1e-6): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last[0] - p[0]) > eps || Math.abs(last[1] - p[1]) > eps) out.push(p);
  }
  return out;
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * An open polyline clipped to the rectangle: the runs inside it (Liang–Barsky on each segment), so
 * a line leaving the box and coming back is two strokes, not one drawn along the edge.
 */
export function clipPolyline(points: readonly Pt[], r: Rect): Pt[][] {
  const runs: Pt[][] = [];
  let run: Pt[] = [];
  const flush = () => {
    if (run.length >= 2) runs.push(run);
    run = [];
  };
  for (let i = 0; i + 1 < points.length; i++) {
    const seg = clipSegment(points[i], points[i + 1], r);
    if (!seg) {
      flush();
      continue;
    }
    const [a, b, aClipped, bClipped] = seg;
    if (aClipped || !run.length) {
      flush();
      run.push(a);
    }
    run.push(b);
    if (bClipped) flush();
  }
  flush();
  return runs;
}

/** A segment inside the rectangle, and whether each end was moved onto its edge; null when it misses. */
function clipSegment(a: Pt, b: Pt, r: Rect): [Pt, Pt, boolean, boolean] | null {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  let t0 = 0;
  let t1 = 1;
  const tests: Array<[number, number]> = [
    [-dx, a[0] - r.x0],
    [dx, r.x1 - a[0]],
    [-dy, a[1] - r.y0],
    [dy, r.y1 - a[1]],
  ];
  for (const [p, q] of tests) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > t1) return null;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return null;
      if (t < t1) t1 = t;
    }
  }
  const at = (t: number): Pt => [a[0] + t * dx, a[1] + t * dy];
  return [t0 > 0 ? at(t0) : a, t1 < 1 ? at(t1) : b, t0 > 0, t1 < 1];
}

/** A closed polygon clipped to the rectangle (Sutherland–Hodgman): still closed, so it can still be filled. */
export function clipPolygon(points: readonly Pt[], r: Rect): Pt[] {
  let out: Pt[] = points.slice();
  const edges: Array<[(p: Pt) => boolean, (a: Pt, b: Pt) => Pt]> = [
    [(p) => p[0] >= r.x0, (a, b) => lerpAt(a, b, (r.x0 - a[0]) / (b[0] - a[0]))],
    [(p) => p[0] <= r.x1, (a, b) => lerpAt(a, b, (r.x1 - a[0]) / (b[0] - a[0]))],
    [(p) => p[1] >= r.y0, (a, b) => lerpAt(a, b, (r.y0 - a[1]) / (b[1] - a[1]))],
    [(p) => p[1] <= r.y1, (a, b) => lerpAt(a, b, (r.y1 - a[1]) / (b[1] - a[1]))],
  ];
  for (const [inside, cross] of edges) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i];
      const prev = input[(i + input.length - 1) % input.length];
      if (inside(cur)) {
        if (!inside(prev)) out.push(cross(prev, cur));
        out.push(cur);
      } else if (inside(prev)) out.push(cross(prev, cur));
    }
    if (!out.length) return [];
  }
  return out;
}

function lerpAt(a: Pt, b: Pt, t: number): Pt {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

export function inside(p: Pt, r: Rect): boolean {
  return p[0] >= r.x0 && p[0] <= r.x1 && p[1] >= r.y0 && p[1] <= r.y1;
}
