/**
 * LaTeX -> hand-drawn math.
 *
 * `layoutMath()` parses the subset of LaTeX the deterministic Live engine emits
 * (`src/lib/live/engine/**`) and lays it out with real typographic structure —
 * fractions on an axis, scripts, radicals, growing fences — then stamps every atom
 * with a glyph from the teacher-hand atlas and returns tremored polylines.
 *
 * What it can write, beyond arithmetic and linear algebra:
 *  - calculus: `\int` / `\iint` / `\iiint` / `\oint` (a tall hand-drawn sign that grows
 *    with its integrand, limits at its corners, or above/below with `\limits`),
 *    `\lim_{x \to a}` / `\max` / `\min` with the limit written under the word,
 *    `\sum` / `\prod`, primes (`f'(x)`, `y''`), evaluation brackets and bars
 *    (`\left[ … \right]_0^2`, `\Big[ … \Big]_a^b`, `\bigg|_0^2`, `\left. … \right|`);
 *  - algebra: `\pm`, surds with an index, `|x|` / `\lvert x \rvert` / `\left| … \right|`
 *    (bars pair up into a growing fence), `^\circ`, function names with TeX spacing,
 *    Greek, number sets (`\mathbb{R}`), set and logic symbols, double arrows;
 *  - layout: `cases`, `pmatrix` / `bmatrix` / `vmatrix` / `matrix`, `array`, `aligned`,
 *    accents (`\overline`, `\bar`, `\vec`, `\hat`, `\dot`, `\tilde`), `\binom`.
 *
 * WORDS. The board carries no prose. `\text{…}` (and `\mathrm`, `\operatorname`, …) is
 * drawn in the hand only while it is a short mathematical word — "or", "and",
 * "undefined", "no solution", a unit — at most MAX_TEXT_WORDS words and
 * MAX_TEXT_LETTERS letters. Anything longer is a sentence, not maths, and is reported
 * in `unsupported` so the caller never handwrites a paragraph on the student's page.
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

import { ATLAS, BIG_OPERATORS, EM_BASELINE, EM_HEIGHT, EM_WIDTH, hasGlyph, type Glyph } from "./atlas";
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
/** Extra room in front of a binary operator or relation (see `gapBetween`). */
const OP_LEAD = 0.9;

const FRAC_CHILD_SCALE = 0.86;
const FRAC_BAR_PAD = 0.9;
/** Bar to numerator / denominator ink. The pen is ~1 unit wide: less than this touches. */
const FRAC_NUM_GAP = 1.2;
const FRAC_DEN_GAP = 1.4;

const SCRIPT_SCALE = 0.7;
const MIN_SCALE = 0.42;
const SUP_SHIFT = 4.2;
const SUB_SHIFT = 2.4;
const SCRIPT_GAP = 0.3;
const SCRIPT_CLEARANCE = 0.8;
/** A base taller than this (a fence round a fraction, a big bar) takes its scripts at its corners. */
const TALL_BASE = 9.6;

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

/** Natural height of a delimiter glyph: the atlas `(` spans y 2.6..11.6. */
const DELIM_NATURAL = 9;
/** Where a `\big`-family delimiter is centred, above the baseline. */
const DELIM_CENTER = 3.4;
/** `\big`, `\Big`, `\bigg`, `\Bigg` as multiples of the natural delimiter. */
const SIZED_DELIM: Record<string, number> = { big: 1.2, Big: 1.6, bigg: 2.1, Bigg: 2.6 };

/** Half the height of a default integral sign, centred on the axis (~2.2 x a digit). */
const INT_HALF = 9.3;
/** How far a grown integral sign reaches past the top and bottom of its integrand. */
const INT_PAD = 0.7;
/** x step between the signs of `\iint` / `\iiint`. */
const INT_REPEAT = 4.4;
/** Right edge of one integral sign's ink. */
const INT_WIDTH = 6.0;
/** Where a lower limit starts: tucked in under the slant of the sign. */
const INT_SUB_X = 4.0;
const INT_SCRIPT_GAP = 0.3;
/** `\sum` / `\prod`: the Σ / Π of the hand, this much bigger. */
const SUM_SCALE = 1.6;
/** Gap between an operator and a limit written above or below it. */
const LIMIT_GAP = 1.6;
/** Room on either side of a big operator, so it never touches its neighbours. */
const OP_SIDE = 0.6;
/** Room after an integral and its limits, before the integrand starts. */
const INT_TRAIL = 1.2;

/** Top of a prime above the baseline, and the step between two primes. */
const PRIME_TOP = 8.2;
const PRIME_STEP = 1.6;

/**
 * Gap between a body and the accent above it. Gaps are ink centre to ink centre and the
 * pen is about one em unit wide, so anything under ~1.5 reads as touching.
 */
const ACCENT_GAP = 2.2;

const GRID_ROW_GAP = 2.2;
const GRID_ROW_MIN = 12.5;
const GRID_COL_GAP = 4.0;
const CASES_COL_GAP = 5.0;
const GRID_DELIM_GAP = 0.8;

/** `\text{…}` longer than this is prose, not maths: reported, never handwritten. */
const MAX_TEXT_WORDS = 4;
const MAX_TEXT_LETTERS = 24;

const GLYPH_JITTER = 0.16;
const TREMOR = 0.42;

// ---------------------------------------------------------------------------
// Synthesised symbols — glyphs the hand atlas does not carry, drawn on the same
// 10x14 em box so they sit in the same hand.
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
  // congruent (a proof's statements): the wave of `∼` over an `=`, wave first as it is written
  "≅": s(7.8, "M 1.2 6.0 C 2.1 4.6 3.3 4.8 4.1 5.5 C 4.9 6.2 6.1 6.4 7.1 5.1", "M 1.2 8.3 L 7.0 8.2 M 1.2 10.4 L 7.0 10.3"),
  "·": s(3.6, "M 1.5 8.2 L 1.8 8.7"),
  "∞": s(9.2, "M 4.4 8.5 C 3.2 6.6 1.0 7.2 1.2 8.7 C 1.4 10.3 3.3 10.5 4.5 8.6 C 5.7 6.7 7.6 7.1 7.9 8.6 C 8.2 10.2 6.0 10.6 4.4 8.5"),
  "∅": s(8.2, "M 4.2 3.8 C 7.4 3.8 7.6 11.4 4.2 11.4 C 1.0 11.4 0.8 3.8 4.2 3.8", "M 7.0 2.6 L 1.4 12.6"),
  "°": s(4.4, "M 2.2 3.0 C 3.6 3.0 3.6 5.2 2.2 5.2 C 0.9 5.2 0.9 3.0 2.2 3.0"),
  "%": s(8.6, "M 6.8 3.0 L 1.6 11.2", "M 2.3 3.4 C 3.5 3.4 3.5 5.4 2.3 5.4 C 1.1 5.4 1.1 3.4 2.3 3.4", "M 6.4 8.8 C 7.6 8.8 7.6 10.8 6.4 10.8 C 5.2 10.8 5.2 8.8 6.4 8.8"),
  // From ascender to below the line, so `\ln|x|` never reads as `lnlxl`.
  "|": s(3.6, "M 1.8 2.2 L 1.9 12.6"),
  "{": s(4.8, "M 3.8 2.6 C 2.1 2.9 3.0 6.2 1.0 7.0 C 3.0 7.8 2.1 11.1 3.8 11.4"),
  "}": s(4.8, "M 1.0 2.6 C 2.7 2.9 1.8 6.2 3.8 7.0 C 1.8 7.8 2.7 11.1 1.0 11.4"),
};

