"use client";

import { lazy, Suspense, useEffect, useRef, type ReactNode } from "react";
import { BookOpen, ChevronRight, Ellipsis, MessageSquare, SlidersHorizontal, X } from "lucide-react";
import { Root as DropdownMenu, Trigger as DropdownMenuTrigger } from "@radix-ui/react-dropdown-menu";
import { CHAT_BUTTON_COPY, CHAT_TOGGLE_ATTR } from "@/components/chat/askButton";
import type { BoardMenuProps } from "@/components/live/BoardMenu";
import { LIVE_COPY } from "@/components/live/copy";
import { LiveErrorBoundary } from "@/components/live/LiveErrorBoundary";
import { SCREEN_COPY } from "@/components/screens/ScreenStrip";
import { KID_COPY } from "./copy";
import { GROWN_UP_MORE_ATTR } from "./tourAnchors";

// Board options' items: the chunk the status pill's "…" fetches too (docs/BUNDLE.md)
const BoardMenu = lazy(() => import("@/components/live/BoardMenu"));

/** More's words: for the grown-up beside the kid. */
export const MORE_COPY = {
  more: "More",
  hint: "More tools and settings, for grown-ups",
  title: "For grown-ups",
  close: "Close",
  /** over the help dial */
  help: "How much help",
  /** under Auto, as it is set */
  autoOn: "Checks and helps when they stop writing",
  autoOff: "Waits until they tap Help me",
  /** beside the ink meter */
  plan: "Plan",
  options: "Board options",
  optionsHint: "Clear marks, replay, read aloud, report a bug",
} as const;

/**
 * The simple board's grown-up controls, made by the board page (`controls`) and laid out here as
 * labelled rows: the help dial, Auto, Ask and New topic, the plan and what the tutor is doing, and
 * Board options.
 */
export interface MoreControls {
  /** the help dial (Off / Feedback / Suggest / Solve) */
  dial: ReactNode;
  /** the Auto switch as it is set, or null where it would do nothing (`autoSwitch`) */
  auto: { on: boolean; hint: string } | null;
  onAutoChange: () => void;
  /** Ask, the board chat: whether it is open, or null while the tour keeps it in the bar */
  ask: boolean | null;
  onAsk: () => void;
  onTopic: () => void;
  /** what the tutor is doing: the status pill, without its "…" (Board options is a row here) */
  status: ReactNode;
  /** the plan's ink meter */
  ink: ReactNode;
  /** Feature Labs' extras (stickers, PDF), when on */
  extras?: ReactNode;
  /** Board options' items, but Help (Help me is in the bar) and Simple board (the switch is at the top) */
  menu: Omit<BoardMenuProps, "onHelp" | "simpleBoard">;
}

