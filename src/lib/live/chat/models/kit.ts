import { layoutMath, placeStrokes, strokeBounds, totalDurationMs, type Stroke } from "@/lib/hand";
import type { Rect } from "../../contracts";
import { Pen, rectsOverlap, writeMath, type Align, type Pt, type VAlign } from "../../graphing/pen";
import type { HandLinePlan, HandLineStyle, HandPlan } from "../../handwriting";
import { closedStroke, lecturePace, partSeed, type PaceBudget } from "../../lecture/chart/sketch";
import type { LectureInk } from "../../lecture/contracts";
import { measureWords, writeWords } from "../../lecture/words";

/**
 * What every visual model is drawn with (`./index.ts`): the pen, the labels, the inks and fills, and
 * the plan a model ends as. A model is a teacher's drawing on a whiteboard — clean, to scale, evenly
 * spaced — in the tutor's own hand: lines from the graph sketch's pen (`Pen`, a faint bow and a
 * little tremor), numbers and short maths from the hand's own layout (`writeMath`), a word or two
 * from lecture mode's words (`writeWords`), and light flat fills (tldraw's `solid` fill is a pale
 * tint of the stroke's colour; never a gradient).
 *
 * PARTS. A model is a list of named parts in the order a teacher draws them ("bar:0", "part:0:2",
 * "label:bar:0"); each becomes one line of the plan, with its own pen (seeded by the model's seed and
 * the part's name) and its own ink and fill. Every line carries its part (`HandLinePlan.part`), so
 * the board and the screen picture know the strokes are a drawing, not maths to read back.
 *
 * WRITING. Every label is recorded with its ink box (`texts`), so the tests can check that no two
 * labels touch, that no line runs through one and that all of it is inside the box.
 *
 * FILLS. A shaded part is coloured in INSIDE its lines: a closed shape a few px in from them, in a
 * light colour with a fine edge, drawn after the lines (`fillRect`, `fillWedge`), so the tutor's blue
 * lines stay crisp over a flat tint.
 */

/** Hand sizes (px per 14 em; a digit is 0.63 of it) for a model's writing, and the least they shrink to. */
export const MODEL_TEXT = {
  /** numbers and labels: read from across a room, a little under a problem's 48 */
  label: 38,
  /** the least a label may shrink to before a smaller box is no longer legible */
  min: 28,
  /** a stacked fraction: each number is ~0.7 of the hand, so it is written a little larger */
  fraction: 46,
  /** words (a row's name, a place's name, "3 groups of 4") */
  words: 34,
  wordsMin: 26,
} as const;

/** How long a model takes on the wall clock: written at a hand's pace, sped up to be on the board in ~4–7 s. */
export const MODEL_PACE: PaceBudget = { naturalUpToMs: 3500, maxWallMs: 7000 };

/** Natural-pace pause between two parts of a model (a teacher moving the pen to the next thing). */
const PART_GAP_MS = 140;

/** px of air kept round the ink inside the plan's box (the pen's tremor reaches a hair past a point). */
const INK_MARGIN = 3;

/** The tutor's own ink: lines, outlines and writing. */
export const MODEL_INK = "blue" as const satisfies LectureInk;

/** Light flat fills for shaded parts and counters, in order (the tutor's blue stays for the lines). */
export const MODEL_FILLS: readonly LectureInk[] = ["orange", "green", "violet", "light-blue"];

export function fillInk(i: number): LectureInk {
  return MODEL_FILLS[((i % MODEL_FILLS.length) + MODEL_FILLS.length) % MODEL_FILLS.length];
}

/** A closed shape tinted inside its colour (the board fills it once the pen has gone all the way round). */
export function tinted(color: LectureInk): HandLineStyle {
  return { color, fill: "solid", closed: true };
}

/** A solid dot (a point on a number line, a clock's centre, a decimal point): filled with its own colour. */
export function solid(color: LectureInk): HandLineStyle {
  return { color, fill: "fill", closed: true };
}

/** The pen of a model's words: a little finer than its numbers' (letters fill in at the full pen), never faint. */
export const MODEL_WORDS_WEIGHT = 0.8;

/** A fill's own edge is a fine pen: the colour reads as coloured in, not as a second outline. */
export const FILL_EDGE_WEIGHT = 0.4;

/** A planned model and its writing. */
export interface ModelSketch {
  plan: HandPlan;
  texts: PlacedText[];
}

export interface PlacedText {
  text: string;
  /** the ink box, plan px */
  rect: Rect;
  part: string;
}

// ------------------------------------------------------------------ labels

