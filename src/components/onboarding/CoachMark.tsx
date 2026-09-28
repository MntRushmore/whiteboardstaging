"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { placeCoachMark, type Box, type Placement, type Side } from "@/lib/onboarding/placement";

/**
 * One coach mark: a small popover beside a real piece of the board's UI, with a highlight ring
 * round that piece. It is placed clear of `avoid()` (the starter problem and the student's work,
 * in client pixels) and re-measured as the board moves (the chat panel opening, a resize).
 *
 * Keyboard: it takes focus when it appears (a non-modal dialog, so the pen keeps working on the
 * board), Tab moves between its buttons, Esc and the close button end the tour.
 */

export interface CoachMarkProps {
  /** CSS selector of the UI it is about */
  anchor: string;
  /** where to go when the anchor is missing (e.g. a toolbar tool folded into "more") */
  fallback?: () => Box | null;
  prefer: readonly Side[];
  avoid: () => Box[];
  /** "Tip 1 of 3" */
  number: number;
  total: number;
  title: string;
  children?: ReactNode;
  primary: { label: string; onClick: () => void; variant?: "default" | "outline" };
  /** ends the tour (Esc, the close button) */
  onClose: () => void;
  /** changes whenever the content does, so focus moves to the new message */
  focusKey: string;
}

const REMEASURE_MS = 250;

function rectOf(el: Element): Box {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

function sameBox(a: Box | null, b: Box | null): boolean {
  if (!a || !b) return a === b;
  return Math.round(a.x) === Math.round(b.x) && Math.round(a.y) === Math.round(b.y) && Math.round(a.w) === Math.round(b.w) && Math.round(a.h) === Math.round(b.h);
}

export function CoachMark({ anchor, fallback, prefer, avoid, number, total, title, children, primary, onClose, focusKey }: CoachMarkProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const [layout, setLayout] = useState<{ anchor: Box; place: Placement } | null>(null);
  // the latest props, read by the timer without re-arming it on every render
  const latest = useRef({ anchor, fallback, prefer, avoid });
  useEffect(() => {
    latest.current = { anchor, fallback, prefer, avoid };
  });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const { anchor: selector, fallback: fb, prefer: sides, avoid: keepClear } = latest.current;
    const target = document.querySelector(selector);
    const box = target && target.getClientRects().length > 0 ? rectOf(target) : (fb?.() ?? null);
    if (!box) {
      setLayout(null);
      return;
    }
    const place = placeCoachMark({
      anchor: box,
      size: { w: el.offsetWidth, h: el.offsetHeight },
      viewport: { w: window.innerWidth, h: window.innerHeight },
      avoid: keepClear(),
      prefer: sides,
    });
    setLayout((prev) =>
      prev && sameBox(prev.anchor, box) && prev.place.x === place.x && prev.place.y === place.y && prev.place.arrow === place.arrow && prev.place.side === place.side
        ? prev
        : { anchor: box, place },
    );
  }, []);

  useEffect(() => {
    // measure once laid out, then keep up with the board (panel opening, refits, resizes)
    const first = requestAnimationFrame(measure);
    const timer = setInterval(measure, REMEASURE_MS);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(first);
      clearInterval(timer);
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  // new content: measure again (its height changed) and move focus to it
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      measure();
      ref.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusKey, measure]);

  if (typeof document === "undefined") return null;
  const place = layout?.place;
  const ring = layout?.anchor;

  return createPortal(
    <>
      {ring && (
        <div
          aria-hidden
          data-coach-ring
          className="pointer-events-none fixed z-1190 rounded-xl ring-2 ring-blue-500/80 shadow-[0_0_0_6px_rgba(59,130,246,0.18)] transition-all duration-200"
          style={{ left: ring.x - 4, top: ring.y - 4, width: ring.w + 8, height: ring.h + 8 }}
        />
      )}
      <div
        ref={ref}
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        aria-describedby={children ? bodyId : undefined}
        tabIndex={-1}
        data-coach-mark={number}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
        className={cn(
          "fixed z-1200 w-[min(20rem,calc(100vw-1.5rem))] rounded-lg border bg-popover p-4 text-popover-foreground shadow-lg outline-none transition-[left,top,opacity] duration-200",
          place ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        style={{ left: place?.x ?? 0, top: place?.y ?? 0 }}
      >
        {place && place.arrow !== null && <Arrow side={place.side} at={place.arrow} />}
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-medium text-muted-foreground">
            Tip {number} of {total}
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close the tour"
            title="Close the tour"
            className="-mr-1.5 -mt-1 grid size-7 place-items-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <X className="size-4" />
          </button>
        </div>
        <h2 id={titleId} className="mt-1 text-sm leading-snug font-semibold text-balance">
          {title}
        </h2>
        {children && (
          <div id={bodyId} className="mt-1.5 text-sm leading-snug text-muted-foreground">
            {children}
          </div>
        )}
        <div className="mt-3 flex justify-end">
          <Button size="sm" variant={primary.variant ?? "default"} onClick={primary.onClick}>
            {primary.label}
          </Button>
        </div>
      </div>
    </>,
    document.body,
  );
}

/** The little pointer on the popover's edge, towards the anchor. */
function Arrow({ side, at }: { side: Side; at: number }) {
  // the popover sits on `side` of the anchor, so the arrow is on the opposite edge
  const edge: Record<Side, string> = {
    bottom: "-top-[7px] border-l border-t",
    top: "-bottom-[7px] border-r border-b",
    right: "-left-[7px] border-l border-b",
    left: "-right-[7px] border-r border-t",
  };
  const style = side === "top" || side === "bottom" ? { left: at - 6 } : { top: at - 6 };
  return <span aria-hidden className={cn("absolute size-3 rotate-45 bg-popover", edge[side])} style={style} />;
}
