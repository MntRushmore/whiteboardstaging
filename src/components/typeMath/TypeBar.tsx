"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { DefaultColorStyle, getDefaultColorTheme, useValue, type Editor, type TLDefaultColorStyle } from "tldraw";
import { ChevronDown, CornerDownLeft, Keyboard, Plus, X } from "lucide-react";
import { layoutMath, type MathLayout } from "@/lib/hand";
import type { LiveController, Rect } from "@/lib/live/contracts";
import { liveStore } from "@/lib/live/liveStore";
import { clientMetric } from "@/lib/logger";
import type { TypedLineRef, TypedParse } from "@/lib/typeMath/contracts";
import { typeBarInset } from "@/lib/typeMath/barLink";
import { latexToPlain, plainToLatex } from "@/lib/typeMath/parse";
import { PANEL_DOCKED_QUERY } from "@/components/board/keyboardFit";
import { BOTTOM_UI_SELECTOR } from "@/components/live/hintPlacement";
import { BoardMarks, type CaretMark, type LineMark } from "./boardMarks";
import { HandPreview, PREVIEW_HAND_SIZE, PREVIEW_SEED } from "./HandPreview";
import { setTypeBarOpen, typeBarState, useTypingFirst } from "./typeBarStore";
import {
  INITIAL_BAR,
  MATH_KEYS,
  TYPE_COPY,
  barKey,
  barLeaveEdit,
  barMathKey,
  barNewProblem,
  barOpenLine,
  barPreview,
  barSubmit,
  barTyped,
  boardKeyGoesToBox,
  browserStorage,
  markTipSeen,
  shouldShowTip,
  tipSeen,
  typeText,
  type BarContext,
  type BarState,
  type BarStep,
  type MathKey,
} from "./typeBarModel";

/**
 * Type it (docs/TYPE-MATH.md): the bar a kid on a laptop types their maths in. One lazy chunk with
 * the parser and the preview, mounted by the board page while the bar shows (`useTypeBar`).
 *
 * A slim card docked at the foot of the board, over tldraw's toolbar (or the kid dock): the box,
 * the line drawn in the board's hand as they type it, the maths keys, New problem and Enter. Enter
 * hands the line to the Live loop (`controller.writeTyped`), which writes it in the kid's own ink on
 * the next line of their problem and reads it as typed. ↑ walks back up the problem's lines to change
 * one; on a laptop a pencil beside a line does the same. While the box has focus a soft caret on the
 * board shows where the line will go.
 *
 * Where it sits: above tldraw's bottom row (measured), above an on-screen keyboard (the visual
 * viewport), centred in the board (beside Ask's docked panel). With Ask's bottom sheet open on a
 * short board it steps aside: the sheet has its own box. It publishes how much of the board's foot
 * it covers (`typeBarInset`, and `--type-bar-inset` on the container) for the hint cards, Now you
 * try and the writer's camera.
 */

/** The parser, passed in by the tests and the dev harness; the real one otherwise. */
export interface TypeParser {
  plainToLatex(text: string): TypedParse;
  latexToPlain(latex: string): string;
}
const PARSER: TypeParser = { plainToLatex, latexToPlain };

/** What the bar needs of the editor (a fake one in the tests). */
export type TypeBarEditor = Pick<
  Editor,
  | "getContainer"
  | "getViewportScreenBounds"
  | "getCurrentPageId"
  | "getCurrentPageShapeIds"
  | "pageToViewport"
  | "getZoomLevel"
  | "getStyleForNextShape"
  | "getSelectedShapeIds"
  | "getEditingShapeId"
  | "undo"
  | "redo"
  | "focus"
> & { menus: Pick<Editor["menus"], "hasAnyOpenMenus"> };

export interface TypeBarProps {
  editor: TypeBarEditor;
  controller: LiveController;
  /** the guided first board's tour is on: no tip */
  tour?: boolean;
  /** Ask's panel is open (beside the board, or a sheet under it) */
  chatOpen?: boolean;
  /** the simple board (K–3): its dock is the bottom row */
  simple?: boolean;
  parser?: TypeParser;
  /** where the bar starts (the markup tests show a typed line, a hint, a line being changed) */
  initial?: Partial<BarState>;
}

