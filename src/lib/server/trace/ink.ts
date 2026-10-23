import type { Working } from "./bitmap";

/**
 * Which pixels are ink. An image model's "white" is rarely white: off-white, cream, a pale grey,
 * faintly vignetted, with JPEG noise. So ink is measured against the PAPER, not against 255:
 *
 * THE PAPER. Its level is the commonest luminance (line art is mostly paper), its colour the mean
 * of the pixels at that level, and it is allowed to drift slowly across the picture (a vignette, a
 * lit sheet): each 32 px tile's paper is its brighter quarter, held within ±24 levels of the whole
 * picture's, and blended between tiles. A tile a filled shape covers cannot drag the paper down
 * to the shape, so the shape stays ink.
 *
 * THE SCORE. How much a pixel absorbs that the paper does not, in its most absorbed channel:
 * max(paper − pixel) over R, G and B. Black ink scores ~255 on white; a blue or a yellow line
 * scores high too (yellow absorbs blue), so coloured lines are ink without a separate saturation
 * test; and a pale grey wash a few levels under the paper scores little.
 *
 * THE THRESHOLDS. A pixel is ink when it scores ≥ `hi`, or ≥ `lo` and touches such ink
 * (hysteresis): `hi` finds the lines, `lo` keeps their anti-aliased fringe and the faint joins of
 * a thin diagonal, but a faint blotch on its own is not ink. `hi` is under half the ink's own
 * contrast (so a grey line beside black ones still counts), at most 64, and both are above the
 * paper's measured noise, so a noisy pale background does not light up.
 *
 * AND RELATIVE TO ITS LINE. A pixel must also score at least `relative` (35 %) of the strongest
 * ink within 2 px: the fringe of a black line is cut at about a third of its darkness, the
 * fringe of a pale grey line at a third of ITS darkness. Every line keeps about its true width
 * whatever its shade — so the eye of a small "e" and the gap between two close strokes stay open
 * instead of filling with a black line's faint halo.
 */

export interface InkOptions {
  /** a pixel scoring at least this seeds ink (0..255; default adaptive, 32..64) */
  threshold?: number;
  /** a pixel scoring at least this is ink where it touches ink (default: half of `threshold`, above the noise) */
  fringe?: number;
  /** the least `threshold` may be, however clean the paper (default 32) */
  minContrast?: number;
  /** a pixel must also score this share of the strongest ink within 2 px (default 0.35) */
  relative?: number;
}

export interface Ink {
  w: number;
  h: number;
  /** 1 = ink, row-major w × h */
  mask: Uint8Array;
  /** each pixel's score against its paper, 0..255 */
  score: Uint8Array;
  /** the picture's paper colour */
  paper: [number, number, number];
  /** the paper's noise (a standard deviation, luminance levels) */
  noise: number;
  /** the ink's own contrast: the 90th percentile score of what passed the floor */
  contrast: number;
  hi: number;
  lo: number;
  /** ink pixels */
  count: number;
}

/** Regions the caller wants blank, in SOURCE pixels: a rectangle or a polygon. */
export type IgnoreRegion = { x: number; y: number; w: number; h: number } | Array<[number, number]>;

const TILE = 32;
const DRIFT = 24;

function percentile(hist: Uint32Array, total: number, q: number): number {
  if (total <= 0) return 0;
  const want = Math.max(1, Math.ceil(total * q));
  let acc = 0;
  for (let i = 0; i < hist.length; i++) {
    acc += hist[i];
    if (acc >= want) return i;
  }
  return hist.length - 1;
}

/** The working copy's luminance (Rec. 601, integer). */
export function luminance(work: Working): Uint8Array {
  const n = work.w * work.h;
  const L = new Uint8Array(n);
  const rgb = work.rgb;
  for (let i = 0; i < n; i++) L[i] = (rgb[i * 3] * 77 + rgb[i * 3 + 1] * 150 + rgb[i * 3 + 2] * 29) >> 8;
  return L;
}

