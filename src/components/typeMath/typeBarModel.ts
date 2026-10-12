/**
 * The Type it bar's logic (docs/TYPE-MATH.md), pure: the maths keys and what each types at the
 * caret, walking up and down the problem's lines to edit one, what a key in the box does (Enter,
 * Shift+Enter, ↑ ↓, Esc, Cmd/Ctrl+Z), what goes to the writer and what the bar says back, the
 * preview's state, and which keys typed on the board go to the box. No React, no DOM: the bar
 * (`TypeBar.tsx`) only reads the box's caret, calls these and does what they say; they are tested
 * on their own (`__tests__/typeBarModel.test.ts`).
 */

import type { TypedLineRef, TypedParse, WriteTypedArgs, WriteTypedResult } from "@/lib/typeMath/contracts";

/** The box's text and its selection (`start === end`: a caret). */
export interface Field {
  value: string;
  start: number;
  end: number;
}

export type MathKeyId = "frac" | "sq" | "pow" | "sqrt" | "times" | "div" | "pi" | "paren" | "le" | "ge" | "eq";

/** A maths key: what it types at the caret, and what it does round a selection. */
export interface MathKey {
  id: MathKeyId;
  /** what the key shows (the fraction key draws its own picture) */
  label: string;
  /** its name, for a screen reader and the tooltip */
  name: string;
  /** typed at the caret */
  insert: string;
  /** where the caret lands in `insert` (default: after it) */
  caret?: number;
  /** what it makes of a selection (default: the selection is replaced by `insert`) */
  wrap?: (selection: string) => string;
}

/** A selection of more than one character is grouped before a power goes on it: `x+1` → `(x+1)^2`. */
const group = (s: string) => (s.length > 1 && !/^\(.*\)$/.test(s) ? `(${s})` : s);

/**
 * The keys, in the order a kid looks for them. What they type is plain typing the parser reads
 * (`x^2`, `x^(n+1)`, `√(16)`, `20÷4`), with the symbols a kid sees on the key (×, ÷, π, ≤, ≥).
 */
export const MATH_KEYS: readonly MathKey[] = [
  { id: "frac", label: "a/b", name: "Fraction", insert: "/", wrap: (s) => `${group(s)}/` },
  { id: "sq", label: "x²", name: "Squared", insert: "^2", wrap: (s) => `${group(s)}^2` },
  { id: "pow", label: "xⁿ", name: "Power", insert: "^()", caret: 2, wrap: (s) => `${group(s)}^()` },
  { id: "sqrt", label: "√", name: "Square root", insert: "√()", caret: 2, wrap: (s) => `√(${s})` },
  { id: "times", label: "×", name: "Times", insert: "×" },
  { id: "div", label: "÷", name: "Divided by", insert: "÷" },
  { id: "pi", label: "π", name: "Pi", insert: "π" },
  { id: "paren", label: "( )", name: "Brackets", insert: "()", caret: 1, wrap: (s) => `(${s})` },
  { id: "le", label: "≤", name: "Less than or equal to", insert: "≤" },
  { id: "ge", label: "≥", name: "Greater than or equal to", insert: "≥" },
  { id: "eq", label: "=", name: "Equals", insert: "=" },
];

/**
 * Types `key` at the caret: over a selection, the key's `wrap` (a power on it, brackets round it) or
 * the plain text in its place. A wrap that ends in `()` leaves the caret inside the brackets.
 */
export function typeKey(field: Field, key: Pick<MathKey, "insert" | "caret" | "wrap">): Field {
  const start = Math.max(0, Math.min(field.start, field.value.length));
  const end = Math.max(start, Math.min(field.end, field.value.length));
  const before = field.value.slice(0, start);
  const after = field.value.slice(end);
  const selection = field.value.slice(start, end);
  if (selection && key.wrap) {
    const text = key.wrap(selection);
    const caret = start + (text.endsWith("()") ? text.length - 1 : text.length);
    return { value: before + text + after, start: caret, end: caret };
  }
  const caret = start + (key.caret ?? key.insert.length);
  return { value: before + key.insert + after, start: caret, end: caret };
}

