"use client";

import React, { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Circle,
  Eraser,
  FilePlus2,
  ImagePlus,
  Keyboard,
  LayoutGrid,
  MessageCircle,
  MousePointer2,
  MoveUpRight,
  Pencil,
  Redo2,
  Shapes,
  Slash,
  Square,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import {
  DefaultColorStyle,
  DefaultSizeStyle,
  GeoShapeGeoStyle,
  getDefaultColorTheme,
  react,
  useEditor,
  useValue,
  type Editor,
  type TLDefaultColorStyle,
  type TLDefaultSizeStyle,
} from "tldraw";
import { CHAT_TOGGLE_ATTR } from "@/components/chat/askButton";
import { useChatOpen } from "@/components/chat/useChatOpen";
import { toggleTypeBar, useTypeButton } from "@/components/typeMath/typeBarStore";
import { BOARD_IMAGE_TYPES } from "@/lib/assets/addImageFiles";
import { addScreen, goToScreen, MAX_SCREENS, screenPosition } from "@/lib/screens/screens";
import {
  DOCK_COPY,
  hitMarginFor,
  KID_COLORS,
  KID_SHAPES,
  kidDockView,
  penSizeOnClose,
  penSizeOnOpen,
  shapeTool,
  type KidColor,
  type KidDockView,
  type KidShape,
} from "./dockView";
import { KID_PEN_ATTR } from "./tourAnchors";

// the PDF page picker, for a PDF chosen with Picture: fetched the first time one is
const PdfDialog = React.lazy(() => import("@/components/PdfUpload").then((m) => ({ default: m.PdfDialog })));

/** A popover of the dock: the colours, the shapes, or the folded tools (More). One is open at a time. */
type Pop = "colours" | "shapes" | "more";

/**
 * The simple board's dock, in tldraw's toolbar slot (`BoardToolbar`): one white dock of 52 px
 * targets, each a picture with one short word under it, in groups — the tools (Select, Pen, Eraser,
 * Shapes, Picture, Type) | Undo and Redo | four big colours | the board's pages | Ask, the big blue
 * button that opens the tutor to talk to. What it shows, and how much of it fits one row on this
 * board, is `kidDockView`; while it is mounted the pen is a little thicker and the eraser a little
 * wider (`useLittleHands`). Loaded lazily: only a simple board needs it.
 */
export default function KidDock() {
  const editor = useEditor();
  useLittleHands(editor);
  const width = useValue("kid dock: board width", () => editor.getViewportScreenBounds().w, [editor]);
  const tool = useValue("kid tool", () => editor.getCurrentToolId(), [editor]);
  const geo = useValue("kid geo", () => editor.getStyleForNextShape(GeoShapeGeoStyle), [editor]);
  const color = useValue("kid colour", () => editor.getStyleForNextShape(DefaultColorStyle), [editor]);
  const canUndo = useValue("kid can undo", () => editor.getCanUndo(), [editor]);
  const canRedo = useValue("kid can redo", () => editor.getCanRedo(), [editor]);
  const pageIds = useValue("kid pages", () => editor.getPages().map((p) => p.id), [editor]);
  const current = useValue("kid page", () => editor.getCurrentPageId(), [editor]);
  const { index, count } = screenPosition(pageIds, current);
  // Type it (docs/TYPE-MATH.md): the bar to type maths in, opened and closed here too
  const type = useTypeButton();
  // the board chat's open state is the page's own store, so the dock's Ask and the panel agree
  const [chatOpen, setChatOpen] = useChatOpen();
  const view = kidDockView({ width, tool, geo, color, canUndo, canRedo, type: type.available, chatOpen, page: index, pages: count, maxPages: MAX_SCREENS });
  const picture = usePicture(editor);
  const [pop, setPop] = useState<Pop | null>(null);
  const toggle = (p: Pop) => setPop((open) => (open === p ? null : p));
  const close = () => setPop(null);
  const dockRef = useRef<HTMLDivElement>(null);

  const pickColour = (c: KidColor) =>
    editor.run(() => {
      editor.setStyleForNextShapes(DefaultColorStyle, c as TLDefaultColorStyle);
      // picking a colour is picking up the pen, unless a shape is in hand (its colour is the same)
      if (!DRAWING_TOOLS.has(editor.getCurrentToolId())) editor.setCurrentTool("draw");
    });
  const pickShape = (s: KidShape) =>
    editor.run(() => {
      const { tool: id, geo: kind } = shapeTool(s);
      if (kind) editor.setStyleForNextShapes(GeoShapeGeoStyle, kind);
      editor.setCurrentTool(id);
    });
  // every button of the dock but the one a popover belongs to closes it
  const act = (fn: () => void) => () => {
    close();
    fn();
  };
  const use = (tool: string) => act(() => editor.setCurrentTool(tool));

  const compact = view.stack;
  const tools = (
    <div className="flex items-center gap-0.5">
      <DockButton label={DOCK_COPY.select} title={DOCK_COPY.selectHint} pressed={view.select} compact={compact} anchor="data-kid-select" onClick={use("select")}>
        <MousePointer2 className={ICON} strokeWidth={2} aria-hidden />
      </DockButton>
      {/* the guided board's first coach mark ("Grab the pen…") points at it */}
      <DockButton label={DOCK_COPY.pen} pressed={view.pen} compact={compact} anchor={KID_PEN_ATTR} onClick={use("draw")}>
        <Pencil className={ICON} strokeWidth={2} aria-hidden />
      </DockButton>
      <DockButton label={DOCK_COPY.eraser} pressed={view.eraser} compact={compact} onClick={use("eraser")}>
        <Eraser className={ICON} strokeWidth={2} aria-hidden />
      </DockButton>
      {!view.folded && (
        <Anchored open={pop === "shapes"} onClose={close} trigger={(ref) => (
          <DockButton ref={ref} label={DOCK_COPY.shapes} title={DOCK_COPY.shapesHint} pressed={view.shapes.pressed} expanded={pop === "shapes"} anchor="data-kid-shapes" onClick={() => toggle("shapes")}>
            {React.createElement(view.shapes.current ? SHAPE_ICON[view.shapes.current] : Shapes, { className: ICON, strokeWidth: 2, "aria-hidden": true })}
          </DockButton>
        )}>
          <ShapeButtons current={view.shapes.current} onPick={(s) => act(() => pickShape(s))()} />
        </Anchored>
      )}
      {!view.folded && (
        <DockButton label={DOCK_COPY.picture} title={DOCK_COPY.pictureHint} anchor="data-kid-picture" onClick={act(picture.choose)}>
          <ImagePlus className={ICON} strokeWidth={2} aria-hidden />
        </DockButton>
      )}
      {view.type && !view.typeInMore && (
        <DockButton label={DOCK_COPY.type} title={DOCK_COPY.typeHint} pressed={type.open} compact={compact} onClick={act(toggleTypeBar)}>
          <Keyboard className={ICON} strokeWidth={2} aria-hidden />
        </DockButton>
      )}
      {view.stack && <ColourButton current={view.colours.current} open={pop === "colours"} compact onToggle={() => toggle("colours")} />}
    </div>
  );
  const edits = (
    <div className="flex items-center gap-0.5">
      <DockButton label={DOCK_COPY.undo} disabled={!view.undo} compact={compact} onClick={act(() => editor.undo())}>
        <Undo2 className={ICON} strokeWidth={2} aria-hidden />
      </DockButton>
      {view.folded ? (
        // the tool in hand may be in there (a shape): More shows as pressed then
        <DockButton label={DOCK_COPY.more} title={DOCK_COPY.moreHint} pressed={view.shapes.pressed} expanded={pop === "more"} compact={compact} anchor="data-kid-more-tools" onClick={() => toggle("more")}>
          <LayoutGrid className={ICON} strokeWidth={2} aria-hidden />
        </DockButton>
      ) : (
        <DockButton label={DOCK_COPY.redo} disabled={!view.redo} onClick={act(() => editor.redo())}>
          <Redo2 className={ICON} strokeWidth={2} aria-hidden />
        </DockButton>
      )}
    </div>
  );
  const colours =
    view.colours.layout === "row" ? (
      <div role="group" aria-label={DOCK_COPY.colours} className="flex items-center gap-0.5">
        {KID_COLORS.map((c) => (
          <Swatch key={c} color={c} selected={view.colours.current === c} onPick={(picked) => act(() => pickColour(picked))()} />
        ))}
      </div>
    ) : (
      <ColourButton current={view.colours.current} open={pop === "colours"} onToggle={() => toggle("colours")} />
    );
  const pages = <PagesShelf editor={editor} view={view} index={index} count={count} act={act} />;
  const ask = (
    <button
      type="button"
      className={`${ASK} ${view.stack ? "flex-1" : "min-w-[104px]"}`}
      title={DOCK_COPY.askHint}
      aria-expanded={chatOpen}
      onClick={act(() => setChatOpen(!chatOpen))}
      {...{ [CHAT_TOGGLE_ATTR]: "" }}
    >
      <MessageCircle className={ICON} strokeWidth={2.25} aria-hidden />
      <span>{DOCK_COPY.ask}</span>
    </button>
  );

  return (
    // `relative`: the colours and the folded tools open over the whole dock (`DockPopover`)
    <div role="toolbar" aria-label={DOCK_COPY.dock} data-kid-dock="" data-fit={view.fit} className="pointer-events-none relative mb-[max(10px,env(safe-area-inset-bottom))] flex justify-center px-2">
      <div ref={dockRef} className={DOCK}>
        {view.stack ? (
          <>
            {/* a phone: the pages and Ask over the tools, one dock of two rows (the tools alone under Ask's sheet) */}
            {view.askRow && (
              <>
                <div className="flex items-center">
                  {pages}
                  <Divider />
                  {ask}
                </div>
                <span aria-hidden className="mx-1 h-px bg-slate-200/80" />
              </>
            )}
            <div className="flex items-center justify-between">
              {tools}
              <Divider />
              {edits}
            </div>
          </>
        ) : (
          <div className="flex items-center">
            {tools}
            <Divider />
            {edits}
            <Divider />
            {colours}
            <Divider />
            {pages}
            <span aria-hidden className="w-2 shrink-0" />
            {ask}
          </div>
        )}
      </div>
      {pop === "colours" && view.colours.layout === "button" && (
        <DockPopover label={DOCK_COPY.colours} dock={dockRef} onClose={close} testId="data-kid-colours">
          {KID_COLORS.map((c) => (
            <Swatch key={c} color={c} selected={view.colours.current === c} onPick={(picked) => act(() => pickColour(picked))()} />
          ))}
        </DockPopover>
      )}
      {pop === "more" && view.folded && (
        <DockPopover label={DOCK_COPY.moreHint} dock={dockRef} onClose={close} testId="data-kid-more-panel">
          <div className="grid grid-cols-[repeat(4,4.5rem)] gap-0.5">
            <ShapeButtons current={view.shapes.current} onPick={(s) => act(() => pickShape(s))()} />
            <div className="col-span-4 grid auto-cols-fr grid-flow-col gap-0.5">
              <WideButton label={DOCK_COPY.picture} title={DOCK_COPY.pictureHint} icon={ImagePlus} onClick={act(picture.choose)} />
              {view.typeInMore && <WideButton label={DOCK_COPY.type} title={DOCK_COPY.typeHint} icon={Keyboard} pressed={type.open} onClick={act(toggleTypeBar)} />}
              {/* stays open: a kid may redo more than once */}
              <WideButton label={DOCK_COPY.redo} icon={Redo2} disabled={!view.redo} onClick={() => editor.redo()} />
            </div>
          </div>
        </DockPopover>
      )}
      {picture.element}
    </div>
  );
}

/** The tools whose strokes take the dock's colour: a colour picked with one of them in hand keeps it. */
const DRAWING_TOOLS = new Set(["draw", "line", "arrow", "geo"]);

const SHAPE_ICON: Record<KidShape, LucideIcon> = { line: Slash, arrow: MoveUpRight, rectangle: Square, ellipse: Circle };

/** Line, Arrow, Rectangle, Circle: the shapes, each a dock button (in Shapes' popover, or in More's). */
function ShapeButtons({ current, onPick }: { current: KidShape | null; onPick: (s: KidShape) => void }) {
  return (
    <>
      {KID_SHAPES.map((s) => {
        const Icon = SHAPE_ICON[s];
        return (
          <DockButton key={s} label={DOCK_COPY.shapeName[s]} pressed={current === s} wide onClick={() => onPick(s)}>
            <Icon className={ICON} strokeWidth={2} aria-hidden />
          </DockButton>
        );
      })}
    </>
  );
}

/**
 * Picture: one file picker for a photo of homework or a PDF. A picture goes on the board through the
 * board's own handler for pasted and dropped files (`addImageFiles`: uploaded, and taken off again if
 * the upload fails); a PDF opens the classic board's page picker (`PdfDialog`) with the file already
 * chosen, whose page goes on the screen locked and out of the tutor's reach. The input and the dialog
 * live with the dock, not with the button, which a phone keeps in More's popover.
 */
function usePicture(editor: Editor): { choose: () => void; element: ReactNode } {
  const input = useRef<HTMLInputElement>(null);
  const [pdf, setPdf] = useState<{ file: File; n: number } | null>(null);
  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.currentTarget.value = "";
    if (!file) return;
    if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
      setPdf((p) => ({ file, n: (p?.n ?? 0) + 1 }));
      return;
    }
    void editor.putExternalContent({ type: "files", files: [file] });
  };
  return {
    choose: () => input.current?.click(),
    element: (
      <>
        <input ref={input} type="file" hidden accept={PICTURE_ACCEPT} onChange={onChange} data-kid-picture-input="" />
        {pdf && (
          <React.Suspense fallback={null}>
            <PdfDialog key={pdf.n} open initialFile={pdf.file} onOpenChange={(open) => !open && setPdf(null)} />
          </React.Suspense>
        )}
      </>
    ),
  };
}

