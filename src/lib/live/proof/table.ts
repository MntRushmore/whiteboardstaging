/**
 * The rules of a proof's T-table. A student often draws the two columns of a proof as a "T": a level
 * rule under `Statements | Reasons`, an upright one between the columns. Left in the ink, the upright
 * rule overlaps every row — `clusterLines` joins them all into one line — and `splitInk` takes the pair
 * for axes and every row near them for a label. `tableRules` finds those rules so `splitInk` can set
 * them aside (role `table`: neither writing nor a drawing). Pure.
 *
 * A table rule is a long straight upright stroke that
 *  - has its TOP end on a long level stroke that runs on both sides of it (a T; the inverted T of a
 *    figure's altitude has its bottom end there), with a row under the bar (writing on the left
 *    level with writing on the right) or the header over it on both sides; or
 *  - has writing on both sides in at least two rows level with each other (a divider with no bar).
 * Then every long level or upright stroke meeting a table rule is one too (the bar, row lines, a frame).
 * A line of maths never has such a stroke: a fraction bar is level and short of the rows, a radical,
 * an integral sign or a bracket has writing on one side of it, not rows on both.
 */
import type { InkStroke } from "../contracts";

export const TABLE_RULES = {
  /** an upright rule is at least this many glyphs (G) long; a level one this many */
  minUpright: 5,
  minLevel: 5,
  /** straight: no point further than max(this × G, `bendShare` × length) from the chord */
  bendFactor: 0.6,
  bendShare: 0.07,
  /** degrees from vertical / horizontal */
  uprightDeg: 20,
  levelDeg: 12,
  /** writing beside the rule is within this many glyphs of it */
  besideFactor: 16,
  /** the top of the T: the upright's end within this many glyphs of the bar, the bar running on this far past it */
  junctionFactor: 1,
  armFactor: 2,
  /** row bands: glyph centres more than this many G apart vertically are different rows */
  bandGapFactor: 1.3,
  /** a stroke is a glyph when it is under this many G across */
  glyphFactor: 3.5,
} as const;

interface Rule {
  s: InkStroke;
  a: { x: number; y: number };
  b: { x: number; y: number };
  len: number;
  upright: boolean;
  level: boolean;
}

function ruleOf(s: InkStroke, G: number): Rule | null {
  const pts = s.segments.flat();
  if (pts.length < 2) return null;
  // a straight stroke: its ends, and every point near the chord between them
  let a = pts[0];
  let b = pts[pts.length - 1];
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < Math.min(TABLE_RULES.minUpright, TABLE_RULES.minLevel) * G) return null;
  const tol = Math.max(TABLE_RULES.bendFactor * G, TABLE_RULES.bendShare * len);
  for (const p of pts) {
    const d = Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / len;
    if (d > tol) return null;
  }
  const deg = (Math.atan2(Math.abs(b.y - a.y), Math.abs(b.x - a.x)) * 180) / Math.PI;
  const upright = deg >= 90 - TABLE_RULES.uprightDeg && len >= TABLE_RULES.minUpright * G;
  const level = deg <= TABLE_RULES.levelDeg && len >= TABLE_RULES.minLevel * G;
  if (!upright && !level) return null;
  // top end first for an upright rule, left end first for a level one
  if ((upright && a.y > b.y) || (level && a.x > b.x)) [a, b] = [b, a];
  return { s, a, b, len, upright, level };
}

