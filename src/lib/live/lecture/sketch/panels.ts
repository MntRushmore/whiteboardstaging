import type { Rect } from "../../contracts";
import type { Pen, Pt } from "../../graphing/pen";
import type { HandPlan } from "../../handwriting";
import { INK, Sketch, TITLE_GAP, fitTitle, innerBox, type LectureSketch } from "../chart/sketch";
import { hyphenating, measureWords, type WordsLayout } from "../words";

/**
 * The frames of a comic strip, their captions and the title, in the tutor's hand — what goes on the
 * board first, while the illustrator is still drawing; each panel's drawing fills its frame when it
 * arrives (`planSketch` in the frame's drawing area).
 *
 * LAYOUT. Panels are equal. 2–4 go in a row when the row's panels would not be too narrow for a
 * picture (`rowAspectMin`), else two by two in reading order (three: two, then one centred under
 * them; two: one above the other). A panel is kept between `aspect.min` and `aspect.max` wide for
 * its height — the illustrator composes for it — and a strip narrower than the box is centred
 * across it. The title is centred above the panels and the strip starts at the top of the box, so
 * the plan's `bounds` are the height it really takes.
 *
 * CAPTIONS go under their frames, all at ONE hand size (the largest at which every caption fits
 * under its panel in two lines, evenly broken), each centred under its frame, and every caption of
 * a row on the same writing line, whether it took one line or two. A strip whose captions will not
 * fit two lines even small is given a third before it gives up.
 *
 * FRAMES are drawn a side at a time, each line running a few px on past the corner, as a teacher
 * rules a box freehand. A panel's drawing area (`frames`) is inset from its frame so a drawing never
 * touches it. A single picture (`framed: false`) has no frame; its drawing area is the whole room
 * under the title and above the caption.
 */

export const PANELS = {
  /** px between panels side by side, and between one row's captions and the next row's frames */
  gutter: 28,
  rowGap: 22,
  /** px from a frame's bottom to its caption's box */
  captionGap: 14,
  /** the frame's lines run on past each corner by between these px */
  overshoot: { min: 2.5, max: 6.5 },
  /** px kept round the frames for the overshoot */
  margin: 8,
  /** a panel's drawing area is this far inside its frame (px) */
  inset: 12,
  /** captions: hand size from `size` down to `min` in `lines` lines, then `crowded` */
  caption: { size: 26, min: 20, lines: 2, crowded: { min: 17, lines: 3 }, pad: 4 },
  /** a frame's width over its height */
  aspect: { min: 0.6, max: 2.1 },
  /** a row whose panels would be narrower than this (w / h) goes two by two */
  rowAspectMin: 0.7,
  /** the smallest frame worth drawing in */
  minFrame: { w: 120, h: 100 },
  /** the frames' pen (the tutor's usual one: a frame is scaffolding, heavier than the drawing's lines) */
  weight: 1,
  /** the frames, captions and title are on the board in about 2–3 s */
  pace: { naturalUpToMs: 1800, maxWallMs: 2800 },
} as const;

export interface PanelsInput {
  count: number;
  captions: ReadonlyArray<string | undefined>;
  title?: string;
  framed: boolean;
}

export interface PanelsSketch {
  sketch: LectureSketch;
  /** each panel's drawing area, plan-local, in reading order */
  frames: Rect[];
  /** the frames as drawn (plan-local), in reading order; equal to `frames` when not framed */
  outlines: Rect[];
  cols: number;
  rows: number;
  /** the captions' one hand size (0 when there are none) */
  captionSize: number;
  /** each caption's first writing line (plan-local y), null for a panel without one */
  captionBaselines: Array<number | null>;
}

interface Captions {
  layouts: Array<WordsLayout | null>;
  size: number;
  /** the tallest ascent (box top to first writing line): every caption's first line sits this far under the band's top */
  ascent: number;
  /** the band's height with every caption on that line */
  h: number;
}

