import type { Stroke } from "@/lib/hand";
import type { Rect } from "../../contracts";
import { Pen, clipPolyline, type Pt } from "../../graphing/pen";
import type { HandLineStyle } from "../../handwriting";
import { INK, LECTURE_TEXT, Sketch, closedStroke, innerBox, type LectureSketch } from "../chart/sketch";
import type { LectureInk, SketchDrawing } from "../contracts";
import { fitWords, hyphenating, type WordsLayout } from "../words";

/**
 * An illustrator's drawing as the tutor's ink. The drawing arrives as polylines in its own box
 * (1000 wide, y down: `SketchDrawing`); this fits it into the desk's box and redraws every line
 * with the pen of the charts and the diagrams, so a comic panel and a bar chart on one screen are
 * one hand.
 *
 * FIT. What is past the drawing's own box is off the picture and clipped away (a filled shape stays
 * a closed shape, cut along the edge; an open line is cut into what is inside). A closed rectangle
 * that is the whole box — the illustrator's background — is left out: on the board it would be a
 * tinted slab with a second border just inside the panel's frame. What is left is scaled, aspect
 * kept, to fill the box and centred in it (with its labels: see WORDS); a small subject is enlarged
 * at most `maxZoom` times past the size its own box would give it, so a lone heart does not become
 * a poster.
 *
 * THE HAND. The illustrator's lines are exact; a hand's are not. Each is simplified to the points
 * that shape it, a long straight run bows a little as a drawn line does, and the pen adds its
 * tremor at 2 px (tldraw smooths what it is given, so a sparse line would lose its corners). The
 * ends are where the illustrator put them. An open line longer than a pen stroke is several
 * strokes; a closed one is ONE stroke that goes on a little past where it began (a hand never
 * lands exactly on its start), so the board can close it and fill it with the pale tint of its
 * colour once it is whole.
 *
 * ORDER. A person blocks a picture in: the big shapes first, then the middle-sized, then the small
 * details, then the words. But a filled shape is opaque on the board and paints over whatever was
 * drawn before it, so the illustrator's layering is kept wherever it matters: of two strokes that
 * overlap where either is filled, the one the illustrator drew first is drawn first. Only lines
 * that cannot hide each other are reordered.
 *
 * PEN WEIGHT. A picture is many lines close together; at the writing's full pen they clot. Lines
 * take `weight` (a tldraw draw shape's scale), a small detail a finer pen still, as small writing
 * does (`wordsWeight`).
 *
 * WORDS. Labels are written in the tutor's hand at a size a student can read (`label`), whatever
 * the drawing is scaled to, so the fit makes room for them: the region fitted into the box is the
 * ink AND every label where it will be written. A label is centred where the illustrator put it —
 * unless a line ends under it and runs away from it, a leader: then it is written just past the
 * leader's end, level with it, the way a person labels a diagram (`labelAnchor`). From there it
 * moves a little, if it must, to paper no line crosses and no other label is on (`bestPlace`). Two
 * labels never touch; one that finds no room near its place is left out rather than written over
 * another.
 *
 * Every line is a named part — "stroke:12" is the drawing's thirteenth stroke, "label:0" its first
 * label — with its ink from a pen seeded by the sketch's seed and that name: the same drawing and
 * seed give the same ink, stroke for stroke.
 */

