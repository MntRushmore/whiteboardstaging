/**
 * The painter's picture, made into what the board lays over the kid's work (sharp decodes and
 * encodes; the rest is plain pixels, ported and adapted from the drawing bake-off's
 * src/__eval__/drawing/edit/imageops.ts on eval/drawing-bakeoff):
 *
 *  - PICTURE: the returned image resized to EXACTLY the board capture's W×H, contain-fit and centred
 *    on white, as Reed's board laid it over the viewport.
 *  - ALIGN: image models resize, reframe and nudge the board by a few px. Starting from Reed's
 *    contain-fit (and a stretch and a cover-fit), search scale and shift for the map that puts the
 *    most of the kid's ink on ink in the picture, then resample the picture onto the board's grid.
 *  - OVERLAY: transparent except what the model ADDED: pixels clearly darker or more coloured than
 *    the board at the same spot, each measured against its own picture's paper — so a picture whose
 *    whole background came back tinted (a grey or cream wash, which Reed's prompt forbids and models
 *    still do) has that tint as its paper, and a near-uniform low-contrast tint is never ink. Never
 *    the kid's own writing: wherever the board has ink (grown by NEAR_KID px, the alignment's slack)
 *    the overlay is transparent, and a dark piece that touches their writing and is smaller than one
 *    of their letters goes too, so a digit the model redrew or changed never shows as changed. Specks
 *    go; the strokes kept are grown by GROW px into their own anti-aliased edges so they are not
 *    chewed thin.
 */
import sharp from "sharp";

export interface Rgb {
  width: number;
  height: number;
  /** RGB, 3 bytes a pixel, row-major */
  data: Uint8Array;
}

/** Decoded, rotated by EXIF, flattened on white, sRGB, 3 channels. */
export async function decodeRgb(bytes: Buffer | Uint8Array): Promise<Rgb> {
  const { data, info } = await sharp(bytes, { failOn: "none" })
    .rotate()
    .flatten({ background: "#ffffff" })
    .toColourspace("srgb")
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data.buffer, data.byteOffset, data.length) };
}

/** An image's size without decoding its pixels; null when it is not an image sharp can read. */
export async function imageSize(bytes: Buffer): Promise<{ width: number; height: number } | null> {
  try {
    const meta = await sharp(bytes, { failOn: "none" }).metadata();
    if (!meta.width || !meta.height) return null;
    // orientations 5–8 swap the sides (decodeRgb rotates)
    const swap = (meta.orientation ?? 1) >= 5;
    return swap ? { width: meta.height, height: meta.width } : { width: meta.width, height: meta.height };
  } catch {
    return null;
  }
}

export async function encodeRgbPng(img: Rgb): Promise<Buffer> {
  return sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length), { raw: { width: img.width, height: img.height, channels: 3 } })
    .png()
    .toBuffer();
}

