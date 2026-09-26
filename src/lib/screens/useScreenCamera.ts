"use client";

import { useEffect } from "react";
import { react, type Editor } from "tldraw";
import { applyScreenCamera } from "./screens";

/**
 * Keeps the camera on the current screen: fitted on mount and again on every screen switch
 * (each screen has its own rect, and a legacy page gets its rect the first time it is shown).
 */
export function useScreenCamera(editor: Editor | null): void {
  useEffect(() => {
    if (!editor) return;
    let last: string | null = null;
    let cancelled = false;
    const stop = react("screen camera", () => {
      const pageId = editor.getCurrentPageId();
      if (pageId === last) return;
      last = pageId;
      // Outside the reactive read: applying reads and writes the camera, which must not
      // become a dependency of this effect.
      queueMicrotask(() => {
        if (!cancelled && editor.getCurrentPageId() === pageId) applyScreenCamera(editor);
      });
    });
    return () => {
      cancelled = true;
      stop();
    };
  }, [editor]);
}