/** Plain text typed at the caret (a key pressed on the board, sent to the box). */
export function typeText(field: Field, text: string): Field {
  return typeKey(field, { insert: text });
}

/** Editing a line of the problem: which one, and what the box held before the walk began. */
export interface LineEdit {
  /** its place in `typedLines()`, from 0 at the top */
  index: number;
  line: TypedLineRef;
  /** what the kid had typed before ↑, put back when they walk off the bottom or press Esc */
  draft: string;
}

/** What the box shows for a line: what was typed, or a pen line's reading as plain typing. */
export function boxTextFor(line: TypedLineRef, latexToPlain: (latex: string) => string): string {
  if (line.typed && line.typedText.trim()) return line.typedText;
  return latexToPlain(line.latex);
}

/**
 * ↑: the line above the one being edited, or the problem's last line when not editing yet. Null
 * when there is no line to go to (an empty problem; already at the top it stays put).
 */
export function walkUp(lines: readonly TypedLineRef[], edit: LineEdit | null, draft: string): LineEdit | null {
  if (lines.length === 0) return edit;
  if (!edit) {
    const index = lines.length - 1;
    return { index, line: lines[index], draft };
  }
  const at = lines.findIndex((l) => l.lineId === edit.line.lineId);
  const from = at >= 0 ? at : Math.min(edit.index, lines.length);
  const index = Math.max(0, from - 1);
  return { index, line: lines[index], draft: edit.draft };
}

/** ↓: the line below, or null past the last one (back to what the kid was typing, `edit.draft`). */
export function walkDown(lines: readonly TypedLineRef[], edit: LineEdit): LineEdit | null {
  const at = lines.findIndex((l) => l.lineId === edit.line.lineId);
  const index = (at >= 0 ? at : edit.index) + 1;
  if (index >= lines.length) return null;
  return { index, line: lines[index], draft: edit.draft };
}

/** The ↑ key starts a walk only from an empty box or with the caret at its very start. */
export function caretAtStart(field: Field): boolean {
  return field.value.length === 0 || (field.start === 0 && field.end === 0);
}

/** The bar's words: short, for a 7-year-old. */
export const TYPE_COPY = {
  region: "Type your math",
  box: "Your math",
  placeholder: "Type your math, like 3x + 5 = 20",
  placeholderShort: "Type your math",
  preview: "How it will look on the board",
  keys: "Math keys",
  enter: "Enter",
  enterHint: "Put it on the board (Enter)",
  newProblem: "New problem",
  newProblemHint: "Start a new problem (Shift+Enter)",
  newProblemArmed: "Your next line starts a new problem",
  close: "Hide typing",
  editing: (n: number) => `Line ${n}`,
  editingHint: (n: number) => `Changing line ${n}. Enter puts it back, Esc stops.`,
  pencil: "Change this line",
  tip: "On a laptop? Type your math here — Enter puts it on the board.",
  tipOk: "Got it",
  refused: {
    unwritable: "I can't write that one yet — try it with the pen.",
    off: "Your tutor is switched off on this board.",
    noLine: "That line isn't on the board any more.",
    empty: "Type some math first.",
  },
} as const;

/** What the bar says when the writer refuses a line (none for an empty one: nothing happens). */
export function refusalText(reason: Extract<WriteTypedResult, { ok: false }>["reason"]): string | null {
  return reason === "empty" ? null : TYPE_COPY.refused[reason];
}