/** What Picture's file picker offers: the pictures a board takes (`BOARD_IMAGE_TYPES`), and a PDF. */
const PICTURE_ACCEPT = [...BOARD_IMAGE_TYPES.filter((t) => t !== "image/svg+xml"), "application/pdf", ".pdf"].join(",");

/** The dock's pages: ‹ n / N › once there are several, and New page. */
function PagesShelf({ editor, view, index, count, act }: { editor: Editor; view: KidDockView; index: number; count: number; act: (fn: () => void) => () => void }) {
  return (
    <nav aria-label={DOCK_COPY.pages} className="flex items-center gap-0.5">
      {view.pages.arrows && (
        <>
          <button type="button" className={ARROW} aria-label={DOCK_COPY.prev} title={DOCK_COPY.prev} disabled={!view.pages.canPrev} onClick={act(() => goToScreen(editor, -1))}>
            <ChevronLeft className="size-6" strokeWidth={2.25} aria-hidden />
          </button>
          <span className="w-10 shrink-0 text-center text-[15px] font-semibold tabular-nums text-slate-700" aria-live="polite" aria-label={DOCK_COPY.pageOf(index, count)}>
            {view.pages.label}
          </span>
          <button type="button" className={ARROW} aria-label={DOCK_COPY.next} title={DOCK_COPY.next} disabled={!view.pages.canNext} onClick={act(() => goToScreen(editor, 1))}>
            <ChevronRight className="size-6" strokeWidth={2.25} aria-hidden />
          </button>
        </>
      )}
      <DockButton label={DOCK_COPY.newPage} title={view.pages.canAdd ? DOCK_COPY.newPage : DOCK_COPY.full} disabled={!view.pages.canAdd} wide onClick={act(() => addScreen(editor))}>
        <FilePlus2 className={ICON} strokeWidth={2} aria-hidden />
      </DockButton>
    </nav>
  );
}

