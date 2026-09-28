import { layoutMath, mulberry32, placeStrokes, type InkPt, type Stroke } from "@/lib/hand";
import type { Rect } from "../contracts";

/**
 * The pen of the tutor's sketches: straight lines that are not ruled, arrowheads, dashes, dots,
 * rings and small maths written in the same hand as the worked steps (`layoutMath`). Pure
 * geometry in px, y down; every stroke is one pen-down, the way the HandWriter reveals it.
 */

export type Pt = { x: number; y: number };

export const PEN = {
  /** max px between two points of a stroke (the HandWriter reveals point by point) */
  step: 2,
  /** a stroke longer than this is split into consecutive strokes (the reveal caps points per stroke) */
  maxStrokePx: 260,
  /** how far a hand-drawn straight line bows, as a fraction of its length (capped) */
  bow: 0.004,
  bowMax: 1.4,
  jitter: 0.35,
  arrowLen: 10,
  arrowAngle: 0.46,
  dash: 9,
  gap: 6,
  dotR: 3.2,
  ringR: 6,
} as const;

export class Pen {
  readonly rng: () => number;
  private order = 0;
  constructor(seed: number) {
    this.rng = mulberry32(seed >>> 0);
  }

  /** A fresh seed from this pen's stream (for the glyphs of a label). */
  seed(): number {
    return Math.floor(this.rng() * 2 ** 31);
  }

  private stroke(points: InkPt[]): Stroke {
    return { points, order: this.order++, kind: "rule" };
  }

  private z(): number {
    return 0.42 + this.rng() * 0.16;
  }

  /** Points of a polyline, resampled to `PEN.step` with a touch of tremor, split into pen-sized strokes. */
  polyline(points: readonly Pt[], jitter: number = PEN.jitter): Stroke[] {
    if (points.length < 2) return [];
    const dense: InkPt[] = [];
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (i === 0) {
        dense.push({ x: p.x, y: p.y, z: this.z() });
        continue;
      }
      const a = points[i - 1];
      const n = Math.max(1, Math.ceil(Math.hypot(p.x - a.x, p.y - a.y) / PEN.step));
      for (let k = 1; k <= n; k++) {
        const t = k / n;
        dense.push({
          x: a.x + (p.x - a.x) * t + (this.rng() - 0.5) * jitter,
          y: a.y + (p.y - a.y) * t + (this.rng() - 0.5) * jitter,
          z: this.z(),
        });
      }
    }
    // pin the ends: the tremor is along the way, not where the pen lands
    dense[0] = { ...dense[0], x: points[0].x, y: points[0].y };
    const last = points[points.length - 1];
    dense[dense.length - 1] = { ...dense[dense.length - 1], x: last.x, y: last.y };
    const out: Stroke[] = [];
    let cur: InkPt[] = [dense[0]];
    let len = 0;
    for (let i = 1; i < dense.length; i++) {
      const p = dense[i];
      len += Math.hypot(p.x - cur[cur.length - 1].x, p.y - cur[cur.length - 1].y);
      cur.push(p);
      if (len >= PEN.maxStrokePx && i < dense.length - 1) {
        out.push(this.stroke(cur));
        cur = [p];
        len = 0;
      }
    }
    if (cur.length >= 2) out.push(this.stroke(cur));
    return out;
  }

  /** A straight line drawn freehand: a faint bow and a little tremor, ends exactly where asked. */
  line(a: Pt, b: Pt): Stroke[] {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 0.5) return [];
    const nx = -(b.y - a.y) / len;
    const ny = (b.x - a.x) / len;
    const bow = Math.min(PEN.bowMax, len * PEN.bow) * (this.rng() < 0.5 ? -1 : 1);
    const n = Math.max(2, Math.ceil(len / 6));
    const pts: Pt[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const off = bow * Math.sin(Math.PI * t);
      pts.push({ x: a.x + (b.x - a.x) * t + nx * off, y: a.y + (b.y - a.y) * t + ny * off });
    }
    return this.polyline(pts, PEN.jitter * 0.8);
  }

  /** An arrowhead at `tip` pointing along (dx, dy): one stroke, barb → tip → barb. */
  arrowhead(tip: Pt, dx: number, dy: number, len: number = PEN.arrowLen): Stroke[] {
    const d = Math.hypot(dx, dy) || 1;
    const ux = dx / d;
    const uy = dy / d;
    const barb = (sign: number): Pt => {
      const a = Math.PI + sign * PEN.arrowAngle;
      const c = Math.cos(a);
      const s = Math.sin(a);
      return { x: tip.x + (ux * c - uy * s) * len, y: tip.y + (ux * s + uy * c) * len };
    };
    return this.polyline([barb(1), tip, barb(-1)], 0.2);
  }

  /** A polyline drawn as dashes (each dash its own pen stroke). */
  dashed(points: readonly Pt[], dash: number = PEN.dash, gap: number = PEN.gap): Stroke[] {
    const out: Stroke[] = [];
    let cur: Pt[] = [];
    let on = true;
    let left = dash * (0.5 + this.rng() * 0.5);
    for (let i = 1; i < points.length; i++) {
      let a = points[i - 1];
      const b = points[i];
      let seg = Math.hypot(b.x - a.x, b.y - a.y);
      while (seg > 0) {
        const take = Math.min(seg, left);
        const t = take / seg;
        const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        if (on) {
          if (cur.length === 0) cur.push(a);
          cur.push(p);
        }
        seg -= take;
        left -= take;
        a = p;
        if (left <= 1e-9) {
          if (on && cur.length >= 2) out.push(...this.polyline(cur, 0.2));
          cur = [];
          on = !on;
          left = on ? dash : gap;
        }
      }
    }
    if (on && cur.length >= 2 && Math.hypot(cur[cur.length - 1].x - cur[0].x, cur[cur.length - 1].y - cur[0].y) > 2) {
      out.push(...this.polyline(cur, 0.2));
    }
    return out;
  }

  /** A filled dot: a small spiral in to the centre. */
  dot(c: Pt, r: number = PEN.dotR): Stroke[] {
    const pts: Pt[] = [];
    const turns = 2.4;
    const n = 30;
    const a0 = this.rng() * Math.PI * 2;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const a = a0 + t * turns * Math.PI * 2;
      const rr = r * (1 - t * 0.85);
      pts.push({ x: c.x + rr * Math.cos(a), y: c.y + rr * Math.sin(a) });
    }
    return this.polyline(pts, 0.1);
  }

  /** An open ring of radius r, closed with a small overlap. */
  ring(c: Pt, r: number = PEN.ringR): Stroke[] {
    const pts: Pt[] = [];
    const a0 = -Math.PI * 0.6 + (this.rng() - 0.5) * 0.4;
    const sweep = Math.PI * 2 + 0.35;
    const n = 28;
    for (let i = 0; i <= n; i++) {
      const a = a0 + (sweep * i) / n;
      const wob = 1 + (this.rng() - 0.5) * 0.04;
      pts.push({ x: c.x + r * wob * Math.cos(a), y: c.y + r * wob * Math.sin(a) });
    }
    return this.polyline(pts, 0.1);
  }

  /** A filled ring: the ring, then its inside coloured in. */
  disc(c: Pt, r: number = PEN.ringR): Stroke[] {
    return [...this.ring(c, r), ...this.dot(c, r - 1.2)];
  }
}

