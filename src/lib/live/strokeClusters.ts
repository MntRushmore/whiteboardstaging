import type { TLShapeId } from "tldraw";
import type { InkLine, InkStroke, Rect } from "./contracts";

/**
 * Stroke grouping (spec §6.2). Pure: no editor, no DOM.
 *
 * Union-find with transitive closure. Two strokes join when
 *  - their vertical intervals overlap >= 40 % of the smaller height, OR
 *  - the horizontal gap is < 1.2 x median stroke height while their vertical
 *    centres differ by < 0.6 x median height;
 *  - a fraction bar (wide, flat stroke) joins every stroke whose x-range it
 *    covers >= 50 % within 1.5 x median height above or below it;
 *  - a superscript (small stroke sitting just above a neighbour's top, horizontally
 *    adjacent) joins that neighbour.
 * Every stroke rect is inflated by max(3 px, 0.1 x median height) before the overlap /
 * gap tests so zero-height bars (F/E/T cross-bars, minus signs) join their letters.
 * Lines are then sorted top-to-bottom into columns by x-overlap >= 40 % with the last row of
 * the column above them, and a line separated from the column above it by a blank gap of a few of
 * its lines starts a column of its own: a column is one problem (`assignColumns`).
 *
 * The thresholds scale with the writing's own median glyph (or, for the gap under a column, its
 * own lines), but for a few px of slack for hairline strokes and the floor of how far above and
 * below a gutter is looked for (`gutterReachMinPx`): page px on a desktop, scaled to the board's
 * zoom (`inkScale`) — the same hand is five times bigger in page px on a phone.
 */

export const CLUSTER_RULES = {
  verticalOverlapRatio: 0.4,
  gapFactor: 1.2,
  /** vertical-overlap joins are capped so side-by-side columns stay separate */
  sameRowMaxGapFactor: 3,
  centerFactor: 0.6,
  barAspect: 3,
  barMaxHeightFactor: 0.25,
  /**
   * ...or, for a long bar, at most this fraction of its own width: a 70 px fraction bar written
   * 4° off level is 5 px tall, over a quarter of a small glyph, and was not taken for a bar —
   * its numerator came loose as a line of its own. 0.1 is about 6° of tilt.
   */
  barSlantFactor: 0.1,
  /**
   * A detached dot (the dot of `?` / `!`, an `i` dot written high) is at most this fraction of
   * the median glyph in each direction, and joins the glyph it sits within `dotReachFactor` x
   * median of, above or below. Without this the dot of `x = ?` became a "line" of its own.
   */
  dotMaxFactor: 0.35,
  dotReachFactor: 0.8,
  /**
   * Second pass over whole clusters. Same row: two clusters overlapping vertically by at least
   * this fraction of the shorter, and closer than `gapFactor` x median, are one line (a tilted
   * last glyph joined no single stroke). Written inside: a smaller cluster whose strokes were
   * written in the MIDDLE of another's (the `x \to 2` under `\lim`, before `(3x+1)`), within
   * `insideReachFactor` x median above or below it and at most `insideMaxHeight` of its height,
   * is part of it — the next row of working is only ever started after the row above.
   */
  rowOverlapRatio: 0.5,
  insideReachFactor: 0.6,
  insideMaxHeight: 0.8,
  barMinWidthFactor: 1.0,
  barReachFactor: 1.5,
  barCoverRatio: 0.5,
  /** an overline: what it covers is within this many medians under it, and nothing this close above (`isOverlineBar`) */
  overlineNearFactor: 0.6,
  overlineClearFactor: 0.9,
  columnOverlapRatio: 0.4,
  /**
   * An operation row (`mergeOperationRows`): pieces at most `opPieceWidthFactor` medians wide (two
   * the same-row join already put together are one piece) and `opPieceHeightFactor` tall, each
   * starting with a short level bar at most `opBarWidthFactor` medians long, level with each other,
   * under one line whose bottom is within `opRowReachFactor` medians above them.
   */
  opPieceWidthFactor: 6,
  opPieceHeightFactor: 2.2,
  opBarWidthFactor: 1.6,
  opRowReachFactor: 2,
  /**
   * A blank gap under a column at least this many of its lines tall (the median height of the
   * column's lines) ends the column: a line written that far further down is a new problem, not the
   * next step of the one above (`assignColumns`). Relative to the column's own writing, so it is
   * the same gap on a phone, an iPad or a desktop, in a big hand or a small one.
   *
   * Conservative on purpose. Two problems read as one cost a wrong mark on the second one's first
   * line; one problem cut in two costs more: every step under the cut is judged with nothing
   * above it, and Solve starts that half over. A student's steps are often a line apart and
   * sometimes two or a little more (2.35 lines is the widest in the Live tests); a problem set off
   * with a clear gap has more blank above it than that. Nothing that is written is blank, and
   * lines that were one problem stay one (`ColumnOptions`).
   */
  problemGapFactor: 2.5,
  /**
   * How far above and below a line a gutter between two problems side by side is looked for
   * (`gutterCut`): max(gutterReachMinPx x `inkScale`, gutterReachFactor x the line's height).
   */
  gutterReachFactor: 3,
  gutterReachMinPx: 120,
  /**
   * A gutter between two problems written side by side (`splitAtGutters`): a gap of the line's at
   * least `gutterMinFactor` medians wide, holding a band at least `gutterClearFactor` medians wide
   * that no ink crosses within `gutterReachFactor` lines above or below, with the column on its
   * right starting within `gutterAlignFactor` medians of where the line's right part starts.
   */
  gutterMinFactor: 1.2,
  gutterClearFactor: 0.5,
  gutterAlignFactor: 1.5,
  /** `inkScale` never goes past this (a phone held upright is ~5: zoom ~0.2) */
  maxInkScale: 6,
  idReuseRatio: 0.5,
  /** rect inflation before the join tests: max(inflateMinPx, inflateFactor x median) */
  inflateMinPx: 3,
  inflateFactor: 0.1,
  /** superscript: h < 0.7 x median, bottom within [top - 0.5 x median, top + 0.25 x median], gap < 0.8 x median */
  superMaxHeightFactor: 0.7,
  superRaiseFactor: 0.5,
  superDropFactor: 0.25,
  superGapFactor: 0.8,
} as const;