/**
 * The dock: one white shelf, round, a soft shadow (the board's floating cards share it). Its radius
 * is its buttons' (16 px) and its padding (6 px), so the corners run parallel.
 */
const DOCK =
  "pointer-events-auto flex max-w-full flex-col gap-1 rounded-[22px] border border-slate-200/90 bg-white p-1.5 shadow-[0_8px_28px_rgba(15,23,42,0.11),0_1px_3px_rgba(15,23,42,0.06)]";

/** Every picture in the dock: one size, one weight. */
const ICON = "size-[22px]";

/**
 * A tool: 52 px tall, at least 48 px wide (46 on a phone's two rows), its word under its picture.
 * In hand (`aria-pressed`): a blue tint and a blue picture; its popover open: grey.
 */
const BUTTON =
  "flex h-[52px] shrink-0 cursor-pointer select-none flex-col items-center justify-center gap-[5px] rounded-2xl text-[11px] font-semibold leading-none text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 active:bg-slate-200/70 disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-slate-600 aria-expanded:bg-slate-100 aria-expanded:text-slate-900 aria-pressed:bg-blue-100/80 aria-pressed:text-blue-700 aria-pressed:hover:bg-blue-100 motion-reduce:transition-none";

/** Ask: as tall as the tools, filled blue, its word beside its picture: the one the dock's eye goes to. */
const ASK =
  "flex h-[52px] shrink-0 cursor-pointer select-none items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 text-[17px] font-semibold text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 focus-visible:ring-offset-2 active:bg-blue-800 aria-expanded:bg-blue-800 motion-reduce:transition-none";

