/**
 * A proof's figure read from the ink itself — no model. The board already knows the drawing
 * (`splitInk`: its strokes) and its labels (one recognizer call per drawing: the label stack, read
 * once the student stops). From those:
 *
 *  - every stroke is cut at its corners into straight pieces (a triangle in one stroke is three);
 *  - pieces on one straight line are one line (a side drawn in two strokes, a diagonal through a
 *    vertex);
 *  - the figure's vertices are the lines' ends and where lines cross or meet;
 *  - each capital-letter label names the vertex nearest it; a digit label (`1`, `2`) names the angle
 *    at the nearest vertex whose sector it sits in;
 *  - each line is the labelled vertices on it, in order: `ADC`.
 *
 * The result is a `FigureRead`, exactly what the model's read is; `buildFigure` derives the rest.
 * Null when fewer than three labelled points or no line with two of them come out. Pure.
 */
import type { InkStroke, Rect } from "../contracts";
import { rdp } from "../strokePayload";
import type { FigureRead } from "./figure";

export interface InkLabel {
  /** the label as read (`A`, `1`, `\text{A}` already unwrapped by `parseLabelRead`) */
  text: string;
  bounds: Rect;
}

type P = { x: number; y: number };

interface Piece {
  a: P;
  b: P;
  len: number;
}

interface Line {
  pieces: Piece[];
  /** a point on it and its unit direction */
  o: P;
  d: P;
  /** extent along d */
  t0: number;
  t1: number;
}

export const FIGURE_INK = {
  /** straight pieces shorter than this many glyphs are marks (an arc, a tick), not sides */
  minPieceFactor: 2.5,
  /** corner detection: simplification tolerance as a share of the stroke's size */
  cornerShare: 0.05,
  /** two pieces are one line within this many degrees, and this many glyphs off it */
  sameLineDeg: 9,
  sameLineOffFactor: 0.7,
  /** ... with at most this gap between them along it */
  sameLineGapFactor: 2,
  /** a vertex is on a line within this many glyphs */
  onLineFactor: 0.8,
  /** vertices closer than this (x G) are one */
  mergeFactor: 0.9,
  /** a letter names the nearest vertex within this many glyphs of its box */
  labelReachFactor: 3,
  /** a digit names an angle at a vertex within this many glyphs */
  markReachFactor: 4.5,
} as const;

const sub = (a: P, b: P): P => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: P, b: P) => a.x * b.x + a.y * b.y;
const len = (a: P) => Math.hypot(a.x, a.y);

function pieces(strokes: readonly InkStroke[], G: number): Piece[] {
  const out: Piece[] = [];
  for (const s of strokes) {
    const pts = s.segments.flat();
    if (pts.length < 2) continue;
    const size = Math.max(s.bounds.w, s.bounds.h);
    const simple = rdp(pts, Math.max(1.5, FIGURE_INK.cornerShare * size));
    for (let i = 1; i < simple.length; i++) {
      const a = simple[i - 1];
      const b = simple[i];
      const l = Math.hypot(b.x - a.x, b.y - a.y);
      if (l >= FIGURE_INK.minPieceFactor * G) out.push({ a, b, len: l });
    }
  }
  return out;
}

function lineOf(ps: Piece[]): Line {
  const longest = ps.reduce((m, p) => (p.len > m.len ? p : m), ps[0]);
  const d0 = sub(longest.b, longest.a);
  const d = { x: d0.x / longest.len, y: d0.y / longest.len };
  const o = longest.a;
  const ts = ps.flatMap((p) => [dot(sub(p.a, o), d), dot(sub(p.b, o), d)]);
  return { pieces: ps, o, d, t0: Math.min(...ts), t1: Math.max(...ts) };
}

const offLine = (l: Line, p: P) => Math.abs((p.x - l.o.x) * l.d.y - (p.y - l.o.y) * l.d.x);
const along = (l: Line, p: P) => dot(sub(p, l.o), l.d);
const at = (l: Line, t: number): P => ({ x: l.o.x + l.d.x * t, y: l.o.y + l.d.y * t });

/** Pieces on one straight line, joined. */
function lines(ps: Piece[], G: number): Line[] {
  const parent = ps.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const cos = Math.cos((FIGURE_INK.sameLineDeg * Math.PI) / 180);
  for (let i = 0; i < ps.length; i++)
    for (let j = i + 1; j < ps.length; j++) {
      const li = lineOf([ps[i]]);
      const dj = sub(ps[j].b, ps[j].a);
      if (Math.abs(dot(li.d, dj)) / ps[j].len < cos) continue;
      const off = FIGURE_INK.sameLineOffFactor * G;
      if (offLine(li, ps[j].a) > off || offLine(li, ps[j].b) > off) continue;
      const [a0, a1] = [li.t0, li.t1];
      const b = [along(li, ps[j].a), along(li, ps[j].b)].sort((p, q) => p - q);
      const gap = Math.max(0, b[0] - a1, a0 - b[1]);
      if (gap <= FIGURE_INK.sameLineGapFactor * G) parent[find(j)] = find(i);
    }
  const groups = new Map<number, Piece[]>();
  ps.forEach((p, i) => {
    const r = find(i);
    groups.set(r, [...(groups.get(r) ?? []), p]);
  });
  return [...groups.values()].map(lineOf);
}

