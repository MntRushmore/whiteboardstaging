"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, Lightbulb, MessageSquare, PartyPopper, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TOUR_COPY } from "@/lib/onboarding/tourCopy";
import { ConfettiBurst } from "./ConfettiBurst";
import styles from "./tour.module.css";

const RECAP_ICONS = { write: Pencil, help: Lightbulb, ask: MessageSquare } as const;

/**
 * The end of the guided board: the board fades back, a card springs up with a burst of confetti,
 * "You're all set!", the three things the student just did as a picture list, and one button on
 * to the plan screen. A modal dialog (the board waits behind it): focus starts on the button and
 * stays there; Enter, Space and Esc all go on. Motion honours prefers-reduced-motion.
 */
export function TourFinish({ onContinue }: { onContinue: () => void }) {
  const titleId = useId();
  const bodyId = useId();
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => button.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, []);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div data-tour-finish="" className="fixed inset-0 z-1250 grid place-items-center p-4">
      <div aria-hidden className={`absolute inset-0 bg-white/55 backdrop-blur-[3px] dark:bg-black/45 ${styles.backdrop}`} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onContinue();
          }
          // the button is the only stop: Tab stays on it rather than wander onto the board behind
          if (e.key === "Tab") {
            e.preventDefault();
            button.current?.focus();
          }
        }}
        className={`relative w-[min(26rem,100%)] rounded-[2rem] border bg-popover px-6 pt-8 pb-6 text-center text-popover-foreground shadow-[0_30px_80px_rgba(15,23,42,0.25),0_4px_14px_rgba(15,23,42,0.08)] sm:px-8 ${styles.finish}`}
      >
        <div className="relative mx-auto size-20">
          <ConfettiBurst count={44} spread={150} style={{ left: "50%", top: "50%" }} />
          <span aria-hidden className={`grid size-20 place-items-center rounded-full bg-blue-600 text-white shadow-lg ${styles.badge}`}>
            <PartyPopper className="size-10" strokeWidth={1.8} />
          </span>
        </div>
        <h2 id={titleId} className="mt-5 text-3xl font-bold tracking-tight text-balance">
          {TOUR_COPY.finish.title}
        </h2>
        <p id={bodyId} className="mt-2 text-lg leading-snug text-muted-foreground text-balance">
          {TOUR_COPY.finish.lede}
        </p>
        <ul className={`mt-5 space-y-2.5 text-left ${styles.recap}`}>
          {TOUR_COPY.finish.recap.map((r) => {
            const Icon = RECAP_ICONS[r.id];
            return (
              <li key={r.id} className="flex items-center gap-3 rounded-2xl bg-muted/70 px-4 py-3 text-base font-medium">
                <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-xl bg-white text-blue-600 shadow-xs dark:bg-white/10 dark:text-blue-300">
                  <Icon className="size-5" />
                </span>
                {r.text}
              </li>
            );
          })}
        </ul>
        <Button
          ref={button}
          onClick={onContinue}
          className="mt-6 h-13 w-full rounded-full bg-blue-600 text-lg font-semibold text-white shadow-md hover:bg-blue-700 [&_svg:not([class*='size-'])]:size-5"
        >
          {TOUR_COPY.finish.button}
          <ArrowRight aria-hidden />
        </Button>
      </div>
    </div>,
    document.body,
  );
}
