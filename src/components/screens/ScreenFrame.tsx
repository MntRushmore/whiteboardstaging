"use client";

import { useEditor, useValue } from "tldraw";
import { readScreenMeta } from "@/lib/screens/screens";

/** Everything outside the screen: the table the whiteboard sits on. */
export function ScreenBackground() {
  return <div className="tl-background" style={{ backgroundColor: "var(--tl-color-low)" }} />;
}

/**
 * The whiteboard itself, drawn in page space behind the shapes (tldraw's `OnTheCanvas` slot
 * lives inside the camera-transformed HTML layer, so page coordinates are CSS pixels here).
 */
export function ScreenFrame() {
  const editor = useEditor();
  const screen = useValue("screen rect", () => readScreenMeta(editor.getCurrentPage().meta), [editor]);
  if (!screen) return null;
  return (
    <div
      aria-hidden
      data-testid="screen-frame"
      style={{
        position: "absolute",
        left: screen.x,
        top: screen.y,
        width: screen.w,
        height: screen.h,
        backgroundColor: "var(--tl-color-panel)",
        border: "1px solid var(--tl-color-divider)",
        borderRadius: 8,
        boxShadow: "0 1px 3px rgba(0, 0, 0, 0.08)",
        pointerEvents: "none",
        zIndex: 0,
      }}
    />
  );
}
