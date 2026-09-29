import type { FigureSpec } from "./contracts";
import { fmt } from "./labels";

/**
 * A figure spec resolved to geometry, in figure units (y up): every element with its points looked
 * up, polygons expanded to their sides, a side listed twice drawn once, lines and rays run on past
 * their points, and the problems that stop an element being drawn, in words. Pure; shared by
 * `checkFigure` (which reports the problems) and `planFigure` (which draws what is left).
 */

export type V = { x: number; y: number };

export interface FigPoint {
  name: string;
  p: V;
  /** write the name (default true) */
  label: boolean;
  /** as given: true / false, or undefined for "decide" */
  dot?: boolean;
}

export interface FigSegment {
  from: string;
  to: string;
  a: V;
  b: V;
  label?: string;
  ticks?: number;
  arrows?: number;
  dashed: boolean;
  /** the first polygon this is a side of */
  polygon?: number;
  /** `AB`, for messages */
  name: string;
}

export interface FigLine {
  from: string;
  to: string;
  a: V;
  b: V;
  ray: boolean;
  label?: string;
  arrows?: number;
  /** the drawn ends: run on a third of the span past the outermost points on it (a ray: past `to` only) */
  ends: [V, V];
  name: string;
}

export interface FigCircle {
  center: string;
  c: V;
  r: number;
  through?: string;
  dashed: boolean;
  name: string;
}

export interface FigAngle {
  at: string;
  from: string;
  to: string;
  v: V;
  a: V;
  b: V;
  /** the smaller angle, 0–180 */
  deg: number;
  label?: string;
  right: boolean;
  arcs?: number;
  /** `ABC` (from, at, to), for messages */
  name: string;
}

export interface FigPolygon {
  names: string[];
  pts: V[];
}

export interface Figure {
  points: FigPoint[];
  byName: Map<string, V>;
  segments: FigSegment[];
  lines: FigLine[];
  circles: FigCircle[];
  angles: FigAngle[];
  polygons: FigPolygon[];
  /** everything drawn, in figure units: points, circles, lines run on */
  extent: { minX: number; minY: number; maxX: number; maxY: number };
  /** the points' spread (diagonal of their box), the yardstick of every tolerance */
  size: number;
}

export const RESOLVE = {
  /** two points closer than this × size are the same place */
  same: 1e-3,
  /** a point this close (× size) to a line or circle is on it */
  on: 5e-3,
  /** an angle within this many degrees of 0 or 180 has no mark */
  flatDeg: 1,
  /** a line runs on this much of its span past its outermost points */
  runOn: 1 / 3,
  /** …and at least this much of the figure's size */
  minRunOn: 0.12,
  /** segments from a circle's centre this close in length (× their length) are the same radius */
  spokesAgree: 0.02,
  /** one lone segment from the centre this close to the given radius (×) was meant to end on it */
  loneSpoke: 0.1,
} as const;

export const dist = (a: V, b: V): number => Math.hypot(b.x - a.x, b.y - a.y);

/** The unsigned angle at v between v→a and v→b, in degrees (0–180). */
export function angleDeg(v: V, a: V, b: V): number {
  const ax = a.x - v.x;
  const ay = a.y - v.y;
  const bx = b.x - v.x;
  const by = b.y - v.y;
  const d = Math.hypot(ax, ay) * Math.hypot(bx, by);
  if (d === 0) return 0;
  return (Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / d))) * 180) / Math.PI;
}

const at = (p: V): string => `(${fmt(p.x)}, ${fmt(p.y)})`;

/**
 * The radius a circle given by a number is drawn with. A segment from the centre to a point is a
 * radius as the figure is drawn ("R and S lie on the circle" → `OR`, `OS`), and a model that gives
 * the radius as a number as well easily gets the two apart: the circle through √31 drawn with
 * radius 5 left R and S floating outside it. So: two or more such spokes of one length ARE the
 * radius; a single spoke only when it is already within `loneSpoke` of the number (a point
 * placed a little off) — one spoke well away from it is a point off the circle on purpose (the
 * external point a tangent comes from). Otherwise the number stands.
 */
function radiusFromSpokes(r: number, center: V, centerName: string, segments: readonly FigSegment[]): number {
  const spokes: number[] = [];
  for (const s of segments) {
    if (s.from === centerName) spokes.push(dist(center, s.b));
    else if (s.to === centerName) spokes.push(dist(center, s.a));
  }
  if (spokes.length === 0) return r;
  const mean = spokes.reduce((a, b) => a + b, 0) / spokes.length;
  const agree = spokes.every((d) => Math.abs(d - mean) <= RESOLVE.spokesAgree * mean);
  if (!agree || !(mean > 0)) return r;
  if (spokes.length >= 2) return mean;
  return Math.abs(mean - r) <= RESOLVE.loneSpoke * r ? mean : r;
}