/** px between the bar and what is under it (tldraw's bottom row, the keyboard) */
const GAP = 8;
/** with Ask's sheet open, a board shorter than this has no room for the bar too */
const SHORT_BOARD_PX = 560;

export default function TypeBar(props: TypeBarProps) {
  // no writer on this board (Live off, an old controller): no bar
  if (!props.controller.writeTyped) return null;
  return <TypeBarCard {...props} />;
}

function TypeBarCard({ editor, controller, tour = false, chatOpen = false, simple = false, parser = PARSER, initial }: TypeBarProps) {
  const typingFirst = useTypingFirst();
  const container = editor.getContainer();
  const inputRef = useRef<HTMLInputElement>(null);
  const [bar, setBar] = useState<BarState>(() => ({ ...INITIAL_BAR, ...initial }));
  const [focused, setFocused] = useState(false);
  /** bumped after each write and undo: the lines and the caret are read again */
  const [rev, setRev] = useState(0);
  const [tip, setTip] = useState(() => shouldShowTip({ typingFirst, tour, seen: tipSeen(browserStorage()) }));
  const { field, edit, armed } = bar;

  const ink = useValue("type: ink", () => inkHex(editor.getStyleForNextShape(DefaultColorStyle) as string), [editor]);

  // the problem's lines (↑, the pencils) and where Enter writes, read again whenever Live's lines,
  // the ink on the screen, the screen or the camera change, and after each write
  const lines = useValue(
    "type: lines",
    () => {
      liveStore.lines.get();
      editor.getCurrentPageShapeIds();
      return readLines(controller);
    },
    [editor, controller, rev],
  );
  const marks = useValue(
    "type: line marks",
    (): LineMark[] => lines.map((l) => ({ lineId: l.lineId, rect: toViewport(editor, l.bounds) })),
    [editor, lines],
  );
  const caret = useValue(
    "type: caret",
    (): CaretMark | null => {
      liveStore.lines.get();
      editor.getCurrentPageShapeIds();
      const spot = readSpot(controller, armed);
      if (!spot) return null;
      const p = editor.pageToViewport({ x: spot.x, y: spot.baselineY });
      return { x: p.x, y: p.y, h: Math.max(10, spot.size * editor.getZoomLevel()) };
    },
    [editor, controller, armed, rev],
  );

  const ctx = useMemo<BarContext>(
    () => ({
      parse: (text) => parser.plainToLatex(text),
      latexToPlain: (latex) => parser.latexToPlain(latex),
      canWrite: (latex) => handLayout(latex).unsupported.length === 0,
      write: (args) => controller.writeTyped?.(args) ?? { ok: false, reason: "off" },
      lines,
    }),
    [parser, controller, lines],
  );
  const preview = useMemo(() => barPreview(bar, ctx), [bar, ctx]);
  const layout = preview.latex.trim() ? handLayout(preview.latex) : null;

  // where it sits, and when it steps aside
  const foot = useFootInset(container);
  const lift = useKeyboardLift();
  const bottom = Math.max(foot, lift) + GAP;
  const docked = useMediaQuery(PANEL_DOCKED_QUERY);
  const boardHeight = useValue("type: board height", () => editor.getViewportScreenBounds().h, [editor]);
  const hidden = chatOpen && !docked && boardHeight < SHORT_BOARD_PX;
  useEffect(() => {
    typeBarState.suppressed.set(hidden);
    return () => {
      typeBarState.suppressed.set(false);
    };
  }, [hidden]);
  const barRef = useRef<HTMLDivElement>(null);
  usePublishInset(container, barRef, hidden, bottom);

  /** the box as it is now: its caret from the DOM (at the end when it does not have the focus) */
  const now = useCallback((): BarState => {
    const el = inputRef.current;
    if (!el) return bar;
    const value = el.value;
    if (typeof document === "undefined" || document.activeElement !== el) return { ...bar, field: { value, start: value.length, end: value.length } };
    return { ...bar, field: { value, start: el.selectionStart ?? value.length, end: el.selectionEnd ?? value.length } };
  }, [bar]);

  const focusBox = useCallback(() => inputRef.current?.focus({ preventScroll: true }), []);

  // the caret goes where the model put it once React has rendered the new text
  const lastField = useRef(field);
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el || lastField.current === field) return;
    lastField.current = field;
    if (document.activeElement === el && (el.selectionStart !== field.start || el.selectionEnd !== field.end)) el.setSelectionRange(field.start, field.end);
  }, [field]);

  const dismissTip = useCallback(() => {
    setTip(false);
    markTipSeen(browserStorage());
  }, []);

  /** does what a step says outside the bar: metrics, the board's undo, the focus */
  const run = useCallback(
    (step: BarStep) => {
      setBar(step.state);
      if (step.metric) clientMetric(step.metric.name, step.metric.fields);
      if (step.outside === "undo") editor.undo();
      if (step.outside === "redo") editor.redo();
      if (step.outside === "board") {
        inputRef.current?.blur();
        editor.focus();
      }
      if (step.wrote || step.outside === "undo" || step.outside === "redo") setRev((n) => n + 1);
      if (step.wrote && tip) dismissTip();
    },
    [editor, tip, dismissTip],
  );

  const openLine = useCallback(
    (lineId: string) => {
      const index = lines.findIndex((l) => l.lineId === lineId);
      setBar((b) => barOpenLine(b, index >= 0 ? lines[index] : penLine(lineId), index, parser.latexToPlain));
      focusBox();
    },
    [lines, parser, focusBox],
  );

  // a readback double-clicked: its line in the box
  const editLine = useValue("type: edit line", () => typeBarState.editLine.get(), []);
  useEffect(() => {
    if (!editLine) return;
    typeBarState.editLine.set(null);
    openLine(editLine);
  }, [editLine, openLine]);

  // opened: focused on a laptop, or when a Type button opened it (an on-screen keyboard comes up)
  useEffect(() => {
    const how = typeBarState.openedBy.get();
    if (typingFirst || how !== "default") focusBox();
    clientMetric("type.open", { how, laptop: typingFirst, simple });
    // once per opening
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The box's keys, on the box itself: tldraw listens on its container (natively, so before React's
  // own handlers at the root), and takes Escape even from a text box — it would put the pen down for
  // the arrow and take the focus. Stopped here, a key the bar handles never reaches the board.
  const onKeyDown = useRef<(e: KeyboardEvent) => void>(() => {});
  onKeyDown.current = (e: KeyboardEvent) => {
    if (e.isComposing) return;
    const step = barKey(now(), { key: e.key, shift: e.shiftKey, mod: e.metaKey || e.ctrlKey, alt: e.altKey }, ctx);
    if (!step.handled) return;
    e.preventDefault();
    e.stopPropagation();
    run(step);
  };
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const listener = (e: KeyboardEvent) => onKeyDown.current(e);
    el.addEventListener("keydown", listener);
    return () => el.removeEventListener("keydown", listener);
  }, [hidden]);

  // THE KEYBOARD RULE (`boardKeyGoesToBox`): a maths key typed on the board goes to the box
  useEffect(() => {
    if (hidden) return;
    const onKey = (e: KeyboardEvent) => {
      const el = inputRef.current;
      if (!el || e.defaultPrevented || document.activeElement === el) return;
      if (!onTheBoard(document.activeElement, container)) return;
      if (editor.getEditingShapeId() !== null || editor.menus.hasAnyOpenMenus()) return;
      const what = boardKeyGoesToBox(e, editor.getSelectedShapeIds().length === 0);
      if (!what) return;
      e.preventDefault();
      e.stopPropagation();
      el.focus({ preventScroll: true });
      if (what === "type") setBar((b) => barTyped(b, typeText({ value: el.value, start: el.value.length, end: el.value.length }, e.key)));
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [hidden, container, editor]);

  if (hidden) return null;

  const lineNo = edit ? edit.index + 1 : 0;
  const empty = field.value.trim() === "";
  const status = edit ? TYPE_COPY.editingHint(lineNo) : armed ? TYPE_COPY.newProblemArmed : (preview.message ?? "");

  return (
    <>
      <style>{CSS}</style>
      <BoardMarks
        container={container}
        caret={focused && !edit ? caret : null}
        ink={ink}
        lines={marks}
        editing={edit?.line.lineId ?? null}
        pencils={typingFirst}
        onPencil={openLine}
      />
      <div
        ref={barRef}
        data-type-bar=""
        className="pointer-events-none absolute inset-x-0 z-[960] flex justify-center px-4 max-sm:px-2"
        style={{ bottom }}
      >
        <div
          role="group"
          aria-label={TYPE_COPY.region}
          className="@container/type pointer-events-auto relative w-full max-w-[720px] rounded-[20px] border border-slate-200/80 bg-white p-2 shadow-[0_10px_30px_rgba(15,23,42,0.12),0_2px_6px_rgba(15,23,42,0.06)]"
          // a tap on the bar is never a stroke on the board under it
          onPointerDown={(e) => e.stopPropagation()}
        >
          {tip && <Tip onDismiss={dismissTip} />}
          <div className="flex items-stretch gap-2">
            <div
              // two names for one shake, so each new one starts again (a key would remount the box and lose its focus)
              data-shake={bar.shake > 0 ? (bar.shake % 2 ? "a" : "b") : undefined}
              className={`type-field flex h-14 min-w-0 flex-1 items-center rounded-[14px] border bg-slate-50 transition-colors focus-within:border-blue-500 focus-within:bg-white focus-within:ring-[3px] focus-within:ring-blue-500/20 motion-reduce:transition-none ${edit ? "border-blue-300" : "border-slate-200"}`}
            >
              {edit && (
                <button
                  type="button"
                  data-type-editing-chip=""
                  className="ml-1.5 flex h-9 shrink-0 cursor-pointer items-center gap-1 rounded-[10px] bg-blue-50 pl-2.5 pr-1.5 text-[13px] font-semibold text-blue-700 transition-colors hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
                  title={TYPE_COPY.editingHint(lineNo)}
                  aria-label={TYPE_COPY.editingHint(lineNo)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setBar((b) => barLeaveEdit(b));
                    focusBox();
                  }}
                >
                  {TYPE_COPY.editing(lineNo)}
                  <X className="size-3.5" strokeWidth={2.5} aria-hidden />
                </button>
              )}
              <input
                ref={inputRef}
                type="text"
                data-type-box=""
                aria-label={TYPE_COPY.box}
                aria-describedby="type-bar-status"
                placeholder={edit ? "" : TYPE_COPY.placeholder}
                value={field.value}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                enterKeyHint="enter"
                className="h-full min-w-0 flex-1 basis-0 bg-transparent px-3 text-[18px] text-slate-900 outline-none placeholder:text-slate-400 @max-[440px]/type:placeholder:text-transparent"
                onChange={(e) => setBar((b) => barTyped(b, { value: e.target.value, start: e.target.selectionStart ?? e.target.value.length, end: e.target.selectionEnd ?? e.target.value.length }))}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
              />
              <div
                data-type-preview-slot=""
                className={`h-full min-w-0 items-center gap-2 overflow-hidden border-l border-slate-200 py-0.5 pl-3 pr-2 ${empty && !preview.message ? "hidden" : "flex flex-1 basis-0"}`}
                title={TYPE_COPY.preview}
              >
                {!bar.notice && <HandPreview layout={layout} color={ink} muted={preview.muted} />}
                {preview.message && (
                  <span data-type-hint="" className="line-clamp-2 min-w-0 text-[13px] font-medium leading-tight text-amber-700">
                    {preview.message}
                  </span>
                )}
              </div>
            </div>
            <NewProblemButton wide pressed={armed} disabled={Boolean(edit)} onClick={() => run(barNewProblem(now(), ctx))} after={focusBox} />
            <button
              type="button"
              data-type-enter=""
              className={`flex h-14 shrink-0 cursor-pointer items-center gap-2 rounded-[14px] bg-slate-900 px-5 text-base font-semibold text-white transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-blue-500/50 active:bg-slate-950 motion-reduce:transition-none max-sm:px-4 ${empty ? "opacity-40" : ""}`}
              title={TYPE_COPY.enterHint}
              aria-label={TYPE_COPY.enterHint}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                run(barSubmit(now(), ctx, false));
                focusBox();
              }}
            >
              <CornerDownLeft className="size-[18px]" strokeWidth={2.5} aria-hidden />
              {TYPE_COPY.enter}
            </button>
          </div>
          {/* a bar under 620 px (a phone): the keys in two rows of six, every one in sight, and New
              problem on a row of its own; wider, one row of keys, New problem beside Enter */}
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <div
              role="group"
              aria-label={TYPE_COPY.keys}
              className="grid basis-full grid-cols-6 gap-1.5 @min-[620px]/type:flex @min-[620px]/type:min-w-0 @min-[620px]/type:flex-1 @min-[620px]/type:basis-0 @min-[620px]/type:overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {MATH_KEYS.map((k) => (
                <button
                  key={k.id}
                  type="button"
                  data-type-key={k.id}
                  className="flex h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-slate-100 px-2 text-[18px] font-medium text-slate-800 transition-colors hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 active:bg-slate-300 motion-reduce:transition-none"
                  title={k.name}
                  aria-label={k.name}
                  // the box keeps the focus (and its caret)
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setBar(barMathKey(now(), k));
                    focusBox();
                  }}
                >
                  <KeyFace k={k} />
                </button>
              ))}
            </div>
            <NewProblemButton wide={false} pressed={armed} disabled={Boolean(edit)} onClick={() => run(barNewProblem(now(), ctx))} after={focusBox} />
            <button
              type="button"
              data-type-close=""
              className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 motion-reduce:transition-none"
              title={TYPE_COPY.close}
              aria-label={TYPE_COPY.close}
              onClick={() => setTypeBarOpen(false)}
            >
              <ChevronDown className="size-5" strokeWidth={2.25} aria-hidden />
            </button>
          </div>
        </div>
      </div>
      <p id="type-bar-status" role="status" aria-live="polite" className="sr-only">
        {status}
      </p>
    </>
  );
}

