import type { TLShapeId } from "tldraw";
import type { InkLine, InkStroke, Rect, StrokePayload } from "./contracts";
import { clusterStrokeGroups, inkScale, median, medianStrokeHeight, unionRects } from "./strokeClusters";
import { buildPayload, rdp, type Pt } from "./strokePayload";
import { tableRules } from "./proof/table";

/**
 * Drawings vs writing. Pure: no editor, no DOM.
 *
 * Students draw: a triangle with its sides labelled, a circle and its radius, a number line with
 * ticks, axes with a line sketched on them, an arrow. Every stroke used to be taken for
 * handwriting, so a triangle drawn beside `a^2 + b^2 = c^2` was clustered into that line (and
 * Mathpix read garbage), a big drawing became a "line" of its own that got a "?", and each label
 * on it was read as a one-character line. `splitInk` runs BEFORE lines are formed and takes the
 * drawings and everything attached to them out of the ink the clusterer sees:
 *
 *  1. The glyph scale G: the median stroke height (in practice the x-height, ~12 px for the tutor's
 *     44 px hand), measured again without the strokes plainly bigger than it (a drawing of many
 *     strokes would otherwise set it), capped at `glyphMax` so a screen with nothing but a drawing
 *     on it still has a scale. The cap is what a big hand looks like on a desktop, so it is scaled
 *     to the board's zoom (`SplitOptions.zoom`, `inkScale`): on a phone held upright the board is
 *     shown at a fifth of its size and the same hand is five times bigger in page px — capped at
 *     30 px, `2x2` written 130 px tall was two "big curves" and a label, and never read. And ink
 *     that is rows of writing (`writingRows`: three glyph columns or more side by side in a line,
 *     not shapes) is its own scale on any screen: a big hand on a desktop is no drawing either.
 *  2. Each stroke by its own shape. Under `bigFactor` x G both ways it is a glyph (a `0` is closed
 *     and a `1` straight: size is what makes a drawing). Bigger: a long DIAGONAL (a triangle's
 *     side, a sketched line) or a BIG shape both ways (a circle, a triangle in one stroke, a
 *     parabola) is a drawing — unless writing fills its box or sits under a long level top (a
 *     radical over a fraction, a long-division bracket). A long level or upright stroke (a RULE),
 *     a TALL thin one and a FLAT wide one are ambiguous: fraction bars, `=`, overbars, long
 *     division, absolute-value bars, integral signs and big brackets look exactly like that.
 *  3. The ambiguous ones by what is around them. Writing evidence: writing covers half its span on
 *     one side (above / below, left / right for an upright one, gaps of a glyph between glyphs
 *     bridged), or fills its box. Drawing evidence that wins even over writing: two long rules
 *     crossing or meeting at a corner (axes), short strokes going right through it as ticks (a
 *     number line — the ticks join it), an arrowhead at an end (its barbs join it), straight sides
 *     whose ends pair up into a closed polygon (a rectangle in four strokes), an END joined to a
 *     drawing (a triangle's base, a right triangle's legs, a radius). With no writing evidence, a
 *     rule also becomes a drawing by touching one, by having nothing near it (the first side of
 *     a triangle, drawn a moment before the rest), or by being `loneRuleFactor` glyphs long.
 *     Anything else stays writing.
 *  4. Drawing strokes that touch, or lie inside one another's box, are one drawing.
 *  5. What is left is clustered as before (`clusterStrokeGroups`). Near a drawing, a small stroke
 *     touching it is a MARK (an angle arc, a right-angle square, an open circle) and a small
 *     cluster is a LABEL (a vertex letter, a side length, `40°`, the numbers under a number line)
 *     — unless it holds a relation (`=`, `<`, `>`): `x = ?` beside a triangle is a question, a
 *     line of maths, and keeps every stroke. From such a line only labels the clusterer ran into
 *     it are taken back (`peelShadow`, `peelLabel`).
 *
 * Drawings are never recognized, never marked and never joined to a line; their labels are read
 * together, with one recognizer call (`labelPayload`), as the drawing's context.
 *
 * Before step 2, two kinds of rule are set aside as neither: a proof's T-table (`tableRules`), and
 * a "divide both sides" bar (`divisionBars`) — a long level rule under a WHOLE equation (the
 * student's own line, holding a relation, or a problem the tutor wrote: `SplitOptions.equations`,
 * whose ink is not among the strokes) with a short cluster of writing just under it and nothing
 * else on it. Under the tutor's problem such a bar had no writing about it and was a drawing (the
 * `2` under it a label); under the student's line it was a fraction bar, and the whole equation a
 * fraction over 2. Now the bar and the divisor are one line of their own (`InkSplit.bars`),
 * written `\div 2` for the engine (`engine/operationLine.ts`).
 */

export const DIAGRAM_RULES = {
  /** a stroke this many glyphs (G) across on its larger side is bigger than any glyph */
  bigFactor: 3.5,
  /** under this many glyphs a straight stroke is a glyph; between it and `bigFactor` it joins a drawing only at an end */
  mediumFactor: 2,
  /**
   * The glyph scale is clamped to this range (page px). The cap is what gives a screen with only
   * a drawing on it a scale (its own strokes would otherwise be the "glyphs"); the tutor's hand
   * writes ~44 px lines on a 1600 x 900 screen. The cap is for a desktop: it is multiplied by
   * `inkScale` of the board's zoom (`SplitOptions.zoom`). Ink that is rows of writing
   * (`writingRows`) is its own scale, cap or not.
   */
  glyphMin: 8,
  glyphMax: 30,
  /**
   * Rows of writing (`writingRows`): a line holding at least `rowMinColumns` glyph columns that are
   * not shapes — strokes whose x-ranges overlap by `columnOverlapShare` of the narrower are one
   * column (the two strokes of an `x`, a `+`, an `=`).
   */
  rowMinColumns: 3,
  columnOverlapShare: 0.5,
  /** polyline simplification: the fine one for distances (x G), the coarse one for shape (x the stroke's size) */
  fineFactor: 0.05,
  shapeFactor: 0.06,
  shapeMinPx: 2,
  /** a rule: its longest straight piece is this share of the path, or `ruleHookedShare` with only short hooks besides */
  ruleShare: 0.8,
  ruleHookedShare: 0.6,
  /** a hook is at most this many glyphs, or this share of the main piece */
  hookMaxFactor: 2,
  hookMaxShare: 0.3,
  /** level within this many degrees; upright within `uprightToleranceDeg` of vertical (handwriting leans) */
  levelToleranceDeg: 15,
  uprightToleranceDeg: 25,
  /** closed: the ends meet within this share of the stroke's size, and the path goes round */
  closeShare: 0.2,
  /** thin: one side this many times the other, and the thin side at most `thinMaxFactor` glyphs */
  thinAspect: 2.2,
  thinMaxFactor: 3,
  /** writing evidence: covered share of the span beside it, or filled share of its box */
  coverShare: 0.5,
  fillShare: 0.35,
  /** how far beside a rule writing is looked for (x G) */
  coverReachFactor: 2.2,
  /** gaps up to this many glyphs between covering strokes count as covered (spaces inside a line) */
  coverBridgeFactor: 1.2,
  /** strokes touch within max(touchMinPx, touchFactor x G) */
  touchFactor: 0.35,
  touchMinPx: 3,
  /** an end meets a stroke within this many glyphs (corners, T-junctions, an arrow's tip) */
  cornerFactor: 0.6,
  /** two crossing / cornering rules make axes or a rectangle only when both are this long (x G) */
  perpMinFactor: 4,
  /** ticks: at most this many glyphs long, crossing the rule; at least `tickMinCount` of them */
  tickMaxFactor: 2,
  tickMinCount: 2,
  /** an arrowhead's barbs reach this far back from the tip (x G), within `barbMaxDeg` of the shaft */
  barbMinFactor: 0.4,
  barbMaxFactor: 2.5,
  barbMaxDeg: 70,
  /** a rule or thin stroke this long (x G) with no writing about it is a drawing by itself */
  loneRuleFactor: 9,
  /** ... and so is one with no other stroke within this many glyphs of it */
  isolationFactor: 2.5,
  /** drawing strokes this close (x G), or one this much inside the other's box, are one drawing */
  groupReachFactor: 0.8,
  containShare: 0.7,
  /** a mark is a stroke at most this many glyphs that touches the drawing */
  markMaxFactor: 2.5,
  /** a label is within this many glyphs of the drawing, at most this wide and tall, ... */
  labelReachFactor: 2,
  labelMaxWidthFactor: 6,
  labelMaxHeightFactor: 3,
  /** ... or, wider, entirely inside the drawing's box grown by this many glyphs (the numbers under a number line) */
  labelZoneFactor: 3,
  /** a cluster of labels is split into separate labels at gaps this many glyphs wide (the taller of G and the labels' own glyphs) */
  labelSplitFactor: 1,
  /** the labels are stacked one per row for the one recognizer call, this many of their own glyph heights apart */
  labelStackGapFactor: 0.6,
  /** a previous drawing keeps its id when at least this share of its strokes are still in it */
  idReuseRatio: 0.5,
  /**
   * A "divide both sides" bar (`divisionBars`): a level rule under a whole equation, the equation
   * at most `divisionAboveFactor` glyphs above it (or `divisionAboveShare` of the height of a
   * problem the tutor wrote, whose hand is bigger), the bar under at least `divisionSpanShare` of
   * the equation's width and at most `divisionMaxSpan` times it; the divisor starting within
   * `divisionBelowFactor` glyphs under it, at most `divisionDivisorWidthFactor` glyphs wide (and
   * `divisionDivisorSpanShare` of the bar) and `divisionDivisorHeightFactor` tall.
   */
  divisionAboveFactor: 2.2,
  divisionAboveShare: 0.6,
  divisionSpanShare: 0.6,
  divisionMaxSpan: 1.8,
  divisionBelowFactor: 1.5,
  divisionDivisorWidthFactor: 5,
  divisionDivisorSpanShare: 0.7,
  divisionDivisorHeightFactor: 4.5,
} as const;

