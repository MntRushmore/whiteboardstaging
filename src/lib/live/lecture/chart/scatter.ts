import { clipSegment } from "../../graphing/pen";
import type { ChartSpec } from "../contracts";
import { fitWords, measureWords, type WordsLayout } from "../words";
import { dataScale, formatNumber, type ValueScale } from "./axes";
import { INK, LECTURE_PACE, LECTURE_TEXT, Sketch, TITLE_GAP, fitTitle, innerBox, inside, seriesInk, type LectureSketch } from "./sketch";

/**
 * A scatter plot as a teacher sketches one: two axes meeting at the bottom left (from 0 when the
 * data starts near it, else from a round number just under the data), a few round numbers along
 * each, a dot per point, and — when asked — the least-squares line through them, dashed, across
 * the plot. What x is goes under its numbers; what y is goes above its axis. The dots are in the
 * data's colour; the rest is the tutor's. Parts: "axis:x", "axis:y", "ticks:x", "ticks:y",
 * "tick:x:<v>", "tick:y:<v>", "caption:x", "caption:y", "point:<i>", "trend".
 */

export type ScatterChart = Extract<ChartSpec, { kind: "scatter" }>;

export const SCATTER = {
  levels: [1, 0.92, 0.85, 0.78],
  tickLen: 6,
  tickGap: 6,
  rowGap: 8,
  /** px per tick, roughly, on each axis */
  tickPx: { x: 70, y: 46 },
  minPlot: { w: 200, h: 120 },
  dotR: 3.8,
} as const;

/** The least-squares line y = a + b x; null when every x is the same. */
export function leastSquares(points: ReadonlyArray<{ x: number; y: number }>): { a: number; b: number } | null {
  const n = points.length;
  if (n < 2) return null;
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (const p of points) {
    sxx += (p.x - mx) ** 2;
    sxy += (p.x - mx) * (p.y - my);
  }
  if (!(sxx > 1e-12)) return null;
  const b = sxy / sxx;
  return { a: my - b * mx, b };
}