/** The paper's luminance at every pixel: the picture's commonest level, drifting tile by tile. */
function paperLevels(L: Uint8Array, w: number, h: number): { global: number; local: Uint8Array } {
  const hist = new Uint32Array(256);
  for (let i = 0; i < L.length; i++) hist[L[i]]++;
  // the mode of a lightly smoothed histogram (JPEG noise spreads the paper over a few levels)
  let global = 255;
  let best = -1;
  for (let v = 0; v < 256; v++) {
    let s = 0;
    for (let d = -2; d <= 2; d++) {
      const u = v + d;
      if (u >= 0 && u < 256) s += hist[u] * (3 - Math.abs(d));
    }
    if (s > best) {
      best = s;
      global = v;
    }
  }
  const tx = Math.ceil(w / TILE);
  const ty = Math.ceil(h / TILE);
  const tiles = new Float32Array(tx * ty);
  const th = new Uint32Array(256);
  for (let j = 0; j < ty; j++) {
    for (let i = 0; i < tx; i++) {
      th.fill(0);
      const x1 = Math.min(w, (i + 1) * TILE);
      const y1 = Math.min(h, (j + 1) * TILE);
      let n = 0;
      for (let y = j * TILE; y < y1; y++) for (let x = i * TILE; x < x1; x++, n++) th[L[y * w + x]]++;
      const p = percentile(th, n, 0.75);
      tiles[j * tx + i] = Math.max(global - DRIFT, Math.min(global + DRIFT, p));
    }
  }
  // bilinear between tile centres (the column weights are the same on every row)
  const local = new Uint8Array(w * h);
  const row = new Float32Array(tx);
  const ci0 = new Int32Array(w);
  const ci1 = new Int32Array(w);
  const ck = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    const fx = Math.max(0, Math.min(tx - 1, (x + 0.5) / TILE - 0.5));
    ci0[x] = Math.floor(fx);
    ci1[x] = Math.min(tx - 1, ci0[x] + 1);
    ck[x] = fx - ci0[x];
  }
  for (let y = 0; y < h; y++) {
    const fy = Math.max(0, Math.min(ty - 1, (y + 0.5) / TILE - 0.5));
    const j0 = Math.floor(fy);
    const j1 = Math.min(ty - 1, j0 + 1);
    const ky = fy - j0;
    for (let i = 0; i < tx; i++) row[i] = tiles[j0 * tx + i] * (1 - ky) + tiles[j1 * tx + i] * ky;
    const o = y * w;
    for (let x = 0; x < w; x++) local[o + x] = (row[ci0[x]] * (1 - ck[x]) + row[ci1[x]] * ck[x] + 0.5) | 0;
  }
  return { global, local };
}

/** Zero `field` inside each region (source pixels, scaled by sx, sy), with a pixel's margin. */
export function blankRegions(field: Uint8Array, w: number, h: number, regions: readonly IgnoreRegion[] | undefined, sx: number, sy: number): void {
  if (!regions?.length) return;
  for (const r of regions) {
    if (Array.isArray(r)) {
      const pts = r.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])).map(([x, y]) => [x * sx, y * sy] as const);
      if (pts.length < 3) continue;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (const [, y] of pts) {
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
      const ya = Math.max(0, Math.floor(y0) - 1);
      const yb = Math.min(h - 1, Math.ceil(y1) + 1);
      for (let y = ya; y <= yb; y++) {
        // crossings of the scanline through the row (and the rows either side: a pixel's margin)
        const xs: number[] = [];
        for (const yy of [y - 0.5, y + 0.5, y + 1.5]) {
          const cross: number[] = [];
          for (let i = 0; i < pts.length; i++) {
            const [ax, ay] = pts[i];
            const [bx, by] = pts[(i + 1) % pts.length];
            if (ay <= yy !== by <= yy) cross.push(ax + ((yy - ay) / (by - ay)) * (bx - ax));
          }
          cross.sort((a, b) => a - b);
          for (let k = 0; k + 1 < cross.length; k += 2) xs.push(cross[k], cross[k + 1]);
        }
        for (let k = 0; k + 1 < xs.length; k += 2) {
          const xa = Math.max(0, Math.floor(xs[k]) - 1);
          const xb = Math.min(w - 1, Math.ceil(xs[k + 1]) + 1);
          for (let x = xa; x <= xb; x++) field[y * w + x] = 0;
        }
      }
      continue;
    }
    if (!r || ![r.x, r.y, r.w, r.h].every(Number.isFinite)) continue;
    const xa = Math.max(0, Math.floor(r.x * sx) - 1);
    const xb = Math.min(w - 1, Math.ceil((r.x + r.w) * sx));
    const ya = Math.max(0, Math.floor(r.y * sy) - 1);
    const yb = Math.min(h - 1, Math.ceil((r.y + r.h) * sy));
    for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) field[y * w + x] = 0;
  }
}

