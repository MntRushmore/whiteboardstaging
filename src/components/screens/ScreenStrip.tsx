"use client";

import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PORTRAIT_BREAKPOINT, useBreakpoint, useEditor, useValue } from "tldraw";
import { addScreen, deleteScreen, goToScreen, MAX_SCREENS, screenPosition } from "@/lib/screens/screens";

export const SCREEN_COPY = {
  label: (index: number, count: number) => `Screen ${index} of ${count}`,
  prev: "Previous screen",
  next: "Next screen",
  add: "New screen",
  full: `A board holds up to ${MAX_SCREENS} screens`,
  remove: "Delete this screen",
  removed: (index: number) => `Screen ${index} deleted`,
  undo: "Undo",
} as const;

/**
 * Where the strip goes for a board this wide (tldraw's breakpoint). Below TABLET_SM tldraw folds
 * the style panel into its toolbar and needs the whole bottom row for it — beside the strip it ran
 * off the right edge of a phone (and of an iPad's board with the Ask panel open), taking the pen's
 * colour with it — so the strip moves up to the top-right corner the style panel has left empty.
 */
export function screenStripSlot(breakpoint: number): "bottom" | "corner" {
  return breakpoint < PORTRAIT_BREAKPOINT.TABLET_SM ? "corner" : "bottom";
}

const buttonClass =
  "inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent dark:text-slate-200 dark:hover:bg-slate-800";

/** ‹ 2 / 5 › + — moves between the board's fixed screens (tldraw pages). The NavigationPanel slot. */
export function ScreenStrip() {
  return screenStripSlot(useBreakpoint()) === "bottom" ? <Strip /> : null;
}

/** The same strip in the top-right corner of a narrow board (tldraw's SharePanel slot). */
export function ScreenStripCorner() {
  return screenStripSlot(useBreakpoint()) === "corner" ? <Strip /> : null;
}

function Strip() {
  const editor = useEditor();
  const pageIds = useValue("screen ids", () => editor.getPages().map((p) => p.id), [editor]);
  const current = useValue("current screen", () => editor.getCurrentPageId(), [editor]);
  const { index, count } = screenPosition(pageIds, current);
  const full = count >= MAX_SCREENS;

  return (
    <nav
      aria-label="Screens"
      className="pointer-events-auto m-2 flex items-center gap-1 rounded-lg border border-slate-200 bg-white/95 p-1 shadow-sm dark:border-slate-700 dark:bg-slate-900/95"
    >
      <button type="button" className={buttonClass} aria-label={SCREEN_COPY.prev} title={SCREEN_COPY.prev} disabled={index <= 1} onClick={() => goToScreen(editor, -1)}>
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="min-w-12 px-1 text-center text-sm tabular-nums text-slate-700 dark:text-slate-200" aria-live="polite" aria-label={SCREEN_COPY.label(index, count)}>
        {index} / {count}
      </span>
      <button type="button" className={buttonClass} aria-label={SCREEN_COPY.next} title={SCREEN_COPY.next} disabled={index >= count} onClick={() => goToScreen(editor, 1)}>
        <ChevronRight className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={buttonClass}
        aria-label={SCREEN_COPY.add}
        title={full ? SCREEN_COPY.full : SCREEN_COPY.add}
        disabled={full}
        onClick={() => addScreen(editor)}
      >
        <Plus className="h-4 w-4" />
      </button>
      {/* a screen added by mistake (or finished with) goes; the toast brings it back */}
      {count > 1 && (
        <button
          type="button"
          className={buttonClass}
          aria-label={SCREEN_COPY.remove}
          title={SCREEN_COPY.remove}
          onClick={() => {
            const restore = deleteScreen(editor);
            if (restore) toast(SCREEN_COPY.removed(index), { duration: 8000, action: { label: SCREEN_COPY.undo, onClick: restore } });
          }}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </nav>
  );
}
