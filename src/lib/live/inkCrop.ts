import type { Rect } from "./contracts";

/**
 * A JPEG of some ink for the vision readers (the recognize fallback, the second reader, a figure),
 * made so that it comes back on every browser.
 *
 * tldraw's `toImage` (SVG -> <img> -> canvas -> JPEG) is the first try: it draws the ink as the
 * board does. On iPads it fails: production saw the recognize route ask for a crop and the board
 * have none to send (Chrome and Safari on iOS), which turned a line Mathpix could not read into
 * "The tutor service had a hiccup". WebKit is the usual suspect: an SVG data URL that will not
 * decode (a long Pencil stroke has thousands of points), a canvas refused for memory (iOS caps the
 * canvas memory of a page, and frees a canvas only when it is collected; `toImage` draws at twice
 * the size asked for), or a toBlob that answers null. Some of those make `toImage` hang rather
 * than throw, so each try has a deadline.
 *
 * So, in order, the first that gives a JPEG within `maxBytes`:
 *   1. `toImage` as before (pixel ratio 2, quality 0.8);
 *   2. when that was only too big: `toImage` at pixel ratio 1, quality 0.6;
 *   3. the strokes drawn by hand on a small canvas of our own (no SVG, no <img>): black on white
 *      at the width asked for, then at a lower quality and smaller until it fits.
 * Never throws; `null` when nothing worked (with what failed, for the caller's metric).
 */

export type ToImage = (opts: {
  format: "jpeg";
  quality: number;
  background: true;
  padding: number;
  bounds: Rect;
  scale: number;
  pixelRatio: number;
}) => Promise<{ blob: Blob } | null | undefined>;

/** The 2D context calls `drawInk` makes (a real CanvasRenderingContext2D, or a test's fake). */
export interface InkContext {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  fillRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, r: number, start: number, end: number): void;
  fill(): void;
  stroke(): void;
}

export interface InkCanvas {
  width: number;
  height: number;
  getContext(kind: "2d"): InkContext | null;
  toBlob(cb: (blob: Blob | null) => void, type: string, quality: number): void;
}

export interface InkCropInput {
  /** tldraw's export of the shapes (null when the editor has none) */
  toImage: ToImage | null;
  /** the ink's strokes in page coordinates, one polyline per segment (for the hand-drawn fallback) */
  strokes: () => ReadonlyArray<ReadonlyArray<{ x: number; y: number }>>;
  /** page-space bounds of the ink */
  bounds: Rect;
  /** output width, at most */
  maxWidth: number;
  maxBytes: number;
  /** a canvas for the hand-drawn fallback (null where there is no DOM) */
  createCanvas?: () => InkCanvas | null;
  /** a try that has not answered in this long has failed (some WebKit failures never answer) */
  attemptMs?: number;
}

export type InkCropResult =
  | { ok: true; blob: Blob; how: "export" | "export-small" | "drawn"; tried: string[] }
  | { ok: false; tried: string[] };

/** Padding around the ink, in page units (as the export's `padding` and `expandRect(bounds, 8)`). */
const PAD = 8;
const ATTEMPT_MS = 2500;

