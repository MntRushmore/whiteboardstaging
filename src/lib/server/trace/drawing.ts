import { LECTURE_SKETCH_LIMITS, type LectureInk } from "@/lib/live/lecture/contracts";
import { nearestInk } from "@/lib/server/sketch/colour";
import { bbox, extent, type Pt } from "@/lib/server/sketch/geometry";
import type { Working } from "./bitmap";
import type { Ink } from "./ink";

/**
 * From working pixels to the board's drawing: the box, the inks, the order, the caps.
 *
 * THE BOX. A drawing is 1000 wide and h tall, h = 1000 × the picture's height / width within the
 * contract's 300..2500. A picture too wide or too tall for that is fitted inside, centred, and
 * padded, never stretched: a circle stays round.
 *
 * INK. A stroke's colour is read along its own centreline, from the most-inked pixel next to each
 * skeleton pixel (a thin anti-aliased line's middle is its truest colour, its fringe is half
 * paper), and named by the board's marker rule (`nearestInk`: by hue, reds are orange). A neutral
 * line is black unless it is clearly lighter than the picture's main ink (under 55 % of its
 * contrast) — the pale dashed axes of a free-body diagram are grey, its forces black.
 *
 * ORDER. As a person draws a figure: the big shapes first, then the middle-sized parts, then the
 * small details and the writing; each tier in rows top to bottom, each row left to right.
 *
 * CAPS. A stroke past the contract's points is cut into pieces that share their ends; past the
 * drawing's points everything is simplified harder (the caller re-finishes); past its strokes or
 * points still, the smallest strokes go first.
 */

export interface Frame {
  h: number;
  /** drawing units per working pixel */
  s: number;
  ox: number;
  oy: number;
}

export function frameFor(w: number, h: number): Frame {
  const H = Math.round(Math.max(300, Math.min(2500, (1000 * h) / w)));
  const s = Math.min(1000 / w, H / h);
  return { h: H, s, ox: (1000 - w * s) / 2, oy: (H - h * s) / 2 };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Working pixels → the drawing's units, rounded to 0.1 and kept inside the box. */
export function place(points: readonly Pt[], f: Frame): Pt[] {
  const out: Pt[] = [];
  for (const [x, y] of points) {
    const p: Pt = [round1(Math.max(0, Math.min(1000, f.ox + x * f.s))), round1(Math.max(0, Math.min(f.h, f.oy + y * f.s)))];
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  return out;
}

/** The marker a stroke is drawn in, read along its skeleton pixels (padded indices). */
export function strokeInk(px: readonly number[], W2: number, work: Working, ink: Ink): LectureInk {
  const { w, h, rgb } = work;
  const score = ink.score;
  let r = 0;
  let g = 0;
  let b = 0;
  let s = 0;
  let n = 0;
  const step = Math.max(1, Math.floor(px.length / 400));
  for (let i = 0; i < px.length; i += step) {
    const p = px[i];
    const x0 = (p % W2) - 1;
    const y0 = Math.floor(p / W2) - 1;
    let best = -1;
    let at = -1;
    for (let dy = -1; dy <= 1; dy++) {
      const y = y0 + dy;
      if (y < 0 || y >= h) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const x = x0 + dx;
        if (x < 0 || x >= w) continue;
        const q = y * w + x;
        if (score[q] > best) {
          best = score[q];
          at = q;
        }
      }
    }
    if (at < 0) continue;
    r += rgb[at * 3];
    g += rgb[at * 3 + 1];
    b += rgb[at * 3 + 2];
    s += best;
    n++;
  }
  if (!n) return "black";
  const named = nearestInk({ r: r / n, g: g / n, b: b / n });
  if (named !== "black" && named !== "grey" && named !== "white") return named;
  return s / n >= 0.55 * Math.max(1, ink.contrast) ? "black" : "grey";
}

export interface Placed {
  points: Pt[];
  closed: boolean;
  color: LectureInk;
}

/** Big shapes, then parts, then details; each in rows, top to bottom, left to right. */
export function drawingOrder<S extends Placed>(strokes: readonly S[]): S[] {
  if (strokes.length <= 1) return strokes.slice();
  const boxes = strokes.map((s) => bbox(s.points));
  const all = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const b of boxes) {
    all.x0 = Math.min(all.x0, b.x0);
    all.y0 = Math.min(all.y0, b.y0);
    all.x1 = Math.max(all.x1, b.x1);
    all.y1 = Math.max(all.y1, b.y1);
  }
  const D = Math.max(1, Math.hypot(all.x1 - all.x0, all.y1 - all.y0));
  const items = strokes.map((s, i) => {
    const b = boxes[i];
    const e = extent(s.points);
    return { s, i, b, cy: (b.y0 + b.y1) / 2, tier: e >= 0.2 * D ? 0 : e >= 0.06 * D ? 1 : 2 };
  });
  const out: S[] = [];
  for (let tier = 0; tier < 3; tier++) {
    const group = items.filter((it) => it.tier === tier).sort((a, b) => a.cy - b.cy || a.b.x0 - b.b.x0 || a.i - b.i);
    if (!group.length) continue;
    const heights = group.map((it) => it.b.y1 - it.b.y0).sort((a, b) => a - b);
    const rowH = Math.max(4, heights[Math.floor(heights.length / 2)]);
    let row: typeof group = [];
    let top = group[0].cy;
    const flush = () => {
      row.sort((a, b) => a.b.x0 - b.b.x0 || a.cy - b.cy || a.i - b.i);
      for (const it of row) out.push(it.s);
      row = [];
    };
    for (const it of group) {
      if (row.length && it.cy > top + rowH) {
        flush();
        top = it.cy;
      }
      row.push(it);
    }
    flush();
  }
  return out;
}

/** Strokes past the per-stroke cap cut into pieces sharing their ends; how many were cut. */
export function splitLong<S extends Placed>(strokes: readonly S[]): { strokes: S[]; split: number } {
  const max = LECTURE_SKETCH_LIMITS.pointsPerStroke;
  const out: S[] = [];
  let split = 0;
  for (const s of strokes) {
    const pts = s.closed ? [...s.points, s.points[0]] : s.points;
    if (pts.length <= max) {
      out.push(s);
      continue;
    }
    split++;
    for (let i = 0; i < pts.length - 1; i += max - 1) out.push({ ...s, points: pts.slice(i, i + max), closed: false });
  }
  return { strokes: out.filter((s) => s.points.length >= 2), split };
}

export const totalPoints = (strokes: ReadonlyArray<{ points: readonly unknown[] }>) => strokes.reduce((n, s) => n + s.points.length, 0);

/** While there are too many strokes or points, the smallest strokes go (ties: the later one). How many went. */
export function dropSmallest<S extends Placed>(strokes: readonly S[]): { strokes: S[]; dropped: number } {
  const L = LECTURE_SKETCH_LIMITS;
  let count = strokes.length;
  let points = totalPoints(strokes);
  if (count <= L.strokes && points <= L.points) return { strokes: strokes.slice(), dropped: 0 };
  const order = strokes.map((s, i) => ({ i, e: extent(s.points), n: s.points.length })).sort((a, b) => a.e - b.e || b.i - a.i);
  const gone = new Set<number>();
  for (const { i, n } of order) {
    if (count <= L.strokes && points <= L.points) break;
    gone.add(i);
    count--;
    points -= n;
  }
  return { strokes: strokes.filter((_, i) => !gone.has(i)), dropped: gone.size };
}