// ---------------------------------------------------------------------------
// Atom classes and spacing
// ---------------------------------------------------------------------------

/** TeX's atom classes, plus `text` (inside `\text{}`) and `space`. `op` is a named or big operator. */
type AtomClass = "ord" | "digit" | "op" | "bin" | "rel" | "open" | "close" | "punct" | "text" | "space";

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
  "∪": "bin",
  "∩": "bin",
  "∖": "bin",
  "∧": "bin",
  "∨": "bin",
  "∘": "bin",
  "=": "rel",
  "<": "rel",
  ">": "rel",
  "≤": "rel",
  "≥": "rel",
  "≠": "rel",
  "≈": "rel",
  "≡": "rel",
  "∼": "rel",
  "≅": "rel",
  "→": "rel",
  "←": "rel",
  "↔": "rel",
  "↦": "rel",
  "⇒": "rel",
  "⇐": "rel",
  "⇔": "rel",
  "⇌": "rel",
  "∈": "rel",
  "∉": "rel",
  "⊂": "rel",
  "⊃": "rel",
  "⊆": "rel",
  "⊇": "rel",
  "∥": "rel",
  "⊥": "rel",
  "∴": "rel",
  "(": "open",
  "[": "open",
  "{": "open",
  "⟨": "open",
  "⌊": "open",
  "⌈": "open",
  ")": "close",
  "]": "close",
  "}": "close",
  "⟩": "close",
  "⌋": "close",
  "⌉": "close",
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
  // The hand's letters carry ~2.2 units of left bearing but only ~0.3 on the right, so
  // the operator would sit visibly closer to what precedes it (`x+ y`) without a lead.
  if (a === "rel" || b === "rel") return THICK_SPACE + (b === "rel" && a !== "rel" ? OP_LEAD : 0);
  if (a === "bin" || b === "bin") return MED_SPACE + (b === "bin" && a !== "bin" ? OP_LEAD : 0);
  if (a === "punct") return THIN_SPACE;
  if (b === "punct") return 0.15;
  // `\sin x`, `2 \ln x`, `\int x`: TeX's thin space either side of an operator.
  if (a === "op" || b === "op") return THIN_SPACE;
  if (a === "digit" && b === "digit") return DIGIT_GAP;
  if (a === "digit" && b === "ord") return DIGIT_ORD_GAP;
  return ORD_GAP;
}

/** A binary operator with nothing to its left is a sign, not an operation. */
function isUnaryContext(prev: AtomClass | null): boolean {
  return prev === null || prev === "bin" || prev === "rel" || prev === "open" || prev === "punct" || prev === "op";
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

type BigOp = "int" | "iint" | "iiint" | "oint" | "sum" | "prod" | "name";
type Accent = "overline" | "bar" | "underline" | "vec" | "hat" | "tilde" | "dot" | "ddot";
type Align = "l" | "c" | "r";

type BigOpNode = { k: "bigop"; op: BigOp; name: string; sub: Node[] | null; sup: Node[] | null; limits: boolean | null };
type GridNode = {
  k: "grid";
  rows: Node[][][];
  /** per column; the last entry repeats */
  align: Align[];
  /** `aligned`: columns pair up right|left round an `&=` */
  pairs: boolean;
  open: string;
  close: string;
  scale: number;
  colGap: number;
};

type Node =
  | { k: "glyph"; ch: string; cls: AtomClass }
  | { k: "space"; w: number }
  | { k: "frac"; num: Node[]; den: Node[]; bar: boolean }
  | { k: "sqrt"; rad: Node[]; index: Node[] | null }
  | { k: "script"; base: Node | null; sup: Node[] | null; sub: Node[] | null }
  | { k: "fence"; open: string; close: string; body: Node[] }
  | { k: "boxed"; body: Node[] }
  | { k: "upright"; body: string; op: boolean }
  /** `upright`: `\mathrm{Fe_{2}O_{3}}`, `\mathrm{m/s^{2}}` — letters set close, scripts real scripts */
  | { k: "group"; body: Node[]; upright?: boolean }
  | { k: "xarrow"; over: Node[]; dir: "right" | "left" }
  | BigOpNode
  | { k: "sized"; ch: string; mult: number; cls: AtomClass }
  | { k: "accent"; accent: Accent; body: Node[] }
  | { k: "primed"; base: Node; n: number }
  | GridNode;

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
  equiv: "≡",
  sim: "∼",
  cong: "≅",
  rightarrow: "→",
  to: "→",
  longrightarrow: "→",
  leftarrow: "←",
  gets: "←",
  longleftarrow: "←",
  leftrightarrow: "↔",
  longleftrightarrow: "↔",
  mapsto: "↦",
  longmapsto: "↦",
  Rightarrow: "⇒",
  Longrightarrow: "⇒",
  implies: "⇒",
  Leftarrow: "⇐",
  Longleftarrow: "⇐",
  impliedby: "⇐",
  Leftrightarrow: "⇔",
  Longleftrightarrow: "⇔",
  iff: "⇔",
  uparrow: "↑",
  downarrow: "↓",
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ε",
  varepsilon: "ε",
  eta: "η",
  theta: "θ",
  vartheta: "θ",
  lambda: "λ",
  mu: "μ",
  nu: "ν",
  pi: "π",
  rho: "ρ",
  varrho: "ρ",
  sigma: "σ",
  tau: "τ",
  phi: "ϕ",
  varphi: "φ",
  chi: "χ",
  psi: "ψ",
  omega: "ω",
  Gamma: "Γ",
  Delta: "Δ",
  Theta: "Θ",
  Lambda: "Λ",
  Pi: "Π",
  Sigma: "Σ",
  Phi: "Φ",
  Omega: "Ω",
  triangle: "Δ",
  infty: "∞",
  varnothing: "∅",
  emptyset: "∅",
  in: "∈",
  notin: "∉",
  subset: "⊂",
  supset: "⊃",
  subseteq: "⊆",
  supseteq: "⊇",
  cup: "∪",
  cap: "∩",
  setminus: "∖",
  forall: "∀",
  exists: "∃",
  neg: "¬",
  lnot: "¬",
  land: "∧",
  wedge: "∧",
  lor: "∨",
  vee: "∨",
  therefore: "∴",
  partial: "∂",
  nabla: "∇",
  ell: "ℓ",
  prime: "′",
  circ: "∘",
  degree: "°",
  angle: "∠",
  perp: "⊥",
  parallel: "∥",
  ldots: "…",
  dots: "…",
  dotsc: "…",
  cdots: "⋯",
  dotsb: "⋯",
  vert: "|",
  lvert: "|",
  rvert: "|",
  mid: "|",
  Vert: "∥",
  lVert: "∥",
  rVert: "∥",
  langle: "⟨",
  rangle: "⟩",
  lfloor: "⌊",
  rfloor: "⌋",
  lceil: "⌈",
  rceil: "⌉",
  lbrace: "{",
  rbrace: "}",
  lbrack: "[",
  rbrack: "]",
  colon: ":",
  AA: "Å",
  ohm: "Ω",
  hbar: "ħ",
  checkmark: "✓",
  ast: "*",
  rightleftharpoons: "⇌",
};

