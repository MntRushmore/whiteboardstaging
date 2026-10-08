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

/** Encodes the thumbnail at `width` px wide; returns the data URL (or null when it cannot). */
export type ThumbnailEncoder = (width: number, type: string, quality: number) => string | null;

/**
 * The first data URL, largest width and best encoding first, that fits in `maxChars`.
 * A URL of another type than asked for (a browser without that encoder falls back to PNG) is
 * skipped. Null when nothing fits.
 */
export function fitThumbnail(encode: ThumbnailEncoder, maxChars: number): string | null {
  for (const width of THUMBNAIL_WIDTHS) {
    for (const { type, quality } of THUMBNAIL_ENCODINGS) {
      const url = encode(width, type, quality);
      if (!url || !url.startsWith(`data:${type}`)) continue;
      if (url.length <= maxChars) return url;
    }
  }
  return null;
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
    return fitThumbnail((width, type, quality) => {
      canvas.width = width;
      canvas.height = thumbnailHeight(width);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL(type, quality);
    }, maxChars);
  } finally {
    bitmap.close();
  }
}
