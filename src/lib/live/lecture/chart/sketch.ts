import type { InkPt, Stroke } from "@/lib/hand";
import type { Rect } from "../../contracts";
import { PEN, Pen, rectsOverlap, type Align, type Pt, type VAlign } from "../../graphing/pen";
import { planFromGroups } from "../../graphing/plan";
import type { HandLineStyle, HandPlan } from "../../handwriting";
import { LECTURE_PALETTE, type LectureInk } from "../contracts";
import { fitWords, writeLayout, type Words, type WordsLayout } from "../words";

/**
 * What every lecture sketch — a chart or a diagram — is built from: the pen, the words, the
 * parts in the order a teacher draws them, their inks, and the rules that keep them readable.
 *
 * PARTS. Every line of a plan is one named part ("axis:y", "bar:Q3:0", "node:2") and its strokes
 * come from a pen seeded by (seed, part name) alone — not from one pen running through the whole
 * sketch. So when a live chart grows ("…and Q4 was 18") and is planned again with the same box and
 * seed, every part whose geometry did not change comes out stroke for stroke the same, and the
 * desk writes only the new and the moved ones (`HandLinePlan.part`).
 *
 * FRAME. A chart or a diagram is laid out in a fixed frame — the box it was given — and nothing is
 * re-centred round what happens to be drawn, so plans of one spec at different stages put a part
 * that did not change in the same place. The plan's `bounds` start at (0, 0), the frame's corner
 * (see `finish`), and reach the far edge of the ink; the ink is inside them, from a px or two in.
 *
 * Every piece of writing is recorded with its ink box (`texts`), so the tests can check that no
 * two labels touch and that no line runs through one.
 */

/** Hand sizes (px per 14 em units; a capital is ~0.62 of it) and the smallest they may shrink to. */
export const LECTURE_TEXT = {
  title: { size: 36, min: 28 },
  /** tick numbers, category names, a diagram's nodes */
  label: { size: 27, min: 22 },
  /** the smaller writing: a value on a bar, a legend, an arrow's label */
  small: { size: 24, min: 20 },
} as const;

/** The most points one stroke may have (`HAND_WRITE.maxPointsPerStroke` is 400), with a margin. */
const HAND_POINTS = 390;

/** px a planner keeps inside the desk's box on every side (see `innerBox`). */
const INNER_MARGIN = 2;

/**
 * The inks. The writing and the scaffolding of a sketch (axes, ticks, grid, arrows, outlines of
 * words) are the tutor's own hand; the data (bars, lines, dots, slices, a diagram's boxes) take the
 * palette's next colours, in order. Closed shapes are filled with a pale tint of their colour
 * (tldraw's `solid` fill; its `semi` is an opaque off-white, not a tint).
 */
export const INK = {
  text: "blue",
  line: "blue",
} as const satisfies Record<string, LectureInk>;

/** The colours of series (and regions, slices, a diagram's accents) after the tutor's own. */
export const SERIES_INKS: readonly LectureInk[] = LECTURE_PALETTE.slice(1);

export function seriesInk(j: number): LectureInk {
  return SERIES_INKS[((j % SERIES_INKS.length) + SERIES_INKS.length) % SERIES_INKS.length];
}

/** A closed shape in a colour, tinted inside once its outline is whole. */
export function shapeStyle(color: LectureInk, fill = true): HandLineStyle {
  return fill ? { color, fill: "solid", closed: true } : { color };
}

/**
 * How long each block takes on the wall clock. At writing pace a chart of a dozen labels takes half
 * a minute; the pen speeds up (like `graphPaceFor`) so it is on the board while the lecture is
 * still on that point, but never so fast it stops looking written.
 */
export const LECTURE_PACE = {
  chart: { naturalUpToMs: 4000, maxWallMs: 7000 },
  diagram: { naturalUpToMs: 4000, maxWallMs: 8000 },
  heading: { naturalUpToMs: 1500, maxWallMs: 2200 },
  note: { naturalUpToMs: 2400, maxWallMs: 3600 },
} as const;

export type PaceBudget = { naturalUpToMs: number; maxWallMs: number };

