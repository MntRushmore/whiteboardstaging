/**
 * LaTeX -> hand-drawn math.
 *
 * `layoutMath()` parses the subset of LaTeX the deterministic Live engine emits
 * (`src/lib/live/engine/**`) and lays it out with real typographic structure —
 * fractions on an axis, scripts, radicals, growing fences — then stamps every atom
 * with a glyph from the teacher-hand atlas and returns tremored polylines.
 *
 * This module is a *renderer*. It never computes, simplifies or corrects maths, and
 * it never calls anything. Anything it cannot draw is reported in `unsupported` so the
 * caller can fall back to the typeset KaTeX shape instead of showing the student
 * something that is silently wrong.
 *
 * Coordinates: layout runs on the atlas em box (10 wide x 14 tall, baseline 11), then
 * scales by `size / 14` into px. The returned strokes are in a top-left origin box of
 * exactly `width` x `height`, with the writing line at `y = baseline`.
 */

import { ATLAS, EM_BASELINE, EM_HEIGHT, EM_WIDTH, hasGlyph, type Glyph } from "./atlas";
import { NOTE_HAND_SIZE, pickGlyph, type GlyphPick } from "./compose";
import { mulberry32, samplePath, withTremor, type InkPt, type Pt } from "./path";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** What a stroke is for. Lets a caller style or animate parts differently. */
export type StrokeKind = "glyph" | "rule" | "radical" | "delimiter" | "box";

/** One pen-down..pen-up polyline in layout coordinates, with a pressure hint in `z`. */
export type Stroke = {
  points: InkPt[];
  /** Drawing order, ascending. Also the index of the stroke in `strokes`. */
  order: number;
  kind: StrokeKind;
};

/** A laid-out LaTeX expression, ready to be placed on a canvas. */
export type MathLayout = {
  strokes: Stroke[];
  /** Bounding box width in px. Every point satisfies 0 <= x <= width. */
  width: number;
  /** Bounding box height in px. Every point satisfies 0 <= y <= height. */
  height: number;
  /** Distance from the top of the box down to the writing line. */
  baseline: number;
  /** LaTeX constructs that could not be drawn. Non-empty => fall back to KaTeX. */
  unsupported: string[];
};

export type MathLayoutOptions = {
  /** Cap height of the hand in px; the atlas em box is 14 tall. Default 22. */
  size?: number;
  /** Seed for glyph alternates and pen tremor. Same seed => identical strokes. */
  seed?: number;
};

// ---------------------------------------------------------------------------
// Metrics (all in em-box units unless stated; 1 em of spacing = EM_WIDTH = 10)
// ---------------------------------------------------------------------------

const MU = EM_WIDTH / 18;
const THIN_SPACE = 3 * MU;
const MED_SPACE = 4 * MU;
const THICK_SPACE = 5 * MU;

/** Height of the math axis above the baseline — where `=` and fraction bars sit. */
const AXIS = 2.5;
/**
 * Base gaps are small because the atlas advances already carry generous side
 * bearings (~2.2 left, ~0.4 right). What must read clearly is the *difference*
 * between "letters in a row" and "an operator": hence thin base gaps and full
 * TeX medium/thick spaces around binary operators and relations.
 */
const ORD_GAP = 0.2;
const DIGIT_GAP = 0;
const DIGIT_ORD_GAP = 0.1;
const TEXT_GAP = 0;
const TIGHT_GAP = 0;

const FRAC_CHILD_SCALE = 0.86;
const FRAC_BAR_PAD = 0.9;
const FRAC_NUM_GAP = 0.9;
const FRAC_DEN_GAP = 1.1;

const SCRIPT_SCALE = 0.7;
const MIN_SCALE = 0.42;
const SUP_SHIFT = 4.2;
const SUB_SHIFT = 2.4;
const SCRIPT_GAP = 0.3;
const SCRIPT_CLEARANCE = 0.8;

const RADICAL_PAD_TOP = 1.0;
const RADICAL_PAD_BOTTOM = 0.4;
const RADICAL_PAD_LEFT = 0.5;
const RADICAL_PAD_RIGHT = 0.9;
const RADICAL_MIN_HEIGHT = 8;
/** x of the radical apex in the atlas glyph — where the vinculum starts. */
const RADICAL_APEX_X = 5.2;

const FENCE_PAD = 0.5;
const BOX_PAD_X = 1.7;
const BOX_PAD_Y = 1.3;

const GLYPH_JITTER = 0.16;
const TREMOR = 0.42;

// ---------------------------------------------------------------------------
// Synthesised symbols — glyphs the hand atlas does not carry, drawn on the same
// 10x14 em box so they sit in the same hand. The atlas itself stays untouched.
// ---------------------------------------------------------------------------

function s(advance: number, ...paths: string[]): Glyph {
  return { advance, paths };
}

