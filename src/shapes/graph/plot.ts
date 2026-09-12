/**
 * Pure SVG plotting for the `graph` shape. No DOM, no React, no tldraw: the same function
 * feeds `component()` and `toSvg()` so exports match the canvas exactly.
 */
import type { GraphPoint } from "@/lib/live/contracts";

export type Sampler = (x: number) => number;

export interface PlotFnInput {
  id: string;
  /** null while the engine has not compiled the expression yet (axes-only render) */
  sampler: Sampler | null;
  color: string;
}

export interface PlotInput {
  fns: PlotFnInput[];
  points: GraphPoint[];
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  autoY: boolean;
  grid: boolean;
  w: number;
  h: number;
  /** samples per function across [xMin, xMax]; default 240 */
  samples?: number;
}

export interface PlotPath {
  id: string;
  color: string;
  /** SVG path data; one `M` sub-path per continuous run */
  d: string;
  /** number of continuous runs (asymptote breaks + 1) */
  segments: number;
}

export interface PlotPoint {
  cx: number;
  cy: number;
  x: number;
  y: number;
  label: string;
}

export interface PlotOutput {
  paths: PlotPath[];
  ticks: { x: number[]; y: number[] };
  /** svg coordinate of the x = 0 / y = 0 axis line, or null when off-screen */
  axes: { x0: number | null; y0: number | null };
  xRange: [number, number];
  yRange: [number, number];
  /** svg line coords for grid lines (only when `grid`) */
  gridLines: Array<{ x1: number; y1: number; x2: number; y2: number }>;
  tickLabels: Array<{ x: number; y: number; text: string; axis: "x" | "y" }>;
  points: PlotPoint[];
  w: number;
  h: number;
}

/** Factor of the y-range above which a jump between neighbouring samples is an asymptote. */
export const BREAK_FACTOR = 8;
export const DEFAULT_SAMPLES = 240;
/** inner padding so strokes on the edge are not clipped */
const PAD = 4;

export function niceStep(rawStep: number): number {
  if (!(rawStep > 0) || !Number.isFinite(rawStep)) return 1;
  const exp = Math.floor(Math.log10(rawStep));
  const base = Math.pow(10, exp);
  const frac = rawStep / base;
  let nice: number;
  if (frac <= 1) nice = 1;
  else if (frac <= 2) nice = 2;
  else if (frac <= 5) nice = 5;
  else nice = 10;
  return nice * base;
}

/**
 * Ticks at multiples of a 1/2/5·10^n step covering [min, max] with roughly `target` ticks.
 */
export function niceTicks(min: number, max: number, target = 6): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (max < min) [min, max] = [max, min];
  const range = max - min;
  if (range === 0) return [min];
  const step = niceStep(range / Math.max(1, target));
  const first = Math.ceil(min / step - 1e-9) * step;
  const out: number[] = [];
  for (let v = first; v <= max + step * 1e-9 && out.length < 200; v += step) {
    // avoid -0 and float noise
    const r = Math.round(v / step) * step;
    out.push(Math.abs(r) < step * 1e-9 ? 0 : Number(r.toPrecision(12)));
  }
  return out;
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const t = idx - lo;
  return sorted[lo] * (1 - t) + sorted[hi] * t;
}

/**
 * Padded 5th–95th percentile range of the finite samples (and points). Falls back to
 * `[fallbackMin, fallbackMax]` when there is nothing finite to look at.
 */
export function autoYRange(
  values: number[],
  fallbackMin: number,
  fallbackMax: number,
): [number, number] {
  const finite = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (finite.length === 0) return normalizeRange(fallbackMin, fallbackMax);
  let lo = percentile(finite, 0.05);
  let hi = percentile(finite, 0.95);
  if (hi - lo < 1e-9) {
    // flat function: show it with some air around
    const c = lo;
    const pad = Math.max(1, Math.abs(c) * 0.5);
    lo = c - pad;
    hi = c + pad;
  } else {
    const pad = (hi - lo) * 0.1;
    lo -= pad;
    hi += pad;
  }
  // always include the x-axis when it is close
  if (lo > 0 && lo < (hi - lo) * 0.5) lo = 0;
  if (hi < 0 && -hi < (hi - lo) * 0.5) hi = 0;
  return [lo, hi];
}

function normalizeRange(min: number, max: number): [number, number] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [-10, 10];
  if (max < min) return [max, min];
  if (max === min) return [min - 1, max + 1];
  return [min, max];
}

function fmtTick(v: number): string {
  if (Math.abs(v) >= 1e6 || (Math.abs(v) < 1e-4 && v !== 0)) return v.toExponential(1);
  const s = Number(v.toPrecision(6)).toString();
  return s;
}

