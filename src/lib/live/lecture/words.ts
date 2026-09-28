import { ATLAS, EM_BASELINE, glyphKey, mulberry32, pickGlyph, samplePath, withTremor, type Glyph, type GlyphPick, type InkPt, type Stroke } from "@/lib/hand";
import type { Rect } from "../contracts";
import { PEN, type Align, type Pt, type VAlign } from "../graphing/pen";

/**
 * Plain words in the tutor's hand: a heading, a note, the labels of a chart or a diagram.
 *
 * The board's maths goes through `layoutMath`, which refuses prose on purpose (the board carries
 * no words). Lecture mode does write words — short and plain — so they are laid out here, glyph by
 * glyph from the same atlas and with the same tremor as `\text{…}` in the worked steps, so a label
 * and a formula on one screen are one hand. Per line, not per block: the planners need to wrap to
 * a width, cap the number of lines, shrink to fit a box and know exactly where each line's ink is.
 *
 * Text is normalised before it is written: accents are dropped (`café` → `cafe`), curly quotes and
 * dashes become the hand's own, a few symbols the atlas lacks are drawn from `EXTRA` below (`%`,
 * `°`, `"`, `$`, `&`…) and anything else with no glyph is left out — never drawn as a box.
 *
 * Units: the atlas em box is 14 tall with the baseline at 11; `size` is px per 14 em units (as
 * everywhere in the hand), so a capital is ~0.62 × size tall and a digit 0.63 × size.
 */

export const WORDS = {
  /** em units from the writing line up to the top of a capital (with the pen's width); taller ink raises it */
  cap: 8.8,
  /** em units the layout box reaches below the writing line; a descender takes it lower */
  foot: 1.4,
  /** baseline to baseline of wrapped lines, in em units */
  lineStep: 15.2,
  /**
   * Ink to ink between two letters, em units. Letters are spaced by their ink, not by the atlas
   * advances: those carry a side bearing that is 0.4 on most letters but 2.2 on `m`, which wrote
   * "tem perature".
   */
  tracking: 2.3,
  /** the extra gap between two words, em units */
  space: 4.4,
  /** a glyph sits this far (em, ±) off the writing line, as a hand does */
  jitter: 0.16,
  /** the pen's tremor, em units (the worked steps use the same) */
  tremor: 0.42,
  /** a raised or lowered digit (`m²`, `H₂O`): its scale and shift (em) */
  script: { scale: 0.62, up: 4.6, down: 2.6 },
} as const;

// ------------------------------------------------------------------ glyphs the atlas lacks

function g(advance: number, ...paths: string[]): Glyph {
  return { advance, paths };
}

/**
 * Symbols everyday lecture words need that the atlas has not got, drawn on the same 10 × 14 em box
 * in the same hand (`%` and `°` are the maths layout's own shapes).
 */