/**
 * How much bigger in page px the same handwriting is on this board than on a desktop. A board is a
 * fixed 1600 x 900 screen fitted to the window (`lib/screens/screens.ts`), so a hand is about five
 * times bigger in page px on a phone held upright (zoom ~0.2), and twice as big on an iPad (~0.5),
 * as on a desktop: `2x2` written 50 px tall on a phone is 250 page px. The few thresholds that are
 * absolute page px rather than relative to the writing's own glyphs (the glyph cap in
 * `diagrams.ts`, the gutter reach's floor here) were tuned on a desktop, so they are multiplied by
 * this, and judge the ink by how big it looks on the student's screen. 1 at zoom 1 and above (a
 * desktop is unchanged), 1 / zoom below it, at most `maxInkScale`; 1 when the zoom is unknown.
 *
 * `zoom` is the board's FIT zoom (`editor.getBaseZoom()`), not the camera's current zoom. The camera
 * never zooms out past the fit, so no ink looked smaller than this when it was written; and pinching
 * in to write the next line small does not turn the big lines written before it into drawings.
 */
export function inkScale(zoom?: number): number {
  if (zoom === undefined || !Number.isFinite(zoom) || zoom <= 0) return 1;
  return Math.min(CLUSTER_RULES.maxInkScale, Math.max(1, 1 / zoom));
}