/**
 * How a label is written: maths (a number, a fraction, `?`, `x`, `3 × 4`) in the hand's maths
 * layout, or words ("apples", "Sam", "3 groups of 4") in lecture mode's words. `3/4` and `1 1/2` are
 * written stacked, as a teacher writes a fraction; `×` and `÷` are the hand's own; thousands get
 * their comma (`1,234`).
 */
export type LabelForm = { math: true; latex: string } | { math: false; text: string };

export function labelForm(text: string): LabelForm {
  const t = text
    .trim()
    .replace(/−/g, "-")
    .replace(/×/g, " \\times ")
    .replace(/÷/g, " \\div ")
    .replace(/(\d)\s*[x*]\s*(?=\d)/g, "$1 \\times ")
    .replace(/\s+/g, " ")
    .trim();
  const mixed = /^(\d+) (\d+) ?\/ ?(\d+)$/.exec(t);
  if (mixed) return { math: true, latex: `${mixed[1]}\\frac{${mixed[2]}}{${mixed[3]}}` };
  // two letters in a row that are not a LaTeX command: words
  if (/[A-Za-z]{2,}/.test(t.replace(/\\[A-Za-z]+/g, " "))) return { math: false, text: text.trim() };
  const latex = t.replace(/(\d+) ?\/ ?(\d+)/g, "\\frac{$1}{$2}").replace(/(\d),(?=\d{3}\b)/g, "$1{,}");
  return { math: true, latex };
}

/**
 * A number as the hand writes it: up to 3 decimals, a minus sign, and from 10,000 up its thousands
 * comma (`12{,}500`); a 4-digit number is written plain (4936), as school books do, since the hand's
 * comma takes a digit's room.
 */
export function numLatex(v: number): string {
  const r = Math.round(v * 1000) / 1000;
  const neg = r < 0;
  const [int, dec] = Math.abs(r).toString().split(".");
  const grouped = int.length >= 5 ? int.replace(/\B(?=(\d{3})+(?!\d))/g, "{,}") : int;
  return `${neg ? "-" : ""}${grouped}${dec ? `.${dec}` : ""}`;
}

/** n/d as the hand writes a fraction (stacked). */
export function fracLatex(n: number, d: number): string {
  return `\\frac{${n}}{${d}}`;
}

export interface LabelSize {
  w: number;
  h: number;
}

/** The ink size of a label at hand size `size`, or null when the hand cannot write it. */
export function measureLabel(text: string, size: number): LabelSize | null {
  const form = labelForm(text);
  if (form.math) {
    const l = layoutMath(form.latex, { size, seed: 1 });
    if (l.unsupported.length > 0 || l.strokes.length === 0) return null;
    return { w: l.width, h: l.height };
  }
  const m = measureWords(form.text, size, { maxLines: 1 });
  return m ? { w: m.w, h: m.h } : null;
}

export interface LabelInk {
  text: string;
  strokes: Stroke[];
  /** the ink box */
  rect: Rect;
}

/** A label written with its box's anchor at `at` (null when the hand cannot write it). */
export function writeLabel(text: string, at: Pt, align: Align, valign: VAlign, size: number, seed: number): LabelInk | null {
  const form = labelForm(text);
  if (form.math) {
    const w = writeMath(form.latex, at, align, valign, size, seed);
    return w ? { text, strokes: w.strokes, rect: w.rect } : null;
  }
  const w = writeWords(form.text, at, align, valign, size, seed, { maxLines: 1 });
  if (!w) return null;
  // lecture mode's words thin the pen with the writing (`wordsWeight`); beside a model's numbers,
  // written with the full pen, they read faint: a model's words keep most of it
  for (const s of w.strokes) s.weight = Math.max(s.weight ?? 1, MODEL_WORDS_WEIGHT);
  return { text, strokes: w.strokes, rect: w.rect };
}

/**
 * The largest size from `max` down to `min` (2 px a step) at which every label fits `fits`; null
 * when none does (the caller tries a bigger box, or none fits at all).
 */
export function fitSize(texts: readonly string[], max: number, min: number, fits: (sizes: LabelSize[], size: number) => boolean): { size: number; sizes: LabelSize[] } | null {
  for (let size = max; size >= min - 1e-9; size -= 2) {
    const sizes: LabelSize[] = [];
    for (const t of texts) {
      const m = measureLabel(t, size);
      if (!m) return null;
      sizes.push(m);
    }
    if (fits(sizes, size)) return { size, sizes };
  }
  return null;
}

// ------------------------------------------------------------------ the ink

interface Group {
  label: string;
  strokes: Stroke[];
  part: string;
  style?: HandLineStyle;
}

/** A model's parts in drawing order, and its writing. */
export class ModelInk {
  private readonly groups: Group[] = [];
  readonly texts: PlacedText[] = [];
  private readonly used = new Set<string>();

