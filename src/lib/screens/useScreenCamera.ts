"use client";

import { useEffect } from "react";
import { react, type Editor } from "tldraw";
import { applyScreenCamera } from "./screens";

/**
 * Keeps the camera on the current screen: fitted on mount and again on every screen switch
 * (each screen has its own rect, and a legacy page gets its rect the first time it is shown) —
 * and whenever the board's own size changes (the chat panel opening beside it or under it, a
 * window resized, a phone turned), so the whole 16:9 screen stays in view.
 */
export function useScreenCamera(editor: Editor | null): void {
  useEffect(() => {
    if (!editor) return;
    let last: string | null = null;
    let lastSize: string | null = null;
    let cancelled = false;
    const refit = (pageId: string) =>
      // Outside the reactive read: applying reads and writes the camera, which must not
      // become a dependency of this effect.
      queueMicrotask(() => {
        if (!cancelled && editor.getCurrentPageId() === pageId) applyScreenCamera(editor);
      });
    const stop = react("screen camera", () => {
      const pageId = editor.getCurrentPageId();
      if (pageId === last) return;
      last = pageId;
      refit(pageId);
    });
    const stopSize = react("screen camera size", () => {
      const bounds = editor.getViewportScreenBounds();
      const size = `${Math.round(bounds.w)}x${Math.round(bounds.h)}`;
      if (size === lastSize) return;
      const first = lastSize === null;
      lastSize = size;
      // the first size is the mount's, which the page fit already covers
      if (!first) refit(editor.getCurrentPageId());
    });
    return () => {
      cancelled = true;
      stop();
      stopSize();
    };
  }, [editor]);
}