export function unionRects(rects: Rect[]): Rect {
  if (rects.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
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

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function overlap1d(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

function gap1d(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.max(a0 - b1, b0 - a1));
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

/** Median height of the "glyph-like" strokes (flat bars excluded when possible). */
export function medianStrokeHeight(strokes: InkStroke[]): number {
  const heights = strokes.map((s) => s.bounds.h);
  const tall = heights.filter((h) => h >= 4);
  const m = median(tall.length > 0 ? tall : heights);
  return Math.max(m, 8);
}

/**
 * A fraction bar is wide and flat relative to the median glyph height. An `=` sign
 * or a minus is also flat, so we additionally require it to be at least a glyph wide
 * and to have no parallel twin bar directly above/below (that is an `=`).
 */
/** Wide and flat: level, or a long stroke only slightly off level. */
function isFlat(r: Rect, medianH: number): boolean {
  if (!(r.w > CLUSTER_RULES.barAspect * r.h)) return false;
  return r.h < Math.max(CLUSTER_RULES.barMaxHeightFactor * medianH, CLUSTER_RULES.barSlantFactor * r.w);
}

export function isFractionBar(stroke: InkStroke, strokes: InkStroke[], medianH: number): boolean {
  const { w } = stroke.bounds;
  if (!isFlat(stroke.bounds, medianH)) return false;
  if (w < CLUSTER_RULES.barMinWidthFactor * medianH) return false;
  const h = stroke.bounds.h;
  for (const other of strokes) {
    if (other.id === stroke.id) continue;
    const ob = other.bounds;
    if (!isFlat(ob, medianH)) continue;
    const xOverlap = overlap1d(stroke.bounds.x, stroke.bounds.x + w, ob.x, ob.x + ob.w);
    const smallerW = Math.min(w, ob.w);
    const centerGap = Math.abs(ob.y + ob.h / 2 - (stroke.bounds.y + h / 2));
    if (smallerW > 0 && xOverlap / smallerW >= 0.7 && centerGap <= 0.5 * medianH) return false;
  }
  return true;
}

function shouldJoin(a: Rect, b: Rect, medianH: number): boolean {
  const smallerH = Math.max(1, Math.min(a.h, b.h));
  const vOverlap = overlap1d(a.y, a.y + a.h, b.y, b.y + b.h);
  const hGap = gap1d(a.x, a.x + a.w, b.x, b.x + b.w);
  // Vertical overlap alone is not enough for strokes far apart horizontally (other column).
  if (
    vOverlap / smallerH >= CLUSTER_RULES.verticalOverlapRatio &&
    hGap < CLUSTER_RULES.sameRowMaxGapFactor * medianH
  ) {
    return true;
  }
  const centerDiff = Math.abs(a.y + a.h / 2 - (b.y + b.h / 2));
  return hGap < CLUSTER_RULES.gapFactor * medianH && centerDiff < CLUSTER_RULES.centerFactor * medianH;
}

/** Inflates a rect by `by` on every side (zero-height bars get a body to overlap with). */
export function inflateRect(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by };
}

export function inflationFor(medianH: number): number {
  return Math.max(CLUSTER_RULES.inflateMinPx, CLUSTER_RULES.inflateFactor * medianH);
}

/**
 * `small` is a superscript of `base` when it is short, sits with its bottom just above
 * (or barely below) the base's top, starts higher than the base and is horizontally
 * adjacent. Takes the raw (un-inflated) stroke bounds.
 */
export function isSuperscriptOf(small: Rect, base: Rect, medianH: number): boolean {
  if (!(small.h < CLUSTER_RULES.superMaxHeightFactor * medianH)) return false;
  if (!(small.h < base.h)) return false;
  if (!(small.y < base.y)) return false;
  const bottom = small.y + small.h;
  if (bottom < base.y - CLUSTER_RULES.superRaiseFactor * medianH) return false;
  if (bottom > base.y + CLUSTER_RULES.superDropFactor * medianH) return false;
  const hGap = gap1d(small.x, small.x + small.w, base.x, base.x + base.w);
  return hGap < CLUSTER_RULES.superGapFactor * medianH;
}

/** `dot` is a detached dot belonging to `glyph`: tiny, over or under it, and close. Raw bounds. */
export function isDotOf(dot: Rect, glyph: Rect, medianH: number): boolean {
  const max = CLUSTER_RULES.dotMaxFactor * medianH;
  if (!(dot.w <= max && dot.h <= max)) return false;
  // the glyph must be a glyph, not another dot or a flat bar
  if (!(glyph.h > max)) return false;
  const hGap = gap1d(dot.x, dot.x + dot.w, glyph.x, glyph.x + glyph.w);
  if (hGap > 0.3 * medianH) return false;
  const vGap = gap1d(dot.y, dot.y + dot.h, glyph.y, glyph.y + glyph.h);
  return vGap <= CLUSTER_RULES.dotReachFactor * medianH;
}

function barCovers(bar: Rect, other: Rect, medianH: number): boolean {
  if (other.w < 1) {
    // A thin vertical stroke (a "1", the stem of a "+") has no width to overlap:
    // it is covered when its centre falls inside the bar's x-range.
    const cx = other.x + other.w / 2;
    if (cx < bar.x - 1 || cx > bar.x + bar.w + 1) return false;
  } else {
    const xOverlap = overlap1d(bar.x, bar.x + bar.w, other.x, other.x + other.w);
    if (xOverlap / other.w < CLUSTER_RULES.barCoverRatio) return false;
  }
  const vGap = gap1d(bar.y, bar.y + bar.h, other.y, other.y + other.h);
  return vGap <= CLUSTER_RULES.barReachFactor * medianH;
}

/**
 * An overline (`\overline{AB}`, a segment's name in a proof), not a fraction bar: the glyphs it covers
 * sit just under it (within `overlineNearFactor` x median) and nothing it covers is that close above
 * it — only, at most, the line above, one row away. A fraction bar has its numerator close above. An
 * overline joins only what is under it: stacked rows of `\overline{AB} \cong \overline{CD}` are
 * separate lines, not a numerator over a denominator. Takes the raw (un-inflated) bounds.
 */
export function isOverlineBar(bar: Rect, others: readonly Rect[], medianH: number): boolean {
  let above = Infinity;
  let below = Infinity;
  for (const o of others) {
    if (o === bar || !barCovers(bar, o, medianH)) continue;
    const cy = o.y + o.h / 2;
    const gap = gap1d(bar.y, bar.y + bar.h, o.y, o.y + o.h);
    if (cy < bar.y + bar.h / 2) above = Math.min(above, gap);
    else below = Math.min(below, gap);
  }
  return below <= CLUSTER_RULES.overlineNearFactor * medianH && above > CLUSTER_RULES.overlineClearFactor * medianH;
}

/**
 * The furthest apart, vertically and in medians, two strokes can be and still join in
 * `clusterStrokeGroups`: a centre-to-centre join, a bar reaching what it covers, a superscript's
 * raise, a dot's reach. A new join rule that reaches further must be added here.
 */
const JOIN_REACH_FACTOR = Math.max(CLUSTER_RULES.centerFactor, CLUSTER_RULES.barReachFactor, CLUSTER_RULES.superRaiseFactor, CLUSTER_RULES.dotReachFactor);

/** Groups strokes into clusters (arrays of indexes into `strokes`). */
export function clusterStrokeGroups(strokes: InkStroke[]): number[][] {
  const n = strokes.length;
  if (n === 0) return [];
  const medianH = medianStrokeHeight(strokes);
  const uf = new UnionFind(n);
  const bars = strokes.map((s) => isFractionBar(s, strokes, medianH));
  const rawBounds = strokes.map((s) => s.bounds);
  const overlines = bars.map((bar, i) => bar && isOverlineBar(rawBounds[i], rawBounds, medianH));
  /** a bar joins `other`: an overline only what is under it */
  const barJoins = (i: number, bar: Rect, other: Rect, rawOther: Rect) =>
    barCovers(bar, other, medianH) && (!overlines[i] || rawOther.y + rawOther.h / 2 > rawBounds[i].y + rawBounds[i].h / 2);
  const by = inflationFor(medianH);
  // Inflated rects for the overlap / gap / bar tests; bar detection above used the raw bounds.
  const rects = strokes.map((s) => inflateRect(s.bounds, by));
  // The superscript test compares heights and the small stroke's bottom against the base's
  // top, so it works on the raw bounds: inflation would make a 60 %-size glyph "taller"
  // than 0.7 x median and hide the raise. Flat bars (h < 1) are never superscripts.
  const raw = strokes.map((s) => s.bounds);
  // Every join below needs the two strokes within JOIN_REACH_FACTOR x median of each other
  // vertically, so the pairs are swept top to bottom and a stroke stops looking once the next
  // starts further down than that: the same pairs join (union-find makes the order irrelevant),
  // in O(n log n + pairs in reach) instead of all n² — a 3,000-stroke screen went 317 -> 58 ms.
  const reach = JOIN_REACH_FACTOR * medianH;
  const order = rects.map((_, i) => i).sort((p, q) => rects[p].y - rects[q].y);
  for (let s = 0; s < n; s++) {
    const i = order[s];
    const bottom = rects[i].y + rects[i].h;
    for (let t = s + 1; t < n; t++) {
      const j = order[t];
      if (rects[j].y - bottom > reach) break;
      const a = rects[i];
      const b = rects[j];
      if (shouldJoin(a, b, medianH)) {
        uf.union(i, j);
        continue;
      }
      if ((bars[i] && barJoins(i, a, b, raw[j])) || (bars[j] && barJoins(j, b, a, raw[i]))) {
        uf.union(i, j);
        continue;
      }
      if (
        (raw[i].h >= 1 && isSuperscriptOf(raw[i], raw[j], medianH)) ||
        (raw[j].h >= 1 && isSuperscriptOf(raw[j], raw[i], medianH))
      ) {
        uf.union(i, j);
        continue;
      }
      if (isDotOf(raw[i], raw[j], medianH) || isDotOf(raw[j], raw[i], medianH)) uf.union(i, j);
    }
  }
  mergeClusters(uf, raw, medianH);
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = uf.find(i);
    const g = groups.get(root);
    if (g) g.push(i);
    else groups.set(root, [i]);
  }
  return [...groups.values()];
}

/**
 * The second pass (see `rowOverlapRatio`): clusters that are one written line although no two
 * of their strokes touch. `raw` is in writing order (tldraw keeps draw shapes in creation order).
 */
function mergeClusters(uf: UnionFind, raw: readonly Rect[], medianH: number): void {
  for (let changed = true; changed; ) {
    changed = false;
    const members = new Map<number, number[]>();
    raw.forEach((_, i) => {
      const r = uf.find(i);
      const m = members.get(r);
      if (m) m.push(i);
      else members.set(r, [i]);
    });
    const clusters = [...members.entries()].map(([root, idx]) => ({
      root,
      rect: unionRects(idx.map((i) => raw[i])),
      first: Math.min(...idx),
      last: Math.max(...idx),
    }));
    outer: for (let a = 0; a < clusters.length; a++) {
      for (let b = a + 1; b < clusters.length; b++) {
        const A = clusters[a];
        const B = clusters[b];
        const vOverlap = overlap1d(A.rect.y, A.rect.y + A.rect.h, B.rect.y, B.rect.y + B.rect.h);
        const hGap = gap1d(A.rect.x, A.rect.x + A.rect.w, B.rect.x, B.rect.x + B.rect.w);
        const shorter = Math.max(1, Math.min(A.rect.h, B.rect.h));
        const sameRow = vOverlap / shorter >= CLUSTER_RULES.rowOverlapRatio && hGap < CLUSTER_RULES.gapFactor * medianH;
        const [small, big] = A.rect.h <= B.rect.h ? [A, B] : [B, A];
        const writtenInside =
          small.first > big.first &&
          small.last < big.last &&
          small.rect.h <= CLUSTER_RULES.insideMaxHeight * big.rect.h &&
          gap1d(small.rect.y, small.rect.y + small.rect.h, big.rect.y, big.rect.y + big.rect.h) <= CLUSTER_RULES.insideReachFactor * medianH &&
          overlap1d(small.rect.x, small.rect.x + small.rect.w, big.rect.x, big.rect.x + big.rect.w) > 0;
        if (sameRow || writtenInside) {
          uf.union(A.root, B.root);
          changed = true;
          break outer;
        }
      }
    }
  }
}

/**
 * The pieces of an operation row are one line, however far apart the sides they sit under:
 *
 *     2x + 3 = 11
 *       -3     -3
 *
 * is what a class writes to take 3 from both sides (`engine/operationLine.ts`), and the two `-3`s
 * are as far apart as `+ 3` and `11` — past the same-row join (`sameRowMaxGapFactor`), which keeps
 * side-by-side problems apart, as soon as the median glyph is a little small. Two or three groups
 * on one row, each short and starting with a short level bar (a `-`, the bar of a `+` or of a
 * `÷`), with nothing else between them on the row, all under ONE group just above that reaches
 * over each of them, are joined. Side-by-side columns each have their own line above; `-3` alone
 * under one side stays alone. Groups of strokes in, groups out.
 */
export function mergeOperationRows(groups: InkStroke[][], medianH: number): InkStroke[][] {
  if (groups.length < 3) return groups;
  const R = CLUSTER_RULES;
  const rects = groups.map((g) => unionRects(g.map((s) => s.bounds)));
  const piece = groups.map((g, k) => {
    const r = rects[k];
    if (g.length > 12 || r.w > R.opPieceWidthFactor * medianH || r.h > R.opPieceHeightFactor * medianH) return false;
    const first = [...g].sort((a, b) => a.bounds.x - b.bounds.x)[0].bounds;
    return isFlat(first, medianH) && first.w <= R.opBarWidthFactor * medianH && first.w >= 0.25 * medianH;
  });
  const above = (k: number): number => {
    const r = rects[k];
    let best = -1;
    let bestGap = Infinity;
    rects.forEach((c, j) => {
      if (j === k || piece[j]) return;
      const gap = r.y - (c.y + c.h);
      if (gap < -0.25 * medianH || gap > R.opRowReachFactor * medianH) return;
      if (overlap1d(r.x, r.x + r.w, c.x, c.x + c.w) < 0.5 * r.w) return;
      if (gap < bestGap) {
        best = j;
        bestGap = gap;
      }
    });
    return best;
  };
  const uf = new UnionFind(groups.length);
  for (let a = 0; a < groups.length; a++) {
    if (!piece[a]) continue;
    const over = above(a);
    if (over === -1) continue;
    for (let b = 0; b < groups.length; b++) {
      if (b === a || !piece[b] || rects[b].x <= rects[a].x || above(b) !== over) continue;
      const A = rects[a];
      const B = rects[b];
      if (overlap1d(A.y, A.y + A.h, B.y, B.y + B.h) < 0.5 * Math.min(A.h, B.h)) continue;
      // nothing else of the row between them
      const between = rects.some((c, j) => j !== a && j !== b && c.x >= A.x + A.w && c.x + c.w <= B.x && overlap1d(A.y, A.y + A.h, c.y, c.y + c.h) > 0);
      if (!between) uf.union(a, b);
    }
  }
  const merged = new Map<number, InkStroke[]>();
  groups.forEach((g, k) => {
    const root = uf.find(k);
    merged.set(root, [...(merged.get(root) ?? []), ...g]);
  });
  return [...merged.values()];
}

/**
 * An `=` among these strokes: two level bars of about one length, one close over the other. The
 * same pair `hasRelation` (`diagrams.ts`) reads as an `=`.
 */
function holdsEquals(strokes: readonly InkStroke[], medianH: number): boolean {
  const bars = strokes.filter((s) => s.bounds.w >= 0.25 * medianH && isFlat(s.bounds, medianH));
  for (let i = 0; i < bars.length; i++) {
    for (let j = i + 1; j < bars.length; j++) {
      const a = bars[i].bounds;
      const b = bars[j].bounds;
      const ratio = a.w / b.w;
      if (ratio < 0.4 || ratio > 2.5) continue;
      if (overlap1d(a.x, a.x + a.w, b.x, b.x + b.w) < 0.5 * Math.min(a.w, b.w)) continue;
      const gap = Math.abs(a.y + a.h / 2 - (b.y + b.h / 2));
      if (gap >= 0.08 * medianH && gap <= 0.9 * medianH) return true;
    }
  }
  return false;
}

/** The widest stretch of [g0, g1] that none of `blocks` covers, or null when it is all covered. */
function widestClear(g0: number, g1: number, blocks: Array<[number, number]>): [number, number] | null {
  const clear: Array<[number, number]> = [];
  let at = g0;
  for (const [lo, hi] of [...blocks].sort((p, q) => p[0] - q[0])) {
    if (hi <= at || lo >= g1) continue;
    if (lo > at) clear.push([at, lo]);
    at = Math.max(at, hi);
  }
  if (g1 > at) clear.push([at, g1]);
  return clear.reduce<[number, number] | null>((best, c) => (!best || c[1] - c[0] > best[1] - best[0] ? c : best), null);
}

/** How many rows these strokes are on: runs of strokes that overlap one another vertically. */
function rowCount(strokes: readonly InkStroke[]): number {
  let rows = 0;
  let bottom = -Infinity;
  for (const s of [...strokes].sort((a, b) => a.bounds.y - b.bounds.y)) {
    if (s.bounds.y > bottom) rows += 1;
    bottom = Math.max(bottom, s.bounds.y + s.bounds.h);
  }
  return rows;
}

/**
 * Where a line of two problems' rows splits: its left and right strokes, or null (see
 * `splitAtGutters`). `all` is every stroke being clustered.
 */
function gutterCut(line: readonly InkStroke[], all: readonly InkStroke[], medianH: number, scale: number): [InkStroke[], InkStroke[]] | null {
  const R = CLUSTER_RULES;
  // an `=` on each side takes two strokes each
  if (line.length < 4) return null;
  const minGap = R.gutterMinFactor * medianH;
  // the line's own gaps: between its strokes' x-ranges, merged
  const sorted = [...line].sort((a, b) => a.bounds.x - b.bounds.x);
  const gaps: Array<[number, number]> = [];
  let reach = sorted[0].bounds.x + sorted[0].bounds.w;
  for (const s of sorted.slice(1)) {
    if (s.bounds.x - reach >= minGap) gaps.push([reach, s.bounds.x]);
    reach = Math.max(reach, s.bounds.x + s.bounds.w);
  }
  if (gaps.length === 0) return null;
  gaps.sort((p, q) => q[1] - q[0] - (p[1] - p[0]));
  const rect = unionRects(line.map((s) => s.bounds));
  let near: InkStroke[] | null = null;
  let offRow: InkStroke[] = [];
  for (const [g0, g1] of gaps) {
    const left = line.filter((s) => s.bounds.x + s.bounds.w <= g0);
    const right = line.filter((s) => s.bounds.x >= g1);
    if (!holdsEquals(left, medianH) || !holdsEquals(right, medianH)) continue;
    if (!near) {
      const mine = new Set(line);
      const vReach = Math.max(R.gutterReachMinPx * scale, R.gutterReachFactor * rect.h);
      near = all.filter((s) => !mine.has(s) && s.bounds.y <= rect.y + rect.h + vReach && s.bounds.y + s.bounds.h >= rect.y - vReach);
      offRow = near.filter((s) => {
        const cy = s.bounds.y + s.bounds.h / 2;
        return cy < rect.y || cy > rect.y + rect.h;
      });
    }
    // nothing within reach above or below crosses it (a `1` has no width: it still blocks)
    const band = widestClear(g0, g1, near.map((s) => [s.bounds.x, s.bounds.x + Math.max(1, s.bounds.w)]));
    if (!band || band[1] - band[0] < R.gutterClearFactor * medianH) continue;
    // ...it runs on past this row, other rows' ink on both sides of it, and the column on its
    // right starts where this line's right part does. A gap round the `=` of a line wider than
    // the lines under it is clear there too, but the next column starts well to its right.
    const beyond = offRow.filter((s) => s.bounds.x >= band[1]);
    const margin = Math.min(...beyond.map((s) => s.bounds.x));
    if (!offRow.some((s) => s.bounds.x + s.bounds.w <= band[0])) continue;
    if (Math.abs(margin - g1) > R.gutterAlignFactor * medianH) continue;
    // ...and the column on the right is a column: two more rows of it. A system written on one
    // row (`x + y = 10   x - y = 2`) with the working under it and `y = 4` under its right half
    // stays one line, as it always was.
    if (rowCount(beyond) >= 2) return [left, right];
  }
  return null;
}

/**
 * Two problems written side by side, their rows level, are two columns. But the same-row join
 * reaches `sameRowMaxGapFactor` medians across, and a student short of room (on a phone, or with
 * a second problem squeezed in beside the first) leaves less than that between them: each row of
 * the two came out as ONE line, `2x + 3 = 11 4x - 5 = 3`, read as nonsense. A line is cut at a gap
 * of its own at least `gutterMinFactor` medians wide (only the same-row join reaches across one)
 * when that gap holds a gutter between columns: a band in it that no other ink crosses within
 * reach above or below (`gutterReachFactor`), other rows' ink on both sides of it, the column on its right
 * starting where the line's right part does and two rows long besides it — and an `=` on each
 * side of the cut (`holdsEquals`). A line spaced out round its `=`, the `=` aligned down the page
 * (`2x + 3   =   11` over `2x   =   8`), has a gutter too, but `2x + 3` is no equation;
 * `x = 2   x = 3` under `(x - 2)(x - 3) = 0` has no gutter; one row with nothing above or below
 * it shows nothing and stays one line, as before. A part may be cut again (three problems side
 * by side). `scale`: `inkScale` of the board's zoom, for the reach's floor.
 */
export function splitAtGutters(groups: InkStroke[][], medianH: number, scale = 1): InkStroke[][] {
  const all = groups.flat();
  const split = (line: InkStroke[]): InkStroke[][] => {
    const cut = gutterCut(line, all, medianH, scale);
    return cut ? [...split(cut[0]), ...split(cut[1])] : [line];
  };
  return groups.flatMap(split);
}

let idCounter = 0;
export function newLineId(): string {
  idCounter = (idCounter + 1) % 0xffff;
  const rand = Math.floor(Math.random() * 0xffffffff);
  const hex = ((rand ^ (idCounter << 16)) >>> 0).toString(16).padStart(8, "0");
  return `ln_${hex}`;
}

/** Two boxes on one row: they overlap vertically by at least half the shorter one's height. */
function sameRowRect(a: Rect, b: Rect): boolean {
  return overlap1d(a.y, a.y + a.h, b.y, b.y + b.h) >= 0.5 * Math.max(1, Math.min(a.h, b.h));
}

/**
 * How far right a column reaches for the line `b` written under it: the right end of the column's
 * last row above `b` (its lowest line above `b` and the lines level with that one), not of the
 * widest line it has ever had. With the union, one wide line — a first line written across the
 * screen — made the column claim that width for good, and the first line of a problem started
 * beside its later, narrower lines was pulled into it as the next step. A line level with `b` is
 * beside it, not above it (`x = 2` and `x = 3` written apart on one row both go under the row
 * above them). With nothing of the column above `b`, the union, as before.
 */
function columnRight(members: readonly Rect[], b: Rect): number {
  const cy = b.y + b.h / 2;
  const above = members.filter((m) => !sameRowRect(m, b) && m.y + m.h / 2 < cy);
  const from = above.length > 0 ? above : members;
  let last = from[0];
  for (const m of from) if (m.y + m.h > last.y + last.h) last = m;
  let right = -Infinity;
  for (const m of from) if (above.length === 0 || m === last || sameRowRect(m, last)) right = Math.max(right, m.x + m.w);
  return right;
}

/**
 * What `assignColumns` knows besides the lines (the loop's: `LiveLoop.columnOptions`). Without it a
 * gap is judged by the lines alone, as a pure clustering of ink does.
 */
export interface ColumnOptions {
  /**
   * What is not blank between a column and `line` under it, though it is no line (page coordinates):
   * the tutor's writing there — its steps, answers and readbacks, written before `line` — and the
   * student's drawings. A gap the tutor's working fills is the same problem going on under it.
   */
  filled?: (line: InkLine) => readonly Rect[];
  /**
   * `line` and `other` are one problem whatever the gap between them: they were one before (a gap
   * that opened since — a line between them rubbed out, the tutor's working there rubbed out — does
   * not part them), or the problem they are under says so (one of the chat's).
   */
  together?: (line: InkLine, other: InkLine) => boolean;
}

interface ColumnBuild {
  x0: number;
  y0: number;
  bottom: number;
  rows: number;
  members: Rect[];
  lines: InkLine[];
  heights: number[];
}

/**
 * The gap between the column `col` and `line` under it is a new problem's (`problemGapFactor`): a
 * blank stretch at least that many of the column's lines tall — what the tutor wrote there before
 * the line, or a drawing there, is not blank (`ColumnOptions.filled`) — between two lines that were
 * never one problem (`ColumnOptions.together`). With another problem's line between them, the line
 * is under that one, not this.
 */
function gapEndsColumn(
  line: InkLine,
  col: ColumnBuild,
  colIdx: number,
  right: number,
  placed: ReadonlyArray<{ rect: Rect; col: number }>,
  opts: ColumnOptions,
): boolean {
  const top = line.bounds.y;
  const limit = CLUSTER_RULES.problemGapFactor * median(col.heights);
  if (top - col.bottom < limit) return false;
  const lx0 = line.bounds.x;
  const lx1 = line.bounds.x + line.bounds.w;
  const between = placed.some(({ rect: r, col: c }) => {
    if (c === colIdx || r.y < col.bottom || r.y + r.h > top) return false;
    return overlap1d(r.x, r.x + r.w, lx0, lx1) >= CLUSTER_RULES.columnOverlapRatio * Math.max(1, Math.min(r.w, lx1 - lx0));
  });
  if (between) return true;
  if (opts.together && col.lines.some((other) => opts.together?.(line, other))) return false;
  const x0 = Math.min(col.x0, lx0);
  const x1 = Math.max(right, lx1);
  const ink: Array<[number, number]> = [];
  for (const r of opts.filled?.(line) ?? []) {
    if (r.y + r.h <= col.bottom || r.y >= top || overlap1d(r.x, r.x + r.w, x0, x1) <= 0) continue;
    ink.push([r.y, r.y + r.h]);
  }
  const clear = widestClear(col.bottom, top, ink);
  return clear !== null && clear[1] - clear[0] >= limit;
}

/**
 * Assigns `column`/`row` to lines sorted top-to-bottom; mutates and returns `lines`. A line joins
 * the column whose span it overlaps most (at least `columnOverlapRatio` of the narrower): from the
 * column's left edge — steps start at its margin or indented from it — to the right end of its last
 * row above the line (`columnRight`) — unless a new problem's blank gap lies between them
 * (`gapEndsColumn`). A column is one problem: Help and Solve act on one, a step is judged against
 * the line above it in its column, and Auto does what it does once per state of one.
 */
export function assignColumns(lines: InkLine[], opts: ColumnOptions = {}): InkLine[] {
  const sorted = [...lines].sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x);
  const columns: ColumnBuild[] = [];
  const placed: Array<{ rect: Rect; col: number }> = [];
  for (const line of sorted) {
    const x0 = line.bounds.x;
    const x1 = line.bounds.x + line.bounds.w;
    let best = -1;
    let bestOverlap = 0;
    columns.forEach((col, idx) => {
      const right = columnRight(col.members, line.bounds);
      const ov = overlap1d(x0, x1, col.x0, right);
      const smaller = Math.max(1, Math.min(x1 - x0, right - col.x0));
      const ratio = ov / smaller;
      if (ratio < CLUSTER_RULES.columnOverlapRatio || ratio <= bestOverlap) return;
      if (gapEndsColumn(line, col, idx, right, placed, opts)) return;
      best = idx;
      bestOverlap = ratio;
    });
    const lineBottom = line.bounds.y + line.bounds.h;
    if (best === -1) {
      columns.push({ x0, y0: line.bounds.y, bottom: lineBottom, rows: 1, members: [line.bounds], lines: [line], heights: [line.bounds.h] });
      line.column = columns.length - 1;
      line.row = 0;
    } else {
      const col = columns[best];
      col.x0 = Math.min(col.x0, x0);
      col.members.push(line.bounds);
      col.lines.push(line);
      col.heights.push(line.bounds.h);
      col.bottom = Math.max(col.bottom, lineBottom);
      line.column = best;
      line.row = col.rows;
      col.rows += 1;
    }
    placed.push({ rect: line.bounds, col: best === -1 ? columns.length - 1 : best });
  }
  // Re-number columns left to right for stable reading order.
  // Columns stacked in the same band read top to bottom.
  const order = columns
    .map((c, i) => ({ i, x0: c.x0, y0: c.y0 }))
    .sort((a, b) => a.x0 - b.x0 || a.y0 - b.y0)
    .map((c) => c.i);
  const remap = new Map(order.map((oldIdx, newIdx) => [oldIdx, newIdx]));
  for (const line of sorted) line.column = remap.get(line.column) ?? line.column;
  return sorted;
}