const EXTRA: Record<string, Glyph> = {
  "%": g(8.6, "M 6.8 3.0 L 1.6 11.2", "M 2.3 3.4 C 3.5 3.4 3.5 5.4 2.3 5.4 C 1.1 5.4 1.1 3.4 2.3 3.4", "M 6.4 8.8 C 7.6 8.8 7.6 10.8 6.4 10.8 C 5.2 10.8 5.2 8.8 6.4 8.8"),
  "°": g(4.4, "M 2.2 3.0 C 3.6 3.0 3.6 5.2 2.2 5.2 C 0.9 5.2 0.9 3.0 2.2 3.0"),
  '"': g(4.4, "M 1.4 2.8 L 1.2 4.8", "M 3.2 2.8 L 3.0 4.8"),
  $: g(7.6, "M 6.4 4.4 C 5.8 3.0 2.6 3.0 2.6 5.0 C 2.6 6.8 6.6 6.8 6.6 9.0 C 6.6 11.0 3.0 11.2 2.2 9.8", "M 4.4 1.8 L 4.4 12.4"),
  "£": g(7.6, "M 6.4 4.0 C 5.8 2.4 3.2 2.4 3.2 4.8 L 3.2 10.0 C 3.2 10.8 2.6 11.2 1.8 11.3 L 6.8 11.3", "M 1.8 7.2 L 5.2 7.2"),
  "€": g(8.2, "M 7.4 4.0 C 6.2 2.4 2.8 2.6 2.6 7.0 C 2.4 11.4 6.0 12.0 7.4 10.2", "M 1.0 6.2 L 5.4 6.2 M 1.0 8.2 L 5.2 8.2"),
  "&": g(8.2, "M 7.2 11.3 L 2.8 5.8 C 1.8 4.4 2.4 2.6 3.9 2.6 C 5.4 2.6 5.9 4.2 4.8 5.4 L 2.6 7.6 C 1.2 9.2 2.0 11.4 4.0 11.4 C 5.6 11.4 6.6 10.2 7.2 8.6"),
  "#": g(8.4, "M 3.6 3.2 L 2.8 11.0", "M 6.2 3.2 L 5.4 11.0", "M 1.6 5.8 L 7.4 5.8 M 1.2 8.6 L 7.0 8.6"),
  "<": g(7.0, "M 6.2 5.8 L 1.2 8.5 L 6.2 11.0"),
  ">": g(7.0, "M 1.4 5.8 L 6.4 8.5 L 1.4 11.0"),
  "≈": g(7.2, "M 1.0 7.4 C 1.9 6.5 2.5 8.3 3.4 7.4 C 4.3 6.5 4.9 8.3 5.8 7.4", "M 1.0 9.8 C 1.9 8.9 2.5 10.7 3.4 9.8 C 4.3 8.9 4.9 10.7 5.8 9.8"),
  "≤": g(7.2, "M 6.2 5.0 L 1.2 7.5 L 6.2 9.8", "M 1.3 11.4 L 6.2 11.3"),
  "≥": g(7.2, "M 1.4 5.0 L 6.4 7.5 L 1.4 9.8", "M 1.3 11.4 L 6.2 11.3"),
  "±": g(6.6, "M 1.0 7.0 L 5.4 6.9 M 3.2 4.6 L 3.2 9.2", "M 1.0 10.8 L 5.6 10.7"),
  "·": g(3.6, "M 1.5 8.2 L 1.8 8.7"),
};

/** Characters rewritten before writing: typography the hand writes plainly, and letters it writes as two. */
const MAP: Record<string, string> = {
  "‘": "'",
  "’": "'",
  "‚": "'",
  "′": "'",
  "´": "'",
  "`": "'",
  "“": '"',
  "”": '"',
  "„": '"',
  "«": '"',
  "»": '"',
  "″": '"',
  "—": "-",
  "–": "-",
  "‒": "-",
  "‐": "-",
  "‑": "-",
  "−": "-",
  "­": "",
  "•": "",
  "◦": "",
  "‣": "",
  "*": "",
  "_": " ",
  "~": "≈",
  "|": "/",
  "×": "×",
  "ß": "ss",
  "æ": "ae",
  "Æ": "AE",
  "œ": "oe",
  "Œ": "OE",
  "ø": "o",
  "Ø": "O",
  "ł": "l",
  "Ł": "L",
  "đ": "d",
  "Đ": "D",
  "þ": "th",
  "ð": "d",
  "ı": "i",
  "½": "1/2",
  "¼": "1/4",
  "¾": "3/4",
  "@": "at",
  "…": "...",
  " ": " ",
  " ": " ",
  " ": " ",
  "→": "→",
  "⇒": "→",
  "←": "←",
  "µ": "μ",
  "℃": "°C",
  "℉": "°F",
  "°": "°",
  "º": "°",
  "˚": "°",
};

const SUPERS: Record<string, string> = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁻": "-", "⁺": "+" };
const SUBS: Record<string, string> = { "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9" };

function glyphsOf(ch: string): Glyph[] | null {
  const extra = EXTRA[ch];
  if (extra) return [extra];
  const alts = ATLAS[glyphKey(ch)];
  return alts && alts.length > 0 ? alts : null;
}

/** Can the hand write this character (after normalising)? */
export function canWrite(ch: string): boolean {
  if (ch === " ") return true;
  if (SUPERS[ch] || SUBS[ch]) return true;
  // the atlas maps `*` to × for maths; in words a star is decoration
  if (ch === "*") return false;
  return glyphsOf(ch) !== null;
}

