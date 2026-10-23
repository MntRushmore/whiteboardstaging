import type { Pt } from "@/lib/server/sketch/geometry";
import { maxDot } from "./dots";
import { ring } from "./raster";

/**
 * SOLIDS: filled shapes — an arrowhead drawn as a solid triangle, a chart's bar, a filled disc, a
 * blacked-in box. Their skeleton is a medial axis no pen draws (a line down a bar, a "Y" in a
 * triangle, which pruning then shrinks to nothing), so a person's way is taken instead: OUTLINE
 * the shape. The lines that run into it (the arrow's shaft) still trace as lines, up to its edge.
 *
 * A solid is where the ink is far thicker than the drawing's lines: the morphological OPENING of
 * the ink by a disc of `seed` radius (1.5 × the width of the drawing's lines, 3 px when it has
 * none): what is left of the ink
 * after eroding it by that disc and growing it back. A line of the drawing's own width vanishes
 * in the erosion; a thick blob survives, nearly whole. Two more tests keep it a SHAPE:
 * - compact, not a thick line: its area under 6 × (2 × its inscribed radius)², i.e. under ~6
 *   widths long (an emphasised thick stroke among thin ones stays a centreline);
 * - big: its inscribed disc at least 1.6 seeds across in radius (~2.4 line widths) and its area at
 *   least 2π·seed², so the fat point where three strokes converge (an arrow's tip), a spot where a
 *   pencil sketch's lines were drawn over and over, or a small dot is not outlined (small dots are
 *   `blobs`, with their own tests).
 *
 * The outline is the shape's edge brought in by about half a line width, so a pen of the
 * drawing's width drawn on it stays inside the shape. What the skeleton leaves in the shape's
 * corners (the opening rounds them off) is within `near` and dropped by the caller.
 */

export interface Solids {
  /** padded: 1 inside a solid */
  mask: Uint8Array;
  /** padded: 1 on ink within two seeds' reach of a solid (its corners, which the opening rounds off) */
  near: Uint8Array;
  /**
   * each solid's outline (working pixels, closed, no repeated end) and the padded pixels it runs
   * along; a solid that is a round disc no bigger than a dot (`maxDot`) is a DOT instead (`disc`),
   * drawn filled like one
   */
  outlines: Array<{ pts: Pt[]; px: number[]; disc?: { x: number; y: number; r: number } }>;
}

const MAX_ELONGATION = 6;

/** Pixel offsets (dx, dy pairs) of a disc of radius `R`. */
function disc(R: number): Int32Array {
  const K = Math.ceil(R);
  const out: number[] = [];
  for (let dy = -K; dy <= K; dy++) for (let dx = -K; dx <= K; dx++) if (dx * dx + dy * dy <= R * R) out.push(dx, dy);
  return Int32Array.from(out);
}

/** Set `out` on ink within `R` of the set `inSet` (given as its pixels): a disc stamped at each of its edge pixels. */
function dilate(pixels: readonly number[], inSet: Uint8Array, ink: Uint8Array, W2: number, R: number, out: Uint8Array): void {
  const H2 = ink.length / W2;
  const N = ring(W2);
  const D = disc(R);
  for (const p of pixels) {
    out[p] = 1;
    let edge = false;
    for (let d = 0; d < 8 && !edge; d++) if (!inSet[p + N[d]]) edge = true;
    if (!edge) continue;
    const px = p % W2;
    const py = (p - px) / W2;
    for (let k = 0; k < D.length; k += 2) {
      const x = px + D[k];
      const y = py + D[k + 1];
      if (x < 0 || y < 0 || x >= W2 || y >= H2) continue;
      const q = y * W2 + x;
      if (ink[q]) out[q] = 1;
    }
  }
}

