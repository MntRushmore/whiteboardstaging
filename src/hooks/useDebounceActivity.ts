import React, { useEffect } from "react";
import type { Editor, HistoryEntry, TLRecord, TLShape, TLStore } from "tldraw";
import { isLiveMeta } from "@/lib/live/contracts";
import { isAiOverlayShape } from "./useAiOverlayShapes";

/**
 * Shapes owned by the Live layer or by the legacy image pipeline itself. Edits to these
 * (echo re-placement, a graph resize, retyping an echo, an AI overlay landing) are not
 * student work and must not restart the idle timer.
 */
export function isLiveManagedShape(shape: Pick<TLShape, "type" | "meta">): boolean {
  return shape.type === "math" || shape.type === "graph" || isLiveMeta(shape.meta) || isAiOverlayShape(shape);
}

/**
 * Content inserted *for* the student rather than written *by* them: stickers, uploaded PDF
 * pages and generated worksheets all carry `meta.isProtected` (StickerLibrary, PdfUpload,
 * WorksheetGenerator). Dropping one on the canvas is not student work, so it must not start
 * the idle timer — otherwise the legacy image pipeline fires an unrequested 25-credit
 * `/api/generate-solution` call. Same rule as `isStudentInk` in src/lib/live/liveLoop.ts.
 */
export function isProtectedShape(shape: Pick<TLShape, "meta">): boolean {
  return Boolean(shape.meta?.isProtected);
}

function changedRecords(entry: HistoryEntry<TLRecord>): TLRecord[] {
  const out: TLRecord[] = [];
  for (const rec of Object.values(entry.changes.added)) out.push(rec);
  for (const [from, to] of Object.values(entry.changes.updated)) {
    out.push(from);
    out.push(to);
  }
  for (const rec of Object.values(entry.changes.removed)) out.push(rec);
  return out;
}

/**
 * true when the entry adds/updates/removes student ink or content shapes. Entries whose
 * changed shapes are all math/graph/live-meta/AI-overlay or protected (sticker, PDF page,
 * worksheet) shapes are ignored, and so are entries that touch no shape at all (assets,
 * pages, document meta).
 */
export function isStudentActivity(entry: HistoryEntry<TLRecord>): boolean {
  return changedRecords(entry).some(
    (rec) => rec.typeName === "shape" && !isLiveManagedShape(rec) && !isProtectedShape(rec),
  );
}

export interface ActivityDebouncerOptions {
  /** idle time after the last student edit before `callback` fires */
  delay: number;
  /** while true, edits are ignored (accept/reject/clear bookkeeping) */
  shouldIgnoreRef?: React.MutableRefObject<boolean>;
  /** while true, edits are ignored (a generation is in flight) */
  isProcessingRef?: React.MutableRefObject<boolean>;
}

/**
 * Store-level core of useDebounceActivity: listens to user-sourced document changes and
 * fires `callback` once the student has been idle for `delay` ms. Returns a dispose fn.
 */
export function startActivityDebouncer(
  store: TLStore,
  callback: () => void,
  { delay, shouldIgnoreRef, isProcessingRef }: ActivityDebouncerOptions,
): () => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
  };

  const resetTimer = () => {
    clearTimer();
    timeout = setTimeout(() => {
      timeout = null;
      callback();
    }, delay);
  };

  const dispose = store.listen(
    (entry) => {
      // Ignore changes if we're updating images (accept/reject/clear)
      if (shouldIgnoreRef?.current) return;
      // Ignore changes while processing/generating so the generated image
      // does not trigger a new cycle
      if (isProcessingRef?.current) return;
      // Only student ink / content shapes count as activity (B1)
      if (!isStudentActivity(entry)) return;
      resetTimer();
    },
    { source: "user", scope: "document" },
  );

  return () => {
    clearTimer();
    dispose();
  };
}

/**
 * Hook that detects when the user stops drawing/writing on the canvas
 * for a specified duration (debounce period).
 * Uses tldraw's store history so it only triggers on actual canvas edits
 * (not panning, zooming, or UI clicks) and, since B1, only on edits to
 * student ink/content — never on Live echoes, graphs or AI overlays.
 */
export function useDebounceActivity(
  callback: () => void,
  delay: number = 3000,
  editor?: Editor,
  shouldIgnoreRef?: React.MutableRefObject<boolean>,
  isProcessingRef?: React.MutableRefObject<boolean>
) {
  useEffect(() => {
    if (!editor) return;
    // No initial timer: auto-generation must not run on page load or when
    // dependencies change, only after real student activity.
    return startActivityDebouncer(editor.store, callback, { delay, shouldIgnoreRef, isProcessingRef });
  }, [callback, delay, editor, shouldIgnoreRef, isProcessingRef]);
}
