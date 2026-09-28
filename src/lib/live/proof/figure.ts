/**
 * What a proof's figure shows, as the engine needs it. A figure READ is only what is drawn — each
 * labelled point roughly where it is, and each straight line through the labelled points on it (a
 * model reads it from the crop, `/api/live/proof` task `figure`; the scoreboard's corpus writes it
 * by hand). Everything else is DERIVED here, deterministically:
 *
 *  - the triangles (three points joined pairwise by drawn lines, not on one line);
 *  - vertical angles (two lines crossing at a point strictly inside both);
 *  - linear pairs (a ray from a point inside a line);
 *  - for every two lines cut by a transversal: alternate interior, alternate exterior and
 *    corresponding angle pairs (which side of the transversal from the points' positions);
 *  - which ray of a vertex a point lies on, so `\angle BAD` and `\angle BAC` are the same angle
 *    when D is on AC between A and C.
 *
 * Pure; the coordinates only need to be roughly right (sidedness, order along a line).
 */
import { ang, type AngRef, type Point, type TriRef } from "./facts";

export interface FigureRead {
  /** each labelled point, roughly where it is: x to the right, y down (any scale) */
  points: Record<string, readonly [number, number]>;
  /** each straight line drawn, through the labelled points on it in order: `ADC` */
  lines: readonly string[];
  /** a numbered (or Greek) angle mark → the angle it names, vertex in the middle: `{ "1": "ABD" }` */
  angles?: Record<string, string>;
}

export type PairKind = "altInterior" | "altExterior" | "corresponding" | "sameSide";

export interface AnglePair {
  kind: PairKind;
  x: AngRef;
  y: AngRef;
  /** the two lines cut (indices into `lines`) and the transversal */
  lines: readonly [number, number];
  transversal: number;
}

export interface FigureModel {
  points: ReadonlyMap<Point, { x: number; y: number }>;
  /** each drawn line's points, in order along it */
  lines: readonly Point[][];
  numbered: ReadonlyMap<string, AngRef>;
  triangles: readonly TriRef[];
  vertical: ReadonlyArray<readonly [AngRef, AngRef]>;
  linearPairs: ReadonlyArray<readonly [AngRef, AngRef]>;
  pairs: readonly AnglePair[];
}

const isPoint = (s: string): boolean => /^[A-Z]$/.test(s);

/** Index of a drawn line through both points, or -1. */
export function lineThrough(fig: Pick<FigureModel, "lines">, a: Point, b: Point): number {
  if (a === b) return -1;
  return fig.lines.findIndex((l) => l.includes(a) && l.includes(b));
}

/** Lines through `p`. */
function linesAt(lines: readonly Point[][], p: Point): number[] {
  const out: number[] = [];
  lines.forEach((l, i) => {
    if (l.includes(p)) out.push(i);
  });
  return out;
}

/** The points of line `l` on each side of `p` (nearest first). */
function sides(line: readonly Point[], p: Point): [Point[], Point[]] {
  const i = line.indexOf(p);
  return [line.slice(0, i).reverse(), line.slice(i + 1)];
}

