import type { TLShapeId } from "tldraw";
import type { InkStroke, Rect } from "./contracts";
import { median, unionRects } from "./strokeClusters";

/**
 * Stacked (column) sums in the ink. Pure: no editor, no DOM.
 *
 *        ¹
 *       286
 *     + 680
 *     -----
 *       966
 *
 * Numbers right-aligned in rows, the operator at the left of the last of them, a rule, and the
 * answer row under it (empty, filled in from the right, or complete). Grouped as ordinary lines,
 * the rule was a fraction bar: it joined `+680` above it and `966` under it (`strokeClusters.ts`
 * joins everything a bar covers within 1.5 glyphs), Mathpix read `\frac{+680}{966}`, and Solve
 * wrote `= 0.7039` under the student's right sum. The `286` was a line of its own, and the carry
 * over its `2` was read with it (`\frac{1}{286}`) or alone (`7`).
 *
 * `findStackedSums` finds the layout BEFORE lines are formed (`splitInk` sets each one aside, as it
 * does a division bar under an equation) and the whole block becomes ONE line, read with one call:
 * Mathpix reads a stacked sum as `\begin{array}{r} 286 \\ +680 \\ \hline 966 \end{array}` at
 * confidence ~1, where row by row it read `+680` as prose (`\text { +680 }`, 0.84). The carry and
 * borrow marks — small digits over a column (or under it, just over the rule), a small `1` raised
 * beside a digit, a straight stroke crossing a digit out — are set aside too: read with the block,
 * a crossed-out `5` came back `8` and a carry as a row of its own. `engine/columnArithmetic.ts`
 * works the read.
 *
 * What is one: a level RULE (straight, in one stroke or two end to end, not a bar of an `=`) with
 * at least two ROWS of writing over it — each a single row of glyphs (no fraction bar in it, no
 * `=`), right-aligned with the others, mostly over the rule, the lowest just over it, each apart
 * from the row under it (a clear gap, at most about a row) and over its columns, the row not going
 * on past the block — with nothing level with the rule beside it and no drawn line meeting it.
 * Under the rule, the answer row, if any; and any more rows and rules right under that,
 * right-aligned with the block (long multiplication's partial products), which the read then does
 * not parse as one sum, so the tutor stays quiet.
 *
 * What is not, and stays as it was: a fraction (one row over its bar), `x = \frac{a+b}{2}` and a
 * mixed number (writing beside the bar), `\frac{x^{5}}{x^{2}}` (the `5` touches the `x` beside it:
 * no row over a row), a fraction under another one (its numerator would be the "top row", but there
 * is a bar over it), equations added for elimination (`=` in the rows), a triangle's labelled base
 * (its sides meet the "rule"), a line of working over an underline that is wider than it. The
 * drawings and figures scoreboards (`src/__eval__`) hold every line and figure there to that. The
 * thresholds are in digit heights (`dH`, the block's own, from glyph-sized strokes), so a phone's
 * ink, five times bigger in page px, is judged the same.
 */

export const STACK_RULES = {
  /** a rule is at least this many glyphs (G) long, flat (`isRule`) and straight */
  ruleMinFactor: 1.2,
  /** the lowest row's bottom is at most this many digit heights over the rule; the answer's top as far under it */
  firstGapFactor: 1.3,
  /** rows are at most this many digit heights apart (blank between them), and at least this many */
  rowGapFactor: 1.3,
  rowApartFactor: 0.08,
  /** a row is one row of glyphs: at most this many digit heights tall, and this many wide */
  rowMaxHeightFactor: 1.75,
  rowMaxWidthFactor: 12,
  /** each row is at least this share over the rule (the operator may stick out on the left) */
  ruleCoverShare: 0.55,
  /** the rows' right edges are within this many digit heights of each other (a decimal place's slack) */
  alignFactor: 1.2,
  /** writing level with the rule within this many digit heights beside it: a fraction in a line */
  besideFactor: 1.5,
  /** a row going on past the block: more of it within this many digit heights */
  extendFactor: 1.5,
  /** a carry or borrow digit is under this share of the digit height */
  markShare: 0.62,
  /** ...and bigger than a decimal point (this share both ways) */
  dotShare: 0.3,
} as const;