/** The pen's speed-up for a block that takes `naturalMs` at writing pace (1 = natural). */
export function lecturePace(naturalMs: number, budget: PaceBudget): number {
  if (!(naturalMs > budget.naturalUpToMs)) return 1;
  const wall = Math.min(budget.maxWallMs, budget.naturalUpToMs + (naturalMs - budget.naturalUpToMs) / 4);
  return naturalMs / wall;
}

/** The seed of one part's pen: the sketch's seed and the part's name, nothing else (FNV-1a). */
export function partSeed(seed: number, part: string): number {
  let h = 2166136261 ^ (seed >>> 0);
  h = Math.imul(h, 16777619);
  for (let i = 0; i < part.length; i++) {
    h ^= part.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A piece of writing in a sketch, where its ink is, and the part it is. */
export interface PlacedText {
  text: string;
  rect: Rect;
  part: string;
}

/** A planned sketch and its writing (for the tests' overlap checks and the gallery). */
export interface LectureSketch {
  plan: HandPlan;
  texts: PlacedText[];
}

type Group = { label: string; strokes: Stroke[]; part: string; style?: HandLineStyle };

/** The parts of a sketch in drawing order. */
export class Sketch {
  private readonly groups: Group[] = [];
  private readonly texts: PlacedText[] = [];
  private readonly used = new Set<string>();

  constructor(readonly seed: number) {}

  /** A fresh pen for one part: its ink depends on the sketch's seed and the part's name only. */
  pen(part: string): Pen {
    return new Pen(partSeed(this.seed, part));
  }

  /** The part's name, made unique (a second "label:Q1" is "label:Q1~2"). */
  private claim(part: string): string {
    let key = part;
    for (let n = 2; this.used.has(key); n++) key = `${part}~${n}`;
    this.used.add(key);
    return key;
  }

  /** Lines, marks, shapes: one part of the sketch, drawn by its own pen. */
  draw(part: string, make: readonly Stroke[] | ((pen: Pen) => Stroke[]), style?: HandLineStyle): void {
    const key = this.claim(part);
    const strokes = typeof make === "function" ? make(new Pen(partSeed(this.seed, key))) : [...make];
    if (strokes.length > 0) this.groups.push({ label: "", strokes, part: key, style });
  }

  /** Words laid out where they go (not drawn yet: `add` them in the order the teacher writes them). */
  words(part: string, layout: WordsLayout, at: Pt, align: Align, valign: VAlign): Words {
    return writeLayout(layout, at, align, valign, partSeed(this.seed, `${part}#words`));
  }

  /** Writes words already laid out (`words`). */
  add(part: string, w: Words | null | undefined, style: HandLineStyle = { color: INK.text }): void {
    if (!w || w.strokes.length === 0) return;
    const key = this.claim(part);
    this.groups.push({ label: w.text, strokes: w.strokes, part: key, style });
    this.texts.push({ text: w.text, rect: w.rect, part: key });
  }

  /** Lays out and writes in one go. */
  write(part: string, layout: WordsLayout, at: Pt, align: Align, valign: VAlign, style?: HandLineStyle): Words {
    const w = this.words(part, layout, at, align, valign);
    this.add(part, w, style);
    return w;
  }

  /**
   * The plan, in its frame: `bounds` from (0, 0) to the far edge of its ink, the ink inside them.
   * `inner` is the box it was laid out in (`innerBox` of the desk's). Null when there is nothing to
   * draw or the ink does not fit the desk's box — a planner that got its sums wrong must not hand
   * the desk an overflow.
   *
   * `origin` (layout px) is where the frame starts: the top-left of the room for a layout of fixed
   * slots, the layout edge of what was drawn for one centred in the room. A live sketch's plans
   * share it — it is not where the ink happens to reach, which a new part (or a hair of tremor)
   * could move — so a part that did not change keeps its place in the plan. Without `origin` the
   * frame is the ink's own box (a heading, a note).
   */
  finish(inner: { w: number; h: number }, budget: PaceBudget, size: number, origin?: { x: number; y: number }): LectureSketch | null {
    const plan = planFromGroups(this.groups, size);
    if (!plan || plan.lines.length !== this.groups.length) return null;
    const dx = origin ? INNER_MARGIN - origin.x : -plan.bounds.x;
    const dy = origin ? INNER_MARGIN - origin.y : -plan.bounds.y;
    const ink = { x: plan.bounds.x + dx, y: plan.bounds.y + dy, w: plan.bounds.w, h: plan.bounds.h };
    if (ink.x < -0.5 || ink.y < -0.5) return null;
    const bounds = { x: 0, y: 0, w: ink.x + ink.w, h: ink.y + ink.h };
    if (bounds.w > inner.w + 2 * INNER_MARGIN || bounds.h > inner.h + 2 * INNER_MARGIN) return null;
    const moved: HandPlan = {
      ...plan,
      lines: plan.lines.map((l, i) => ({ ...l, x: l.x + dx, y: l.y + dy, part: this.groups[i].part, ...(this.groups[i].style ? { style: this.groups[i].style } : {}) })),
      bounds,
      pace: lecturePace(plan.totalMs, budget),
    };
    return { plan: moved, texts: this.texts.map((t) => ({ ...t, rect: { ...t.rect, x: t.rect.x + dx, y: t.rect.y + dy } })) };
  }
}

/**
 * A closed shape as ONE stroke (the board fills a closed stroke once it is whole: split in two,
 * each half would close on itself across the middle). Resampled like `Pen.polyline` — a little
 * tremor, ends pinned — but coarser when it is long, so it stays within the HandWriter's points.
 */
export function closedStroke(pen: Pen, input: readonly Pt[], jitter = 0.3): Stroke[] {
  if (input.length < 2) return [];
  // every input point is kept, and each segment rounds its count up: leave room for both
  const every = Math.ceil(input.length / 200);
  const pts = every > 1 ? input.filter((_, i) => i % every === 0 || i === input.length - 1) : input;
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  const step = Math.max(PEN.step, len / (HAND_POINTS - pts.length));
  const z = () => 0.42 + pen.rng() * 0.16;
  const out: InkPt[] = [{ x: pts[0].x, y: pts[0].y, z: z() }];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      out.push({ x: a.x + (b.x - a.x) * t + (pen.rng() - 0.5) * jitter, y: a.y + (b.y - a.y) * t + (pen.rng() - 0.5) * jitter, z: z() });
    }
  }
  const last = pts[pts.length - 1];
  out[out.length - 1] = { ...out[out.length - 1], x: last.x, y: last.y };
  return [{ points: out, order: 0, kind: "rule" }];
}

