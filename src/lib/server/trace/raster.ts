/**
 * Binary-image tools the tracer runs between the threshold and the skeleton, all on PADDED
 * images: the w × h picture inside a one-pixel frame of paper, (w + 2) × (h + 2), so a pixel's
 * eight neighbours are always `p ± 1`, `p ± W2`, `p ± W2 ± 1` with no bounds test, and a line
 * running off the picture's edge ends there as if the paper went on.
 *
 * SPECKS are 8-connected ink much smaller than the drawing's lines: JPEG noise, dust.
 * HOLES are 4-connected paper smaller than a few pixels inside ink: the noise in a thick stroke's
 * middle, which thinning would turn into a ladder of tiny loops. RADIUS is each ink pixel's exact
 * distance to the paper (measured over the ink only, for speed), and from it the line width:
 * twice the median radius along the ink's ridges. `edtSquared` is the whole-picture transform
 * (Felzenszwalb–Huttenlocher) the fidelity score needs.
 */

export interface Padded {
  /** padded width and height */
  W2: number;
  H2: number;
  img: Uint8Array;
}

/** The w × h mask inside a one-pixel frame of paper. */
export function pad(mask: Uint8Array, w: number, h: number): Padded {
  const W2 = w + 2;
  const H2 = h + 2;
  const img = new Uint8Array(W2 * H2);
  for (let y = 0; y < h; y++) img.set(mask.subarray(y * w, y * w + w), (y + 1) * W2 + 1);
  return { W2, H2, img };
}

/** The eight neighbour offsets in ring order N, NE, E, SE, S, SW, W, NW (bit k of a neighbourhood code). */
export function ring(W2: number): Int32Array {
  return Int32Array.from([-W2, -W2 + 1, 1, W2 + 1, W2, W2 - 1, -1, -W2 - 1]);
}

/**
 * Ink components (8-connected) that are specks set to paper; how many there were. A speck is
 * smaller than `minArea` — or, given the ink's radius `r`, much smaller than the drawing's own
 * lines: under 0.6 × the line width² (between 3 px and `minArea`), the width measured on the
 * components that are not specks either way. So 1–2 px of JPEG noise always goes, while a dot the
 * size of a thin pen's tip stays to be drawn. A dropped speck's radius is zeroed too.
 */
export function dropSpecks(P: Padded, minArea: number, r?: Float32Array): number {
  const { W2, H2, img } = P;
  if (minArea <= 1) return 0;
  const N = ring(W2);
  const label = new Int32Array(W2 * H2).fill(-1);
  const comp = new Int32Array(W2 * H2);
  const starts: number[] = [];
  const sizes: number[] = [];
  let n = 0;
  for (let p = W2; p < W2 * (H2 - 1); p++) {
    if (!img[p] || label[p] >= 0) continue;
    const id = sizes.length;
    const from = n;
    comp[n++] = p;
    label[p] = id;
    for (let k = from; k < n; k++) {
      const q = comp[k];
      for (let d = 0; d < 8; d++) {
        const t = q + N[d];
        if (img[t] && label[t] < 0) {
          label[t] = id;
          comp[n++] = t;
        }
      }
    }
    starts.push(from);
    sizes.push(n - from);
  }
  let limit = minArea;
  if (r) {
    const bins = new Uint32Array(256);
    for (let p = W2 + 1; p < W2 * (H2 - 1) - 1; p++) {
      if (!img[p] || sizes[label[p]] < minArea) continue;
      const v = r[p];
      let ridge = true;
      for (let d = 0; d < 8 && ridge; d++) if (r[p + N[d]] > v) ridge = false;
      if (ridge) bins[Math.min(255, Math.round(v * 4))]++;
    }
    const width = widthOf(bins);
    if (width > 0) limit = Math.max(3, Math.min(minArea, Math.round(0.6 * width * width)));
  }
  let dropped = 0;
  for (let id = 0; id < sizes.length; id++) {
    if (sizes[id] >= limit) continue;
    for (let k = starts[id]; k < starts[id] + sizes[id]; k++) {
      img[comp[k]] = 0;
      if (r) r[comp[k]] = 0;
    }
    dropped++;
  }
  return dropped;
}

/**
 * Paper components (4-connected) of at most `maxArea` pixels that ink encloses, set to ink; how
 * many. Each search stops as soon as it is too big or reaches paper already known to be big (the
 * frame is), so the whole pass is linear however much paper there is.
 */
export function fillHoles(P: Padded, maxArea: number): number {
  const { W2, H2, img } = P;
  if (maxArea < 1) return 0;
  const size = W2 * H2;
  // 0 unknown, 1 big (open paper), 2 filled
  const state = new Uint8Array(size);
  for (let x = 0; x < W2; x++) state[x] = state[size - W2 + x] = 1;
  for (let y = 0; y < H2; y++) state[y * W2] = state[y * W2 + W2 - 1] = 1;
  const four = [-W2, 1, W2, -1];
  const comp = new Int32Array(maxArea + 2);
  let filled = 0;
  for (let p = W2 + 1; p < size - W2 - 1; p++) {
    if (img[p] || state[p]) continue;
    let n = 0;
    let big = false;
    comp[n++] = p;
    state[p] = 3; // in this search
    for (let k = 0; k < n && !big; k++) {
      const q = comp[k];
      for (let d = 0; d < 4; d++) {
        const r = q + four[d];
        if (img[r]) continue;
        if (state[r] === 1) {
          big = true;
          break;
        }
        if (state[r] === 0) {
          if (n > maxArea) {
            big = true;
            break;
          }
          state[r] = 3;
          comp[n++] = r;
        }
      }
    }
    if (big) for (let k = 0; k < n; k++) state[comp[k]] = 1;
    else {
      for (let k = 0; k < n; k++) {
        state[comp[k]] = 2;
        img[comp[k]] = 1;
      }
      filled++;
    }
  }
  return filled;
}

