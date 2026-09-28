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
 * Lines are then sorted top-to-bottom into columns by x-overlap >= 40 %, and a line
 * separated from the column above it by a wide blank gap starts a column of its own.
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
   * A blank gap taller than max(columnBreakMinPx, columnBreakFactor x the taller of the two
   * lines) between a line and the bottom of the column above it ends that column: a problem
   * written further down is a new problem, not the next step of the one above.
   */
  columnBreakFactor: 3,
  columnBreakMinPx: 120,
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
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
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

let idCounter = 0;
export function newLineId(): string {
  idCounter = (idCounter + 1) % 0xffff;
  const rand = Math.floor(Math.random() * 0xffffffff);
  const hex = ((rand ^ (idCounter << 16)) >>> 0).toString(16).padStart(8, "0");
  return `ln_${hex}`;
}

/** Assigns `column`/`row` to lines sorted top-to-bottom; mutates and returns `lines`. */
export function assignColumns(lines: InkLine[]): InkLine[] {
  const sorted = [...lines].sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x);
  const columns: Array<{ x0: number; x1: number; rows: number; bottom: number; lastH: number; y0: number }> = [];
  for (const line of sorted) {
    const x0 = line.bounds.x;
    const x1 = line.bounds.x + line.bounds.w;
    let best = -1;
    let bestOverlap = 0;
    columns.forEach((col, idx) => {
      const gap = line.bounds.y - col.bottom;
      const breakAt = Math.max(
        CLUSTER_RULES.columnBreakMinPx,
        CLUSTER_RULES.columnBreakFactor * Math.max(line.bounds.h, col.lastH),
      );
      if (gap > breakAt) return;
      const ov = overlap1d(x0, x1, col.x0, col.x1);
      const smaller = Math.max(1, Math.min(x1 - x0, col.x1 - col.x0));
      const ratio = ov / smaller;
      if (ratio >= CLUSTER_RULES.columnOverlapRatio && ratio > bestOverlap) {
        best = idx;
        bestOverlap = ratio;
      }
    });
    const lineBottom = line.bounds.y + line.bounds.h;
    if (best === -1) {
      columns.push({ x0, x1, rows: 1, bottom: lineBottom, lastH: line.bounds.h, y0: line.bounds.y });
      line.column = columns.length - 1;
      line.row = 0;
    } else {
      const col = columns[best];
      col.x0 = Math.min(col.x0, x0);
      col.x1 = Math.max(col.x1, x1);
      col.bottom = Math.max(col.bottom, lineBottom);
      col.lastH = line.bounds.h;
      line.column = best;
      line.row = col.rows;
      col.rows += 1;
    }
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
 * columns with the rest.
 */
export function clusterLines(strokes: InkStroke[], previous: InkLine[] = [], fixed: ReadonlyArray<readonly InkStroke[]> = []): InkLine[] {
  const clustered = mergeOperationRows(clusterStrokeGroups(strokes).map((idxs) => idxs.map((i) => strokes[i])), medianStrokeHeight(strokes));
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
  return assignColumns(lines);
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
 */
export function rebuildFromMathShapes(
  echoes: EchoShapeSeed[],
  strokeBounds: Map<string, Rect>,
): RebuiltLine[] {
  const out: RebuiltLine[] = [];
  const seen = new Set<string>();
  for (const echo of echoes) {
    if (!echo.lineId || seen.has(echo.lineId)) continue;
    const alive = echo.anchorIds.filter((id) => strokeBounds.has(id));
    if (alive.length === 0) continue;
    seen.add(echo.lineId);
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
  assignColumns(out.map((r) => r.line));
  return out;
}