/**
 * `table`: a rule of a proof's T-table (`proof/table.ts`) — neither writing nor a drawing;
 * `operation`: a "divide both sides" bar under an equation, or the divisor under it (`DivisionBar`)
 */
export type StrokeRole = "writing" | "drawing" | "mark" | "label" | "table" | "operation";
export type DiagramKind = "triangle" | "quadrilateral" | "polygon" | "circle" | "axes" | "numberLine" | "arrow" | "segment" | "curve";

export interface Diagram {
  /** stable across flushes while at least half of its strokes stay (`dg_…`) */
  id: string;
  /** the drawing's own strokes (lines, shapes) and the marks drawn on it, in stroke order */
  strokeIds: TLShapeId[];
  /** each label's strokes, labels in reading order (top to bottom, then left to right) */
  labels: TLShapeId[][];
  /** the drawing, its marks and its labels */
  bounds: Rect;
  /** what it looks like, for the prompt and the dev panel; nothing decides on it */
  kinds: DiagramKind[];
}

export interface StrokeVerdict {
  role: StrokeRole;
  /** why, in a few words (tests, the dev panel) */
  reason: string;
  /** index into `InkSplit.diagrams` for drawing / mark / label strokes */
  diagram?: number;
}

/**
 * "Divide both sides by n", drawn: a bar under the whole equation with n under it
 * (`divisionBars`). Neither writing nor a drawing — one line of its own for the loop, the bar and
 * the divisor read together (Mathpix drops the bar and reads `2`), written as `\div 2`
 * (`engine/operationLine.ts`, `barDivisionLatex`).
 */
export interface DivisionBar {
  bar: TLShapeId;
  /** the divisor's strokes, under the bar */
  divisor: TLShapeId[];
}

export interface SplitOptions {
  /**
   * Equations on the screen that are not among the strokes — the problems the tutor wrote
   * (`chat/cells.ts`), each as the box of its ink. A bar drawn under one is a division bar.
   */
  equations?: readonly Rect[];
  /**
   * The board's fit zoom (screen px per page px, `editor.getBaseZoom()`): ~0.2 on a phone held
   * upright, ~0.5 on an iPad, ~1 on a desktop. The glyph cap is scaled by it (`glyphScale`), so
   * handwriting is judged by how big it looks on the student's screen. None: a desktop.
   */
  zoom?: number;
}

export interface InkSplit {
  /** the strokes that are handwriting: the only ones `clusterLines` should see */
  writing: InkStroke[];
  diagrams: Diagram[];
  /** division bars under an equation, each one line of its own (its strokes are in no other) */
  bars: DivisionBar[];
  /** the glyph scale G the split was made with (page px) */
  glyph: number;
  roles: Map<string, StrokeVerdict>;
}

// ---------------------------------------------------------------- geometry

const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);

function pointSeg(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function cross(a: Pt, b: Pt, c: Pt): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function segSeg(a: Pt, b: Pt, c: Pt, d: Pt): number {
  if (segsCross(a, b, c, d)) return 0;
  return Math.min(pointSeg(a, c, d), pointSeg(b, c, d), pointSeg(c, a, b), pointSeg(d, a, b));
}

type Path = Pt[][];

function forEachSeg(path: Path, fn: (a: Pt, b: Pt) => void): void {
  for (const poly of path) {
    if (poly.length === 1) fn(poly[0], poly[0]);
    for (let i = 1; i < poly.length; i++) fn(poly[i - 1], poly[i]);
  }
}

function pathDist(p: Path, q: Path): number {
  let best = Infinity;
  forEachSeg(p, (a, b) => {
    if (best === 0) return;
    forEachSeg(q, (c, d) => {
      if (best === 0) return;
      const v = segSeg(a, b, c, d);
      if (v < best) best = v;
    });
  });
  return best;
}

function pathPointDist(p: Path, pt: Pt): number {
  let best = Infinity;
  forEachSeg(p, (a, b) => {
    const v = pointSeg(pt, a, b);
    if (v < best) best = v;
  });
  return best;
}

function pathCrossesSeg(p: Path, a: Pt, b: Pt, tolerance: number): boolean {
  let hit = false;
  forEachSeg(p, (c, d) => {
    if (!hit && segSeg(a, b, c, d) <= tolerance) hit = true;
  });
  return hit;
}

function inflate(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by };
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
}

function clipArea(r: Rect, to: Rect): number {
  const w = Math.min(r.x + r.w, to.x + to.w) - Math.max(r.x, to.x);
  const h = Math.min(r.y + r.h, to.y + to.h) - Math.max(r.y, to.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Distance between two boxes (0 when they overlap). */
function rectGap(a: Rect, b: Rect): number {
  const gx = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w));
  const gy = Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h));
  return Math.hypot(gx, gy);
}

function inside(r: Rect, outer: Rect): boolean {
  return r.x >= outer.x && r.y >= outer.y && r.x + r.w <= outer.x + outer.w && r.y + r.h <= outer.y + outer.h;
}

/** Degrees between two directions, ignoring which way along the line (0..90). */
function lineAngle(a: Pt, b: Pt, c: Pt, d: Pt): number {
  const t1 = Math.atan2(b.y - a.y, b.x - a.x);
  const t2 = Math.atan2(d.y - c.y, d.x - c.x);
  let diff = Math.abs(t1 - t2) % Math.PI;
  if (diff > Math.PI / 2) diff = Math.PI - diff;
  return (diff * 180) / Math.PI;
}

/**
 * Length of the union of [lo, hi) intervals, a gap of at most `bridge` between two of them counted
 * as covered (the space between two glyphs of one word of writing).
 */
function unionLength(intervals: Array<[number, number]>, bridge = 0): number {
  const sorted = intervals.filter(([lo, hi]) => hi > lo).sort((p, q) => p[0] - q[0]);
  let total = 0;
  let curLo = -Infinity;
  let curHi = -Infinity;
  for (const [lo, hi] of sorted) {
    if (lo > curHi + bridge) {
      if (curHi > curLo) total += curHi - curLo;
      curLo = lo;
      curHi = hi;
    } else if (hi > curHi) curHi = hi;
  }
  if (curHi > curLo) total += curHi - curLo;
  return total;
}

// ---------------------------------------------------------------- one stroke's shape

type Orient = "level" | "upright" | "diagonal";
type Cls = "glyph" | "medium" | "diagonal" | "levelRule" | "uprightRule" | "tall" | "flat" | "big";

interface Geo {
  i: number;
  stroke: InkStroke;
  b: Rect;
  size: number;
  /** lightly simplified, per draw segment: for distances */
  path: Path;
  ends: [Pt, Pt];
  /** coarsely simplified, all segments end to end: for the shape */
  shape: Pt[];
  closed: boolean;
  /** the longest straight piece of `shape` */
  main: { a: Pt; b: Pt; len: number; k: number };
  rule: boolean;
  orient: Orient;
  cls: Cls;
}

function geometry(stroke: InkStroke, i: number, G: number): Geo {
  const R = DIAGRAM_RULES;
  const fine = Math.max(1, R.fineFactor * G);
  const path: Path = stroke.segments.filter((s) => s.length > 0).map((s) => rdp(s, fine));
  if (path.length === 0) path.push([{ x: stroke.bounds.x, y: stroke.bounds.y }]);
  const pts = path.flat();
  const size = Math.max(stroke.bounds.w, stroke.bounds.h);
  let length = 0;
  for (let k = 1; k < pts.length; k++) length += dist(pts[k - 1], pts[k]);
  const shape = rdp(pts, Math.max(R.shapeMinPx, R.shapeFactor * size));
  let main = { a: shape[0], b: shape[shape.length - 1] ?? shape[0], len: 0, k: 0 };
  let shapeLen = 0;
  const lens: number[] = [];
  for (let k = 1; k < shape.length; k++) {
    const len = dist(shape[k - 1], shape[k]);
    lens.push(len);
    shapeLen += len;
    if (len > main.len) main = { a: shape[k - 1], b: shape[k], len, k: k - 1 };
  }
  const ends: [Pt, Pt] = [pts[0], pts[pts.length - 1]];
  const closed = pts.length > 2 && dist(ends[0], ends[1]) <= R.closeShare * size && length >= 2 * size;
  const share = shapeLen > 0 ? main.len / shapeLen : 0;
  const hookMax = Math.max(R.hookMaxFactor * G, R.hookMaxShare * main.len);
  const rule =
    !closed && main.len > 0 && (share >= R.ruleShare || (share >= R.ruleHookedShare && lens.every((l, k) => k === main.k || l <= hookMax)));
  const deg = (Math.atan2(Math.abs(main.b.y - main.a.y), Math.abs(main.b.x - main.a.x)) * 180) / Math.PI;
  const orient: Orient = deg <= R.levelToleranceDeg ? "level" : deg >= 90 - R.uprightToleranceDeg ? "upright" : "diagonal";

  const { w, h } = stroke.bounds;
  let cls: Cls;
  if (size < R.bigFactor * G) {
    cls = size >= R.mediumFactor * G && rule ? "medium" : "glyph";
  } else if (rule && main.len >= R.bigFactor * G) {
    cls = orient === "diagonal" ? "diagonal" : orient === "level" ? "levelRule" : "uprightRule";
  } else if (h >= R.thinAspect * w && w <= R.thinMaxFactor * G) {
    cls = "tall";
  } else if (w >= R.thinAspect * h && h <= R.thinMaxFactor * G) {
    cls = "flat";
  } else {
    cls = "big";
  }
  return { i, stroke, b: stroke.bounds, size, path, ends, shape, closed, main, rule, orient, cls };
}

/**
 * A stroke that is a drawing by its own shape alone: a long diagonal, or big both ways. The loop's
 * quick test at pen-up, before the next split — such a stroke does not hold back the lines waiting
 * to be read. No writing evidence is looked for (a radical over a tall fraction passes); the split
 * at the next flush decides.
 */