/**
 * The text as the hand will write it: accents dropped, quotes and dashes made plain, symbols the
 * hand has no glyph for mapped or left out, spaces collapsed. `\n` is kept (a forced line break).
 */
export function normaliseWords(text: string): string {
  const out: string[] = [];
  // NFKD would turn `²` into `2` and `½` into `1⁄2`: decompose only the accents
  for (const raw of text.normalize("NFD")) {
    if (/[̀-ͯ]/.test(raw)) continue;
    if (raw === "\n") {
      out.push("\n");
      continue;
    }
    if (/\s/.test(raw)) {
      out.push(" ");
      continue;
    }
    const mapped = MAP[raw] ?? raw;
    for (const ch of mapped) if (canWrite(ch)) out.push(ch);
  }
  return out
    .join("")
    .split("\n")
    .map((l) => l.replace(/ +/g, " ").trim())
    .filter((l) => l.length > 0)
    .join("\n");
}

// ------------------------------------------------------------------ measuring

type Ink = { minX: number; maxX: number; minY: number; maxY: number };

/** Ink extents of a glyph (em units), cached. */
const inkCache = new Map<Glyph, Ink>();
function inkOf(glyph: Glyph): Ink {
  let m = inkCache.get(glyph);
  if (m) return m;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const path of glyph.paths) {
    for (const poly of samplePath(path)) {
      for (const p of poly) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      }
    }
  }
  m = Number.isFinite(minX) ? { minX, maxX, minY, maxY } : { minX: 0, maxX: glyph.advance, minY: EM_BASELINE, maxY: EM_BASELINE };
  inkCache.set(glyph, m);
  return m;
}

/** How far the pen moves on after a glyph at scale `s` (em): its ink, then the tracking. */
function advanceOf(glyph: Glyph, s: number): number {
  const ink = inkOf(glyph);
  return (ink.maxX - ink.minX) * s + WORDS.tracking * (s === 1 ? 1 : 0.75);
}

interface Token {
  ch: string;
  /** 0 on the line, 1 raised (a superscript), -1 lowered (a subscript) */
  shift: 0 | 1 | -1;
}

function tokens(line: string): Token[] {
  const out: Token[] = [];
  for (const ch of line) {
    if (SUPERS[ch]) out.push({ ch: SUPERS[ch], shift: 1 });
    else if (SUBS[ch]) out.push({ ch: SUBS[ch], shift: -1 });
    else out.push({ ch, shift: 0 });
  }
  return out;
}

/** Width of one line of ink, em units (first glyph's ink to last glyph's ink). */
function lineWidthEm(line: string): number {
  let x = 0;
  let right = 0;
  let any = false;
  for (const t of tokens(line)) {
    if (t.ch === " ") {
      if (any) x += WORDS.space;
      continue;
    }
    const glyph = glyphsOf(t.ch)?.[0];
    if (!glyph) continue;
    const k = t.shift === 0 ? 1 : WORDS.script.scale;
    const ink = inkOf(glyph);
    right = x + (ink.maxX - ink.minX) * k;
    x += advanceOf(glyph, k);
    any = true;
  }
  return any ? right : 0;
}

/** How far a line's ink reaches above and below its writing line (em), at least the usual cap and foot. */
function lineExtentEm(line: string): { above: number; below: number } {
  let above: number = WORDS.cap;
  let below: number = WORDS.foot;
  for (const t of tokens(line)) {
    if (t.ch === " ") continue;
    const glyph = glyphsOf(t.ch)?.[0];
    if (!glyph) continue;
    const k = t.shift === 0 ? 1 : WORDS.script.scale;
    const lift = t.shift === 1 ? -WORDS.script.up : t.shift === -1 ? WORDS.script.down : 0;
    const ink = inkOf(glyph);
    // the pen's tremor and a glyph's jitter take ink a little past its outline
    above = Math.max(above, (EM_BASELINE - ink.minY) * k - lift + 0.5);
    below = Math.max(below, (ink.maxY - EM_BASELINE) * k + lift + 0.5);
  }
  return { above, below };
}