export type Align = "left" | "center" | "right";
export type VAlign = "top" | "middle" | "bottom";

export interface Written {
  strokes: Stroke[];
  rect: Rect;
  latex: string;
}

/**
 * A glyph's polyline resampled to `PEN.step` (geometry unchanged). tldraw's freehand smoothing
 * pulls each point only part of the way to the next, so a sparse glyph loses its corners on the
 * board — the flag of a small `4` collapses into a `1` (see `HAND_WRITE.resampleStepPx`).
 */
function resample(points: readonly InkPt[]): InkPt[] {
  const out: InkPt[] = points.length ? [{ ...points[0] }] : [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / PEN.step));
    for (let k = 1; k <= n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
  }
  return out;
}

/** Maths in the tutor's hand, placed by an anchor point and alignment. Null when the hand cannot write it. */
export function writeMath(latex: string, at: Pt, align: Align, valign: VAlign, size: number, seed: number): Written | null {
  const laid = layoutMath(latex, { size, seed });
  if (laid.unsupported.length > 0 || laid.strokes.length === 0) return null;
  const x = align === "left" ? at.x : align === "center" ? at.x - laid.width / 2 : at.x - laid.width;
  const y = valign === "top" ? at.y : valign === "middle" ? at.y - laid.height / 2 : at.y - laid.height;
  return {
    latex,
    strokes: placeStrokes(laid.strokes, { x, y }).map((s) => ({ ...s, points: resample(s.points), kind: "glyph" as const })),
    rect: { x, y, w: laid.width, h: laid.height },
  };
}

/** Clips the segment a→b to the rect; null when it misses (Liang–Barsky). */
export function clipSegment(a: Pt, b: Pt, r: Rect): [Pt, Pt, boolean, boolean] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const edges: Array<[number, number]> = [
    [-dx, a.x - r.x],
    [dx, r.x + r.w - a.x],
    [-dy, a.y - r.y],
    [dy, r.y + r.h - a.y],
  ];
  for (const [p, q] of edges) {
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
  return [
    { x: a.x + dx * t0, y: a.y + dy * t0 },
    { x: a.x + dx * t1, y: a.y + dy * t1 },
    t0 === 0,
    t1 === 1,
  ];
}

/** The parts of a polyline inside the rect, each a polyline of its own. */
export function clipPolyline(points: readonly Pt[], r: Rect): Pt[][] {
  const out: Pt[][] = [];
  let cur: Pt[] = [];
  for (let i = 1; i < points.length; i++) {
    const c = clipSegment(points[i - 1], points[i], r);
    if (!c) {
      if (cur.length >= 2) out.push(cur);
      cur = [];
      continue;
    }
    const [p, q, startKept, endKept] = c;
    if (cur.length === 0 || !startKept) {
      if (cur.length >= 2) out.push(cur);
      cur = [p];
    }
    cur.push(q);
    if (!endKept) {
      if (cur.length >= 2) out.push(cur);
      cur = [];
    }
  }
  if (cur.length >= 2) out.push(cur);
  return out;
}

export function rectsOverlap(a: Rect, b: Rect, pad = 0): boolean {
  return a.x - pad < b.x + b.w && a.x + a.w + pad > b.x && a.y - pad < b.y + b.h && a.y + a.h + pad > b.y;
}

export function inRect(p: Pt, r: Rect, pad = 0): boolean {
  return p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad;
}