export function strokeLooksDrawn(stroke: InkStroke, glyph: number): boolean {
  const cls = geometry(stroke, 0, glyph).cls;
  return cls === "diagonal" || cls === "big";
}

/**
 * The glyph scale: the median stroke height, then again without the strokes that are plainly
 * bigger than that (a drawing of many strokes would otherwise set it), clamped. `zoom`: the
 * board's fit zoom — the cap is `glyphMax` on a desktop and `inkScale` times that below zoom 1.
 *
 * Over the cap, ink that is rows of writing (`writingRows`) keeps its own scale: the cap is for a
 * screen with nothing but a drawing on it, and a big hand is not that on any screen. `(x+y)^2 =`
 * written 220 px tall on a desktop was measured against 30 px: the strokes of its `x` were two
 * "long diagonals", its `2` a "big curve", and Solve sent the "figure" to the vision model.
 */
export function glyphScale(strokes: readonly InkStroke[], zoom?: number): number {
  const R = DIAGRAM_RULES;
  const max = R.glyphMax * inkScale(zoom);
  if (strokes.length === 0) return max;
  const g0 = medianStrokeHeight([...strokes]);
  const small = strokes.filter((s) => Math.max(s.bounds.w, s.bounds.h) < R.bigFactor * g0);
  const g = small.length > 0 ? medianStrokeHeight(small) : g0;
  if (g > max && writingRows(strokes, g)) return g;
  return Math.min(max, Math.max(R.glyphMin, g));
}

/** A stroke's ends and the length of its path. */
function trace(s: InkStroke): { ends: [Pt, Pt]; length: number } {
  const pts = s.segments.flat();
  let length = 0;
  for (let k = 1; k < pts.length; k++) length += dist(pts[k - 1], pts[k]);
  return { ends: [pts[0] ?? { x: s.bounds.x, y: s.bounds.y }, pts[pts.length - 1] ?? { x: s.bounds.x, y: s.bounds.y }], length };
}

/** A stroke whose ends meet and whose path goes round (an `O`, a circle, a square in one stroke). */
function closedStroke(s: InkStroke): boolean {
  const { ends, length } = trace(s);
  const size = Math.max(s.bounds.w, s.bounds.h);
  return s.segments.flat().length > 2 && dist(ends[0], ends[1]) <= DIAGRAM_RULES.closeShare * size && length >= 2 * size;
}

/**
 * A glyph column that is a shape, not a glyph: a closed stroke the size of the column (a circle and
 * its radius, an `O`), or at least three straight strokes whose ends pair up into a closed loop (a
 * triangle, a rectangle in strokes) — strokes with an end that meets no other's end are pruned
 * first, so labels and marks inside it, and the free ends of an `A`, an `N`, an `x`, leave nothing.
 */
function shapeColumn(col: readonly InkStroke[]): boolean {
  const box = unionRects(col.map((s) => s.bounds));
  const size = Math.max(box.w, box.h);
  if (col.some((s) => closedStroke(s) && Math.max(s.bounds.w, s.bounds.h) >= 0.6 * size)) return true;
  const reach = Math.max(DIAGRAM_RULES.touchMinPx, DIAGRAM_RULES.closeShare * size);
  let sides = col
    .map(trace)
    .filter((t) => t.length > 0 && dist(t.ends[0], t.ends[1]) >= t.length / 1.1);
  for (let pruned = true; pruned && sides.length >= 3; ) {
    const kept = sides.filter((t) => t.ends.every((p) => sides.some((o) => o !== t && o.ends.some((q) => dist(p, q) <= reach))));
    pruned = kept.length < sides.length;
    sides = kept;
  }
  return sides.length >= 3;
}

/**
 * A line's strokes in glyph columns: strokes whose x-ranges overlap by `columnOverlapShare` of the
 * narrower are one column (the two strokes of an `x` or a `+`, the bars of an `=`, a `y`; a
 * fraction, its bar spanning both).
 */
function glyphColumns(cells: readonly InkStroke[]): InkStroke[][] {
  const R = DIAGRAM_RULES;
  const uf = new UnionFind(cells.length);
  for (let a = 0; a < cells.length; a++) {
    for (let b = a + 1; b < cells.length; b++) {
      const p = cells[a].bounds;
      const q = cells[b].bounds;
      const overlap = Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x);
      if (overlap >= 0 && overlap >= R.columnOverlapShare * Math.min(p.w, q.w)) uf.union(a, b);
    }
  }
  const cols = new Map<number, InkStroke[]>();
  cells.forEach((s, k) => {
    const root = uf.find(k);
    const col = cols.get(root);
    if (col) col.push(s);
    else cols.set(root, [s]);
  });
  return [...cols.values()];
}

/**
 * Rows of writing at the ink's own glyph scale `g`: a line (`clusterStrokeGroups`, which scales with
 * the ink) of glyph-sized strokes holding at least `rowMinColumns` glyph columns side by side
 * (`glyphColumns`) that are not shapes (`shapeColumn`). A drawing on its own is one column — a
 * triangle's base spans its other sides, the axes span the line sketched on them, a circle its radius
 * — and a row of circles or triangles (a pattern) is shapes. `(x+y)^2 =` is seven columns: `(`, `x`,
 * `+`, `y`, `)`, `2`, `=`.
 */
function writingRows(strokes: readonly InkStroke[], g: number): boolean {
  const R = DIAGRAM_RULES;
  const glyphs = strokes.filter((s) => Math.max(s.bounds.w, s.bounds.h) < R.bigFactor * g);
  if (glyphs.length < R.rowMinColumns) return false;
  return clusterStrokeGroups([...glyphs]).some((cluster) => {
    if (cluster.length < R.rowMinColumns) return false;
    const cols = glyphColumns(cluster.map((k) => glyphs[k]));
    return cols.length >= R.rowMinColumns && cols.filter((c) => !shapeColumn(c)).length >= R.rowMinColumns;
  });
}

// ---------------------------------------------------------------- evidence

/**
 * Share of a span that writing covers on its busier side. The span is `[from, to]` along x (or
 * along y when `upright`), at `at` across it, `half` thick. Strokes count when they overlap the
 * span and sit before it (above / left) or after it (below / right) within `coverReachFactor`
 * glyphs: a numerator, a radicand, the other bar of an `=`, an integrand. A stroke crossing it (a
 * tick) is on neither side.
 */
function coverageAlong(self: number, from: number, to: number, at: number, half: number, upright: boolean, others: readonly Geo[], G: number): number {
  const band = DIAGRAM_RULES.coverReachFactor * G;
  const slack = 0.25 * G;
  const span = to - from;
  if (span <= 0) return 0;
  const before: Array<[number, number]> = [];
  const after: Array<[number, number]> = [];
  // a glyph's cell is wider than its ink (a `1` is a line): each stroke covers a little either side
  const pad = 0.25 * G;
  for (const o of others) {
    if (o.i === self) continue;
    const r = o.b;
    const lo = Math.max(from, (upright ? r.y : r.x) - pad);
    const hi = Math.min(to, (upright ? r.y + r.h : r.x + r.w) + pad);
    if (hi <= lo) continue;
    const endBefore = upright ? r.x + r.w : r.y + r.h;
    const startAfter = upright ? r.x : r.y;
    if (endBefore <= at - half + slack && endBefore >= at - half - band) before.push([lo, hi]);
    else if (startAfter >= at + half - slack && startAfter <= at + half + band) after.push([lo, hi]);
  }
  // the gaps between the glyphs of a line of writing are covered; the gaps between the numbers
  // under a number line (several glyphs apart) are not
  const bridge = DIAGRAM_RULES.coverBridgeFactor * G;
  return Math.min(1, Math.max(unionLength(before, bridge), unionLength(after, bridge)) / span);
}

/**
 * Writing along or inside an ambiguous stroke: covered on one side over `coverShare` of its span
 * (a rule along its main piece — a radical's hook is not its span; a thin curve along its box), or
 * its box filled (`fillShare`). A big stroke is writing when writing fills its box, or when its top
 * is a long level piece with writing under it (a radical over a fraction, a long division bracket).
 */
function writingEvidence(g: Geo, others: readonly Geo[], G: number): "along" | "inside" | null {
  const R = DIAGRAM_RULES;
  const { a, b } = g.main;
  switch (g.cls) {
    case "levelRule":
      return coverageAlong(g.i, Math.min(a.x, b.x), Math.max(a.x, b.x), (a.y + b.y) / 2, 0, false, others, G) >= R.coverShare ? "along" : null;
    case "uprightRule":
      return coverageAlong(g.i, Math.min(a.y, b.y), Math.max(a.y, b.y), (a.x + b.x) / 2, 0, true, others, G) >= R.coverShare ? "along" : null;
    case "tall":
      return coverageAlong(g.i, g.b.y, g.b.y + g.b.h, g.b.x + g.b.w / 2, g.b.w / 2, true, others, G) >= R.coverShare ? "along" : null;
    case "flat":
    case "big": {
      if (fill(g, others, G) >= R.fillShare || ringsALine(g, others, G)) return "inside";
      const top = topLevelPiece(g);
      if (top && coverageAlong(g.i, Math.min(top.a.x, top.b.x), Math.max(top.a.x, top.b.x), (top.a.y + top.b.y) / 2, 0, false, others, G) >= R.coverShare) return "inside";
      if (g.cls === "big") return null;
      return coverageAlong(g.i, g.b.x, g.b.x + g.b.w, g.b.y + g.b.h / 2, g.b.h / 2, false, others, G) >= R.coverShare ? "along" : null;
    }
    default:
      return null;
  }
}

/** The longest level piece of a stroke's shape when it runs along the top of its box, at least 0.4 of its width. */
function topLevelPiece(g: Geo): { a: Pt; b: Pt } | null {
  let best: { a: Pt; b: Pt; len: number } | null = null;
  for (let k = 1; k < g.shape.length; k++) {
    const a = g.shape[k - 1];
    const b = g.shape[k];
    const len = dist(a, b);
    const deg = (Math.atan2(Math.abs(b.y - a.y), Math.abs(b.x - a.x)) * 180) / Math.PI;
    if (deg > DIAGRAM_RULES.levelToleranceDeg) continue;
    if (!best || len > best.len) best = { a, b, len };
  }
  if (!best || best.len < 0.4 * g.b.w) return null;
  return (best.a.y + best.b.y) / 2 <= g.b.y + 0.25 * g.b.h ? best : null;
}