/**
 * Whether a word too long for its line may be broken where it has no hyphen of its own
 * (`Photo-` / `synthesis`). Off: a planner first tries every layout with whole words, and only
 * when none fits does it try again with this on (`hyphenating`) — a broken word is better than no
 * sketch, but worse than a smaller box or another arrangement.
 */
let hyphenate = false;

/** Runs `f` with syllable breaks allowed (or not), and puts the setting back. */
export function hyphenating<T>(on: boolean, f: () => T): T {
  const before = hyphenate;
  hyphenate = on;
  try {
    return f();
  } finally {
    hyphenate = before;
  }
}

export interface WordsOptions {
  /** wrap at this width (px); a word wider than it does not fit */
  maxWidth?: number;
  /** at most this many lines (after wrapping), else it does not fit */
  maxLines?: number;
  /**
   * Lines of even length (a label in a box: "the water / cycle" rather than "the water cycle /
   * of"), instead of filling each line before the next (prose, a note).
   */
  balance?: boolean;
}

export interface WordsLayout {
  /** the words as written (normalised; a forced break as a space) */
  text: string;
  lines: string[];
  /** px widths of the lines' ink */
  widths: number[];
  /** the layout box: the widest line, and the top of the first line's ink to the bottom of the last's */
  w: number;
  h: number;
  /** px from the top of the box down to the first writing line */
  ascent: number;
  size: number;
}

/**
 * A word, or a part of one: a line may break after `Alpha-` in `Alpha-ketoglutarate` or after
 * `Runoff/` in `Runoff/Infiltration`, and — only when a word is too long for the width at all — at
 * a syllable-like break inside it, where the hand writes a hyphen (`Photo-` / `synthesis`).
 */
interface Piece {
  text: string;
  /** joined to the piece before without a space (the rest of a word) */
  glue: boolean;
  /** a break before this piece is inside a word: the line before it ends with a written hyphen */
  soft: boolean;
}

const VOWEL = /[aeiouyAEIOUY]/;
/** consonant pairs a syllable starts with or that make one sound: never split */
const CLUSTER = /^(bl|br|ch|ck|cl|cr|dr|fl|fr|gh|gl|gr|kn|ng|ph|pl|pr|qu|sc|sh|sk|sl|sm|sn|sp|st|sw|th|tr|tw|wh|wr)$/i;

/** Where a long word may break with a hyphen: before a consonant between vowels, or between two consonants. */
function softBreaks(word: string): number[] {
  const out: number[] = [];
  if (!/^[A-Za-z]{9,}$/.test(word)) return out;
  for (let i = 4; i <= word.length - 3; i++) {
    const a = word[i - 1];
    const b = word[i];
    const c = word[i + 1] ?? "";
    const vcv = VOWEL.test(a) && !VOWEL.test(b) && VOWEL.test(c);
    const cc = !VOWEL.test(a) && !VOWEL.test(b) && !CLUSTER.test(a + b);
    if (vcv || cc) out.push(i);
  }
  return out;
}

function piecesOf(words: readonly string[], maxEm: number): Piece[] {
  const out: Piece[] = [];
  for (const w of words) {
    // after a hyphen or a slash between letters: a break that needs no mark
    const parts = w.split(/(?<=[A-Za-z]{2}[-/])(?=[A-Za-z]{2})/);
    parts.forEach((part, i) => {
      // a plain word is hyphenated only when it is wider than a whole line
      const cuts = hyphenate && lineWidthEm(part) > maxEm ? softBreaks(part) : [];
      let from = 0;
      for (const c of [...cuts, part.length]) {
        out.push({ text: part.slice(from, c), glue: i > 0 || from > 0, soft: from > 0 });
        from = c;
      }
    });
  }
  return out;
}

function joinPieces(pieces: readonly Piece[], i: number, j: number): string {
  let out = "";
  for (let q = i; q < j; q++) out += (q > i && !pieces[q].glue ? " " : "") + pieces[q].text;
  // a word broken where it has no hyphen of its own: the hand writes one
  if (j < pieces.length && pieces[j].soft) out += "-";
  return out;
}

