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
 * Lines are then sorted top-to-bottom into columns by x-overlap >= 40 %.
 */

export const CLUSTER_RULES = {
  verticalOverlapRatio: 0.4,
  gapFactor: 1.2,
  /** vertical-overlap joins are capped so side-by-side columns stay separate */
  sameRowMaxGapFactor: 3,
  centerFactor: 0.6,
  barAspect: 3,
  barMaxHeightFactor: 0.25,
  barMinWidthFactor: 1.0,
  barReachFactor: 1.5,
  barCoverRatio: 0.5,
  columnOverlapRatio: 0.4,
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
export function isFractionBar(stroke: InkStroke, strokes: InkStroke[], medianH: number): boolean {
  const { w, h } = stroke.bounds;
  if (!(w > CLUSTER_RULES.barAspect * h)) return false;
  if (!(h < CLUSTER_RULES.barMaxHeightFactor * medianH)) return false;
  if (w < CLUSTER_RULES.barMinWidthFactor * medianH) return false;
  for (const other of strokes) {
    if (other.id === stroke.id) continue;
    const ob = other.bounds;
    const flat = ob.w > CLUSTER_RULES.barAspect * ob.h && ob.h < CLUSTER_RULES.barMaxHeightFactor * medianH;
    if (!flat) continue;
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
 * adjacent. Rects are the inflated ones.
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

/** Groups strokes into clusters (arrays of indexes into `strokes`). */
export function clusterStrokeGroups(strokes: InkStroke[]): number[][] {
  const n = strokes.length;
  if (n === 0) return [];
  const medianH = medianStrokeHeight(strokes);
  const uf = new UnionFind(n);
  const bars = strokes.map((s) => isFractionBar(s, strokes, medianH));
  const by = inflationFor(medianH);
  // Inflated rects for the join tests; bar detection above used the raw bounds.
  const rects = strokes.map((s) => inflateRect(s.bounds, by));
  // Inflation must not make a flat bar "taller" than its neighbours for the superscript
  // test, so that test uses the raw heights.
  const rawH = strokes.map((s) => s.bounds.h);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = rects[i];
      const b = rects[j];
      if (shouldJoin(a, b, medianH)) {
        uf.union(i, j);
        continue;
      }
      if ((bars[i] && barCovers(a, b, medianH)) || (bars[j] && barCovers(b, a, medianH))) {
        uf.union(i, j);
        continue;
      }
      if (
        (rawH[i] >= 1 && isSuperscriptOf(a, b, medianH)) ||
        (rawH[j] >= 1 && isSuperscriptOf(b, a, medianH))
      ) {
        uf.union(i, j);
      }
    }
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = uf.find(i);
    const g = groups.get(root);
    if (g) g.push(i);
    else groups.set(root, [i]);
  }
  return [...groups.values()];
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
  const columns: Array<{ x0: number; x1: number; rows: number }> = [];
  for (const line of sorted) {
    const x0 = line.bounds.x;
    const x1 = line.bounds.x + line.bounds.w;
    let best = -1;
    let bestOverlap = 0;
    columns.forEach((col, idx) => {
      const ov = overlap1d(x0, x1, col.x0, col.x1);
      const smaller = Math.max(1, Math.min(x1 - x0, col.x1 - col.x0));
      const ratio = ov / smaller;
      if (ratio >= CLUSTER_RULES.columnOverlapRatio && ratio > bestOverlap) {
        best = idx;
        bestOverlap = ratio;
      }
    });
    if (best === -1) {
      columns.push({ x0, x1, rows: 1 });
      line.column = columns.length - 1;
      line.row = 0;
    } else {
      const col = columns[best];
      col.x0 = Math.min(col.x0, x0);
      col.x1 = Math.max(col.x1, x1);
      line.column = best;
      line.row = col.rows;
      col.rows += 1;
    }
  }
  // Re-number columns left to right for stable reading order.
  const order = columns
    .map((c, i) => ({ i, x0: c.x0 }))
    .sort((a, b) => a.x0 - b.x0)
    .map((c) => c.i);
  const remap = new Map(order.map((oldIdx, newIdx) => [oldIdx, newIdx]));
  for (const line of sorted) line.column = remap.get(line.column) ?? line.column;
  return sorted;
}

/**
 * Clusters ink into lines. `previous` lets ids persist: a new cluster reuses the id of
 * the previous line sharing >= 50 % of its stroke ids (most-overlapping first).
 * `hash` is left as the previous line's hash when the stroke set is identical, else "".
 */
export function clusterLines(strokes: InkStroke[], previous: InkLine[] = []): InkLine[] {
  const groups = clusterStrokeGroups(strokes);
  const usedIds = new Set<string>();
  const lines: InkLine[] = groups.map((idxs) => {
    const members = idxs.map((i) => strokes[i]);
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
