import type { InkStroke, Rect } from "./contracts";

/**
 * Struck-out rows: a long, straight stroke drawn through the middle of a row of writing — the kid's
 * "not this one" — and the row it goes through, set aside before lines are formed (like a proof
 * table's rules), so it is no line and no bridge between the steps over and under it.
 *
 *     5x - 4 = 21
 *     x̶ ̶=̶ ̶2̶1̶ ̶÷̶ ̶5̶       ← struck: set aside
 *     x = 5
 *
 * Written tight, the three rows touched and were one line: `5x - 4 = 21 x = 5` was ringed. A line
 * whose strike spans it all is also caught later, as a line (`StruckLine.swift`, the iPad's
 * `rw-strike-ok`); this one finds the strike before the lines exist, from the strokes alone.
 *
 * What is one: at least `minFactor` glyphs long, straight (or scribbled back and forth along the row),
 * at most `tiltShare` off level, with
 * `minThrough` curved glyph strokes going through it (well over and under it where they cross). Not
 * one: a fraction bar, a rule, an underline, a separator (nothing goes through them); a number
 * line or an axis (its ticks are straight, not glyphs); an `=` or a minus (short).
 */
export const STRUCK_RULES = {
  minFactor: 2.5,
  tiltShare: 0.35,
  bend: 0.12,
  /** ...and end to end at least this share of its path (as `StruckLine.swift`) */
  straightness: 0.9,
  /** curved glyph strokes through it */
  minThrough: 3,
  /** a stroke goes through when it reaches this share of its height over and under the strike */
  throughShare: 0.15,
  /** a glyph through it is curved (a digit's, a letter's): further than this share of its length from straight */
  glyphBend: 0.15,
  /** a scribble's passes along the row are at least this many glyphs long */
  passFactor: 1.5,
} as const;

const right = (r: Rect) => r.x + r.w;
const bottom = (r: Rect) => r.y + r.h;
const cx = (r: Rect) => r.x + r.w / 2;
const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

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

/**
 * Back and forth along x (a scribble over the row): two passes or more, each at least `passFactor`
 * glyphs along it. A `√`'s one stroke turns too (its hook), but goes along the row once.
 */
function scribbles(s: InkStroke, G: number): boolean {
  const xs = s.segments.flat().map((p) => p.x);
  const passes: number[] = [];
  let dir = 0;
  let start = xs[0];
  let last = xs[0];
  for (const x of xs) {
    const d = x - last;
    if (Math.abs(d) < 0.25 * G) continue;
    const now = Math.sign(d);
    if (dir !== 0 && now !== dir) {
      passes.push(Math.abs(last - start));
      start = last;
    }
    dir = now;
    last = x;
  }
  passes.push(Math.abs(last - start));
  return passes.filter((p) => p >= STRUCK_RULES.passFactor * G).length >= 2;
}

/** End to end over the path's length (1: a straight line; a `√`'s hook and overline are well under it). */
function straightness(s: InkStroke): number {
  const pts = s.segments.flat();
  let len = 0;
  for (let k = 1; k < pts.length; k++) len += Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y);
  if (len === 0) return 0;
  return Math.hypot(pts[pts.length - 1].x - pts[0].x, pts[pts.length - 1].y - pts[0].y) / len;
}

/** The strike's height at `x`: the line through its ends, or a scribble's middle. */
function yAt(s: InkStroke, x: number, scribble: boolean): number {
  if (scribble) return s.bounds.y + s.bounds.h / 2;
  const pts = s.segments.flat();
  const a = pts[0];
  const b = pts[pts.length - 1];
  if (b.x === a.x) return (a.y + b.y) / 2;
  return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
}

/**
 * The ids of the strokes of struck-out rows: each strike and the row it goes through. `strokes`: the
 * writing (what a strike goes through); `candidates`: what may be a strike (default the writing — a
 * straight strike is often taken for a drawing's line first).
 */
export function struckRows(strokes: readonly InkStroke[], G: number, candidates: readonly InkStroke[] = strokes): Set<string> {
  const R = STRUCK_RULES;
  const out = new Set<string>();
  for (const s of candidates) {
    const r = s.bounds;
    if (out.has(s.id as string) || r.w < R.minFactor * G || r.h > R.tiltShare * r.w) continue;
    const straight = bend(s) <= R.bend && straightness(s) >= R.straightness;
    const scribble = !straight && scribbles(s, G);
    if (!straight && !scribble) continue;
    const through = strokes.filter((o) => {
      if (o === s) return false;
      const b = o.bounds;
      if (b.h < 0.4 * G || Math.max(b.w, b.h) > 3 * G || cx(b) < r.x || cx(b) > right(r)) return false;
      const y = yAt(s, cx(b), scribble);
      return b.y <= y - R.throughShare * b.h && bottom(b) >= y + R.throughShare * b.h && bend(o) > R.glyphBend;
    });
    if (through.length < R.minThrough) continue;
    // the row: what it goes through, and what sits level with that within the strike's span (an
    // `=`'s bars, a second strike)
    const top = Math.min(...through.map((o) => o.bounds.y));
    const low = Math.max(...through.map((o) => bottom(o.bounds)));
    const row = strokes.filter((o) => {
      const b = o.bounds;
      const inRow = b.y + b.h / 2 > top && b.y + b.h / 2 < low && overlap(b.y, bottom(b), top, low) >= 0.6 * b.h;
      return o === s || through.includes(o) || (inRow && b.x >= r.x - 0.5 * G && right(b) <= right(r) + 0.5 * G);
    });
    for (const o of row) out.add(o.id as string);
  }
  return out;
}