/** A break inside a hyphenated word reads worse than one between words: it counts as this much wider (em). */
const HYPHEN_BREAK = 6;
/** …and one inside a plain word much worse: only when the word will not fit any other way. */
const SOFT_BREAK = 40;

function breakCost(pieces: readonly Piece[], at: number): number {
  if (at <= 0 || at >= pieces.length || !pieces[at].glue) return 0;
  return pieces[at].soft ? SOFT_BREAK : HYPHEN_BREAK;
}

/** Splits the pieces into at most `k` lines, minimising the widest (em); null when one piece alone is wider than `maxEm`. */
function balanced(pieces: readonly Piece[], k: number, maxEm: number): string[] | null {
  const n = pieces.length;
  const width = (i: number, j: number) => lineWidthEm(joinPieces(pieces, i, j));
  // best[j][m]: the smallest widest line for pieces[0..j) in m lines
  const best: number[][] = Array.from({ length: n + 1 }, () => Array(k + 1).fill(Infinity));
  const cut: number[][] = Array.from({ length: n + 1 }, () => Array(k + 1).fill(-1));
  best[0][0] = 0;
  for (let j = 1; j <= n; j++) {
    for (let m = 1; m <= k; m++) {
      for (let i = m - 1; i < j; i++) {
        if (best[i][m - 1] === Infinity) continue;
        const w = width(i, j);
        if (w > maxEm) continue;
        const penalty = breakCost(pieces, i) + breakCost(pieces, j);
        const v = Math.max(best[i][m - 1], w + penalty);
        if (v < best[j][m] - 1e-9) {
          best[j][m] = v;
          cut[j][m] = i;
        }
      }
    }
  }
  let m = 0;
  for (let c = 1; c <= k; c++) if (best[n][c] < Infinity && (m === 0 || best[n][c] < best[n][m] - 1e-9)) m = c;
  if (m === 0) return null;
  const lines: string[] = [];
  let j = n;
  for (let c = m; c >= 1; c--) {
    const i = cut[j][c];
    lines.unshift(joinPieces(pieces, i, j));
    j = i;
  }
  return lines;
}

/** Greedy wrapping (prose): each line as full as it goes. Null when a piece alone is wider than `maxEm`. */
function greedy(pieces: readonly Piece[], maxEm: number): string[] | null {
  const lines: string[] = [];
  let start = 0;
  for (let q = 0; q < pieces.length; q++) {
    if (lineWidthEm(joinPieces(pieces, q, q + 1)) > maxEm) return null;
    if (q === start || lineWidthEm(joinPieces(pieces, start, q + 1)) <= maxEm) continue;
    // piece q does not fit on this line: a whole word goes down when it can; a word too long for
    // a line of its own breaks at its own hyphen or slash if one fits, else where the hand hyphenates
    let cut = q;
    if (pieces[q].glue) {
      let ws = q;
      while (ws > 0 && pieces[ws].glue) ws--;
      let we = q + 1;
      while (we < pieces.length && pieces[we].glue) we++;
      if (ws > start && lineWidthEm(joinPieces(pieces, ws, we)) <= maxEm) cut = ws;
      else {
        const fits = (c: number) => c > start && lineWidthEm(joinPieces(pieces, start, c)) <= maxEm;
        let hard = -1;
        let soft = -1;
        for (let c = Math.max(ws, start + 1); c <= q; c++) {
          if (!fits(c)) continue;
          if (pieces[c].soft) soft = c;
          else hard = c;
        }
        cut = hard > 0 ? hard : soft > 0 ? soft : q;
      }
    }
    lines.push(joinPieces(pieces, start, cut));
    start = cut;
    // the pieces from `cut` to `q` are on the new line: check it again from there
    q = cut - 1;
  }
  if (start < pieces.length) lines.push(joinPieces(pieces, start, pieces.length));
  return lines;
}

/**
 * How the words lay out at this hand size: the lines, and the block's box. Null when the text is
 * empty or does not fit `maxWidth` / `maxLines`.
 */