export async function encodeRgbaPng(width: number, height: number, rgba: Uint8Array): Promise<Buffer> {
  return sharp(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.length), { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

/** The painter's picture at exactly W×H: contain-fit, centred, on white (Reed's placement). */
export async function pictureAt(bytes: Buffer, width: number, height: number): Promise<Rgb> {
  const { data, info } = await sharp(bytes, { failOn: "none" })
    .rotate()
    .flatten({ background: "#ffffff" })
    .toColourspace("srgb")
    .resize(width, height, { fit: "contain", position: "centre", background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .flatten({ background: "#ffffff" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data.buffer, data.byteOffset, data.length) };
}

export const dataUrlPng = (png: Buffer) => `data:image/png;base64,${png.toString("base64")}`;

/** The bytes of a base64 data URL. */
export function dataUrlBytes(url: string): Buffer {
  const comma = url.indexOf(",");
  return Buffer.from(comma >= 0 ? url.slice(comma + 1) : url, "base64");
}

// ------------------------------------------------------------------ paper and ink

const lum = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;
const chroma = (r: number, g: number, b: number) => Math.max(r, g, b) - Math.min(r, g, b);

export interface Paper {
  lum: number;
  chroma: number;
}

/**
 * The paper: the mean of the brightest fifth of the picture (luminance at or above its 80th
 * percentile, sampled). On a board that is mostly paper that is the paper; on a picture that came
 * back washed grey or cream it is the wash.
 */
export function paperOf(img: Rgb): Paper {
  const n = img.width * img.height;
  const step = Math.max(1, Math.floor(n / 40_000));
  const hist = new Uint32Array(256);
  let count = 0;
  for (let i = 0; i < n; i += step) {
    hist[Math.round(lum(img.data[i * 3], img.data[i * 3 + 1], img.data[i * 3 + 2]))]++;
    count++;
  }
  let cut = 255;
  for (let v = 0, acc = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= 0.8 * count) {
      cut = v;
      break;
    }
  }
  let L = 0;
  let C = 0;
  let k = 0;
  for (let i = 0; i < n; i += step) {
    const r = img.data[i * 3];
    const g = img.data[i * 3 + 1];
    const b = img.data[i * 3 + 2];
    const l = lum(r, g, b);
    if (Math.round(l) < cut) continue;
    L += l;
    C += chroma(r, g, b);
    k++;
  }
  return k ? { lum: L / k, chroma: C / k } : { lum: 255, chroma: 0 };
}

/** Per pixel: how much darker than its paper (≥ 0), and how much more coloured. */
function contrast(img: Rgb, paper: Paper): { dark: Float32Array; colour: Float32Array } {
  const n = img.width * img.height;
  const dark = new Float32Array(n);
  const colour = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = img.data[i * 3];
    const g = img.data[i * 3 + 1];
    const b = img.data[i * 3 + 2];
    dark[i] = Math.max(0, paper.lum - lum(r, g, b));
    colour[i] = Math.max(0, chroma(r, g, b) - paper.chroma);
  }
  return { dark, colour };
}

/** Ink: darker than the paper by `dark`, or more coloured by `colour`. */
export function inkMask(img: Rgb, dark = 40, colour = 50): Uint8Array {
  const c = contrast(img, paperOf(img));
  const out = new Uint8Array(img.width * img.height);
  for (let i = 0; i < out.length; i++) out[i] = c.dark[i] >= dark || c.colour[i] >= colour ? 1 : 0;
  return out;
}

/** A mask grown by `r` px (a square window, separable). */
export function dilate(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return mask.slice();
  const tmp = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let run = -1;
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) run = x;
      if (run >= 0 && x - run <= r) tmp[y * w + x] = 1;
    }
    run = -1;
    for (let x = w - 1; x >= 0; x--) {
      if (mask[y * w + x]) run = x;
      if (run >= 0 && run - x <= r) tmp[y * w + x] = 1;
    }
  }
  const out = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) {
    let run = -1;
    for (let y = 0; y < h; y++) {
      if (tmp[y * w + x]) run = y;
      if (run >= 0 && y - run <= r) out[y * w + x] = 1;
    }
    run = -1;
    for (let y = h - 1; y >= 0; y--) {
      if (tmp[y * w + x]) run = y;
      if (run >= 0 && run - y <= r) out[y * w + x] = 1;
    }
  }
  return out;
}

/** Drop connected pieces smaller than `min` px (8-connected), in place; how many went. */
export function dropSpecks(mask: Uint8Array, w: number, h: number, min: number): number {
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  const piece: number[] = [];
  let dropped = 0;
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || seen[s]) continue;
    piece.length = 0;
    stack.push(s);
    seen[s] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      piece.push(p);
      const x = p % w;
      const y = (p - x) / w;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (mask[q] && !seen[q]) {
            seen[q] = 1;
            stack.push(q);
          }
        }
    }
    if (piece.length < min) {
      for (const p of piece) mask[p] = 0;
      dropped++;
    }
  }
  return dropped;
}

/** Below this mean darkness a neutral piece is a grey wash, not ink (the painter's ink core is ~170+). */
export const WASH_DARK_MAX = 135;
/** A wash smaller than this is left to the speck and kid rules. */
export const WASH_MIN_PX = 1500;

/**
 * Takes out a grey, neutral wash that runs into the frame's edge: the painter's shadow or paper
 * texture (2026-10-25, a grey blob along the bottom of an accepted picture), never writing or a
 * diagram, which are dark (or coloured) and sit inside the frame. A wash comes back textured, in many
 * pieces, so the pieces are grouped first (dilated) and judged together. Returns the pixels dropped.
 */