export const SKETCH_INK = {
  /** the pen of a drawing's lines, lighter than the writing's (1): a busy picture must not clot */
  weight: 0.8,
  /** …and of its smallest details (an eye, a rivet), which a heavier pen fills in */
  detailWeight: 0.55,
  /** px: a mark this big or smaller takes the detail pen, from `lineAt` up the full one (between, in between) */
  detailAt: 10,
  lineAt: 44,
  /** px a simplified line may stray from the illustrator's */
  simplify: 0.3,
  /** a straight run this long (px) or longer bows by `k` of its length, at most `max` px */
  bow: { from: 36, k: 0.006, max: 1.6 },
  /** the pen's tremor, px (the charts' lines: 0.3–0.35) */
  jitter: 0.3,
  /** a closed shape runs on past its start by this much (px), at most `share` of the way round */
  overshoot: { px: 6, share: 0.05 },
  /** a mark smaller than this (px) across is drawn as a dot */
  dotAt: 1.5,
  dotR: 1.4,
  /** a subject that fills little of its box is enlarged at most this much past its box's own fit */
  maxZoom: 1.5,
  /** a closed stroke this close to every edge of the drawing's box (share of it), and this nearly a rectangle, is its background */
  background: { edge: 0.03, fullness: 0.9 },
  /** blocking in: a stroke at least this share of the drawing's size is a big shape, at least `mid` a middle one */
  tiers: { big: 0.25, mid: 0.08 },
  /** a label's hand size: the illustrator's (scaled) or `size`, within min..max; px between labels; the box's edge */
  label: { size: LECTURE_TEXT.small.size, min: LECTURE_TEXT.small.min, max: 30, clear: 4, edge: 3, leaderGap: 6 },
  /** a line this long (drawing units) or longer may be a label's leader */
  leaderMin: 20,
  /**
   * How far a label may move off its spot to find clearer paper (label heights), what a label
   * height of moving costs (in 3 px cells of ink under it), and the paper it wants clear round its
   * words (px): a leader line that runs into its label's first letter is worth a nudge.
   */
  labelMove: { max: 2, cost: 2.5, clear: 3 },
  /** the most points of one pen stroke (the HandWriter's cap is 400) */
  maxPoints: 390,
  /** a picture is on the board in about 4–6 s of wall time, however many lines it has */
  pace: { naturalUpToMs: 4000, maxWallMs: 6000 },
} as const;

/** A stroke of the drawing, fitted into the box: what the planner knows of it before the pen draws it. */
interface Mark {
  /** its index in `drawing.strokes` (the part's name) */
  index: number;
  /** a closed shape's ring (no repeated end), or an open line's pieces left after clipping */
  ring: Pt[] | null;
  pieces: Pt[][];
  fill: boolean;
  color: LectureInk;
  box: Rect;
  extent: number;
  tier: number;
}

