"use client";

import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import type { Rect } from "@/lib/live/contracts";
import { TYPE_COPY } from "./typeBarModel";

/** The ghost caret: where Enter writes next, in the board's own (viewport) pixels. */
export interface CaretMark {
  x: number;
  /** the writing line */
  y: number;
  /** the hand's size on screen (layoutMath's `size` times the zoom) */
  h: number;
}

/** A line of the problem the bar can open, and where it is on screen. */
export interface LineMark {
  lineId: string;
  rect: Rect;
}

/** Room round a line that still counts as pointing at it (and the pencil's own place, to its right). */
const HOVER_PAD = 14;
const PENCIL = 32;
const PENCIL_GAP = 8;

/**
 * What the bar shows on the board itself, under its own card: the soft blinking caret where Enter
 * will write (while the box has focus), a soft fill over the line being changed, and on a laptop a
 * pencil beside the line the mouse is over, which opens that line in the box.
 */
export function BoardMarks({
  container,
  caret,
  ink,
  lines,
  editing,
  pencils,
  onPencil,
}: {
  container: HTMLElement;
  caret: CaretMark | null;
  ink: string;
  lines: readonly LineMark[];
  /** the line in the box (its fill), if any */
  editing: string | null;
  /** hover pencils (a mouse or a trackpad) */
  pencils: boolean;
  onPencil: (lineId: string) => void;
}) {
  const hovered = useHoveredLine(container, pencils ? lines : null);
  const edited = editing ? lines.find((l) => l.lineId === editing) : undefined;
  const pencilFor = hovered && hovered !== editing ? lines.find((l) => l.lineId === hovered) : undefined;
  return (
    <div aria-hidden={!pencilFor} className="pointer-events-none absolute inset-0 z-[940] overflow-hidden" data-type-marks="">
      {edited && (
        <div
          data-type-editing=""
          className="absolute rounded-lg bg-blue-500/10 ring-2 ring-blue-500/35"
          style={{ left: edited.rect.x - 8, top: edited.rect.y - 6, width: edited.rect.w + 16, height: edited.rect.h + 12 }}
        />
      )}
      {caret && (
        <div data-type-caret="" className="absolute" style={{ left: caret.x, top: caret.y - caret.h * 0.85, height: caret.h }}>
          <span className="type-caret absolute left-0 top-0 h-full w-[2.5px] rounded-full" style={{ background: ink }} />
          <span className="absolute left-0 rounded-full opacity-25" style={{ top: caret.h * 0.85, height: 2, width: Math.max(24, caret.h * 2.4), background: ink }} />
        </div>
      )}
      {pencilFor && (
        <button
          type="button"
          data-type-pencil={pencilFor.lineId}
          aria-label={TYPE_COPY.pencil}
          title={TYPE_COPY.pencil}
          className="pointer-events-auto absolute flex cursor-pointer items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm transition-colors hover:bg-blue-50 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 motion-reduce:transition-none"
          style={{
            left: pencilFor.rect.x + pencilFor.rect.w + PENCIL_GAP,
            top: pencilFor.rect.y + pencilFor.rect.h / 2 - PENCIL / 2,
            width: PENCIL,
            height: PENCIL,
          }}
          // not a stroke on the board
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onPencil(pencilFor.lineId)}
        >
          <Pencil className="size-4" strokeWidth={2.25} aria-hidden />
        </button>
      )}
    </div>
  );
}

/** The line the mouse is over (or on its pencil), while no button is held: null while drawing. */
function useHoveredLine(container: HTMLElement, lines: readonly LineMark[] | null): string | null {
  const [hovered, setHovered] = useState<string | null>(null);
  const none = !lines || lines.length === 0;
  useEffect(() => {
    if (!lines || lines.length === 0) return;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch" || e.buttons !== 0) {
        setHovered(null);
        return;
      }
      const box = container.getBoundingClientRect();
      const x = e.clientX - box.left;
      const y = e.clientY - box.top;
      const hit = lines.find(
        (l) =>
          x >= l.rect.x - HOVER_PAD &&
          x <= l.rect.x + l.rect.w + PENCIL_GAP + PENCIL + HOVER_PAD &&
          y >= l.rect.y - HOVER_PAD &&
          y <= l.rect.y + l.rect.h + HOVER_PAD,
      );
      setHovered(hit ? hit.lineId : null);
    };
    const onLeave = () => setHovered(null);
    container.addEventListener("pointermove", onMove, { passive: true });
    container.addEventListener("pointerleave", onLeave);
    return () => {
      container.removeEventListener("pointermove", onMove);
      container.removeEventListener("pointerleave", onLeave);
    };
  }, [container, lines]);
  return none ? null : hovered;
}