export function dropGreyWash(
  core: Uint8Array,
  a: { dark: ArrayLike<number>; colour: ArrayLike<number> },
  w: number,
  h: number,
  border: number,
  colourMin: number,
): number {
  const edge = border + 2;
  let dropped = 0;
  for (const group of pieces(dilate(core, w, h, 3), w, h, WASH_MIN_PX)) {
    let n = 0;
    let dark = 0;
    let colour = 0;
    let touchesEdge = false;
    for (const p of group) {
      if (!core[p]) continue;
      n++;
      dark += a.dark[p];
      colour += a.colour[p];
      const x = p % w;
      const y = (p - x) / w;
      if (x < edge || y < edge || x >= w - edge || y >= h - edge) touchesEdge = true;
    }
    if (n < WASH_MIN_PX || !touchesEdge || colour / n >= colourMin || dark / n >= WASH_DARK_MAX) continue;
    for (const p of group) if (core[p]) {
      core[p] = 0;
      dropped++;
    }
  }
  return dropped;
}

/** 8-connected pieces of a mask: each piece's pixels' indices. */
export function pieces(mask: Uint8Array, w: number, h: number, min = 1): number[][] {
  const seen = new Uint8Array(w * h);
  const out: number[][] = [];
  const stack: number[] = [];
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || seen[s]) continue;
    const piece: number[] = [];
    stack.push(s);
    seen[s] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      piece.push(p);
      const x = p % w;
      const y = (p - x) / w;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (mask[q] && !seen[q]) {
            seen[q] = 1;
            stack.push(q);
          }
        }
    }
    if (piece.length >= min) out.push(piece);
  }
  return out;
}

function longSide(piece: readonly number[], w: number): number {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const p of piece) {
    const x = p % w;
    const y = (p - x) / w;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return Math.max(x1 - x0, y1 - y0) + 1;
}

/** The kid's letter height: the median height of their ink's pieces (specks left out), 0 with no ink. */
function letterHeight(kid: Uint8Array, w: number, h: number): number {
  const heights = pieces(kid, w, h, 12).map((piece) => {
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const p of piece) {
      const y = Math.floor(p / w);
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    return y1 - y0 + 1;
  });
  if (!heights.length) return 0;
  heights.sort((a, b) => a - b);
  return heights[Math.floor(heights.length / 2)];
}

// ------------------------------------------------------------------ alignment

/** Board px → picture px: x' = ax·x + bx, y' = ay·y + by. */
export interface Affine {
  ax: number;
  bx: number;
  ay: number;
  by: number;
}

/** Reed's contain-fit, as the map from the board into the picture. */
export function containFit(inW: number, inH: number, outW: number, outH: number): Affine {
  const k = Math.min(inW / outW, inH / outH); // picture px → board px
  const ox = (inW - outW * k) / 2;
  const oy = (inH - outH * k) / 2;
  return { ax: 1 / k, bx: -ox / k, ay: 1 / k, by: -oy / k };
}

function stretchFit(inW: number, inH: number, outW: number, outH: number): Affine {
  return { ax: outW / inW, bx: 0, ay: outH / inH, by: 0 };
}

function coverFit(inW: number, inH: number, outW: number, outH: number): Affine {
  const k = Math.max(inW / outW, inH / outH);
  const ox = (inW - outW * k) / 2;
  const oy = (inH - outH * k) / 2;
  return { ax: 1 / k, bx: -ox / k, ay: 1 / k, by: -oy / k };
}

export interface Alignment {
  t: Affine;
  /** share of the kid's ink that lands on the picture's ink (within 2 px) under `t` */
  score: number;
  start: string;
}

/** Up to `max` of the mask's pixels, evenly sampled, as [x, y]. */
function samplePoints(mask: Uint8Array, w: number, max: number): Array<[number, number]> {
  const all: number[] = [];
  for (let i = 0; i < mask.length; i++) if (mask[i]) all.push(i);
  const step = Math.max(1, all.length / max);
  const out: Array<[number, number]> = [];
  for (let k = 0; k < all.length; k += step) {
    const i = all[Math.floor(k)];
    out.push([i % w, Math.floor(i / w)]);
  }
  return out;
}

/**
 * The map from the board into the returned picture that puts the most of the kid's ink on ink.
 * `kid` is the kid's ink on the board (inW × inH). Ties keep the earlier candidate, so a picture
 * that is the board unchanged stays at Reed's contain-fit.
 */