const ARROW =
  "flex h-[52px] w-11 shrink-0 cursor-pointer items-center justify-center rounded-2xl text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent motion-reduce:transition-none";

function Divider() {
  return <span aria-hidden className="mx-1.5 h-8 w-px shrink-0 bg-slate-200" />;
}

/**
 * `anchor`: an attribute the button carries (the guided board's coach marks, `tourAnchors.ts`, and
 * the QA scripts). `compact`: a phone's two rows, 46 px wide; `wide`: a long word (New page,
 * Rectangle) gets the room it needs.
 */
const DockButton = React.forwardRef<
  HTMLButtonElement,
  { label: string; title?: string; pressed?: boolean; expanded?: boolean; disabled?: boolean; anchor?: string; compact?: boolean; wide?: boolean; onClick: () => void; children: ReactNode }
>(function DockButton({ label, title, pressed, expanded, disabled, anchor, compact, wide, onClick, children }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      className={`${BUTTON} ${compact ? "min-w-[46px] px-0.5" : wide ? "min-w-16 px-2" : "min-w-12 px-1"}`}
      title={title ?? label}
      aria-pressed={pressed}
      aria-expanded={expanded}
      disabled={disabled}
      onClick={onClick}
      {...(anchor ? { [anchor]: "" } : {})}
    >
      {children}
      <span>{label}</span>
    </button>
  );
});