/** Builds the model from a read: lines merged, ordered by position, relations derived. */
export function buildFigure(read: FigureRead): FigureModel {
  const points = new Map<Point, { x: number; y: number }>();
  for (const [name, xy] of Object.entries(read.points ?? {})) {
    if (!isPoint(name) || !Array.isArray(xy) || xy.length < 2) continue;
    const [x, y] = xy;
    if (Number.isFinite(x) && Number.isFinite(y)) points.set(name, { x, y });
  }
  // lines: known points only, distinct, merged when two share two points (the same line)
  let lines: Point[][] = [];
  for (const raw of read.lines ?? []) {
    const pts = [...new Set(raw.replace(/[^A-Z]/g, "").split(""))];
    if (pts.length < 2) continue;
    for (const p of pts) if (!points.has(p)) points.set(p, { x: NaN, y: NaN });
    lines.push(pts);
  }
  for (let merged = true; merged; ) {
    merged = false;
    outer: for (let i = 0; i < lines.length; i++) {
      for (let j = i + 1; j < lines.length; j++) {
        const shared = lines[i].filter((p) => lines[j].includes(p));
        if (shared.length >= 2) {
          lines[i] = orderAlong([...new Set([...lines[i], ...lines[j]])], points, lines[i]);
          lines.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
  lines = lines.map((l) => orderAlong(l, points, l));

  const numbered = new Map<string, AngRef>();
  for (const [n, name] of Object.entries(read.angles ?? {})) {
    const s = name.replace(/[^A-Z]/g, "");
    if (s.length === 3 && new Set(s).size === 3) numbered.set(n.replace(/\\/g, "").trim(), ang(s[0], s[1], s[2]));
  }

  const names = [...points.keys()].sort();
  const triangles: TriRef[] = [];
  for (let i = 0; i < names.length; i++)
    for (let j = i + 1; j < names.length; j++)
      for (let k = j + 1; k < names.length; k++) {
        const [a, b, c] = [names[i], names[j], names[k]];
        const ab = lineThrough({ lines }, a, b);
        const bc = lineThrough({ lines }, b, c);
        const ac = lineThrough({ lines }, a, c);
        if (ab < 0 || bc < 0 || ac < 0) continue;
        if (ab === bc && bc === ac) continue; // three points on one line
        triangles.push([a, b, c]);
      }

  const vertical: Array<readonly [AngRef, AngRef]> = [];
  const linearPairs: Array<readonly [AngRef, AngRef]> = [];
  for (const p of names) {
    const at = linesAt(lines, p);
    for (const li of at) {
      const [s1, s2] = sides(lines[li], p);
      if (s1.length === 0 || s2.length === 0) continue;
      for (const lj of at) {
        if (lj === li) continue;
        const [t1, t2] = sides(lines[lj], p);
        // a linear pair: one ray of the other line, both rays of this one
        for (const y of [t1[0], t2[0]]) if (y) linearPairs.push([ang(s1[0], p, y), ang(y, p, s2[0])]);
        if (lj < li || t1.length === 0 || t2.length === 0) continue;
        vertical.push([ang(s1[0], p, t1[0]), ang(s2[0], p, t2[0])]);
        vertical.push([ang(s1[0], p, t2[0]), ang(s2[0], p, t1[0])]);
      }
    }
  }

  const pairs: AnglePair[] = [];
  const pos = (p: Point) => points.get(p);
  const known = (p: Point | undefined) => {
    if (!p) return false;
    const q = pos(p);
    return Boolean(q && Number.isFinite(q.x) && Number.isFinite(q.y));
  };
  for (let t = 0; t < lines.length; t++) {
    for (let l1 = 0; l1 < lines.length; l1++) {
      for (let l2 = l1 + 1; l2 < lines.length; l2++) {
        if (l1 === t || l2 === t) continue;
        const P = lines[t].find((p) => lines[l1].includes(p));
        const Q = lines[t].find((p) => lines[l2].includes(p));
        if (!P || !Q || P === Q || lines[l2].includes(P) || lines[l1].includes(Q)) continue;
        if (!known(P) || !known(Q)) continue;
        const pP = pos(P)!;
        const pQ = pos(Q)!;
        // the transversal's rays at P (toward Q, away from Q) and at Q (toward P, away from P)
        const [tp1, tp2] = sides(lines[t], P);
        const towardQ = tp1.includes(Q) ? tp1[0] : tp2[0];
        const awayFromQ = tp1.includes(Q) ? tp2[0] : tp1[0];
        const [tq1, tq2] = sides(lines[t], Q);
        const towardP = tq1.includes(P) ? tq1[0] : tq2[0];
        const awayFromP = tq1.includes(P) ? tq2[0] : tq1[0];
        // which side of the transversal (direction P → Q) a ray from `o` through `x` points to
        const side = (o: { x: number; y: number }, x: Point) => {
          const q = pos(x)!;
          return Math.sign((pQ.x - pP.x) * (q.y - o.y) - (pQ.y - pP.y) * (q.x - o.x));
        };
        const raysP = sides(lines[l1], P).map((s) => s[0]).filter((x): x is Point => known(x)).map((x) => ({ x, s: side(pP, x) }));
        const raysQ = sides(lines[l2], Q).map((s) => s[0]).filter((x): x is Point => known(x)).map((x) => ({ x, s: side(pQ, x) }));
        for (const rp of raysP) {
          for (const rq of raysQ) {
            if (rp.s === 0 || rq.s === 0) continue;
            const same = rp.s === rq.s;
            const push = (kind: PairKind, a: Point | undefined, b: Point | undefined) => {
              if (a && b) pairs.push({ kind, x: ang(a, P, rp.x), y: ang(b, Q, rq.x), lines: [l1, l2], transversal: t });
            };
            if (!same) {
              push("altInterior", towardQ, towardP);
              push("altExterior", awayFromQ, awayFromP);
            } else {
              push("sameSide", towardQ, towardP);
              push("corresponding", towardQ, awayFromP);
              push("corresponding", awayFromQ, towardP);
            }
          }
        }
      }
    }
  }
  return { points, lines, numbered, triangles, vertical, linearPairs, pairs };
}

/** Orders a line's points by where they are along it (keeps the given order when positions are unknown). */
function orderAlong(pts: Point[], points: ReadonlyMap<Point, { x: number; y: number }>, fallback: readonly Point[]): Point[] {
  const xy = pts.map((p) => points.get(p));
  if (xy.some((q) => !q || !Number.isFinite(q.x) || !Number.isFinite(q.y))) {
    const order = new Map(fallback.map((p, i) => [p, i]));
    return [...pts].sort((a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99));
  }
  // the direction of the two points furthest apart
  let best = { i: 0, j: 1, d: -1 };
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++) {
      const d = Math.hypot(xy[i]!.x - xy[j]!.x, xy[i]!.y - xy[j]!.y);
      if (d > best.d) best = { i, j, d };
    }
  const o = xy[best.i]!;
  const dx = xy[best.j]!.x - o.x;
  const dy = xy[best.j]!.y - o.y;
  const proj = new Map(pts.map((p, k) => [p, (xy[k]!.x - o.x) * dx + (xy[k]!.y - o.y) * dy]));
  const sorted = [...pts].sort((a, b) => proj.get(a)! - proj.get(b)!);
  // read the way it was written when the fallback runs the other way
  const f0 = fallback.indexOf(sorted[0]);
  const f1 = fallback.indexOf(sorted[sorted.length - 1]);
  return f0 > f1 && f0 >= 0 && f1 >= 0 ? sorted.reverse() : sorted;
}

/** The rays at `v` in the figure: one representative point per ray (the nearest point on it). */
export function raysAt(fig: FigureModel, v: Point): Point[] {
  const out: Point[] = [];
  for (const li of linesAt(fig.lines as Point[][], v)) {
    const [a, b] = sides(fig.lines[li], v);
    if (a[0]) out.push(a[0]);
    if (b[0]) out.push(b[0]);
  }
  return out;
}

/**
 * The ray from `v` through `p`, named by a canonical point on it (the alphabetically first point
 * on that side of `v`), so every name of one angle gets one key. `p` itself when the figure does not
 * put them on one line.
 */
export function rayRep(fig: FigureModel | null, v: Point, p: Point): Point {
  if (!fig) return p;
  const li = lineThrough(fig, v, p);
  if (li < 0) return p;
  const line = fig.lines[li];
  const iv = line.indexOf(v);
  const ip = line.indexOf(p);
  const side = ip > iv ? line.slice(iv + 1) : line.slice(0, iv);
  return [...side].sort()[0] ?? p;
}

/** Is `p` on the line through `a` and `b` (a drawn line, or the two points themselves)? */
export function onLine(fig: FigureModel | null, p: Point, a: Point, b: Point): boolean {
  if (p === a || p === b) return true;
  if (!fig) return false;
  const li = lineThrough(fig, a, b);
  return li >= 0 && fig.lines[li].includes(p);
}