/** One row of a stacked sum: its box and its glyphs (strokes overlapping in x are one glyph, the two of a `+`). */
export interface StackRow {
  rect: Rect;
  /** the row's glyphs left to right, decimal points left out */
  glyphs: Rect[];
}

export interface StackedSum {
  /** the rule under the numbers */
  rule: TLShapeId;
  /** what is read, as one line: the rows, the rule, the answer row and anything under it */
  strokeIds: TLShapeId[];
  /** carry and borrow marks: read with nothing, part of no line */
  marks: TLShapeId[];
  /** the carries' boxes (not the strokes crossing a digit out): a carry the student wrote is not written again */
  markRects: Rect[];
  /** the numbers' rows, top to bottom */
  rows: StackRow[];
  /** the row under the rule, or null while nothing is written there */
  answer: StackRow | null;
  /** rows or rules under the answer (long multiplication): the read will not be one sum */
  more: boolean;
  ruleRect: Rect;
  /** the height of a digit in this block (page px) */
  digit: number;
}

const cy = (r: Rect) => r.y + r.h / 2;
const right = (r: Rect) => r.x + r.w;
const bottom = (r: Rect) => r.y + r.h;
const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
const xGap = (a: Rect, b: Rect) => Math.max(0, Math.max(a.x - right(b), b.x - right(a)));

/** Level, long for its height: a rule, a fraction bar, a minus sign. */
function isFlat(r: Rect, dH: number): boolean {
  return r.w > 3 * r.h && r.h < Math.max(0.3 * dH, 0.12 * r.w);
}

/** The largest distance of a stroke's points from the line through its ends, as a share of that line. */
function bend(s: InkStroke): number {
  const pts = s.segments.flat();
  if (pts.length < 2) return 0;
  const a = pts[0];
  const b = pts[pts.length - 1];
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len === 0) return Infinity;
  let worst = 0;
  for (const p of pts) worst = Math.max(worst, Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / len);
  return worst / len;
}

/** The strokes whose boxes meet a box (x0, y0, x1, y1). */
type Near = (x0: number, y0: number, x1: number, y1: number) => InkStroke[];

/**
 * `Near` over these strokes: sorted by top once and searched by halves, so each rule looks only at
 * the ink around it (a 3,000-stroke screen is many rules and fraction bars). The few strokes taller
 * than `cap` are always looked at.
 */
function nearIndex(strokes: readonly InkStroke[], cap: number): Near {
  const tall = strokes.filter((s) => s.bounds.h > cap);
  const rest = strokes.filter((s) => s.bounds.h <= cap).sort((a, b) => a.bounds.y - b.bounds.y);
  const tops = rest.map((s) => s.bounds.y);
  const meets = (s: InkStroke, x0: number, y0: number, x1: number, y1: number) => s.bounds.x <= x1 && right(s.bounds) >= x0 && s.bounds.y <= y1 && bottom(s.bounds) >= y0;
  return (x0, y0, x1, y1) => {
    let lo = 0;
    let hi = tops.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (tops[m] < y0 - cap) lo = m + 1;
      else hi = m;
    }
    const out = tall.filter((s) => meets(s, x0, y0, x1, y1));
    for (let k = lo; k < rest.length && tops[k] <= y1; k++) if (meets(rest[k], x0, y0, x1, y1)) out.push(rest[k]);
    return out;
  };
}

/** Long, level and straight — and not one bar of an `=` (a level twin just over or under it). */
function isRule(s: InkStroke, near: Near, G: number, minFactor: number = STACK_RULES.ruleMinFactor): boolean {
  if (!(s.bounds.w >= minFactor * G && isFlat(s.bounds, G) && bend(s) < 0.12)) return false;
  const r = s.bounds;
  return !near(r.x, cy(r) - G, right(r), cy(r) + G).some((o) => {
    if (o === s || !isFlat(o.bounds, G) || o.bounds.w < 0.4 * r.w || o.bounds.w > 2.5 * r.w) return false;
    const gap = Math.abs(cy(o.bounds) - cy(r));
    return overlap(o.bounds.x, right(o.bounds), r.x, right(r)) >= 0.5 * Math.min(o.bounds.w, r.w) && gap >= 0.08 * G && gap <= 0.9 * G;
  });
}