/**
 * New problem: beside Enter on a bar wide enough for it (`wide`), at the end of the keys on a
 * phone's. Pressed while armed (the next line starts a new problem).
 */
function NewProblemButton({ wide, pressed, disabled, onClick, after }: { wide: boolean; pressed: boolean; disabled: boolean; onClick: () => void; after: () => void }) {
  return (
    <button
      type="button"
      data-type-new={wide ? "wide" : "narrow"}
      className={`${wide ? "hidden h-14 @min-[620px]/type:flex" : "flex h-11 flex-1 justify-center @min-[620px]/type:hidden"} shrink-0 cursor-pointer items-center gap-1.5 rounded-[14px] border border-slate-200 bg-white px-3.5 text-[15px] font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 aria-pressed:border-blue-300 aria-pressed:bg-blue-50 aria-pressed:text-blue-700 disabled:cursor-default disabled:opacity-40 motion-reduce:transition-none`}
      title={pressed ? TYPE_COPY.newProblemArmed : TYPE_COPY.newProblemHint}
      aria-pressed={pressed}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        onClick();
        after();
      }}
    >
      <Plus className="size-4" strokeWidth={2.5} aria-hidden />
      {TYPE_COPY.newProblem}
    </button>
  );
}

/** What a key shows: the fraction key draws a fraction; the rest are their symbol. */
function KeyFace({ k }: { k: MathKey }) {
  if (k.id === "frac") {
    return (
      <svg viewBox="0 0 16 24" className="h-6 w-4" aria-hidden fill="none" stroke="currentColor">
        <rect x="3.5" y="1.5" width="9" height="7" rx="1.75" strokeWidth="1.6" />
        <path d="M1.5 12h13" strokeWidth="2" strokeLinecap="round" />
        <rect x="3.5" y="15.5" width="9" height="7" rx="1.75" strokeWidth="1.6" />
      </svg>
    );
  }
  if (k.id === "sq" || k.id === "pow") {
    return (
      <span aria-hidden className="font-serif">
        <span className="italic">x</span>
        <sup className="ml-px text-[12px]">{k.id === "sq" ? "2" : <span className="italic">n</span>}</sup>
      </span>
    );
  }
  return <span aria-hidden>{k.label}</span>;
}