/**
 * Clusters ink into lines. `previous` lets ids persist: a new cluster reuses the id of
 * the previous line sharing >= 50 % of its stroke ids (most-overlapping first).
 * `hash` is left as the previous line's hash when the stroke set is identical, else "".
 * `fixed`: groups of strokes that are one line each whatever the clusterer would make of them —
 * a division bar and the divisor under it (`diagrams.ts`, `DivisionBar`) — given ids and
 * columns with the rest. `opts.zoom`: the board's fit zoom (`inkScale`); none is a desktop.
 * `opts.columns`: what the columns know besides the lines (`ColumnOptions`).
 */
export function clusterLines(
  strokes: InkStroke[],
  previous: InkLine[] = [],
  fixed: ReadonlyArray<readonly InkStroke[]> = [],
  opts: { zoom?: number; columns?: ColumnOptions } = {},
): InkLine[] {
  const medianH = medianStrokeHeight(strokes);
  // two problems' rows cut apart first: an operation row joins pieces under ONE line above them
  const rows = splitAtGutters(clusterStrokeGroups(strokes).map((idxs) => idxs.map((i) => strokes[i])), medianH, inkScale(opts.zoom));
  const clustered = mergeOperationRows(rows, medianH);
  const groups = [...clustered, ...fixed.filter((g) => g.length > 0)];
  const usedIds = new Set<string>();
  const lines: InkLine[] = groups.map((members) => {
    const strokeIds = members.map((s) => s.id);
    return {
      id: "",
      strokeIds,
      bounds: unionRects(members.map((s) => s.bounds)),
      column: 0,
      row: 0,
      hash: "",
    };
  });

  // Greedy id reuse: best overlap first.
  const candidates: Array<{ line: InkLine; prev: InkLine; ratio: number }> = [];
  for (const line of lines) {
    const set = new Set<string>(line.strokeIds);
    for (const prev of previous) {
      let shared = 0;
      for (const id of prev.strokeIds) if (set.has(id)) shared++;
      const ratio = shared / Math.max(1, line.strokeIds.length);
      if (ratio >= CLUSTER_RULES.idReuseRatio) candidates.push({ line, prev, ratio });
    }
  }
  candidates.sort((a, b) => b.ratio - a.ratio);
  for (const c of candidates) {
    if (c.line.id || usedIds.has(c.prev.id)) continue;
    c.line.id = c.prev.id;
    usedIds.add(c.prev.id);
    const same =
      c.prev.strokeIds.length === c.line.strokeIds.length &&
      c.prev.strokeIds.every((id) => c.line.strokeIds.includes(id));
    if (same) c.line.hash = c.prev.hash;
  }
  for (const line of lines) {
    if (!line.id) {
      let id = newLineId();
      while (usedIds.has(id)) id = newLineId();
      line.id = id;
      usedIds.add(id);
    }
  }
  return assignColumns(lines, opts.columns);
}

