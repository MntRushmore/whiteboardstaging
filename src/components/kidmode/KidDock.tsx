"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Eraser, FilePlus2, Pencil, Undo2 } from "lucide-react";
import {
  DefaultColorStyle,
  DefaultSizeStyle,
  getDefaultColorTheme,
  react,
  useBreakpoint,
  useEditor,
  useValue,
  type Editor,
  type TLDefaultColorStyle,
  type TLDefaultSizeStyle,
} from "tldraw";
import { screenStripSlot } from "@/components/screens/ScreenStrip";
import { addScreen, goToScreen, MAX_SCREENS, screenPosition } from "@/lib/screens/screens";
import { DOCK_COPY, hitMarginFor, KID_COLORS, kidDockView, penSizeOnClose, penSizeOnOpen, type KidColor } from "./dockView";
import { KID_PEN_ATTR } from "./tourAnchors";

/**
 * The simple board's dock, in tldraw's toolbar slot (`BoardToolbar`): Pen, Eraser, Undo, four big
 * colours and the board's pages, each a 56 px target with a picture and one short word under it.
 * What it shows is `kidDockView`; while it is mounted the pen is a little thicker and the eraser a
 * little wider (`useLittleHands`). Loaded lazily: only a simple board needs it.
 */
export default function KidDock() {
  const editor = useEditor();
  useLittleHands(editor);
  const narrow = screenStripSlot(useBreakpoint()) === "corner";
  const tool = useValue("kid tool", () => editor.getCurrentToolId(), [editor]);
  const color = useValue("kid colour", () => editor.getStyleForNextShape(DefaultColorStyle), [editor]);
  const canUndo = useValue("kid can undo", () => editor.getCanUndo(), [editor]);
  const pageIds = useValue("kid pages", () => editor.getPages().map((p) => p.id), [editor]);
  const current = useValue("kid page", () => editor.getCurrentPageId(), [editor]);
  const { index, count } = screenPosition(pageIds, current);
  const view = kidDockView({ narrow, tool, color, canUndo, page: index, pages: count, maxPages: MAX_SCREENS });

  const pick = (c: KidColor) =>
    editor.run(() => {
      editor.setStyleForNextShapes(DefaultColorStyle, c as TLDefaultColorStyle);
      // picking a colour is picking up the pen
      if (editor.getCurrentToolId() !== "draw") editor.setCurrentTool("draw");
    });

  return (
    <div
      role="toolbar"
      aria-label={DOCK_COPY.dock}
      data-kid-dock=""
      className="pointer-events-none mx-2 mb-[max(10px,env(safe-area-inset-bottom))] flex flex-wrap-reverse items-end justify-center gap-2"
    >
      <div className={SHELL}>
        {/* the guided board's first coach mark ("Grab the pen…") points at it */}
        <DockButton label={DOCK_COPY.pen} pressed={view.pen} anchor={KID_PEN_ATTR} onClick={() => editor.setCurrentTool("draw")}>
          <Pencil className="size-6" strokeWidth={2.25} aria-hidden />
        </DockButton>
        <DockButton label={DOCK_COPY.eraser} pressed={view.eraser} onClick={() => editor.setCurrentTool("eraser")}>
          <Eraser className="size-6" strokeWidth={2.25} aria-hidden />
        </DockButton>
        <DockButton label={DOCK_COPY.undo} disabled={!view.undo} onClick={() => editor.undo()}>
          <Undo2 className="size-6" strokeWidth={2.25} aria-hidden />
        </DockButton>
        <span aria-hidden className="mx-1 h-9 w-px shrink-0 bg-slate-200" />
        {view.colours.layout === "row" ? (
          <div role="group" aria-label={DOCK_COPY.colours} className="flex items-center">
            {KID_COLORS.map((c) => (
              <Swatch key={c} color={c} selected={view.colours.current === c} onPick={pick} />
            ))}
          </div>
        ) : (
          <ColourButton current={view.colours.current} onPick={pick} />
        )}
      </div>
      <nav aria-label={DOCK_COPY.pages} className={SHELL}>
        {view.pages.arrows && (
          <>
            <button type="button" className={ARROW} aria-label={DOCK_COPY.prev} title={DOCK_COPY.prev} disabled={!view.pages.canPrev} onClick={() => goToScreen(editor, -1)}>
              <ChevronLeft className="size-7" strokeWidth={2.5} aria-hidden />
            </button>
            <span className="min-w-11 text-center text-base font-semibold tabular-nums text-slate-700" aria-live="polite" aria-label={DOCK_COPY.pageOf(index, count)}>
              {view.pages.label}
            </span>
            <button type="button" className={ARROW} aria-label={DOCK_COPY.next} title={DOCK_COPY.next} disabled={!view.pages.canNext} onClick={() => goToScreen(editor, 1)}>
              <ChevronRight className="size-7" strokeWidth={2.5} aria-hidden />
            </button>
          </>
        )}
        <DockButton label={DOCK_COPY.newPage} title={view.pages.canAdd ? DOCK_COPY.newPage : DOCK_COPY.full} disabled={!view.pages.canAdd} onClick={() => addScreen(editor)}>
          <FilePlus2 className="size-6" strokeWidth={2.25} aria-hidden />
        </DockButton>
      </nav>
    </div>
  );
}

