import { ticksIn } from "../../graphing/window";

/**
 * Numbers on a chart as a teacher writes them, and the value axis they sit on.
 */

/** A number as the hand writes it on a chart: `12`, `3.5`, `-0.25`, `12,500`, `2.4M`. */
export function formatNumber(v: number): string {
  if (!Number.isFinite(v)) return "";
  const a = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (a >= 1e9) return `${sign}${trim(a / 1e9)}B`;
  if (a >= 1e6) return `${sign}${trim(a / 1e6)}M`;
  if (a >= 1e4) return `${sign}${Math.round(a).toLocaleString("en-US")}`;
  return `${sign}${trim(a)}`;
}

/** At most two decimals (three for small numbers), no trailing zeros, no float noise. */
function trim(a: number): string {
  const d = a < 1 ? 3 : 2;
  return String(Number(a.toFixed(d)));
}

/** Currency symbols are written before the number, `%` and degrees right after it, words after a space. */
export function unitPlacement(unit: string | undefined): "prefix" | "suffix" | "word" | null {
  if (!unit) return null;
  if (/^[$£€]$/.test(unit)) return "prefix";
  if (/^(%|°.*|‰)$/.test(unit)) return "suffix";
  return "word";
}

/** A value with its unit: `$12`, `45%`, `21°C`, `12 kg`. */
export function formatValue(v: number, unit?: string): string {
  const n = formatNumber(v);
  switch (unitPlacement(unit)) {
    case "prefix":
      return v < 0 ? `-${unit}${n.slice(1)}` : `${unit}${n}`;
    case "suffix":
      return `${n}${unit}`;
    case "word":
      return `${n} ${unit}`;
    default:
      return n;
  }
}

/**
 * The smallest 1-2-5 step that splits [lo, hi] into at most `most` intervals once both ends are
 * rounded out to it: a chart's axis reads at a glance with 4–6 numbers, not 11.
 */
export function niceStepAtMost(lo: number, hi: number, most: number): number {
  const span = hi - lo;
  if (!(span > 0) || !Number.isFinite(span)) return 1;
  const exp = Math.floor(Math.log10(span / Math.max(1, most))) - 1;
  for (let e = exp; e <= exp + 3; e++) {
    for (const m of [1, 2, 2.5, 5]) {
      const step = Number((m * 10 ** e).toPrecision(12));
      // 2.5 only where it stays a whole number (25, 250): 0.25 and 2.5 are hard to count in
      if (m === 2.5 && step < 25) continue;
      const n = Math.round((Math.ceil(hi / step - 1e-9) - Math.floor(lo / step + 1e-9)));
      if (n <= most) return step;
    }
  }
  return Number((10 ** (exp + 4)).toPrecision(12));
}

export interface ValueScale {
  lo: number;
  hi: number;
  step: number;
  ticks: number[];
}

/**
 * The value axis for data from `min` to `max`: nice 1-2-5 steps, about `target` of them, the
 * ends on a tick. `withZero` puts 0 on it (a bar's baseline); a scatter's axes need not.
 */
export function valueScale(min: number, max: number, target: number, withZero: boolean): ValueScale {
  let lo = withZero ? Math.min(0, min) : min;
  let hi = withZero ? Math.max(0, max) : max;
  if (!(hi > lo)) {
    // all the same value: a span round it (from 0 when it is a bar's height)
    const m = Math.abs(hi) || 1;
    if (withZero) {
      if (hi > 0) hi = hi + m * 0.25;
      else if (lo < 0) lo = lo - m * 0.25;
      else hi = 1;
    } else {
      lo -= m * 0.5;
      hi += m * 0.5;
    }
  }
  const step = niceStepAtMost(lo, hi, Math.max(2, target));
  const lo2 = Number((Math.floor(lo / step + 1e-9) * step).toPrecision(12));
  const hi2 = Number((Math.ceil(hi / step - 1e-9) * step).toPrecision(12));
  return { lo: lo2, hi: hi2 > lo2 ? hi2 : lo2 + step, step, ticks: ticksIn(lo2, hi2 > lo2 ? hi2 : lo2 + step, step) };
}

/**
 * A scatter's axis: from the data's own range (with a margin), and from 0 when the data starts
 * close enough to it that leaving it out would mislead.
 */
export function dataScale(values: readonly number[], target: number): ValueScale {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const withZero = (min >= 0 && min <= 0.35 * max) || (max <= 0 && max >= 0.35 * min);
  const pad = (max - min) * 0.04;
  return valueScale(min - (withZero ? 0 : pad), max + pad, target, withZero);
}

/**
 * Tops a bar chart's axis may have — 1, 2, 2.5, 3, 4, 5, 6, 8 × 10ⁿ, each with its step. No 1.2 or
 * 1.5: a live chart is planned again from scratch as each number is said, and a top of 15 over a
 * first value of 12 would move at the next (12, 15, 16 all land under 20).
 */
const TOPS: ReadonlyArray<[number, number]> = [
  [1, 0.2],
  [2, 0.5],
  [2.5, 0.5],
  [3, 0.5],
  [4, 1],
  [5, 1],
  [6, 1],
  [8, 2],
];

/** The smallest top on the ladder at or above `v` (> 0), with its step. */
function topAbove(v: number): { top: number; step: number } {
  const e = Math.floor(Math.log10(v));
  for (const ex of [e - 1, e, e + 1]) {
    for (const [m, st] of TOPS) {
      const top = Number((m * 10 ** ex).toPrecision(12));
      if (top >= v - 1e-12) return { top, step: Number((st * 10 ** ex).toPrecision(12)) };
    }
  }
  return { top: 10 ** (e + 1), step: 2 * 10 ** e };
}

/**
 * A bar chart's value axis, with room to grow: its top (and its bottom, below 0) at least
 * `headroom` × the largest value said, on a ladder of round numbers. A live chart is planned again
 * as each number is said; the next number, when it is not much bigger, lands under the same top
 * and nothing already drawn moves. 0 is always on it (a bar stands on it).
 */
export function barScale(min: number, max: number, headroom = 1.25): ValueScale {
  const up = max > 0 ? topAbove(max * headroom) : null;
  const down = min < 0 ? topAbove(-min * headroom) : null;
  if (!up && !down) return { lo: 0, hi: 1, step: 0.25, ticks: [0, 0.25, 0.5, 0.75, 1] };
  // one step for both sides: the larger side's
  const step = Math.max(up?.step ?? 0, down?.step ?? 0);
  const hi = up ? Number((Math.ceil(up.top / step - 1e-9) * step).toPrecision(12)) : 0;
  const lo = down ? -Number((Math.ceil(down.top / step - 1e-9) * step).toPrecision(12)) : 0;
  return { lo, hi, step, ticks: ticksIn(lo, hi, step) };
}