/** The one-time tip on a laptop: what the bar is for. */
function Tip({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div
      role="note"
      data-type-tip=""
      className="type-tip absolute bottom-full left-2 mb-3 flex max-w-[min(420px,calc(100%-16px))] items-center gap-3 rounded-2xl border border-slate-200 bg-white py-2.5 pl-3 pr-2.5 text-[15px] leading-snug text-slate-800 shadow-[0_10px_30px_rgba(15,23,42,0.14),0_2px_6px_rgba(15,23,42,0.06)]"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-700" aria-hidden>
        <Keyboard className="size-5" strokeWidth={2.25} />
      </span>
      <span className="min-w-0">{TYPE_COPY.tip}</span>
      <button
        type="button"
        className="h-9 shrink-0 cursor-pointer rounded-xl bg-slate-900 px-3.5 text-sm font-semibold text-white hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 focus-visible:ring-offset-1"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onDismiss}
      >
        {TYPE_COPY.tipOk}
      </button>
      <span aria-hidden className="absolute -bottom-[7px] left-6 size-3 rotate-45 border-b border-r border-slate-200 bg-white" />
    </div>
  );
}

const CSS = `
@keyframes type-shake-a{0%,100%{transform:translateX(0)}20%{transform:translateX(-5px)}40%{transform:translateX(4px)}60%{transform:translateX(-3px)}80%{transform:translateX(2px)}}
@keyframes type-shake-b{0%,100%{transform:translateX(0)}20%{transform:translateX(-5px)}40%{transform:translateX(4px)}60%{transform:translateX(-3px)}80%{transform:translateX(2px)}}
.type-field[data-shake="a"]{animation:type-shake-a .36s ease-in-out}
.type-field[data-shake="b"]{animation:type-shake-b .36s ease-in-out}
@keyframes type-blink{0%,45%{opacity:.75}55%,100%{opacity:.12}}
.type-caret{animation:type-blink 1.1s ease-in-out infinite}
@keyframes type-tip-in{from{opacity:0;transform:translateY(4px)}}
.type-tip{animation:type-tip-in .2s ease-out}
@media (prefers-reduced-motion:reduce){.type-field[data-shake],.type-tip{animation:none}.type-caret{animation:none;opacity:.6}}
`;

