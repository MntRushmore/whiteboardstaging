import { mulberry32, strokeBounds, type Stroke } from "@/lib/hand";
import type { Rect } from "../contracts";
import { Pen, rectsOverlap, writeMath, type Pt } from "../graphing/pen";
import { planFromGroups } from "../graphing/plan";
import type { FigurePlanOptions, FigurePlanResult, FigureSpec } from "./contracts";
import { nameLatex } from "./labels";
import { RESOLVE, resolveFigure, type FigSegment, type Figure, type V } from "./resolve";

/**
 * A geometry figure as the tutor draws it: `FigureSpec` (named points in figure units, y up, and
 * what joins and marks them) in, a `HandPlan` out — revealed by the HandWriter stroke by stroke in
 * the same blue hand as the worked steps and the graphs.
 *
 * True to scale: one scale for x and y, the figure centred in the box with its labels. The parts in
 * the order a teacher draws them: the sides (a polygon at a time), lines and rays run on past their
 * points with an arrowhead at each open end, circles, angle marks (arcs — two or three for equal
 * angles — and right-angle squares), equal-length ticks and parallel arrows, dots, then the writing:
 * point names, side labels, angle labels, line names.
 *
 * Every label is tried at a list of spots, best first, and takes the first that touches no stroke
 * and no other label (the graph sketch's rule): a point's name outside the figure, along the
 * middle of the widest gap between the strokes meeting there (a polygon's vertex: its external
 * bisector); a side's label beside its middle, on the side away from its polygon's centre; an angle's
 * label inside the angle, on its bisector, just past the arc. A label that finds no clear spot
 * shrinks the whole figure a little and the layout is tried again; a label hanging out of the box
 * shrinks it until everything fits.
 */

export const FIGURE = {
  /** a good box for a figure beside the work (the caller may give any) */
  box: { w: 440, h: 360 },
  /** hand sizes at the reference box (see HAND_WRITE.digitRatio: a digit is 0.63 of this) */
  text: { name: 30, side: 28, angle: 27, line: 28 },
  /** text scales with min(box.w, box.h) / textRef, within textScale */
  textRef: 340,
  textScale: { min: 0.72, max: 1.15 },
  /** px between a label's clearance (below) and what it labels: the pen's bow and tremor, and a little air */
  gap: { name: 3, side: 3, angle: 2, line: 3 },
  /** px a label keeps clear of any stroke's centre line (the board's pen is ~4 px wide), and of another label */
  clear: 4,
  labelPad: 5,
  // Marks drawn side by side (ticks, chevrons, the arcs of equal angles) step at least ~7 px apart:
  // tldraw's pen at the tutor's size is ~4 px wide, and closer strokes run into one band on the board.
  /** equal-length ticks: half their length, and the step between two */
  tick: { half: 7, step: 7 },
  /** parallel arrows (chevrons): arm length, half-opening (rad), step between two */
  chevron: { len: 9, spread: 0.6, step: 11 },
  /** a line's arrowheads */
  lineArrow: 9,
  dotR: 3,
  /** angle arcs: radius as a fraction of the shorter arm, within min–max; a small angle's arc is at least minLen long; arcs of equal angles step apart */
  arc: { frac: 0.22, min: 18, max: 32, minLen: 26, step: 7, maxArm: 0.7 },
  /** right-angle square: side as a fraction of the shorter arm, within min–max */
  square: { frac: 0.14, min: 12, max: 19 },
  /** parallel arrows on a line sit at least this far from other strokes when they can */
  lineMarkClear: 26,
  /** layout rounds, the shrink per round when a label collides, and the smallest scale a collision may shrink to */
  fit: { rounds: 14, shrink: 0.93, minScale: 0.55 },
} as const;

export type FigurePartKind = "side" | "line" | "circle" | "arc" | "right" | "tick" | "arrow" | "dot" | "name" | "sideLabel" | "angleLabel" | "lineLabel";

export interface FigurePart {
  kind: FigurePartKind;
  /** what it belongs to: a point's name, a side `AB`, an angle `ABC` (from, at, to), a line `line AB` */
  owner: string;
  strokes: Stroke[];
  /** a label's ink box */
  rect?: Rect;
  latex?: string;
  /** parts with the same group are one line of the plan (a polygon's sides, all the dots…) */
  group: string;
}

export interface FigureLayout {
  /** in drawing order */
  parts: FigurePart[];
  /** each named point, px in the box */
  points: Record<string, Pt>;
  /** px per figure unit */
  scale: number;
  /** labels that found no clear spot (0 on a good layout) */
  collisions: number;
  /** the ink's box (inside the box, centred) */
  bounds: Rect;
  /** the hand size of the names */
  size: number;
}

type Pre = { latex: string; w: number; h: number; strokes: Stroke[] };
type Xf = { s: number; ox: number; oy: number };
type TextSizes = { name: number; side: number; angle: number; line: number };

interface Ctx {
  fig: Figure;
  seed: number;
  box: { w: number; h: number };
  text: TextSizes;
  names: Map<string, Pre>;
  sideLabels: Map<number, Pre>;
  angleLabels: Map<number, Pre>;
  lineLabels: Map<number, Pre>;
  /** per side, the centre its label keeps away from (figure units) */
  centres: Map<number, V>;
  /** sides a line already draws (their marks and labels stay) */
  covered: Set<number>;
}

