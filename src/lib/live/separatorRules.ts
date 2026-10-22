import type { InkStroke, Rect } from "./contracts";

/**
 * Separator rules: the line a child draws right across her work under a step, before the next one.
 *
 *      -5   -5
 *     ─────────────      ← a separator: no fraction bar
 *      3x = 15
 *     ─────────────
 *       x = 5
 *
 * Taken as fraction bars, they joined the steps over and under them into one line (`strokeClusters`
 * joins everything a bar covers): a kid's three right steps were read as
 * `\frac{\frac{-5}{3x-15}}{x=5}` and got nothing — no tick on `x = 5`. Set aside (like a proof
 * table's rules), the steps are lines again.
 *
 * What is one: a long (`minFactor` glyphs), level, straight stroke with the next step under it — an
 * `=` inside the row right under it, under the rule's own span. A denominator has no `=` in it; nor
 * has the divisor under a bar drawn under a whole equation (`3x = 15` over `3   3`: divide both
 * sides, a fraction bar); an `=` beside a fraction (`x = \frac{25}{5}`) sits off the bar's span. A
 * rule with nothing under it yet is left as it was (an underline), until the next step is written.
 * And it stands alone: an arrow's shaft (its head at the end), a number line (its ticks through it)
 * or a figure's side (others meeting it) over an equation is a drawing's.
 */
export const SEPARATOR_RULES = {
  /** at least this many glyphs (G) long */
  minFactor: 3,
  /** level: at most this share of its length tall, and straight */
  flatShare: 0.12,
  bend: 0.1,
  /** the row next to it starts within this many glyphs of it */
  reachFactor: 3.5,
  /** the row: the strokes that start within this many glyphs of its first, and what starts inside their height */
  rowFactor: 1.2,
  /** an `=`: two level bars about one length, this far apart at most (in glyphs) */
  equalsGapFactor: 1.3,
} as const;

const right = (r: Rect) => r.x + r.w;
const bottom = (r: Rect) => r.y + r.h;
const cy = (r: Rect) => r.y + r.h / 2;
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

const level = (r: Rect, G: number) => r.w >= 0.25 * G && r.w > 3 * r.h && r.h < 0.3 * G;

/** An `=` among these strokes, over the span x0..x1: two level bars of about one length, one over the other. */
function holdsEquals(strokes: readonly InkStroke[], x0: number, x1: number, G: number): boolean {
  const bars = strokes.map((s) => s.bounds).filter((r) => level(r, G) && overlap(r.x, right(r), x0, x1) >= 0.5 * r.w);
  return bars.some((a, i) =>
    bars.slice(i + 1).some((b) => {
      const ratio = a.w / b.w;
      const gap = Math.abs(cy(a) - cy(b));
      return ratio > 0.4 && ratio < 2.5 && overlap(a.x, right(a), b.x, right(b)) >= 0.5 * Math.min(a.w, b.w) && gap >= 0.08 * G && gap <= SEPARATOR_RULES.equalsGapFactor * G;
    }),
  );
}

/** The ids of the strokes that are separator rules (see the file comment). */
export function separatorRules(strokes: readonly InkStroke[], G: number): Set<string> {
  const R = SEPARATOR_RULES;
  const out = new Set<string>();
  for (const s of strokes) {
    const r = s.bounds;
    if (r.w < R.minFactor * G || r.h > R.flatShare * r.w || bend(s) > R.bend) continue;
    const ry = cy(r);
    // it stands alone: nothing level with it or crossing it (an arrow's head at its end, a number
    // line's ticks, a figure's side meeting it — a drawing's line, not a line under a step)
    const touch = 0.1 * G;
    if (strokes.some((o) => o !== s && o.bounds.y <= bottom(r) + touch && bottom(o.bounds) >= r.y - touch && o.bounds.x <= right(r) + 0.5 * G && right(o.bounds) >= r.x - 0.5 * G)) continue;
    const over = (o: InkStroke) => o !== s && overlap(o.bounds.x, right(o.bounds), r.x, right(r)) > 0;
    // the row right under it: the first writing under it, and what starts near it
    const below = strokes.filter((o) => over(o) && o.bounds.y >= ry && o.bounds.y - ry <= R.reachFactor * G);
    const first = Math.min(...below.map((o) => o.bounds.y));
    const starters = below.filter((o) => o.bounds.y <= first + R.rowFactor * G);
    const end = Math.max(...starters.map((o) => bottom(o.bounds)));
    const rowBelow = below.filter((o) => o.bounds.y < end);
    if (holdsEquals(rowBelow, r.x, right(r), G)) out.add(s.id as string);
  }
  return out;
}