// ---------------------------------------------------------------------------

/** The hand's layout of a line, as the preview draws it (the last one kept: the preview asks twice). */
let lastLayout: { latex: string; layout: MathLayout } | null = null;
function handLayout(latex: string): MathLayout {
  if (lastLayout?.latex !== latex) lastLayout = { latex, layout: layoutMath(latex, { size: PREVIEW_HAND_SIZE, seed: PREVIEW_SEED }) };
  return lastLayout.layout;
}

function readLines(controller: LiveController): TypedLineRef[] {
  try {
    return controller.typedLines?.() ?? [];
  } catch {
    return [];
  }
}

function readSpot(controller: LiveController, newProblem: boolean) {
  try {
    return controller.typedSpot?.(newProblem ? { newProblem: true } : undefined) ?? null;
  } catch {
    return null;
  }
}

/** A line Live read from the pen that is not in the current problem's list: its reading, to type over. */
function penLine(lineId: string): TypedLineRef | null {
  const state = liveStore.lines.get()[lineId];
  if (!state?.line) return null;
  return { lineId, typed: false, typedText: "", latex: state.latex, bounds: state.line.bounds };
}

function toViewport(editor: Pick<Editor, "pageToViewport">, r: Rect): Rect {
  const a = editor.pageToViewport({ x: r.x, y: r.y });
  const b = editor.pageToViewport({ x: r.x + r.w, y: r.y + r.h });
  return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
}