/**
 * A closed stroke drawn round one line of writing (an answer boxed or circled): the strokes inside
 * it span at least half its width and 0.4 of its height, and cover that span without a gap wider
 * than the space between two glyphs. Labels inside a triangle or a circle are scattered, not a row.
 */
function ringsALine(g: Geo, others: readonly Geo[], G: number): boolean {
  if (!g.closed) return false;
  const inner = inflate(g.b, -0.1 * Math.min(g.b.w, g.b.h));
  const inside = others.filter((o) => {
    if (o.i === g.i || o.size >= g.size) return false;
    const cx = o.b.x + o.b.w / 2;
    const cy = o.b.y + o.b.h / 2;
    return cx >= inner.x && cx <= inner.x + inner.w && cy >= inner.y && cy <= inner.y + inner.h;
  });
  if (inside.length < 2) return false;
  const u = unionRects(inside.map((o) => o.b));
  if (u.w < 0.5 * g.b.w || u.h < 0.4 * g.b.h) return false;
  // one row of writing (a fraction is two glyphs deep, and a bit), and the ring close round it
  if (u.h > 4 * G || g.b.h > u.h + 4 * G) return false;
  const covered = unionLength(
    inside.map((o) => [o.b.x - 0.25 * G, o.b.x + o.b.w + 0.25 * G]),
    DIAGRAM_RULES.coverBridgeFactor * G,
  );
  return covered >= 0.8 * u.w;
}

/** Share of a stroke's box that other strokes' boxes fill (a radical's radicand, the answer in a box). */
function fill(g: Geo, others: readonly Geo[], G: number): number {
  const area = g.b.w * g.b.h;
  if (area <= 0) return 0;
  let covered = 0;
  for (const o of others) {
    if (o.i === g.i || o.size >= g.size) continue;
    covered += clipArea(inflate(o.b, 0.15 * G), g.b);
  }
  return covered / area;
}

/** Two long rules crossing, or meeting at a corner, roughly at right angles: axes, a rectangle's sides. */
function perpendicularPartner(g: Geo, rules: readonly Geo[], G: number): boolean {
  const R = DIAGRAM_RULES;
  if (g.main.len < R.perpMinFactor * G) return false;
  const corner = R.cornerFactor * G;
  for (const o of rules) {
    if (o.i === g.i || o.main.len < R.perpMinFactor * G) continue;
    if (lineAngle(g.main.a, g.main.b, o.main.a, o.main.b) < 60) continue;
    if (segsCross(g.main.a, g.main.b, o.main.a, o.main.b)) return true;
    for (const p of [g.main.a, g.main.b]) for (const q of [o.main.a, o.main.b]) if (dist(p, q) <= corner) return true;
  }
  return false;
}

/**
 * Ticks: short straight strokes going right through the rule, across it. A number line has at
 * least `tickMinCount` of them and few other strokes crossing it (an open circle); a line struck
 * through writing crosses letters, not ticks. Returns the ticks, or [] when it is not that.
 */
function numberLineTicks(g: Geo, all: readonly Geo[], G: number): number[] {
  const R = DIAGRAM_RULES;
  const ticks: number[] = [];
  let others = 0;
  const box = inflate(g.b, 0.5 * G);
  const tol = Math.max(1, 0.05 * G);
  const lenAB = g.main.len;
  for (const o of all) {
    if (o.i === g.i || !intersects(o.b, box)) continue;
    if (!pathCrossesSeg(o.path, g.main.a, g.main.b, tol)) continue;
    const straight = o.shape.length <= 3 && o.main.len >= 0.7 * o.size;
    const across = lineAngle(o.main.a, o.main.b, g.main.a, g.main.b) >= 60;
    // both ends clear of the rule, on opposite sides: it goes through, not just touches
    const s1 = cross(g.main.a, g.main.b, o.ends[0]) / Math.max(1, lenAB);
    const s2 = cross(g.main.a, g.main.b, o.ends[1]) / Math.max(1, lenAB);
    const through = s1 * s2 < 0 && Math.min(Math.abs(s1), Math.abs(s2)) >= 0.08 * G;
    if (o.size <= R.tickMaxFactor * G && straight && across && through) ticks.push(o.i);
    else others++;
  }
  return ticks.length >= R.tickMinCount && others <= Math.max(1, Math.floor(ticks.length / 2)) ? ticks : [];
}

/**
 * An arrowhead at one end of a rule: points reaching back from the tip along the shaft, on BOTH
 * sides of it — the stroke's own hooks, or short strokes (a `>` drawn at the tip, two barbs).
 * Returns the barb strokes (none when the head is the stroke's own), or null for no head.
 * `touching`: a barb stroke must touch the tip, not just come near it (see the caller).
 */
function arrowhead(g: Geo, small: readonly Geo[], G: number, touching = false): number[] | null {
  const R = DIAGRAM_RULES;
  const cosMax = Math.cos((R.barbMaxDeg * Math.PI) / 180);
  const lo = R.barbMinFactor * G;
  const hi = R.barbMaxFactor * G;
  const corner = touching ? Math.max(R.touchMinPx, R.touchFactor * G) : R.cornerFactor * G;
  const ends: Array<[Pt, Pt, Pt[]]> = [
    [g.main.b, g.main.a, g.shape.slice(g.main.k + 2)],
    [g.main.a, g.main.b, g.shape.slice(0, g.main.k)],
  ];
  let found: number[] | null = null;
  for (const [tip, tail, own] of ends) {
    const back = { x: tail.x - tip.x, y: tail.y - tip.y };
    const backLen = Math.hypot(back.x, back.y) || 1;
    const sides = new Set<number>();
    const barbs = new Set<number>();
    const consider = (p: Pt, from: number | null) => {
      const v = { x: p.x - tip.x, y: p.y - tip.y };
      const d = Math.hypot(v.x, v.y);
      if (d < lo || d > hi) return;
      if ((v.x * back.x + v.y * back.y) / (d * backLen) < cosMax) return;
      const side = cross(tip, tail, p) / backLen;
      if (Math.abs(side) < 0.15 * G) return;
      sides.add(Math.sign(side));
      if (from !== null) barbs.add(from);
    };
    // the stroke's own hooks beyond the main piece at this end, then short strokes at the tip
    for (const p of own) consider(p, null);
    for (const o of small) {
      if (o.i === g.i || o.size > R.barbMaxFactor * G || o.size < R.barbMinFactor * G) continue;
      if (pathPointDist(o.path, tip) > corner) continue;
      for (const p of o.path.flat()) consider(p, o.i);
    }
    // a head at either end (a number line has two)
    if (sides.size === 2) found = [...(found ?? []), ...barbs];
  }
  return found;
}

/**
 * Straight strokes (rules, diagonals, straight pieces between a glyph and a rule) whose ends pair
 * up into a closed polygon of three to six sides at least `bigFactor` glyphs across: a rectangle in
 * four strokes, a triangle whose sides are all level or upright. Every end must meet the end of
 * another side.
 */
function closedLoops(geos: readonly Geo[], G: number): number[] {
  const R = DIAGRAM_RULES;
  const sides = geos.filter((g) => g.rule && g.main.len >= R.mediumFactor * G);
  if (sides.length < 3) return [];
  const corner = R.cornerFactor * G;
  const ends = (g: Geo): [Pt, Pt] => [g.main.a, g.main.b];
  const uf = new UnionFind(sides.length);
  const matched = sides.map(() => [false, false]);
  for (let a = 0; a < sides.length; a++) {
    for (let b = a + 1; b < sides.length; b++) {
      if (!intersects(inflate(sides[a].b, corner), sides[b].b)) continue;
      ends(sides[a]).forEach((p, ka) =>
        ends(sides[b]).forEach((q, kb) => {
          if (dist(p, q) > corner) return;
          matched[a][ka] = true;
          matched[b][kb] = true;
          uf.union(a, b);
        }),
      );
    }
  }
  const comps = new Map<number, number[]>();
  sides.forEach((_, k) => {
    const r = uf.find(k);
    comps.set(r, [...(comps.get(r) ?? []), k]);
  });
  const out: number[] = [];
  for (const members of comps.values()) {
    if (members.length < 3 || members.length > 6) continue;
    if (!members.every((k) => matched[k][0] && matched[k][1])) continue;
    const box = unionRects(members.map((k) => sides[k].b));
    if (Math.max(box.w, box.h) < R.bigFactor * G) continue;
    out.push(...members.map((k) => sides[k].i));
  }
  return out;
}

/** An end of `g` meets `o`, or an end of `o` meets `g` (a corner, a T-junction). */
function endsMeet(g: Geo, o: Geo, reach: number): boolean {
  return g.ends.some((p) => pathPointDist(o.path, p) <= reach) || o.ends.some((p) => pathPointDist(g.path, p) <= reach);
}

// ---------------------------------------------------------------- relations in a cluster

function flatBar(r: Rect, G: number): boolean {
  return r.w >= 0.25 * G && r.w > 3 * r.h && r.h < Math.max(0.25 * G, 0.1 * r.w);
}

