import type { NumberLineIntent, PlaneGraphIntent } from "../contracts";

/**
 * The window of a hand-drawn graph: which part of the plane the sketch shows, and where the
 * ticks go. Pure numbers; `plan.ts` turns them into strokes.
 *
 * What a teacher does, as rules:
 *  - every key point is in view (intercepts, the vertex, where lines cross, a circle whole, an
 *    asymptote with a stretch of each branch beside it), and so is the origin — school graphs
 *    are drawn through their axes;
 *  - never a tiny window: at least `MIN_SPAN` units across, with a margin round the key points;
 *  - the same unit on both axes when the two spans are comparable, so a slope of 2 LOOKS like 2
 *    and a circle is round; otherwise each axis gets its own scale (a parabola that climbs to 30
 *    over x ∈ [-5, 5] is not drawn 6 boxes tall);
 *  - tick spacing 1, 2 or 5 × 10ⁿ, about `TICK_TARGET` ticks across.
 */

export const WINDOW = {
  /** the narrowest window, in units */
  minSpan: 6,
  /** margin round the key points, as a fraction of their span */
  pad: 0.14,
  /** lines and circles: equal units when the two axes' scales differ by less than this factor */
  equalRatio: 3.5,
  /** any other curve: equal units only when the scales are already this close */
  curveEqualRatio: 1.35,
  /** ticks across one axis */
  tickTarget: 8,
  /** at least this many units of a curve's branch either side of a vertical asymptote */
  besideAsymptote: 2.5,
} as const;

export interface GraphWindow {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  xStep: number;
  yStep: number;
  /** the plot box in px; (xMin, yMax) is its top-left corner */
  w: number;
  h: number;
  /** true when one unit is the same length on both axes */
  equal: boolean;
}

/** px of a data point (y down), in the plot box's own coordinates. */
export function toPx(win: GraphWindow, x: number, y: number): { x: number; y: number } {
  return {
    x: ((x - win.xMin) / (win.xMax - win.xMin)) * win.w,
    y: ((win.yMax - y) / (win.yMax - win.yMin)) * win.h,
  };
}

/** Data point of a px position in the plot box. */
export function fromPx(win: GraphWindow, px: number, py: number): { x: number; y: number } {
  return {
    x: win.xMin + (px / win.w) * (win.xMax - win.xMin),
    y: win.yMax - (py / win.h) * (win.yMax - win.yMin),
  };
}

/** The 1-2-5 step that puts closest to `target` ticks across `span` (ties go to the larger step). */
export function niceStepFor(span: number, target: number = WINDOW.tickTarget): number {
  if (!(span > 0) || !Number.isFinite(span)) return 1;
  const raw = span / Math.max(1, target);
  const exp = Math.floor(Math.log10(raw));
  let best = 1;
  let bestErr = Infinity;
  for (const e of [exp - 1, exp, exp + 1]) {
    for (const m of [1, 2, 5]) {
      const step = m * 10 ** e;
      const err = Math.abs(Math.log(span / step / target));
      if (err < bestErr - 1e-9 || (Math.abs(err - bestErr) <= 1e-9 && step > best)) {
        best = step;
        bestErr = err;
      }
    }
  }
  return Number(best.toPrecision(12));
}

/** Multiples of `step` inside [lo, hi]. */
export function ticksIn(lo: number, hi: number, step: number): number[] {
  const out: number[] = [];
  const first = Math.ceil(lo / step - 1e-9);
  for (let k = first; k * step <= hi + 1e-9 * step && out.length < 200; k++) {
    const v = Number((k * step).toPrecision(12));
    out.push(Object.is(v, -0) ? 0 : v);
  }
  return out;
}