/** The ink of a working copy (with `ignore` blanked before anything is measured as ink). */
export function inkMask(work: Working, opts: InkOptions = {}, ignore?: readonly IgnoreRegion[]): Ink {
  const { w, h, rgb } = work;
  const n = w * h;
  const L = luminance(work);
  const { global, local } = paperLevels(L, w, h);

  // the paper's colour: the mean of the pixels at its level
  let pr = 0;
  let pg = 0;
  let pb = 0;
  let pn = 0;
  for (let i = 0; i < n; i++) {
    if (Math.abs(L[i] - global) <= 3) {
      pr += rgb[i * 3];
      pg += rgb[i * 3 + 1];
      pb += rgb[i * 3 + 2];
      pn++;
    }
  }
  const paper: [number, number, number] = pn ? [pr / pn, pg / pn, pb / pn] : [global, global, global];

  // the noise: a robust spread of luminance about the local paper (most pixels are paper)
  const dev = new Uint32Array(256);
  for (let i = 0; i < n; i++) dev[Math.abs(L[i] - local[i])]++;
  const noise = 1.4826 * percentile(dev, n, 0.5);

  const score = new Uint8Array(n);
  const p0 = Math.round(paper[0]) - global;
  const p1 = Math.round(paper[1]) - global;
  const p2 = Math.round(paper[2]) - global;
  for (let i = 0; i < n; i++) {
    const base = local[i];
    const j = i * 3;
    let s = base + p0 - rgb[j];
    const g = base + p1 - rgb[j + 1];
    const b = base + p2 - rgb[j + 2];
    if (g > s) s = g;
    if (b > s) s = b;
    score[i] = s <= 0 ? 0 : s >= 255 ? 255 : s;
  }
  blankRegions(score, w, h, ignore, work.sx, work.sy);

  const floorHi = Math.max(opts.minContrast ?? 32, 6 * noise);
  const floorLo = Math.max(16, 3.5 * noise);
  const sh = new Uint32Array(256);
  let above = 0;
  for (let i = 0; i < n; i++) {
    if (score[i] >= floorHi) {
      sh[score[i]]++;
      above++;
    }
  }
  const contrast = above ? percentile(sh, above, 0.9) : 0;
  const hi = clamp(opts.threshold ?? Math.max(floorHi, Math.min(0.45 * contrast, 64)), 1, 255);
  const lo = clamp(opts.fringe ?? Math.min(hi, Math.max(floorLo, 0.5 * hi)), 1, hi);

  // the strongest ink within 2 px (a separable 5 × 5 max), scaled to the share a pixel must reach
  const rel = Math.max(0, Math.min(1, opts.relative ?? 0.35));
  const need = new Uint8Array(n);
  if (rel > 0) {
    const tmp = new Uint8Array(n);
    for (let y = 0; y < h; y++) {
      const o = y * w;
      for (let x = 0; x < w; x++) {
        const a = x >= 2 ? x - 2 : 0;
        const b = x + 2 < w ? x + 2 : w - 1;
        let m = score[o + a];
        for (let k = a + 1; k <= b; k++) if (score[o + k] > m) m = score[o + k];
        tmp[o + x] = m;
      }
    }
    for (let y = 0; y < h; y++) {
      const a = y >= 2 ? y - 2 : 0;
      const b = y + 2 < h ? y + 2 : h - 1;
      const o = y * w;
      for (let x = 0; x < w; x++) {
        let m = tmp[a * w + x];
        for (let k = a + 1; k <= b; k++) if (tmp[k * w + x] > m) m = tmp[k * w + x];
        need[o + x] = m ? Math.ceil(m * rel) : 0;
      }
    }
  }

  // hysteresis: seeds ≥ hi, grown 8-connected through ≥ lo (both also ≥ their share of the local ink)
  const mask = new Uint8Array(n);
  const stack = new Int32Array(n);
  let sp = 0;
  let count = 0;
  for (let i = 0; i < n; i++) {
    if (score[i] >= hi && score[i] >= need[i] && !mask[i]) {
      mask[i] = 1;
      count++;
      stack[sp++] = i;
      while (sp) {
        const p = stack[--sp];
        const x = p % w;
        const y = (p - x) / w;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            const q = yy * w + xx;
            if (!mask[q] && score[q] >= lo && score[q] >= need[q]) {
              mask[q] = 1;
              count++;
              stack[sp++] = q;
            }
          }
        }
      }
    }
  }
  return { w, h, mask, score, paper, noise, contrast, hi, lo, count };
}

function clamp(v: number, a: number, b: number): number {
  return Number.isFinite(v) ? Math.max(a, Math.min(b, v)) : a;
}
