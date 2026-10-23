/**
 * The tracer's pixels: the caller's bitmap (grey, RGB or RGBA) as a small RGB working copy, and the
 * decoder that turns an image file into a bitmap.
 *
 * WHY A WORKING COPY. An image model's picture is 1–2k pixels a side with lines 4–12 px wide; at
 * ~1024 on the long side those lines are still 2–6 px, plenty for a centreline, and every later
 * step (thinning, the graph) costs in proportion to the pixels. Shrinking is an AREA average, not a
 * sample: a thin line shrinks into a fainter one instead of breaking into dashes, and the
 * hysteresis threshold (`ink.ts`) keeps the faint part.
 *
 * Transparency is paper: an RGBA bitmap is composited onto white first, so a transparent
 * background is not read as black ink.
 */

export interface Bitmap {
  width: number;
  height: number;
  channels: 1 | 3 | 4;
  data: Uint8Array | Uint8ClampedArray;
}

/** The working copy: RGB, 3 bytes a pixel, row-major, and how it scales from the source. */
export interface Working {
  w: number;
  h: number;
  rgb: Uint8Array;
  /** working pixels per source pixel, on each axis (1 when the source was small enough) */
  sx: number;
  sy: number;
}

/** The long side of the working copy unless the caller says otherwise. */
export const DEFAULT_MAX_SIDE = 1024;

/** A bitmap the tracer cannot read is the caller's bug, not a blank picture: it throws. */
export function checkBitmap(bm: Bitmap): void {
  const { width, height, channels, data } = bm;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new Error(`trace: bad bitmap size ${width}×${height}`);
  if (channels !== 1 && channels !== 3 && channels !== 4) throw new Error(`trace: bad channel count ${String(channels)}`);
  if (!data || data.length < width * height * channels) throw new Error(`trace: bitmap data is ${data?.length ?? 0} bytes, needs ${width * height * channels}`);
}

/** The source as RGB on white paper. */
function toRgb(bm: Bitmap): Uint8Array {
  const n = bm.width * bm.height;
  const src = bm.data;
  if (bm.channels === 3) return src instanceof Uint8Array && src.length === n * 3 ? src : Uint8Array.from(src.subarray(0, n * 3));
  const out = new Uint8Array(n * 3);
  if (bm.channels === 1) {
    for (let i = 0; i < n; i++) out[i * 3] = out[i * 3 + 1] = out[i * 3 + 2] = src[i];
    return out;
  }
  for (let i = 0; i < n; i++) {
    const a = src[i * 4 + 3];
    const paper = 255 - a;
    // c·a + 255·(1 − a), in integer arithmetic (a in 0..255)
    out[i * 3] = (src[i * 4] * a + 255 * paper + 127) / 255;
    out[i * 3 + 1] = (src[i * 4 + 1] * a + 255 * paper + 127) / 255;
    out[i * 3 + 2] = (src[i * 4 + 2] * a + 255 * paper + 127) / 255;
  }
  return out;
}

/** The source cells each output cell covers along one axis, and the share of each (they sum to 1). */
function spans(src: number, dst: number): { off: Int32Array; idx: Int32Array; wt: Float32Array } {
  const f = src / dst;
  const off = new Int32Array(dst + 1);
  const idx: number[] = [];
  const wt: number[] = [];
  for (let j = 0; j < dst; j++) {
    off[j] = idx.length;
    const a = j * f;
    const b = Math.min(src, (j + 1) * f);
    for (let i = Math.floor(a); i < Math.ceil(b); i++) {
      const o = Math.min(i + 1, b) - Math.max(i, a);
      if (o > 1e-9) {
        idx.push(i);
        wt.push(o / f);
      }
    }
  }
  off[dst] = idx.length;
  return { off, idx: Int32Array.from(idx), wt: Float32Array.from(wt) };
}

/** Area-average downscale of an RGB image (separable: rows, then columns). */
function shrink(rgb: Uint8Array, W: number, H: number, w: number, h: number): Uint8Array {
  const xs = spans(W, w);
  const ys = spans(H, h);
  const tmp = new Float32Array(w * H * 3);
  for (let y = 0; y < H; y++) {
    const row = y * W * 3;
    const out = y * w * 3;
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let k = xs.off[x]; k < xs.off[x + 1]; k++) {
        const s = row + xs.idx[k] * 3;
        const q = xs.wt[k];
        r += rgb[s] * q;
        g += rgb[s + 1] * q;
        b += rgb[s + 2] * q;
      }
      const o = out + x * 3;
      tmp[o] = r;
      tmp[o + 1] = g;
      tmp[o + 2] = b;
    }
  }
  const dst = new Uint8Array(w * h * 3);
  const acc = new Float32Array(w * 3);
  for (let y = 0; y < h; y++) {
    acc.fill(0);
    for (let k = ys.off[y]; k < ys.off[y + 1]; k++) {
      const src = ys.idx[k] * w * 3;
      const q = ys.wt[k];
      for (let i = 0; i < w * 3; i++) acc[i] += tmp[src + i] * q;
    }
    const out = y * w * 3;
    for (let i = 0; i < w * 3; i++) dst[out + i] = Math.max(0, Math.min(255, Math.round(acc[i])));
  }
  return dst;
}

/** The working copy of a bitmap: RGB on white, the long side at most `maxSide` (aspect kept). */
export function workingCopy(bm: Bitmap, maxSide = DEFAULT_MAX_SIDE): Working {
  checkBitmap(bm);
  const rgb = toRgb(bm);
  const side = Math.max(16, Math.floor(Number.isFinite(maxSide) ? maxSide : DEFAULT_MAX_SIDE));
  const long = Math.max(bm.width, bm.height);
  if (long <= side) return { w: bm.width, h: bm.height, rgb, sx: 1, sy: 1 };
  const k = side / long;
  const w = Math.max(1, Math.round(bm.width * k));
  const h = Math.max(1, Math.round(bm.height * k));
  return { w, h, rgb: shrink(rgb, bm.width, bm.height, w, h), sx: w / bm.width, sy: h / bm.height };
}

/**
 * PNG, JPEG or WebP bytes → a bitmap, turned upright (EXIF), on white (alpha flattened), RGB, the
 * long side at most `maxSide` (never enlarged). sharp is loaded on first use, so importing the
 * tracer costs nothing where only the bitmap half is needed.
 */
export async function decodeImage(bytes: Buffer | Uint8Array, maxSide = DEFAULT_MAX_SIDE): Promise<Bitmap> {
  const { default: sharp } = await import("sharp");
  const side = Math.max(16, Math.floor(Number.isFinite(maxSide) ? maxSide : DEFAULT_MAX_SIDE));
  const { data, info } = await sharp(bytes, { failOn: "none", limitInputPixels: 80_000_000 })
    .rotate()
    .resize({ width: side, height: side, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .toColourspace("srgb")
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const channels = info.channels === 1 || info.channels === 3 || info.channels === 4 ? info.channels : 3;
  return { width: info.width, height: info.height, channels, data: new Uint8Array(data.buffer, data.byteOffset, data.length) };
}