export function findSolids(ink: Uint8Array, r: Float32Array, W2: number, lineWidth: number): Solids | null {
  const size = ink.length;
  const seed = Math.max(2.5, 1.5 * lineWidth);
  // the eroded ink: pixels at least `seed` from the paper
  const core: number[] = [];
  const isCore = new Uint8Array(size);
  for (let p = 0; p < size; p++) {
    if (r[p] >= seed) {
      core.push(p);
      isCore[p] = 1;
    }
  }
  if (!core.length) return null;
  // grown back by the same disc
  const opened = new Uint8Array(size);
  dilate(core, isCore, ink, W2, seed + 0.5, opened);

  // its pieces: keep the big, compact ones
  const N = ring(W2);
  const mask = new Uint8Array(size);
  const seen = new Uint8Array(size);
  const comp: number[] = [];
  const kept: number[] = [];
  const outlines: Solids["outlines"] = [];
  const inset = Math.max(0.5, Math.min(lineWidth / 2 + 0.5, 6));
  for (const s of core) {
    if (seen[s]) continue;
    comp.length = 0;
    comp.push(s);
    seen[s] = 1;
    let rmax = 0;
    for (let k = 0; k < comp.length; k++) {
      const p = comp[k];
      if (r[p] > rmax) rmax = r[p];
      for (let d = 0; d < 8; d++) {
        const q = p + N[d];
        if (opened[q] && !seen[q]) {
          seen[q] = 1;
          comp.push(q);
        }
      }
    }
    const area = comp.length;
    if (rmax < 1.6 * seed || area < 2 * Math.PI * seed * seed || area > MAX_ELONGATION * 4 * rmax * rmax) continue;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    let sx = 0;
    let sy = 0;
    for (const p of comp) {
      mask[p] = 1;
      kept.push(p);
      const x = p % W2;
      const y = (p - x) / W2;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
      sx += x;
      sy += y;
    }
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    // a disc fills the ellipse its box holds (a triangle ~0.64 of it, a square 1.27)
    const fill = area / ((Math.PI / 4) * bw * bh);
    const round = Math.max(bw, bh) <= 1.3 * Math.min(bw, bh) && fill >= 0.85 && fill <= 1.15 && area <= 1.5 * Math.PI * (rmax + 0.5) * (rmax + 0.5) && rmax <= maxDot(lineWidth);
    if (round) {
      outlines.push({ pts: [], px: comp.slice(0, 400), disc: { x: sx / area - 0.5, y: sy / area - 0.5, r: Math.sqrt(area / Math.PI) } });
      continue;
    }
    // the outline: the edge of the shape brought in by about half a line width
    const inner = new Set<number>();
    for (const p of comp) if (r[p] >= Math.min(inset, rmax / 2)) inner.add(p);
    const contour = traceContour(inner, W2);
    if (contour.length >= 3) {
      outlines.push({
        pts: contour.map((p) => {
          const px = p % W2;
          return [px - 0.5, (p - px) / W2 - 0.5] as Pt;
        }),
        px: contour,
      });
    }
  }
  if (!outlines.length) return null;
  // the solids' own corners and rims: ink within two seeds' reach of them (an acute tip loses most)
  const near = new Uint8Array(size);
  dilate(kept, mask, ink, W2, 2 * seed + 1.5, near);
  return { mask, near, outlines };
}

/**
 * The outer boundary of a set of pixels (8-connected), clockwise from its top-left pixel: Moore
 * neighbour tracing with Jacob's stopping rule (stop on re-entering the start the way it was first
 * left). Only the piece containing the top-left pixel is traced.
 */
function traceContour(set: Set<number>, W2: number): number[] {
  if (!set.size) return [];
  let start = Infinity;
  for (const p of set) if (p < start) start = p;
  const N = ring(W2);
  const dirOf = new Map<number, number>();
  for (let d = 0; d < 8; d++) dirOf.set(N[d], d);
  const out = [start];
  // the start is the first in raster order, so its west neighbour is outside
  let cur = start;
  let back = 6;
  let firstNext = -1;
  for (let guard = 0; guard < 4 * set.size + 16; guard++) {
    let next = -1;
    let prev = cur + N[back];
    for (let k = 1; k <= 8; k++) {
      const d = (back + k) % 8;
      const q = cur + N[d];
      if (set.has(q)) {
        next = q;
        break;
      }
      prev = q;
    }
    if (next < 0) return out; // a lone pixel
    if (cur === start) {
      if (firstNext < 0) firstNext = next;
      else if (next === firstNext) break;
    }
    back = dirOf.get(prev - next) ?? 6;
    cur = next;
    if (cur === start) continue;
    out.push(cur);
  }
  return out;
}