/** An `=` (two level bars stacked close) or a `<` / `>` (a V opening sideways) among these strokes. */
export function hasRelation(strokes: readonly InkStroke[], G: number): boolean {
  const bars = strokes.filter((s) => flatBar(s.bounds, G));
  for (let i = 0; i < bars.length; i++) {
    for (let j = i + 1; j < bars.length; j++) {
      const a = bars[i].bounds;
      const b = bars[j].bounds;
      const ratio = a.w / b.w;
      if (ratio < 0.4 || ratio > 2.5) continue;
      const overlap = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      if (overlap < 0.5 * Math.min(a.w, b.w)) continue;
      const gap = Math.abs(a.y + a.h / 2 - (b.y + b.h / 2));
      if (gap >= 0.08 * G && gap <= 0.9 * G) return true;
    }
  }
  for (const s of strokes) {
    const size = Math.max(s.bounds.w, s.bounds.h);
    if (size > DIAGRAM_RULES.markMaxFactor * G || size < 0.25 * G) continue;
    const pts = s.segments.flat();
    const v = rdp(pts, Math.max(1, 0.12 * size));
    if (v.length !== 3) continue;
    const [p, q, r] = v;
    const leftOpen = p.x < q.x && r.x < q.x; // `>`: the vertex is on the right
    const rightOpen = p.x > q.x && r.x > q.x; // `<`
    if (!leftOpen && !rightOpen) continue;
    if ((p.y - q.y) * (r.y - q.y) >= 0) continue; // one arm up, one down
    const armDeg = (a: Pt) => (Math.atan2(Math.abs(a.y - q.y), Math.abs(a.x - q.x)) * 180) / Math.PI;
    if ([p, r].every((a) => armDeg(a) >= 10 && armDeg(a) <= 65)) return true;
  }
  return false;
}

/** x-intervals of a cluster's strokes merged where they overlap, left to right, with their strokes. */
function columnsOf(cluster: readonly number[], geos: readonly Geo[]): Array<{ x0: number; x1: number; members: number[] }> {
  const sorted = [...cluster].sort((a, b) => geos[a].b.x - geos[b].b.x);
  const out: Array<{ x0: number; x1: number; members: number[] }> = [];
  for (const i of sorted) {
    const b = geos[i].b;
    const last = out[out.length - 1];
    if (last && b.x <= last.x1) {
      last.x1 = Math.max(last.x1, b.x + b.w);
      last.members.push(i);
    } else out.push({ x0: b.x, x1: b.x + b.w, members: [i] });
  }
  return out;
}

/**
 * A label the clusterer ran into a line of maths beside the drawing (strokes on one row join up
 * to three glyphs apart): the end of the cluster on the drawing's side, cut at a gap that is at
 * least one glyph (G), wider than any gap left inside the line, and wider than the label's distance
 * to the drawing — with the line still holding its relation without it. [] when there is none.
 */
function peelLabel(cluster: readonly number[], toDrawing: (i: number) => number, geos: readonly Geo[], all: readonly InkStroke[], G: number): number[] {
  const R = DIAGRAM_RULES;
  const cols = columnsOf(cluster, geos);
  let best: number[] = [];
  let bestGap = 0;
  for (let k = 1; k < cols.length; k++) {
    const gap = cols[k].x0 - cols[k - 1].x1;
    if (gap < G || gap <= bestGap) continue;
    const left = cols.slice(0, k);
    const right = cols.slice(k);
    for (const [label, line] of [
      [left, right],
      [right, left],
    ] as const) {
      const labelIdx = label.flatMap((c) => c.members);
      const lineIdx = line.flatMap((c) => c.members);
      const width = label[label.length - 1].x1 - label[0].x0;
      if (width > R.labelMaxWidthFactor * G) continue;
      const near = Math.min(...labelIdx.map(toDrawing));
      if (near > R.labelReachFactor * G || near > 0.8 * gap) continue;
      if (Math.min(...lineIdx.map(toDrawing)) <= near) continue;
      let inner = 0;
      for (let j = 1; j < line.length; j++) inner = Math.max(inner, line[j].x0 - line[j - 1].x1);
      if (gap <= inner) continue;
      if (!hasRelation(lineIdx.map((i) => all[i]), G)) continue;
      best = labelIdx;
      bestGap = gap;
    }
  }
  return best;
}

/**
 * Labels and marks the clusterer ran into a line of maths written level with the drawing: the
 * strokes within label reach of the drawing whose centres fall in its span (its x-range grown by
 * half a glyph; or, for a line above or below it, its y-range) — the numbers under a number line
 * drawn beside `x > 2` — when every other stroke of the cluster is outside that span and still
 * holds the relation. [] when there are none.
 */
function peelShadow(cluster: readonly number[], toDrawing: (i: number) => number, box: Rect, geos: readonly Geo[], all: readonly InkStroke[], G: number): number[] {
  const pad = 0.5 * G;
  const reach = DIAGRAM_RULES.labelReachFactor * G;
  for (const alongX of [true, false]) {
    const within = (i: number) => {
      const b = geos[i].b;
      const c = alongX ? b.x + b.w / 2 : b.y + b.h / 2;
      return alongX ? c >= box.x - pad && c <= box.x + box.w + pad : c >= box.y - pad && c <= box.y + box.h + pad;
    };
    const peeled = cluster.filter((i) => within(i) && toDrawing(i) <= reach);
    if (peeled.length === 0 || peeled.length === cluster.length) continue;
    const line = cluster.filter((i) => !peeled.includes(i));
    if (line.some(within)) continue;
    // labels sit nearer the drawing than the line (a line written across the top of the drawing
    // runs on into the part of it above the drawing)
    const toLine = Math.min(...peeled.flatMap((i) => line.map((j) => rectGap(geos[i].b, geos[j].b))));
    if (Math.min(...peeled.map(toDrawing)) >= toLine) continue;
    if (hasRelation(line.map((i) => all[i]), G)) return peeled;
  }
  return [];
}

// ---------------------------------------------------------------- division bars

const writingShape = (g: Geo): boolean => g.cls === "glyph" || g.cls === "medium" || g.cls === "flat" || g.cls === "tall";

/**
 * A relation among these strokes (`hasRelation`), counting only signs that stand on their own: the
 * first stroke of a `4` and the arms of a `k` are a V opening sideways too, but another stroke of
 * their glyph touches them; the bars of `\pm` (and of `\neq`) are two level bars stacked like an
 * `=`, but a stroke goes through them.
 */
function holdsRelation(strokes: readonly Geo[], G: number): boolean {
  const pad = 0.1 * G;
  const crossed = (s: Geo) =>
    strokes.some((o) => {
      if (o.i === s.i) return false;
      const cx = o.b.x + o.b.w / 2;
      return cx >= s.b.x && cx <= s.b.x + s.b.w && o.b.y < s.b.y + s.b.h / 2 - pad && o.b.y + o.b.h > s.b.y + s.b.h / 2 + pad;
    });
  const glued = (s: Geo) => {
    if (!hasRelation([s.stroke], G)) return flatBar(s.b, G) && crossed(s);
    return strokes.some((o) => o.i !== s.i && intersects(inflate(s.b, pad), o.b));
  };
  return hasRelation(
    strokes.filter((s) => !glued(s)).map((s) => s.stroke),
    G,
  );
}

/**
 * The student's own equation straight above a level rule: the strokes just over its span (within
 * `divisionAboveFactor` glyphs), holding a relation (`=`, `<`, `>`) and covering half of it, grown
 * to the whole row they are on — which the rule must span most of. The row's strokes, or [].
 * A fraction bar has its numerator above it, never a relation; the lower bar of a long `=` has
 * only the upper one over it.
 */
function equationAbove(g: Geo, geos: readonly Geo[], G: number, x0: number, x1: number, y: number): number[] {
  const R = DIAGRAM_RULES;
  const slack = 0.25 * G;
  const over = (o: Geo) => o.b.y + o.b.h <= y + slack;
  const seed = geos.filter(
    (o) => o.i !== g.i && writingShape(o) && over(o) && o.b.y + o.b.h >= y - R.divisionAboveFactor * G && Math.min(x1, o.b.x + o.b.w) > Math.max(x0, o.b.x),
  );
  if (seed.length === 0 || !holdsRelation(seed, G)) return [];
  const covered = unionLength(
    seed.map((o) => [Math.max(x0, o.b.x - slack), Math.min(x1, o.b.x + o.b.w + slack)]),
    R.coverBridgeFactor * G,
  );
  if (covered < R.coverShare * (x1 - x0)) return [];
  // the rest of the row: strokes level with it, a glyph's gap or so along
  const row = new Set(seed.map((o) => o.i));
  let rect = unionRects(seed.map((o) => o.b));
  for (let changed = true; changed; ) {
    changed = false;
    for (const o of geos) {
      if (row.has(o.i) || o.i === g.i || !writingShape(o) || !over(o)) continue;
      const cy = o.b.y + o.b.h / 2;
      if (cy < rect.y || cy > rect.y + rect.h) continue;
      if (rectGap(o.b, rect) > 1.5 * G) continue;
      row.add(o.i);
      rect = unionRects([rect, o.b]);
      changed = true;
    }
  }
  const spanned = Math.min(x1, rect.x + rect.w) - Math.max(x0, rect.x);
  if (spanned < R.divisionSpanShare * rect.w || x1 - x0 > R.divisionMaxSpan * rect.w + 2 * G) return [];
  return [...row];
}

/**
 * What both sides are divided by: the strokes that start within `divisionBelowFactor` glyphs
 * under the rule, inside its span, grown to what they are written with — on their row (`-` and
 * `3`), or stacked on them (a fraction's bar and its `2`) — and nothing more: one short piece of
 * writing, with no relation in it (the sum under a system — `x + y = 10`, `x - y = 2`, a rule,
 * `2x = 12` — has one) and nothing else level with it under the rule. The next line, written
 * further down, is not part of it. Its strokes, or null.
 */
