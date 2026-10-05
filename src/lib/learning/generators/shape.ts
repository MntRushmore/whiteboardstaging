/**
 * The shape of a problem, for "a new problem like this one": LaTeX as read (Mathpix) or as the
 * tutor wrote it, tidied to the chat's conventions, and its SKELETON — the problem with its numbers
 * taken out (`3x + 4 = 19` → `#x+#=#`). Two problems with one skeleton have the same form; only
 * their numbers differ. Numbers that ARE the form stay in the skeleton: 0, a square (`^{2}`), the
 * angle totals 90, 180 and 360, and a trig equation's interval.
 */

/** Binary operators and relations, written with a space each side. */
const BINARY = new Set(["+", "-", "=", "<", ">", "\\le", "\\ge", "\\ne", "\\neq", "\\times", "\\div", "\\cdot", "\\pm", "\\mp", "\\to", "\\rightarrow", "\\approx"]);
/** After these a `-` or `+` is a sign, not an operation. */
const SIGN_AFTER = new Set(["(", "[", "{", "^", "_", ",", "\\ "]);
/** Commands that join straight onto a number before them (`2\sqrt{x}`, `3\pi`, `2\sin x`). */
const JOINS_NUMBER = /^\\(?:sqrt|frac|pi|sin|cos|tan|sec|csc|cot|log|ln|left|cdot)$/;

const TOKEN = /\\[a-zA-Z]+|\\.|\d+(?:\.\d+)?|[a-zA-Z]|\s+|[\s\S]/g;

/** LaTeX in the chat's conventions: `2x+3=11` → `2x + 3 = 11`, `x^2` → `x^{2}`, `\left(` → `(`. */
export function tidy(latex: string): string {
  let s = latex.trim();
  s = s.replace(/\\left\s*([([|])/g, "$1").replace(/\\right\s*([)\]|])/g, "$1");
  s = s.replace(/\\[dt]frac(?![a-zA-Z])/g, "\\frac");
  s = s.replace(/\\leq(?![a-zA-Z])/g, "\\le").replace(/\\geq(?![a-zA-Z])/g, "\\ge");
  s = s.replace(/\\lt(?![a-zA-Z])/g, "<").replace(/\\gt(?![a-zA-Z])/g, ">");
  s = s.replace(/([\^_])\s*([0-9a-zA-Z])/g, "$1{$2}");
  return respace(s);
}

function respace(s: string): string {
  const tokens: { t: string; spaced: boolean }[] = [];
  let spaced = false;
  for (const m of s.matchAll(TOKEN)) {
    const t = m[0];
    if (/^\s+$/.test(t)) {
      spaced = true;
      continue;
    }
    tokens.push({ t, spaced });
    spaced = false;
  }
  let out = "";
  let prev: string | null = null;
  let barOpen = false;
  for (const { t, spaced: hadSpace } of tokens) {
    const sign = (t === "-" || t === "+") && (prev === null || BINARY.has(prev) || SIGN_AFTER.has(prev) || (prev === "|" && barOpen));
    if (sign) {
      if (prev !== null && (BINARY.has(prev) || prev === "," || prev === "\\ ") && !out.endsWith(" ")) out += " ";
      out += t;
    } else if (BINARY.has(t)) {
      out = `${out.trimEnd()} ${t} `;
    } else if (t === ",") {
      out = `${out.trimEnd()}, `;
    } else if (t === "\\ ") {
      out = `${out.trimEnd()} \\ `;
    } else if (t === "\\," || t === "\\;" || t === "\\:" || t === "\\!") {
      out = `${out.trimEnd()} ${t} `;
    } else {
      if (hadSpace && prev !== null && keepsSpace(prev, t) && !out.endsWith(" ")) out += " ";
      if (t === "|") barOpen = !barOpen;
      out += t;
    }
    prev = t;
  }
  return out.replace(/ {2,}/g, " ").trim();
}