const SYNTH: Record<string, Glyph> = {
  "±": s(6.6, "M 1.0 7.0 L 5.4 6.9 M 3.2 4.6 L 3.2 9.2", "M 1.0 10.8 L 5.6 10.7"),
  "∓": s(6.6, "M 1.0 9.6 L 5.4 9.5 M 3.2 7.2 L 3.2 11.8", "M 1.0 5.8 L 5.6 5.7"),
  "<": s(7.0, "M 6.2 5.8 L 1.2 8.5 L 6.2 11.0"),
  ">": s(7.0, "M 1.4 5.8 L 6.4 8.5 L 1.4 11.0"),
  "≤": s(7.2, "M 6.2 5.0 L 1.2 7.5 L 6.2 9.8", "M 1.3 11.4 L 6.2 11.3"),
  "≥": s(7.2, "M 1.4 5.0 L 6.4 7.5 L 1.4 9.8", "M 1.3 11.4 L 6.2 11.3"),
  "≠": s(6.6, "M 1.0 7.4 L 5.6 7.3 M 1.0 9.6 L 5.6 9.5", "M 4.8 5.6 L 1.8 11.4"),
  "≈": s(7.2, "M 1.0 7.4 C 1.9 6.5 2.5 8.3 3.4 7.4 C 4.3 6.5 4.9 8.3 5.8 7.4", "M 1.0 9.8 C 1.9 8.9 2.5 10.7 3.4 9.8 C 4.3 8.9 4.9 10.7 5.8 9.8"),
  "·": s(3.6, "M 1.5 8.2 L 1.8 8.7"),
  "∞": s(9.2, "M 4.4 8.5 C 3.2 6.6 1.0 7.2 1.2 8.7 C 1.4 10.3 3.3 10.5 4.5 8.6 C 5.7 6.7 7.6 7.1 7.9 8.6 C 8.2 10.2 6.0 10.6 4.4 8.5"),
  "°": s(4.4, "M 2.2 3.0 C 3.6 3.0 3.6 5.2 2.2 5.2 C 0.9 5.2 0.9 3.0 2.2 3.0"),
  "%": s(8.6, "M 6.8 3.0 L 1.6 11.2", "M 2.3 3.4 C 3.5 3.4 3.5 5.4 2.3 5.4 C 1.1 5.4 1.1 3.4 2.3 3.4", "M 6.4 8.8 C 7.6 8.8 7.6 10.8 6.4 10.8 C 5.2 10.8 5.2 8.8 6.4 8.8"),
  "|": s(3.6, "M 1.8 2.6 L 1.9 11.4"),
  "{": s(4.8, "M 3.8 2.6 C 2.1 2.9 3.0 6.2 1.0 7.0 C 3.0 7.8 2.1 11.1 3.8 11.4"),
  "}": s(4.8, "M 1.0 2.6 C 2.7 2.9 1.8 6.2 3.8 7.0 C 1.8 7.8 2.7 11.1 1.0 11.4"),
};

// ---------------------------------------------------------------------------
// Atom classes and spacing
// ---------------------------------------------------------------------------

type AtomClass = "ord" | "digit" | "bin" | "rel" | "open" | "close" | "punct" | "text" | "space";

const CHAR_CLASS: Record<string, AtomClass> = {
  "+": "bin",
  "-": "bin",
  "−": "bin",
  "–": "bin",
  "*": "bin",
  "×": "bin",
  "÷": "bin",
  "·": "bin",
  "±": "bin",
  "∓": "bin",
  "=": "rel",
  "<": "rel",
  ">": "rel",
  "≤": "rel",
  "≥": "rel",
  "≠": "rel",
  "≈": "rel",
  "→": "rel",
  "←": "rel",
  "(": "open",
  "[": "open",
  "{": "open",
  ")": "close",
  "]": "close",
  "}": "close",
  ",": "punct",
  ";": "punct",
};

function classOf(ch: string): AtomClass {
  const known = CHAR_CLASS[ch];
  if (known) return known;
  if (ch >= "0" && ch <= "9") return "digit";
  if (ch === ".") return "digit";
  return "ord";
}

function gapBetween(a: AtomClass, b: AtomClass, upright: boolean): number {
  if (a === "space" || b === "space") return 0;
  if (upright) return TEXT_GAP;
  if (a === "open" || b === "close") return TIGHT_GAP;
  if (a === "rel" || b === "rel") return THICK_SPACE;
  if (a === "bin" || b === "bin") return MED_SPACE;
  if (a === "punct") return THIN_SPACE;
  if (b === "punct") return 0.15;
  if (a === "digit" && b === "digit") return DIGIT_GAP;
  if (a === "digit" && b === "ord") return DIGIT_ORD_GAP;
  return ORD_GAP;
}

/** A binary operator with nothing to its left is a sign, not an operation. */
function isUnaryContext(prev: AtomClass | null): boolean {
  return prev === null || prev === "bin" || prev === "rel" || prev === "open" || prev === "punct";
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type Token =
  | { t: "char"; v: string }
  | { t: "cmd"; v: string }
  | { t: "open" }
  | { t: "close" }
  | { t: "sup" }
  | { t: "sub" }
  | { t: "ws" };

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "\\") {
      const m = /^[a-zA-Z]+/.exec(src.slice(i + 1));
      if (m) {
        out.push({ t: "cmd", v: m[0] });
        i += 1 + m[0].length;
        continue;
      }
      const next = src[i + 1];
      if (next === undefined) {
        i += 1;
        continue;
      }
      out.push({ t: "cmd", v: next });
      i += 2;
      continue;
    }
    if (c === "{") {
      out.push({ t: "open" });
      i += 1;
      continue;
    }
    if (c === "}") {
      out.push({ t: "close" });
      i += 1;
      continue;
    }
    if (c === "^") {
      out.push({ t: "sup" });
      i += 1;
      continue;
    }
    if (c === "_") {
      out.push({ t: "sub" });
      i += 1;
      continue;
    }
    if (c === "$") {
      i += 1;
      continue;
    }
    if (/\s/.test(c)) {
      while (i < src.length && /\s/.test(src[i])) i += 1;
      out.push({ t: "ws" });
      continue;
    }
    out.push({ t: "char", v: c });
    i += 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

