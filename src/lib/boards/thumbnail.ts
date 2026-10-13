import { Box, type Editor } from "tldraw";
import { readScreenMeta, screenForContent, SCREEN, type ScreenMeta } from "@/lib/screens/screens";

/**
 * The dashboard card's thumbnail: the board's current screen, 16:9, as a data URL that fits
 * `whiteboards.preview` (a check constraint caps it at 20000 chars).
 *
 * The first version exported the whole viewport at `scale: 0.25` and left tldraw's default
 * `pixelRatio: 2` on, so a card got an ~850 x 540 JPEG of the screen plus its margins. On a
 * board with a screenful of ink that came out a little over the cap and the save dropped it
 * without a word, so dense boards never had a thumbnail. Now the export is exactly the screen
 * at a fixed size, and the encoding steps down (WebP, then JPEG; then smaller) until it fits.
 */

/** Widths tried, largest first. 640 is crisp for a ~300 px card on a 2x display. */
export const THUMBNAIL_WIDTHS = [640, 480, 320] as const;

/**
 * Encodings tried at each width, best first. Chrome and Firefox encode WebP (a screenful of ink
 * at 640 px is ~11-14K chars at 0.8); Safari cannot and hands back a PNG, so it lands on JPEG.
 */
export const THUMBNAIL_ENCODINGS = [
  { type: "image/webp", quality: 0.8 },
  { type: "image/webp", quality: 0.6 },
  { type: "image/jpeg", quality: 0.7 },
  { type: "image/jpeg", quality: 0.5 },
] as const;

export function thumbnailHeight(width: number): number {
  return Math.round((width * SCREEN.h) / SCREEN.w);
}

/**
 * Encodes the thumbnail at `width` px wide; resolves to the encoded image (or null when it cannot).
 * A Blob, not a data URL: `canvas.toBlob` encodes off the main thread, where `toDataURL` blocked it
 * for every rung tried (measured 2026-10-13 on a board of ~550 strokes: ~7 encodes, ~85 ms of main
 * thread per autosave at full speed, every 10 s while the student writes; a hitch in the pen).
 */
export type ThumbnailEncoder = (width: number, type: string, quality: number) => Promise<Blob | null>;

/** Every width and encoding in the order tried: largest width first, best encoding first at each. */
export const THUMBNAIL_RUNGS: ReadonlyArray<{ width: number; type: string; quality: number }> = THUMBNAIL_WIDTHS.flatMap((width) =>
  THUMBNAIL_ENCODINGS.map(({ type, quality }) => ({ width, type, quality })),
);

/** The length of the data URL `blob` becomes (`data:<type>;base64,` + its base64), without making it. */
export function dataUrlLength(type: string, bytes: number): number {
  return `data:${type};base64,`.length + 4 * Math.ceil(bytes / 3);
}

/**
 * The first encoding, from rung `startAt` of `THUMBNAIL_RUNGS` down (largest width and best encoding
 * first), whose data URL fits in `maxChars`, with the rung it is. An image of another type than asked
 * for (a browser without that encoder falls back to PNG) is skipped. Null when nothing fits.
 */
export async function fitThumbnail(encode: ThumbnailEncoder, maxChars: number, startAt = 0): Promise<{ blob: Blob; rung: number } | null> {
  for (let rung = Math.max(0, startAt); rung < THUMBNAIL_RUNGS.length; rung++) {
    const { width, type, quality } = THUMBNAIL_RUNGS[rung];
    const blob = await encode(width, type, quality);
    if (!blob || blob.type !== type) continue;
    if (dataUrlLength(type, blob.size) <= maxChars) return { blob, rung };
  }
  return null;
}

/**
 * Where the next thumbnail of a board starts on the ladder: at the rung that fitted last time, so a
 * board that needed the 7th rung is not encoded 7 times on every save. A board can get lighter (ink
 * rubbed out), so every `THUMBNAIL_REFIT_MS` the ladder is walked from the top again.
 */
export const THUMBNAIL_REFIT_MS = 60_000;

export interface ThumbnailRungMemory {
  /** the rung to start this thumbnail at */
  start(now: number): number;
  /** the rung that fitted (null: nothing did) */
  fitted(rung: number | null): void;
}

export function createRungMemory(refitMs = THUMBNAIL_REFIT_MS): ThumbnailRungMemory {
  let rung = 0;
  /** when the ladder was last walked from the top; null = never */
  let walkedAt: number | null = null;
  return {
    start(now) {
      if (walkedAt === null || now - walkedAt >= refitMs) {
        walkedAt = now;
        return 0;
      }
      return rung;
    },
    fitted(fit) {
      if (fit === null) {
        // nothing fitted: start from the top next time (the board may be lighter by then)
        rung = 0;
        walkedAt = null;
      } else rung = fit;
    },
  };
}

const rungMemories = new WeakMap<object, ThumbnailRungMemory>();

function rungMemoryFor(editor: object): ThumbnailRungMemory {
  let memory = rungMemories.get(editor);
  if (!memory) {
    memory = createRungMemory();
    rungMemories.set(editor, memory);
  }
  return memory;
}

function blobToDataUrl(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}

/** The rect a thumbnail shows: the page's screen, or (before it has one) a screen around its ink. */
export function thumbnailRect(pageMeta: unknown, content: { x: number; y: number; w: number; h: number } | null): ScreenMeta {
  return readScreenMeta(pageMeta) ?? screenForContent(content);
}

/** True when no screen of the board has anything on it. */
export function isBoardEmpty(editor: Pick<Editor, "getPages" | "getPageShapeIds">): boolean {
  return editor.getPages().every((page) => editor.getPageShapeIds(page.id).size === 0);
}

/**
 * The current screen as a thumbnail data URL, or null when the screen is empty or the export
 * fails. tldraw exports only the current page, so this is the screen the student is on.
 */
export async function makeScreenThumbnail(editor: Editor, maxChars: number): Promise<string | null> {
  const shapeIds = editor.getCurrentPageShapeIds();
  if (shapeIds.size === 0) return null;
  const content = editor.getCurrentPageBounds();
  const screen = thumbnailRect(editor.getCurrentPage().meta, content ? { x: content.x, y: content.y, w: content.w, h: content.h } : null);
  const largest = THUMBNAIL_WIDTHS[0];
  // Live's typeset maths exports as a line of monospace text (MathShapeUtil.toSvg), which at
  // card size is noise beside the ink: the card shows the page as it was written.
  const inked = [...shapeIds].filter((id) => editor.getShape(id)?.type !== "math");
  // One export at the largest size, pixelRatio 1 (the default of 2 doubles every side);
  // the smaller sizes and qualities are re-encodes of that bitmap, which are cheap.
  const { blob } = await editor.toImage(inked.length > 0 ? inked : [...shapeIds], {
    format: "png",
    bounds: new Box(screen.x, screen.y, screen.w, screen.h),
    padding: 0,
    scale: largest / screen.w,
    pixelRatio: 1,
    background: true,
  });
  if (!blob) return null;
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const memory = rungMemoryFor(editor);
    const fit = await fitThumbnail(
      (width, type, quality) => {
        canvas.width = width;
        canvas.height = thumbnailHeight(width);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
      },
      maxChars,
      memory.start(Date.now()),
    );
    memory.fitted(fit?.rung ?? null);
    return fit ? blobToDataUrl(fit.blob) : null;
  } finally {
    bitmap.close();
  }
}