export function buildPlot(input: PlotInput): PlotOutput {
  const w = Math.max(1, input.w);
  const h = Math.max(1, input.h);
  const samples = Math.max(8, Math.floor(input.samples ?? DEFAULT_SAMPLES));
  const [xMin, xMax] = normalizeRange(input.xMin, input.xMax);

  // 1. sample every function
  const xs: number[] = new Array(samples + 1);
  for (let i = 0; i <= samples; i++) xs[i] = xMin + ((xMax - xMin) * i) / samples;
  const sampled = input.fns.map((fn) => {
    if (!fn.sampler) return null;
    const ys = new Array<number>(samples + 1);
    for (let i = 0; i <= samples; i++) {
      let y: number;
      try {
        y = fn.sampler(xs[i]);
      } catch {
        y = NaN;
      }
      ys[i] = typeof y === "number" ? y : NaN;
    }
    return ys;
  });

  // 2. y range
  let yRange: [number, number];
  if (input.autoY) {
    const all: number[] = [];
    for (const ys of sampled) if (ys) for (const y of ys) if (Number.isFinite(y)) all.push(y);
    for (const p of input.points) if (Number.isFinite(p.y)) all.push(p.y);
    yRange = autoYRange(all, input.yMin, input.yMax);
  } else {
    yRange = normalizeRange(input.yMin, input.yMax);
  }
  const [yMin, yMax] = yRange;
  const ySpan = yMax - yMin;
  const xSpan = xMax - xMin;

  const sx = (x: number) => PAD + ((x - xMin) / xSpan) * (w - PAD * 2);
  const sy = (y: number) => h - PAD - ((y - yMin) / ySpan) * (h - PAD * 2);
  const clampY = (y: number) => Math.min(yMax + ySpan, Math.max(yMin - ySpan, y));

  // 3. paths with asymptote breaks
  const paths: PlotPath[] = [];
  input.fns.forEach((fn, fi) => {
    const ys = sampled[fi];
    if (!ys) return;
    let d = "";
    let segments = 0;
    let open = false;
    let prevY = NaN;
    for (let i = 0; i <= samples; i++) {
      const y = ys[i];
      const finite = Number.isFinite(y);
      const jump = open && finite && Math.abs(y - prevY) > BREAK_FACTOR * ySpan;
      // both sides far outside the view in opposite directions -> asymptote too
      if (!finite || jump) {
        open = false;
        prevY = NaN;
        if (!finite) continue;
      }
      const px = sx(xs[i]);
      const py = sy(clampY(y));
      if (!open) {
        d += `M${round(px)} ${round(py)}`;
        segments++;
        open = true;
      } else {
        d += `L${round(px)} ${round(py)}`;
      }
      prevY = y;
    }
    if (segments > 0) paths.push({ id: fn.id, color: fn.color, d, segments });
  });

  // 4. ticks, grid, axes
  const xTicks = niceTicks(xMin, xMax, Math.max(3, Math.round(w / 50)));
  const yTicks = niceTicks(yMin, yMax, Math.max(3, Math.round(h / 40)));
  const gridLines: PlotOutput["gridLines"] = [];
  if (input.grid) {
    for (const t of xTicks) gridLines.push({ x1: sx(t), y1: PAD, x2: sx(t), y2: h - PAD });
    for (const t of yTicks) gridLines.push({ x1: PAD, y1: sy(t), x2: w - PAD, y2: sy(t) });
  }
  const x0 = xMin <= 0 && xMax >= 0 ? sx(0) : null;
  const y0 = yMin <= 0 && yMax >= 0 ? sy(0) : null;

  const labelX = x0 ?? (xMin > 0 ? PAD : w - PAD);
  const labelY = y0 ?? (yMin > 0 ? h - PAD : PAD);
  const tickLabels: PlotOutput["tickLabels"] = [];
  for (const t of xTicks) {
    if (t === 0 && x0 !== null && y0 !== null) continue;
    tickLabels.push({ x: sx(t), y: Math.min(h - 2, labelY + 11), text: fmtTick(t), axis: "x" });
  }
  for (const t of yTicks) {
    if (t === 0 && x0 !== null && y0 !== null) continue;
    tickLabels.push({ x: Math.max(2, labelX + 3), y: sy(t) - 2, text: fmtTick(t), axis: "y" });
  }

  const points: PlotPoint[] = input.points
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    .map((p) => ({ cx: sx(p.x), cy: sy(clampY(p.y)), x: p.x, y: p.y, label: p.label }));

  return {
    paths,
    ticks: { x: xTicks, y: yTicks },
    axes: { x0, y0 },
    xRange: [xMin, xMax],
    yRange,
    gridLines,
    tickLabels,
    points,
    w,
    h,
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