/**
 * Strokes in rows, top to bottom: a stroke is in the row so far when half of it (or of the row) is
 * level with it. The two loops of an `8` are one row; a carry over a row, or a row touching the next,
 * is not.
 */
function bands(strokes: readonly InkStroke[]): InkStroke[][] {
  const out: InkStroke[][] = [];
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of [...strokes].sort((a, b) => cy(a.bounds) - cy(b.bounds))) {
    const level = overlap(s.bounds.y, bottom(s.bounds), lo, hi);
    if (out.length > 0 && level > 0 && level >= 0.5 * Math.min(s.bounds.h, hi - lo)) {
      out[out.length - 1].push(s);
      lo = Math.min(lo, s.bounds.y);
      hi = Math.max(hi, bottom(s.bounds));
    } else {
      out.push([s]);
      lo = s.bounds.y;
      hi = bottom(s.bounds);
    }
  }
  return out;
}

/** An `=` in a row: two level bars of about one length, one close over the other. */
function holdsEquals(strokes: readonly InkStroke[], dH: number): boolean {
  const bars = strokes.map((s) => s.bounds).filter((r) => r.w >= 0.25 * dH && isFlat(r, dH));
  return bars.some((a, i) =>
    bars.slice(i + 1).some((b) => {
      const ratio = a.w / b.w;
      const gap = Math.abs(cy(a) - cy(b));
      return ratio > 0.4 && ratio < 2.5 && overlap(a.x, right(a), b.x, right(b)) >= 0.5 * Math.min(a.w, b.w) && gap >= 0.08 * dH && gap <= 0.9 * dH;
    }),
  );
}

/** A row's strokes as glyphs, left to right: strokes overlapping in x are one (the two of a `+`, of an `8`). */
function glyphGroups(strokes: readonly InkStroke[]): Array<{ rect: Rect; strokes: InkStroke[] }> {
  const groups: Array<{ rect: Rect; strokes: InkStroke[] }> = [];
  for (const s of [...strokes].sort((a, b) => a.bounds.x - b.bounds.x)) {
    const r = s.bounds;
    const last = groups[groups.length - 1];
    if (last && overlap(last.rect.x, right(last.rect), r.x, right(r)) >= 0.4 * Math.max(1, Math.min(last.rect.w, r.w))) {
      last.rect = unionRects([last.rect, r]);
      last.strokes.push(s);
    } else groups.push({ rect: r, strokes: [s] });
  }
  return groups;
}

const isDot = (r: Rect, dH: number) => r.w < STACK_RULES.dotShare * dH && r.h < STACK_RULES.dotShare * dH;

/** The glyphs of a row, left to right (`StackRow.glyphs`), decimal points left out. */
function glyphsOf(strokes: readonly InkStroke[], dH: number): Rect[] {
  return glyphGroups(strokes)
    .map((g) => g.rect)
    .filter((r) => !isDot(r, dH));
}

/**
 * A straight stroke crossing a curved digit out: it reaches across most of it both ways. A `x` is two
 * straight strokes, a `+` a straight one through another, a `4`'s stem crosses nothing's width: none
 * of them is crossed out.
 */
function crossesOut(s: InkStroke, row: readonly InkStroke[], dH: number): boolean {
  const r = s.bounds;
  const len = Math.hypot(r.w, r.h);
  if (len < 0.7 * dH || r.w < 0.3 * len || r.h < 0.5 * len || bend(s) > 0.12) return false;
  const under = row.filter((o) => o !== s && overlap(o.bounds.x, right(o.bounds), r.x, right(r)) > 0 && overlap(o.bounds.y, bottom(o.bounds), r.y, bottom(r)) > 0);
  if (under.length === 0 || !under.some((o) => bend(o) > 0.2)) return false;
  const g = unionRects(under.map((o) => o.bounds));
  return overlap(g.x, right(g), r.x, right(r)) >= 0.5 * g.w && overlap(g.y, bottom(g), r.y, bottom(r)) >= 0.6 * g.h;
}