/** The drawing as ink in the box, with its words (for the tests and the gallery). Null when nothing of it can be drawn there. */
export function sketchDrawing(drawing: SketchDrawing, opts: { seed: number; box: { w: number; h: number } }): LectureSketch | null {
  const inner = innerBox(opts.box);
  if (!(inner.w >= 24 && inner.h >= 24)) return null;
  const frame = { w: finiteOr(drawing.w, 1000), h: finiteOr(drawing.h, 1000) };
  if (!(frame.w > 0 && frame.h > 0)) return null;
  const S = SKETCH_INK;

  // ---- clip to the drawing's box, in its own units
  const clipped: Array<{ index: number; ring: Pt[] | null; pieces: Pt[][]; fill: boolean; color: LectureInk }> = [];
  const frameRect: Rect = { x: 0, y: 0, w: frame.w, h: frame.h };
  (drawing.strokes ?? []).forEach((s, index) => {
    const raw = dedupe((s.points ?? []).filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])).map(([x, y]) => ({ x, y })));
    if (raw.length < 1) return;
    const color: LectureInk = s.color ?? INK.line;
    const closed = (s.closed || s.fill) && openRing(raw).length >= 3;
    if (closed) {
      const ring = openRing(raw);
      if (isBackground(ring, frame)) return;
      if (s.fill) {
        const cut = clipPolygon(ring, frame);
        if (cut.length >= 3 && Math.abs(area(cut)) > 1e-6) clipped.push({ index, ring: cut, pieces: [], fill: true, color });
        // a "shape" with no inside is the line it is
        else if (cut.length >= 2) clipped.push({ index, ring: null, pieces: [cut], fill: false, color });
        return;
      }
      if (ring.every((p) => p.x >= 0 && p.x <= frame.w && p.y >= 0 && p.y <= frame.h)) {
        clipped.push({ index, ring, pieces: [], fill: false, color });
        return;
      }
      // an outline that runs off the picture: what is left of it is open
      const pieces = clipPolyline([...ring, ring[0]], frameRect).map(dedupe).filter((p) => p.length >= 2);
      if (pieces.length > 0) clipped.push({ index, ring: null, pieces, fill: false, color });
      return;
    }
    if (raw.length === 1) {
      const p = raw[0];
      if (p.x >= 0 && p.x <= frame.w && p.y >= 0 && p.y <= frame.h) clipped.push({ index, ring: null, pieces: [[p, p]], fill: false, color });
      return;
    }
    const pieces = clipPolyline(raw, frameRect).map(dedupe).filter((p) => p.length >= 1);
    if (pieces.length > 0) clipped.push({ index, ring: null, pieces: pieces.map((p) => (p.length === 1 ? [p[0], p[0]] : p)), fill: false, color });
  });
  if (clipped.length === 0) return null;

  // ---- fit what is left: its box, aspect kept, centred, enlarged at most `maxZoom` past the drawing's own fit
  const labels = (drawing.labels ?? []).filter((l) => l && Number.isFinite(l.x) && Number.isFinite(l.y) && typeof l.text === "string" && l.text.trim().length > 0);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const take = (p: Pt) => {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  };
  for (const c of clipped) for (const line of c.ring ? [c.ring] : c.pieces) line.forEach(take);
  // a drawing that is a speck of its box is not a picture
  if (Math.max(maxX - minX, maxY - minY) < Math.min(frame.w, frame.h) * 0.01) return null;
  const ink: Rect = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  const own = Math.min(inner.w / frame.w, inner.h / frame.h);
  const scaleFor = (r: Rect) => Math.min(r.w > 0 ? inner.w / r.w : Infinity, r.h > 0 ? inner.h / r.h : Infinity, own * S.maxZoom);
  // the words need room too: each label where it will be written, at the size it will have, is in
  // the region — until the scale settles, as a label's size in drawing units grows as the scale shrinks
  const ends = lineEnds(clipped);
  const anchorsAt = (scale: number) =>
    labels.map((l) => {
      const size = labelSize(l, scale);
      const layout = labelLayout(l.text, size, size, inner.w - 2 * S.label.edge);
      return labelAnchor(l, frame, (layout?.w ?? 0) / scale, (layout?.h ?? 0) / scale, ends, S.label.leaderGap / scale);
    });
  let region = ink;
  let k = scaleFor(region);
  for (let pass = 0; pass < 8 && labels.length > 0; pass++) {
    // (with the paper a label keeps from the box's edge)
    region = unionOf([ink, ...anchorsAt(k).map((r) => grow(r, S.label.edge / k))]);
    const next = scaleFor(region);
    const settled = Math.abs(next - k) <= k * 1e-3;
    k = Math.min(k, next);
    if (settled) break;
  }
  const anchors = anchorsAt(k).map((r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 }));
  const ox = (inner.w - region.w * k) / 2 - region.x * k;
  const oy = (inner.h - region.h * k) / 2 - region.y * k;
  const fit = (p: Pt): Pt => ({ x: p.x * k + ox, y: p.y * k + oy });

  // ---- each stroke in px, simplified to the points that shape it
  const size = Math.max(ink.w, ink.h) * k;
  const marks: Mark[] = [];
  for (const c of clipped) {
    const ring = c.ring ? openRing(simplify([...c.ring.map(fit), fit(c.ring[0])], S.simplify)) : null;
    const pieces = c.pieces.map((p) => simplify(p.map(fit), S.simplify));
    const box = boundsOf(ring ? [ring] : pieces);
    const extent = Math.max(box.w, box.h);
    const tier = extent >= size * S.tiers.big ? 0 : extent >= size * S.tiers.mid ? 1 : 2;
    if (ring && ring.length < 3) {
      // simplified to a line: drawn as one
      marks.push({ index: c.index, ring: null, pieces: [[...ring, ring[0]]], fill: false, color: c.color, box, extent, tier });
      continue;
    }
    marks.push({ index: c.index, ring, pieces, fill: c.fill && ring !== null, color: c.color, box, extent, tier });
  }

  // ---- drawn in order, each stroke one part
  const s = new Sketch(opts.seed);
  const grid = new InkGrid(inner);
  let drawn = 0;
  for (const m of drawingOrder(marks)) {
    const part = `stroke:${m.index}`;
    const pen = s.pen(part);
    const strokes = penStrokes(pen, m);
    if (strokes.length === 0) continue;
    drawn++;
    const weight = weightFor(m.extent);
    for (const st of strokes) {
      st.weight = weight;
      grid.mark(st.points);
    }
    const style: HandLineStyle = m.ring ? { color: m.color, closed: true, ...(m.fill ? { fill: "solid" as const } : {}) } : { color: m.color };
    s.draw(part, strokes, style);
  }
  // labels with nothing drawn are not a picture
  if (drawn === 0) return null;

  // ---- then the words
  placeLabels(s, labels, anchors, k, fit, inner, grid);

  return s.finish(inner, S.pace, LECTURE_TEXT.label.size, { x: 0, y: 0 });
}