/** Hand sizes for a box: the reference sizes, scaled a little with the box. */
export function textSizesFor(box: { w: number; h: number }): TextSizes {
  const k = Math.min(FIGURE.textScale.max, Math.max(FIGURE.textScale.min, Math.min(box.w, box.h) / FIGURE.textRef));
  const t = FIGURE.text;
  return { name: Math.round(t.name * k), side: Math.round(t.side * k), angle: Math.round(t.angle * k), line: Math.round(t.line * k) };
}

function prewrite(latex: string, size: number, seed: number): Pre | null {
  const w = writeMath(latex, { x: 0, y: 0 }, "left", "top", size, seed);
  return w ? { latex, w: w.rect.w, h: w.rect.h, strokes: w.strokes } : null;
}

function moved(strokes: readonly Stroke[], dx: number, dy: number): Stroke[] {
  return strokes.map((s) => ({ ...s, points: s.points.map((p) => ({ x: p.x + dx, y: p.y + dy, z: p.z })) }));
}

// ------------------------------------------------------------------ geometry in px

const TAU = Math.PI * 2;
const norm = (a: number): number => ((a % TAU) + TAU) % TAU;
const unit = (a: number): Pt => ({ x: Math.cos(a), y: Math.sin(a) });
const len = (a: Pt, b: Pt): number => Math.hypot(b.x - a.x, b.y - a.y);

/** How far a w × h box reaches from its centre along the unit direction u. */
const reach = (w: number, h: number, u: Pt): number => (Math.abs(u.x) * w) / 2 + (Math.abs(u.y) * h) / 2;
/** …for a label, with the clearance the collision test keeps round it (so a spot beside a slanted side is not "touching" it) */
const reachP = (pre: Pre, u: Pt): number => reach(pre.w + 2 * FIGURE.clear, pre.h + 2 * FIGURE.clear, u);

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const L2 = dx * dx + dy * dy;
  const t = L2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

/** Is angle `a` inside the wedge starting at `lo`, `width` wide (all radians)? */
const inWedge = (a: number, lo: number, width: number): boolean => norm(a - lo) < width;

/**
 * How far from a vertex, along `dir` inside the wedge (`lo`, `width` wide), the centre of a w × h
 * box must be to keep `gap` clear of both of the wedge's arms — and at least `min`, at most
 * `min + cap` (further than that the spot is not beside the vertex any more; the collision test
 * then says whether it is clear).
 */
function outAlong(dir: number, lo: number, width: number, w: number, h: number, gap: number, min: number, cap = 90): number {
  if (width >= TAU - 1e-9) return min;
  const d1 = norm(dir - lo);
  const d2 = width - d1;
  if (!(d1 > 0.02 && d2 > 0.02)) return min;
  // at distance d the centre is d·sin(δ) from an arm δ away; the box reaches across that arm this far
  const clearOf = (arm: number, delta: number) => (delta >= Math.PI / 2 ? 0 : (reach(w, h, unit(arm + Math.PI / 2)) + gap) / Math.sin(delta));
  return Math.max(min, Math.min(Math.max(clearOf(lo, d1), clearOf(lo + width, d2)), min + cap));
}

/** Ink points bucketed on a grid, for "does this box touch any stroke". */
class InkGrid {
  private readonly cell = 16;
  private readonly cells = new Map<number, Pt[]>();
  private key(i: number, j: number): number {
    return (i + 32768) * 65536 + (j + 32768);
  }
  add(strokes: readonly Stroke[]): void {
    for (const s of strokes) {
      for (const p of s.points) {
        const k = this.key(Math.floor(p.x / this.cell), Math.floor(p.y / this.cell));
        const bucket = this.cells.get(k);
        if (bucket) bucket.push(p);
        else this.cells.set(k, [p]);
      }
    }
  }
  /** ink points inside r grown by pad */
  count(r: Rect, pad: number): number {
    const x0 = r.x - pad;
    const y0 = r.y - pad;
    const x1 = r.x + r.w + pad;
    const y1 = r.y + r.h + pad;
    let n = 0;
    for (let i = Math.floor(x0 / this.cell); i <= Math.floor(x1 / this.cell); i++) {
      for (let j = Math.floor(y0 / this.cell); j <= Math.floor(y1 / this.cell); j++) {
        const bucket = this.cells.get(this.key(i, j));
        if (!bucket) continue;
        for (const p of bucket) if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) n++;
      }
    }
    return n;
  }
}

// ------------------------------------------------------------------ the figure's structure