/**
 * THE KEYBOARD RULE — what a key typed on the board (nothing focused, or the canvas) does while the
 * bar is open. tldraw binds single letters to its tools (v select, d/b/x pen, e eraser, h hand, a
 * arrow, r/o shapes, z zoom, q, g, l, f, n, k…), `=`/`-` and `shift+=`/`shift+-` to zoom, `[` `]`,
 * Delete/Backspace to delete and Cmd/Ctrl+Z to undo (its hotkeys skip inputs, so none of them fire
 * while the box has focus). So:
 *
 *  - the keys a line of maths starts with — digits, `(`, `-`, `+`, `=`, `.` — focus the box and are
 *    typed into it (the board's `=` / `-` zoom gives way while the bar is open; Cmd/Ctrl with them,
 *    and a pinch, still zoom);
 *  - Enter, with nothing selected (tldraw edits a selected shape on Enter), focuses the box;
 *  - letters stay the board's tool shortcuts: they type only once the box has focus (`3x` works,
 *    since the 3 put the focus there);
 *  - anything with Cmd, Ctrl or Alt is the board's or the browser's (Cmd+Z undoes on the board);
 *  - in the box, Cmd/Ctrl+Z undoes the box's own typing, or on the board when the box is empty, so a
 *    typed line can be undone; Esc gives the focus back to the board.
 */