// ------------------------------------------------------------------ the pen

/** The pen strokes of one mark: a dot, a closed shape in one stroke, or an open line in pen-sized strokes. */
function penStrokes(pen: Pen, m: Mark): Stroke[] {
  const S = SKETCH_INK;
  if (m.extent < S.dotAt) {
    const c = { x: m.box.x + m.box.w / 2, y: m.box.y + m.box.h / 2 };
    return pen.dot(c, S.dotR);
  }
  if (m.ring) {
    let round = 0;
    for (let i = 0; i < m.ring.length; i++) round += dist(m.ring[i], m.ring[(i + 1) % m.ring.length]);
    const over = Math.min(S.overshoot.px, round * S.overshoot.share) * (0.7 + pen.rng() * 0.6);
    return capPoints(closedStroke(pen, goRound(bowed(pen, [...m.ring, m.ring[0]]).slice(0, -1), over), S.jitter));
  }
  const out: Stroke[] = [];
  for (const piece of m.pieces) {
    if (piece.length < 2) continue;
    if (dist(piece[0], piece[piece.length - 1]) < 1e-9 && piece.every((p) => dist(p, piece[0]) < S.dotAt)) {
      out.push(...pen.dot(piece[0], S.dotR));
      continue;
    }
    out.push(...pen.polyline(bowed(pen, piece), S.jitter));
  }
  return capPoints(out);
}

/** A long straight run bows a little, as a drawn line does (curves are short runs and keep their shape). */
function bowed(pen: Pen, pts: readonly Pt[]): Pt[] {
  const B = SKETCH_INK.bow;
  const out: Pt[] = pts.length ? [pts[0]] : [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const len = dist(a, b);
    if (len >= B.from) {
      const amp = Math.min(B.max, len * B.k) * (pen.rng() < 0.5 ? -1 : 1);
      const nx = -(b.y - a.y) / len;
      const ny = (b.x - a.x) / len;
      const n = Math.ceil(len / 6);
      for (let j = 1; j < n; j++) {
        const t = j / n;
        const off = amp * Math.sin(Math.PI * t);
        out.push({ x: a.x + (b.x - a.x) * t + nx * off, y: a.y + (b.y - a.y) * t + ny * off });
      }
    }
    out.push(b);
  }
  return out;
}