/** Where two lines cross or meet (within both, a little past an end), or null. */
function meet(l: Line, m: Line, G: number): P | null {
  const den = l.d.x * m.d.y - l.d.y * m.d.x;
  if (Math.abs(den) < 0.2) return null; // nearly parallel
  const w = sub(m.o, l.o);
  const t = (w.x * m.d.y - w.y * m.d.x) / den;
  const p = at(l, t);
  const u = along(m, p);
  const slack = FIGURE_INK.onLineFactor * G;
  if (t < l.t0 - slack || t > l.t1 + slack || u < m.t0 - slack || u > m.t1 + slack) return null;
  return p;
}

function rectDist(r: Rect, p: P): number {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.w));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.h));
  return Math.hypot(dx, dy);
}

/** Reads the figure from its strokes and labels (see the file comment). */
export function figureFromInk(strokes: readonly InkStroke[], labels: readonly InkLabel[], G: number): FigureRead | null {
  const ls = lines(pieces(strokes, G), G);
  if (ls.length < 2) return null;
  // vertices: every line's ends, every crossing or meeting
  const raw: P[] = [];
  for (const l of ls) raw.push(at(l, l.t0), at(l, l.t1));
  for (let i = 0; i < ls.length; i++)
    for (let j = i + 1; j < ls.length; j++) {
      const p = meet(ls[i], ls[j], G);
      if (p) raw.push(p);
    }
  const verts: P[] = [];
  for (const p of raw) {
    const near = verts.find((v) => len(sub(v, p)) <= FIGURE_INK.mergeFactor * G);
    if (!near) verts.push(p);
  }
  // letters name the nearest vertex (greedy by distance, one letter per vertex)
  const letters = labels.map((l) => ({ ...l, text: l.text.replace(/[{}\s\\]|text|mathrm/g, "") })).filter((l) => /^[A-Z]$/.test(l.text));
  const pairs: Array<{ li: number; vi: number; d: number }> = [];
  letters.forEach((l, li) =>
    verts.forEach((v, vi) => {
      const d = rectDist(l.bounds, v);
      if (d <= FIGURE_INK.labelReachFactor * G) pairs.push({ li, vi, d });
    }),
  );
  pairs.sort((a, b) => a.d - b.d);
  const named = new Map<number, string>();
  const usedL = new Set<number>();
  for (const p of pairs) {
    if (usedL.has(p.li) || named.has(p.vi) || [...named.values()].includes(letters[p.li].text)) continue;
    usedL.add(p.li);
    named.set(p.vi, letters[p.li].text);
  }
  if (named.size < 3) return null;
  const points: Record<string, [number, number]> = {};
  for (const [vi, name] of named) points[name] = [Math.round(verts[vi].x * 10) / 10, Math.round(verts[vi].y * 10) / 10];
  const out: string[] = [];
  for (const l of ls) {
    const on = [...named.entries()]
      .filter(([vi]) => {
        const v = verts[vi];
        const t = along(l, v);
        const slack = FIGURE_INK.onLineFactor * G;
        return offLine(l, v) <= slack && t >= l.t0 - slack && t <= l.t1 + slack;
      })
      .sort((a, b) => along(l, verts[a[0]]) - along(l, verts[b[0]]))
      .map(([, name]) => name);
    if (on.length >= 2) out.push(on.join(""));
  }
  if (out.length === 0) return null;
  // a digit names the angle at the nearest vertex whose sector it sits in
  const angles: Record<string, string> = {};
  for (const l of labels) {
    const text = l.text.replace(/[{}\s\\]|text|mathrm/g, "");
    if (!/^\d{1,2}$/.test(text)) continue;
    const c = { x: l.bounds.x + l.bounds.w / 2, y: l.bounds.y + l.bounds.h / 2 };
    const best = [...named.entries()].map(([vi, name]) => ({ name, v: verts[vi], d: len(sub(verts[vi], c)) })).sort((a, b) => a.d - b.d)[0];
    if (!best || best.d > FIGURE_INK.markReachFactor * G) continue;
    // the rays at that vertex: the nearest named point each way along each line through it
    const rays: Array<{ name: string; ang: number }> = [];
    for (const line of out) {
      const i = line.indexOf(best.name);
      if (i < 0) continue;
      for (const j of [i - 1, i + 1]) {
        const q = line[j];
        if (!q) continue;
        const pq = points[q];
        rays.push({ name: q, ang: Math.atan2(pq[1] - best.v.y, pq[0] - best.v.x) });
      }
    }
    if (rays.length < 2) continue;
    const a = Math.atan2(c.y - best.v.y, c.x - best.v.x);
    const norm = (x: number) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    rays.sort((p, q) => norm(p.ang) - norm(q.ang));
    for (let k = 0; k < rays.length; k++) {
      const r1 = rays[k];
      const r2 = rays[(k + 1) % rays.length];
      const span = norm(r2.ang - r1.ang);
      if (span > 0 && span < Math.PI && norm(a - r1.ang) < span) {
        angles[text] = `${r1.name}${best.name}${r2.name}`;
        break;
      }
    }
  }
  return { points, lines: out, ...(Object.keys(angles).length > 0 ? { angles } : {}) };
}