function percentile(sorted: number[], p: number): number {
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

const sane = (v: number) => Number.isFinite(v) && Math.abs(v) < 1e6;

/** `f` as y = mx + b when it is a straight line, else null. */
export function lineOf(f: (x: number) => number): { m: number; b: number } | null {
  const b = f(0);
  const m = f(1) - b;
  if (!Number.isFinite(b) || !Number.isFinite(m)) return null;
  for (const x of [2.7, -1.9, 6.3]) {
    const v = f(x);
    if (!Number.isFinite(v) || Math.abs(v - (b + m * x)) > 1e-9 * (1 + Math.abs(v))) return null;
  }
  return { m, b };
}

/**
 * A window someone asked for (the board chat's "graph y = sin x from -2π to 2π"): x across exactly
 * that range, y as asked or fitted to the curves over it. Optional everywhere; the sketches the
 * board draws unasked choose their own window.
 */
export interface GraphWindowHint {
  xMin: number;
  xMax: number;
  yMin?: number;
  yMax?: number;
}

/**
 * The window for an asked-for range. x is the range (and the origin, as every school graph is
 * drawn through its axes), a sliver wider so the ends are not under the arrowheads; y is the range
 * asked for, else where the key points and the curves go across that x (their middle 90 %), with
 * the usual margin. Lines and circles keep the same unit both ways when y can grow to it.
 */
function hintedWindow(intent: PlaneGraphIntent, box: { w: number; h: number }, hint: GraphWindowHint): GraphWindow {
  let xLo = Math.min(hint.xMin, 0);
  let xHi = Math.max(hint.xMax, 0);
  const xPad = 0.04 * (xHi - xLo);
  xLo -= xPad;
  xHi += xPad;
  let yLo: number;
  let yHi: number;
  if (hint.yMin !== undefined && hint.yMax !== undefined && hint.yMax > hint.yMin) {
    yLo = Math.min(hint.yMin, 0);
    yHi = Math.max(hint.yMax, 0);
  } else {
    const ys = [0];
    for (const p of intent.points) if (sane(p.y) && p.x >= hint.xMin && p.x <= hint.xMax) ys.push(p.y);
    for (const c of intent.curves) if (c.kind === "circle") ys.push(c.cy - c.r, c.cy + c.r);
    const poles = intent.asymptotes.filter((a) => a.axis === "vertical").map((a) => a.at);
    const values: number[] = [];
    for (const c of intent.curves) {
      if (c.kind !== "function") continue;
      for (let i = 0; i <= 200; i++) {
        const x = hint.xMin + ((hint.xMax - hint.xMin) * (i + 0.5)) / 201;
        if (poles.some((p) => Math.abs(x - p) < (hint.xMax - hint.xMin) * 0.03)) continue;
        const v = c.f(x);
        if (sane(v)) values.push(v);
      }
    }
    if (values.length > 0) {
      values.sort((a, b) => a - b);
      ys.push(percentile(values, 0.05), percentile(values, 0.95));
    }
    yLo = hint.yMin ?? Math.min(...ys);
    yHi = hint.yMax ?? Math.max(...ys);
    const minY = Math.min(WINDOW.minSpan, xHi - xLo) * (box.h / box.w);
    if (yHi - yLo < minY) {
      const c = (yLo + yHi) / 2;
      if (hint.yMin === undefined) yLo = Math.min(yLo, c - minY / 2);
      if (hint.yMax === undefined) yHi = Math.max(yHi, c + minY / 2);
    }
    const yPad = WINDOW.pad * (yHi - yLo);
    if (hint.yMin === undefined) yLo -= yPad;
    if (hint.yMax === undefined) yHi += yPad;
  }
  const straight = intent.curves.every((c) => c.kind === "circle" || lineOf(c.f) !== null);
  const u = box.w / (xHi - xLo);
  if (straight && hint.yMin === undefined && hint.yMax === undefined && box.h / u >= yHi - yLo) {
    // same unit both ways: y grows evenly round its middle to the height the box gives it
    const grow = box.h / u - (yHi - yLo);
    yLo -= grow / 2;
    yHi += grow / 2;
    const step = niceStepFor(Math.max(xHi - xLo, yHi - yLo));
    return { xMin: xLo, xMax: xHi, yMin: yLo, yMax: yHi, xStep: step, yStep: step, w: box.w, h: box.h, equal: true };
  }
  return {
    xMin: xLo,
    xMax: xHi,
    yMin: yLo,
    yMax: yHi,
    xStep: niceStepFor(xHi - xLo),
    yStep: niceStepFor(yHi - yLo, Math.round(WINDOW.tickTarget * (box.h / box.w))),
    w: box.w,
    h: box.h,
    equal: false,
  };
}

/** The window for a plane graph drawn in a box of `box.w` × `box.h` px (or across a range asked for). */
export function chooseWindow(intent: PlaneGraphIntent, box: { w: number; h: number }, hint?: GraphWindowHint): GraphWindow {
  if (hint && Number.isFinite(hint.xMin) && Number.isFinite(hint.xMax) && hint.xMax > hint.xMin) return hintedWindow(intent, box, hint);
  const xs = [0];
  const ys = [0];
  for (const p of intent.points) {
    if (sane(p.x) && sane(p.y)) {
      xs.push(p.x);
      ys.push(p.y);
    }
  }
  for (const a of intent.asymptotes) if (sane(a.at)) (a.axis === "vertical" ? xs : ys).push(a.at);
  for (const c of intent.curves) {
    if (c.kind !== "circle") continue;
    xs.push(c.cx - c.r, c.cx + c.r);
    ys.push(c.cy - c.r, c.cy + c.r);
  }

  // A line is pinned down by its intercepts (and must keep equal units, or its slope lies): they
  // set the window even when they are not labelled (a system labels only its crossing).
  for (const c of intent.curves) {
    if (c.kind !== "function") continue;
    const line = lineOf(c.f);
    if (!line) continue;
    if (sane(line.b)) ys.push(line.b);
    if (Math.abs(line.m) > 1e-12 && sane(-line.b / line.m)) xs.push(-line.b / line.m);
  }

  // a vertical asymptote with room on each side the curve is defined on: every branch is part of
  // the picture, not a sliver in a corner (a parent's hidden one only breaks its curve)
  const span0 = Math.max(...xs) - Math.min(...xs);
  for (const a of intent.asymptotes) {
    if (a.axis !== "vertical" || a.hidden || !sane(a.at)) continue;
    const d = Math.max(WINDOW.besideAsymptote, 0.3 * span0);
    for (const s of [-1, 1]) {
      if (intent.curves.some((c) => c.kind === "function" && Number.isFinite(c.f(a.at + s * d * 0.6)))) xs.push(a.at + s * d);
    }
  }

  let xLo = Math.min(...xs);
  let xHi = Math.max(...xs);
  if (xHi - xLo < WINDOW.minSpan) {
    const c = (xLo + xHi) / 2;
    xLo = Math.min(xLo, c - WINDOW.minSpan / 2);
    xHi = Math.max(xHi, c + WINDOW.minSpan / 2);
  }
  const xPad = WINDOW.pad * (xHi - xLo);
  xLo -= xPad;
  xHi += xPad;

  // Where the other curves go across that x-range (their middle 80 %: an asymptote's spike is not
  // the picture), but only so far past the key points — a cubic's arms leave the box, they do not
  // flatten its turning points into the axis.
  const keyLo = Math.min(...ys);
  const keyHi = Math.max(...ys);
  const reach = Math.max(1.5 * (keyHi - keyLo), 4);
  const values: number[] = [];
  const poles = intent.asymptotes.filter((a) => a.axis === "vertical").map((a) => a.at);
  for (const c of intent.curves) {
    if (c.kind !== "function" || lineOf(c.f)) continue;
    for (let i = 0; i <= 160; i++) {
      const x = xLo + ((xHi - xLo) * (i + 0.5)) / 161;
      if (poles.some((p) => Math.abs(x - p) < (xHi - xLo) * 0.04)) continue;
      const v = c.f(x);
      if (sane(v)) values.push(v);
    }
  }
  if (values.length > 0) {
    values.sort((a, b) => a - b);
    ys.push(Math.max(keyLo - reach, percentile(values, 0.1)), Math.min(keyHi + reach, percentile(values, 0.9)));
  }
  let yLo = Math.min(...ys);
  let yHi = Math.max(...ys);
  const minY = WINDOW.minSpan * (box.h / box.w);
  if (yHi - yLo < minY) {
    const c = (yLo + yHi) / 2;
    yLo = Math.min(yLo, c - minY / 2);
    yHi = Math.max(yHi, c + minY / 2);
  }
  const yPad = WINDOW.pad * (yHi - yLo);
  yLo -= yPad;
  yHi += yPad;

  const ux = box.w / (xHi - xLo);
  const uy = box.h / (yHi - yLo);
  const ratio = ux / uy;
  // Lines and circles need the same unit both ways (a slope, a round circle); a curve only when
  // the two scales are close anyway — a parabola squeezed to equal units is a needle.
  const straight = intent.curves.every((c) => c.kind === "circle" || lineOf(c.f) !== null);
  const limit = straight ? WINDOW.equalRatio : WINDOW.curveEqualRatio;
  if (ratio <= limit && ratio >= 1 / limit) {
    // the same unit both ways: the tighter axis sets it, the other grows (evenly) to fill the box
    const u = Math.min(ux, uy);
    const growX = box.w / u - (xHi - xLo);
    const growY = box.h / u - (yHi - yLo);
    xLo -= growX / 2;
    xHi += growX / 2;
    yLo -= growY / 2;
    yHi += growY / 2;
    const step = niceStepFor(Math.max(xHi - xLo, yHi - yLo));
    return { xMin: xLo, xMax: xHi, yMin: yLo, yMax: yHi, xStep: step, yStep: step, w: box.w, h: box.h, equal: true };
  }
  return {
    xMin: xLo,
    xMax: xHi,
    yMin: yLo,
    yMax: yHi,
    xStep: niceStepFor(xHi - xLo),
    yStep: niceStepFor(yHi - yLo, Math.round(WINDOW.tickTarget * (box.h / box.w))),
    w: box.w,
    h: box.h,
    equal: false,
  };
}

export interface NumberLineWindow {
  /** the first and last tick */
  lo: number;
  hi: number;
  step: number;
}

/** A number line round the answer's critical values: a couple of ticks either side, 0 when it is close. */
export function numberLineWindow(intent: NumberLineIntent): NumberLineWindow {
  const values = intent.marks.map((m) => m.at).filter(sane);
  const lo0 = values.length ? Math.min(...values) : 0;
  const hi0 = values.length ? Math.max(...values) : 0;
  const step = niceStepFor(Math.max(hi0 - lo0, 6), 7);
  const pad = (hi0 - lo0) / step >= 4 ? 2 : 3;
  let lo = (Math.floor(lo0 / step + 1e-9) - pad) * step;
  let hi = (Math.ceil(hi0 / step - 1e-9) + pad) * step;
  // the origin, when it is only a tick or two away
  if (lo > 0 && lo <= 2 * step) lo = 0;
  if (hi < 0 && hi >= -2 * step) hi = 0;
  lo = Number(lo.toPrecision(12));
  hi = Number(hi.toPrecision(12));
  return { lo, hi, step };
}