/**
 * The marks in a row: small strokes raised over its digits (a carry written close, a borrowed `1`)
 * or sunk under them (a carry written over the rule), and — in the top row — a stroke crossing a
 * digit out. The `+`, `-` and `x` sit level with the digits, a decimal point is smaller than a mark.
 */
function rowMarks(strokes: readonly InkStroke[], dH: number, top: boolean): { small: InkStroke[]; crossed: InkStroke[] } {
  const out = { small: [] as InkStroke[], crossed: [] as InkStroke[] };
  const groups = glyphGroups(strokes);
  const tall = groups.filter((g) => g.rect.h >= STACK_RULES.markShare * dH).map((g) => g.rect);
  if (tall.length === 0) return out;
  const t = median(tall.map((r) => r.y));
  const b = median(tall.map(bottom));
  const h = Math.max(1, b - t);
  const small = (r: Rect) => r.h < STACK_RULES.markShare * dH && !isDot(r, dH) && !isFlat(r, dH);
  for (const g of groups) {
    // a glyph of its own, small, over the digits or under them
    if (small(g.rect) && (cy(g.rect) < t + 0.25 * h || cy(g.rect) > b)) out.small.push(...g.strokes);
    // a small stroke sitting on a digit's top, taller together than a digit (not an `8`'s upper loop)
    else if (g.rect.h > 1.15 * dH) out.small.push(...g.strokes.filter((s) => small(s.bounds) && cy(s.bounds) < t + 0.12 * h));
  }
  if (top) {
    const taken = new Set(out.small);
    out.crossed = strokes.filter((s) => !taken.has(s) && crossesOut(s, strokes, dH));
  }
  return out;
}

interface Built {
  strokes: InkStroke[];
  rect: Rect;
}

/**
 * The stacked sum over this rule, or null (see the module comment). `all`: the ink around it (the
 * rule's width and 8 glyphs either side, 16 above and below); `free`: those no other sum took;
 * `near`: the screen's index; `order`: each stroke's place in writing order.
 */