function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no answer in ${ms} ms`)), ms);
    work.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

function defaultCanvas(): InkCanvas | null {
  if (typeof document === "undefined") return null;
  return document.createElement("canvas") as unknown as InkCanvas;
}

/**
 * Draws `strokes` (page coordinates) black on white into `ctx`, `bounds` padded by PAD mapped onto
 * a `w` x `h` canvas. A stroke of one point (a dot, the tick of an `=`) is a dot. Pure but for the
 * context it is given: exported for tests.
 */
export function drawInk(ctx: InkContext, strokes: ReadonlyArray<ReadonlyArray<{ x: number; y: number }>>, bounds: Rect, w: number, h: number): void {
  const scale = w / (bounds.w + PAD * 2);
  const ox = bounds.x - PAD;
  const oy = bounds.y - PAD;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  // about the weight of a pen stroke on the board, at the size the readers see
  const width = Math.max(1.5, Math.min(6, 3.5 * scale));
  ctx.strokeStyle = "#000000";
  ctx.fillStyle = "#000000";
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const points of strokes) {
    if (points.length === 0) continue;
    const at = (p: { x: number; y: number }) => [(p.x - ox) * scale, (p.y - oy) * scale] as const;
    if (points.length === 1) {
      const [x, y] = at(points[0]);
      ctx.beginPath();
      ctx.arc(x, y, width / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.beginPath();
    const [x0, y0] = at(points[0]);
    ctx.moveTo(x0, y0);
    for (let i = 1; i < points.length; i++) {
      const [x, y] = at(points[i]);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

/** The strokes drawn by hand at `width` px and `quality`, or null when the canvas would not. */
async function drawnJpeg(input: InkCropInput, width: number, quality: number): Promise<Blob | null> {
  const canvas = (input.createCanvas ?? defaultCanvas)();
  if (!canvas) return null;
  const { bounds } = input;
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(((bounds.h + PAD * 2) / (bounds.w + PAD * 2)) * w));
  try {
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    drawInk(ctx, input.strokes(), bounds, w, h);
    return await withDeadline(new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality)), input.attemptMs ?? ATTEMPT_MS);
  } finally {
    // iOS frees a canvas's memory only when it is collected: give it back now
    canvas.width = 0;
    canvas.height = 0;
  }
}

/** The first JPEG of the ink within `maxBytes` (see the module comment). Never throws. */
export async function captureInkCrop(input: InkCropInput): Promise<InkCropResult> {
  const tried: string[] = [];
  const { bounds, maxWidth, maxBytes } = input;
  if (!(bounds.w > 0) || !(bounds.h >= 0)) return { ok: false, tried: ["no-bounds"] };
  const scale = Math.min(1, maxWidth / bounds.w);
  const ms = input.attemptMs ?? ATTEMPT_MS;
  const toImage = input.toImage;
  const exportAt = async (pixelRatio: number, quality: number): Promise<Blob | "big"> => {
    if (!toImage) throw new Error("unavailable");
    const out = await withDeadline(
      toImage({ format: "jpeg", quality, background: true, padding: PAD, bounds: { x: bounds.x - PAD, y: bounds.y - PAD, w: bounds.w + PAD * 2, h: bounds.h + PAD * 2 }, scale, pixelRatio }),
      ms,
    );
    if (!out?.blob || out.blob.size === 0) throw new Error("no image");
    return out.blob.size > maxBytes ? "big" : out.blob;
  };

  // 1. the board's own export, as before
  let exportBroke = false;
  try {
    const blob = await exportAt(2, 0.8);
    if (blob instanceof Blob) return { ok: true, blob, how: "export", tried };
    tried.push("export:big");
  } catch (err) {
    exportBroke = true;
    tried.push(`export:${err instanceof Error ? err.message.slice(0, 40) : "failed"}`);
  }
  // 2. only too big: half the pixels, lower quality
  if (!exportBroke) {
    try {
      const blob = await exportAt(1, 0.6);
      if (blob instanceof Blob) return { ok: true, blob, how: "export-small", tried };
      tried.push("export-small:big");
    } catch (err) {
      tried.push(`export-small:${err instanceof Error ? err.message.slice(0, 40) : "failed"}`);
    }
  }
  // 3. drawn by hand: smaller and lower quality until it fits
  // big enough for a reader to make out a small line, never wider than asked for
  const width = Math.min(maxWidth, Math.max(256, bounds.w * 2));
  for (const [w, q] of [
    [width, 0.8],
    [width, 0.5],
    [width / 2, 0.5],
  ] as const) {
    try {
      const blob = await drawnJpeg(input, w, q);
      if (!blob) {
        tried.push("drawn:none");
        break;
      }
      if (blob.size <= maxBytes) return { ok: true, blob, how: "drawn", tried };
      tried.push("drawn:big");
    } catch (err) {
      tried.push(`drawn:${err instanceof Error ? err.message.slice(0, 40) : "failed"}`);
      break;
    }
  }
  return { ok: false, tried };
}