// ------------------------------------------------------------------ the title

/**
 * A chart's or a diagram's title: centred above it at ~36 px, shrinking to 28 and then taking a
 * second line before it gives up. `k` scales it with the rest of the sketch when that shrinks.
 */
export function fitTitle(text: string | undefined, maxWidth: number, k = 1): WordsLayout | null {
  if (!text) return null;
  const T = LECTURE_TEXT.title;
  return fitWords(text, { maxWidth, maxLines: 2, maxSize: Math.max(T.min, Math.round(T.size * k)), minSize: T.min, balance: true });
}

/** px between the title's box and what it heads. */
export const TITLE_GAP = 16;

// ------------------------------------------------------------------ shapes in the hand

/** Points along a straight edge from a to b with a faint bow, every ~6 px (ends excluded). */
function edge(a: Pt, b: Pt, bow: number): Pt[] {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 1) return [];
  const nx = -(b.y - a.y) / len;
  const ny = (b.x - a.x) / len;
  const n = Math.max(2, Math.ceil(len / 6));
  const out: Pt[] = [];
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const off = bow * Math.sin(Math.PI * t);
    out.push({ x: a.x + (b.x - a.x) * t + nx * off, y: a.y + (b.y - a.y) * t + ny * off });
  }
  return out;
}

/**
 * A rounded box drawn in one go, the way a hand draws it: from along the top edge, clockwise
 * round, and on past where it started — the ends overlap a little and do not quite meet. One
 * stroke (`closedStroke`), so it can be filled.
 */