function divisorUnder(g: Geo, geos: readonly Geo[], G: number, x0: number, x1: number, y: number, row: readonly number[]): number[] | null {
  const R = DIAGRAM_RULES;
  const bottom = g.b.y + g.b.h;
  const zone = geos.filter((o) => o.i !== g.i && !row.includes(o.i) && o.b.y >= y - 0.25 * G && o.b.x + o.b.w >= x0 - 2 * G && o.b.x <= x1 + 2 * G);
  const group = zone.filter((o) => {
    const cx = o.b.x + o.b.w / 2;
    return o.b.y <= bottom + R.divisionBelowFactor * G && cx >= x0 && cx <= x1;
  });
  if (group.length === 0) return null;
  const inGroup = new Set(group.map((o) => o.i));
  let box = unionRects(group.map((o) => o.b));
  const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.min(a1, b1) - Math.max(a0, b0);
  for (let changed = true; changed; ) {
    changed = false;
    for (const o of zone) {
      if (inGroup.has(o.i)) continue;
      const b = o.b;
      const hGap = -overlap(b.x, b.x + b.w, box.x, box.x + box.w);
      const vGap = -overlap(b.y, b.y + b.h, box.y, box.y + box.h);
      const sameRow = Math.abs(b.y + b.h / 2 - (box.y + box.h / 2)) <= 0.6 * G && hGap <= 1.2 * G;
      const stacked = hGap < 0 && vGap <= 0.6 * G;
      if (!sameRow && !stacked) continue;
      inGroup.add(o.i);
      group.push(o);
      box = unionRects([box, b]);
      changed = true;
    }
  }
  if (box.w > Math.min(R.divisionDivisorWidthFactor * G, R.divisionDivisorSpanShare * (x1 - x0))) return null;
  if (box.h > R.divisionDivisorHeightFactor * G) return null;
  if (!group.every(writingShape) || holdsRelation(group, G)) return null;
  // something else level with it under the rule (`2` under each side): not one divisor
  const beside = zone.some((o) => {
    if (inGroup.has(o.i)) return false;
    const cy = o.b.y + o.b.h / 2;
    const cx = o.b.x + o.b.w / 2;
    return cy >= box.y && cy <= box.y + box.h && cx >= x0 && cx <= x1;
  });
  return beside ? null : group.map((o) => o.i);
}

/**
 * "Divide both sides by n", drawn: a long level rule under a WHOLE equation — the student's own
 * line (`equationAbove`), or a problem the tutor wrote (`equations`: its ink is not among the
 * strokes, so nothing about the rule looked like writing and it was taken for a drawing, and the
 * `2` under it for its label) — with n written just under it (`divisorUnder`) and nothing else
 * on it: no stroke touching or crossing it but the equation's and the divisor's, no ticks, no
 * arrowhead, no corner. An underline has nothing under it; a number line has ticks; a T-table's
 * bar has a heading above it, not a relation (and `tableRules` has taken it already); a
 * triangle's base has its sides at its ends. Each bar with its divisor, as indexes into `geos`.
 */
function divisionBars(geos: readonly Geo[], G: number, equations: readonly Rect[]): Array<{ bar: number; divisor: number[] }> {
  const R = DIAGRAM_RULES;
  const out: Array<{ bar: number; divisor: number[] }> = [];
  const taken = new Set<number>();
  const rules = geos.filter((o) => o.cls === "levelRule" || o.cls === "uprightRule");
  const small = geos.filter((o) => o.cls === "glyph" || o.cls === "medium");
  const touch = Math.max(R.touchMinPx, R.touchFactor * G);
  for (const g of geos) {
    if (taken.has(g.i)) continue;
    if (!(g.cls === "levelRule" || (g.cls === "medium" && g.orient === "level"))) continue;
    const x0 = Math.min(g.main.a.x, g.main.b.x);
    const x1 = Math.max(g.main.a.x, g.main.b.x);
    const y = (g.main.a.y + g.main.b.y) / 2;
    const under = (e: Rect) => {
      const gap = y - (e.y + e.h);
      const spanned = Math.min(x1, e.x + e.w) - Math.max(x0, e.x);
      return gap >= -0.25 * G && gap <= Math.max(R.divisionAboveFactor * G, R.divisionAboveShare * e.h) && spanned >= R.divisionSpanShare * e.w && x1 - x0 <= R.divisionMaxSpan * e.w + 2 * G;
    };
    // writing level with the rule just past its ends: it is a fraction bar inside a line
    // (`y = \frac{k}{x}`, `f(x) = \frac{x^2 - 4}{x - 2}`), not a rule under one
    const beside = geos.some((o) => {
      if (o.i === g.i || !writingShape(o) || o.b.y > g.b.y + g.b.h + 0.25 * G || o.b.y + o.b.h < g.b.y - 0.25 * G) return false;
      const left = x0 - (o.b.x + o.b.w);
      const right = o.b.x - x1;
      return (left >= -0.25 * G && left <= 2 * G) || (right >= -0.25 * G && right <= 2 * G);
    });
    if (beside) continue;
    const row = equations.some(under) ? [] : equationAbove(g, geos, G, x0, x1, y);
    if (row.length === 0 && !equations.some(under)) continue;
    const divisor = divisorUnder(g, geos, G, x0, x1, y, row);
    if (!divisor) continue;
    const own = new Set([g.i, ...row, ...divisor]);
    const box = inflate(g.b, touch);
    if (geos.some((o) => !own.has(o.i) && intersects(box, o.b) && pathDist(o.path, g.path) <= touch)) continue;
    if (numberLineTicks(g, geos, G).length > 0 || arrowhead(g, small, G, true) || perpendicularPartner(g, rules, G)) continue;
    out.push({ bar: g.i, divisor });
    for (const i of [g.i, ...divisor]) taken.add(i);
  }
  return out;
}

// ---------------------------------------------------------------- the split

interface Flags {
  axes: Set<number>;
  numberLine: Set<number>;
  arrow: Set<number>;
}

class UnionFind {
  private parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]];
      i = this.parent[i];
    }
    return i;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[rb] = ra;
  }
}

let idCounter = 0;
function newDiagramId(): string {
  idCounter = (idCounter + 1) % 0xffff;
  const rand = Math.floor(Math.random() * 0xffffffff);
  return `dg_${((rand ^ (idCounter << 16)) >>> 0).toString(16).padStart(8, "0")}`;
}

const writingOnly = (strokes: InkStroke[], glyph: number, reason = "glyph"): InkSplit => ({
  writing: strokes,
  diagrams: [],
  bars: [],
  glyph,
  roles: new Map(strokes.map((s) => [s.id as string, { role: "writing" as const, reason }])),
});

/**
 * Splits the screen's ink into handwriting and drawings (see the module comment). `previous`
 * keeps diagram ids stable: a drawing reuses the id of the previous one sharing at least half
 * of its strokes. `opts.equations`: the tutor's problems on the screen, which a division bar may
 * be drawn under; `opts.zoom`: the board's fit zoom, which scales the glyph cap. Deterministic and
 * pure.
 */