/** A command whose symbol is not in the class its character would get. */
const SYMBOL_CMD_CLASS: Record<string, AtomClass> = { mid: "rel", colon: "punct" };

/** Escaped literals: `\%`, `\{`, `\}`, … */
const ESCAPED_CMD: Record<string, string> = {
  "%": "%",
  "{": "{",
  "}": "}",
  "|": "∥",
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
  "hline",
  "nonumber",
  "notag",
]);

const UPRIGHT_CMD = new Set([
  "text",
  "mathrm",
  "textrm",
  "rm",
  "mathbf",
  "textbf",
  "mathit",
  "textit",
  "mathsf",
  "operatorname",
  "mathtt",
  "mbox",
  "textnormal",
]);

/** Font switches that change nothing a hand can show: the argument is drawn as it is. */
const STYLE_CMD = new Set(["boldsymbol", "bm", "pmb", "mathcal", "mathscr", "mathfrak", "mathnormal"]);

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
  "lg",
  "exp",
  "det",
  "gcd",
  "lcm",
  "deg",
  "mod",
  "sgn",
  "arg",
]);

/** Big operators: a sign (or a word) that owns the limits written with it. */
const BIG_OP_CMD: Record<string, { op: BigOp; name?: string }> = {
  int: { op: "int" },
  iint: { op: "iint" },
  iiint: { op: "iiint" },
  oint: { op: "oint" },
  sum: { op: "sum" },
  prod: { op: "prod" },
  lim: { op: "name", name: "lim" },
  limsup: { op: "name", name: "lim sup" },
  liminf: { op: "name", name: "lim inf" },
  max: { op: "name", name: "max" },
  min: { op: "name", name: "min" },
  sup: { op: "name", name: "sup" },
  inf: { op: "name", name: "inf" },
};

const ACCENT_CMD: Record<string, Accent> = {
  overline: "overline",
  bar: "bar",
  underline: "underline",
  vec: "vec",
  overrightarrow: "vec",
  hat: "hat",
  widehat: "hat",
  tilde: "tilde",
  widetilde: "tilde",
  dot: "dot",
  ddot: "ddot",
};

/** Blackboard bold: the number sets have their own glyphs; any other letter is drawn plain. */
const BLACKBOARD: Record<string, string> = { R: "ℝ", Z: "ℤ", N: "ℕ", Q: "ℚ", C: "ℂ" };

/** Environments the hand can lay out as a grid. */
const ENVS: Record<string, { open: string; close: string; align: Align | "pairs" | "spec"; scale?: number; colGap?: number }> = {
  matrix: { open: "", close: "", align: "c" },
  pmatrix: { open: "(", close: ")", align: "c" },
  bmatrix: { open: "[", close: "]", align: "c" },
  Bmatrix: { open: "{", close: "}", align: "c" },
  vmatrix: { open: "|", close: "|", align: "c" },
  Vmatrix: { open: "∥", close: "∥", align: "c" },
  smallmatrix: { open: "", close: "", align: "c", scale: 0.75 },
  cases: { open: "{", close: "", align: "l", colGap: CASES_COL_GAP },
  dcases: { open: "{", close: "", align: "l", colGap: CASES_COL_GAP },
  rcases: { open: "", close: "}", align: "l", colGap: CASES_COL_GAP },
  array: { open: "", close: "", align: "spec" },
  aligned: { open: "", close: "", align: "pairs" },
  align: { open: "", close: "", align: "pairs" },
  "align*": { open: "", close: "", align: "pairs" },
  split: { open: "", close: "", align: "pairs" },
  eqnarray: { open: "", close: "", align: "pairs" },
  "eqnarray*": { open: "", close: "", align: "pairs" },
  gathered: { open: "", close: "", align: "c" },
  gather: { open: "", close: "", align: "c" },
  "gather*": { open: "", close: "", align: "c" },
};

const GROWING_DELIMS = new Set(["(", ")", "[", "]", "{", "}", "|", "∥", "⟨", "⟩", "⌊", "⌋", "⌈", "⌉"]);

/** Commands whose next token is a delimiter, not content (`\left(`, `\Big|`, …). */
const DELIM_CMD = /^(left|right|middle|big|Big|bigg|Bigg)[lrm]?$/;