export function measureWords(text: string, size: number, opts: WordsOptions = {}): WordsLayout | null {
  // planners try many layouts and measure the same words over and over: remember the answers
  const key = `${size}|${opts.maxWidth ?? ""}|${opts.maxLines ?? ""}|${opts.balance ? 1 : 0}|${hyphenate ? 1 : 0}|${text}`;
  const known = measured.get(key);
  if (known !== undefined) return known;
  const out = measureFresh(text, size, opts);
  if (measured.size >= 20_000) measured.clear();
  measured.set(key, out);
  return out;
}

const measured = new Map<string, WordsLayout | null>();

function measureFresh(text: string, size: number, opts: WordsOptions): WordsLayout | null {
  const clean = normaliseWords(text);
  if (!clean || !(size > 0)) return null;
  const k = size / 14;
  const maxEm = opts.maxWidth !== undefined ? opts.maxWidth / k : Infinity;
  const maxLines = opts.maxLines ?? Infinity;
  const lines: string[] = [];
  for (const para of clean.split("\n")) {
    const words = para.split(" ").filter(Boolean);
    if (words.length === 0) continue;
    const pieces = piecesOf(words, maxEm);
    let wrapped: string[] | null;
    if (maxEm === Infinity) wrapped = [words.join(" ")];
    else if (opts.balance) {
      const room = Math.max(1, Math.min(pieces.length, (Number.isFinite(maxLines) ? maxLines : pieces.length) - lines.length));
      // the fewest lines that fit, then as even as they go
      wrapped = null;
      for (let c = 1; c <= room && !wrapped; c++) wrapped = balanced(pieces, c, maxEm);
    } else wrapped = greedy(pieces, maxEm);
    if (!wrapped) return null;
    lines.push(...wrapped);
  }
  if (lines.length === 0 || lines.length > maxLines) return null;
  const widths = lines.map((l) => lineWidthEm(l) * k);
  const w = Math.max(...widths);
  const above = lineExtentEm(lines[0]).above;
  const below = lineExtentEm(lines[lines.length - 1]).below;
  const h = (above + WORDS.lineStep * (lines.length - 1) + below) * k;
  return { text: clean.replace(/\n/g, " "), lines, widths, w, h, ascent: above * k, size };
}

/**
 * The largest hand size from `maxSize` down to `minSize` (in `step`s) at which the text fits
 * `maxWidth` × `maxHeight` in at most `maxLines` lines. Null when it does not fit even at the
 * smallest — the caller makes room or leaves it out, never overflows.
 */
export function fitWords(
  text: string,
  fit: { maxWidth: number; maxHeight?: number; maxLines: number; maxSize: number; minSize: number; step?: number; balance?: boolean },
): WordsLayout | null {
  const step = fit.step ?? 1;
  for (let size = fit.maxSize; size >= fit.minSize - 1e-9; size -= step) {
    const m = measureWords(text, size, { maxWidth: fit.maxWidth, maxLines: fit.maxLines, balance: fit.balance });
    if (m && m.w <= fit.maxWidth + 1e-6 && (fit.maxHeight === undefined || m.h <= fit.maxHeight + 1e-6)) return m;
  }
  return null;
}

// ------------------------------------------------------------------ writing

export interface WrittenLine {
  text: string;
  /** left of the line's ink, its writing line (px) and its ink width */
  x: number;
  baseline: number;
  w: number;
}

export interface Words {
  text: string;
  strokes: Stroke[];
  /** where the ink is: the layout box and every stroke inside it (what other ink must keep off) */
  rect: Rect;
  /** the layout box the words were aligned by */
  box: Rect;
  lines: WrittenLine[];
  size: number;
}

/**
 * A glyph's polyline resampled to `PEN.step` (geometry unchanged): tldraw's freehand smoothing
 * pulls each point only part of the way to the next, so a sparse glyph loses its corners on the
 * board (see `HAND_WRITE.resampleStepPx` and `writeMath`).
 */
export function resample(points: readonly InkPt[]): InkPt[] {
  const out: InkPt[] = points.length ? [{ ...points[0] }] : [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / PEN.step));
    for (let j = 1; j <= n; j++) out.push({ x: a.x + ((b.x - a.x) * j) / n, y: a.y + ((b.y - a.y) * j) / n, z: a.z + ((b.z - a.z) * j) / n });
  }
  return out;
}