/** Round a ring from its first point, and on past it by `over` px along the way it went. */
function goRound(ring: readonly Pt[], over: number): Pt[] {
  const out = [...ring, ring[0]];
  let left = over;
  for (let i = 1; i < ring.length && left > 1e-6; i++) {
    const a = ring[i - 1];
    const b = ring[i];
    const d = dist(a, b);
    if (d >= left) {
      out.push({ x: a.x + ((b.x - a.x) * left) / d, y: a.y + ((b.y - a.y) * left) / d });
      break;
    }
    out.push(b);
    left -= d;
  }
  return out;
}

/** No stroke longer than the HandWriter takes: a pathological scribble is cut into consecutive strokes. */
function capPoints(strokes: Stroke[]): Stroke[] {
  const max = SKETCH_INK.maxPoints;
  if (strokes.every((s) => s.points.length <= max)) return strokes;
  const out: Stroke[] = [];
  for (const s of strokes) {
    if (s.points.length <= max) {
      out.push(s);
      continue;
    }
    for (let i = 0; i < s.points.length - 1; i += max - 1) out.push({ ...s, points: s.points.slice(i, i + max) });
  }
  return out.filter((s) => s.points.length >= 2);
}

/** The pen for a mark this big across (px): the detail pen for the smallest, the line pen from `lineAt`. */
export function weightFor(extent: number): number {
  const S = SKETCH_INK;
  const t = clamp((extent - S.detailAt) / (S.lineAt - S.detailAt), 0, 1);
  return Math.round((S.detailWeight + (S.weight - S.detailWeight) * t) * 20) / 20;
}

// ------------------------------------------------------------------ the order

/**
 * Big shapes, then middle-sized, then details — each tier in the illustrator's order — except that
 * two strokes overlapping where either is filled keep the illustrator's order (a filled shape hides
 * what was drawn before it; see the file's note).
 */
function drawingOrder(marks: readonly Mark[]): Mark[] {
  const n = marks.length;
  const after: number[][] = marks.map(() => []);
  const waits = new Array<number>(n).fill(0);
  // marks are in the illustrator's order already
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (!(marks[i].fill || marks[j].fill) || !overlaps(marks[i].box, marks[j].box)) continue;
      after[i].push(j);
      waits[j]++;
    }
  }
  const out: Mark[] = [];
  const done = new Array<boolean>(n).fill(false);
  for (let step = 0; step < n; step++) {
    let best = -1;
    for (let i = 0; i < n; i++) {
      if (done[i] || waits[i] > 0) continue;
      if (best < 0 || marks[i].tier < marks[best].tier) best = i;
    }
    // (a cycle is impossible: every edge runs forward in the illustrator's order)
    done[best] = true;
    out.push(marks[best]);
    for (const j of after[best]) waits[j]--;
  }
  return out;
}

// ------------------------------------------------------------------ the words

/**
 * Where ink is, on a 3 px grid over the box, with running sums — so how much ink a label would sit
 * on is four lookups, whatever its size.
 */
class InkGrid {
  private static readonly cell = 3;
  private readonly cols: number;
  private readonly rows: number;
  private readonly hit: Uint8Array;
  private sums: Int32Array | null = null;

  constructor(box: { w: number; h: number }) {
    this.cols = Math.max(1, Math.ceil(box.w / InkGrid.cell) + 1);
    this.rows = Math.max(1, Math.ceil(box.h / InkGrid.cell) + 1);
    this.hit = new Uint8Array(this.cols * this.rows);
  }

  mark(points: readonly Pt[]): void {
    for (const p of points) {
      const c = Math.floor(p.x / InkGrid.cell);
      const r = Math.floor(p.y / InkGrid.cell);
      if (c >= 0 && r >= 0 && c < this.cols && r < this.rows) this.hit[r * this.cols + c] = 1;
    }
    this.sums = null;
  }