/** A button of More's popover under its shapes, sharing the row: its picture beside its word. */
function WideButton({ label, title, icon: Icon, pressed, disabled, onClick }: { label: string; title?: string; icon: LucideIcon; pressed?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className="flex h-[52px] cursor-pointer select-none items-center justify-center gap-2 rounded-2xl px-2 text-[13px] font-semibold text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 active:bg-slate-200/70 disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent aria-pressed:bg-blue-100/80 aria-pressed:text-blue-700 motion-reduce:transition-none"
      title={title ?? label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon className={ICON} strokeWidth={2} aria-hidden />
      {label}
    </button>
  );
}

/** A colour's dot as the board draws it (tldraw's light theme: the board is always white). */
function dotOf(color: KidColor): string {
  return getDefaultColorTheme({ isDarkMode: false })[color].solid;
}

/** A colour: a 44 px target, its 28 px dot ringed in its own colour while it is the one picked. */
function Swatch({ color, selected, onPick }: { color: KidColor; selected: boolean; onPick: (c: KidColor) => void }) {
  const dot = dotOf(color);
  return (
    <button
      type="button"
      className="flex h-[52px] w-11 shrink-0 cursor-pointer items-center justify-center rounded-2xl transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 active:bg-slate-200/70 motion-reduce:transition-none"
      aria-label={DOCK_COPY.colourName[color]}
      title={DOCK_COPY.colourName[color]}
      aria-pressed={selected}
      onClick={() => onPick(color)}
    >
      <span
        className="block size-7 rounded-full transition-shadow motion-reduce:transition-none"
        style={{ background: dot, boxShadow: selected ? `0 0 0 2.5px #fff, 0 0 0 4.5px ${dot}` : "inset 0 0 0 1px rgba(15,23,42,0.1)" }}
      />
    </button>
  );
}

/** The colours behind one button (an upright iPad, a phone): its dot is the colour in hand. */
function ColourButton({ current, open, compact, onToggle }: { current: KidColor | null; open: boolean; compact?: boolean; onToggle: () => void }) {
  return (
    <DockButton label={DOCK_COPY.colour} expanded={open} compact={compact} anchor="data-kid-colour" onClick={onToggle}>
      <span className="block size-[22px] rounded-full" style={{ background: dotOf(current ?? "black"), boxShadow: "inset 0 0 0 1px rgba(15,23,42,0.12)" }} />
    </DockButton>
  );
}

/**
 * Closes a popover on a tap outside it (and outside what opened it) or on Escape — and only that
 * Escape: not also tldraw's, which puts the pen down for the selection arrow.
 */
function useDismiss(open: boolean, inside: Array<RefObject<HTMLElement | null>>, onClose: () => void): void {
  const latest = useRef({ inside, onClose });
  useEffect(() => {
    latest.current = { inside, onClose };
  });
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (latest.current.inside.some((r) => r.current?.contains(e.target as Node))) return;
      latest.current.onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      latest.current.onClose();
      e.stopPropagation();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);
}