/** One line of words as strokes, its ink starting at x = 0 on the writing line `baseline`; and its ink width (px). */
function writeLine(line: string, baseline: number, k: number, rng: () => number, prev: GlyphPick, seed: { n: number }): { strokes: Stroke[]; w: number } {
  const out: Stroke[] = [];
  let x = 0;
  let right = 0;
  let any = false;
  for (const t of tokens(line)) {
    if (t.ch === " ") {
      if (any) x += WORDS.space;
      continue;
    }
    const extra = EXTRA[t.ch];
    const glyph = extra ?? pickGlyph(t.ch, rng, prev);
    if (!glyph) continue;
    const s = t.shift === 0 ? 1 : WORDS.script.scale;
    const ink = inkOf(glyph);
    const lift = t.shift === 1 ? -WORDS.script.up : t.shift === -1 ? WORDS.script.down : 0;
    const jitter = (rng() - 0.5) * 2 * WORDS.jitter;
    for (const path of glyph.paths) {
      for (const poly of samplePath(path)) {
        if (poly.length < 2) continue;
        const pts = poly.map((p) => ({
          x: (x + (p.x - ink.minX) * s) * k,
          y: baseline + ((p.y - EM_BASELINE) * s + lift + jitter) * k,
        }));
        seed.n = (seed.n + 131) >>> 0;
        out.push({ points: withTremor(pts, seed.n, WORDS.tremor * k), order: 0, kind: "glyph" });
      }
    }
    right = x + (ink.maxX - ink.minX) * s;
    x += advanceOf(glyph, s);
    any = true;
  }
  return { strokes: out, w: right * k };
}

/** Writes a laid-out block with its box's anchor at `at`. */
export function writeLayout(layout: WordsLayout, at: Pt, align: Align, valign: VAlign, seed: number, text = layout.text): Words {
  const k = layout.size / 14;
  const bx = align === "left" ? at.x : align === "center" ? at.x - layout.w / 2 : at.x - layout.w;
  const by = valign === "top" ? at.y : valign === "middle" ? at.y - layout.h / 2 : at.y - layout.h;
  const rng = mulberry32(seed >>> 0);
  const prev: GlyphPick = { key: "", alt: -1 };
  const counter = { n: seed >>> 0 };
  const strokes: Stroke[] = [];
  const lines: WrittenLine[] = [];
  layout.lines.forEach((line, i) => {
    const baseline = by + layout.ascent + WORDS.lineStep * i * k;
    // an alternate glyph is a hair wider or narrower than the one measured: align what was written
    const written = writeLine(line, baseline, k, rng, prev, counter);
    const w = written.w;
    const x = align === "left" ? bx : align === "center" ? bx + (layout.w - w) / 2 : bx + layout.w - w;
    for (const st of written.strokes) strokes.push({ ...st, points: resample(st.points.map((p) => ({ ...p, x: p.x + x }))) });
    lines.push({ text: line, x, baseline, w });
  });
  strokes.forEach((s, i) => (s.order = i));
  const box: Rect = { x: bx, y: by, w: layout.w, h: layout.h };
  let minX = box.x;
  let minY = box.y;
  let maxX = box.x + box.w;
  let maxY = box.y + box.h;
  for (const s of strokes) {
    for (const p of s.points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  return { text, strokes, rect: { x: minX, y: minY, w: maxX - minX, h: maxY - minY }, box, lines, size: layout.size };
}

/**
 * Plain words in the tutor's hand, the block's box anchored at `at` by `align` / `valign` (each
 * wrapped line aligned the same way). Null when there is nothing the hand can write, or it does
 * not fit `maxWidth` / `maxLines`.
 */
export function writeWords(text: string, at: Pt, align: Align, valign: VAlign, size: number, seed: number, opts: WordsOptions = {}): Words | null {
  const layout = measureWords(text, size, opts);
  return layout ? writeLayout(layout, at, align, valign, seed) : null;
}