function stackAt(rule: InkStroke, free: readonly InkStroke[], all: readonly InkStroke[], near: Near, order: ReadonlyMap<InkStroke, number>, G: number): StackedSum | null {
  const R = STACK_RULES;
  // a rule drawn in two goes (the pen lifted halfway): level pieces end to end are one rule
  const pieces = [rule];
  let rb = rule.bounds;
  for (let grew = true; grew; ) {
    grew = false;
    for (const s of free) {
      if (pieces.includes(s) || Math.abs(cy(s.bounds) - cy(rb)) > 0.25 * G || xGap(s.bounds, rb) > 0.8 * G || !isRule(s, near, G, 0.6)) continue;
      pieces.push(s);
      rb = unionRects([rb, s.bounds]);
      grew = true;
    }
  }
  const ry = cy(rb);
  const x0 = rb.x - 3 * G;
  const x1 = right(rb) + 1.5 * G;
  const around = free.filter((s) => !pieces.includes(s) && s.bounds.x <= x1 && right(s.bounds) >= x0 && bottom(s.bounds) >= ry - 14 * G && s.bounds.y <= ry + 14 * G);
  const above = around.filter((s) => cy(s.bounds) < ry);
  if (above.length < 2) return null;
  const upward = bands(above).reverse();
  // a digit's height: the tall end of the glyphs in the two rows nearest the rule (carries and a `+`
  // are smaller; a drawing's lines, a triangle's sides over its base, are no glyphs)
  const glyphSized = (s: InkStroke) => !isFlat(s.bounds, G) && Math.max(s.bounds.w, s.bounds.h) <= 3 * G;
  const heights = upward
    .filter((band) => band.some((s) => glyphSized(s) && s.bounds.h >= 0.3 * G))
    .slice(0, 2)
    .flat()
    .filter(glyphSized)
    .map((s) => s.bounds.h)
    .sort((a, b) => a - b);
  if (heights.length === 0) return null;
  const dH = Math.max(4, heights[Math.min(heights.length - 1, Math.floor(heights.length * 0.8))]);
  // a long line meeting the rule: it is a side of a drawing (a triangle's base), not a sum's rule
  const reach = 0.3 * dH;
  if (around.some((s) => Math.max(s.bounds.w, s.bounds.h) >= 2.5 * dH && xGap(s.bounds, rb) <= reach && Math.max(0, s.bounds.y - bottom(rb), rb.y - bottom(s.bounds)) <= reach)) return null;
  /** a row of writing that is no row of a sum (a bar in it, an `=`, more of it past the block, too big) */
  const notARow = (band: InkStroke[], rect: Rect): boolean => {
    if (rect.h > R.rowMaxHeightFactor * dH || rect.w > R.rowMaxWidthFactor * dH || holdsEquals(band, dH)) return true;
    // a row has a glyph in it, not only bars (the upper bar of an `=` beside a fraction)
    if (!band.some((s) => !isFlat(s.bounds, dH) && s.bounds.h >= 0.5 * dH)) return true;
    if (band.some((s) => isFlat(s.bounds, dH) && s.bounds.w >= 1.2 * dH && s.bounds.w >= 0.6 * rect.w)) return true;
    const mine = new Set(band);
    return all.some((s) => !mine.has(s) && !pieces.includes(s) && cy(s.bounds) >= rect.y && cy(s.bounds) <= bottom(rect) && xGap(s.bounds, rect) <= R.extendFactor * dH && (s.bounds.x > x1 || right(s.bounds) < x0));
  };

  // up from the rule: rows, and bands of small marks between and over them
  const rows: Built[] = [];
  const marks: InkStroke[] = [];
  let floor = rb.y;
  let stop: Built | null = null;
  for (const band of upward) {
    const rect = unionRects(band.map((s) => s.bounds));
    const gap = floor - bottom(rect);
    if (gap > (rows.length === 0 ? R.firstGapFactor : R.rowGapFactor) * dH) {
      stop = { strokes: band, rect };
      break;
    }
    if (band.every((s) => s.bounds.h < R.markShare * dH && !isFlat(s.bounds, dH))) {
      marks.push(...band);
      floor = rect.y;
      continue;
    }
    // ...and sits over the row under it, apart from it and over its columns: a superscript (`x^{5}`
    // over a bar), or the start of a steep line, touches the glyphs beside it, not a row under it
    const under = rows[0]?.rect;
    const apart = !under || (under.y - bottom(rect) >= R.rowApartFactor * dH && overlap(rect.x, right(rect), under.x, right(under)) >= 0.5 * Math.min(rect.w, under.w));
    if (!apart || notARow(band, rect)) {
      stop = { strokes: band, rect };
      break;
    }
    rows.unshift({ strokes: band, rect });
    floor = rect.y;
  }
  if (rows.length < 2) return null;
  // a fraction bar over the top row: that row is a denominator, not a number of a sum
  if (stop && floor - bottom(stop.rect) <= R.rowGapFactor * dH && stop.strokes.some((s) => isFlat(s.bounds, dH) && s.bounds.w >= 0.6 * rows[0].rect.w)) return null;
  const rights = rows.map((r) => right(r.rect));
  const blockRight = median(rights);
  if (Math.max(...rights) - Math.min(...rights) > R.alignFactor * dH) return null;
  if (rows.some((r) => overlap(r.rect.x, right(r.rect), rb.x, right(rb)) < R.ruleCoverShare * r.rect.w)) return null;
  if (right(rb) < blockRight - 0.5 * dH || rb.w > 2.5 * Math.max(...rows.map((r) => r.rect.w)) + 2 * dH) return null;
  // writing level with the rule beside it: a fraction inside a line (`x = \frac{a+b}{2}`, `2\frac{3}{4}`)
  const inRows = new Set(rows.flatMap((r) => r.strokes));
  if (all.some((s) => !pieces.includes(s) && !inRows.has(s) && Math.abs(cy(s.bounds) - ry) <= 0.45 * dH && overlap(s.bounds.x, right(s.bounds), rb.x, right(rb)) === 0 && xGap(s.bounds, rb) <= R.besideFactor * dH)) return null;
  // nothing tall through the rule (a table's or a drawing's line)
  if (around.some((s) => s.bounds.h >= 1.5 * dH && s.bounds.y < rb.y && bottom(s.bounds) > bottom(rb) && overlap(s.bounds.x, right(s.bounds), rb.x, right(rb)) > 0)) return null;

  // down from the rule: the answer row, then whatever is right under it, right-aligned with the block
  const below = around.filter((s) => cy(s.bounds) >= ry);
  const left = Math.min(...rows.map((r) => r.rect.x));
  const spacing = rows.length > 1 ? median(rows.slice(1).map((r, i) => r.rect.y - bottom(rows[i].rect))) : 0;
  let answer: Built | null = null;
  const extra: InkStroke[] = [];
  let ceil = bottom(rb);
  for (const band of bands(below)) {
    const rect = unionRects(band.map((s) => s.bounds));
    if (rect.y - ceil > (answer ? Math.max(spacing, 0.4 * dH) + 0.5 * dH : R.firstGapFactor * dH)) break;
    const aRule = band.length === 1 && isFlat(rect, dH) && rect.w >= 0.6 * (blockRight - left);
    if (!aRule) {
      if (notARow(band, rect) || right(rect) > blockRight + R.alignFactor * dH || rect.x < left - 2 * dH) break;
      if (!answer && overlap(rect.x, right(rect), rb.x, right(rb)) < 0.5 * rect.w) break;
      if (answer && blockRight - right(rect) > 1.6 * dH) break;
    } else if (!answer) break;
    if (!answer) answer = { strokes: band, rect };
    else extra.push(...band);
    ceil = bottom(rect);
  }

  // the marks inside the rows: carries written close, a borrowed 1, a digit crossed out
  const inRow = rows.map((r, i) => rowMarks(r.strokes, dH, i === 0));
  const crossed = inRow.flatMap((m) => m.crossed);
  marks.push(...inRow.flatMap((m) => m.small));
  const toRow = (b: Built, own: ReadonlySet<InkStroke>): { strokes: InkStroke[]; row: StackRow } => {
    const strokes = b.strokes.filter((s) => !own.has(s));
    return { strokes, row: { rect: unionRects(strokes.map((s) => s.bounds)), glyphs: glyphsOf(strokes, dH) } };
  };
  const built = rows.map((r, i) => toRow(r, new Set([...inRow[i].small, ...inRow[i].crossed])));
  const ans = answer ? toRow(answer, new Set()) : null;
  const read = new Set<InkStroke>([...built.flatMap((b) => b.strokes), ...pieces, ...(ans?.strokes ?? []), ...extra]);
  return {
    rule: rule.id,
    strokeIds: [...read].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)).map((s) => s.id),
    marks: [...marks, ...crossed].map((s) => s.id),
    markRects: marks.map((s) => s.bounds),
    rows: built.map((b) => b.row),
    answer: ans?.row ?? null,
    more: extra.length > 0,
    ruleRect: rb,
    digit: dH,
  };
}