/** A popover's shelf: white, round, the dock's shadow, a row of its buttons. */
const SHELF =
  "pointer-events-auto z-10 rounded-[22px] border border-slate-200/90 bg-white p-1.5 shadow-[0_12px_32px_rgba(15,23,42,0.14),0_2px_6px_rgba(15,23,42,0.06)]";

/**
 * A popover over the whole dock, centred on it (the colours, More's tools): with a phone's two rows,
 * a popover over one button had the other row's buttons drawn over it, taking the tap meant for a
 * colour (QA, 2026-10-09). A tap on the board closes it; the dock's own buttons close it themselves
 * (`KidDock`'s `close`), and the one that opened it toggles it.
 */
function DockPopover({ label, dock, testId, onClose, children }: { label: string; dock: RefObject<HTMLDivElement | null>; testId: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(true, [ref, dock], onClose);
  return (
    <div ref={ref} role="group" aria-label={label} {...{ [testId]: "" }} className={`${SHELF} absolute bottom-full left-1/2 mb-2 flex -translate-x-1/2 items-center gap-0.5`}>
      {children}
    </div>
  );
}

/** A popover over its own button (Shapes, on a dock with room): its trigger and its shelf, one box. */
function Anchored({ open, onClose, trigger, children }: { open: boolean; onClose: () => void; trigger: (ref: RefObject<HTMLButtonElement | null>) => ReactNode; children: ReactNode }) {
  const button = useRef<HTMLButtonElement>(null);
  const shelf = useRef<HTMLDivElement>(null);
  useDismiss(open, [button, shelf], onClose);
  return (
    <span className="relative flex">
      {trigger(button)}
      {open && (
        <div ref={shelf} role="group" aria-label={DOCK_COPY.shapes} data-kid-shapes-panel="" className={`${SHELF} absolute bottom-full left-1/2 mb-3 flex -translate-x-1/2 items-center gap-0.5`}>
          {children}
        </div>
      )}
    </span>
  );
}

/**
 * Little hands (`LITTLE_HANDS`): while the simple board is up, tldraw's default pen is a size
 * thicker and the eraser reaches further while it is in hand. Both are put back as the board turns
 * classic again. A tool the dock does not offer (text, a sticky note) gives way to the pen.
 */
function useLittleHands(editor: Editor): void {
  useEffect(() => {
    const thicker = penSizeOnOpen(editor.getStyleForNextShape(DefaultSizeStyle));
    if (thicker) editor.setStyleForNextShapes(DefaultSizeStyle, thicker as TLDefaultSizeStyle);
    if (!DOCK_TOOLS.has(editor.getCurrentToolId())) editor.setCurrentTool("draw");
    // read by the eraser on every move; widened only while it is in hand, so the select tool (which
    // reads it too) keeps tldraw's own
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

/** The tools the dock offers (and shows in hand). */
const DOCK_TOOLS = new Set(["select", "draw", "eraser", "line", "arrow", "geo"]);