export function handBox(pen: Pen, r: Rect, radius = 10): Stroke[] {
  const rad = Math.max(2, Math.min(radius, r.w / 2 - 1, r.h / 2 - 1));
  const L = r.x;
  const T = r.y;
  const R = r.x + r.w;
  const B = r.y + r.h;
  const bow = (len: number) => Math.min(1.6, len * 0.006) * (pen.rng() < 0.5 ? -1 : 1);
  const arc = (cx: number, cy: number, a0: number): Pt[] => {
    const out: Pt[] = [];
    const rr = rad * (0.85 + pen.rng() * 0.3);
    for (let i = 0; i <= 5; i++) {
      const a = a0 + (Math.PI / 2) * (i / 5);
      out.push({ x: cx + rr * Math.cos(a), y: cy + rr * Math.sin(a) });
    }
    return out;
  };
  const start = { x: L + rad + (r.w - 2 * rad) * (0.2 + pen.rng() * 0.15), y: T };
  const pts: Pt[] = [start];
  const tr = arc(R - rad, T + rad, -Math.PI / 2);
  pts.push(...edge(start, tr[0], bow(tr[0].x - start.x)), ...tr);
  const br = arc(R - rad, B - rad, 0);
  pts.push(...edge(tr[tr.length - 1], br[0], bow(r.h)), ...br);
  const bl = arc(L + rad, B - rad, Math.PI / 2);
  pts.push(...edge(br[br.length - 1], bl[0], bow(r.w)), ...bl);
  const tl = arc(L + rad, T + rad, Math.PI);
  pts.push(...edge(bl[bl.length - 1], tl[0], bow(r.h)), ...tl);
  // back along the top, past the start by a few px, a hair outside the line it began on
  const over = 7 + pen.rng() * 5;
  const end = { x: start.x + over, y: T - 0.5 - pen.rng() * 0.5 };
  pts.push(...edge(tl[tl.length - 1], end, 0), end);
  return closedStroke(pen, pts, 0.3);
}

/** An ellipse drawn in one go, from the upper left, clockwise, a little past where it began (one stroke). */
export function handEllipse(pen: Pen, c: Pt, rx: number, ry: number): Stroke[] {
  const pts: Pt[] = [];
  const a0 = -Math.PI * 0.72 + (pen.rng() - 0.5) * 0.3;
  // it closes a little past where it began — about a finger's width, whatever the size
  const over = Math.min(0.3, 11 / Math.max(rx, ry));
  const sweep = Math.PI * 2 + over;
  const n = Math.max(40, Math.ceil((Math.PI * (rx + ry)) / 5));
  const wob = pen.rng() * Math.PI * 2;
  const drift = 0.7 / Math.max(rx, ry);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = a0 + sweep * t;
    // a hand's ellipse is not a compass's: a slow wobble, and the end runs a hair wide
    const past = Math.max(0, (a - a0 - Math.PI * 2 + over * 2) / (over * 3));
    const k = 1 + 0.005 * Math.sin(2 * a + wob) + past * drift;
    pts.push({ x: c.x + rx * k * Math.cos(a), y: c.y + ry * k * Math.sin(a) });
  }
  return closedStroke(pen, pts, 0.25);
}

/** An arrow from a to b: a freehand line and its head. */
export function handArrow(pen: Pen, a: Pt, b: Pt, head = 11): Stroke[] {
  return [...pen.line(a, b), ...pen.arrowhead(b, b.x - a.x, b.y - a.y, head)];
}

/** An arrow along a curve (points in order), its head at the last point along the curve's last few px. */
export function curvedArrow(pen: Pen, pts: readonly Pt[], head = 11): Stroke[] {
  if (pts.length < 2) return [];
  const end = pts[pts.length - 1];
  let i = pts.length - 2;
  while (i > 0 && Math.hypot(end.x - pts[i].x, end.y - pts[i].y) < 8) i--;
  return [...pen.polyline(pts, 0.3), ...pen.arrowhead(end, end.x - pts[i].x, end.y - pts[i].y, head)];
}

/**
 * Hatching inside a rect, `gap` px apart: "/" (dir 1) or "\" (dir -1), each line its own stroke,
 * kept `inset` px off the sides.
 */