function attempt(spec: ScatterChart, box: { w: number; h: number }, k: number, seed: number): LectureSketch | null {
  const C = SCATTER;
  const T = LECTURE_TEXT;
  const L = Math.max(T.label.min, Math.round(T.label.size * k));
  const V = Math.max(T.small.min, Math.round(T.small.size * k));
  const title = fitTitle(spec.title, box.w, k);
  if (spec.title && !title) return null;
  const top0 = title ? title.h + TITLE_GAP : 0;
  const caption = spec.yLabel ? fitWords(spec.yLabel, { maxWidth: box.w - 8, maxLines: 1, maxSize: V, minSize: T.small.min }) : null;
  if (spec.yLabel && !caption) return null;
  const xLabel = spec.xLabel ? fitWords(spec.xLabel, { maxWidth: box.w - 8, maxLines: 1, maxSize: V, minSize: T.small.min }) : null;
  if (spec.xLabel && !xLabel) return null;

  const xs = spec.points.map((p) => p.x);
  const ys = spec.points.map((p) => p.y);
  const numH = measureWords("0", L)!.h;
  const plotTop = top0 + (caption ? caption.h + 10 : 0) + 10;
  const plotBottom = box.h - (C.tickLen + C.tickGap + numH + (xLabel ? C.rowGap + xLabel.h : 0));
  const plotH = plotBottom - plotTop;
  if (plotH < C.minPlot.h * k) return null;
  const yScale = dataScale(ys, Math.max(3, Math.min(6, Math.round(plotH / C.tickPx.y))));
  const yNums = yScale.ticks.map((v) => measureWords(formatNumber(v), L));
  if (yNums.some((m) => !m)) return null;
  const axisX = Math.max(...yNums.map((m) => m!.w)) + C.tickGap + C.tickLen + 2;
  let plotR = box.w - 4;
  let plotW = plotR - axisX;
  if (plotW < C.minPlot.w * k) return null;
  let xScale: ValueScale = dataScale(xs, Math.max(3, Math.min(7, Math.round(plotW / C.tickPx.x))));
  let xNums = xScale.ticks.map((v) => measureWords(formatNumber(v), L));
  if (xNums.some((m) => !m)) return null;
  // the x numbers must not run into each other: fewer, larger steps until they do not
  for (let t = Math.round(plotW / C.tickPx.x); t >= 2; t--) {
    const spacing = plotW / Math.max(1, xScale.ticks.length - 1);
    if (Math.max(...xNums.map((m) => m!.w)) + 10 <= spacing) break;
    xScale = dataScale(xs, t - 1);
    xNums = xScale.ticks.map((v) => measureWords(formatNumber(v), L));
  }
  // the last x number is centred under the end of the axis: the axis stops short enough to hold it
  plotR = box.w - (xNums[xNums.length - 1]?.w ?? 0) / 2 - 2;
  plotW = plotR - axisX;

  const px = (x: number) => axisX + ((x - xScale.lo) / (xScale.hi - xScale.lo)) * plotW;
  const py = (y: number) => plotBottom - ((y - yScale.lo) / (yScale.hi - yScale.lo)) * plotH;
  const s = new Sketch(seed);
  const ink = { color: INK.line };

  if (title) s.write("title", title, { x: box.w / 2, y: 0 }, "center", "top");
  // the axes, meeting at the bottom left
  s.draw("axis:y", (pen) => pen.line({ x: axisX, y: plotBottom }, { x: axisX, y: plotTop - 6 }), ink);
  s.draw("axis:x", (pen) => pen.line({ x: axisX, y: plotBottom }, { x: plotR, y: plotBottom }), ink);
  s.draw("ticks:y", (pen) => yScale.ticks.flatMap((v) => pen.line({ x: axisX - C.tickLen, y: py(v) }, { x: axisX, y: py(v) })), ink);
  s.draw("ticks:x", (pen) => xScale.ticks.flatMap((v) => pen.line({ x: px(v), y: plotBottom }, { x: px(v), y: plotBottom + C.tickLen })), ink);
  const ySpacing = plotH / Math.max(1, yScale.ticks.length - 1);
  const yEvery = Math.max(1, Math.ceil((numH * 1.7) / ySpacing));
  yScale.ticks.forEach((v, i) => {
    if (i % yEvery !== 0) return;
    s.write(`tick:y:${formatNumber(v)}`, yNums[i] as WordsLayout, { x: axisX - C.tickLen - C.tickGap, y: py(v) }, "right", "middle");
  });
  xScale.ticks.forEach((v, i) => {
    // one 0 at the corner when both axes start there
    if (i === 0 && yScale.ticks[0] === v && v === 0) return;
    s.write(`tick:x:${formatNumber(v)}`, xNums[i] as WordsLayout, { x: px(v), y: plotBottom + C.tickLen + C.tickGap }, "center", "top");
  });
  if (caption) s.write("caption:y", caption, { x: 0, y: top0 }, "left", "top");

  // the points (in the data's colour), then the trend line through them (the tutor's, dashed)
  const dots = { color: seriesInk(0) };
  spec.points.forEach((p, i) => s.draw(`point:${i}`, (pen) => pen.dot({ x: px(p.x), y: py(p.y) }, C.dotR), dots));
  if (spec.trend) {
    const fit = leastSquares(spec.points);
    if (fit) {
      const a = { x: px(xScale.lo), y: py(fit.a + fit.b * xScale.lo) };
      const b = { x: px(xScale.hi), y: py(fit.a + fit.b * xScale.hi) };
      const c = clipSegment(a, b, { x: axisX + 2, y: plotTop, w: plotW - 2, h: plotH - 2 });
      if (c) s.draw("trend", (pen) => pen.dashed([c[0], c[1]]), ink);
    }
  }
  if (xLabel) s.write("caption:x", xLabel, { x: axisX + plotW / 2, y: plotBottom + C.tickLen + C.tickGap + numH + C.rowGap }, "center", "top");
  return s.finish(box, LECTURE_PACE.chart, L, { x: 0, y: 0 });
}

export function sketchScatter(spec: ScatterChart, box: { w: number; h: number }, seed: number): LectureSketch | null {
  if (spec.points.length < 1 || spec.points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;
  for (const k of SCATTER.levels) {
    const r = attempt(spec, innerBox(box), k, seed);
    if (r && inside(r.plan.bounds, box)) return r;
  }
  return null;
}
