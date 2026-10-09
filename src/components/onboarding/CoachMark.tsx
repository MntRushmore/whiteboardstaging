"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { SpeakButton } from "@/components/speech/SpeakButton";
import { say } from "@/lib/speech/say";
import { cn } from "@/lib/utils";
import { TOUR_COPY } from "@/lib/onboarding/tourCopy";
import { placeCoachMark, type Box, type Placement, type Side } from "@/lib/onboarding/placement";
import styles from "./tour.module.css";

/**
 * One coach mark: a card beside a real piece of the board's UI, with a ring round that piece. It
 * is placed clear of `avoid()` (the starter problem and the student's work, in client pixels) and
 * re-measured as the board moves (the chat panel opening, a resize, the tutor writing).
 *
 * Made for a young reader: a picture of the thing to do, one big line saying it, a short line under
 * it, and one big button. While the board waits for the student to tap the piece of UI it points at,
 * the ring pulses (`pulse`) and the button is the quiet way past it (outlined).
 *
 * Keyboard and screen readers: it takes focus when it appears and whenever its message changes (a
 * non-modal dialog, so the pen keeps working on the board), Tab moves between its two buttons, Esc
 * and Skip tour end the tour. "Tip 1 of 3" is read out; the dots only show it.
 */

export type CoachTone = "blue" | "green" | "amber" | "violet";

export interface CoachMarkProps {
  /** CSS selector of the UI it is about; none, or none on screen, uses `fallback` */
  anchor?: string;
  /** where to point when the anchor is missing (a toolbar tool folded into "more", a shape on the board) */
  fallback?: () => Box | null;
  prefer: readonly Side[];
  avoid: () => Box[];
  /** the picture of the thing to do (a lucide icon) */
  icon: ReactNode;
  tone?: CoachTone;
  /** "Tip 1 of 3" */
  number: number;
  total: number;
  title: string;
  children?: ReactNode;
  primary: { label: string; onClick: () => void; variant?: "default" | "outline" };
  /** the ring pulses: the board is waiting for a tap on the anchor */
  pulse?: boolean;
  /** ends the tour (Esc, Skip tour) */
  onSkip: () => void;
  /** changes whenever the content does, so focus moves to the new message and it animates in */
  focusKey: string;
  /**
   * The words read aloud (the title and the line under it): said when the message changes if read
   * aloud is on, and again from the card's speaker button. None: no speaker.
   */
  speech?: string;
}

const REMEASURE_MS = 250;

const TONES: Record<CoachTone, string> = {
  blue: "bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300",
  green: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300",
  amber: "bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300",
  violet: "bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300",
};

function rectOf(el: Element): Box {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

function sameBox(a: Box | null, b: Box | null): boolean {
  if (!a || !b) return a === b;
  return Math.round(a.x) === Math.round(b.x) && Math.round(a.y) === Math.round(b.y) && Math.round(a.w) === Math.round(b.w) && Math.round(a.h) === Math.round(b.h);
}

export function CoachMark({ anchor, fallback, prefer, avoid, icon, tone = "blue", number, total, title, children, primary, pulse = false, onSkip, focusKey, speech }: CoachMarkProps) {
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
    const target = selector ? document.querySelector(selector) : null;
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

  // new content: said aloud for a young reader (when read aloud is on: src/lib/speech/say.ts)
  useEffect(() => {
    if (speech) say(speech);
  }, [focusKey, speech]);

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
          // the ring is an outline, so the pulse (a box-shadow) never replaces it
          className={cn(
            "pointer-events-none fixed z-1190 rounded-2xl outline-3 outline-blue-500/90 outline-solid transition-all duration-200",
            pulse ? styles.pulse : "shadow-[0_0_0_7px_rgba(59,130,246,0.18)]",
          )}
          style={{ left: ring.x - 5, top: ring.y - 5, width: ring.w + 10, height: ring.h + 10 }}
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
            onSkip();
          }
        }}
        className={cn(
          "fixed z-1200 w-[min(22rem,calc(100vw-1.5rem))] rounded-2xl border bg-popover p-5 text-popover-foreground shadow-[0_18px_48px_rgba(15,23,42,0.18),0_2px_8px_rgba(15,23,42,0.08)] outline-none transition-[left,top,opacity] duration-200 focus-visible:ring-[3px] focus-visible:ring-blue-500/40",
          place ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        style={{ left: place?.x ?? 0, top: place?.y ?? 0 }}
      >
        {place && place.arrow !== null && <Arrow side={place.side} at={place.arrow} />}
        <div key={focusKey} className={styles.enter}>
          <div className="flex items-start gap-3.5">
            <span aria-hidden className={cn("grid size-12 shrink-0 place-items-center rounded-2xl [&_svg]:size-6", TONES[tone])}>
              {icon}
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="sr-only">{TOUR_COPY.tip(number, total)}</p>
              <Dots number={number} total={total} />
              <h2 id={titleId} className="mt-1.5 text-lg leading-snug font-semibold text-balance">
                {title}
              </h2>
            </div>
            {speech && <SpeakButton text={speech} className="-mt-1 -mr-2 size-9 [&_svg]:size-5" />}
          </div>
          {children && (
            <div id={bodyId} className="mt-2.5 text-base leading-relaxed text-muted-foreground">
              {children}
            </div>
          )}
          <div className="mt-4 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={onSkip}
              title={TOUR_COPY.skipHint}
              className="-ml-2 rounded-full px-2 py-2 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {TOUR_COPY.skip}
            </button>
            <Button
              variant={primary.variant === "outline" ? "outline" : "default"}
              onClick={primary.onClick}
              className={cn(
                "h-11 min-w-24 rounded-full px-6 text-base font-semibold",
                primary.variant !== "outline" && "bg-blue-600 text-white shadow-sm hover:bg-blue-700",
              )}
            >
              {primary.label}
            </Button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}

/** "Tip 2 of 3" as dots: the ones done, a wide one for this one, the ones to come. */
function Dots({ number, total }: { number: number; total: number }) {
  return (
    <span aria-hidden className="flex items-center gap-1.5">
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={cn(
            "h-1.5 rounded-full transition-all duration-300",
            i + 1 === number ? "w-5 bg-blue-600" : i + 1 < number ? "w-1.5 bg-blue-600/60" : "w-1.5 bg-gray-300 dark:bg-gray-600",
          )}
        />
      ))}
    </span>
  );
}

/** The little pointer on the card's edge, towards the anchor. */
function Arrow({ side, at }: { side: Side; at: number }) {
  // the card sits on `side` of the anchor, so the arrow is on the opposite edge
  const edge: Record<Side, string> = {
    bottom: "-top-[7px] border-l border-t",
    top: "-bottom-[7px] border-r border-b",
    right: "-left-[7px] border-l border-b",
    left: "-right-[7px] border-r border-t",
  };
  const style = side === "top" || side === "bottom" ? { left: at - 6 } : { top: at - 6 };
  return <span aria-hidden className={cn("absolute size-3 rotate-45 bg-popover", edge[side])} style={style} />;
}