/** The token at `i` is the delimiter argument of `\left`, `\bigg`, … — never content. */
function isDelimArg(toks: Token[], i: number): boolean {
  const prev = toks[i - 1];
  return prev !== undefined && prev.t === "cmd" && DELIM_CMD.test(prev.v);
}

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
    if (t.t === "char" && !isDelimArg(toks, i)) {
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

/** The `|` that closes the absolute value opened just before `start`, or -1. */
function matchBar(toks: Token[], start: number, end: number): number {
  let i = start;
  while (i < end) {
    const t = toks[i];
    if (t.t === "open") {
      const m = matchClose(toks, i, end);
      if (m < 0) return -1;
      i = m + 1;
      continue;
    }
    if (t.t === "char" && t.v === "|" && !isDelimArg(toks, i)) return i;
    i += 1;
  }
  return -1;
}

/** The matching `\rvert` for an `\lvert` at `start` (nesting-aware), or -1. */
function matchCmdPair(toks: Token[], start: number, end: number, openCmd: string, closeCmd: string): number {
  let depth = 0;
  for (let i = start; i < end; i++) {
    const t = toks[i];
    if (t.t !== "cmd") continue;
    if (t.v === openCmd) depth += 1;
    else if (t.v === closeCmd) {
      depth -= 1;
      if (depth === 0) return i;
    }
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

/** Index of the `\end` closing the environment whose body starts at `start`, or -1. */
function matchEnd(toks: Token[], start: number, end: number): number {
  let depth = 0;
  for (let i = start; i < end; i++) {
    const t = toks[i];
    if (t.t !== "cmd") continue;
    if (t.v === "begin") depth += 1;
    else if (t.v === "end") {
      if (depth === 0) return i;
      depth -= 1;
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

/** Words, not maths: more than a short mathematical word or two. */
function isProse(text: string): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const letters = text.replace(/[^A-Za-z]/g, "").length;
  return words.length > MAX_TEXT_WORDS || letters > MAX_TEXT_LETTERS;
}

function skipWs(ctx: Ctx): void {
  while (ctx.i < ctx.end && ctx.toks[ctx.i].t === "ws") ctx.i += 1;
}

/** Read one argument: a braced group, or the single token that follows. */
function parseArg(ctx: Ctx): Node[] {
  skipWs(ctx);
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
  skipWs(ctx);
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

/** Skip a `*` right after a command (`\operatorname*`, `\hspace*`). */
function skipStar(ctx: Ctx): void {
  const t = ctx.toks[ctx.i];
  if (t && t.t === "char" && t.v === "*") ctx.i += 1;
}

function glyphNode(ch: string, ctx: Ctx, cls: AtomClass = classOf(ch)): Node {
  if (!drawable(ch)) ctx.note(ch);
  return { k: "glyph", ch, cls };
}

function drawable(ch: string): boolean {
  return hasGlyph(ch) || Boolean(SYNTH[ch]);
}

/** Read the delimiter that follows `\left` / `\right`. `.` means "no delimiter". */
function readDelim(ctx: Ctx): string {
  skipWs(ctx);
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

/**
 * Split an environment body into rows (`\\`) and cells (`&`), at the top level only:
 * a brace group or a nested environment keeps its own separators.
 */
function splitGrid(ctx: Ctx, from: number, to: number): Node[][][] {
  const rows: Node[][][] = [];
  let row: Node[][] = [];
  let cellStart = from;
  let depth = 0;
  let envDepth = 0;
  for (let j = from; j <= to; j++) {
    const t = j < to ? ctx.toks[j] : null;
    if (t) {
      if (t.t === "open") depth += 1;
      else if (t.t === "close") depth -= 1;
      else if (t.t === "cmd" && t.v === "begin") envDepth += 1;
      else if (t.t === "cmd" && t.v === "end") envDepth -= 1;
      if (depth > 0 || envDepth > 0 || t.t === "open" || t.t === "close") continue;
    }
    const isCell = t !== null && t.t === "char" && t.v === "&";
    const isRow = t === null || (t.t === "cmd" && (t.v === "\\" || t.v === "cr"));
    if (!isCell && !isRow) continue;
    row.push(subParse(ctx, cellStart, j));
    cellStart = j + 1;
    if (isRow) {
      rows.push(row);
      row = [];
      // `\\[4pt]`: extra row spacing the hand does not need
      const next = ctx.toks[j + 1];
      if (t !== null && next && next.t === "char" && next.v === "[") {
        const close = matchCloseChar(ctx.toks, j + 1, to, "[", "]");
        if (close > 0) {
          j = close;
          cellStart = close + 1;
        }
      }
    }
  }
  while (rows.length > 0 && rows[rows.length - 1].every((cell) => cell.length === 0)) rows.pop();
  return rows;
}

function parseEnvironment(ctx: Ctx): Node[] {
  const env = parseRawArg(ctx) ?? "";
  const endIdx = matchEnd(ctx.toks, ctx.i, ctx.end);
  const skipToEnd = (): void => {
    if (endIdx < 0) {
      ctx.i = ctx.end;
      return;
    }
    ctx.i = endIdx + 1;
    parseRawArg(ctx);
  };
  const spec = ENVS[env];
  if (!spec) {
    ctx.note(`\\begin{${env}}`);
    skipToEnd();
    return [];
  }
  if (endIdx < 0) ctx.note(`\\begin{${env}}`);

  let align: Align[] = spec.align === "pairs" || spec.align === "spec" ? ["c"] : [spec.align];
  if (spec.align === "spec") {
    const colspec = parseRawArg(ctx) ?? "";
    const cols = [...colspec].filter((c): c is Align => c === "l" || c === "c" || c === "r");
    if (cols.length > 0) align = cols;
  }
  const rows = splitGrid(ctx, ctx.i, endIdx < 0 ? ctx.end : endIdx);
  skipToEnd();
  return [
    {
      k: "grid",
      rows,
      align,
      pairs: spec.align === "pairs",
      open: spec.open,
      close: spec.close,
      scale: spec.scale ?? 1,
      colGap: spec.colGap ?? GRID_COL_GAP,
    },
  ];
}

function parseCommand(ctx: Ctx, name: string): Node[] {
  if (IGNORED_CMD.has(name)) return [];

  const space = SPACE_CMD[name];
  if (space !== undefined) return [{ k: "space", w: space }];

  const escaped = ESCAPED_CMD[name];
  if (escaped) return [glyphNode(escaped, ctx)];

  const symbol = SYMBOL_CMD[name];
  if (symbol) return [glyphNode(symbol, ctx, SYMBOL_CMD_CLASS[name] ?? classOf(symbol))];

  const big = BIG_OP_CMD[name];
  if (big) return [{ k: "bigop", op: big.op, name: big.name ?? "", sub: null, sup: null, limits: null }];

  const sized = /^(big|Big|bigg|Bigg)([lrm]?)$/.exec(name);
  if (sized || name === "middle") {
    const ch = readDelim(ctx);
    if (!ch) return [];
    if (!drawable(ch)) ctx.note(ch);
    const side = sized?.[2] ?? "";
    const cls: AtomClass =
      name === "middle" || side === "m" ? "rel" : side === "l" ? "open" : side === "r" ? "close" : classOf(ch);
    return [{ k: "sized", ch, mult: sized ? SIZED_DELIM[sized[1]] : 1, cls }];
  }

  if (name === "frac" || name === "dfrac" || name === "tfrac" || name === "cfrac") {
    const num = parseArg(ctx);
    const den = parseArg(ctx);
    if (num.length === 0 || den.length === 0) ctx.note(`\\${name}`);
    return [{ k: "frac", num, den, bar: true }];
  }

  if (name === "binom" || name === "dbinom" || name === "tbinom") {
    const num = parseArg(ctx);
    const den = parseArg(ctx);
    if (num.length === 0 || den.length === 0) ctx.note(`\\${name}`);
    return [{ k: "fence", open: "(", close: ")", body: [{ k: "frac", num, den, bar: false }] }];
  }

  if (name === "sqrt") {
    let index: Node[] | null = null;
    skipWs(ctx);
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

  const accent = ACCENT_CMD[name];
  if (accent) {
    const body = parseArg(ctx);
    if (body.length === 0) ctx.note(`\\${name}`);
    return [{ k: "accent", accent, body }];
  }

  if (name === "mathbb") {
    const text = parseRawArg(ctx);
    if (text === null) {
      ctx.note("\\mathbb");
      return [];
    }
    return [...text].filter((ch) => ch.trim() !== "").map((ch) => glyphNode(BLACKBOARD[ch] ?? ch, ctx, "ord"));
  }

  if (STYLE_CMD.has(name)) return [{ k: "group", body: parseArg(ctx) }];

  if (name === "color") {
    parseRawArg(ctx);
    return [];
  }
  if (name === "textcolor" || name === "colorbox") {
    parseRawArg(ctx);
    return [{ k: "group", body: parseArg(ctx) }];
  }

  if (name === "hspace") {
    skipStar(ctx);
    parseRawArg(ctx);
    return [{ k: "space", w: EM_WIDTH }];
  }

  if (name === "not") {
    skipWs(ctx);
    const t = ctx.toks[ctx.i];
    if (t && t.t === "char" && t.v === "=") {
      ctx.i += 1;
      return [glyphNode("≠", ctx)];
    }
    if (t && t.t === "cmd" && t.v === "in") {
      ctx.i += 1;
      return [glyphNode("∉", ctx)];
    }
    ctx.note("\\not");
    return [];
  }

  if (name === "xrightarrow" || name === "xleftarrow") {
    return [{ k: "xarrow", over: parseArg(ctx), dir: name === "xrightarrow" ? "right" : "left" }];
  }

  if (UPRIGHT_CMD.has(name)) {
    if (name === "operatorname") skipStar(ctx);
    // A formula or a unit with scripts (`\mathrm{Fe_{2}O_{3}}`, `\mathrm{m/s^{2}}`) is
    // maths set upright, not literal text: its `_` and `^` are scripts, never glyphs.
    skipWs(ctx);
    const open = ctx.toks[ctx.i];
    if (open && open.t === "open") {
      const m = matchClose(ctx.toks, ctx.i, ctx.end);
      const stop = m < 0 ? ctx.end : m;
      if (ctx.toks.slice(ctx.i + 1, stop).some((t) => t.t === "sup" || t.t === "sub")) {
        const body = subParse(ctx, ctx.i + 1, stop);
        ctx.i = m < 0 ? ctx.end : m + 1;
        return [{ k: "group", body, upright: true }];
      }
    }
    const text = parseRawArg(ctx);
    if (text === null) {
      ctx.note(`\\${name}`);
      return [];
    }
    if (isProse(text)) ctx.note(`\\${name}`);
    return [{ k: "upright", body: text, op: name === "operatorname" }];
  }

  if (FUNCTION_CMD.has(name)) {
    return [{ k: "upright", body: name, op: true }];
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

  if (name === "begin") return parseEnvironment(ctx);

  if (name === "end") {
    parseRawArg(ctx);
    return [];
  }

  ctx.note(`\\${name}`);
  return [];
}

function attachScript(nodes: Node[], slot: "sup" | "sub", arg: Node[]): void {
  const last = nodes[nodes.length - 1];
  if (last && (last.k === "script" || last.k === "bigop") && last[slot] === null) {
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
      const last = nodes[nodes.length - 1];
      if ((t.v === "limits" || t.v === "nolimits") && last && last.k === "bigop") {
        last.limits = t.v === "limits";
        ctx.i += 1;
        continue;
      }
      if (t.v === "lvert" || t.v === "lVert") {
        const m = matchCmdPair(ctx.toks, ctx.i, ctx.end, t.v, t.v === "lvert" ? "rvert" : "rVert");
        if (m > ctx.i + 1) {
          const bar = t.v === "lvert" ? "|" : "∥";
          nodes.push({ k: "fence", open: bar, close: bar, body: subParse(ctx, ctx.i + 1, m) });
          ctx.i = m + 1;
          continue;
        }
      }
      ctx.i += 1;
      for (const n of parseCommand(ctx, t.v)) nodes.push(n);
      continue;
    }
    // char
    if (t.v === "'") {
      let n = 0;
      while (ctx.i < ctx.end) {
        const p = ctx.toks[ctx.i];
        if (p.t !== "char" || p.v !== "'") break;
        n += 1;
        ctx.i += 1;
      }
      const base = nodes.pop();
      if (base) nodes.push({ k: "primed", base, n });
      else for (let k = 0; k < n; k++) nodes.push(glyphNode("′", ctx));
      continue;
    }
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
    if (t.v === "|") {
      // `|x|`, `\ln|x|`, `|x - 1| + |y|`: bars pair up left to right into a growing fence.
      const m = matchBar(ctx.toks, ctx.i + 1, ctx.end);
      if (m > ctx.i + 1) {
        const body = subParse(ctx, ctx.i + 1, m);
        ctx.i = m + 1;
        nodes.push({ k: "fence", open: "|", close: "|", body });
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
type Box = {
  strokes: RawStroke[];
  width: number;
  ascent: number;
  descent: number;
  cls: AtomClass;
  /** The class of the box's left edge when it differs from `cls` (a fence starts with an opener). */
  lead?: AtomClass;
};
type Style = { s: number; upright: boolean };
/** How far above and below the baseline the neighbouring content reaches. */
type Extent = { ascent: number; descent: number };

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

/** Horizontal extent of the ink, or null when there is none. */
function inkX(strokes: RawStroke[]): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (const st of strokes) {
    for (const p of st.pts) {
      if (p.x < min) min = p.x;
      if (p.x > max) max = p.x;
    }
  }
  return Number.isFinite(min) ? { min, max } : null;
}

function isIntegral(op: BigOp): boolean {
  return op === "int" || op === "iint" || op === "iiint" || op === "oint";
}

/**
 * Nodes whose size depends on their neighbours, laid out after them: an integral
 * sign grows to cover its integrand, and a `\bigg|` evaluation bar to cover the line.
 */
function stretchMode(n: Node): "integrand" | "line" | null {
  if (n.k === "bigop" && isIntegral(n.op)) return "integrand";
  if (n.k === "sized") return "line";
  if (n.k === "script" && n.base && n.base.k === "sized") return "line";
  return null;
}

/** A superscript that is only a degree sign: `30^\circ`, `90^{\circ}`. */
function isDegree(nodes: Node[]): boolean {
  if (nodes.length !== 1) return false;
  const only = nodes[0];
  if (only.k === "group") return isDegree(only.body);
  return only.k === "glyph" && (only.ch === "∘" || only.ch === "°");
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
    if (ch === "{" || ch === "}") return measure(this.tallBrace(ch, top, bottom, style.s), glyph.advance * style.s, classOf(ch));
    const k = want / have;
    const stretched = natural.map((st) => ({
      kind: st.kind,
      pts: st.pts.map((p) => ({ x: p.x, y: top + (p.y - minY) * k })),
    }));
    return measure(stretched, glyph.advance * style.s, classOf(ch));
  }

  /**
   * A brace drawn at its height rather than stretched: stretching the atlas `{` turns its
   * point into a long bulge that reads as a bracket. Hooks and the point keep their size;
   * only the straight runs between them grow. One stroke, top to bottom.
   */
  private tallBrace(ch: "{" | "}", top: number, bottom: number, s: number): RawStroke[] {
    const mid = (top + bottom) / 2;
    const r = Math.min(1.4 * s, (bottom - top) / 6);
    const X = (x: number): string => (ch === "{" ? x * s : (4.8 - x) * s).toFixed(3);
    const Y = (y: number): string => y.toFixed(3);
    const d = [
      `M ${X(3.9)} ${Y(top)}`,
      `C ${X(2.9)} ${Y(top)} ${X(2.5)} ${Y(top + 0.4 * r)} ${X(2.5)} ${Y(top + r)}`,
      `L ${X(2.5)} ${Y(mid - r)}`,
      `C ${X(2.5)} ${Y(mid - 0.4 * r)} ${X(2.1)} ${Y(mid)} ${X(1.0)} ${Y(mid)}`,
      `C ${X(2.1)} ${Y(mid)} ${X(2.5)} ${Y(mid + 0.4 * r)} ${X(2.5)} ${Y(mid + r)}`,
      `L ${X(2.5)} ${Y(bottom - r)}`,
      `C ${X(2.5)} ${Y(bottom - 0.4 * r)} ${X(2.9)} ${Y(bottom)} ${X(3.9)} ${Y(bottom)}`,
    ].join(" ");
    return samplePath(d).map((pts) => ({ kind: "delimiter" as const, pts }));
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
    // Pass 1: everything whose size is its own. Pass 2: what stretches to fit them.
    const boxes: Box[] = new Array<Box>(nodes.length);
    const deferred = new Set<number>();
    for (let i = 0; i < nodes.length; i++) {
      if (stretchMode(nodes[i])) deferred.add(i);
      else boxes[i] = this.node(nodes[i], style);
    }
    for (const i of deferred) boxes[i] = this.node(nodes[i], style, this.extentAround(nodes, boxes, deferred, i));

    const strokes: RawStroke[] = [];
    let x = 0;
    let prevCls: AtomClass | null = null;
    let prevSign = false;
    for (const b of boxes) {
      let cls = b.cls;
      const sign = cls === "bin" && isUnaryContext(prevCls);
      if (sign) cls = "ord";
      if (prevCls !== null && cls !== "space") {
        let gap = gapBetween(prevCls, cls, style.upright);
        // `\sin(x)`: no space between a function name and its bracket.
        if (prevCls === "op" && b.lead === "open") gap = TIGHT_GAP;
        // `-\sin x`: a sign stays with what it signs.
        if (prevSign && cls === "op") gap = ORD_GAP;
        x += gap * style.s;
      }
      if (cls !== "space") prevSign = sign;
      for (const st of shift(b.strokes, x, 0)) strokes.push(st);
      x += b.width;
      if (cls !== "space") prevCls = cls;
      else if (prevCls === null) prevCls = "space";
    }
    const cls = boxes.length === 1 ? boxes[0].cls : "ord";
    const box = measure(strokes, Math.max(0, x), cls);
    if (boxes.length === 1 && boxes[0].lead) box.lead = boxes[0].lead;
    return box;
  }

  /** What a stretching node has to cover: its integrand (up to the next relation), or the line. */
  private extentAround(nodes: Node[], boxes: Box[], deferred: Set<number>, i: number): Extent | null {
    let ascent = 0;
    let descent = 0;
    let any = false;
    const take = (b: Box): void => {
      ascent = Math.max(ascent, b.ascent);
      descent = Math.max(descent, b.descent);
      any = true;
    };
    if (stretchMode(nodes[i]) === "integrand") {
      for (let j = i + 1; j < nodes.length; j++) {
        if (deferred.has(j)) continue;
        if (boxes[j].cls === "rel") break;
        take(boxes[j]);
      }
    } else {
      for (let j = 0; j < nodes.length; j++) {
        if (j !== i && !deferred.has(j)) take(boxes[j]);
      }
    }
    return any ? { ascent, descent } : null;
  }

  node(n: Node, style: Style, ext: Extent | null = null): Box {
    switch (n.k) {
      case "glyph":
        return this.glyphBox(n.ch, n.cls, style);
      case "space":
        return { strokes: [], width: n.w * style.s, ascent: 0, descent: 0, cls: "space" };
      case "group":
        return this.run(n.body, n.upright ? { s: style.s, upright: true } : style);
      case "xarrow":
        return this.xarrowBox(n, style);
      case "upright":
        return this.uprightBox(n.body, style, n.op);
      case "frac":
        return this.fracBox(n, style);
      case "sqrt":
        return this.sqrtBox(n, style);
      case "script":
        return this.scriptBox(n, style, ext);
      case "fence":
        return this.fenceBox(n, style);
      case "boxed":
        return this.boxedBox(n, style);
      case "bigop":
        return this.bigOpBox(n, style, ext);
      case "sized":
        return this.sizedBox(n, style, ext);
      case "accent":
        return this.accentBox(n, style);
      case "primed":
        return this.primedBox(n, style);
      case "grid":
        return this.gridBox(n, style);
    }
  }

  private uprightBox(text: string, style: Style, op = false): Box {
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
    return { ...box, cls: op ? "op" : "ord" };
  }

  private fracBox(n: { num: Node[]; den: Node[]; bar: boolean }, style: Style): Box {
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
    // `\binom` stacks the same way, with no bar between.
    if (n.bar) strokes.push(this.rule(barW, barY, style.s, "rule"));
    for (const st of shift(den.strokes, (barW - den.width) / 2, denBase)) strokes.push(st);
    return measure(strokes, barW, "ord");
  }

  private scriptBox(n: { base: Node | null; sup: Node[] | null; sub: Node[] | null }, style: Style, ext: Extent | null): Box {
    const base = n.base ? this.node(n.base, style, ext) : EMPTY_BOX;
    return this.withScripts(base, n.sup, n.sub, style);
  }

  private withScripts(base: Box, supNodes: Node[] | null, subNodes: Node[] | null, style: Style): Box {
    if (supNodes && !subNodes && isDegree(supNodes)) return this.degreeBox(base, style);
    const child: Style = { s: Math.max(style.s * SCRIPT_SCALE, MIN_SCALE), upright: style.upright };
    const sup = supNodes ? this.run(supNodes, child) : null;
    const sub = subNodes ? this.run(subNodes, child) : null;

    let supY = -Math.max(SUP_SHIFT * style.s, base.ascent * 0.62);
    let subY = SUB_SHIFT * style.s;
    if (base.ascent > TALL_BASE * style.s) {
      // A tall base — `\right]`, `\bigg|`, a fence round a fraction — takes its scripts at
      // its corners: the upper limit level with its top, the lower one at its foot.
      if (sup) supY = Math.min(supY, -base.ascent + sup.ascent * 0.72);
      if (sub) subY = Math.max(subY, base.descent - sub.ascent * 0.2);
    }
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
    if (sub) for (const st of shift(sub.strokes, scriptX, subY)) strokes.push(st);
    if (sup) for (const st of shift(sup.strokes, scriptX, supY)) strokes.push(st);
    const width = scriptX + Math.max(sup?.width ?? 0, sub?.width ?? 0);
    return measure(strokes, width, base.cls === "space" ? "ord" : base.cls);
  }

  /** `30^\circ`: a small ring level with the top of what it follows, not a raised script. */
  private degreeBox(base: Box, style: Style): Box {
    const s = style.s;
    const ring = this.glyphBox("°", "ord", { s: s * 0.9, upright: style.upright });
    const top = -Math.max(base.ascent, 7.6 * s);
    const x = base.width + 0.1 * s;
    const strokes = [...base.strokes, ...shift(ring.strokes, x, top + ring.ascent)];
    return measure(strokes, x + ring.width, base.cls === "space" ? "ord" : base.cls);
  }

  /** `f'`, `y''`: primes hang at the top right of their base, full size, close together. */
  private primedBox(n: { base: Node; n: number }, style: Style): Box {
    const s = style.s;
    const base = this.node(n.base, style);
    const top = -Math.max(base.ascent, PRIME_TOP * s);
    const strokes = [...base.strokes];
    let x = base.width + 0.1 * s;
    let right = x;
    for (let k = 0; k < n.n; k++) {
      const prime = this.glyphBox("′", "ord", style);
      for (const st of shift(prime.strokes, x, top + prime.ascent)) strokes.push(st);
      right = x + prime.width;
      x += PRIME_STEP * s;
    }
    return measure(strokes, right, base.cls === "space" ? "ord" : base.cls);
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
    const box = measure(strokes, x, "ord");
    // `\sin(x)` closes up; `\ln|x|` keeps its thin space, as `|` is an ordinary symbol.
    if (n.open && n.open !== "|" && n.open !== "∥") box.lead = "open";
    return box;
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

  // -------------------------------------------------------------------------
  // Big operators, sized delimiters, accents and grids
  // -------------------------------------------------------------------------

  private bigOpBox(n: BigOpNode, style: Style, ext: Extent | null): Box {
    const s = style.s;
    const child: Style = { s: Math.max(s * SCRIPT_SCALE, MIN_SCALE), upright: false };
    if (n.op === "name") {
      const word = this.uprightBox(n.name, style, true);
      if (!n.sub && !n.sup) return word;
      return this.stackLimits(word, n, child, s, n.limits !== false);
    }
    if (n.op === "sum" || n.op === "prod") {
      const glyph = this.lookup(n.op === "sum" ? "Σ" : "Π");
      if (!glyph) {
        this.note(`\\${n.op}`);
        return EMPTY_BOX;
      }
      const k = SUM_SCALE * s;
      const raw = measure(this.stamp(glyph, k, 0, "glyph"), glyph.advance * k, "op");
      // centre the sign on the math axis, like a fraction bar
      const dy = -AXIS * s - (raw.descent - raw.ascent) / 2;
      const sign = measure(shift(raw.strokes, 0, dy), raw.width, "op");
      return this.stackLimits(sign, n, child, s, n.limits !== false);
    }
    return this.integralBox(n, style, ext, child);
  }

  /**
   * An integral sign drawn to span [top, bottom]: by default about two digits tall on the
   * axis, taller when the integrand is (a fraction under the sign stays inside it).
   * Limits sit at its corners — the lower one tucked in under the slant — or above and
   * below with `\limits`.
   */
  private integralBox(n: BigOpNode, style: Style, ext: Extent | null, child: Style): Box {
    const s = style.s;
    let top = (-AXIS - INT_HALF) * s;
    let bottom = (-AXIS + INT_HALF) * s;
    if (ext) {
      top = Math.min(top, -ext.ascent - INT_PAD * s);
      bottom = Math.max(bottom, ext.descent + INT_PAD * s);
    }
    const signs = n.op === "iint" ? 2 : n.op === "iiint" ? 3 : 1;
    const path = samplePath(BIG_OPERATORS.integral.paths[0])[0] ?? [];
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of path) {
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    const span = maxY - minY || 1;
    const strokes: RawStroke[] = [];
    for (let c = 0; c < signs; c++) {
      strokes.push({
        kind: "glyph",
        pts: path.map((p) => ({ x: p.x * s + c * INT_REPEAT * s, y: top + ((p.y - minY) / span) * (bottom - top) })),
      });
    }
    if (n.op === "oint") {
      const cx = 3.2 * s;
      const cy = (top + bottom) / 2;
      const ring: Pt[] = [];
      for (let i = 0; i <= 16; i++) {
        const a = -Math.PI / 2 + (i / 16) * Math.PI * 2;
        ring.push({ x: cx + Math.cos(a) * 1.9 * s, y: cy + Math.sin(a) * 2.3 * s });
      }
      strokes.push({ kind: "glyph", pts: ring });
    }
    const signRight = ((signs - 1) * INT_REPEAT + INT_WIDTH) * s;
    const sign = measure(strokes, signRight, "op");
    if (n.limits === true) return this.stackLimits(sign, n, child, s, true);

    const sub = n.sub ? this.run(n.sub, child) : null;
    const sup = n.sup ? this.run(n.sup, child) : null;
    const out = [...sign.strokes];
    let width = signRight;
    if (sub) {
      const x = ((signs - 1) * INT_REPEAT + INT_SUB_X) * s;
      for (const st of shift(sub.strokes, x, bottom - sub.descent)) out.push(st);
      width = Math.max(width, x + sub.width);
    }
    if (sup) {
      const x = signRight + INT_SCRIPT_GAP * s;
      for (const st of shift(sup.strokes, x, top + sup.ascent + 0.2 * s)) out.push(st);
      width = Math.max(width, x + sup.width);
    }
    return measure(out, width + INT_TRAIL * s, "op");
  }

  /**
   * A sign or word with its limits written under (and over) it, everything centred on
   * the sign's ink: `\lim_{x \to 2}`, `\sum_{i=1}^{n}`. With `below = false` the
   * limits go at the right instead, as ordinary scripts.
   */
  private stackLimits(sign: Box, n: BigOpNode, child: Style, s: number, below: boolean): Box {
    if (!below) return { ...this.withScripts(sign, n.sup, n.sub, { s, upright: false }), cls: "op" };
    const sub = n.sub ? this.run(n.sub, child) : null;
    const sup = n.sup ? this.run(n.sup, child) : null;
    const parts = [sign, sub, sup];
    const inks = parts.map((b) => (b ? inkX(b.strokes) : null));
    const width = Math.max(...inks.map((ink) => (ink ? ink.max - ink.min : 0)));
    const pad = OP_SIDE * s;
    const centre = (b: Box, ink: { min: number; max: number } | null, dy: number): RawStroke[] =>
      ink ? shift(b.strokes, pad + (width - (ink.max - ink.min)) / 2 - ink.min, dy) : [];

    const out: RawStroke[] = [...centre(sign, inks[0], 0)];
    if (sub) out.push(...centre(sub, inks[1], sign.descent + LIMIT_GAP * s + sub.ascent));
    if (sup) out.push(...centre(sup, inks[2], -sign.ascent - LIMIT_GAP * s - sup.descent));
    return measure(out, width + 2 * pad, "op");
  }

  /** `\xrightarrow{\Delta}`: an arrow long enough for the condition written over it. */
  private xarrowBox(n: { over: Node[]; dir: "right" | "left" }, style: Style): Box {
    const s = style.s;
    const over = n.over.length > 0 ? this.run(n.over, { s: Math.max(s * SCRIPT_SCALE, MIN_SCALE), upright: style.upright }) : null;
    const len = Math.max(7.4 * s, (over?.width ?? 0) + 2.4 * s);
    const x0 = 1.0 * s;
    const x1 = x0 + len;
    const y = -3.0 * s;
    const tip = n.dir === "right" ? x1 : x0;
    const back = n.dir === "right" ? -2.2 * s : 2.2 * s;
    const strokes: RawStroke[] = [
      { kind: "glyph", pts: [{ x: n.dir === "right" ? x0 : x1, y }, { x: (x0 + x1) / 2, y: y - 0.06 * s }, { x: tip, y }] },
      { kind: "glyph", pts: [{ x: tip + back, y: y - 2.2 * s }, { x: tip, y }, { x: tip + back, y: y + 2.2 * s }] },
    ];
    if (over) {
      const ink = inkX(over.strokes) ?? { min: 0, max: over.width };
      const dx = (x0 + x1) / 2 - (ink.min + ink.max) / 2;
      strokes.push(...shift(over.strokes, dx, y - 2.6 * s - over.descent));
    }
    return measure(strokes, x1 + 1.0 * s, "rel");
  }

  /** `\big(`, `\Bigg]`, `\bigg|`: a fixed size, grown further to cover the line it is in. */
  private sizedBox(n: { ch: string; mult: number; cls: AtomClass }, style: Style, ext: Extent | null): Box {
    const s = style.s;
    const h = n.mult * DELIM_NATURAL * s;
    const centre = -DELIM_CENTER * s;
    let top = centre - h / 2;
    let bottom = centre + h / 2;
    if (ext) {
      top = Math.min(top, -ext.ascent - FENCE_PAD * s);
      bottom = Math.max(bottom, ext.descent + FENCE_PAD * s);
    }
    const box = this.delimiterBox(n.ch, top, bottom, style);
    return { ...box, cls: n.cls };
  }

  private accentBox(n: { accent: Accent; body: Node[] }, style: Style): Box {
    const s = style.s;
    const body = this.run(n.body, style);
    const ink = inkX(body.strokes) ?? { min: 0, max: body.width };
    const mid = (ink.min + ink.max) / 2;
    const top = -Math.max(body.ascent, 4.4 * s);
    const strokes = [...body.strokes];
    const line = (x0: number, x1: number, y: number, kind: StrokeKind): void => {
      // A short bar is one flick: the four-point rule's tremor would turn it into a tilde.
      if (x1 - x0 < 8 * s) strokes.push({ kind, pts: [{ x: x0, y: y + 0.05 * s }, { x: x1, y: y - 0.05 * s }] });
      else strokes.push(...shift([this.rule(x1 - x0, y, s, kind)], x0, 0));
    };
    const dot = (x: number, y: number): void => {
      strokes.push({ kind: "glyph", pts: [{ x: x - 0.1 * s, y }, { x: x + 0.12 * s, y: y + 0.5 * s }] });
    };
    switch (n.accent) {
      case "overline":
        line(ink.min - 0.3 * s, ink.max + 0.3 * s, top - ACCENT_GAP * s, "rule");
        break;
      case "bar":
        line(ink.min + 0.1 * s, ink.max - 0.1 * s, top - ACCENT_GAP * s, "rule");
        break;
      case "underline":
        line(ink.min - 0.3 * s, ink.max + 0.3 * s, body.descent + 1.2 * s, "rule");
        break;
      case "vec": {
        const y = top - 2.6 * s;
        const x0 = ink.min;
        const x1 = Math.max(ink.max + 0.3 * s, ink.min + 4 * s);
        strokes.push({ kind: "glyph", pts: [{ x: x0, y: y + 0.05 * s }, { x: (x0 + x1) / 2, y: y - 0.06 * s }, { x: x1, y }] });
        strokes.push({ kind: "glyph", pts: [{ x: x1 - 1.5 * s, y: y - 1.1 * s }, { x: x1, y }, { x: x1 - 1.5 * s, y: y + 1.1 * s }] });
        break;
      }
      case "hat": {
        const w = Math.min(2.2 * s, (ink.max - ink.min) / 2 + 0.6 * s);
        const y = top - 0.8 * s;
        strokes.push({ kind: "glyph", pts: [{ x: mid - w, y }, { x: mid, y: y - 1.8 * s }, { x: mid + w, y }] });
        break;
      }
      case "tilde": {
        const w = Math.min(2.4 * s, (ink.max - ink.min) / 2 + 0.6 * s);
        const y = top - 1.4 * s;
        const pts: Pt[] = [];
        for (let i = 0; i <= 8; i++) {
          const t = i / 8;
          pts.push({ x: mid - w + 2 * w * t, y: y - Math.sin(t * Math.PI * 2) * 0.55 * s });
        }
        strokes.push({ kind: "glyph", pts });
        break;
      }
      case "dot":
        dot(mid, top - 1.6 * s);
        break;
      case "ddot":
        dot(mid - 1.0 * s, top - 1.6 * s);
        dot(mid + 1.0 * s, top - 1.6 * s);
        break;
    }
    return measure(strokes, body.width, body.cls);
  }

  /**
   * `cases`, the matrices, `array` and `aligned`: cells in rows on a baseline grid,
   * columns aligned, the whole block centred on the math axis between its delimiters.
   */
  private gridBox(n: GridNode, style: Style): Box {
    const s = style.s * n.scale;
    const cellStyle: Style = { s, upright: style.upright };
    const cells = n.rows.map((row) => row.map((cell) => this.run(cell, cellStyle)));
    if (cells.length === 0) return EMPTY_BOX;
    const cols = Math.max(...cells.map((row) => row.length));
    const colW: number[] = [];
    for (let j = 0; j < cols; j++) colW.push(Math.max(0, ...cells.map((row) => row[j]?.width ?? 0)));
    const alignOf = (j: number): Align => (n.pairs ? (j % 2 === 0 ? "r" : "l") : (n.align[Math.min(j, n.align.length - 1)] ?? "c"));
    const gapBefore = (j: number): number => (n.pairs ? (j % 2 === 1 ? THICK_SPACE : 2 * EM_WIDTH) : n.colGap) * s;

    const colX: number[] = [];
    let x = 0;
    for (let j = 0; j < cols; j++) {
      if (j > 0) x += gapBefore(j);
      colX.push(x);
      x += colW[j];
    }
    const gridW = x;

    const baselines: number[] = [];
    let y = 0;
    let prevDescent = 0;
    cells.forEach((row, i) => {
      const ascent = Math.max(4.4 * s, ...row.map((c) => c.ascent));
      if (i > 0) y += Math.max(GRID_ROW_MIN * s, prevDescent + GRID_ROW_GAP * s + ascent);
      baselines.push(y);
      prevDescent = Math.max(0.4 * s, ...row.map((c) => c.descent));
    });
    const firstAscent = Math.max(4.4 * s, ...cells[0].map((c) => c.ascent));
    const gridTop = -firstAscent;
    const gridBottom = y + prevDescent;
    const dy = -AXIS * style.s - (gridTop + gridBottom) / 2;

    const pad = FENCE_PAD * style.s;
    const open = this.delimiterBox(n.open, gridTop + dy - pad, gridBottom + dy + pad, style);
    const close = this.delimiterBox(n.close, gridTop + dy - pad, gridBottom + dy + pad, style);
    const left = open.width > 0 ? open.width + GRID_DELIM_GAP * style.s : 0;

    const strokes: RawStroke[] = [...open.strokes];
    cells.forEach((row, i) => {
      row.forEach((cell, j) => {
        const a = alignOf(j);
        const cx = colX[j] + (a === "r" ? colW[j] - cell.width : a === "c" ? (colW[j] - cell.width) / 2 : 0);
        for (const st of shift(cell.strokes, left + cx, baselines[i] + dy)) strokes.push(st);
      });
    });
    let width = left + gridW;
    if (close.width > 0) {
      width += GRID_DELIM_GAP * style.s;
      for (const st of shift(close.strokes, width, 0)) strokes.push(st);
      width += close.width;
    }
    const box = measure(strokes, width, "ord");
    if (n.open) box.lead = "open";
    return box;
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