type Node =
  | { k: "glyph"; ch: string; cls: AtomClass }
  | { k: "space"; w: number }
  | { k: "frac"; num: Node[]; den: Node[] }
  | { k: "sqrt"; rad: Node[]; index: Node[] | null }
  | { k: "script"; base: Node | null; sup: Node[] | null; sub: Node[] | null }
  | { k: "fence"; open: string; close: string; body: Node[] }
  | { k: "boxed"; body: Node[] }
  | { k: "upright"; body: string }
  | { k: "group"; body: Node[] };

type Ctx = { toks: Token[]; i: number; end: number; note: (what: string) => void };

/** Commands that map straight onto one drawn symbol. */
const SYMBOL_CMD: Record<string, string> = {
  cdot: "·",
  cdotp: "·",
  bullet: "·",
  times: "×",
  div: "÷",
  pm: "±",
  mp: "∓",
  le: "≤",
  leq: "≤",
  leqslant: "≤",
  ge: "≥",
  geq: "≥",
  geqslant: "≥",
  lt: "<",
  gt: ">",
  ne: "≠",
  neq: "≠",
  approx: "≈",
  simeq: "≈",
  rightarrow: "→",
  Rightarrow: "→",
  to: "→",
  longrightarrow: "→",
  implies: "→",
  leftarrow: "←",
  Leftarrow: "←",
  gets: "←",
  uparrow: "↑",
  downarrow: "↓",
  pi: "π",
  theta: "θ",
  Delta: "Δ",
  infty: "∞",
  circ: "°",
  degree: "°",
  int: "∫",
  vert: "|",
  lvert: "|",
  rvert: "|",
  mid: "|",
};

/** Escaped literals: `\%`, `\{`, `\}`, … */
const ESCAPED_CMD: Record<string, string> = {
  "%": "%",
  "{": "{",
  "}": "}",
  "|": "|",
};

const SPACE_CMD: Record<string, number> = {
  ",": THIN_SPACE,
  ":": MED_SPACE,
  ";": THICK_SPACE,
  "!": -THIN_SPACE,
  " ": 6 * MU,
  thinspace: THIN_SPACE,
  medspace: MED_SPACE,
  thickspace: THICK_SPACE,
  negthinspace: -THIN_SPACE,
  quad: EM_WIDTH,
  qquad: 2 * EM_WIDTH,
  enspace: EM_WIDTH / 2,
};

const IGNORED_CMD = new Set([
  "displaystyle",
  "textstyle",
  "scriptstyle",
  "scriptscriptstyle",
  "limits",
  "nolimits",
  "mathord",
  "mathrel",
  "mathbin",
  "mathopen",
  "mathclose",
]);

const UPRIGHT_CMD = new Set(["text", "mathrm", "textrm", "rm", "mathbf", "textbf", "mathit", "textit", "mathsf", "operatorname", "mathtt"]);

const FUNCTION_CMD = new Set([
  "sin",
  "cos",
  "tan",
  "sec",
  "csc",
  "cot",
  "arcsin",
  "arccos",
  "arctan",
  "sinh",
  "cosh",
  "tanh",
  "log",
  "ln",
  "exp",
  "min",
  "max",
  "det",
  "gcd",
  "lcm",
  "deg",
  "mod",
]);

const GROWING_DELIMS = new Set(["(", ")", "[", "]", "{", "}", "|"]);

