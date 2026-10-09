"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Ellipsis, X } from "lucide-react";
import { KID_COPY } from "./copy";
import { GROWN_UP_MORE_ATTR } from "./tourAnchors";

/** More's words: for the grown-up beside the kid. */
const MORE_COPY = {
  more: "More",
  hint: "More tools and settings, for grown-ups",
  title: "For grown-ups",
  close: "Close",
} as const;

/**
 * The simple board's one way to everything else: a small "More" at the top right, for the grown-up
 * beside the kid. It opens a card holding the "Simple board" switch and the grown-up bar's controls
 * (`BoardToolbarView.place` says which), passed in as `children`. Loaded lazily, on a simple board
 * only (the board page warms it with the kid dock).
 *
 * The card is always mounted and only hidden while closed: the status pill in it keeps "Hide AI
 * shapes" applied and the ink meter keeps Live told the balance, open or not. It closes on the ×, a
 * tap outside it or Escape — not on a tap inside a menu or dialog it opened (Board options), which
 * React portals outside it, nor on an Escape such a layer is there to take (`layerOverMore`).
 */
export default function GrownUpMore({
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
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current?.contains(e.target as Node) || inLayerOverMore(e.target instanceof Element ? e.target : null)) return;
      onOpenChange(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      // a menu or modal dialog on top closes first, on its own Escape
      if (e.key !== "Escape" || [...document.querySelectorAll(LAYER_ROLES)].some(layerOverMore)) return;
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
        {...{ [GROWN_UP_MORE_ATTR]: "" }}
        title={MORE_COPY.hint}
        onClick={() => onOpenChange(!open)}
        className="flex h-12 cursor-pointer select-none items-center gap-1.5 rounded-full border border-slate-200 bg-white/95 pl-3.5 pr-4 text-sm font-medium text-slate-500 shadow-sm transition-colors hover:bg-slate-50 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-expanded:bg-slate-100 aria-expanded:text-slate-800 motion-reduce:transition-none"
      >
        <Ellipsis className="size-5" aria-hidden />
        {MORE_COPY.more}
      </button>
      <section
        id="grown-up-more"
        aria-label={MORE_COPY.title}
        hidden={!open}
        className="absolute right-0 top-full mt-2 w-[min(380px,calc(100cqw-32px))] rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_16px_40px_rgba(15,23,42,0.16),0_2px_8px_rgba(15,23,42,0.06)]"
      >
        <div className="mb-2 flex items-center justify-between pl-1">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{MORE_COPY.title}</h2>
          <button
            type="button"
            aria-label={MORE_COPY.close}
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

/** The roles of what can open over More: a menu, a dialog. */
const LAYER_ROLES = "[role=menu],[role=dialog],[role=alertdialog]";

/** An element as far as More's checks read it: the DOM's, or a stand-in in the tests. */
export interface LayerNode {
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  readonly parentElement: LayerNode | null;
}

/**
 * A layer over More, which takes Escape first and whose taps are not taps outside More: a menu
 * (Board options) or a modal dialog (the ink dialog, the help-mode explainer, the tour's finish
 * card). Not a non-modal dialog beside the board (`aria-modal="false"`): the guided board's coach
 * mark, up through most of a K–3 kid's first board, or the daily board's cheer. More neither waits
 * for one of those on Escape nor counts a tap on it as a tap inside.
 */
export function layerOverMore(el: Pick<LayerNode, "getAttribute">): boolean {
  const role = el.getAttribute("role");
  if (role === "menu" || role === "alertdialog") return true;
  return role === "dialog" && el.getAttribute("aria-modal") !== "false";
}

/** The tap landed in a layer over More (`layerOverMore`), or in a Radix popover's portal (a menu's, a select's). */
export function inLayerOverMore(target: LayerNode | null): boolean {
  for (let el = target; el; el = el.parentElement) {
    if (el.hasAttribute("data-radix-popper-content-wrapper") || layerOverMore(el)) return true;
  }
  return false;
}