/**
 * The stacked sums among these strokes (see the module comment), top to bottom; each stroke in at
 * most one. `G`: the glyph scale (`diagrams.ts`, `glyphScale`), for how long a rule must be.
 */
export function findStackedSums(strokes: readonly InkStroke[], G: number): StackedSum[] {
  // cheap first: long, level and straight (the `=` twin test asks the index)
  const long = strokes.filter((s) => s.bounds.w >= STACK_RULES.ruleMinFactor * G && isFlat(s.bounds, G));
  if (long.length === 0) return [];
  const near = nearIndex(strokes, 6 * G);
  const rules = long.filter((s) => isRule(s, near, G)).sort((a, b) => a.bounds.y - b.bounds.y);
  if (rules.length === 0) return [];
  const order = new Map(strokes.map((s, i) => [s, i]));
  const out: StackedSum[] = [];
  const used = new Set<string>();
  for (const rule of rules) {
    if (used.has(rule.id)) continue;
    const b = rule.bounds;
    const m = b.w + 8 * G;
    const around = near(b.x - m, b.y - 16 * G, right(b) + m, bottom(b) + 16 * G);
    const sum = stackAt(rule, around.filter((s) => !used.has(s.id)), around, near, order, G);
    if (!sum) continue;
    out.push(sum);
    for (const id of [...sum.strokeIds, ...sum.marks]) used.add(id);
  }
  return out;
}

