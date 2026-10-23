import type { SketchDrawing } from "@/lib/live/lecture/contracts";
import { DEFAULT_MAX_SIDE, workingCopy, type Bitmap } from "./bitmap";
import { frameFor } from "./drawing";
import { inkMask, type IgnoreRegion } from "./ink";
import { dropSpecks, edtSquared, inkRadius, pad } from "./raster";

/**
 * How faithful a drawing is to the picture it was traced from, at the tracer's working size:
 *
 * RECALL — the share of the picture's ink that the strokes cover: an ink pixel is covered when it
 * lies within `radius` of a stroke drawn at the picture's own line width there (each point along
 * a stroke covers `radius` + the ink's half-width under it). So a 10 px marker line traced down its
 * middle is wholly covered, and a missed line is not covered at all.
 *
 * PRECISION — the share of points sampled every pixel along the strokes that land within `radius`
 * of ink: how much of what the pen draws is really in the picture.
 *
 * "Ink" is what the tracer sees (`inkMask`, specks dropped, `ignore` blanked), so the metric scores
 * the drawing, not the threshold. `radius` defaults to 2 working pixels. A picture with no ink has
 * recall 1 (nothing to miss); a drawing with no strokes has precision 1 (nothing drawn wrong) and,
 * when there is ink, recall 0.
 */

export interface FidelityOptions {
  /** working pixels (default 2) */
  radius?: number;
  ignore?: readonly IgnoreRegion[];
  /** the working copy's long side (default 1024, as the tracer's) */
  maxSide?: number;
  /** speck size dropped from the ink before scoring (default: the tracer's, relative to the line width) */
  minSpeck?: number;
}

export function traceFidelity(bitmap: Bitmap, drawing: SketchDrawing, opts: FidelityOptions = {}): { recall: number; precision: number } {
  const radius = Math.max(0, opts.radius ?? 2);
  const work = workingCopy(bitmap, opts.maxSide ?? DEFAULT_MAX_SIDE);
  const { w, h } = work;
  const ink = inkMask(work, {}, opts.ignore);
  const P = pad(ink.mask, w, h);
  const rInk = inkRadius(P);
  dropSpecks(P, opts.minSpeck ?? 6, opts.minSpeck === undefined ? rInk : undefined);
  const W2 = P.W2;
  const f = frameFor(w, h);

  // samples every ≤ 1 working px along every stroke
  const sx: number[] = [];
  const sy: number[] = [];
  for (const s of drawing.strokes ?? []) {
    const pts = s.points.map(([x, y]) => [(x - f.ox) / f.s, (y - f.oy) / f.s] as const);
    if (s.closed && pts.length > 2) pts.push(pts[0]);
    if (pts.length === 1) pts.push(pts[0]);
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
      for (let k = i === 0 ? 0 : 1; k <= n; k++) {
        sx.push(ax + ((bx - ax) * k) / n);
        sy.push(ay + ((by - ay) * k) / n);
      }
    }
  }

  // precision: each sample's distance to the nearest ink
  const d2 = edtSquared(P.img, W2, P.H2);
  let onInk = 0;
  for (let i = 0; i < sx.length; i++) {
    const x = Math.floor(sx[i]);
    const y = Math.floor(sy[i]);
    if (x < -1 || y < -1 || x > w || y > h) continue;
    if (d2[(y + 1) * W2 + x + 1] <= radius * radius) onInk++;
  }
  const precision = sx.length ? onInk / sx.length : 1;

  // recall: stamp a disc of radius + the ink's half-width at every sample
  let total = 0;
  for (let i = 0; i < P.img.length; i++) total += P.img[i];
  if (!total) return { recall: 1, precision };
  const cover = new Uint8Array(P.img.length);
  const discs = new Map<number, Int32Array>();
  const disc = (R: number) => {
    const key = Math.round(R * 4);
    let d = discs.get(key);
    if (!d) {
      const out: number[] = [];
      const rr = key / 4;
      const K = Math.ceil(rr);
      for (let dy = -K; dy <= K; dy++) for (let dx = -K; dx <= K; dx++) if (dx * dx + dy * dy <= rr * rr) out.push(dx, dy);
      d = Int32Array.from(out);
      discs.set(key, d);
    }
    return d;
  };
  for (let i = 0; i < sx.length; i++) {
    const cx = Math.floor(sx[i]);
    const cy = Math.floor(sy[i]);
    if (cx < -1 || cy < -1 || cx > w || cy > h) continue;
    const under = rInk[(cy + 1) * W2 + cx + 1] || 0;
    const d = disc(radius + Math.max(0, under));
    for (let k = 0; k < d.length; k += 2) {
      const x = cx + d[k];
      const y = cy + d[k + 1];
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      cover[(y + 1) * W2 + x + 1] = 1;
    }
  }
  let hit = 0;
  for (let i = 0; i < P.img.length; i++) if (P.img[i] && cover[i]) hit++;
  return { recall: hit / total, precision };
}