/** A space the source had that the chat keeps: `\sin x`, `\log_{2} x`, `\int x`, `5 \mathrm{km}`. */
function keepsSpace(prev: string, t: string): boolean {
  if (/^[([{^_]$/.test(prev) || /^[)\]}{^_]$/.test(t)) return false;
  if (/^\d/.test(prev)) return /^\\/.test(t) && !JOINS_NUMBER.test(t);
  if (/^\\[a-zA-Z]+$/.test(prev)) return true;
  if (prev === "}") return /^[a-zA-Z\\\d(]/.test(t);
  if (prev === ")") return /^[a-zA-Z\\]/.test(t);
  return false;
}

/** Numbers in a tidied line, with what the skeleton keeps. */
const NUMBER = /\d+(?:\.\d+)?/g;

export interface NumberSlot {
  /** which line, and where in it */
  line: number;
  start: number;
  end: number;
  text: string;
  /** part of the form: kept in the skeleton and never changed */
  fixed: boolean;
  /** an exponent on a letter or a bracket (`x^{3}`): changed only when nothing else can be */
  exponent: boolean;
}

/** Where a trig equation's interval starts (`, \ 0 \le x < 2\pi`), else the line's length. */
function intervalStart(line: string): number {
  if (!line.includes(",") || !TRIG_NAME.test(line)) return line.length;
  const m = /,\s*(?:\\\s|\\quad\s*|\\,\s*)?-?\d[^,]*(?:<|\\le)/.exec(line);
  return m && TRIG_NAME.test(line.slice(0, m.index)) ? m.index : line.length;
}

const TRIG_NAME = /\\(?:sin|cos|tan|sec|csc|cot)(?![a-zA-Z])/;

/** The `}` at `at` closes a subscript (`\int_{0}^{2}`: the 2 is a limit, not a power). */
function closesSubscript(line: string, at: number): boolean {
  for (let i = at - 1; i >= 1; i--) {
    if (line[i] === "{") return line[i - 1] === "_";
    if (line[i] === "}") return false;
  }
  return false;
}

const isLetter = (c: string | undefined) => c !== undefined && ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z"));

export function numberSlots(lines: readonly string[]): NumberSlot[] {
  const out: NumberSlot[] = [];
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const tail = intervalStart(line);
    const number = new RegExp(NUMBER.source, "g");
    for (let m = number.exec(line); m; m = number.exec(line)) {
      const start = m.index;
      const text = m[0];
      const end = start + text.length;
      // `^{` or `^{-` right before the number: an exponent, of whatever stands before the `^`
      const brace = line[start - 1] === "-" ? start - 2 : start - 1;
      const inExponent = line[brace] === "{" && line[brace - 1] === "^";
      const base = line[brace - 2];
      const limit = inExponent && base === "}" && closesSubscript(line, brace - 2);
      const square = inExponent && !limit && brace === start - 1 && text === "2" && line[end] === "}";
      const total = text === "90" || text === "180" || text === "360";
      const fixed = start >= tail || text === "0" || square || total;
      const exponent = inExponent && !limit && (isLetter(base) || base === ")" || base === "}");
      out.push({ line: li, start, end, text, fixed, exponent });
    }
  }
  return out;
}

/** The skeleton of one tidied line. */
function skeletonLine(line: string, li: number, slots: readonly NumberSlot[]): string {
  let out = "";
  let at = 0;
  for (const s of slots) {
    if (s.line !== li) continue;
    out += line.slice(at, s.start) + (s.fixed ? s.text : s.text.includes(".") ? "#.#" : "#");
    at = s.end;
  }
  out += line.slice(at);
  return spacingOut(out.replace(/\\(?:sin|cos|tan)(?![a-zA-Z])/g, "\\trig"));
}

/** A line with its spacing taken out: spaces and the spacing commands (`\ `, `\,`, `\quad`). */
export function spacingOut(line: string): string {
  return line.replace(/\\(?:q?quad(?![a-zA-Z])|[ ,;:!])/g, "").replace(/\s+/g, "");
}

/** The problem's form: its tidied lines with the numbers taken out (spacing ignored). */
export function skeletonOf(tidied: readonly string[]): string {
  const slots = numberSlots(tidied);
  return tidied.map((l, i) => skeletonLine(l, i, slots)).join(";");
}

/** The skeleton with plus and minus made one, for a looser match (`3x - 4 = 11` ~ `3x + 4 = 11`). */
export function looseSkeleton(skeleton: string): string {
  return skeleton.replace(/-/g, "+").replace(/(^|[=;(,{<>|])\+/g, "$1");
}

/** The numbers the skeleton took out, in order. */
export function freeNumbers(tidied: readonly string[]): string[] {
  return numberSlots(tidied)
    .filter((s) => !s.fixed)
    .map((s) => s.text);
}