  /** Grid cells with ink in them inside the rect. */
  count(r: Rect): number {
    const sums = this.sums ?? this.build();
    const W = this.cols + 1;
    const c0 = clamp(Math.floor(r.x / InkGrid.cell), 0, this.cols);
    const r0 = clamp(Math.floor(r.y / InkGrid.cell), 0, this.rows);
    const c1 = clamp(Math.ceil((r.x + r.w) / InkGrid.cell), 0, this.cols);
    const r1 = clamp(Math.ceil((r.y + r.h) / InkGrid.cell), 0, this.rows);
    return sums[r1 * W + c1] - sums[r0 * W + c1] - sums[r1 * W + c0] + sums[r0 * W + c0];
  }

  private build(): Int32Array {
    const W = this.cols + 1;
    const sums = new Int32Array(W * (this.rows + 1));
    for (let r = 0; r < this.rows; r++) {
      let run = 0;
      for (let c = 0; c < this.cols; c++) {
        run += this.hit[r * this.cols + c];
        sums[(r + 1) * W + c + 1] = sums[r * W + c + 1] + run;
      }
    }
    this.sums = sums;
    return sums;
  }
}

/** A label's words at the largest size from `max` down to `min` that fits the width: one line, else two. */
function labelLayout(text: string, max: number, min: number, maxW: number): WordsLayout | null {
  const one = () => fitWords(text, { maxWidth: maxW, maxLines: 1, maxSize: max, minSize: min });
  const two = () => fitWords(text, { maxWidth: maxW, maxLines: 2, maxSize: max, minSize: min, balance: true });
  return one() ?? two() ?? hyphenating(true, two);
}

/** Offsets tried round a label's spot, in label heights (y) and widths (x), nearest first. */
const AROUND: ReadonlyArray<readonly [number, number]> = (() => {
  const out: Array<[number, number]> = [];
  for (const dy of [0, -0.35, 0.35, -0.7, 0.7, -1.2, 1.2, -1.8, 1.8]) for (const dx of [0, -0.12, 0.12, -0.25, 0.25, -0.5, 0.5]) out.push([dx, dy]);
  return out;
})();

/** A label's hand size at scale `k`: the illustrator's size scaled, or the usual, within what reads well. */
function labelSize(label: { size?: number }, k: number): number {
  const L = SKETCH_INK.label;
  return clamp(Math.round(label.size ? label.size * k : L.size), L.min, L.max);
}

function placeLabels(s: Sketch, labels: SketchDrawing["labels"], anchors: readonly Pt[], k: number, fit: (p: Pt) => Pt, inner: { w: number; h: number }, ink: InkGrid): void {
  const L = SKETCH_INK.label;
  const M = SKETCH_INK.labelMove;
  const taken: Rect[] = [];
  labels.forEach((label, i) => {
    const want = labelSize(label, k);
    const spot = fit(anchors[i]);
    // the largest size that fits the width and finds a free place; smaller only when crowded
    const sizes: number[] = [];
    for (let size = want; size > L.min; size -= 2) sizes.push(size);
    sizes.push(L.min);
    for (const size of sizes) {
      const layout = labelLayout(label.text, size, size, inner.w - 2 * L.edge);
      if (!layout) continue;
      const best = bestPlace(layout, spot, inner, ink, taken, M);
      if (!best) continue;
      const part = `label:${i}`;
      const w = s.words(part, layout, { x: best.x + layout.w / 2, y: best.y }, "center", "top");
      s.add(part, w);
      taken.push(w.rect);
      return;
    }
  });
}

/** Where an open line ends, and the way it runs from there (a unit vector into the line). */
type LineEnd = { p: Pt; dir: Pt };

/** The ends of the drawing's open lines long enough to be a label's leader (drawing units). */
function lineEnds(clipped: ReadonlyArray<{ ring: Pt[] | null; pieces: Pt[][] }>): LineEnd[] {
  const out: LineEnd[] = [];
  const from = (pts: readonly Pt[]) => {
    const a = pts[0];
    for (let i = 1; i < pts.length; i++) {
      const d = dist(a, pts[i]);
      if (d >= 4) return { p: a, dir: { x: (pts[i].x - a.x) / d, y: (pts[i].y - a.y) / d } };
    }
    return null;
  };
  for (const c of clipped) {
    if (c.ring) continue;
    for (const piece of c.pieces) {
      let len = 0;
      for (let i = 1; i < piece.length; i++) len += dist(piece[i - 1], piece[i]);
      if (len < SKETCH_INK.leaderMin) continue;
      const head = from(piece);
      const tail = from([...piece].reverse());
      if (head) out.push(head);
      if (tail) out.push(tail);
    }
  }
  return out;
}