export function splitInk(strokes: readonly InkStroke[], previous: readonly Diagram[] = [], opts: SplitOptions = {}): InkSplit {
  const R = DIAGRAM_RULES;
  const all = [...strokes];
  const G = glyphScale(all, opts.zoom);
  if (all.length === 0) return writingOnly(all, G);
  // Nothing on the screen longer than two glyphs: no drawing (the common case, and cheap).
  if (all.every((s) => Math.max(s.bounds.w, s.bounds.h) < R.mediumFactor * G)) return writingOnly(all, G);
  // A proof's T-table: its rules are set aside, so the rows it separates are read as lines.
  const table = tableRules(all, G);
  if (table.size > 0) {
    const split = splitInk(all.filter((s) => !table.has(s.id)), previous, opts);
    for (const id of table) split.roles.set(id, { role: "table", reason: "a proof's table rule" });
    return split;
  }

  const geos = all.map((s, i) => geometry(s, i, G));
  // "Divide both sides by 2": a bar under a whole equation with the 2 under it. Set aside with its
  // divisor, a line of their own, before anything takes the bar for a drawing (under the tutor's
  // problem there is no writing about it) or for a fraction bar (under the student's own line).
  const bars = divisionBars(geos, G, opts.equations ?? []);
  if (bars.length > 0) {
    const taken = new Set<string>(bars.flatMap((b) => [b.bar, ...b.divisor]).map((i) => all[i].id));
    const split = splitInk(
      all.filter((s) => !taken.has(s.id)),
      previous,
      opts,
    );
    for (const b of bars) {
      split.roles.set(all[b.bar].id, { role: "operation", reason: "a bar under an equation: divide both sides" });
      for (const i of b.divisor) split.roles.set(all[i].id, { role: "operation", reason: "what both sides are divided by" });
    }
    split.bars = [...bars.map((b) => ({ bar: all[b.bar].id, divisor: b.divisor.map((i) => all[i].id) })), ...split.bars];
    return split;
  }
  const reasons = new Map<number, string>();
  const drawing = new Set<number>();
  const draw = (g: Geo, reason: string) => {
    drawing.add(g.i);
    reasons.set(g.i, reason);
  };

  // 2. each stroke by its own shape
  const ambiguous: Geo[] = [];
  const nonBig = geos.filter((g) => g.cls === "glyph" || g.cls === "medium");
  const notDiagonal = geos.filter((g) => g.cls !== "diagonal");
  for (const g of geos) {
    if (g.cls === "diagonal") draw(g, "long diagonal");
    else if (g.cls === "big") {
      if (writingEvidence(g, notDiagonal, G)) reasons.set(g.i, "a big stroke round writing (a radical, a box)");
      else draw(g, g.closed ? "big closed shape" : "big curve");
    } else if (g.cls !== "glyph") ambiguous.push(g);
  }

  // 3. the ambiguous ones by what is around them (writing evidence is judged against everything
  // that is not already a drawing by its own shape)
  const rules = ambiguous.filter((g) => g.cls === "levelRule" || g.cls === "uprightRule");
  const evidenced = new Map<number, "along" | "inside">();
  const flags: Flags = { axes: new Set(), numberLine: new Set(), arrow: new Set() };
  /** ticks and barbs: marks that are evidence, so part of the drawing before anything is clustered */
  const structural = new Map<number, string>();
  const others = geos.filter((o) => !drawing.has(o.i));
  for (const g of ambiguous) {
    if (g.cls === "medium") continue;
    const evidence = writingEvidence(g, others, G);
    if (evidence) evidenced.set(g.i, evidence);
    if (g.cls === "levelRule" || g.cls === "uprightRule") {
      const ticks = numberLineTicks(g, geos, G);
      // with writing along the rule, a barb must touch its tip: the glyphs at the end of a fraction
      // bar (`y_{1}` above, `x_{1}` below, leaning back along it) come near it but are not a head
      const barbs = arrowhead(g, nonBig, G, evidence === "along");
      if (perpendicularPartner(g, rules, G)) {
        draw(g, "crosses or corners another long line (axes, a rectangle)");
        flags.axes.add(g.i);
      }
      if (ticks.length > 0) {
        if (!drawing.has(g.i)) draw(g, "ticks across it (a number line)");
        flags.numberLine.add(g.i);
        for (const t of ticks) structural.set(t, "a tick");
      }
      if (barbs) {
        if (!drawing.has(g.i)) draw(g, "arrowhead");
        flags.arrow.add(g.i);
        for (const b of barbs) structural.set(b, "an arrowhead");
      }
    }
    if (!drawing.has(g.i) && !evidenced.has(g.i) && g.size >= R.loneRuleFactor * G) draw(g, "long, with no writing about it");
    // the first side of a triangle, drawn a moment before the others: a long line with nothing
    // near it is not maths either (a bar drawn before its fraction is writing again at the next flush)
    const alone = R.isolationFactor * G;
    if (!drawing.has(g.i) && !evidenced.has(g.i) && !geos.some((o) => o.i !== g.i && rectGap(o.b, g.b) <= alone)) draw(g, "a long line on its own");
    if (!drawing.has(g.i) && evidence) reasons.set(g.i, evidence === "inside" ? "writing inside it" : "writing along it (a bar, an overbar, a bracket)");
  }
  for (const [i, reason] of structural) if (!drawing.has(i)) draw(geos[i], reason);
  for (const i of closedLoops(geos, G)) if (!drawing.has(i)) draw(geos[i], "a side of a closed shape");
  const touch = Math.max(R.touchMinPx, R.touchFactor * G);
  const corner = R.cornerFactor * G;
  for (let changed = true; changed; ) {
    changed = false;
    for (const g of ambiguous) {
      if (drawing.has(g.i)) continue;
      const box = inflate(g.b, corner);
      for (const d of drawing) {
        const o = geos[d];
        if (!intersects(box, o.b)) continue;
        const joined =
          g.cls === "medium" || evidenced.has(g.i) ? endsMeet(g, o, corner) : pathDist(g.path, o.path) <= touch;
        if (joined) {
          draw(g, g.cls === "medium" || evidenced.has(g.i) ? "an end joins a drawing" : "touches a drawing");
          changed = true;
          break;
        }
      }
    }
  }
  if (drawing.size === 0) {
    const split = writingOnly(all, G);
    for (const [i, reason] of reasons) split.roles.set(all[i].id, { role: "writing", reason });
    return split;
  }

  // 4. drawing strokes that touch or sit inside one another are one drawing
  const dIdx = [...drawing].sort((a, b) => a - b);
  const uf = new UnionFind(dIdx.length);
  const reach = R.groupReachFactor * G;
  for (let a = 0; a < dIdx.length; a++) {
    for (let b = a + 1; b < dIdx.length; b++) {
      const ga = geos[dIdx[a]];
      const gb = geos[dIdx[b]];
      const [small, big] = ga.b.w * ga.b.h <= gb.b.w * gb.b.h ? [ga, gb] : [gb, ga];
      const areaSmall = Math.max(1, small.b.w * small.b.h);
      if (clipArea(small.b, big.b) / areaSmall >= R.containShare) {
        uf.union(a, b);
        continue;
      }
      if (!intersects(inflate(ga.b, reach), gb.b)) continue;
      if (pathDist(ga.path, gb.path) <= reach) uf.union(a, b);
    }
  }
  const groupOf = new Map<number, number>();
  const groups: number[][] = [];
  dIdx.forEach((gi, k) => {
    const root = uf.find(k);
    let g = groupOf.get(root);
    if (g === undefined) {
      g = groups.length;
      groupOf.set(root, g);
      groups.push([]);
    }
    groups[g].push(gi);
  });
  const diagramOf = new Map<number, number>();
  groups.forEach((members, d) => members.forEach((i) => diagramOf.set(i, d)));
  const paths = groups.map((members) => members.map((i) => geos[i]));
  const boxes = paths.map((gs) => unionRects(gs.map((g) => g.b)));

  // 5. marks and labels among what is left
  const restIdx = geos.filter((g) => !drawing.has(g.i)).map((g) => g.i);
  const rest = restIdx.map((i) => all[i]);
  const clusters = rest.length > 0 ? clusterStrokeGroups(rest).map((c) => c.map((k) => restIdx[k])) : [];
  const marks: number[][] = groups.map(() => []);
  const labels: number[][][] = groups.map(() => []);
  const roleOf = new Map<number, StrokeVerdict>();
  const labelReach = R.labelReachFactor * G;
  for (const cluster of clusters) {
    const rect = unionRects(cluster.map((i) => geos[i].b));
    let best = -1;
    let bestDist = Infinity;
    boxes.forEach((box, d) => {
      if (!intersects(inflate(box, labelReach), rect)) return;
      let dd = Infinity;
      for (const i of cluster) for (const o of paths[d]) dd = Math.min(dd, pathDist(geos[i].path, o.path));
      const cx = rect.x + rect.w / 2;
      const cy = rect.y + rect.h / 2;
      if (cx >= box.x && cx <= box.x + box.w && cy >= box.y && cy <= box.y + box.h) dd = Math.min(dd, 0);
      if (dd <= labelReach && dd < bestDist) {
        best = d;
        bestDist = dd;
      }
    });
    if (best === -1) {
      for (const i of cluster) roleOf.set(i, { role: "writing", reason: reasons.get(i) ?? "glyph" });
      continue;
    }
    const d = best;
    const toDrawing = (i: number) => {
      let m = Infinity;
      for (const o of paths[d]) m = Math.min(m, pathDist(geos[i].path, o.path));
      return m;
    };
    const onDrawing = (p: Pt) => paths[d].some((o) => pathPointDist(o.path, p) <= touch);
    // A mark sits ON the drawing: it crosses it (a tick, an open circle), both its ends are on it
    // (an angle arc, a right-angle square), or it is a dot on it. A label that merely grazes a line
    // is still a label.
    const isMark = (i: number) => {
      const g = geos[i];
      if (g.size > R.markMaxFactor * G || toDrawing(i) > touch) return false;
      if (paths[d].some((o) => pathDist(g.path, o.path) === 0)) return true;
      if (onDrawing(g.ends[0]) && onDrawing(g.ends[1])) return true;
      return onDrawing({ x: g.b.x + g.b.w / 2, y: g.b.y + g.b.h / 2 });
    };
    const attach = (group: readonly number[]) => {
      let onIt = group.filter(isMark);
      // ...unless it is written against a glyph of the label (the degree sign of `65°` in a corner)
      onIt = onIt.filter((i) => !group.some((j) => !onIt.includes(j) && rectGap(geos[i].b, geos[j].b) <= 0.3 * G));
      const labelled = group.filter((i) => !onIt.includes(i));
      for (const i of onIt) {
        marks[d].push(i);
        roleOf.set(i, { role: "mark", reason: "on the drawing", diagram: d });
      }
      // one label per word: the numbers under a number line are clustered as one row
      const cols = columnsOf(labelled, geos);
      const heights = labelled.map((i) => geos[i].b.h).filter((h) => h >= 4);
      const split = R.labelSplitFactor * Math.max(G, heights.length > 0 ? median(heights) : G);
      let current: number[] = [];
      cols.forEach((c, k) => {
        if (k > 0 && c.x0 - cols[k - 1].x1 >= split) {
          labels[d].push(current);
          current = [];
        }
        current.push(...c.members);
      });
      if (current.length > 0) labels[d].push(current);
      for (const i of labelled) roleOf.set(i, { role: "label", reason: "beside the drawing", diagram: d });
    };
    const remaining = cluster.filter((i) => !isMark(i));
    if (remaining.length > 0 && hasRelation(remaining.map((i) => all[i]), G)) {
      // A line of maths beside the drawing stays writing, even a stroke of it that touches the
      // drawing — except labels the clusterer ran into it (it joins strokes on one row up to three
      // glyphs apart): a label at the end of the line on the drawing's side, cut off by a wide gap,
      // or the labels and marks inside the drawing's own box when the line is outside it.
      let peeled = peelShadow(cluster, toDrawing, boxes[d], geos, all, G);
      if (peeled.length === 0) peeled = peelLabel(cluster, toDrawing, geos, all, G);
      for (const i of cluster) if (!peeled.includes(i)) roleOf.set(i, { role: "writing", reason: "a relation: a line of maths" });
      if (peeled.length === 0) continue;
      // the peeled strokes may be several labels (the numbers under a number line)
      const sub = clusterStrokeGroups(peeled.map((i) => all[i])).map((c) => c.map((k) => peeled[k]));
      for (const group of sub) attach(group);
      continue;
    }
    const remRect = remaining.length > 0 ? unionRects(remaining.map((i) => geos[i].b)) : null;
    const wide = remRect !== null && (remRect.w > R.labelMaxWidthFactor * G || remRect.h > R.labelMaxHeightFactor * G);
    const inZone = remRect !== null && inside(remRect, inflate(boxes[d], R.labelZoneFactor * G));
    if (wide && !inZone) {
      for (const i of cluster) roleOf.set(i, { role: "writing", reason: "too wide for a label" });
      continue;
    }
    attach(cluster);
  }

  // ids, kinds, bounds
  const used = new Set<string>();
  const diagrams: Diagram[] = groups.map((members, d) => {
    const own = [...members, ...marks[d]].sort((a, b) => a - b);
    const strokeIds = own.map((i) => all[i].id);
    const orderedLabels = labels[d]
      .map((ids) => ({ ids: [...ids].sort((a, b) => a - b), rect: unionRects(ids.map((i) => geos[i].b)) }))
      .sort((p, q) => p.rect.y + p.rect.h / 2 - (q.rect.y + q.rect.h / 2) || p.rect.x - q.rect.x);
    const bounds = unionRects([...own.map((i) => geos[i].b), ...orderedLabels.map((l) => l.rect)]);
    return {
      id: "",
      strokeIds,
      labels: orderedLabels.map((l) => l.ids.map((i) => all[i].id)),
      bounds,
      kinds: kindsOf(members.map((i) => geos[i]), flags, G),
    };
  });
  const candidates: Array<{ d: Diagram; prev: Diagram; ratio: number }> = [];
  for (const d of diagrams) {
    const set = new Set<string>(d.strokeIds);
    for (const prev of previous) {
      const shared = prev.strokeIds.filter((id) => set.has(id)).length;
      const ratio = shared / Math.max(1, Math.min(prev.strokeIds.length, d.strokeIds.length));
      if (ratio >= R.idReuseRatio) candidates.push({ d, prev, ratio });
    }
  }
  candidates.sort((p, q) => q.ratio - p.ratio);
  for (const c of candidates) {
    if (c.d.id || used.has(c.prev.id)) continue;
    c.d.id = c.prev.id;
    used.add(c.prev.id);
  }
  for (const d of diagrams) {
    if (d.id) continue;
    let id = newDiagramId();
    while (used.has(id)) id = newDiagramId();
    d.id = id;
    used.add(id);
  }

  const roles = new Map<string, StrokeVerdict>();
  geos.forEach((g) => {
    const d = diagramOf.get(g.i);
    // a tick or a barb is a mark on the drawing, taken with it before anything was clustered
    if (d !== undefined) roles.set(all[g.i].id, { role: structural.has(g.i) ? "mark" : "drawing", reason: reasons.get(g.i) ?? "drawing", diagram: d });
    else roles.set(all[g.i].id, roleOf.get(g.i) ?? { role: "writing", reason: reasons.get(g.i) ?? "glyph" });
  });
  const writing = all.filter((s) => roles.get(s.id)?.role === "writing");
  return { writing, diagrams, bars: [], glyph: G, roles };
}