/** One raised shelf of the dock: white, round, a soft shadow (the board's floating cards share it). */
const SHELL =
  "pointer-events-auto flex items-center gap-1 rounded-[22px] border border-slate-200/80 bg-white p-1.5 shadow-[0_10px_30px_rgba(15,23,42,0.12),0_2px_6px_rgba(15,23,42,0.06)]";

const BUTTON =
  "flex h-14 min-w-14 shrink-0 cursor-pointer select-none flex-col items-center justify-center gap-1 rounded-2xl px-2 text-[11px] font-semibold leading-none text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 active:bg-slate-200/70 disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-slate-600 aria-pressed:bg-blue-50 aria-pressed:text-blue-700 aria-pressed:hover:bg-blue-50 motion-reduce:transition-none";

const ARROW =
  "flex h-14 w-12 shrink-0 cursor-pointer items-center justify-center rounded-2xl text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent motion-reduce:transition-none";

/** `anchor`: an attribute the button carries for the guided board's coach marks (`tourAnchors.ts`). */
function DockButton({ label, title, pressed, disabled, anchor, onClick, children }: { label: string; title?: string; pressed?: boolean; disabled?: boolean; anchor?: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className={BUTTON} title={title ?? label} aria-pressed={pressed} disabled={disabled} onClick={onClick} {...(anchor ? { [anchor]: "" } : {})}>
      {children}
      <span>{label}</span>
    </button>
  );
}

/** A colour's dot as the board draws it (tldraw's light theme: the board is always white). */
function dotOf(color: KidColor): string {
  return getDefaultColorTheme({ isDarkMode: false })[color].solid;
}

function Swatch({ color, selected, onPick }: { color: KidColor; selected: boolean; onPick: (c: KidColor) => void }) {
  const dot = dotOf(color);
  return (
    <button
      type="button"
      className="flex size-12 shrink-0 cursor-pointer items-center justify-center rounded-full transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 active:scale-90 motion-reduce:transition-none"
      aria-label={DOCK_COPY.colourName[color]}
      title={DOCK_COPY.colourName[color]}
      aria-pressed={selected}
      onClick={() => onPick(color)}
    >
      <span
        className="block size-8 rounded-full transition-shadow"
        style={{ background: dot, boxShadow: selected ? `0 0 0 3px #fff, 0 0 0 5.5px ${dot}` : "inset 0 0 0 1px rgba(15,23,42,0.08)" }}
      />
    </button>
  );
}

/** A phone's dock: the colours behind one button, opening above it. Closes on a pick, a tap elsewhere or Escape. */
function ColourButton({ current, onPick }: { current: KidColor | null; onPick: (c: KidColor) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      // not also tldraw's Escape, which puts the pen down for the selection arrow
      e.stopPropagation();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <DockButton label={DOCK_COPY.colour} pressed={open} onClick={() => setOpen((o) => !o)}>
        <span className="block size-6 rounded-full" style={{ background: dotOf(current ?? "black"), boxShadow: "inset 0 0 0 1px rgba(15,23,42,0.1)" }} />
      </DockButton>
      {open && (
        <div role="group" aria-label={DOCK_COPY.colours} className={`${SHELL} absolute bottom-full right-0 mb-2`}>
          {KID_COLORS.map((c) => (
            <Swatch
              key={c}
              color={c}
              selected={current === c}
              onPick={(picked) => {
                onPick(picked);
                setOpen(false);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Little hands (`LITTLE_HANDS`): while the simple board is up, tldraw's default pen is a size
 * thicker and the eraser reaches further while it is in hand. Both are put back as the board turns
 * grown-up again. A grown-up's tool still in hand (the arrow, text) gives way to the pen, the tool
 * the dock shows.
 */
function useLittleHands(editor: Editor): void {
  useEffect(() => {
    const thicker = penSizeOnOpen(editor.getStyleForNextShape(DefaultSizeStyle));
    if (thicker) editor.setStyleForNextShapes(DefaultSizeStyle, thicker as TLDefaultSizeStyle);
    if (editor.getCurrentToolId() !== "draw" && editor.getCurrentToolId() !== "eraser") editor.setCurrentTool("draw");
    // read by the eraser on every move; widened only while it is in hand, so the select tool (which
    // reads it too, picked from the keyboard) keeps tldraw's own
    const options = editor.options as { hitTestMargin: number };
    const base = options.hitTestMargin;
    const stop = react("kid eraser reach", () => {
      options.hitTestMargin = hitMarginFor(editor.getCurrentToolId(), base);
    });
    return () => {
      stop();
      options.hitTestMargin = base;
      const back = penSizeOnClose(editor.getStyleForNextShape(DefaultSizeStyle), thicker !== null);
      if (back) editor.setStyleForNextShapes(DefaultSizeStyle, back as TLDefaultSizeStyle);
    };
  }, [editor]);
}
