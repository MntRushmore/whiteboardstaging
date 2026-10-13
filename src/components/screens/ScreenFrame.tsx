"use client";

import { useEditor, useValue } from "tldraw";
import { readScreenMeta } from "@/lib/screens/screens";

/**
 * Everything outside the screen: the table the whiteboard sits on, a soft flat grey (globals.css,
 * `[data-board-table]`), so the white 16:9 screen reads as the page to write on and the bar and the
 * dock float on the table around it.
 */
export function ScreenBackground() {
  return <div className="tl-background" data-board-table="" />;
}

/**
 * The whiteboard itself, drawn in page space behind the shapes (tldraw's `OnTheCanvas` slot
 * lives inside the camera-transformed HTML layer, so page coordinates are CSS pixels here): white,
 * with a hairline edge and a shadow just deep enough to lift it off the table.
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
        backgroundColor: "#ffffff",
        // page px: the camera scales them, so the edge stays a hairline at every zoom it allows
        border: "1.5px solid rgba(15, 23, 42, 0.09)",
        borderRadius: 14,
        boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04), 0 6px 24px rgba(15, 23, 42, 0.05)",
        pointerEvents: "none",
        zIndex: 0,
      }}
    />
  );
}