/** The kid's pen colour as the board draws it (light theme: the board is always white). */
function inkHex(color: string): string {
  const theme = getDefaultColorTheme({ isDarkMode: false });
  return theme[color as TLDefaultColorStyle]?.solid ?? theme.black.solid;
}

/** Focus on the board, not in another field, dialog or menu: a maths key typed there goes to the box. */
function onTheBoard(active: Element | null, container: HTMLElement): boolean {
  if (!active || active === document.body || active === document.documentElement) return true;
  if (!container.contains(active)) return false;
  const tag = active.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (active as HTMLElement).isContentEditable) return false;
  return !active.closest('[role="dialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]');
}

function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mql = window.matchMedia?.(query);
      mql?.addEventListener?.("change", cb);
      return () => mql?.removeEventListener?.("change", cb);
    },
    () => window.matchMedia?.(query).matches ?? false,
    () => false,
  );
}

/** px of the board's foot that tldraw's bottom row covers (the tools, or the kid dock, and the screen strip). */
function useFootInset(container: HTMLElement): number {
  const [inset, setInset] = useState(0);
  useLayoutEffect(() => {
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => measure());
    let watched: Element | null = null;
    function measure() {
      const row = container.querySelector(BOTTOM_UI_SELECTOR);
      if (row && row !== watched && ro) {
        watched = row;
        ro.observe(row);
      }
      // the row spans the board; what counts is its tallest part (the toolbar, the dock)
      const box = container.getBoundingClientRect();
      let top = Infinity;
      for (const el of row ? Array.from(row.children) : []) {
        const r = el.getBoundingClientRect();
        if (r.height > 0) top = Math.min(top, r.top);
      }
      setInset(Number.isFinite(top) ? Math.max(0, Math.round(box.bottom - top)) : 0);
    }
    ro?.observe(container);
    measure();
    // the dock and the toolbar are lazy: measure again once they are in
    const t = window.setTimeout(measure, 400);
    return () => {
      ro?.disconnect();
      window.clearTimeout(t);
    };
  }, [container]);
  return inset;
}