/** Each sum's strokes for `clusterLines`' `fixed` groups: one line each (as `barGroups`). */
export function stackGroups(stacks: readonly StackedSum[], strokes: readonly InkStroke[]): InkStroke[][] {
  const byId = new Map(strokes.map((s) => [s.id as string, s]));
  return stacks.map((s) => s.strokeIds.map((id) => byId.get(id)).filter((st): st is InkStroke => Boolean(st)));
}

/**
 * Where the digits of a stacked sum go: the x of each place's column (place 0 the rightmost), and
 * the writing lines of the answer row, of a carry over the top row, and of a row under the answer.
 */
export interface StackGrid {
  x: (place: number) => number;
  /** between two columns */
  pitch: number;
  digit: number;
  answerBaseline: number;
  carryBaseline: number;
  /** under the student's answer: where a right digit or the right answer is written beside a wrong one */
  fixBaseline: number;
  /** the place of the student's last (rightmost) answer digit as it sits; null with none */
  answerLast: number | null;
  /** the student's answer digit in a place, for a ring round it; null when there is none there */
  answerGlyph: (place: number) => Rect | null;
  /** places the student has written a carry over */
  carried: Set<number>;
}

/**
 * The grid of `sum`'s columns, from its rows' glyphs and what was read in them: `rows[i]` is how many
 * digits row i was read with and the place of its last one (`engine/columnArithmetic.ts`). A row whose
 * glyphs Mathpix read as more digits than the ink has (two digits touching) gives no columns; the
 * pitch then fills them in.
 */
export function stackGrid(sum: StackedSum, rows: ReadonlyArray<{ digits: number; last: number }>): StackGrid {
  const dH = sum.digit;
  const at = new Map<number, number[]>();
  const steps: number[] = [];
  sum.rows.forEach((row, i) => {
    const want = rows[i];
    if (!want || row.glyphs.length < want.digits) return;
    const mine = row.glyphs.slice(row.glyphs.length - want.digits).reverse();
    mine.forEach((g, j) => {
      const c = g.x + g.w / 2;
      at.set(want.last + j, [...(at.get(want.last + j) ?? []), c]);
      if (j > 0) steps.push(mine[j - 1].x + mine[j - 1].w / 2 - c);
    });
  });
  const pitch = steps.length > 0 ? median(steps) : 0.75 * dH;
  const known = [...at.entries()].map(([p, xs]) => [p, xs.reduce((s, v) => s + v, 0) / xs.length] as const);
  const fallback = median(sum.rows.map((r) => right(r.rect))) - pitch / 2;
  const x = (place: number): number => {
    if (known.length === 0) return fallback - place * pitch;
    const [q, xq] = known.reduce((best, k) => (Math.abs(k[0] - place) < Math.abs(best[0] - place) ? k : best));
    return xq - (place - q) * pitch;
  };
  const nearest = (cx: number) => Math.max(0, Math.round((x(0) - cx) / pitch));
  const answer = sum.answer;
  const lastRow = sum.rows[sum.rows.length - 1].rect;
  const over = Math.min(0.6 * dH, Math.max(0.15 * dH, sum.ruleRect.y - bottom(lastRow)));
  const answerBaseline = answer ? bottom(answer.rect) : bottom(sum.ruleRect) + over + dH;
  const glyphs = answer?.glyphs ?? [];
  const top = sum.rows[0].rect;
  return {
    x,
    pitch,
    digit: dH,
    answerBaseline,
    carryBaseline: top.y - 0.12 * dH,
    fixBaseline: answerBaseline + 0.45 * dH + dH,
    answerLast: glyphs.length > 0 ? nearest(glyphs[glyphs.length - 1].x + glyphs[glyphs.length - 1].w / 2) : null,
    answerGlyph: (place) => {
      const g = glyphs.filter((r) => nearest(r.x + r.w / 2) === place);
      return g.length > 0 ? unionRects(g) : null;
    },
    carried: new Set(sum.markRects.filter((r) => cy(r) < cy(top)).map((r) => nearest(r.x + r.w / 2))),
  };
}