/** Minimal view of a `math` shape needed to rebuild lines on load. */
export interface EchoShapeSeed {
  shapeId: TLShapeId;
  lineId: string;
  anchorIds: string[];
  latex: string;
}

export interface RebuiltLine {
  line: InkLine;
  latex: string;
  mathShapeId: TLShapeId;
}

/**
 * Seeds lines from existing echo shapes' `anchorIds`/`lineId` so a reload never
 * re-recognizes. Anchors that no longer exist are dropped; echoes without any
 * surviving anchor are skipped (the loop deletes them when their line is gone).
 * A stroke belongs to one line: an echo on ink an earlier echo already holds (a second
 * readback of the same line, left by an Undo before Live adopted it) is skipped too.
 * `columns`: what the columns know besides the lines (`assignColumns`).
 */
export function rebuildFromMathShapes(
  echoes: EchoShapeSeed[],
  strokeBounds: Map<string, Rect>,
  columns: ColumnOptions = {},
): RebuiltLine[] {
  const out: RebuiltLine[] = [];
  const seen = new Set<string>();
  const claimed = new Set<string>();
  for (const echo of echoes) {
    if (!echo.lineId || seen.has(echo.lineId)) continue;
    const alive = echo.anchorIds.filter((id) => strokeBounds.has(id));
    if (alive.length === 0 || alive.some((id) => claimed.has(id))) continue;
    seen.add(echo.lineId);
    for (const id of alive) claimed.add(id);
    const rects = alive.map((id) => strokeBounds.get(id) as Rect);
    out.push({
      line: {
        id: echo.lineId,
        strokeIds: alive as TLShapeId[],
        bounds: unionRects(rects),
        column: 0,
        row: 0,
        hash: "",
      },
      latex: echo.latex,
      mathShapeId: echo.shapeId,
    });
  }
  assignColumns(out.map((r) => r.line), columns);
  return out;
}