/**
 * Where a label of w × h (drawing units) is written. At its spot — unless a line ends under it and
 * runs away from it, a leader pointing from the label to what it names: then the words go just past
 * the line's end (`gap`), level with it, on the side the illustrator put them — beside the end for a
 * leader that runs across, above or below it for one that runs up or down — as a person writes a
 * label at the end of the line they drew to it, instead of across it.
 */
function labelAnchor(label: { x: number; y: number }, frame: { w: number; h: number }, w: number, h: number, ends: readonly LineEnd[], gap: number): Rect {
  const c = { x: clamp(label.x, 0, frame.w), y: clamp(label.y, 0, frame.h) };
  const at = { x: c.x - w / 2, y: c.y - h / 2, w, h };
  const zone = grow(at, gap);
  let lead: LineEnd | null = null;
  for (const e of ends) {
    const inZone = e.p.x >= zone.x && e.p.x <= zone.x + zone.w && e.p.y >= zone.y && e.p.y <= zone.y + zone.h;
    const away = e.dir.x * (e.p.x - c.x) + e.dir.y * (e.p.y - c.y) > 0;
    if (inZone && away && (!lead || dist(e.p, c) < dist(lead.p, c))) lead = e;
  }
  if (!lead) return at;
  const off = { x: c.x - lead.p.x, y: c.y - lead.p.y };
  const ax = Math.abs(lead.dir.x);
  const ay = Math.abs(lead.dir.y);
  // a clearly level leader: beside; a clearly upright one: above or below; else where the label is
  const beside = ax >= 2 * ay ? true : ay >= 2 * ax ? false : Math.abs(off.x) >= Math.abs(off.y);
  const cx = beside ? lead.p.x + (off.x >= 0 ? gap + w / 2 : -gap - w / 2) : lead.p.x;
  const cy = beside ? lead.p.y : lead.p.y + (off.y >= 0 ? gap + h / 2 : -gap - h / 2);
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/** The clearest place for the label near its spot that no other label is in; null when every place near is taken. */
function bestPlace(layout: WordsLayout, spot: Pt, inner: { w: number; h: number }, ink: InkGrid, taken: readonly Rect[], move: { max: number; cost: number; clear: number }): Rect | null {
  const L = SKETCH_INK.label;
  let best: Rect | null = null;
  let bestCost = Infinity;
  // where it would go, kept inside the box: being kept in is not moving away
  const place = (cx: number, cy: number) => ({ x: clamp(cx - layout.w / 2, L.edge, inner.w - L.edge - layout.w), y: clamp(cy - layout.h / 2, L.edge, inner.h - L.edge - layout.h) });
  const base = place(spot.x, spot.y);
  for (const [fx, fy] of AROUND) {
    const { x, y } = place(base.x + layout.w / 2 + fx * layout.w, base.y + layout.h / 2 + fy * layout.h);
    if (!(x >= L.edge - 1e-6 && y >= L.edge - 1e-6)) continue;
    const r = { x, y, w: layout.w, h: layout.h };
    const moved = Math.hypot(x - base.x, y - base.y) / layout.h;
    if (moved > move.max + 0.35) continue;
    if (taken.some((t) => overlaps(grow(r, 2), grow(t, L.clear)))) continue;
    const cost = ink.count(grow(r, move.clear)) + moved * move.cost;
    if (cost < bestCost - 1e-9) {
      bestCost = cost;
      best = r;
    }
  }
  return best;
}

// ------------------------------------------------------------------ geometry

/** Sutherland–Hodgman: the part of a closed polygon inside the box, still closed. */
function clipPolygon(ring: readonly Pt[], box: { w: number; h: number }): Pt[] {
  type Edge = { inside: (p: Pt) => boolean; cut: (a: Pt, b: Pt) => Pt };
  const at = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const edges: Edge[] = [
    { inside: (p) => p.x >= 0, cut: (a, b) => at(a, b, (0 - a.x) / (b.x - a.x)) },
    { inside: (p) => p.x <= box.w, cut: (a, b) => at(a, b, (box.w - a.x) / (b.x - a.x)) },
    { inside: (p) => p.y >= 0, cut: (a, b) => at(a, b, (0 - a.y) / (b.y - a.y)) },
    { inside: (p) => p.y <= box.h, cut: (a, b) => at(a, b, (box.h - a.y) / (b.y - a.y)) },
  ];
  let out: Pt[] = [...ring];
  for (const e of edges) {
    if (out.length === 0) break;
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i];
      const prev = input[(i + input.length - 1) % input.length];
      const inCur = e.inside(cur);
      const inPrev = e.inside(prev);
      if (inCur) {
        if (!inPrev) out.push(e.cut(prev, cur));
        out.push(cur);
      } else if (inPrev) out.push(e.cut(prev, cur));
    }
  }
  return dedupe(out);
}

