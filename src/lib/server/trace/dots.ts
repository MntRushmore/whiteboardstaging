import type { Pt } from "@/lib/server/sketch/geometry";
import { ring, type Padded } from "./raster";

/**
 * DOTS: the solid dots that ARE the content — a Lewis structure's lone pairs, a Bohr atom's
 * electrons, a plotted point, a full stop, the dot a force acts on. Thinning shrinks a filled disc
 * to a pixel or a short dash, which the board would draw as a speck; so dots are found before
 * thinning and drawn as dots.
 *
 * WHICH. An ink component on its own that is a compact, round, SOLID blob: about as wide as it is
 * tall (≤ 1.6:1), filling the ellipse its box holds (≥ 0.7, and — past a few pixels, where
 * pixels make every disc a little square — at most 1.15, so a small filled square stays a square),
 * solid rather than a ring (its inscribed radius at least 0.6 of its area's radius: an "o" or a
 * degree sign is a ring), and no bigger than `maxDot` (a disc bigger than that is a filled SHAPE,
 * outlined by `solids.ts`). Dots touching lines (a plotted point on a graph's corner, an electron
 * on its orbit) are found from the ink's radius instead (`blobs` in `graph.ts`) and drawn the same
 * way.
 *
 * HOW A DOT IS DRAWN. Not as a ring: the board draws every stroke with one pen (~3 px on a 900 px
 * canvas) and a closed stroke's fill is a pale 20 % tint, so a ring of the dot's radius reads as a
 * small "o", not a dot. A person colours a dot in; so does `dotSpiral`: one turn round the dot's
 * edge, then winding in to its centre with a pitch under the pen's width, which the pen fills
 * solid. Its radius is the dot's own, never under 1.2 × the drawing's line half-width (a dot the
 * size of the pen's tip still reads as one).
 */

export interface Dot {
  /** centre and radius, working pixels */
  x: number;
  y: number;
  r: number;
  /** its padded pixels (its colour is read from them) */
  px: number[];
}

/** The largest dot radius (working px) for a drawing of this line width: bigger discs are outlined shapes. */
export const maxDot = (lineWidth: number) => Math.max(16, 4 * lineWidth);

/** Find the isolated dots in the padded ink and take them out of it, radius and all (so nothing else draws them again). */
export function takeDots(P: Padded, r: Float32Array, lineWidth: number): Dot[] {
  const { W2, H2, img } = P;
  const N = ring(W2);
  const seen = new Uint8Array(W2 * H2);
  const dots: Dot[] = [];
  const limit = maxDot(lineWidth);
  const comp: number[] = [];
  for (let p = W2 + 1; p < W2 * (H2 - 1) - 1; p++) {
    if (!img[p] || seen[p]) continue;
    comp.length = 0;
    comp.push(p);
    seen[p] = 1;
    let big = false;
    for (let k = 0; k < comp.length; k++) {
      const q = comp[k];
      for (let d = 0; d < 8; d++) {
        const t = q + N[d];
        if (img[t] && !seen[t]) {
          seen[t] = 1;
          comp.push(t);
        }
      }
      // a component bigger than any dot is not one: stop measuring (keep marking it seen)
      if (comp.length > Math.PI * (limit + 2) * (limit + 2)) big = true;
    }
    if (big || comp.length < 3) continue;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    let sx = 0;
    let sy = 0;
    let rmax = 0;
    for (const q of comp) {
      const x = q % W2;
      const y = (q - x) / W2;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
      sx += x;
      sy += y;
      if (r[q] > rmax) rmax = r[q];
    }
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    const area = comp.length;
    const req = Math.sqrt(area / Math.PI);
    const fill = area / ((Math.PI / 4) * bw * bh);
    if (Math.max(bw, bh) > 1.6 * Math.min(bw, bh)) continue;
    if (fill < 0.7 || (req >= 4 && fill > 1.15)) continue;
    if (rmax + 0.5 < 0.6 * req) continue;
    if (req > limit) continue;
    for (const q of comp) {
      img[q] = 0;
      r[q] = 0;
    }
    dots.push({ x: sx / area - 0.5, y: sy / area - 0.5, r: req, px: comp.slice() });
  }
  return dots;
}

/**
 * A dot as one pen stroke that fills it: a turn round its edge at radius `R`, then a spiral in to
 * the centre, `pitch` closer each turn (both in the units of the points it returns). About one
 * point every 2 units of arc, 6..16 a turn.
 */
export function dotSpiral(cx: number, cy: number, R: number, pitch: number): Pt[] {
  const out: Pt[] = [];
  const p = Math.max(0.5, pitch);
  const inward = Math.max(0, R - p / 2);
  const total = 2 * Math.PI * (1 + inward / p);
  let theta = 0;
  for (let guard = 0; guard < 4000 && theta < total; guard++) {
    const rad = theta <= 2 * Math.PI ? R : Math.max(0, R - (p * (theta - 2 * Math.PI)) / (2 * Math.PI));
    out.push([cx + rad * Math.cos(theta), cy + rad * Math.sin(theta)]);
    const steps = Math.max(6, Math.min(16, Math.round((2 * Math.PI * Math.max(rad, 0.5)) / 2)));
    theta += (2 * Math.PI) / steps;
  }
  out.push([cx, cy]);
  return out;
}
