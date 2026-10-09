"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Ellipsis, X } from "lucide-react";
import { KID_COPY } from "./copy";

/**
 * The simple board's one way to everything else: a small "More" at the top right, for the grown-up
 * beside the kid. It opens a card holding the "Simple board" switch and the grown-up bar's controls
 * (`BoardToolbarView.place` says which), passed in as `children`.
 *
 * The card is always mounted and only hidden while closed: the status pill in it keeps "Hide AI
 * shapes" applied and the ink meter keeps Live told the balance, open or not. It closes on the ×, a
 * tap outside it or Escape — not on a tap inside a menu or dialog it opened (Board options), which
 * React portals outside it.
 */
export function GrownUpMore({
  open,
  onOpenChange,
  simpleOn,
  onSimpleChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  simpleOn: boolean;
  onSimpleChange: (on: boolean) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const inLayer = (target: EventTarget | null) =>
      target instanceof Element && target.closest("[data-radix-popper-content-wrapper],[role=menu],[role=dialog],[role=alertdialog]") !== null;
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current?.contains(e.target as Node) || inLayer(e.target)) return;
      onOpenChange(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      // a menu or dialog on top closes first, on its own Escape
      if (e.key !== "Escape" || document.querySelector("[role=menu],[role=dialog]")) return;
      onOpenChange(false);
      // not also tldraw's Escape, which puts the pen down for the selection arrow
      e.stopPropagation();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, onOpenChange]);

  return (
    // level with the bar's 56 px Help me (the bar starts 16 px down)
    <div ref={ref} className="pointer-events-auto absolute right-4 top-5">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="grown-up-more"
        title={KID_COPY.moreHint}
        onClick={() => onOpenChange(!open)}
        className="flex h-12 cursor-pointer select-none items-center gap-1.5 rounded-full border border-slate-200 bg-white/95 pl-3.5 pr-4 text-sm font-medium text-slate-500 shadow-sm transition-colors hover:bg-slate-50 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-expanded:bg-slate-100 aria-expanded:text-slate-800 motion-reduce:transition-none"
      >
        <Ellipsis className="size-5" aria-hidden />
        {KID_COPY.more}
      </button>
      <section
        id="grown-up-more"
        aria-label={KID_COPY.moreTitle}
        hidden={!open}
        className="absolute right-0 top-full mt-2 w-[min(380px,calc(100cqw-32px))] rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_16px_40px_rgba(15,23,42,0.16),0_2px_8px_rgba(15,23,42,0.06)]"
      >
        <div className="mb-2 flex items-center justify-between pl-1">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{KID_COPY.moreTitle}</h2>
          <button
            type="button"
            aria-label={KID_COPY.close}
            onClick={() => onOpenChange(false)}
            className="flex size-9 cursor-pointer items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
        {/* the switch: off, the grown-up bar and tldraw's tools come back */}
        <button
          type="button"
          role="switch"
          aria-checked={simpleOn}
          onClick={() => onSimpleChange(!simpleOn)}
          className="group mb-3 flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex flex-col">
            <span className="text-sm font-semibold text-slate-800">{KID_COPY.simpleBoard}</span>
            <span className="text-xs text-slate-500">{KID_COPY.simpleBoardHint}</span>
          </span>
          <span aria-hidden className="inline-flex h-6 w-11 shrink-0 items-center rounded-full bg-input p-0.5 transition-colors group-aria-checked:bg-primary">
            <span className="block size-5 rounded-full bg-background shadow transition-transform group-aria-checked:translate-x-5" />
          </span>
        </button>
        <div className="flex flex-wrap items-center gap-2">{children}</div>
      </section>
    </div>
  );
}