  constructor(readonly seed: number) {}

  /** The part's name, made unique ("tick" twice is "tick", "tick~2"). */
  private claim(part: string): string {
    let key = part;
    for (let n = 2; this.used.has(key); n++) key = `${part}~${n}`;
    this.used.add(key);
    return key;
  }

  /** A pen of its own for a part: its ink depends on the model's seed and the part's name only. */
  pen(part: string): Pen {
    return new Pen(partSeed(this.seed, part));
  }

  /** Lines, marks and shapes: one part, drawn by its own pen; `weight` thins or thickens its pen. */
  draw(part: string, make: readonly Stroke[] | ((pen: Pen) => Stroke[]), style?: HandLineStyle, weight?: number): void {
    const key = this.claim(part);
    const strokes = typeof make === "function" ? make(new Pen(partSeed(this.seed, key))) : [...make];
    if (strokes.length === 0) return;
    if (weight !== undefined) for (const s of strokes) s.weight = weight;
    this.groups.push({ label: "", strokes, part: key, style });
  }

  /** A shaded part: a closed shape tinted in `color`, with a fine edge. */
  fill(part: string, make: (pen: Pen) => Stroke[], color: LectureInk): void {
    this.draw(part, make, tinted(color), FILL_EDGE_WEIGHT);
  }

  /** Writes a label at `at`; null (nothing written) when the hand cannot write it. */
  label(part: string, text: string, at: Pt, align: Align, valign: VAlign, size: number, color: LectureInk = MODEL_INK): Rect | null {
    const key = this.claim(part);
    const ink = writeLabel(text, at, align, valign, size, partSeed(this.seed, `${key}#t`));
    if (!ink || ink.strokes.length === 0) return null;
    this.groups.push({ label: ink.text, strokes: ink.strokes, part: key, style: color === MODEL_INK ? undefined : { color } });
    this.texts.push({ text: ink.text, rect: ink.rect, part: key });
    return ink.rect;
  }

  /** Whether a rect would touch any label written so far (with `pad` px of air). */
  hitsText(r: Rect, pad = 4): boolean {
    return this.texts.some((t) => rectsOverlap(t.rect, r, pad));
  }

  /**
   * The plan: its ink from (INK_MARGIN, INK_MARGIN), `bounds` from (0, 0) round all of it with that
   * margin. Null when there is nothing to draw, or it does not fit `box` — a planner that got its
   * sums wrong must never hand the desk an overflow.
   */
  finish(box: { w: number; h: number }): ModelSketch | null {
    const groups = this.groups.filter((g) => g.strokes.length > 0);
    const all = strokeBounds(groups.flatMap((g) => g.strokes));
    if (!all) return null;
    const dx = INK_MARGIN - all.minX;
    const dy = INK_MARGIN - all.minY;
    const w = all.width + 2 * INK_MARGIN;
    const h = all.height + 2 * INK_MARGIN;
    if (w > box.w + 0.5 || h > box.h + 0.5) return null;
    const lines: HandLinePlan[] = [];
    let t = 0;
    for (const g of groups) {
      const b = strokeBounds(g.strokes)!;
      const strokes = placeStrokes(g.strokes, { x: -b.minX, y: -b.minY });
      const durationMs = totalDurationMs(strokes);
      lines.push({ latex: g.label, x: b.minX + dx, y: b.minY + dy, baseline: b.height, strokes, startMs: t, durationMs, part: g.part, ...(g.style ? { style: g.style } : {}) });
      t += durationMs + PART_GAP_MS;
    }
    const totalMs = Math.max(0, t - PART_GAP_MS);
    return {
      plan: { lines, bounds: { x: 0, y: 0, w, h }, size: MODEL_TEXT.label, totalMs, pace: lecturePace(totalMs, MODEL_PACE) },
      texts: this.texts.map((x) => ({ ...x, rect: { ...x.rect, x: x.rect.x + dx, y: x.rect.y + dy } })),
    };
  }
}

// ------------------------------------------------------------------ shapes

/**
 * A rectangle as a teacher draws one: from the top-left corner, round clockwise in one go, each
 * edge with a faint bow, closing where it began (one stroke, so it can be filled).
 */