/** The comic's frames, captions and title in the box; null when the panels cannot be drawn there at a useful size. */
export function sketchPanels(input: PanelsInput, opts: { seed: number; box: { w: number; h: number } }): PanelsSketch | null {
  const n = Math.floor(input.count);
  if (!(n >= 1 && n <= 4)) return null;
  const inner = innerBox(opts.box);
  if (!(inner.w > 0 && inner.h > 0)) return null;
  const P = PANELS;
  const framed = input.framed;
  const M = framed ? P.margin : 0;
  const texts = Array.from({ length: n }, (_, i) => {
    const t = input.captions[i];
    return typeof t === "string" && t.trim() ? t.trim() : undefined;
  });
  const titleText = input.title?.trim() || undefined;
  const title = titleText ? (fitTitle(titleText, inner.w - 2 * M) ?? hyphenating(true, () => fitTitle(titleText, inner.w - 2 * M))) : null;
  const titleH = title ? title.h + TITLE_GAP : 0;

  // ---- how they go: a row, or two by two
  type Arrangement = { cols: number; rows: number; pw: number; ph: number; natural: number; caps: Captions; band: number };
  const arrange = (cols: number): Arrangement | null => {
    const rows = Math.ceil(n / cols);
    const heightFor = (caps: Captions) => {
      const band = caps.h > 0 ? P.captionGap + caps.h : 0;
      const room = inner.h - titleH - M - (band > 0 ? 0 : M) - rows * band - (rows - 1) * P.rowGap;
      return { band, ph: room / rows };
    };
    let pw = (inner.w - 2 * M - (cols - 1) * P.gutter) / cols;
    let caps = fitCaptions(texts, pw - 2 * P.caption.pad);
    if (!caps) return null;
    let { band, ph } = heightFor(caps);
    const natural = pw / ph;
    if (pw / ph > P.aspect.max) {
      // too wide for its height: narrower panels (and captions wrapped to them)
      pw = ph * P.aspect.max;
      caps = fitCaptions(texts, pw - 2 * P.caption.pad);
      if (!caps) return null;
      ({ band, ph } = heightFor(caps));
      pw = Math.min(pw, ph * P.aspect.max);
    }
    if (pw / ph < P.aspect.min) ph = pw / P.aspect.min;
    if (!(pw >= P.minFrame.w && ph >= P.minFrame.h)) return null;
    return { cols, rows, pw, ph, natural, caps, band };
  };
  const row = arrange(n);
  const grid = n > 1 ? arrange(n === 2 ? 1 : 2) : null;
  // a row when its panels are wide enough for a picture; else whichever is nearer a comfortable panel
  const fitness = (a: Arrangement) => Math.abs(Math.log(a.natural / 1.2));
  let pick = row ?? grid;
  if (row && grid && row.natural < P.rowAspectMin && fitness(grid) < fitness(row)) pick = grid;
  if (!pick) return null;
  const { cols, rows, pw, ph, caps, band } = pick;

  // ---- where everything is (layout px, the inner box's corner at 0, 0)
  const stripW = cols * pw + (cols - 1) * P.gutter;
  const x0 = (inner.w - stripW) / 2;
  const top = titleH + M;
  const outlines: Rect[] = [];
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols);
    const inRow = Math.min(cols, n - r * cols);
    // a short last row is centred under the full one
    const shift = ((cols - inRow) * (pw + P.gutter)) / 2;
    const c = i - r * cols;
    outlines.push({ x: x0 + shift + c * (pw + P.gutter), y: top + r * (ph + band + P.rowGap), w: pw, h: ph });
  }

  const s = new Sketch(opts.seed);
  if (title) s.write("title", title, { x: x0 + stripW / 2, y: 0 }, "center", "top", { color: INK.text });
  if (framed) {
    outlines.forEach((r, i) => {
      s.draw(`frame:${i}`, (pen) => frameStrokes(pen, r).map((st) => ({ ...st, weight: P.weight })), { color: INK.line });
    });
  }
  const baselines = outlines.map((r, i) => {
    const layout = caps.layouts[i];
    if (!layout) return null;
    const baseline = r.y + r.h + P.captionGap + caps.ascent;
    s.write(`caption:${i}`, layout, { x: r.x + r.w / 2, y: baseline - layout.ascent }, "center", "top", { color: INK.text });
    return baseline;
  });

  const inset = framed ? P.inset : 0;
  const areas = outlines.map((r) => ({ x: r.x + inset, y: r.y + inset, w: r.w - 2 * inset, h: r.h - 2 * inset }));
  // the plan's px: the inner box's corner is 2 px in from the box's
  const mx = (opts.box.w - inner.w) / 2;
  const my = (opts.box.h - inner.h) / 2;
  const moved = (r: Rect): Rect => ({ x: r.x + mx, y: r.y + my, w: r.w, h: r.h });
  const frames = areas.map(moved);
  const drawn = outlines.map(moved);
  const far = { w: Math.max(...frames.map((r) => r.x + r.w)), h: Math.max(...frames.map((r) => r.y + r.h)) };

  const done = s.finish(inner, P.pace, caps.size || INK_SIZE, { x: 0, y: 0 });
  let sketch: LectureSketch;
  if (done) {
    // the drawings will fill the frames: the plan's bounds hold them too
    const b = done.plan.bounds;
    sketch = { ...done, plan: { ...done.plan, bounds: { x: 0, y: 0, w: Math.max(b.w, far.w), h: Math.max(b.h, far.h) } } };
  } else {
    // nothing to write (one unframed picture, no words): the room is still the plan's
    if (framed || title || caps.size > 0) return null;
    const plan: HandPlan = { lines: [], bounds: { x: 0, y: 0, w: far.w, h: far.h }, size: INK_SIZE, totalMs: 0, pace: 1 };
    sketch = { plan, texts: [] };
  }
  if (sketch.plan.bounds.w > opts.box.w + 0.5 || sketch.plan.bounds.h > opts.box.h + 0.5) return null;
  return { sketch, frames, outlines: drawn, cols, rows, captionSize: caps.size, captionBaselines: baselines.map((b) => (b === null ? null : b + my)) };
}