/** Resolves the spec; `problems` are the reasons some element could not be drawn (the rest is). */
export function resolveFigure(spec: FigureSpec): { fig: Figure; problems: string[] } {
  const problems: string[] = [];
  const byName = new Map<string, V>();
  const points: FigPoint[] = [];
  for (const [name, p] of Object.entries(spec.points ?? {})) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    byName.set(name, { x: p.x, y: p.y });
    points.push({ name, p: { x: p.x, y: p.y }, label: p.label !== false, dot: p.dot });
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { p } of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const spread = points.length ? Math.hypot(maxX - minX, maxY - minY) : 0;
  const circleSize = Math.max(0, ...(spec.circles ?? []).map((c) => (c.radius ?? 0) * 2));
  const size = Math.max(spread, circleSize) || 1;
  const same = (a: V, b: V) => dist(a, b) <= size * RESOLVE.same;

  // names used but not defined: one sentence per name, listing what uses it
  const missing = new Map<string, string[]>();
  const need = (name: string, user: string): V | null => {
    const p = byName.get(name);
    if (p) return p;
    const users = missing.get(name) ?? [];
    if (!users.includes(user)) users.push(user);
    missing.set(name, users);
    return null;
  };

  // polygons → sides; explicit segments override a side they repeat (its label, ticks, arrows)
  const polygons: FigPolygon[] = [];
  const segments: FigSegment[] = [];
  const segIndex = new Map<string, number>();
  const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  (spec.polygons ?? []).forEach((poly) => {
    const title = `polygon ${poly.vertices.join("")}`;
    const pts = poly.vertices.map((n) => need(n, title));
    const repeated = poly.vertices.find((n, i) => poly.vertices.indexOf(n) !== i);
    if (repeated) problems.push(`Polygon ${poly.vertices.join("")} lists ${repeated} more than once; list each vertex once, in order round the shape.`);
    if (pts.some((p) => p === null)) return;
    const idx = polygons.length;
    polygons.push({ names: [...poly.vertices], pts: pts as V[] });
    for (let i = 0; i < poly.vertices.length; i++) {
      const from = poly.vertices[i];
      const to = poly.vertices[(i + 1) % poly.vertices.length];
      if (from === to) continue;
      const a = pts[i] as V;
      const b = pts[(i + 1) % pts.length] as V;
      if (same(a, b)) {
        problems.push(`Polygon ${poly.vertices.join("")} has a zero-length side ${from}${to}: ${from} and ${to} are both at ${at(a)}; move one of them.`);
        continue;
      }
      const k = key(from, to);
      if (segIndex.has(k)) continue;
      segIndex.set(k, segments.length);
      segments.push({ from, to, a, b, dashed: false, polygon: idx, name: `${from}${to}` });
    }
  });
  for (const s of spec.segments ?? []) {
    const title = `segment ${s.from}${s.to}`;
    const a = need(s.from, title);
    const b = need(s.to, title);
    if (!a || !b) continue;
    if (s.from === s.to || same(a, b)) {
      problems.push(
        s.from === s.to
          ? `Segment ${s.from}${s.to} joins ${s.from} to itself; a segment needs two different points.`
          : `Segment ${s.from}${s.to} has zero length: ${s.from} and ${s.to} are both at ${at(a)}; move one of them.`,
      );
      continue;
    }
    const seg: FigSegment = { from: s.from, to: s.to, a, b, label: s.label, ticks: s.ticks, arrows: s.arrows, dashed: s.dashed ?? false, name: `${s.from}${s.to}` };
    const k = key(s.from, s.to);
    const i = segIndex.get(k);
    if (i === undefined) {
      segIndex.set(k, segments.length);
      segments.push(seg);
      continue;
    }
    // a side already drawn (a polygon's, or listed twice): keep one, with what this one adds
    const prev = segments[i];
    segments[i] = {
      ...seg,
      label: seg.label ?? prev.label,
      ticks: seg.ticks ?? prev.ticks,
      arrows: seg.arrows ?? prev.arrows,
      dashed: seg.dashed || prev.dashed,
      polygon: prev.polygon,
    };
  }

  const circles: FigCircle[] = [];
  for (const c of spec.circles ?? []) {
    const title = `the circle centred at ${c.center}`;
    const center = need(c.center, title);
    const through = c.through !== undefined ? need(c.through, `${title} (as the point it goes through)`) : null;
    if (!center || (c.through !== undefined && !through && c.radius === undefined)) continue;
    let r = c.radius ?? 0;
    if (through) {
      const rt = dist(center, through);
      if (c.radius !== undefined && Math.abs(rt - c.radius) > 0.02 * c.radius) {
        problems.push(`The circle centred at ${c.center} has radius ${fmt(c.radius)} but goes through ${c.through}, which is ${fmt(rt)} from ${c.center}; give one or make them agree.`);
      }
      r = rt;
    } else {
      r = radiusFromSpokes(r, center, c.center, segments);
    }
    if (!(r > size * RESOLVE.same)) {
      problems.push(
        through
          ? `The circle centred at ${c.center} goes through ${c.through}, which is at ${c.center} itself, so its radius would be 0.`
          : `The circle centred at ${c.center} has no radius.`,
      );
      continue;
    }
    circles.push({ center: c.center, c: center, r, through: through ? c.through : undefined, dashed: c.dashed ?? false, name: title });
  }

  // extent so far (points, circles) — the lines run on relative to the figure's size
  for (const c of circles) {
    minX = Math.min(minX, c.c.x - c.r);
    maxX = Math.max(maxX, c.c.x + c.r);
    minY = Math.min(minY, c.c.y - c.r);
    maxY = Math.max(maxY, c.c.y + c.r);
  }

  const lines: FigLine[] = [];
  for (const l of spec.lines ?? []) {
    const [f, t] = l.through;
    const ray = l.extend === "ray";
    const title = `${ray ? "ray" : "line"} ${f}${t}`;
    const a = need(f, title);
    const b = need(t, title);
    if (!a || !b) continue;
    if (f === t || same(a, b)) {
      problems.push(`The ${title} has no direction: ${f} and ${t} are ${f === t ? "the same point" : `both at ${at(a)}`}; it needs two different points.`);
      continue;
    }
    const len = dist(a, b);
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    // every named point on it stretches it
    let lo = 0;
    let hi = len;
    for (const { p } of points) {
      const t0 = (p.x - a.x) * ux + (p.y - a.y) * uy;
      const off = Math.abs((p.x - a.x) * uy - (p.y - a.y) * ux);
      if (off > size * RESOLVE.on) continue;
      if (ray && t0 < 0) continue;
      lo = Math.min(lo, t0);
      hi = Math.max(hi, t0);
    }
    const run = Math.max((hi - lo) * RESOLVE.runOn, size * RESOLVE.minRunOn);
    let t0 = ray ? 0 : lo - run;
    let t1 = hi + run;
    // a tangent is drawn running on as far either side of the point where it touches
    if (!ray) {
      for (const c of circles) {
        const tc = (c.c.x - a.x) * ux + (c.c.y - a.y) * uy;
        const off = Math.abs((c.c.x - a.x) * uy - (c.c.y - a.y) * ux);
        if (Math.abs(off - c.r) > size * RESOLVE.on || tc < lo - 1e-9 || tc > hi + 1e-9) continue;
        const half = Math.max(tc - t0, t1 - tc);
        t0 = tc - half;
        t1 = tc + half;
      }
    }
    const ends: [V, V] = [
      { x: a.x + ux * t0, y: a.y + uy * t0 },
      { x: a.x + ux * t1, y: a.y + uy * t1 },
    ];
    for (const e of ends) {
      minX = Math.min(minX, e.x);
      maxX = Math.max(maxX, e.x);
      minY = Math.min(minY, e.y);
      maxY = Math.max(maxY, e.y);
    }
    lines.push({ from: f, to: t, a, b, ray, label: l.label, arrows: l.arrows, ends, name: title });
  }

  const angles: FigAngle[] = [];
  for (const g of spec.angles ?? []) {
    const name = `${g.from}${g.at}${g.to}`;
    const title = `angle ${name}`;
    const v = need(g.at, title);
    const a = need(g.from, title);
    const b = need(g.to, title);
    if (!v || !a || !b) continue;
    if (same(v, a) || same(v, b)) {
      const other = same(v, a) ? g.from : g.to;
      problems.push(`Angle ${name} has no size: ${other} is at the same place as the vertex ${g.at}; each arm needs a point away from ${g.at}.`);
      continue;
    }
    const deg = angleDeg(v, a, b);
    if (deg < RESOLVE.flatDeg) {
      problems.push(`Angle ${name} is 0°: ${g.at}${g.from} and ${g.at}${g.to} point the same way, so there is no angle to mark.`);
      continue;
    }
    if (deg > 180 - RESOLVE.flatDeg) {
      problems.push(
        `Angle ${name} is a straight angle (${g.from}, ${g.at} and ${g.to} are in a line), so its mark has no side; mark the angles either side of it instead.`,
      );
      continue;
    }
    angles.push({ at: g.at, from: g.from, to: g.to, v, a, b, deg, label: g.label, right: g.right ?? false, arcs: g.arcs, name });
  }

  problems.unshift(
    ...[...missing].map(
      ([name, users]) =>
        `Point ${name} is used by ${users.join(", ")} but is not defined in points; add ${name} with its x and y, or remove it from ${users.length > 1 ? "those" : "that"}.`,
    ),
  );

  if (!Number.isFinite(minX)) {
    minX = minY = maxX = maxY = 0;
  }
  return {
    fig: { points, byName, segments, lines, circles, angles, polygons, extent: { minX, minY, maxX, maxY }, size },
    problems,
  };
}