export function align(kid: Uint8Array, inW: number, inH: number, pic: Rgb): Alignment {
  const outW = pic.width;
  const outH = pic.height;
  const starts = [
    { name: "contain", t: containFit(inW, inH, outW, outH) },
    { name: "stretch", t: stretchFit(inW, inH, outW, outH) },
    { name: "cover", t: coverFit(inW, inH, outW, outH) },
  ];
  const pts = samplePoints(kid, inW, 1500);
  if (!pts.length) return { t: starts[0].t, score: 0, start: "contain (no kid ink)" };
  const few = samplePoints(kid, inW, 400);
  const picInk = dilate(inkMask(pic, 50, 255), outW, outH, 2);
  const scoreOn = (sample: Array<[number, number]>, t: Affine): number => {
    let hit = 0;
    for (const [x, y] of sample) {
      const u = Math.round(t.ax * x + t.bx);
      const v = Math.round(t.ay * y + t.by);
      if (u >= 0 && v >= 0 && u < outW && v < outH && picInk[v * outW + u]) hit++;
    }
    return hit / sample.length;
  };
  const score = (t: Affine) => scoreOn(pts, t);
  const cx = inW / 2;
  const cy = inH / 2;
  // scale about the board's centre, then shift (picture px)
  const around = (t: Affine, k: number, kx: number, dx: number, dy: number): Affine => {
    const ax = t.ax * k * kx;
    const ay = t.ay * k;
    const ux = t.ax * cx + t.bx;
    const uy = t.ay * cy + t.by;
    return { ax, bx: ux - ax * cx + dx, ay, by: uy - ay * cy + dy };
  };
  /** Coarse to fine around `t0`: the best map found and its score (on every sample point). */
  const search = (t0: Affine): { t: Affine; score: number } => {
    let best = { t: t0, score: score(t0) };
    if (best.score >= 0.98) return best;
    // coarse, on a few points: scale ±6% (both axes, then a little aspect), shift ±3% of the picture
    const span = Math.round(0.03 * Math.max(outW, outH));
    let coarse = { t: t0, score: scoreOn(few, t0) };
    for (const k of [0.94, 0.96, 0.98, 1, 1.02, 1.04, 1.06])
      for (const kx of [0.98, 1, 1.02])
        for (let dx = -span; dx <= span; dx += 6)
          for (let dy = -span; dy <= span; dy += 6) {
            const t = around(t0, k, kx, dx, dy);
            const v = scoreOn(few, t);
            if (v > coarse.score) coarse = { t, score: v };
          }
    // then on every point: ±1% and ±6 px in 2 px steps, and ±0.5% and ±1 px around that
    for (const [ks, kxs, reach, step] of [
      [[0.99, 1, 1.01], [0.995, 1, 1.005], 6, 2],
      [[0.995, 1, 1.005], [0.9975, 1, 1.0025], 1, 1],
    ] as const) {
      const base = best.score >= scoreOn(pts, coarse.t) ? best.t : coarse.t;
      for (const k of ks)
        for (const kx of kxs)
          for (let dx = -reach; dx <= reach; dx += step)
            for (let dy = -reach; dy <= reach; dy += step) {
              const t = around(base, k, kx, dx, dy);
              const v = score(t);
              if (v > best.score) best = { t, score: v };
            }
      coarse = best;
    }
    return best;
  };
  // the most promising start first; the others only when it does not fit well
  const ranked = starts.map((s) => ({ ...s, base: score(s.t) })).sort((a, b) => b.base - a.base);
  let best: Alignment = { t: starts[0].t, score: -1, start: starts[0].name };
  for (const s of ranked) {
    const found = search(s.t);
    if (found.score > best.score) best = { t: found.t, score: found.score, start: s.name };
    if (best.score >= 0.9) break;
  }
  return best;
}

/** The picture resampled onto the board's grid under `t` (bilinear); outside the picture is white. */
export function warp(pic: Rgb, t: Affine, inW: number, inH: number): Rgb {
  const out = new Uint8Array(inW * inH * 3).fill(255);
  const W = pic.width;
  const H = pic.height;
  const d = pic.data;
  for (let y = 0; y < inH; y++) {
    for (let x = 0; x < inW; x++) {
      const u = t.ax * x + t.bx;
      const v = t.ay * y + t.by;
      if (u < 0 || v < 0 || u > W - 1 || v > H - 1) continue;
      const x0 = Math.floor(u);
      const y0 = Math.floor(v);
      const x1 = Math.min(W - 1, x0 + 1);
      const y1 = Math.min(H - 1, y0 + 1);
      const fx = u - x0;
      const fy = v - y0;
      const o = (y * inW + x) * 3;
      for (let c = 0; c < 3; c++) {
        const a = d[(y0 * W + x0) * 3 + c] * (1 - fx) + d[(y0 * W + x1) * 3 + c] * fx;
        const b = d[(y1 * W + x0) * 3 + c] * (1 - fx) + d[(y1 * W + x1) * 3 + c] * fx;
        out[o + c] = Math.round(a * (1 - fy) + b * fy);
      }
    }
  }
  return { width: inW, height: inH, data: out };
}

