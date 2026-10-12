/**
 * The current screen as a picture for Ask (docs/ASK-V2.md, part "vision"). CONTRACT STUB: the
 * vision part writes it (on `inkCrop.ts`'s tried ways to get an image out of tldraw on iPads):
 * only the current screen's shapes, JPEG or WebP, at most ~1024 px on its long side and
 * ASK_LIMITS.imageChars as a data URL, never throwing, and lazy (never in the board's first load).
 */
import type { Editor } from "tldraw";

/** A data URL of the current screen, or null when it is empty or the picture could not be made in time. */
export async function captureAskImage(_editor: Editor, _opts: { timeoutMs?: number } = {}): Promise<string | null> {
  return null;
}