function matchClose(toks: Token[], start: number, end: number): number {
  let depth = 0;
  for (let i = start; i < end; i++) {
    const t = toks[i];
    if (t.t === "open") depth += 1;
    else if (t.t === "close") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function matchCloseChar(toks: Token[], start: number, end: number, openCh: string, closeCh: string): number {
  let depth = 0;
  let i = start;
  while (i < end) {
    const t = toks[i];
    if (t.t === "open") {
      const m = matchClose(toks, i, end);
      if (m < 0) return -1;
      i = m + 1;
      continue;
    }
    if (t.t === "char") {
      if (t.v === openCh) depth += 1;
      else if (t.v === closeCh) {
        depth -= 1;
        if (depth === 0) return i;
      }
    }
    i += 1;
  }
  return -1;
}

function matchRight(toks: Token[], start: number, end: number): number {
  let depth = 0;
  for (let i = start; i < end; i++) {
    const t = toks[i];
    if (t.t !== "cmd") continue;
    if (t.v === "left") depth += 1;
    else if (t.v === "right") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function subParse(ctx: Ctx, from: number, to: number): Node[] {
  const savedI = ctx.i;
  const savedEnd = ctx.end;
  ctx.i = from;
  ctx.end = to;
  const nodes = parseSeq(ctx);
  ctx.i = savedI;
  ctx.end = savedEnd;
  return nodes;
}

/** Reconstruct the literal text of a braced group (for `\text{…}` / `\mathrm{…}`). */
function rawText(ctx: Ctx, from: number, to: number): string {
  let out = "";
  for (let i = from; i < to; i++) {
    const t = ctx.toks[i];
    if (t.t === "char") out += t.v;
    else if (t.t === "ws") out += " ";
    else if (t.t === "cmd") {
      if (t.v in SPACE_CMD || t.v === " ") out += " ";
      else if (t.v in ESCAPED_CMD) out += ESCAPED_CMD[t.v];
      else if (SYMBOL_CMD[t.v]) out += SYMBOL_CMD[t.v];
      else ctx.note(`\\${t.v}`);
    } else if (t.t === "sup" || t.t === "sub") {
      out += t.t === "sup" ? "^" : "_";
    }
  }
  return out;
}

/** Read one argument: a braced group, or the single token that follows. */
function parseArg(ctx: Ctx): Node[] {
  while (ctx.i < ctx.end && ctx.toks[ctx.i].t === "ws") ctx.i += 1;
  if (ctx.i >= ctx.end) return [];
  const t = ctx.toks[ctx.i];
  if (t.t === "open") {
    const m = matchClose(ctx.toks, ctx.i, ctx.end);
    if (m < 0) {
      const nodes = subParse(ctx, ctx.i + 1, ctx.end);
      ctx.i = ctx.end;
      return nodes;
    }
    const nodes = subParse(ctx, ctx.i + 1, m);
    ctx.i = m + 1;
    return nodes;
  }
  if (t.t === "char") {
    ctx.i += 1;
    return [glyphNode(t.v, ctx)];
  }
  if (t.t === "cmd") {
    ctx.i += 1;
    return parseCommand(ctx, t.v);
  }
  ctx.i += 1;
  return [];
}

/** Read one argument as literal text. Returns null when there is no group. */
function parseRawArg(ctx: Ctx): string | null {
  while (ctx.i < ctx.end && ctx.toks[ctx.i].t === "ws") ctx.i += 1;
  if (ctx.i >= ctx.end) return null;
  const t = ctx.toks[ctx.i];
  if (t.t === "open") {
    const m = matchClose(ctx.toks, ctx.i, ctx.end);
    const stop = m < 0 ? ctx.end : m;
    const text = rawText(ctx, ctx.i + 1, stop);
    ctx.i = m < 0 ? ctx.end : m + 1;
    return text;
  }
  if (t.t === "char") {
    ctx.i += 1;
    return t.v;
  }
  return null;
}

function glyphNode(ch: string, ctx: Ctx): Node {
  if (!drawable(ch)) ctx.note(ch);
  return { k: "glyph", ch, cls: classOf(ch) };
}

function drawable(ch: string): boolean {
  return hasGlyph(ch) || Boolean(SYNTH[ch]);
}

/** Read the delimiter that follows `\left` / `\right`. `.` means "no delimiter". */
function readDelim(ctx: Ctx): string {
  while (ctx.i < ctx.end && ctx.toks[ctx.i].t === "ws") ctx.i += 1;
  if (ctx.i >= ctx.end) return "";
  const t = ctx.toks[ctx.i];
  ctx.i += 1;
  if (t.t === "char") return t.v === "." ? "" : t.v;
  if (t.t === "open") return "{";
  if (t.t === "close") return "}";
  if (t.t === "cmd") {
    const esc = ESCAPED_CMD[t.v];
    if (esc) return esc;
    const sym = SYMBOL_CMD[t.v];
    if (sym) return sym;
    ctx.note(`\\${t.v}`);
    return "";
  }
  return "";
}

function parseCommand(ctx: Ctx, name: string): Node[] {
  if (IGNORED_CMD.has(name)) return [];

  const space = SPACE_CMD[name];
  if (space !== undefined) return [{ k: "space", w: space }];

  const escaped = ESCAPED_CMD[name];
  if (escaped) return [glyphNode(escaped, ctx)];

  const symbol = SYMBOL_CMD[name];
  if (symbol) return [glyphNode(symbol, ctx)];

  if (name === "frac" || name === "dfrac" || name === "tfrac" || name === "cfrac") {
    const num = parseArg(ctx);
    const den = parseArg(ctx);
    if (num.length === 0 || den.length === 0) ctx.note(`\\${name}`);
    return [{ k: "frac", num, den }];
  }

  if (name === "sqrt") {
    let index: Node[] | null = null;
    while (ctx.i < ctx.end && ctx.toks[ctx.i].t === "ws") ctx.i += 1;
    const nextTok = ctx.toks[ctx.i];
    if (nextTok && nextTok.t === "char" && nextTok.v === "[") {
      const close = matchCloseChar(ctx.toks, ctx.i, ctx.end, "[", "]");
      if (close < 0) {
        ctx.note("\\sqrt[");
      } else {
        index = subParse(ctx, ctx.i + 1, close);
        ctx.i = close + 1;
      }
    }
    const rad = parseArg(ctx);
    if (rad.length === 0) ctx.note("\\sqrt");
    return [{ k: "sqrt", rad, index }];
  }

  if (name === "boxed" || name === "fbox") {
    const body = parseArg(ctx);
    if (body.length === 0) ctx.note(`\\${name}`);
    return [{ k: "boxed", body }];
  }

  if (UPRIGHT_CMD.has(name)) {
    const text = parseRawArg(ctx);
    if (text === null) {
      ctx.note(`\\${name}`);
      return [];
    }
    return [{ k: "upright", body: text }];
  }

  if (FUNCTION_CMD.has(name)) {
    return [{ k: "upright", body: name }];
  }

  if (name === "left") {
    const leftIdx = ctx.i - 1;
    const open = readDelim(ctx);
    const rightIdx = matchRight(ctx.toks, leftIdx, ctx.end);
    if (rightIdx < 0) {
      const body = subParse(ctx, ctx.i, ctx.end);
      ctx.i = ctx.end;
      return [{ k: "fence", open, close: "", body }];
    }
    const body = subParse(ctx, ctx.i, rightIdx);
    ctx.i = rightIdx + 1;
    const close = readDelim(ctx);
    return [{ k: "fence", open, close, body }];
  }

  if (name === "right") {
    // Unbalanced \right — draw the delimiter so nothing silently vanishes.
    const ch = readDelim(ctx);
    return ch ? [glyphNode(ch, ctx)] : [];
  }

  if (name === "begin") {
    const env = parseRawArg(ctx) ?? "";
    ctx.note(`\\begin{${env}}`);
    for (let i = ctx.i; i < ctx.end; i++) {
      const t = ctx.toks[i];
      if (t.t === "cmd" && t.v === "end") {
        ctx.i = i + 1;
        parseRawArg(ctx);
        return [];
      }
    }
    ctx.i = ctx.end;
    return [];
  }

  if (name === "end") {
    parseRawArg(ctx);
    return [];
  }

  ctx.note(`\\${name}`);
  return [];
}

function attachScript(nodes: Node[], slot: "sup" | "sub", arg: Node[]): void {
  const last = nodes[nodes.length - 1];
  if (last && last.k === "script" && last[slot] === null) {
    last[slot] = arg;
    return;
  }
  const base = last ?? null;
  if (base) nodes.pop();
  nodes.push({ k: "script", base, sup: slot === "sup" ? arg : null, sub: slot === "sub" ? arg : null });
}

function parseSeq(ctx: Ctx): Node[] {
  const nodes: Node[] = [];
  while (ctx.i < ctx.end) {
    const t = ctx.toks[ctx.i];
    if (t.t === "ws") {
      ctx.i += 1;
      continue;
    }
    if (t.t === "close") {
      ctx.i += 1;
      continue;
    }
    if (t.t === "open") {
      const m = matchClose(ctx.toks, ctx.i, ctx.end);
      const stop = m < 0 ? ctx.end : m;
      const body = subParse(ctx, ctx.i + 1, stop);
      ctx.i = m < 0 ? ctx.end : m + 1;
      nodes.push({ k: "group", body });
      continue;
    }
    if (t.t === "sup" || t.t === "sub") {
      ctx.i += 1;
      const arg = parseArg(ctx);
      attachScript(nodes, t.t === "sup" ? "sup" : "sub", arg);
      continue;
    }
    if (t.t === "cmd") {
      ctx.i += 1;
      for (const n of parseCommand(ctx, t.v)) nodes.push(n);
      continue;
    }
    // char
    if (t.v === "(" || t.v === "[") {
      const closeCh = t.v === "(" ? ")" : "]";
      const m = matchCloseChar(ctx.toks, ctx.i, ctx.end, t.v, closeCh);
      if (m >= 0) {
        const body = subParse(ctx, ctx.i + 1, m);
        ctx.i = m + 1;
        nodes.push({ k: "fence", open: t.v, close: closeCh, body });
        continue;
      }
    }
    if (t.v === "~") {
      ctx.i += 1;
      nodes.push({ k: "space", w: 6 * MU });
      continue;
    }
    ctx.i += 1;
    nodes.push(glyphNode(t.v, ctx));
  }
  return nodes;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

type RawStroke = { pts: Pt[]; kind: StrokeKind };
type Box = { strokes: RawStroke[]; width: number; ascent: number; descent: number; cls: AtomClass };
type Style = { s: number; upright: boolean };

const EMPTY_BOX: Box = { strokes: [], width: 0, ascent: 0, descent: 0, cls: "ord" };

function shift(strokes: RawStroke[], dx: number, dy: number): RawStroke[] {
  if (dx === 0 && dy === 0) return strokes;
  return strokes.map((st) => ({ kind: st.kind, pts: st.pts.map((p) => ({ x: p.x + dx, y: p.y + dy })) }));
}

function measure(strokes: RawStroke[], width: number, cls: AtomClass): Box {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const st of strokes) {
    for (const p of st.pts) {
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!Number.isFinite(minY)) return { strokes, width, ascent: 0, descent: 0, cls };
  return { strokes, width, ascent: Math.max(0, -minY), descent: Math.max(0, maxY), cls };
}

/** The layout engine. One instance per `layoutMath` call so the RNG is scoped. */
class HandMath {
  private readonly rng: () => number;
  private readonly prev: GlyphPick = { key: "", alt: -1 };
  readonly unsupported: string[] = [];

  constructor(seed: number) {
    this.rng = mulberry32(seed || 1);
  }

  note = (what: string): void => {
    if (what && !this.unsupported.includes(what)) this.unsupported.push(what);
  };

  private lookup(ch: string): Glyph | null {
    if (hasGlyph(ch)) return pickGlyph(ch, this.rng, this.prev);
    const synth = SYNTH[ch];
    if (synth) {
      this.prev.key = ch;
      this.prev.alt = 0;
      return synth;
    }
    return null;
  }

  /** Map atlas path coordinates into baseline-relative layout coordinates. */
  private stamp(glyph: Glyph, scale: number, jitter: number, kind: StrokeKind): RawStroke[] {
    const strokes: RawStroke[] = [];
    for (const path of glyph.paths) {
      for (const poly of samplePath(path)) {
        if (poly.length < 2) continue;
        strokes.push({
          kind,
          pts: poly.map((p) => ({ x: p.x * scale, y: (p.y - EM_BASELINE) * scale + jitter })),
        });
      }
    }
    return strokes;
  }

  glyphBox(ch: string, cls: AtomClass, style: Style, kind: StrokeKind = "glyph"): Box {
    const glyph = this.lookup(ch);
    if (!glyph) {
      this.note(ch);
      return { ...EMPTY_BOX, cls };
    }
    const jitter = (this.rng() - 0.5) * 2 * GLYPH_JITTER * style.s;
    const strokes = this.stamp(glyph, style.s, jitter, kind);
    return measure(strokes, glyph.advance * style.s, cls);
  }

  /** A delimiter stretched to cover [top, bottom] when the content is tall. */
  private delimiterBox(ch: string, top: number, bottom: number, style: Style): Box {
    if (!ch) return { ...EMPTY_BOX, cls: "ord" };
    const glyph = this.lookup(ch);
    if (!glyph) {
      this.note(ch);
      return { ...EMPTY_BOX, cls: "ord" };
    }
    const natural = this.stamp(glyph, style.s, 0, "delimiter");
    if (!GROWING_DELIMS.has(ch)) return measure(natural, glyph.advance * style.s, classOf(ch));

    let minY = Infinity;
    let maxY = -Infinity;
    for (const st of natural) {
      for (const p of st.pts) {
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
    }
    const want = bottom - top;
    const have = maxY - minY;
    if (!Number.isFinite(minY) || have <= 0 || want <= have) {
      return measure(natural, glyph.advance * style.s, classOf(ch));
    }
    const k = want / have;
    const stretched = natural.map((st) => ({
      kind: st.kind,
      pts: st.pts.map((p) => ({ x: p.x, y: top + (p.y - minY) * k })),
    }));
    return measure(stretched, glyph.advance * style.s, classOf(ch));
  }

  /** A nearly straight hand-drawn rule of length `w` at height `y`. */
  private rule(w: number, y: number, scale: number, kind: StrokeKind): RawStroke {
    const drift = 0.07 * scale;
    return {
      kind,
      pts: [
        { x: 0, y: y + drift },
        { x: w * 0.34, y: y - drift },
        { x: w * 0.68, y: y + drift * 0.8 },
        { x: w, y: y - drift * 0.4 },
      ],
    };
  }

  run(nodes: Node[], style: Style): Box {
    const boxes: Box[] = [];
    for (const n of nodes) boxes.push(this.node(n, style));

    const strokes: RawStroke[] = [];
    let x = 0;
    let prevCls: AtomClass | null = null;
    for (const b of boxes) {
      let cls = b.cls;
      if (cls === "bin" && isUnaryContext(prevCls)) cls = "ord";
      if (prevCls !== null && cls !== "space") x += gapBetween(prevCls, cls, style.upright) * style.s;
      for (const st of shift(b.strokes, x, 0)) strokes.push(st);
      x += b.width;
      if (cls !== "space") prevCls = cls;
      else if (prevCls === null) prevCls = "space";
    }
    const cls = boxes.length === 1 ? boxes[0].cls : "ord";
    return measure(strokes, Math.max(0, x), cls);
  }

  node(n: Node, style: Style): Box {
    switch (n.k) {
      case "glyph":
        return this.glyphBox(n.ch, n.cls, style);
      case "space":
        return { strokes: [], width: n.w * style.s, ascent: 0, descent: 0, cls: "space" };
      case "group":
        return this.run(n.body, style);
      case "upright":
        return this.uprightBox(n.body, style);
      case "frac":
        return this.fracBox(n, style);
      case "sqrt":
        return this.sqrtBox(n, style);
      case "script":
        return this.scriptBox(n, style);
      case "fence":
        return this.fenceBox(n, style);
      case "boxed":
        return this.boxedBox(n, style);
    }
  }

  private uprightBox(text: string, style: Style): Box {
    const inner: Style = { s: style.s, upright: true };
    const nodes: Node[] = [];
    for (const ch of text) {
      if (ch === " ") {
        nodes.push({ k: "space", w: 4 });
        continue;
      }
      nodes.push({ k: "glyph", ch, cls: "text" });
      if (!drawable(ch)) this.note(ch);
    }
    const box = this.run(nodes, inner);
    return { ...box, cls: "ord" };
  }

  private fracBox(n: { num: Node[]; den: Node[] }, style: Style): Box {
    const child: Style = { s: Math.max(style.s * FRAC_CHILD_SCALE, MIN_SCALE), upright: style.upright };
    const num = this.run(n.num, child);
    const den = this.run(n.den, child);
    const inner = Math.max(num.width, den.width);
    // A little proportional overhang as well as the fixed pad, so a fraction nested
    // inside another still has a visibly shorter bar than its parent.
    const barW = inner + 2 * (FRAC_BAR_PAD * style.s + inner * 0.06);
    const barY = -AXIS * style.s;
    const numBase = barY - (FRAC_NUM_GAP * style.s + num.descent);
    const denBase = barY + FRAC_DEN_GAP * style.s + den.ascent;

    const strokes: RawStroke[] = [];
    for (const st of shift(num.strokes, (barW - num.width) / 2, numBase)) strokes.push(st);
    strokes.push(this.rule(barW, barY, style.s, "rule"));
    for (const st of shift(den.strokes, (barW - den.width) / 2, denBase)) strokes.push(st);
    return measure(strokes, barW, "ord");
  }

  private scriptBox(n: { base: Node | null; sup: Node[] | null; sub: Node[] | null }, style: Style): Box {
    const base = n.base ? this.node(n.base, style) : EMPTY_BOX;
    const child: Style = { s: Math.max(style.s * SCRIPT_SCALE, MIN_SCALE), upright: style.upright };
    const sup = n.sup ? this.run(n.sup, child) : null;
    const sub = n.sub ? this.run(n.sub, child) : null;

    let supY = -Math.max(SUP_SHIFT * style.s, base.ascent * 0.62);
    let subY = SUB_SHIFT * style.s;
    if (sup && sub) {
      const clearance = SCRIPT_CLEARANCE * style.s;
      const gap = subY - sub.ascent - (supY + sup.descent);
      if (gap < clearance) {
        const push = (clearance - gap) / 2;
        supY -= push;
        subY += push;
      }
    }

    const scriptX = base.width + SCRIPT_GAP * style.s;
    const strokes: RawStroke[] = [...base.strokes];
    if (sup) for (const st of shift(sup.strokes, scriptX, supY)) strokes.push(st);
    if (sub) for (const st of shift(sub.strokes, scriptX, subY)) strokes.push(st);
    const width = scriptX + Math.max(sup?.width ?? 0, sub?.width ?? 0);
    return measure(strokes, width, base.cls === "space" ? "ord" : base.cls);
  }

  private sqrtBox(n: { rad: Node[]; index: Node[] | null }, style: Style): Box {
    const rad = this.run(n.rad, style);
    const padTop = RADICAL_PAD_TOP * style.s;
    const padBottom = RADICAL_PAD_BOTTOM * style.s;
    let top = -(rad.ascent + padTop);
    const bottom = Math.max(rad.descent + padBottom, 0.6 * style.s);
    if (bottom - top < RADICAL_MIN_HEIGHT * style.s) top = bottom - RADICAL_MIN_HEIGHT * style.s;

    const index = n.index && n.index.length > 0 ? this.run(n.index, { s: Math.max(style.s * 0.5, MIN_SCALE * 0.8), upright: style.upright }) : null;
    const apexX = RADICAL_APEX_X * style.s;
    const dx = index ? Math.max(0, index.width - 2.6 * style.s) : 0;

    const bodyX = dx + apexX + RADICAL_PAD_LEFT * style.s;
    const vinculumEnd = bodyX + rad.width + RADICAL_PAD_RIGHT * style.s;

    const strokes: RawStroke[] = [];
    const hook = this.radicalHook(style.s, top, bottom, vinculumEnd - dx);
    for (const st of shift(hook, dx, 0)) strokes.push(st);
    if (index) {
      const indexY = top + 0.52 * (bottom - top);
      for (const st of shift(index.strokes, dx + 2.6 * style.s - index.width, indexY)) strokes.push(st);
    }
    for (const st of shift(rad.strokes, bodyX, 0)) strokes.push(st);
    return measure(strokes, vinculumEnd, "ord");
  }

  /**
   * The atlas radical, stretched to [top, bottom], with its top arm replaced by a
   * vinculum that reaches `endX`. Drawn as one stroke — the way a hand does it.
   */
  private radicalHook(scale: number, top: number, bottom: number, endX: number): RawStroke[] {
    const glyph = ATLAS["√"]?.[0];
    if (!glyph) {
      return [
        {
          kind: "radical",
          pts: [
            { x: 0, y: top + 0.6 * (bottom - top) },
            { x: 1.6 * scale, y: bottom },
            { x: RADICAL_APEX_X * scale, y: top },
            { x: endX, y: top + 0.06 * scale },
          ],
        },
      ];
    }
    const polys = samplePath(glyph.paths[0]);
    const pts = polys[0] ?? [];
    let apex = 0;
    for (let i = 1; i < pts.length; i++) {
      if (pts[i].y < pts[apex].y) apex = i;
    }
    const hook = pts.slice(0, apex + 1);
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of hook) {
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const span = maxY - minY || 1;
    const mapped: Pt[] = hook.map((p) => ({
      x: p.x * scale,
      y: top + ((p.y - minY) / span) * (bottom - top),
    }));
    mapped.push({ x: endX, y: top + 0.08 * scale });
    return [{ kind: "radical", pts: mapped }];
  }

  private fenceBox(n: { open: string; close: string; body: Node[] }, style: Style): Box {
    const body = this.run(n.body, style);
    const pad = FENCE_PAD * style.s;
    const top = -(body.ascent + pad);
    const bottom = body.descent + pad;
    const open = this.delimiterBox(n.open, top, bottom, style);
    const close = this.delimiterBox(n.close, top, bottom, style);

    const strokes: RawStroke[] = [];
    let x = 0;
    for (const st of shift(open.strokes, x, 0)) strokes.push(st);
    x += open.width;
    if (open.width > 0) x += TIGHT_GAP * style.s;
    for (const st of shift(body.strokes, x, 0)) strokes.push(st);
    x += body.width;
    if (close.width > 0) x += TIGHT_GAP * style.s;
    for (const st of shift(close.strokes, x, 0)) strokes.push(st);
    x += close.width;
    return measure(strokes, x, "ord");
  }

  private boxedBox(n: { body: Node[] }, style: Style): Box {
    const body = this.run(n.body, style);
    const padX = BOX_PAD_X * style.s;
    const padY = BOX_PAD_Y * style.s;
    const left = 0;
    const right = body.width + 2 * padX;
    const top = -(body.ascent + padY);
    const bottom = body.descent + padY;

    const strokes: RawStroke[] = shift(body.strokes, padX, 0).slice();
    strokes.push({
      kind: "box",
      pts: [
        { x: left + 0.25 * style.s, y: top + 0.18 * style.s },
        { x: right, y: top },
        { x: right - 0.1 * style.s, y: bottom },
        { x: left, y: bottom + 0.14 * style.s },
        { x: left + 0.18 * style.s, y: top },
        { x: left + 1.1 * style.s, y: top - 0.12 * style.s },
      ],
    });
    return measure(strokes, right, "ord");
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function tremorFor(kind: StrokeKind): number {
  if (kind === "rule" || kind === "box") return TREMOR * 1.2;
  if (kind === "radical" || kind === "delimiter") return TREMOR * 1.1;
  return TREMOR;
}

function finiteStroke(points: InkPt[]): boolean {
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) return false;
  }
  return points.length >= 2;
}

/**
 * Lay out one line of LaTeX as hand-drawn strokes.
 *
 * Never throws: on a parse failure it returns whatever it managed plus a non-empty
 * `unsupported`, which the caller must treat as "fall back to the typeset shape".
 */
export function layoutMath(latex: string, opts: MathLayoutOptions = {}): MathLayout {
  const size = opts.size ?? NOTE_HAND_SIZE;
  const seed = opts.seed ?? 1;
  const engine = new HandMath(seed);

  let box: Box = EMPTY_BOX;
  try {
    const toks = tokenize(latex ?? "");
    const ctx: Ctx = { toks, i: 0, end: toks.length, note: engine.note };
    box = engine.run(parseSeq(ctx), { s: 1, upright: false });
  } catch {
    engine.note("internal");
  }

  const emScale = size / EM_HEIGHT;
  const strokes: Stroke[] = [];
  let order = 0;
  for (const raw of box.strokes) {
    const scaled = raw.pts.map((p) => ({ x: p.x * emScale, y: p.y * emScale }));
    const points = withTremor(scaled, (seed + order * 131 + 7) >>> 0, tremorFor(raw.kind) * emScale);
    if (!finiteStroke(points)) {
      engine.note("internal");
      continue;
    }
    strokes.push({ points, order, kind: raw.kind });
    order += 1;
  }

  if (strokes.length === 0) return { strokes: [], width: 0, height: 0, baseline: 0, unsupported: engine.unsupported };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const st of strokes) {
    for (const p of st.points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  for (const st of strokes) {
    for (const p of st.points) {
      p.x -= minX;
      p.y -= minY;
    }
  }

  return {
    strokes,
    width: maxX - minX,
    height: maxY - minY,
    baseline: -minY,
    unsupported: engine.unsupported,
  };
}

// ---------------------------------------------------------------------------
// Stroke helpers — placement on a canvas and reveal timing
// ---------------------------------------------------------------------------

/** Axis-aligned bounds of a stroke list, or null when there is no ink. */
export function strokeBounds(
  strokes: readonly Stroke[],
): { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const st of strokes) {
    for (const p of st.points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/**
 * Move (and optionally scale) a layout into another coordinate space — e.g. from
 * layout coordinates into tldraw page coordinates. Pure: returns new strokes.
 */
export function placeStrokes(
  strokes: readonly Stroke[],
  at: { x?: number; y?: number; scale?: number } = {},
): Stroke[] {
  const dx = at.x ?? 0;
  const dy = at.y ?? 0;
  const k = at.scale ?? 1;
  return strokes.map((st) => ({
    order: st.order,
    kind: st.kind,
    points: st.points.map((p) => ({ x: p.x * k + dx, y: p.y * k + dy, z: p.z })),
  }));
}

/** Pen speed in px per ms. A teacher writing briskly on a whiteboard. */
const PEN_SPEED = 0.45;
const STROKE_MIN_MS = 60;
const STROKE_MAX_MS = 900;
/** Pen-up gap between two strokes. */
export const STROKE_GAP_MS = 40;

/** Suggested time to reveal one stroke, from its arc length. */
export function strokeDurationMs(stroke: Stroke): number {
  let len = 0;
  for (let i = 1; i < stroke.points.length; i++) {
    const a = stroke.points[i - 1];
    const b = stroke.points[i];
    len += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return Math.min(STROKE_MAX_MS, Math.max(STROKE_MIN_MS, STROKE_MIN_MS + len / PEN_SPEED));
}

/** Suggested time to write a whole layout, strokes plus pen-up gaps. */
export function totalDurationMs(strokes: readonly Stroke[]): number {
  let total = 0;
  for (const st of strokes) total += strokeDurationMs(st) + STROKE_GAP_MS;
  return Math.max(0, total - STROKE_GAP_MS);
}
