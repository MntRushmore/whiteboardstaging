"use client";

import { useEffect, useRef, useState } from "react";
import { DefaultColorStyle, DefaultStylePanel, getDefaultColorTheme, useEditor, useIsDarkMode, useRelevantStyles, useValue } from "tldraw";

/**
 * The board's pen style, tucked away: one round swatch in the corner showing the current
 * colour, and tldraw's own style panel (colour, opacity, fill, dash, size) under it when tapped.
 * tldraw's default is that panel open in the top-right corner whenever a tool has styles — a
 * block of swatches over the student's screen, and beside the Ask panel. Nothing is taken
 * away: the same panel, on request. Closes on a second tap, a tap outside it, or Escape.
 */
export function PenStyleButton() {
  const editor = useEditor();
  const styles = useRelevantStyles();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const isDarkMode = useIsDarkMode();
  const color = useValue(
    "pen colour",
    () => {
      const shared = editor.getSharedStyles().get(DefaultColorStyle);
      return shared?.type === "shared" ? shared.value : editor.getStyleForNextShape(DefaultColorStyle);
    },
    [editor],
  );
  const swatch = getDefaultColorTheme({ isDarkMode })[color]?.solid ?? "currentColor";

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      // this Esc closes the panel; it must not also reach tldraw, which takes Esc as "cancel the
      // tool" and swaps the student's pen for the selection arrow
      e.stopPropagation();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  if (!styles) return null;
  return (
    <div ref={ref} className="relative" style={{ pointerEvents: "all" }}>
      <button
        type="button"
        aria-label="Pen colour and size"
        title="Pen colour and size"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="m-2 flex h-9 w-9 items-center justify-center rounded-full border bg-white shadow-sm transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 dark:bg-slate-900"
      >
        <span className="h-5 w-5 rounded-full border border-black/10" style={{ background: swatch }} />
      </button>
      {open && (
        <div className="absolute right-2 top-full z-10 mt-1">
          <DefaultStylePanel />
        </div>
      )}
    </div>
  );
}
