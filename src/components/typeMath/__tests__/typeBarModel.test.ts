import { describe, expect, it, vi } from "vitest";
import type { TypedLineRef, TypedParse, WriteTypedArgs, WriteTypedResult } from "@/lib/typeMath/contracts";
import {
  INITIAL_BAR,
  MATH_KEYS,
  TIP_KEY,
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
  boxTextFor,
  markTipSeen,
  shouldShowTip,
  tipSeen,
  typeKey,
  walkDown,
  walkUp,
  type BarContext,
  type BarKey,
  type BarState,
  type Field,
} from "../typeBarModel";

/** A small stand-in for the parser branch: `a/b` → `\frac{a}{b}`, `^` → braces, an open bracket is not ready. */
function fakeParse(text: string): TypedParse {
  const t = text.trim();
  if ((t.match(/\(/g) ?? []).length > (t.match(/\)/g) ?? []).length) return { ok: false, hint: "Close the bracket", partial: t.replace(/\(/g, "") };
  if (/=$/.test(t)) return { ok: false, hint: "Something goes after the =", partial: t.slice(0, -1) };
  return { ok: true, latex: t.replace(/(\d+)\/(\d+)/g, "\\frac{$1}{$2}").replace(/\^(\w)/g, "^{$1}") };
}

const line = (n: number, over: Partial<TypedLineRef> = {}): TypedLineRef => ({
  lineId: `l${n}`,
  typed: true,
  typedText: `step ${n}`,
  latex: `s_{${n}}`,
  bounds: { x: 100, y: 100 + n * 60, w: 200, h: 40 },
  ...over,
});

function ctxWith(over: Partial<BarContext> = {}) {
  const write = vi.fn<(args: WriteTypedArgs) => WriteTypedResult>(() => ({ ok: true, lineId: "new", bounds: { x: 0, y: 0, w: 10, h: 10 } }));
  const ctx: BarContext = {
    parse: fakeParse,
    latexToPlain: (latex) => `plain(${latex})`,
    canWrite: (latex) => !latex.includes("\\unsupported"),
    write,
    lines: [],
    ...over,
  };
  return { ctx, write: (over.write as typeof write | undefined) ?? write };
}

const typed = (value: string, caret = value.length): BarState => barTyped(INITIAL_BAR, { value, start: caret, end: caret });
const key = (k: string, mods: Partial<Omit<BarKey, "key">> = {}): BarKey => ({ key: k, shift: false, mod: false, alt: false, ...mods });
const f = (value: string, start = value.length, end = start): Field => ({ value, start, end });

describe("typeKey: the maths keys type at the caret", () => {
  const k = (id: string) => MATH_KEYS.find((m) => m.id === id)!;

  it("has every key the spec asks for, each named for a screen reader", () => {
    expect(MATH_KEYS.map((m) => m.id)).toEqual(["frac", "sq", "pow", "sqrt", "times", "div", "pi", "paren", "le", "ge", "eq"]);
    for (const m of MATH_KEYS) expect(m.name.length).toBeGreaterThan(1);
  });

  it("inserts at the caret, not at the end", () => {
    expect(typeKey(f("3+5", 1), k("times"))).toEqual(f("3×+5", 2));
    expect(typeKey(f("12", 1), k("frac"))).toEqual(f("1/2", 2));
    expect(typeKey(f("x", 1), k("sq"))).toEqual(f("x^2", 3));
  });

  it("√, xⁿ and ( ) leave the caret inside their brackets", () => {
    expect(typeKey(f("", 0), k("sqrt"))).toEqual(f("√()", 2));
    expect(typeKey(f("x", 1), k("pow"))).toEqual(f("x^()", 3));
    expect(typeKey(f("2", 1), k("paren"))).toEqual(f("2()", 2));
  });

  it("round a selection: brackets wrap it, a power and a fraction go on it (grouped when it is more than one character)", () => {
    expect(typeKey(f("2x+1", 0, 4), k("paren"))).toEqual(f("(2x+1)", 6));
    expect(typeKey(f("x+1", 0, 3), k("sq"))).toEqual(f("(x+1)^2", 7));
    expect(typeKey(f("x", 0, 1), k("sq"))).toEqual(f("x^2", 3));
    expect(typeKey(f("16", 0, 2), k("sqrt"))).toEqual(f("√(16)", 5));
    expect(typeKey(f("a+b", 0, 3), k("pow"))).toEqual(f("(a+b)^()", 7));
    expect(typeKey(f("3", 0, 1), k("frac"))).toEqual(f("3/", 2));
  });

  it("a key with nothing to wrap replaces the selection", () => {
    expect(typeKey(f("3+4", 1, 2), k("times"))).toEqual(f("3×4", 2));
  });

  it("barMathKey types into the bar and clears a refusal", () => {
    const s = barMathKey({ ...typed("3"), notice: "no" }, k("eq"));
    expect(s.field).toEqual(f("3="));
    expect(s.notice).toBeNull();
  });
});

describe("barPreview: what the kid sees while they type", () => {
  const { ctx } = ctxWith();

  it("nothing for an empty box", () => {
    expect(barPreview(INITIAL_BAR, ctx)).toEqual({ latex: "", muted: false, message: null });
  });

  it("the line as LaTeX for the hand, so 1/2 is a real fraction while they type", () => {
    expect(barPreview(typed("1/2+3/4"), ctx)).toEqual({ latex: "\\frac{1}{2}+\\frac{3}{4}", muted: false, message: null });
  });

  it("ok:false: the parser's best guess greyed, with its kind hint beside it", () => {
    expect(barPreview(typed("3(x+1"), ctx)).toEqual({ latex: "3x+1", muted: true, message: "Close the bracket" });
  });

  it("a line the hand cannot write: greyed, and says so before Enter", () => {
    const p = barPreview(typed("\\unsupported"), ctx);
    expect(p).toMatchObject({ muted: true, message: TYPE_COPY.refused.unwritable });
  });

  it("a refusal shows in its place until they type again", () => {
    const s = { ...typed("x"), notice: TYPE_COPY.refused.off };
    expect(barPreview(s, ctx)).toEqual({ latex: "", muted: true, message: TYPE_COPY.refused.off });
    expect(barPreview(barTyped(s, f("x2")), ctx).message).toBeNull();
  });

  it("a parser that throws is a line not ready yet, never a crash", () => {
    const p = barPreview(typed("x"), { ...ctx, parse: () => { throw new Error("boom"); } });
    expect(p).toEqual({ latex: "", muted: true, message: null });
  });
});

describe("Enter: barKey / barSubmit", () => {
  it("Enter writes the text and its LaTeX, then clears the box", () => {
    const { ctx, write } = ctxWith();
    const step = barKey(typed("  1/2 + x  "), key("Enter"), ctx);
    expect(write).toHaveBeenCalledWith({ text: "1/2 + x", latex: "\\frac{1}{2} + x" });
    expect(step).toMatchObject({ handled: true, wrote: true, metric: { name: "type.write", fields: { len: 7, newProblem: false } } });
    expect(step.state.field.value).toBe("");
    expect(step.state.edit).toBeNull();
  });

  it("Shift+Enter writes it as a new problem", () => {
    const { ctx, write } = ctxWith();
    barKey(typed("2x=8"), key("Enter", { shift: true }), ctx);
    expect(write).toHaveBeenCalledWith({ text: "2x=8", latex: "2x=8", newProblem: true });
  });

  it("Shift+Enter (or New problem) in an empty box arms the next line, which then starts a new problem", () => {
    const { ctx, write } = ctxWith();
    const armed = barKey(INITIAL_BAR, key("Enter", { shift: true }), ctx).state;
    expect(armed.armed).toBe(true);
    expect(write).not.toHaveBeenCalled();
    const step = barKey(barTyped(armed, f("5+5")), key("Enter"), ctx);
    expect(write).toHaveBeenCalledWith({ text: "5+5", latex: "5+5", newProblem: true });
    expect(step.state.armed).toBe(false);
    // New problem toggles while the box is empty, and writes what is in it otherwise
    expect(barNewProblem(INITIAL_BAR, ctx).state.armed).toBe(true);
    expect(barNewProblem({ ...INITIAL_BAR, armed: true }, ctx).state.armed).toBe(false);
    barNewProblem(typed("7"), ctx);
    expect(write).toHaveBeenLastCalledWith({ text: "7", latex: "7", newProblem: true });
  });

  it("Enter on an empty box does nothing", () => {
    const { ctx, write } = ctxWith();
    const step = barKey(typed("   "), key("Enter"), ctx);
    expect(write).not.toHaveBeenCalled();
    expect(step.state.armed).toBe(false);
  });

  it("ok:false: no write, the box shakes gently, counted as refused (no maths in the metric)", () => {
    const { ctx, write } = ctxWith();
    const step = barKey(typed("3x+5="), key("Enter"), ctx);
    expect(write).not.toHaveBeenCalled();
    expect(step.state.shake).toBe(1);
    expect(step.state.field.value).toBe("3x+5=");
    expect(step.metric).toEqual({ name: "type.refused", fields: { reason: "parse", len: 5 } });
    expect(JSON.stringify(step.metric)).not.toContain("3x");
  });

  it("a line the hand cannot write never reaches the writer", () => {
    const { ctx, write } = ctxWith();
    const step = barSubmit(typed("\\unsupported"), ctx, false);
    expect(write).not.toHaveBeenCalled();
    expect(step.state.notice).toBe(TYPE_COPY.refused.unwritable);
  });

  it("the writer's refusals each get a short kind line; the text stays", () => {
    for (const reason of ["unwritable", "off", "noLine"] as const) {
      const { ctx } = ctxWith({ write: vi.fn(() => ({ ok: false as const, reason })) });
      const step = barSubmit(typed("x+1"), ctx, false);
      expect(step.state.notice).toBe(TYPE_COPY.refused[reason]);
      expect(step.state.field.value).toBe("x+1");
      expect(step.metric).toEqual({ name: "type.refused", fields: { reason, len: 3 } });
    }
    const { ctx } = ctxWith({ write: vi.fn(() => ({ ok: false as const, reason: "empty" as const })) });
    expect(barSubmit(typed("x"), ctx, false).state.notice).toBeNull();
  });

  it("a writer that throws is a refusal, never a crash", () => {
    const { ctx } = ctxWith({ write: vi.fn(() => { throw new Error("boom"); }) });
    expect(barSubmit(typed("x"), ctx, false).state.notice).toBe(TYPE_COPY.refused.unwritable);
  });

  it("Cmd/Ctrl+Enter is not the bar's", () => {
    const { ctx, write } = ctxWith();
    expect(barKey(typed("x"), key("Enter", { mod: true }), ctx).handled).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });
});

describe("editing a line: ↑ ↓ Esc, and Enter replaces it", () => {
  const lines = [line(1), line(2, { typed: false, typedText: "", latex: "\\frac{1}{2}" }), line(3)];

  it("↑ in an empty box loads the problem's last line; ↑ again the one above; Enter replaces it", () => {
    const { ctx, write } = ctxWith({ lines });
    let s = barKey(INITIAL_BAR, key("ArrowUp"), ctx).state;
    expect(s.edit).toMatchObject({ index: 2, line: { lineId: "l3" } });
    expect(s.field.value).toBe("step 3");
    // walking: ↑ goes up a line wherever the caret is
    s = barKey(s, key("ArrowUp"), ctx).state;
    expect(s.edit?.line.lineId).toBe("l2");
    // a pen line: its reading, as plain typing
    expect(s.field.value).toBe("plain(\\frac{1}{2})");
    const step = barKey(barTyped(s, f("1/3")), key("Enter"), ctx);
    expect(write).toHaveBeenCalledWith({ text: "1/3", latex: "\\frac{1}{3}", replaceLineId: "l2" });
    expect(step.metric).toEqual({ name: "type.edit", fields: { len: 3, typed: false } });
    expect(step.state.edit).toBeNull();
    expect(step.state.field.value).toBe("");
  });

  it("↑ only from an empty box or the very start of it (else it is the caret's own move)", () => {
    const { ctx } = ctxWith({ lines });
    expect(barKey(typed("2x", 1), key("ArrowUp"), ctx).handled).toBe(false);
    expect(barKey(typed("2x", 0), key("ArrowUp"), ctx).state.edit?.line.lineId).toBe("l3");
    expect(barKey(INITIAL_BAR, key("ArrowUp", { shift: true }), ctx).handled).toBe(false);
  });

  it("↑ with no lines leaves the caret alone", () => {
    const { ctx } = ctxWith({ lines: [] });
    expect(barKey(INITIAL_BAR, key("ArrowUp"), ctx).handled).toBe(false);
  });

  it("↑ at the top stays on the top line", () => {
    const { ctx } = ctxWith({ lines });
    const top = barOpenLine(INITIAL_BAR, lines[0], 0, ctx.latexToPlain);
    const step = barKey(barTyped(top, f(top.field.value, 0)), key("ArrowUp"), ctx);
    expect(step.handled).toBe(true);
    expect(step.state.edit?.line.lineId).toBe("l1");
  });

  it("↓ at the end walks back down, and past the last line gives back what they were typing", () => {
    const { ctx } = ctxWith({ lines });
    let s = barKey(typed("half typed", 0), key("ArrowUp"), ctx).state;
    s = barKey(barTyped(s, f(s.field.value, 0)), key("ArrowUp"), ctx).state;
    expect(s.edit?.line.lineId).toBe("l2");
    s = barKey(s, key("ArrowDown"), ctx).state;
    expect(s.edit?.line.lineId).toBe("l3");
    s = barKey(s, key("ArrowDown"), ctx).state;
    expect(s.edit).toBeNull();
    expect(s.field.value).toBe("half typed");
    // not editing: ↓ is the caret's
    expect(barKey(s, key("ArrowDown"), ctx).handled).toBe(false);
  });

  it("Esc stops editing (the draft comes back); not editing, it gives the focus back to the board", () => {
    const { ctx } = ctxWith({ lines });
    const s = barKey(typed("draft", 0), key("ArrowUp"), ctx).state;
    const out = barKey(s, key("Escape"), ctx);
    expect(out.state.edit).toBeNull();
    expect(out.state.field.value).toBe("draft");
    expect(out.outside).toBeUndefined();
    expect(barKey(typed("x"), key("Escape"), ctx)).toMatchObject({ handled: true, outside: "board" });
  });

  it("a line opened from a pencil or a readback; a line that is gone says so", () => {
    const { ctx } = ctxWith();
    const s = barOpenLine(typed("mine"), line(4, { typedText: "4x = 12" }), 3, ctx.latexToPlain);
    expect(s.edit).toMatchObject({ index: 3, draft: "mine" });
    expect(s.field).toEqual(f("4x = 12"));
    expect(barOpenLine(INITIAL_BAR, null, -1, ctx.latexToPlain).notice).toBe(TYPE_COPY.refused.noLine);
    expect(barLeaveEdit(s).field.value).toBe("mine");
  });

  it("the writer saying the line is gone ends the edit and keeps the text, to write as a new line", () => {
    const { ctx } = ctxWith({ lines, write: vi.fn(() => ({ ok: false as const, reason: "noLine" as const })) });
    const s = barOpenLine(INITIAL_BAR, lines[0], 0, ctx.latexToPlain);
    const step = barSubmit(s, ctx, false);
    expect(step.state.edit).toBeNull();
    expect(step.state.field.value).toBe("step 1");
  });

  it("New problem is off while a line is being changed", () => {
    const { ctx, write } = ctxWith({ lines });
    const s = barOpenLine(INITIAL_BAR, lines[0], 0, ctx.latexToPlain);
    expect(barNewProblem(s, ctx).handled).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });

  it("walkUp/walkDown follow the line by id when the list changed under the edit", () => {
    const edit = { index: 2, line: lines[2], draft: "" };
    expect(walkUp([lines[2], lines[0]], edit, "")?.line.lineId).toBe("l3");
    expect(walkDown(lines, { ...edit, index: 0, line: lines[0] })?.line.lineId).toBe("l2");
  });

  it("boxTextFor: what was typed, else the reading as plain typing", () => {
    expect(boxTextFor(line(1), (l) => `p:${l}`)).toBe("step 1");
    expect(boxTextFor(line(1, { typedText: " " }), (l) => `p:${l}`)).toBe("p:s_{1}");
  });
});

describe("undo in the box", () => {
  it("Cmd/Ctrl+Z in an empty box undoes on the board; Shift or Ctrl+Y redoes", () => {
    const { ctx } = ctxWith();
    expect(barKey(INITIAL_BAR, key("z", { mod: true }), ctx)).toMatchObject({ handled: true, outside: "undo" });
    expect(barKey(INITIAL_BAR, key("Z", { mod: true, shift: true }), ctx)).toMatchObject({ handled: true, outside: "redo" });
    expect(barKey(INITIAL_BAR, key("y", { mod: true }), ctx)).toMatchObject({ handled: true, outside: "redo" });
  });

  it("with text in the box, it is the box's own undo", () => {
    const { ctx } = ctxWith();
    expect(barKey(typed("3x"), key("z", { mod: true }), ctx).handled).toBe(false);
    expect(barKey(INITIAL_BAR, key("z"), ctx).handled).toBe(false);
  });
});

describe("the keyboard rule: keys typed on the board", () => {
  const ev = (k: string, mods: Partial<KeyboardEvent> = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, isComposing: false, ...mods });

  it("digits ( - + = . go to the box and are typed", () => {
    for (const k of ["0", "7", "(", "-", "+", "=", "."]) expect(boardKeyGoesToBox(ev(k), true)).toBe("type");
  });

  it("letters stay tldraw's tool shortcuts (d, e, v, x…), as do Delete, Backspace and brackets", () => {
    for (const k of ["d", "e", "v", "x", "a", "Delete", "Backspace", "[", "]", " ", "Tab"]) expect(boardKeyGoesToBox(ev(k), true)).toBeNull();
  });

  it("anything with Cmd, Ctrl or Alt is the board's (Cmd+Z undoes there; Cmd+= zooms)", () => {
    expect(boardKeyGoesToBox(ev("z", { metaKey: true }), true)).toBeNull();
    expect(boardKeyGoesToBox(ev("=", { ctrlKey: true }), true)).toBeNull();
    expect(boardKeyGoesToBox(ev("3", { altKey: true }), true)).toBeNull();
    expect(boardKeyGoesToBox(ev("3", { isComposing: true }), true)).toBeNull();
  });

  it("Enter focuses the box, unless a shape is selected (tldraw edits it)", () => {
    expect(boardKeyGoesToBox(ev("Enter"), true)).toBe("focus");
    expect(boardKeyGoesToBox(ev("Enter"), false)).toBeNull();
  });
});

describe("the one-time tip", () => {
  const memory = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
  };

  it("on a laptop, until seen; never on a touch device or during the tour", () => {
    expect(shouldShowTip({ typingFirst: true, tour: false, seen: false })).toBe(true);
    expect(shouldShowTip({ typingFirst: false, tour: false, seen: false })).toBe(false);
    expect(shouldShowTip({ typingFirst: true, tour: true, seen: false })).toBe(false);
    expect(shouldShowTip({ typingFirst: true, tour: false, seen: true })).toBe(false);
  });

  it("shows once: remembered in storage", () => {
    const s = memory();
    expect(tipSeen(s)).toBe(false);
    markTipSeen(s);
    expect(s.m.get(TIP_KEY)).toBe("1");
    expect(tipSeen(s)).toBe(true);
  });

  it("storage that throws (private mode) or is missing never breaks the bar", () => {
    const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
    expect(tipSeen(broken)).toBe(false);
    expect(() => markTipSeen(broken)).not.toThrow();
    expect(tipSeen(null)).toBe(false);
  });
});
