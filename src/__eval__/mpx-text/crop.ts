/**
 * The JPEG the board would send for a line: `captureInkCrop` (src/lib/live/inkCrop.ts) itself, run
 * in Node on a Skia canvas (`@napi-rs/canvas`, already installed with pdfjs-dist).
 *
 * The board's first try is tldraw's own export (`toImage`), which needs a DOM; it is the one that
 * fails on iPads, where the crop comes from the hand-drawn path instead — black round-capped
 * strokes on white, `min(512, max(256, 2 × width))` px wide, JPEG 0.8, then smaller until it fits
 * 200 KB. With `toImage: null` that is the path taken here, line for line, so every reader in the
 * eval gets the picture an iPad would send.
 */
import { createCanvas } from "@napi-rs/canvas";
import { LIVE_LIMITS, type Rect } from "@/lib/live/contracts";
import { captureInkCrop, type InkCanvas, type InkContext } from "@/lib/live/inkCrop";

/** `InkCanvas` over a Skia canvas: `toBlob` encodes with Skia's JPEG encoder. */
export function skiaCanvas(): InkCanvas {
  const c = createCanvas(1, 1);
  return {
    get width() {
      return c.width;
    },
    set width(v: number) {
      c.width = v;
    },
    get height() {
      return c.height;
    },
    set height(v: number) {
      c.height = v;
    },
    getContext: () => c.getContext("2d") as unknown as InkContext,
    toBlob(cb, type, quality) {
      try {
        const buf = c.toBuffer("image/jpeg", Math.round(quality * 100));
        cb(new Blob([new Uint8Array(buf)], { type }));
      } catch {
        cb(null);
      }
    },
  };
}

export interface LineCrop {
  dataUrl: string;
  bytes: number;
  how: string;
}

/** The crop of these strokes (page space) in `bounds`, as the board makes it on an iPad. */
export async function lineCrop(segments: ReadonlyArray<ReadonlyArray<{ x: number; y: number }>>, bounds: Rect, maxWidth = 512): Promise<LineCrop | null> {
  const res = await captureInkCrop({ toImage: null, strokes: () => segments, bounds, maxWidth, maxBytes: LIVE_LIMITS.maxCropBytes, createCanvas: skiaCanvas });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.blob.arrayBuffer());
  return { dataUrl: `data:image/jpeg;base64,${buf.toString("base64")}`, bytes: buf.length, how: res.how };
}