/** The centre a side's label keeps away from: its polygon's, else a triangle or quadrilateral it closes, else the figure's. */
function sideCentres(fig: Figure): Map<number, V> {
  const out = new Map<number, V>();
  const has = new Set(fig.segments.map((s) => (s.from < s.to ? `${s.from}|${s.to}` : `${s.to}|${s.from}`)));
  const joined = (a: string, b: string) => has.has(a < b ? `${a}|${b}` : `${b}|${a}`);
  const mean = (vs: readonly V[]): V => ({ x: vs.reduce((t, v) => t + v.x, 0) / vs.length, y: vs.reduce((t, v) => t + v.y, 0) / vs.length });
  const all = mean(fig.points.map((p) => p.p));
  const names = fig.points.map((p) => p.name);
  const area = (a: V, b: V, c: V) => Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
  fig.segments.forEach((s, i) => {
    const poly = s.polygon !== undefined ? fig.polygons[s.polygon] : fig.polygons.find((p) => p.names.some((n, k) => (n === s.from && p.names[(k + 1) % p.names.length] === s.to) || (n === s.to && p.names[(k + 1) % p.names.length] === s.from)));
    if (poly) {
      out.set(i, mean(poly.pts));
      return;
    }
    let best: { c: V; area: number } | null = null;
    for (const c of names) {
      if (c === s.from || c === s.to || !joined(s.from, c) || !joined(s.to, c)) continue;
      const pc = fig.byName.get(c)!;
      const A = area(s.a, s.b, pc);
      if (A > 1e-9 * fig.size * fig.size && (!best || A < best.area)) best = { c: mean([s.a, s.b, pc]), area: A };
    }
    if (!best) {
      for (const c of names) {
        if (c === s.from || c === s.to || !joined(s.to, c)) continue;
        for (const d of names) {
          if (d === s.from || d === s.to || d === c || !joined(c, d) || !joined(d, s.from)) continue;
          const pc = fig.byName.get(c)!;
          const pd = fig.byName.get(d)!;
          const A = area(s.a, s.b, pc) + area(s.a, pc, pd);
          if (A > 1e-9 * fig.size * fig.size && (!best || A < best.area)) best = { c: mean([s.a, s.b, pc, pd]), area: A };
        }
      }
    }
    out.set(i, best?.c ?? all);
  });
  return out;
}

/**
 * Sides lying along a drawn line or a longer solid side (the halves of a diagonal, marked equal):
 * that stroke is theirs too — a second one would only thicken it. Their marks and labels stay.
 */
function coveredSides(fig: Figure): Set<number> {
  const out = new Set<number>();
  const tol = fig.size * RESOLVE.on;
  const carriers: Array<{ e0: V; e1: V; seg: number }> = [
    ...fig.lines.map((l) => ({ e0: l.ends[0], e1: l.ends[1], seg: -1 })),
    ...fig.segments.map((s, i) => ({ e0: s.a, e1: s.b, seg: i })).filter((c) => !fig.segments[c.seg].dashed),
  ];
  fig.segments.forEach((s, i) => {
    if (s.dashed) return;
    const own = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
    for (const { e0, e1, seg } of carriers) {
      if (seg === i) continue;
      const L = Math.hypot(e1.x - e0.x, e1.y - e0.y);
      if (seg >= 0 && L <= own + tol) continue;
      const ux = (e1.x - e0.x) / L;
      const uy = (e1.y - e0.y) / L;
      const on = (p: V) => {
        const t = (p.x - e0.x) * ux + (p.y - e0.y) * uy;
        const off = Math.abs((p.x - e0.x) * uy - (p.y - e0.y) * ux);
        return off <= tol && t >= -tol && t <= L + tol;
      };
      if (on(s.a) && on(s.b)) {
        out.add(i);
        return;
      }
    }
  });
  return out;
}

function makeCtx(fig: Figure, seed: number, box: { w: number; h: number }): Ctx {
  const text = textSizesFor(box);
  // the labels' own seeds, so a label is written the same whatever the scale
  const rng = mulberry32((seed ^ 0x5bd1e995) >>> 0);
  const next = () => Math.floor(rng() * 2 ** 31);
  const names = new Map<string, Pre>();
  for (const p of fig.points) {
    const s = next();
    if (!p.label) continue;
    const pre = prewrite(nameLatex(p.name), text.name, s);
    if (pre) names.set(p.name, pre);
  }
  const sideLabels = new Map<number, Pre>();
  fig.segments.forEach((sg, i) => {
    const s = next();
    const pre = sg.label ? prewrite(sg.label, text.side, s) : null;
    if (pre) sideLabels.set(i, pre);
  });
  const angleLabels = new Map<number, Pre>();
  fig.angles.forEach((g, i) => {
    const s = next();
    const pre = g.label ? prewrite(g.label, text.angle, s) : null;
    if (pre) angleLabels.set(i, pre);
  });
  const lineLabels = new Map<number, Pre>();
  fig.lines.forEach((l, i) => {
    const s = next();
    const pre = l.label ? prewrite(l.label, text.line, s) : null;
    if (pre) lineLabels.set(i, pre);
  });
  return { fig, seed, box, text, names, sideLabels, angleLabels, lineLabels, centres: sideCentres(fig), covered: coveredSides(fig) };
}

// ------------------------------------------------------------------ one layout at one scale

interface AngleMark {
  v: Pt;
  /** the wedge (px angles, y down): from lo, width wide; bis its middle */
  lo: number;
  width: number;
  bis: number;
  /** the mark's outer reach from the vertex */
  rOut: number;
}