/** The hand size a plan with no words reports. */
const INK_SIZE = 27;

/**
 * Every caption at one hand size: the largest at which each fits `maxW` in two lines (evenly
 * broken), else three lines small, else with a long word broken. `h` is 0 when there are none.
 */
function fitCaptions(texts: ReadonlyArray<string | undefined>, maxW: number): Captions | null {
  const C = PANELS.caption;
  if (texts.every((t) => !t)) return { layouts: texts.map(() => null), size: 0, ascent: 0, h: 0 };
  if (!(maxW > 0)) return null;
  const at = (size: number, lines: number): Captions | null => {
    const layouts: Array<WordsLayout | null> = [];
    for (const t of texts) {
      if (!t) {
        layouts.push(null);
        continue;
      }
      const m = measureWords(t, size, { maxWidth: maxW, maxLines: lines, balance: true });
      if (!m || m.w > maxW + 1e-6) return null;
      layouts.push(m);
    }
    const ascent = Math.max(...layouts.map((l) => l?.ascent ?? 0));
    const h = Math.max(...layouts.map((l) => (l ? ascent - l.ascent + l.h : 0)));
    return { layouts, size, ascent, h };
  };
  const search = (): Captions | null => {
    for (let size = C.size; size >= C.min; size--) {
      const c = at(size, C.lines);
      if (c) return c;
    }
    for (let size = C.min; size >= C.crowded.min; size--) {
      const c = at(size, C.crowded.lines);
      if (c) return c;
    }
    return null;
  };
  return search() ?? hyphenating(true, search);
}

/**
 * A frame, a side at a time — top and bottom left to right, the sides top to bottom — each line a
 * few px past its corners and its ends a hair off true, as a box ruled freehand is.
 */
function frameStrokes(pen: Pen, r: Rect) {
  const O = PANELS.overshoot;
  const over = () => O.min + pen.rng() * (O.max - O.min);
  const off = () => (pen.rng() - 0.5) * 1.4;
  const L = r.x;
  const T = r.y;
  const R = r.x + r.w;
  const B = r.y + r.h;
  const side = (a: Pt, b: Pt) => pen.line(a, b);
  return [
    ...side({ x: L - over(), y: T + off() }, { x: R + over(), y: T + off() }),
    ...side({ x: R + off(), y: T - over() }, { x: R + off(), y: B + over() }),
    ...side({ x: L - over(), y: B + off() }, { x: R + over(), y: B + off() }),
    ...side({ x: L + off(), y: T - over() }, { x: L + off(), y: B + over() }),
  ];
}