/**
 * Each division bar's strokes (the bar, then its divisor) for `clusterLines`' `fixed` groups: one
 * line each. Strokes no longer in `strokes` are left out.
 */
export function barGroups(bars: readonly DivisionBar[], strokes: readonly InkStroke[]): InkStroke[][] {
  const byId = new Map(strokes.map((s) => [s.id as string, s]));
  return bars.map((b) => [b.bar, ...b.divisor].map((id) => byId.get(id)).filter((s): s is InkStroke => Boolean(s)));
}

// ---------------------------------------------------------------- what it looks like

function kindsOf(members: readonly Geo[], flags: Flags, G: number): DiagramKind[] {
  const kinds = new Set<DiagramKind>();
  // the drawing's lines, not the ticks and barbs on them
  const lines = members.filter((g) => g.size >= DIAGRAM_RULES.mediumFactor * G);
  const straight = lines.filter((g) => g.rule || g.cls === "medium");
  for (const g of lines) {
    if (g.closed) {
      const corners = g.shape.length - 1;
      const pts = g.path.flat();
      const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
      const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
      const radii = pts.map((p) => Math.hypot(p.x - cx, p.y - cy));
      const mean = radii.reduce((s, r) => s + r, 0) / radii.length;
      const sd = Math.sqrt(radii.reduce((s, r) => s + (r - mean) ** 2, 0) / radii.length);
      if (corners >= 6 && sd / Math.max(1, mean) <= 0.2) kinds.add("circle");
      else if (corners === 3) kinds.add("triangle");
      else if (corners === 4) kinds.add("quadrilateral");
      else kinds.add("polygon");
    }
  }
  // straight strokes whose ends pair up into a closed loop: 3 of them a triangle, 4 a quadrilateral
  if (straight.length === 3 || straight.length === 4) {
    const ends = straight.flatMap((g) => [g.main.a, g.main.b]);
    const paired = ends.every((p, k) => ends.some((q, j) => Math.floor(j / 2) !== Math.floor(k / 2) && dist(p, q) <= DIAGRAM_RULES.cornerFactor * G));
    if (paired) kinds.add(straight.length === 3 ? "triangle" : "quadrilateral");
  }
  const polygon = kinds.has("triangle") || kinds.has("quadrilateral");
  for (const g of lines) {
    if (flags.axes.has(g.i) && !polygon) kinds.add("axes");
    if (flags.numberLine.has(g.i)) kinds.add("numberLine");
    if (flags.arrow.has(g.i)) kinds.add("arrow");
  }
  if (kinds.size === 0) kinds.add(straight.length === lines.length ? "segment" : "curve");
  return [...kinds];
}

// ---------------------------------------------------------------- reading the labels

/**
 * The drawing's labels stacked one per row, left-aligned, `labelStackGapFactor` of their own glyph height apart —
 * the layout the recognizer reads back as one row per label. Laid side by side, `3` and `4` came
 * back as `34` and `A B C 3 4 x` as `\text{ABC34X}` (2 of 6 label sets split right); stacked, 6 of 6
 * did, and so did all seven generated drawings' stacks (25 labels, 24 read right; `O` came back as
 * `0`). Null when the drawing has no labels.
 */
export function labelStack(diagram: Diagram, strokes: readonly InkStroke[], glyph: number): { line: InkLine; strokes: InkStroke[] } | null {
  if (diagram.labels.length === 0) return null;
  const byId = new Map(strokes.map((s) => [s.id as string, s]));
  const groups = diagram.labels.map((ids) => ids.map((id) => byId.get(id)).filter((s): s is InkStroke => Boolean(s)));
  // the gap is measured on the labels' own glyphs, so the same label ink always makes the same
  // payload (and hits the recognition cache) whatever else is written on the screen
  const heights = groups.flat().map((s) => s.bounds.h).filter((h) => h >= 4);
  const gap = DIAGRAM_RULES.labelStackGapFactor * (heights.length > 0 ? median(heights) : glyph);
  const out: InkStroke[] = [];
  let y = 0;
  for (const members of groups) {
    if (members.length === 0) continue;
    const r = unionRects(members.map((s) => s.bounds));
    const dx = -r.x;
    const dy = y - r.y;
    for (const s of members) {
      out.push({
        id: s.id,
        bounds: { x: s.bounds.x + dx, y: s.bounds.y + dy, w: s.bounds.w, h: s.bounds.h },
        segments: s.segments.map((seg) => seg.map((p) => ({ x: p.x + dx, y: p.y + dy }))),
      });
    }
    y += r.h + gap;
  }
  if (out.length === 0) return null;
  const line: InkLine = { id: diagram.id, strokeIds: out.map((s) => s.id), bounds: unionRects(out.map((s) => s.bounds)), column: 0, row: 0, hash: "" };
  return { line, strokes: out };
}

/** The recognizer payload for a drawing's labels (one call for all of them), or null. */
export function labelPayload(diagram: Diagram, strokes: readonly InkStroke[], glyph: number): StrokePayload | null {
  const stack = labelStack(diagram, strokes, glyph);
  return stack ? buildPayload(stack.line, stack.strokes) : null;
}

/** A brace group's contents, one level of nesting deep (`70^{\circ}`). */
const GROUP = "(?:[^{}]|\\{[^{}]*\\})*";

/**
 * The recognizer's read of a label stack as one LaTeX string per row: `\begin{array}{l} A \\ 3
 * \end{array}` → `["A", "3"]`; plain rows split on newlines. Empty rows dropped. A row that is a
 * lone letter in `\text{}` is the letter, and a lone `\times` is the letter x: a label is never a
 * multiplication sign on its own (Mathpix reads a lone handwritten x that way).
 */
export function parseLabelRead(latex: string): string[] {
  const body = latex
    .replace(/\\begin\{(?:array|aligned|gathered|matrix|split)\}(?:\{[^{}]*\})?/g, "\n")
    .replace(/\\end\{(?:array|aligned|gathered|matrix|split)\}/g, "\n")
    // two stacked labels read as one construct: `\underbrace{2 x+10}_{70^{\circ}}` (seen on the
    // board: `2x + 10` over `70°`), `\overbrace`, `\underset`, `\overset`, `\stackrel`
    .replace(new RegExp(`\\\\underbrace\\s*\\{(${GROUP})\\}\\s*_\\s*\\{(${GROUP})\\}`, "g"), "\n$1\n$2\n")
    .replace(new RegExp(`\\\\overbrace\\s*\\{(${GROUP})\\}\\s*\\^\\s*\\{(${GROUP})\\}`, "g"), "\n$2\n$1\n")
    .replace(new RegExp(`\\\\underset\\s*\\{(${GROUP})\\}\\s*\\{(${GROUP})\\}`, "g"), "\n$2\n$1\n")
    .replace(new RegExp(`\\\\(?:overset|stackrel)\\s*\\{(${GROUP})\\}\\s*\\{(${GROUP})\\}`, "g"), "\n$1\n$2\n")
    // a math delimiter inside the read (`70^{\circ} \) x`, seen on the board): a break between labels
    .replace(/\\[()[\]]/g, "\n");
  return body
    .split(/\\\\|\n/)
    .map((row) =>
      row
        .replace(/&/g, " ")
        .replace(/\\(?:quad|qquad)\b/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^\\(?:text|mathrm)\s*\{\s*([A-Za-z])\s*\}$/, "$1")
        .replace(/^\\times$/, "x"),
    )
    .filter((row) => row.length > 0);
}

/** The drawing nearest to `rect` within `reach`, or null. */
export function diagramNear(diagrams: readonly Diagram[], rect: Rect, reach: number): Diagram | null {
  let best: Diagram | null = null;
  let bestGap = Infinity;
  for (const d of diagrams) {
    const b = d.bounds;
    const gx = Math.max(0, b.x - (rect.x + rect.w), rect.x - (b.x + b.w));
    const gy = Math.max(0, b.y - (rect.y + rect.h), rect.y - (b.y + b.h));
    const gap = Math.hypot(gx, gy);
    if (gap <= reach && gap < bestGap) {
      best = d;
      bestGap = gap;
    }
  }
  return best;
}