function layoutAt(ctx: Ctx, xf: Xf): FigureLayout {
  const { fig, text } = ctx;
  const pen = new Pen(ctx.seed);
  const P = (v: V): Pt => ({ x: xf.ox + xf.s * v.x, y: xf.oy - xf.s * v.y });
  const pts = new Map<string, Pt>(fig.points.map((p) => [p.name, P(p.p)]));
  const shapes: FigurePart[] = [];
  const straights: Array<{ a: Pt; b: Pt; owner: string }> = [];
  const rounds: Array<{ c: Pt; r: number }> = [];

  // 1. sides: each polygon in turn, then the other segments
  fig.segments.forEach((s, i) => {
    const a = P(s.a);
    const b = P(s.b);
    straights.push({ a, b, owner: s.name });
    if (ctx.covered.has(i)) return;
    const strokes = s.dashed ? pen.dashed([a, b]) : pen.line(a, b);
    shapes.push({ kind: "side", owner: s.name, strokes, group: s.polygon !== undefined ? `polygon${s.polygon}` : "segments" });
  });

  // 2. lines and rays, run on, an arrowhead at each open end
  fig.lines.forEach((l) => {
    const e0 = P(l.ends[0]);
    const e1 = P(l.ends[1]);
    straights.push({ a: e0, b: e1, owner: l.name });
    const dx = e1.x - e0.x;
    const dy = e1.y - e0.y;
    const strokes = [...pen.line(e0, e1), ...pen.arrowhead(e1, dx, dy, FIGURE.lineArrow)];
    if (!l.ray) strokes.push(...pen.arrowhead(e0, -dx, -dy, FIGURE.lineArrow));
    shapes.push({ kind: "line", owner: l.name, strokes, group: "lines" });
  });

  // 3. circles
  for (const c of fig.circles) {
    const cc = P(c.c);
    const r = c.r * xf.s;
    rounds.push({ c: cc, r });
    const n = Math.max(32, Math.ceil((TAU * r) / 3));
    const a0 = pen.rng() * TAU;
    const sweep = TAU + (c.dashed ? 0 : 0.07);
    const ring: Pt[] = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + (sweep * i) / n;
      ring.push({ x: cc.x + r * Math.cos(a), y: cc.y + r * Math.sin(a) });
    }
    shapes.push({ kind: "circle", owner: c.name, strokes: c.dashed ? pen.dashed(ring) : pen.polyline(ring, 0.25), group: "circles" });
  }

  // 4. angle marks: an arc (or two or three, for equal angles) or a right-angle square
  const marks: AngleMark[] = [];
  const atVertex = new Map<string, number[]>();
  fig.angles.forEach((g, i) => {
    const v = P(g.v);
    const a = P(g.a);
    const b = P(g.b);
    const a1 = Math.atan2(a.y - v.y, a.x - v.x);
    const a2 = Math.atan2(b.y - v.y, b.x - v.x);
    let sweep = norm(a2 - a1);
    if (sweep > Math.PI) sweep -= TAU;
    const lo = sweep >= 0 ? a1 : a1 + sweep;
    const width = Math.abs(sweep);
    const arm = Math.min(len(v, a), len(v, b));
    let rOut: number;
    if (g.right) {
      const q = Math.min(FIGURE.square.max, Math.max(FIGURE.square.min, arm * FIGURE.square.frac), arm * 0.6);
      const u1 = unit(a1);
      const u2 = unit(a2);
      const corner = [
        { x: v.x + u1.x * q, y: v.y + u1.y * q },
        { x: v.x + (u1.x + u2.x) * q, y: v.y + (u1.y + u2.y) * q },
        { x: v.x + u2.x * q, y: v.y + u2.y * q },
      ];
      shapes.push({ kind: "right", owner: g.name, strokes: pen.polyline(corner, 0.15), group: "angles" });
      rOut = len(v, corner[1]);
    } else {
      const A = FIGURE.arc;
      let r = Math.min(A.max, Math.max(A.min, arm * A.frac));
      r = Math.max(r, A.minLen / Math.max(width, 1e-3));
      // an angle nested in another at the same vertex gets the next arc out
      for (const j of atVertex.get(g.at) ?? []) {
        const m = marks[j];
        const eps = 0.035;
        const overlaps =
          inWedge(lo + eps, m.lo, m.width) || inWedge(lo + width - eps, m.lo, m.width) || inWedge(m.lo + eps, lo, width) || inWedge(m.lo + m.width - eps, lo, width);
        if (overlaps) r = Math.max(r, m.rOut + 9);
      }
      r = Math.max(8, Math.min(r, arm * A.maxArm));
      const count = g.arcs ?? 1;
      const strokes: Stroke[] = [];
      for (let k = 0; k < count; k++) {
        const rk = r + k * A.step;
        const n = Math.max(6, Math.ceil((rk * width) / 3));
        const arc: Pt[] = [];
        for (let t = 0; t <= n; t++) {
          const ang = lo + (width * t) / n;
          arc.push({ x: v.x + rk * Math.cos(ang), y: v.y + rk * Math.sin(ang) });
        }
        strokes.push(...pen.polyline(arc, 0.15));
      }
      shapes.push({ kind: "arc", owner: g.name, strokes, group: "angles" });
      rOut = r + (count - 1) * A.step;
    }
    marks.push({ v, lo, width, bis: lo + width / 2, rOut });
    atVertex.set(g.at, [...(atVertex.get(g.at) ?? []), i]);
  });

  // 5. equal-length ticks and parallel arrows, on the middle of their side (both: arrows first, ticks after)
  const chevrons = (m: Pt, u: Pt, count: number): Stroke[] => {
    const C = FIGURE.chevron;
    const out: Stroke[] = [];
    const span = (count - 1) * C.step;
    for (let k = 0; k < count; k++) {
      const o = -span / 2 + k * C.step + (C.len * Math.cos(C.spread)) / 2;
      const tip = { x: m.x + u.x * o, y: m.y + u.y * o };
      const barb = (sgn: number): Pt => {
        const a = Math.atan2(u.y, u.x) + Math.PI + sgn * C.spread;
        return { x: tip.x + Math.cos(a) * C.len, y: tip.y + Math.sin(a) * C.len };
      };
      out.push(...pen.polyline([barb(1), tip, barb(-1)], 0.15));
    }
    return out;
  };
  const ticks = (m: Pt, u: Pt, count: number): Stroke[] => {
    const T = FIGURE.tick;
    const n = { x: -u.y, y: u.x };
    const out: Stroke[] = [];
    for (let k = 0; k < count; k++) {
      const o = (k - (count - 1) / 2) * T.step;
      const c = { x: m.x + u.x * o, y: m.y + u.y * o };
      out.push(...pen.line({ x: c.x - n.x * T.half, y: c.y - n.y * T.half }, { x: c.x + n.x * T.half, y: c.y + n.y * T.half }));
    }
    return out;
  };
  fig.segments.forEach((s: FigSegment) => {
    if (!s.ticks && !s.arrows) return;
    const a = P(s.a);
    const b = P(s.b);
    const L = len(a, b);
    const u = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const both = Boolean(s.ticks && s.arrows);
    if (s.arrows) {
      const shift = both ? -(8 + ((s.arrows - 1) * FIGURE.chevron.step) / 2 + FIGURE.chevron.len * 0.4) : 0;
      shapes.push({ kind: "arrow", owner: s.name, strokes: chevrons({ x: mid.x + u.x * shift, y: mid.y + u.y * shift }, u, s.arrows), group: "marks" });
    }
    if (s.ticks) {
      const shift = both ? 8 + ((s.ticks - 1) * FIGURE.tick.step) / 2 : 0;
      shapes.push({ kind: "tick", owner: s.name, strokes: ticks({ x: mid.x + u.x * shift, y: mid.y + u.y * shift }, u, s.ticks), group: "marks" });
    }
  });
  fig.lines.forEach((l) => {
    if (!l.arrows) return;
    const e0 = P(l.ends[0]);
    const e1 = P(l.ends[1]);
    const L = len(e0, e1);
    // the direction from → to (a line's ends run the same way as its points)
    const u = { x: (e1.x - e0.x) / L, y: (e1.y - e0.y) / L };
    const others = straights.filter((s) => s.owner !== l.name);
    const clearance = (p: Pt): number => {
      let d = Infinity;
      for (const s of others) d = Math.min(d, distToSegment(p, s.a, s.b));
      for (const c of rounds) d = Math.min(d, Math.abs(len(p, c.c) - c.r));
      for (const q of pts.values()) d = Math.min(d, len(p, q));
      return d;
    };
    let best: { p: Pt; d: number } | null = null;
    for (const t of [0.5, 0.4, 0.6, 0.32, 0.68, 0.25, 0.75, 0.18, 0.82]) {
      const p = { x: e0.x + (e1.x - e0.x) * t, y: e0.y + (e1.y - e0.y) * t };
      const d = clearance(p);
      if (d >= FIGURE.lineMarkClear) {
        best = { p, d };
        break;
      }
      if (!best || d > best.d) best = { p, d };
    }
    if (best) shapes.push({ kind: "arrow", owner: l.name, strokes: chevrons(best.p, u, l.arrows), group: "marks" });
  });

  // 6. dots: where asked, on a point on nothing, and where a named point would otherwise not show
  //    (at the end of a single stroke, or along a straight run with no corner there)
  const spokesAt = (p: Pt): number[] => {
    const out: number[] = [];
    const near = 1.5;
    for (const s of straights) {
      if (distToSegment(p, s.a, s.b) > near) continue;
      const toA = len(p, s.a) > near;
      const toB = len(p, s.b) > near;
      if (toA) out.push(Math.atan2(s.a.y - p.y, s.a.x - p.x));
      if (toB) out.push(Math.atan2(s.b.y - p.y, s.b.x - p.x));
    }
    for (const c of rounds) {
      if (Math.abs(len(p, c.c) - c.r) > near) continue;
      const a = Math.atan2(p.y - c.c.y, p.x - c.c.x);
      out.push(a + Math.PI / 2, a - Math.PI / 2);
    }
    return out.map(norm);
  };
  const dots: FigurePart[] = [];
  const dotted = new Set<string>();
  for (const fp of fig.points) {
    const p = pts.get(fp.name)!;
    const sp = spokesAt(p);
    const straightThrough = sp.length > 0 && sp.every((a) => {
      const d = norm(a - sp[0]) % Math.PI;
      return Math.min(d, Math.PI - d) < (8 * Math.PI) / 180;
    });
    // an unnamed point along a stroke is only a construction point: no dot unless asked
    if (!(fp.dot ?? (sp.length === 0 || (fp.label && straightThrough)))) continue;
    dotted.add(fp.name);
    dots.push({ kind: "dot", owner: fp.name, strokes: pen.dot(p, FIGURE.dotR), group: "dots" });
  }
  shapes.push(...dots);

  // 7. the writing, each label at its best clear spot
  const grid = new InkGrid();
  for (const s of shapes) grid.add(s.strokes);
  const placed: Rect[] = [];
  let collisions = 0;
  /** the first candidate (centres) touching nothing, else the one touching least */
  const choose = (pre: Pre, centres: readonly Pt[]): { rect: Rect; hits: number } | null => {
    let best: { rect: Rect; hits: number } | null = null;
    for (const c of centres) {
      const rect = { x: c.x - pre.w / 2, y: c.y - pre.h / 2, w: pre.w, h: pre.h };
      let hits = grid.count(rect, FIGURE.clear);
      for (const r of placed) if (rectsOverlap(r, rect, FIGURE.labelPad)) hits += 50;
      if (!best || hits < best.hits) best = { rect, hits };
      if (hits === 0) break;
    }
    return best;
  };
  const put = (pre: Pre, centres: readonly Pt[], kind: FigurePartKind, owner: string, into: FigurePart[]): void => {
    const got = choose(pre, centres);
    if (!got) return;
    if (got.hits > 0) collisions++;
    placed.push(got.rect);
    into.push({ kind, owner, latex: pre.latex, strokes: moved(pre.strokes, got.rect.x, got.rect.y), rect: got.rect, group: `${kind}:${owner}` });
  };

  const centroid = (() => {
    const all = [...pts.values()];
    return all.length ? { x: all.reduce((t, p) => t + p.x, 0) / all.length, y: all.reduce((t, p) => t + p.y, 0) / all.length } : { x: 0, y: 0 };
  })();

  // point names: outside, in the widest gap between the strokes meeting there (angle marks count as strokes)
  const names: FigurePart[] = [];
  for (const fp of fig.points) {
    const pre = ctx.names.get(fp.name);
    if (!pre) continue;
    const p = pts.get(fp.name)!;
    const sp = spokesAt(p);
    // a marked angle at the point is taken, all of it: the name goes elsewhere
    fig.angles.forEach((g, i) => {
      if (g.at !== fp.name) return;
      const m = marks[i];
      const n = Math.max(2, Math.ceil(m.width / ((20 * Math.PI) / 180)));
      for (let k = 1; k < n; k++) sp.push(norm(m.lo + (m.width * k) / n));
    });
    const away = len(p, centroid) > 1 ? Math.atan2(p.y - centroid.y, p.x - centroid.x) : -Math.PI / 4;
    const gaps = gapsOf(sp, away);
    const gap = FIGURE.gap.name + (dotted.has(fp.name) ? FIGURE.dotR : 0);
    const centres: Pt[] = [];
    const step = (15 * Math.PI) / 180;
    for (const g of gaps) {
      const lo = g.mid - g.width / 2;
      const half = Math.max(0, g.width / 2 - (20 * Math.PI) / 180);
      for (const extra of [0, 5, 11, 18]) {
        for (let k = 0; k * step <= half + 1e-9; k++) {
          for (const sgn of k === 0 ? [1] : [1, -1]) {
            const dir = g.mid + sgn * k * step;
            const u = unit(dir);
            const d = outAlong(dir, lo, g.width, pre.w + 2 * FIGURE.clear, pre.h + 2 * FIGURE.clear, gap, gap + reachP(pre, u), 40) + extra;
            centres.push({ x: p.x + u.x * d, y: p.y + u.y * d });
          }
        }
      }
    }
    put(pre, centres, "name", fp.name, names);
  }

  // angle labels: inside, on the bisector, past the arc
  const angleLabels: FigurePart[] = [];
  fig.angles.forEach((g, i) => {
    const pre = ctx.angleLabels.get(i);
    if (!pre) return;
    const m = marks[i];
    const gapA = FIGURE.gap.angle;
    const centres: Pt[] = [];
    /** how far out along `dir` the label's centre must be: past the arc, and clear of both arms */
    const along = (dir: number): number => outAlong(dir, m.lo, m.width, pre.w + 2 * FIGURE.clear, pre.h + 2 * FIGURE.clear, gapA, m.rOut + gapA + reachP(pre, unit(dir)));
    for (const turn of [0, 0.18, -0.18, 0.32, -0.32]) {
      const dir = m.bis + turn * m.width;
      const d0 = along(dir);
      const u = unit(dir);
      for (const extra of [0, 5, 11, 18, 27]) centres.push({ x: m.v.x + u.x * (d0 + extra), y: m.v.y + u.y * (d0 + extra) });
    }
    // last resorts (a sliver of an angle has no room inside): just past the arc anywhere along it,
    // then just outside the angle beside either arm, then further out along the bisector
    const outAt = (dir: number, extra: number): Pt => {
      const u = unit(dir);
      const d = m.rOut + gapA + reachP(pre, u) + extra;
      return { x: m.v.x + u.x * d, y: m.v.y + u.y * d };
    };
    for (const extra of [0, 10, 22]) for (const t of [0.5, 0.25, 0.75, 0, 1]) centres.push(outAt(m.lo + m.width * t, extra));
    for (const extra of [0, 10, 22]) for (const k of [1, 2, 3]) centres.push(outAt(m.lo - k * 0.3, extra), outAt(m.lo + m.width + k * 0.3, extra));
    for (const extra of [40, 60, 85, 115]) centres.push(outAt(m.bis, extra));
    put(pre, centres, "angleLabel", g.name, angleLabels);
  });

  // side labels: beside the middle, away from the side's polygon (or the figure)
  const sideLabels: FigurePart[] = [];
  fig.segments.forEach((s, i) => {
    const pre = ctx.sideLabels.get(i);
    if (!pre) return;
    const a = P(s.a);
    const b = P(s.b);
    const L = len(a, b);
    let n = { x: -(b.y - a.y) / L, y: (b.x - a.x) / L };
    const c = P(ctx.centres.get(i) ?? s.a);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const side = (c.x - mid.x) * n.x + (c.y - mid.y) * n.y;
    if (side > 1e-6 || (Math.abs(side) <= 1e-6 && n.y > 0)) n = { x: -n.x, y: -n.y };
    const marked = s.ticks || s.arrows ? FIGURE.tick.half + 2 : 0;
    const centres: Pt[] = [];
    for (const sgn of [1, -1]) {
      const nn = { x: n.x * sgn, y: n.y * sgn };
      const d0 = Math.max(FIGURE.gap.side, marked) + reachP(pre, nn);
      for (const extra of [0, 5, 11, 19]) {
        for (const t of [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74]) {
          centres.push({ x: a.x + (b.x - a.x) * t + nn.x * (d0 + extra), y: a.y + (b.y - a.y) * t + nn.y * (d0 + extra) });
        }
      }
    }
    put(pre, centres, "sideLabel", s.name, sideLabels);
  });

  // line names: near an open end, beside the line
  const lineLabels: FigurePart[] = [];
  fig.lines.forEach((l, i) => {
    const pre = ctx.lineLabels.get(i);
    if (!pre) return;
    const e0 = P(l.ends[0]);
    const e1 = P(l.ends[1]);
    const ends: Array<[Pt, Pt]> = l.ray ? [[e1, e0]] : [[e1, e0], [e0, e1]];
    const centres: Pt[] = [];
    for (const [end, other] of ends) {
      const L = len(end, other);
      const u = { x: (other.x - end.x) / L, y: (other.y - end.y) / L };
      for (const s of [14, 30, 48, 70]) {
        for (const sgn of [1, -1]) {
          const n = { x: -u.y * sgn, y: u.x * sgn };
          const d = FIGURE.gap.line + reachP(pre, n);
          centres.push({ x: end.x + u.x * (s + reachP(pre, u)) + n.x * d, y: end.y + u.y * (s + reachP(pre, u)) + n.y * d });
        }
      }
    }
    put(pre, centres, "lineLabel", l.name, lineLabels);
  });

  const parts = [...shapes, ...names, ...sideLabels, ...angleLabels, ...lineLabels];
  const b = strokeBounds(parts.flatMap((p) => p.strokes));
  return {
    parts,
    points: Object.fromEntries(pts),
    scale: xf.s,
    collisions,
    bounds: b ? { x: b.minX, y: b.minY, w: b.width, h: b.height } : { x: 0, y: 0, w: 0, h: 0 },
    size: text.name,
  };
}