/** A closed rectangle covering the drawing's whole box: the illustrator's background. */
function isBackground(ring: readonly Pt[], frame: { w: number; h: number }): boolean {
  const B = SKETCH_INK.background;
  const b = boundsOf([ring]);
  const ex = frame.w * B.edge;
  const ey = frame.h * B.edge;
  if (!(b.x <= ex && b.y <= ey && b.x + b.w >= frame.w - ex && b.y + b.h >= frame.h - ey)) return false;
  return Math.abs(area(ring)) >= B.fullness * b.w * b.h;
}

/** Douglas–Peucker: the points that shape the line, within `tol` px of it. */
function simplify(pts: readonly Pt[], tol: number): Pt[] {
  if (pts.length <= 2) return [...pts];
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const tol2 = tol * tol;
  const stack: number[] = [0, pts.length - 1];
  while (stack.length > 0) {
    const b = stack.pop() as number;
    const a = stack.pop() as number;
    const ax = pts[a].x;
    const ay = pts[a].y;
    const dx = pts[b].x - ax;
    const dy = pts[b].y - ay;
    const len2 = dx * dx + dy * dy;
    let far = -1;
    let farD = tol2;
    for (let i = a + 1; i < b; i++) {
      const px = pts[i].x - ax;
      const py = pts[i].y - ay;
      const t = len2 > 1e-12 ? clamp((px * dx + py * dy) / len2, 0, 1) : 0;
      const d2 = (px - t * dx) ** 2 + (py - t * dy) ** 2;
      if (d2 > farD) {
        farD = d2;
        far = i;
      }
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push(a, far, far, b);
    }
  }
  const out: Pt[] = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
  return out;
}

/** A ring's points without its end repeated (the illustrator may or may not close it by hand). */
function openRing(pts: readonly Pt[]): Pt[] {
  const out = [...pts];
  while (out.length > 1 && dist(out[0], out[out.length - 1]) < 1e-6) out.pop();
  return out;
}

/** The points without repeats in a row. */
function dedupe(pts: readonly Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) if (out.length === 0 || dist(out[out.length - 1], p) > 1e-9) out.push(p);
  return out;
}

function area(ring: readonly Pt[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

function boundsOf(lines: readonly (readonly Pt[])[]): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const line of lines) {
    for (const p of line) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  return Number.isFinite(minX) ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY } : { x: 0, y: 0, w: 0, h: 0 };
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
}

function grow(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by };
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function finiteOr(v: unknown, or: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : or;
}

function unionOf(rects: readonly Rect[]): Rect {
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
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