const INF = 1e20;

/** Squared distance transform along one line (Felzenszwalb–Huttenlocher's lower envelope of parabolas). */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    d[q] = dq * dq + f[v[k]];
  }
}

/** Squared Euclidean distance from every pixel to the nearest pixel where `set` is non-zero (≥ 1e20 when there is none). */
export function edtSquared(set: Uint8Array, W: number, H: number): Float32Array {
  const out = new Float32Array(W * H);
  const m = Math.max(W, H);
  const f = new Float64Array(m);
  const d = new Float64Array(m);
  const v = new Int32Array(m);
  const z = new Float64Array(m + 1);
  const cols = new Float64Array(W * H);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) f[y] = set[y * W + x] ? 0 : INF;
    edt1d(f, H, d, v, z);
    for (let y = 0; y < H; y++) cols[y * W + x] = d[y];
  }
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) f[x] = cols[row + x];
    edt1d(f, W, d, v, z);
    for (let x = 0; x < W; x++) out[row + x] = d[x];
  }
  return out;
}

/**
 * Every ink pixel's RADIUS: its exact distance to the nearest paper pixel less half a pixel, so a
 * 1 px line is 0.5, a 3 px line 1.5 down its middle. Paper is 0.
 *
 * Only ink is measured, so the cost follows the ink, not the picture: each row's distance to paper
 * along the row first, then for each ink pixel the rows above and below, nearest first, until the
 * row offset alone is past the best found (the exact Euclidean distance, by the separable
 * formulation). Line art is mostly paper and its lines a few pixels wide, so this is a few
 * milliseconds where a full transform of the picture is tens.
 */
export function inkRadius(P: Padded): Float32Array {
  const { W2, H2, img } = P;
  const row = new Int32Array(W2 * H2);
  for (let y = 0; y < H2; y++) {
    const o = y * W2;
    let d = 1 << 20;
    for (let x = 0; x < W2; x++) {
      d = img[o + x] ? d + 1 : 0;
      row[o + x] = d;
    }
    d = 1 << 20;
    for (let x = W2 - 1; x >= 0; x--) {
      d = img[o + x] ? d + 1 : 0;
      if (d < row[o + x]) row[o + x] = d;
    }
  }
  const r = new Float32Array(W2 * H2);
  for (let y = 1; y < H2 - 1; y++) {
    for (let x = 1; x < W2 - 1; x++) {
      const p = y * W2 + x;
      if (!img[p]) continue;
      let best = row[p] * row[p];
      for (let dy = 1; dy * dy < best; dy++) {
        const dd = dy * dy;
        const up = y - dy >= 0 ? row[p - dy * W2] : 0;
        const dn = y + dy < H2 ? row[p + dy * W2] : 0;
        const c = dd + Math.min(up, dn) * Math.min(up, dn);
        if (c < best) best = c;
      }
      r[p] = Math.sqrt(best) - 0.5;
    }
  }
  return r;
}

/**
 * The ink's ridges (pixels no neighbour out-radiuses) as a histogram of their radius, in quarter
 * pixels up to 64 px: the line widths of the drawing, read by `widthOf`.
 */
export function ridgeRadii(P: Padded, r: Float32Array): Uint32Array {
  const { W2, H2, img } = P;
  const N = ring(W2);
  const bins = new Uint32Array(256);
  for (let p = W2 + 1; p < W2 * (H2 - 1) - 1; p++) {
    if (!img[p]) continue;
    const v = r[p];
    let ridge = true;
    for (let d = 0; d < 8; d++) {
      if (r[p + N[d]] > v) {
        ridge = false;
        break;
      }
    }
    if (ridge) bins[Math.min(255, Math.round(v * 4))]++;
  }
  return bins;
}

/**
 * The typical line width: twice the median ridge radius, counting only ridges of radius ≤ `maxR`
 * when given (the LINES' width, leaving out the middles of filled shapes). 0 when there are none.
 */
export function widthOf(bins: Uint32Array, maxR = Infinity): number {
  const top = Math.min(255, Math.floor(maxR * 4));
  let n = 0;
  for (let i = 0; i <= top; i++) n += bins[i];
  if (!n) return 0;
  let acc = 0;
  for (let i = 0; i <= top; i++) {
    acc += bins[i];
    if (acc * 2 >= n) return (2 * i) / 4;
  }
  return 0;
}

/** `widthOf(ridgeRadii(P, r), maxR)`. */
export function lineWidth(P: Padded, r: Float32Array, maxR = Infinity): number {
  return widthOf(ridgeRadii(P, r), maxR);
}