/**
 * The gaps between the directions (radians) leaving a point, widest first — among gaps nearly as
 * wide as the widest, the one facing `away` first. No directions: one full turn facing `away`.
 */
function gapsOf(dirs: readonly number[], away: number): Array<{ mid: number; width: number }> {
  if (dirs.length === 0) return [{ mid: away, width: TAU }];
  const s = [...dirs].sort((a, b) => a - b);
  const gaps: Array<{ mid: number; width: number }> = [];
  for (let i = 0; i < s.length; i++) {
    const a = s[i];
    const b = i + 1 < s.length ? s[i + 1] : s[0] + TAU;
    const width = b - a;
    if (width < 1e-6) continue;
    gaps.push({ mid: a + width / 2, width });
  }
  if (gaps.length === 0) return [{ mid: away, width: TAU }];
  const widest = Math.max(...gaps.map((g) => g.width));
  const facing = (g: { mid: number }) => {
    const d = Math.abs(norm(g.mid - away));
    return Math.min(d, TAU - d);
  };
  return gaps.sort((a, b) => {
    const aBig = a.width >= widest * 0.8;
    const bBig = b.width >= widest * 0.8;
    if (aBig !== bBig) return aBig ? -1 : 1;
    if (aBig) return facing(a) - facing(b);
    return b.width - a.width;
  });
}