// ------------------------------------------------------------------ what the model added

/** The board's ink counts within this many px of the picture's (the alignment's slack). */
export const NEAR_KID = 3;
/** An addition's core is grown by this many px into its own soft edge. */
export const GROW = 2;

export interface OverlayOptions {
  /** clearly darker than the board at that spot (luminance, against each picture's paper) */
  dark?: number;
  /** clearly more coloured (chroma, against each picture's paper) */
  colour?: number;
  /** pieces smaller than this many px are specks */
  speck?: number;
  /** the picture's edge, px, ignored (models draw frames) */
  border?: number;
}

export interface OverlayResult {
  /** W×H RGBA: the additions in the picture's colours, everything else transparent */
  rgba: Uint8Array;
  /** 1 where the overlay is drawn */
  mask: Uint8Array;
  addedPx: number;
  alignment: Alignment;
}

/**
 * What the model added: `board` is the capture (W×H), `pic` the painter's picture at any size. The
 * picture is aligned onto the board, then a pixel is an addition when it is ink in the picture, it
 * is clearly darker or more coloured than the board at the same spot, and the board has no ink
 * within NEAR_KID px. Darkness and colour are each measured against their own picture's paper.
 */
export function overlayOf(board: Rgb, pic: Rgb, opts: OverlayOptions = {}): OverlayResult {
  const W = board.width;
  const H = board.height;
  const n = W * H;
  const darkMin = opts.dark ?? 55;
  const colourMin = opts.colour ?? 55;
  const border = opts.border ?? 3;

  const boardPaper = paperOf(board);
  const b = contrast(board, boardPaper);
  const kid = new Uint8Array(n);
  for (let i = 0; i < n; i++) kid[i] = b.dark[i] >= 40 || b.colour[i] >= 50 ? 1 : 0;

  const alignment = align(kid, W, H, pic);
  const aligned = warp(pic, alignment.t, W, H);
  const a = contrast(aligned, paperOf(aligned));
  const kidNear = dilate(kid, W, H, NEAR_KID);

  const core = new Uint8Array(n);
  const soft = new Uint8Array(n);
  for (let y = border; y < H - border; y++)
    for (let x = border; x < W - border; x++) {
      const i = y * W + x;
      if (kidNear[i]) continue;
      const moreDark = a.dark[i] - b.dark[i];
      const moreColour = a.colour[i] - b.colour[i];
      if ((a.dark[i] >= darkMin && moreDark >= darkMin) || (a.colour[i] >= colourMin && moreColour >= colourMin)) core[i] = 1;
      else if ((a.dark[i] >= 14 && moreDark >= 14) || (a.colour[i] >= 18 && moreColour >= 18)) soft[i] = 1;
    }
  dropSpecks(core, W, H, opts.speck ?? 10);
  // A dark, neutral piece that touches the kid's writing and is smaller than one of their letters is
  // the kid's writing redrawn or changed (a "1" painted over as a "7"), not an annotation: it goes.
  const touch = dilate(kidNear, W, H, 1);
  const smallPart = Math.max(24, 0.8 * letterHeight(kid, W, H));
  for (const piece of pieces(core, W, H)) {
    let touches = false;
    let colourSum = 0;
    for (const p of piece) {
      if (touch[p]) touches = true;
      colourSum += a.colour[p];
    }
    if (touches && colourSum / piece.length < colourMin && longSide(piece, W) <= smallPart) for (const p of piece) core[p] = 0;
  }
  dropGreyWash(core, a, W, H, border, colourMin);
  const grown = dilate(core, W, H, GROW);

  const rgba = new Uint8Array(n * 4);
  const mask = new Uint8Array(n);
  let addedPx = 0;
  for (let i = 0; i < n; i++) {
    if (!(core[i] || (grown[i] && soft[i]))) continue;
    mask[i] = 1;
    addedPx++;
    rgba[i * 4] = aligned.data[i * 3];
    rgba[i * 4 + 1] = aligned.data[i * 3 + 1];
    rgba[i * 4 + 2] = aligned.data[i * 3 + 2];
    rgba[i * 4 + 3] = 255;
  }
  return { rgba, mask, addedPx, alignment };
}