/** Distance from p to segment ab. */
function toSegment(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Row bands (vertical centres grouped) of these glyphs. */
function bands(ys: number[], G: number): number[] {
  const sorted = [...ys].sort((p, q) => p - q);
  const out: number[][] = [];
  for (const y of sorted) {
    const last = out[out.length - 1];
    if (last && y - last[last.length - 1] <= TABLE_RULES.bandGapFactor * G) last.push(y);
    else out.push([y]);
  }
  return out.map((b) => b.reduce((s, y) => s + y, 0) / b.length);
}

/** Do two stroke paths meet (cross, or an end within `reach` of the other)? */
function meets(r: Rule, q: Rule, reach: number): boolean {
  if (toSegment(r.a, q.a, q.b) <= reach || toSegment(r.b, q.a, q.b) <= reach) return true;
  if (toSegment(q.a, r.a, r.b) <= reach || toSegment(q.b, r.a, r.b) <= reach) return true;
  const cross = (o: { x: number; y: number }, p: { x: number; y: number }, s: { x: number; y: number }) => (p.x - o.x) * (s.y - o.y) - (p.y - o.y) * (s.x - o.x);
  const d1 = cross(q.a, q.b, r.a);
  const d2 = cross(q.a, q.b, r.b);
  const d3 = cross(r.a, r.b, q.a);
  const d4 = cross(r.a, r.b, q.b);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** The ids of the strokes that are a proof table's rules (see the file comment). */
export function tableRules(strokes: readonly InkStroke[], G: number): Set<string> {
  const rules = strokes.map((s) => ruleOf(s, G)).filter((r): r is Rule => r !== null);
  const out = new Set<string>();
  if (!rules.some((r) => r.upright)) return out;
  const glyphs = strokes.filter((s) => Math.max(s.bounds.w, s.bounds.h) < TABLE_RULES.glyphFactor * G);
  const beside = TABLE_RULES.besideFactor * G;
  const levels = rules.filter((r) => r.level);

  for (const u of rules.filter((r) => r.upright)) {
    const x = (u.a.x + u.b.x) / 2;
    const y0 = u.a.y;
    const y1 = u.b.y;
    const cx = (s: InkStroke) => s.bounds.x + s.bounds.w / 2;
    const cy = (s: InkStroke) => s.bounds.y + s.bounds.h / 2;
    const inSpan = (s: InkStroke) => cy(s) >= y0 && cy(s) <= y1;
    // the rule's x level with a glyph: a slanted rule (a figure's side) is not at its middle x there
    const xAt = (y: number) => (y1 > y0 ? u.a.x + ((u.b.x - u.a.x) * (y - y0)) / (y1 - y0) : x);
    const left = glyphs.filter((s) => inSpan(s) && s.bounds.x + s.bounds.w < xAt(cy(s)) && xAt(cy(s)) - cx(s) <= beside);
    const right = glyphs.filter((s) => inSpan(s) && s.bounds.x > xAt(cy(s)) && cx(s) - xAt(cy(s)) <= beside);
    // the top of a T: a level bar through (or just over) the upright's top end, running on both sides
    const bar = levels.find((l) => {
      if (toSegment(u.a, l.a, l.b) > TABLE_RULES.junctionFactor * G) return false;
      return x - l.a.x >= TABLE_RULES.armFactor * G && l.b.x - x >= TABLE_RULES.armFactor * G;
    });
    // rows: writing on the left level with writing on the right (a statement and its reason)
    const rowsOf = (l: InkStroke[], r: InkStroke[]) => {
      const lb = bands(l.map(cy), G);
      const rb = bands(r.map(cy), G);
      return { lb, rb, rows: lb.filter((y) => rb.some((z) => Math.abs(y - z) <= TABLE_RULES.bandGapFactor * G)).length };
    };
    let table = false;
    if (bar) {
      const barY = (bar.a.y + bar.b.y) / 2;
      const header = glyphs.filter((s) => cy(s) < barY && barY - cy(s) <= 3 * G && Math.abs(cx(s) - x) <= beside);
      const headerBoth = header.some((s) => cx(s) < x) && header.some((s) => cx(s) > x);
      // one row under the bar is enough. A figure makes the same T (a quadrilateral's side run on
      // past a corner), but its corner marks and labels sit level with the bar, not rows below it
      const below = (s: InkStroke) => cy(s) > barY + 0.5 * G;
      table = rowsOf(left.filter(below), right.filter(below)).rows >= 1 || headerBoth;
    }
    if (!table) {
      const { lb, rb, rows } = rowsOf(left, right);
      table = lb.length >= 2 && rb.length >= 2 && rows >= 2;
    }
    if (!table) continue;
    out.add(u.s.id);
    if (bar) out.add(bar.s.id);
  }
  if (out.size === 0) return out;
  // the bar, row lines, a frame: long straight strokes meeting a table rule
  for (let changed = true; changed; ) {
    changed = false;
    for (const r of rules) {
      if (out.has(r.s.id)) continue;
      if (rules.some((q) => out.has(q.s.id) && meets(r, q, TABLE_RULES.junctionFactor * G))) {
        out.add(r.s.id);
        changed = true;
      }
    }
  }
  return out;
}