// ------------------------------------------------------------------ fitting

/** Moves a layout by (dx, dy). */
function shifted(L: FigureLayout, dx: number, dy: number): FigureLayout {
  return {
    ...L,
    parts: L.parts.map((p) => ({ ...p, strokes: moved(p.strokes, dx, dy), rect: p.rect ? { ...p.rect, x: p.rect.x + dx, y: p.rect.y + dy } : undefined })),
    points: Object.fromEntries(Object.entries(L.points).map(([k, p]) => [k, { x: p.x + dx, y: p.y + dy }])),
    bounds: { ...L.bounds, x: L.bounds.x + dx, y: L.bounds.y + dy },
  };
}

/**
 * The figure laid out in the box: the largest scale at which every label finds a clear spot (or,
 * failing that, the fewest collide) and the whole ink fits, centred. Null when the spec has nothing
 * that can be drawn or the box cannot hold it. Exported for tests and the gallery; `planFigure`
 * turns it into the plan.
 */
export function layoutFigure(spec: FigureSpec, opts: FigurePlanOptions): FigureLayout | null {
  const box = opts?.box;
  if (!box || !Number.isFinite(box.w) || !Number.isFinite(box.h) || box.w < 40 || box.h < 40) return null;
  let fig: Figure;
  try {
    fig = resolveFigure(spec).fig;
  } catch {
    return null;
  }
  if (fig.points.length === 0) return null;
  const drawable = fig.segments.length + fig.lines.length + fig.circles.length + fig.angles.length > 0 || fig.points.some((p) => p.label || p.dot !== false);
  if (!drawable) return null;
  const ctx = makeCtx(fig, (opts.seed ?? 0) >>> 0, box);
  const { minX, minY, maxX, maxY } = fig.extent;
  const extW = maxX - minX;
  const extH = maxY - minY;
  const flat = 1e-9 * fig.size;
  const scaleFor = (w: number, h: number): number => {
    const s = Math.min(extW > flat ? w / extW : Infinity, extH > flat ? h / extH : Infinity);
    return Number.isFinite(s) && s > 0 ? s : 1;
  };
  const centred = (s: number): Xf => ({ s, ox: box.w / 2 - s * ((minX + maxX) / 2), oy: box.h / 2 + s * ((minY + maxY) / 2) });
  const margin = ctx.text.name + 12;
  let s = scaleFor(Math.max(box.w - 2 * margin, box.w * 0.4), Math.max(box.h - 2 * margin, box.h * 0.4));
  const s0 = s;
  const fits = (L: FigureLayout) => L.bounds.w <= box.w + 0.01 && L.bounds.h <= box.h + 0.01;
  /** the scale at which this layout's ink (the labels hang the same px past the figure) just fills the box */
  const fill = (L: FigureLayout) => {
    const room = (need: number, ext: number, got: number) => (ext > flat ? (need - (got - ext * L.scale)) / ext : Infinity);
    return Math.min(room(box.w, extW, L.bounds.w), room(box.h, extH, L.bounds.h));
  };
  let best: FigureLayout | null = null;
  let grown = 0;
  for (let round = 0; round < FIGURE.fit.rounds; round++) {
    const L = layoutAt(ctx, centred(s));
    const ok = fits(L);
    if (ok && (!best || L.collisions < best.collisions || (L.collisions === best.collisions && L.scale > best.scale))) best = L;
    if (ok && L.collisions === 0) {
      // clear: grow back into any room the first guess at the labels' margin left (twice at most)
      const next = fill(L) * 0.995;
      if (grown >= 2 || !Number.isFinite(next) || next <= s * 1.01) break;
      grown++;
      s = next;
      continue;
    }
    if (grown > 0) break;
    if (!ok) {
      // labels hang this far past the figure: make room for them
      const next = fill(L) * 0.985;
      s = Number.isFinite(next) && next > 0 ? Math.min(next, s * 0.97) : s * 0.8;
    } else {
      if (s * FIGURE.fit.shrink < s0 * FIGURE.fit.minScale) break;
      s *= FIGURE.fit.shrink;
    }
  }
  if (!best) return null;
  return shifted(best, (box.w - best.bounds.w) / 2 - best.bounds.x, (box.h - best.bounds.h) / 2 - best.bounds.y);
}

/** The figure in the tutor's hand, fitted to `opts.box` true to scale, or null when it cannot be drawn. */
export function planFigure(spec: FigureSpec, opts: FigurePlanOptions): FigurePlanResult | null {
  const L = layoutFigure(spec, opts);
  if (!L) return null;
  const groups: Array<{ label: string; strokes: Stroke[] }> = [];
  let key = "";
  for (const p of L.parts) {
    if (p.strokes.length === 0) continue;
    if (groups.length > 0 && p.group === key) {
      groups[groups.length - 1].strokes.push(...p.strokes);
      continue;
    }
    key = p.group;
    groups.push({ label: p.latex ?? "", strokes: [...p.strokes] });
  }
  const plan = planFromGroups(groups, L.size);
  return plan ? { plan, points: L.points } : null;
}