/** px an on-screen keyboard covers at the foot of the layout viewport (0 without one). */
function useKeyboardLift(): number {
  const [lift, setLift] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      if (Math.abs(vv.scale - 1) > 0.01) return;
      const hidden = window.innerHeight - (vv.height + vv.offsetTop);
      setLift(hidden > 40 ? Math.round(hidden) : 0);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
  return lift;
}

/** Tells the board how much of its foot the bar covers (`typeBarInset`, `--type-bar-inset`). */
function usePublishInset(container: HTMLElement, bar: React.RefObject<HTMLDivElement | null>, hidden: boolean, bottom: number): void {
  useLayoutEffect(() => {
    const el = bar.current;
    const clear = () => {
      typeBarInset.set(0);
      container.style.removeProperty("--type-bar-inset");
    };
    if (!el || hidden) {
      clear();
      return;
    }
    const publish = () => {
      const card = el.firstElementChild ?? el;
      const inset = Math.max(0, Math.round(container.getBoundingClientRect().bottom - card.getBoundingClientRect().top));
      if (typeBarInset.get() !== inset) typeBarInset.set(inset);
      container.style.setProperty("--type-bar-inset", `${inset}px`);
    };
    publish();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(publish);
    ro?.observe(el);
    ro?.observe(container);
    return () => {
      ro?.disconnect();
      clear();
    };
  }, [container, bar, hidden, bottom]);
}