export function hatchRect(pen: Pen, r: Rect, dir: 1 | -1, gap = 8, inset = 3): Stroke[] {
  const x0 = r.x + inset;
  const x1 = r.x + r.w - inset;
  const y0 = r.y + inset;
  const y1 = r.y + r.h - inset;
  if (x1 - x0 < 3 || y1 - y0 < 3) return [];
  const out: Stroke[] = [];
  const step = gap * Math.SQRT2;
  if (dir === 1) {
    // x + y = c, from bottom left to top right
    for (let c = x0 + y0 + step * (0.5 + pen.rng() * 0.3); c < x1 + y1; c += step) {
      const xa = Math.max(x0, c - y1);
      const xb = Math.min(x1, c - y0);
      if (xb - xa < 2.5) continue;
      out.push(...pen.polyline([{ x: xa, y: c - xa }, { x: xb, y: c - xb }], 0.2));
    }
  } else {
    // x - y = c, from top left to bottom right
    for (let c = x0 - y1 + step * (0.5 + pen.rng() * 0.3); c < x1 - y0; c += step) {
      const xa = Math.max(x0, c + y0);
      const xb = Math.min(x1, c + y1);
      if (xb - xa < 2.5) continue;
      out.push(...pen.polyline([{ x: xa, y: xa - c }, { x: xb, y: xb - c }], 0.2));
    }
  }
  return out;
}

/** A small square marker (a line chart's third series). */
export function handSquare(pen: Pen, c: Pt, half = 4.6): Stroke[] {
  const a = { x: c.x - half, y: c.y - half };
  return pen.polyline([a, { x: c.x + half, y: c.y - half }, { x: c.x + half, y: c.y + half }, { x: c.x - half, y: c.y + half }, { x: a.x, y: a.y - 0.8 }], 0.15);
}

// ------------------------------------------------------------------ geometry

/**
 * The box a planner lays out in: 2 px in from the desk's box on every side, for the pen's tremor
 * and a glyph's jitter, which take ink a hair past where it was placed.
 */
export function innerBox(box: { w: number; h: number }): { w: number; h: number } {
  return { w: box.w - 2 * INNER_MARGIN, h: box.h - 2 * INNER_MARGIN };
}


export function inside(r: Rect, box: { w: number; h: number }, pad = 0): boolean {
  return r.x >= pad - 1e-6 && r.y >= pad - 1e-6 && r.x + r.w <= box.w - pad + 1e-6 && r.y + r.h <= box.h - pad + 1e-6;
}

export function grow(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by };
}

export function anyOverlap(rects: readonly Rect[], pad = 0): boolean {
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) if (rectsOverlap(rects[i], rects[j], pad)) return true;
  return false;
}

/** Does the segment a→b pass through the rect? */
export function segmentHitsRect(a: Pt, b: Pt, r: Rect): boolean {
  const n = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 3));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return true;
  }
  return false;
}

/** Where the ray from a rect's centre towards `to` leaves the rect grown by `pad`. */
export function rectExit(r: Rect, to: Pt, pad = 0): Pt {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const dx = to.x - cx;
  const dy = to.y - cy;
  const hw = r.w / 2 + pad;
  const hh = r.h / 2 + pad;
  const t = Math.min(dx !== 0 ? hw / Math.abs(dx) : Infinity, dy !== 0 ? hh / Math.abs(dy) : Infinity);
  return { x: cx + dx * t, y: cy + dy * t };
}

/** Where the ray from an ellipse's centre towards `to` leaves the ellipse grown by `pad`. */
export function ellipseExit(c: Pt, rx: number, ry: number, to: Pt, pad = 0): Pt {
  const dx = to.x - c.x;
  const dy = to.y - c.y;
  const t = 1 / Math.sqrt((dx / (rx + pad)) ** 2 + (dy / (ry + pad)) ** 2 || 1);
  return { x: c.x + dx * t, y: c.y + dy * t };
}

/** The bounding rect of rects. */
export function union(rects: readonly Rect[]): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  return Number.isFinite(minX) ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY } : { x: 0, y: 0, w: 0, h: 0 };
}