export function handRect(pen: Pen, r: Rect): Stroke[] {
  const corners: Pt[] = [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
    { x: r.x, y: r.y },
  ];
  const pts: Pt[] = [corners[0]];
  for (let i = 1; i < corners.length; i++) {
    const a = corners[i - 1];
    const b = corners[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const bow = Math.min(1.2, len * 0.003) * (pen.rng() < 0.5 ? -1 : 1);
    const nx = -(b.y - a.y) / (len || 1);
    const ny = (b.x - a.x) / (len || 1);
    const n = Math.max(2, Math.ceil(len / 8));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const off = bow * Math.sin(Math.PI * t);
      pts.push({ x: a.x + (b.x - a.x) * t + nx * off, y: a.y + (b.y - a.y) * t + ny * off });
    }
  }
  return closedStroke(pen, pts, 0.25);
}

/** A shaded rect's fill: the rect `inset` px in from its lines, one closed stroke. */
export function fillRect(pen: Pen, r: Rect, inset: number): Stroke[] {
  const x0 = r.x + inset;
  const y0 = r.y + inset;
  const x1 = r.x + r.w - inset;
  const y1 = r.y + r.h - inset;
  if (x1 - x0 < 2 || y1 - y0 < 2) return [];
  return closedStroke(
    pen,
    [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
      { x: x0, y: y0 },
    ],
    0.15,
  );
}

/** A round counter (a dot an array or a ten frame holds): a small circle, tinted inside. */
export function counter(pen: Pen, c: Pt, r: number): Stroke[] {
  const pts: Pt[] = [];
  const a0 = -Math.PI * 0.6 + (pen.rng() - 0.5) * 0.4;
  const n = Math.max(18, Math.ceil((Math.PI * 2 * r) / 3));
  for (let i = 0; i <= n; i++) {
    const a = a0 + (Math.PI * 2 * i) / n;
    const k = 1 + (pen.rng() - 0.5) * 0.02;
    pts.push({ x: c.x + r * k * Math.cos(a), y: c.y + r * k * Math.sin(a) });
  }
  pts[pts.length - 1] = { ...pts[0] };
  return closedStroke(pen, pts, 0.12);
}

/** A circle as a hand draws it: from the upper left, round once, closing where it began (one stroke). */
export function handCircle(pen: Pen, c: Pt, r: number): Stroke[] {
  const pts: Pt[] = [];
  const a0 = -Math.PI * 0.72 + (pen.rng() - 0.5) * 0.3;
  const n = Math.max(48, Math.ceil((Math.PI * 2 * r) / 5));
  const wob = pen.rng() * Math.PI * 2;
  for (let i = 0; i <= n; i++) {
    const a = a0 + (Math.PI * 2 * i) / n;
    // a hand's circle is not a compass's: a slow wobble of a fraction of a px
    const k = 1 + 0.004 * Math.sin(2 * a + wob) * Math.sin((Math.PI * i) / n);
    pts.push({ x: c.x + r * k * Math.cos(a), y: c.y + r * k * Math.sin(a) });
  }
  return closedStroke(pen, pts, 0.2);
}

/** Points along a circular arc from angle a0 to a1 (radians, y down), every ~4 px. */
export function arcPoints(c: Pt, r: number, a0: number, a1: number): Pt[] {
  const n = Math.max(2, Math.ceil((Math.abs(a1 - a0) * r) / 4));
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });
  }
  return out;
}

/**
 * A curly brace from `a` to `b` (its tip on the side `dir` points to, `depth` px out): the two
 * halves curl from each end to the tip in the middle, the way a teacher draws one.
 */
export function bracePoints(a: Pt, b: Pt, depth: number): Pt[] {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 1) return [];
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  // the normal on the side the tip points to: (dir) is the left of a→b in y-down px
  const nx = uy;
  const ny = -ux;
  const at = (s: number, d: number): Pt => ({ x: a.x + ux * s + nx * d, y: a.y + uy * s + ny * d });
  const q = Math.min(depth * 0.9, len / 6);
  const half = len / 2;
  const out: Pt[] = [];
  const curl = (s0: number, d0: number, s1: number, d1: number, bulgeS: number, bulgeD: number, steps: number) => {
    // a quadratic curve from (s0, d0) to (s1, d1) through the control point (bulgeS, bulgeD)
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const s = (1 - t) ** 2 * s0 + 2 * (1 - t) * t * bulgeS + t * t * s1;
      const d = (1 - t) ** 2 * d0 + 2 * (1 - t) * t * bulgeD + t * t * d1;
      out.push(at(s, d));
    }
  };
  const mid = depth / 2;
  out.push(at(0, 0));
  curl(0, 0, q, mid, 0, mid, 8);
  if (half - 2 * q > 0) out.push(at(half - q, mid));
  curl(half - q, mid, half, depth, half, mid, 8);
  curl(half, depth, half + q, mid, half, mid, 8);
  if (half - 2 * q > 0) out.push(at(len - q, mid));
  curl(len - q, mid, len, 0, len, mid, 8);
  return out;
}