/**
 * The simple board's one way to everything else: a small "More" at the top right, for the grown-up
 * beside the kid. It opens a card of labelled rows, each at least 44 px tall: the "Simple board"
 * switch, then the grown-up bar's controls (`BoardToolbarView.place` says which), and Board options
 * as a row of its own (not the status pill's 24 px "…"). Loaded lazily, on a simple board only (the
 * board page warms it with the kid dock).
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
  controls,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  simpleOn: boolean;
  onSimpleChange: (on: boolean) => void;
  controls: MoreControls;
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
  const { auto, ask } = controls;

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
        className="absolute right-0 top-full mt-2 max-h-[calc(100dvh-96px)] w-[min(380px,calc(100cqw-32px))] overflow-y-auto overscroll-contain rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_16px_40px_rgba(15,23,42,0.16),0_2px_8px_rgba(15,23,42,0.06)]"
      >
        <div className="mb-1 flex items-center justify-between pl-1">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{MORE_COPY.title}</h2>
          <button
            type="button"
            aria-label={MORE_COPY.close}
            onClick={() => onOpenChange(false)}
            className="flex size-11 cursor-pointer items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <div className="flex flex-col gap-3">
          {/* the switch: off, the grown-up bar and tldraw's tools come back */}
          <SwitchRow on={simpleOn} onClick={() => onSimpleChange(!simpleOn)} title={KID_COPY.simpleBoard} line={KID_COPY.simpleBoardHint} />

          <div className="flex flex-col gap-1.5" role="group" aria-labelledby="grown-up-more-help">
            <p id="grown-up-more-help" className="px-1 text-xs font-semibold text-slate-500">
              {MORE_COPY.help}
            </p>
            {/* the bar's tabs, full width and 44 px tall here */}
            <div className="[&>div]:w-full [&_[role=tab]]:text-[15px] [&_[role=tablist]]:flex [&_[role=tablist]]:h-11 [&_[role=tablist]]:w-full">{controls.dial}</div>
          </div>

          {auto && <SwitchRow on={auto.on} onClick={controls.onAutoChange} title={LIVE_COPY.auto.label} line={auto.on ? MORE_COPY.autoOn : MORE_COPY.autoOff} hint={auto.hint} />}

          <div className="grid grid-cols-2 gap-2">
            {ask !== null && (
              <button
                type="button"
                className={TILE}
                title={CHAT_BUTTON_COPY.buttonHint}
                aria-expanded={ask}
                {...{ [CHAT_TOGGLE_ATTR]: "" }}
                onClick={controls.onAsk}
              >
                <MessageSquare className="size-4 text-slate-500" aria-hidden />
                {CHAT_BUTTON_COPY.button}
              </button>
            )}
            <button type="button" className={TILE} title={SCREEN_COPY.topicHint} aria-haspopup="dialog" onClick={controls.onTopic}>
              <BookOpen className="size-4 text-slate-500" aria-hidden />
              {KID_COPY.newTopic}
            </button>
          </div>

          {controls.extras && <div className="flex flex-wrap items-center gap-2">{controls.extras}</div>}

          {/* the plan (its word shown: the bar's container hides it under 1024 px) and what the tutor is doing */}
          <div className="flex min-h-11 items-center justify-between gap-2 px-1">
            <div className="hidden items-center gap-2 text-xs font-semibold text-slate-500 has-[[data-testid=ink-meter]]:flex [&_[data-testid=ink-meter]>span]:inline">
              {MORE_COPY.plan}
              {controls.ink}
            </div>
            <div className="ml-auto">{controls.status}</div>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className={`${TILE} w-full justify-between pr-3`} title={MORE_COPY.optionsHint} data-testid="more-board-options">
                <span className="flex items-center gap-2">
                  <SlidersHorizontal className="size-4 text-slate-500" aria-hidden />
                  {MORE_COPY.options}
                </span>
                <ChevronRight className="size-4 text-slate-400" aria-hidden />
              </button>
            </DropdownMenuTrigger>
            {/* a chunk that fails to load leaves the menu shut, not More */}
            <LiveErrorBoundary>
              <Suspense fallback={null}>
                <BoardMenu {...controls.menu} />
              </Suspense>
            </LiveErrorBoundary>
          </DropdownMenu>
        </div>
      </section>
    </div>
  );
}

/** A 44 px button row of More: a picture and a word, or a word and a chevron. */
const TILE =
  "flex min-h-11 cursor-pointer select-none items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 shadow-sm transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-expanded:bg-slate-100 motion-reduce:transition-none";

/** A row that is one switch: what it is, what it does as set, and the toggle. */
function SwitchRow({ on, onClick, title, line, hint }: { on: boolean; onClick: () => void; title: string; line: string; hint?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      title={hint}
      onClick={onClick}
      className="group flex min-h-14 w-full cursor-pointer items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex flex-col">
        <span className="text-sm font-semibold text-slate-800">{title}</span>
        <span className="text-xs text-slate-500">{line}</span>
      </span>
      <span aria-hidden className="inline-flex h-6 w-11 shrink-0 items-center rounded-full bg-input p-0.5 transition-colors group-aria-checked:bg-primary">
        <span className="block size-5 rounded-full bg-background shadow transition-transform group-aria-checked:translate-x-5" />
      </span>
    </button>
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
