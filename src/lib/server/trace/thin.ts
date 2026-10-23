import { ring, type Padded } from "./raster";

/**
 * Ink → its one-pixel skeleton, in place.
 *
 * GUO–HALL. Two alternating sub-iterations peel the boundary in parallel, never removing a pixel
 * that holds the shape together or ends a line; it keeps two-pixel diagonals that Zhang–Suen
 * deletes outright, and it thins a 10 px stroke to one centreline because it peels every side at
 * the same rate. Each test is a table lookup on the 8-bit neighbourhood code (bit k = the
 * neighbour `ring()[k]`: N, NE, E, SE, S, SW, W, NW).
 *
 * THEN STRICTLY 8-THIN. Guo–Hall leaves staircase corners (a pixel whose neighbours already touch
 * each other diagonally), and to a neighbour count those read as junctions. One more sweep removes
 * every such pixel that is SIMPLE — taking it away neither splits the ink nor opens a hole — and
 * that sits at an inside corner (two of its four side neighbours, at a right angle) or at a
 * blunt tip (its only two neighbours touch). After it, a pixel on a line has exactly two
 * neighbours, an end one and a crossing three or more.
 */

const bit = (c: number, k: number) => (c >> k) & 1;

/** Guo–Hall's deletion tables for the two sub-iterations. */
const GUO_HALL: [Uint8Array, Uint8Array] = (() => {
  const t: [Uint8Array, Uint8Array] = [new Uint8Array(256), new Uint8Array(256)];
  for (let c = 0; c < 256; c++) {
    const p2 = bit(c, 0);
    const p3 = bit(c, 1);
    const p4 = bit(c, 2);
    const p5 = bit(c, 3);
    const p6 = bit(c, 4);
    const p7 = bit(c, 5);
    const p8 = bit(c, 6);
    const p9 = bit(c, 7);
    const C = (+!p2 & (p3 | p4)) + (+!p4 & (p5 | p6)) + (+!p6 & (p7 | p8)) + (+!p8 & (p9 | p2));
    const N1 = (p9 | p2) + (p3 | p4) + (p5 | p6) + (p7 | p8);
    const N2 = (p2 | p3) + (p4 | p5) + (p6 | p7) + (p8 | p9);
    const N = Math.min(N1, N2);
    for (let it = 0; it < 2; it++) {
      const m = it === 0 ? (p6 | p7 | +!p9) & p8 : (p2 | p3 | +!p5) & p4;
      t[it][c] = C === 1 && N >= 2 && N <= 3 && m === 0 ? 1 : 0;
    }
  }
  return t;
})();

/** The ring's cells as (dx, dy), in bit order. */
const CELLS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
];

function components(cells: number[], adjacent: (a: number, b: number) => boolean): number[][] {
  const out: number[][] = [];
  const left = new Set(cells);
  for (const c of cells) {
    if (!left.has(c)) continue;
    left.delete(c);
    const comp = [c];
    for (let i = 0; i < comp.length; i++) {
      for (const d of [...left]) {
        if (adjacent(comp[i], d)) {
          left.delete(d);
          comp.push(d);
        }
      }
    }
    out.push(comp);
  }
  return out;
}

/** Whether the centre of a neighbourhood is simple: one 8-connected piece of ink round it, one 4-connected piece of paper touching its sides. */
const SIMPLE: Uint8Array = (() => {
  const t = new Uint8Array(256);
  const adj8 = (a: number, b: number) => Math.max(Math.abs(CELLS[a][0] - CELLS[b][0]), Math.abs(CELLS[a][1] - CELLS[b][1])) === 1;
  const adj4 = (a: number, b: number) => Math.abs(CELLS[a][0] - CELLS[b][0]) + Math.abs(CELLS[a][1] - CELLS[b][1]) === 1;
  for (let c = 0; c < 256; c++) {
    const ink: number[] = [];
    const paper: number[] = [];
    for (let k = 0; k < 8; k++) (bit(c, k) ? ink : paper).push(k);
    const fg = components(ink, adj8).length;
    const bg = components(paper, adj4).filter((comp) => comp.some((k) => k % 2 === 0)).length;
    t[c] = fg === 1 && bg === 1 ? 1 : 0;
  }
  return t;
})();

/** Pixels the 8-thin sweep removes: simple, not an end, at an inside corner or a blunt tip. */
const REDUNDANT: Uint8Array = (() => {
  const t = new Uint8Array(256);
  for (let c = 0; c < 256; c++) {
    let n = 0;
    for (let k = 0; k < 8; k++) n += bit(c, k);
    if (!SIMPLE[c] || n < 2) continue;
    const corner = (bit(c, 0) & bit(c, 2)) | (bit(c, 2) & bit(c, 4)) | (bit(c, 4) & bit(c, 6)) | (bit(c, 6) & bit(c, 0));
    let tip = 0;
    if (n === 2) for (let k = 0; k < 8; k++) if (bit(c, k) && bit(c, (k + 1) % 8)) tip = 1;
    t[c] = corner || tip ? 1 : 0;
  }
  return t;
})();

function codeAt(img: Uint8Array, p: number, N: Int32Array): number {
  return (
    (img[p + N[0]] ? 1 : 0) |
    (img[p + N[1]] ? 2 : 0) |
    (img[p + N[2]] ? 4 : 0) |
    (img[p + N[3]] ? 8 : 0) |
    (img[p + N[4]] ? 16 : 0) |
    (img[p + N[5]] ? 32 : 0) |
    (img[p + N[6]] ? 64 : 0) |
    (img[p + N[7]] ? 128 : 0)
  );
}

/** Thin the padded image to its skeleton in place; the skeleton's pixels, in index order. */
export function thin(P: Padded): Int32Array {
  const { W2, H2, img } = P;
  const N = ring(W2);
  let list = new Int32Array(W2 * H2);
  let n = 0;
  for (let p = W2; p < W2 * (H2 - 1); p++) if (img[p]) list[n++] = p;
  list = list.slice(0, n);
  const del = new Int32Array(n);
  // Guo–Hall: only pixels with paper on a side can go, so the interior waits its turn cheaply
  for (let guard = 0; guard < 1000; guard++) {
    let changed = 0;
    for (let it = 0; it < 2; it++) {
      const lut = GUO_HALL[it];
      let nd = 0;
      for (let i = 0; i < n; i++) {
        const p = list[i];
        if (img[p - W2] && img[p + 1] && img[p + W2] && img[p - 1]) continue;
        if (lut[codeAt(img, p, N)]) del[nd++] = p;
      }
      for (let k = 0; k < nd; k++) img[del[k]] = 0;
      changed += nd;
      if (nd) {
        let m = 0;
        for (let i = 0; i < n; i++) if (img[list[i]]) list[m++] = list[i];
        n = m;
      }
    }
    if (!changed) break;
  }
  // strictly 8-thin: sequential, in raster order (deterministic), until nothing changes
  for (let pass = 0; pass < 6; pass++) {
    let changed = 0;
    for (let i = 0; i < n; i++) {
      const p = list[i];
      if (img[p] && REDUNDANT[codeAt(img, p, N)]) {
        img[p] = 0;
        changed++;
      }
    }
    if (!changed) break;
    let m = 0;
    for (let i = 0; i < n; i++) if (img[list[i]]) list[m++] = list[i];
    n = m;
  }
  return list.slice(0, n);
}