export const BOARD_KEYS_TO_BOX = /^[0-9(\-+=.]$/;

export function boardKeyGoesToBox(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "isComposing">, nothingSelected: boolean): "type" | "focus" | null {
  if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return null;
  if (BOARD_KEYS_TO_BOX.test(e.key)) return "type";
  if (e.key === "Enter" && nothingSelected) return "focus";
  return null;
}

// ---------------------------------------------------------------------------
// The bar's state machine
// ---------------------------------------------------------------------------

/** Everything the bar remembers between keys. */
export interface BarState {
  /** the box: its text and caret */
  field: Field;
  /** a line of the problem loaded into the box to change, or null for a new line */
  edit: LineEdit | null;
  /** New problem (or Shift+Enter) with an empty box: the next line starts a new problem */
  armed: boolean;
  /** the writer said no (or the hand cannot write it): shown until the kid types again */
  notice: string | null;
  /** bumped to shake the box gently (Enter on a line that cannot go yet) */
  shake: number;
}

export const INITIAL_BAR: BarState = { field: { value: "", start: 0, end: 0 }, edit: null, armed: false, notice: null, shake: 0 };

/** What the bar works with: the parser, the hand, the writer and the problem's lines. */
export interface BarContext {
  parse(text: string): TypedParse;
  latexToPlain(latex: string): string;
  /** the hand can write this LaTeX (`layoutMath` reports nothing unsupported) */
  canWrite(latex: string): boolean;
  /** `controller.writeTyped` */
  write(args: WriteTypedArgs): WriteTypedResult;
  /** `controller.typedLines()`: the current problem's lines, top to bottom */
  lines: readonly TypedLineRef[];
}

/** An analytics event (`clientMetric`): lengths and kinds only, never the maths. */
export interface BarMetric {
  name: "type.write" | "type.edit" | "type.refused";
  fields: Record<string, string | number | boolean>;
}

/** What a step of the bar did: its next state, and what the component must do outside it. */
export interface BarStep {
  state: BarState;
  /** the key was the bar's (the component prevents its default and stops it reaching the board) */
  handled: boolean;
  /** undo or redo on the board (Cmd/Ctrl+Z in an empty box), or give the focus back to it (Esc) */
  outside?: "undo" | "redo" | "board";
  metric?: BarMetric;
  /** a line went on the board (the lines and the caret are read again) */
  wrote?: boolean;
}

/** A key pressed in the box. */
export interface BarKey {
  key: string;
  shift: boolean;
  /** Cmd or Ctrl */
  mod: boolean;
  alt: boolean;
}

const at = (value: string): Field => ({ value, start: value.length, end: value.length });
const pass = (state: BarState): BarStep => ({ state, handled: false });

/** The box's own typing (its change event): the refusal goes once the kid types again. */
export function barTyped(state: BarState, field: Field): BarState {
  return { ...state, field, notice: null };
}

/** A maths key: typed at the caret. */
export function barMathKey(state: BarState, key: Pick<MathKey, "insert" | "caret" | "wrap">): BarState {
  return barTyped(state, typeKey(state.field, key));
}

/** Loads a line into the box to change it (↑, a pencil, a readback double-clicked). */
export function barOpenLine(state: BarState, line: TypedLineRef | null, index: number, latexToPlain: (latex: string) => string): BarState {
  if (!line) return { ...state, notice: TYPE_COPY.refused.noLine };
  const next: LineEdit = { index: Math.max(0, index), line, draft: state.edit ? state.edit.draft : state.field.value };
  return { ...state, edit: next, field: at(boxTextFor(line, latexToPlain)), armed: false, notice: null };
}

/** Stops changing a line: what the kid was typing before comes back. */
export function barLeaveEdit(state: BarState): BarState {
  if (!state.edit) return state;
  return { ...state, edit: null, field: at(state.edit.draft), notice: null };
}

/**
 * Enter (or Shift+Enter, New problem, the Enter button): the line to the writer. Nothing typed:
 * Shift+Enter / New problem arm the next line to start a new problem. A line the parser cannot read
 * yet, or the hand cannot write, shakes the box and never reaches the writer (the hint is already
 * beside the preview). Written: the box clears and is ready for the next step.
 */
export function barSubmit(state: BarState, ctx: BarContext, newProblem: boolean): BarStep {
  const text = state.field.value.trim();
  if (!text) return { state: newProblem && !state.edit ? { ...state, armed: true } : state, handled: true };
  const parse = ctx.parse(text);
  if (!parse.ok) return { state: { ...state, shake: state.shake + 1 }, handled: true, metric: refused("parse", text) };
  if (!ctx.canWrite(parse.latex)) {
    return { state: { ...state, shake: state.shake + 1, notice: TYPE_COPY.refused.unwritable }, handled: true, metric: refused("unwritable", text) };
  }
  const args: WriteTypedArgs = { text, latex: parse.latex };
  if (state.edit) args.replaceLineId = state.edit.line.lineId;
  else if (newProblem || state.armed) args.newProblem = true;
  let result: WriteTypedResult;
  try {
    result = ctx.write(args);
  } catch {
    result = { ok: false, reason: "unwritable" };
  }
  if (result.ok) {
    const metric: BarMetric = state.edit
      ? { name: "type.edit", fields: { len: text.length, typed: state.edit.line.typed } }
      : { name: "type.write", fields: { len: text.length, newProblem: Boolean(args.newProblem) } };
    return { state: { ...INITIAL_BAR, shake: state.shake }, handled: true, metric, wrote: true };
  }
  const words = refusalText(result.reason);
  return {
    state: {
      ...state,
      // the line is gone: what they typed stays, to write as a new line
      edit: result.reason === "noLine" ? null : state.edit,
      notice: words,
      shake: words ? state.shake + 1 : state.shake,
    },
    handled: true,
    metric: refused(result.reason, text),
  };
}

function refused(reason: string, text: string): BarMetric {
  return { name: "type.refused", fields: { reason, len: text.length } };
}

/** The New problem key: writes what is in the box as a new problem, or arms (and disarms) the next line. */
export function barNewProblem(state: BarState, ctx: BarContext): BarStep {
  if (state.edit) return pass(state);
  if (state.field.value.trim()) return barSubmit(state, ctx, true);
  return { state: { ...state, armed: !state.armed }, handled: true };
}

/**
 * A key pressed in the box (`state.field` holds its caret as it is now):
 *
 *  - Enter writes the line (a new problem when armed); Shift+Enter writes it as a new problem.
 *  - ↑ from an empty box or the very start walks up the problem's lines into the box, and every ↑
 *    after it up another line; ↓ walks back down, and past the last one gives back what the kid
 *    was typing (a one-line box has no line for the caret to go to).
 *  - Esc stops changing a line; otherwise it gives the focus back to the board.
 *  - Cmd/Ctrl+Z in an empty box undoes on the board (a typed line goes); Cmd/Ctrl+Shift+Z or
 *    Ctrl+Y redoes. With text in the box they are the box's own.
 *  - Everything else is the box's.
 */
export function barKey(state: BarState, key: BarKey, ctx: BarContext): BarStep {
  switch (key.key) {
    case "Enter":
      if (key.mod || key.alt) return pass(state);
      return barSubmit(state, ctx, key.shift);
    case "Escape":
      return state.edit ? { state: barLeaveEdit(state), handled: true } : { state, handled: true, outside: "board" };
    case "ArrowUp": {
      // starting a walk: only from an empty box or its very start; once walking, every ↑ goes up a line
      if (key.shift || key.mod || (!state.edit && !caretAtStart(state.field))) return pass(state);
      const next = walkUp(ctx.lines, state.edit, state.field.value);
      if (!next) return pass(state);
      if (next.line.lineId === state.edit?.line.lineId) return { state, handled: true };
      return { state: barOpenLine(state, next.line, next.index, ctx.latexToPlain), handled: true };
    }
    case "ArrowDown": {
      if (!state.edit || key.shift || key.mod) return pass(state);
      const next = walkDown(ctx.lines, state.edit);
      return { state: next ? barOpenLine(state, next.line, next.index, ctx.latexToPlain) : barLeaveEdit(state), handled: true };
    }
  }
  const k = key.key.toLowerCase();
  if (key.mod && !key.alt && (k === "z" || k === "y") && state.field.value === "") {
    return { state, handled: true, outside: k === "y" || key.shift ? "redo" : "undo" };
  }
  return pass(state);
}

/** What the preview slot shows. */
export interface BarPreview {
  /** the LaTeX to draw in the hand ("" for nothing) */
  latex: string;
  /** greyed: a line the parser cannot read yet (its best guess), or one the hand cannot write */
  muted: boolean;
  /** beside it: the parser's kind hint, or the writer's refusal */
  message: string | null;
}

/**
 * The preview: the line drawn as Enter will write it (`1/2` a real fraction as it is typed); while
 * the parser cannot read it yet, its best guess greyed with the hint beside it; a refusal in its
 * place until the kid types again.
 */
export function barPreview(state: BarState, ctx: Pick<BarContext, "parse" | "canWrite">): BarPreview {
  const text = state.field.value;
  if (state.notice) return { latex: "", muted: true, message: state.notice };
  if (!text.trim()) return { latex: "", muted: false, message: null };
  let parse: TypedParse;
  try {
    parse = ctx.parse(text);
  } catch {
    parse = { ok: false, hint: "", partial: "" };
  }
  if (!parse.ok) return { latex: parse.partial, muted: true, message: parse.hint || null };
  if (!ctx.canWrite(parse.latex)) return { latex: parse.latex, muted: true, message: TYPE_COPY.refused.unwritable };
  return { latex: parse.latex, muted: false, message: null };
}

// ---------------------------------------------------------------------------
// The one-time tip
// ---------------------------------------------------------------------------

export const TIP_KEY = "agathon.type.tip.v1";

export type TipStorage = Pick<Storage, "getItem" | "setItem">;

/** localStorage, or null where it cannot be had (private mode, a server render). */
export function browserStorage(): TipStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function tipSeen(storage: TipStorage | null): boolean {
  try {
    return storage?.getItem(TIP_KEY) === "1";
  } catch {
    return false;
  }
}

export function markTipSeen(storage: TipStorage | null): void {
  try {
    storage?.setItem(TIP_KEY, "1");
  } catch {
    /* private mode: shown again next visit */
  }
}

/** The tip shows on a laptop, once (until Got it, or the first line written), never during the tour. */
export function shouldShowTip(opts: { typingFirst: boolean; tour: boolean; seen: boolean }): boolean {
  return opts.typingFirst && !opts.tour && !opts.seen;
}
