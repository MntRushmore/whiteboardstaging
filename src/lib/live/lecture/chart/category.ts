import type { Stroke } from "@/lib/hand";
import type { Rect } from "../../contracts";
import type { Pen, Pt } from "../../graphing/pen";
import type { ChartSpec } from "../contracts";
import { fitWords, measureWords, type WordsLayout } from "../words";
import { barScale, dataScale, formatNumber, formatValue, type ValueScale } from "./axes";
import { INK, LECTURE_PACE, LECTURE_TEXT, Sketch, TITLE_GAP, closedStroke, fitTitle, handSquare, innerBox, seriesInk, shapeStyle, type LectureSketch } from "./sketch";

/**
 * A bar chart or a line chart as a teacher sketches one: categories along the bottom, a value axis
 * up the left with a few round numbers, what the numbers are written above that axis (a label
 * written up the side is hard to read in a hand), then the bars or the lines, the values on top of
 * the bars, the category names, and a key when there is more than one series.
 *
 * Series are told apart by colour (the palette after the tutor's blue) and, for anyone who cannot
 * tell the colours apart, by the lines' dashes and markers. A bar is one closed stroke, tinted
 * inside. Negative values hang below a baseline drawn at 0; the category names stay along the
 * bottom. Long category names lay the bars on their side instead (`attemptSideways`).
 *
 * LIVE. A value not said yet (`null`) has its slot and its name but no bar or point, so when it is
 * said only its bar (and its value) is new. A bar chart's axis reaches ~1.25 × the largest value
 * (`barScale`), so the next number, unless it is much bigger, lands under the same top. Part names:
 * "title", "axis:x", "axis:y", "ticks:y", "tick:y:<v>", "caption:y", "caption:x", "label:<name>",
 * "bar:<name>:<series>", "value:<name>:<series>", "segment:<series>:<name>-<name>",
 * "point:<name>:<series>", "legend:<series>", "legend:<series>:name".
 *
 * The whole layout is tried at a few scales of the writing, largest first; null when even the
 * smallest leaves too little room for the plot or a category name will not fit under its bar.
 */

export type CategoryChart = Extract<ChartSpec, { kind: "bar" | "line" }>;

export const CATEGORY = {
  /** the writing's scale, tried largest first */
  levels: [1, 0.92, 0.85, 0.78],
  tickLen: 6,
  /** a tick number to its tick */
  tickGap: 6,
  /** the plot's bottom to the category names, and between rows of writing under it */
  labelGap: 9,
  rowGap: 8,
  /** a value to its bar */
  valueGap: 5,
  /** the plot is at least this tall (× the level) */
  minPlotH: 120,
  /** px per tick on the value axis, roughly */
  tickPx: 46,
  /** the share of a category's slot its bars take (one series; a group of 2–3) */
  fill: { single: 0.6, group: 0.8 },
  /** px between the bars of a group */
  barGap: 3,
  legend: { swatchW: 22, swatchH: 15, lineW: 36, gap: 8, itemGap: 26 },
} as const;

/** How series 0, 1, 2 are told apart besides their colour. */
const LINE_STYLE = [
  { dash: null, marker: "dot" },
  { dash: [9, 6], marker: "ring" },
  { dash: [1.6, 5.5], marker: "square" },
] as const;

type Marker = (typeof LINE_STYLE)[number]["marker"];

function markerStrokes(pen: Pen, m: Marker, c: Pt): Stroke[] {
  if (m === "dot") return pen.dot(c, 4);
  if (m === "ring") return pen.ring(c, 5.2);
  return handSquare(pen, c, 4.6);
}

/** px a line stops short of its marker (a dot is drawn over the line; a ring or a square stays open). */
function markerClear(m: Marker): number {
  return m === "dot" ? 0 : 7.5;
}

/** A bar: up one side, across, down the other — one closed stroke, the axis its fourth side. */
function barOutline(pen: Pen, x: number, w: number, y0: number, y1: number): Stroke[] {
  return closedStroke(pen, [
    { x, y: y0 },
    { x: x + (pen.rng() - 0.5) * 0.8, y: y1 },
    { x: x + w + (pen.rng() - 0.5) * 0.8, y: y1 + (pen.rng() - 0.5) * 0.8 },
    { x: x + w, y: y0 },
  ]);
}

/** A key's swatch: a little filled box. */
function swatch(pen: Pen, r: Rect): Stroke[] {
  return closedStroke(pen, [
    { x: r.x, y: r.y + r.h },
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
  ]);
}

/** A category's name as a part name ("label:Q3"): stable as the chart grows. */
function key(label: string): string {
  return label.replace(/\s+/g, " ").trim();
}

interface CategoryLabels {
  layouts: WordsLayout[];
  /** 1: all in a row; 2: every other one a row lower */
  rows: 1 | 2;
  rowH: [number, number];
}

/** The category names under their slots: one row, wrapping and shrinking; else staggered over two rows. */
function categoryLabels(labels: readonly string[], slot: number, size: number, min: number, stagger: boolean): CategoryLabels | null {
  const tryRow = (maxWidth: number, s: number) => {
    const out: WordsLayout[] = [];
    for (const l of labels) {
      const m = measureWords(l, s, { maxWidth, maxLines: 2, balance: true });
      if (!m) return null;
      out.push(m);
    }
    return out;
  };
  for (let s = size; s >= min; s--) {
    const row = tryRow(slot - 8, s);
    if (row) return { layouts: row, rows: 1, rowH: [Math.max(...row.map((m) => m.h)), 0] };
  }
  for (let s = size; stagger && s >= min; s--) {
    const row = tryRow(2 * slot - 12, s);
    if (row) {
      const h = (odd: number) => Math.max(0, ...row.filter((_, i) => i % 2 === odd).map((m) => m.h));
      return { layouts: row, rows: 2, rowH: [h(0), h(1)] };
    }
  }
  return null;
}

interface LegendItem {
  text: WordsLayout;
  w: number;
}

/** The key: one item per series, packed into rows across `width`. */
function legendLayout(names: readonly string[], kind: "bar" | "line", size: number, min: number, width: number): { rows: LegendItem[][]; h: number; rowH: number } | null {
  const G = CATEGORY.legend;
  const sw = kind === "bar" ? G.swatchW : G.lineW;
  const items: LegendItem[] = [];
  for (const n of names) {
    const text = fitWords(n, { maxWidth: Math.min(220, width - sw - G.gap), maxLines: 1, maxSize: size, minSize: min });
    if (!text) return null;
    items.push({ text, w: sw + G.gap + text.w });
  }
  const rows: LegendItem[][] = [[]];
  let x = 0;
  for (const it of items) {
    const row = rows[rows.length - 1];
    if (row.length > 0 && x + G.itemGap + it.w > width) {
      rows.push([it]);
      x = it.w;
    } else {
      x += (row.length ? G.itemGap : 0) + it.w;
      row.push(it);
    }
  }
  const rowH = Math.max(G.swatchH, ...items.map((i) => i.text.h)) + 4;
  return { rows, rowH, h: rows.length * rowH + (rows.length - 1) * 4 };
}

/** Draws the key, a row at a time, centred on `cx`. */
function drawLegend(s: Sketch, legend: { rows: LegendItem[][]; rowH: number }, kind: "bar" | "line", cx: number, y: number, width: number): void {
  const G = CATEGORY.legend;
  let idx = 0;
  for (const row of legend.rows) {
    const rowW = row.reduce((a, it) => a + it.w, 0) + (row.length - 1) * G.itemGap;
    let x = Math.max(0, Math.min(width - rowW, cx - rowW / 2));
    const mid = y + legend.rowH / 2;
    for (const it of row) {
      const j = idx++;
      const color = seriesInk(j);
      const x0 = x;
      if (kind === "bar") s.draw(`legend:${j}`, (pen) => swatch(pen, { x: x0, y: mid - G.swatchH / 2, w: G.swatchW, h: G.swatchH }), shapeStyle(color));
      else {
        const style = LINE_STYLE[j] ?? LINE_STYLE[0];
        const c = { x: x0 + G.lineW / 2, y: mid };
        const clear = markerClear(style.marker);
        s.draw(
          `legend:${j}`,
          (pen) => {
            const out: Stroke[] = [];
            for (const [p, q] of [
              [{ x: x0, y: mid }, { x: c.x - clear, y: mid }],
              [{ x: c.x + clear, y: mid }, { x: x0 + G.lineW, y: mid }],
            ] as Array<[Pt, Pt]>) {
              if (!style.dash) out.push(...pen.line(p, q));
              else out.push(...pen.dashed([p, q], style.dash[0], style.dash[1]));
            }
            return [...out, ...markerStrokes(pen, style.marker, c)];
          },
          { color },
        );
      }
      s.write(`legend:${j}:name`, it.text, { x: x0 + (kind === "bar" ? G.swatchW : G.lineW) + G.gap, y: mid }, "left", "middle");
      x += it.w + G.itemGap;
    }
    y += legend.rowH + 4;
  }
}

/** The values said so far (not the empty slots). */
function saidValues(spec: CategoryChart): number[] {
  return spec.series.flatMap((s) => s.values).filter((v): v is number => v !== null);
}

/** One attempt at the chart with the writing at scale `k`. */
function attempt(spec: CategoryChart, box: { w: number; h: number }, k: number, seed: number, stagger: boolean): LectureSketch | null {
  const C = CATEGORY;
  const T = LECTURE_TEXT;
  const L = Math.max(T.label.min, Math.round(T.label.size * k));
  const V = Math.max(T.small.min, Math.round(T.small.size * k));
  const n = spec.labels.length;
  const S = spec.series.length;
  const all = saidValues(spec);
  if (all.length === 0) return null;
  const min = Math.min(...all);
  const max = Math.max(...all);
  const isBar = spec.kind === "bar";

  const title = fitTitle(spec.title, box.w, k);
  if (spec.title && !title) return null;
  const top0 = title ? title.h + TITLE_GAP : 0;

  const names = S > 1 && spec.series.some((s) => s.name) ? spec.series.map((s, i) => s.name ?? `Series ${i + 1}`) : null;
  const legend = names ? legendLayout(names, spec.kind, V, T.small.min, box.w) : null;
  if (names && !legend) return null;
  const xLabel = spec.xLabel ? fitWords(spec.xLabel, { maxWidth: box.w, maxLines: 1, maxSize: V, minSize: T.small.min }) : null;
  if (spec.xLabel && !xLabel) return null;

  // the plot's left edge depends on how wide the tick numbers are, which depends on how tall the
  // plot is, which depends on what goes under it: settle it in a couple of passes
  let axisX = (measureWords(formatNumber(max), L)?.w ?? 20) + C.tickGap + C.tickLen + 2;
  let layout: {
    cats: CategoryLabels;
    values: { layouts: Array<Array<WordsLayout | null>>; withUnit: boolean } | null;
    caption: WordsLayout | null;
    plotTop: number;
    plotBottom: number;
    scale: ValueScale;
    ticks: WordsLayout[];
    slot: number;
    barW: number;
    groupW: number;
  } | null = null;
  for (let pass = 0; pass < 4; pass++) {
    const plotR = box.w - 4;
    const slot = (plotR - axisX) / n;
    if (slot < 14) return null;
    const cats = categoryLabels(spec.labels, slot, L, T.label.min, stagger);
    if (!cats) return null;
    const groupW = slot * (S === 1 ? C.fill.single : C.fill.group);
    const barW = (groupW - (S - 1) * C.barGap) / S;

    // values on the bars, with the unit when they can carry it; left off when they will not fit
    let values: { layouts: Array<Array<WordsLayout | null>>; withUnit: boolean } | null = null;
    if (isBar) {
      const room = S === 1 ? Math.min(slot - 8, barW + 28) : barW + C.barGap - 7;
      outer: for (const withUnit of spec.unit ? [true, false] : [false]) {
        for (let sz = V; sz >= T.small.min; sz--) {
          const layouts = spec.series.map((sr) => sr.values.map((v) => (v === null ? null : measureWords(withUnit ? formatValue(v, spec.unit) : formatNumber(v), sz, { maxLines: 1 }))));
          if (layouts.every((row, j) => row.every((m, i) => spec.series[j].values[i] === null || (m && m.w <= room)))) {
            values = { layouts, withUnit };
            break outer;
          }
        }
      }
    }
    // what the numbers are, above the value axis: the y label, and the unit when the values do not say it
    const unitText = spec.unit && !values?.withUnit ? spec.unit : "";
    const capText = spec.yLabel ? (unitText ? `${spec.yLabel} (${unitText})` : spec.yLabel) : unitText;
    const caption = capText
      ? (fitWords(capText, { maxWidth: box.w - 8, maxLines: 1, maxSize: V, minSize: T.small.min }) ??
        fitWords(capText, { maxWidth: box.w * 0.6, maxLines: 2, maxSize: V, minSize: T.small.min, balance: true }))
      : null;
    if (capText && !caption) return null;

    const valueH = values ? Math.max(0, ...values.layouts.flat().map((m) => m?.h ?? 0)) : 0;
    const footroom = values && min < 0 ? valueH + C.valueGap + 2 : 0;
    const catH = cats.rowH[0] + (cats.rows === 2 ? 4 + cats.rowH[1] : 0);
    const below = footroom + C.labelGap + catH + (xLabel ? C.rowGap + xLabel.h : 0) + (legend ? C.rowGap + 4 + legend.h : 0);
    const plotTop = top0 + (caption ? caption.h + 10 : 0) + 10;
    const plotBottom = box.h - below;
    if (plotBottom - plotTop < C.minPlotH * k) return null;
    const target = Math.max(3, Math.min(6, Math.round((plotBottom - plotTop) / C.tickPx)));
    // a bar stands on 0, its axis with room to grow (and room for the tallest bar's value); so does
    // a line, unless its values sit close together far from 0 (a population of 50–67 million is
    // not a flat line at the top): then its axis starts near them
    const clustered = (min > 0 && min > 0.7 * max) || (max < 0 && max < 0.7 * min);
    const scale = isBar || !clustered ? barScale(min, max) : dataScale(all, target);
    if (values && isBar && max > 0) {
      const yMax = plotBottom - ((max - scale.lo) / (scale.hi - scale.lo)) * (plotBottom - plotTop);
      if (yMax - valueH - C.valueGap < top0 + (caption ? caption.h + 4 : 0)) return null;
    }
    const ticks = scale.ticks.map((v) => measureWords(formatNumber(v), L));
    if (ticks.some((t) => !t)) return null;
    const next = Math.max(...ticks.map((t) => t!.w)) + C.tickGap + C.tickLen + 2;
    layout = { cats, values, caption, plotTop, plotBottom, scale, ticks: ticks as WordsLayout[], slot, barW, groupW };
    if (Math.abs(next - axisX) < 1) break;
    axisX = next;
  }
  if (!layout) return null;
  const { cats, values, caption, plotTop, plotBottom, scale, ticks, slot, barW, groupW } = layout;
  const plotR = box.w - 4;
  const yOf = (v: number) => plotBottom - ((v - scale.lo) / (scale.hi - scale.lo)) * (plotBottom - plotTop);
  const y0 = yOf(Math.min(scale.hi, Math.max(scale.lo, 0)));
  const cx = (i: number) => axisX + slot * (i + 0.5);
  const ink = { color: INK.line };

  const s = new Sketch(seed);

  // 1. the title
  if (title) s.write("title", title, { x: box.w / 2, y: 0 }, "center", "top");

  // 2. the axes: the value axis up the left, the baseline (no arrowheads: clean ends)
  s.draw("axis:y", (pen) => pen.line({ x: axisX, y: plotBottom }, { x: axisX, y: plotTop - 6 }), ink);
  s.draw("axis:x", (pen) => pen.line({ x: axisX, y: y0 }, { x: plotR, y: y0 }), ink);

  // 3. ticks and their numbers (every other number when they would crowd)
  const spacing = (plotBottom - plotTop) / Math.max(1, scale.ticks.length - 1);
  const every = Math.max(1, Math.ceil((ticks[0].h * 1.7) / spacing));
  s.draw("ticks:y", (pen) => scale.ticks.flatMap((v) => pen.line({ x: axisX - C.tickLen, y: yOf(v) }, { x: axisX, y: yOf(v) })), ink);
  const zeroIdx = Math.round((0 - scale.lo) / scale.step);
  scale.ticks.forEach((v, i) => {
    if ((i - zeroIdx) % every !== 0) return;
    s.write(`tick:y:${formatNumber(v)}`, ticks[i], { x: axisX - C.tickLen - C.tickGap, y: yOf(v) }, "right", "middle");
  });

  // 4. what the numbers are, above the axis
  if (caption) s.write("caption:y", caption, { x: 0, y: top0 }, "left", "top");

  // 5. the category names along the bottom (an empty slot has its name before its number)
  const catTop = plotBottom + (values && min < 0 ? Math.max(0, ...values.layouts.flat().map((m) => m?.h ?? 0)) + C.valueGap + 2 : 0) + C.labelGap;
  cats.layouts.forEach((m, i) => {
    const row = cats.rows === 2 && i % 2 === 1 ? 1 : 0;
    s.write(`label:${key(spec.labels[i])}`, m, { x: cx(i), y: catTop + (row === 1 ? cats.rowH[0] + 4 : 0) }, "center", "top");
  });

  // 6. the data: each bar and its value; each line a segment at a time, then its points
  if (isBar) {
    spec.labels.forEach((label, i) => {
      spec.series.forEach((sr, j) => {
        const v = sr.values[i];
        if (v === null) return;
        const x = cx(i) - groupW / 2 + j * (barW + C.barGap);
        const y = yOf(v);
        if (Math.abs(y - y0) >= 1.5) s.draw(`bar:${key(label)}:${j}`, (pen) => barOutline(pen, x, barW, y0, y), shapeStyle(seriesInk(j)));
        const m = values?.layouts[j][i];
        if (m) s.write(`value:${key(label)}:${j}`, m, { x: x + barW / 2, y: v < 0 ? y + C.valueGap : y - C.valueGap }, "center", v < 0 ? "top" : "bottom");
      });
    });
  } else {
    spec.series.forEach((sr, j) => {
      const style = LINE_STYLE[j] ?? LINE_STYLE[0];
      const color = { color: seriesInk(j) };
      // a value not said yet breaks the line there
      const pts = sr.values.map((v, i) => (v === null ? null : { x: cx(i), y: yOf(v) }));
      const clear = markerClear(style.marker);
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        if (!a || !b) continue;
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len <= 2 * clear + 3) continue;
        const ux = (b.x - a.x) / len;
        const uy = (b.y - a.y) / len;
        const p = { x: a.x + ux * clear, y: a.y + uy * clear };
        const q = { x: b.x - ux * clear, y: b.y - uy * clear };
        s.draw(`segment:${j}:${key(spec.labels[i - 1])}-${key(spec.labels[i])}`, (pen) => (style.dash ? pen.dashed([p, q], style.dash[0], style.dash[1]) : pen.line(p, q)), color);
      }
      pts.forEach((p, i) => {
        if (p) s.draw(`point:${key(spec.labels[i])}:${j}`, (pen) => markerStrokes(pen, style.marker, p), color);
      });
    });
  }

  // 7. what the categories are, under them; 8. the key
  let y = catTop + cats.rowH[0] + (cats.rows === 2 ? 4 + cats.rowH[1] : 0);
  if (xLabel) {
    y += C.rowGap;
    s.write("caption:x", xLabel, { x: (axisX + plotR) / 2, y }, "center", "top");
    y += xLabel.h;
  }
  if (legend) drawLegend(s, legend, spec.kind, (axisX + plotR) / 2, y + C.rowGap + 4, box.w);

  return s.finish(box, LECTURE_PACE.chart, L, { x: 0, y: 0 });
}

/**
 * Bars lying down: the category names in a column on the left (right-aligned, up to two lines),
 * the bars growing right from the 0 line, each value written at its bar's end, the value axis
 * along the bottom. What a teacher does when the names are too long to go under the bars.
 */
function attemptSideways(spec: CategoryChart, box: { w: number; h: number }, k: number, seed: number): LectureSketch | null {
  const C = CATEGORY;
  const T = LECTURE_TEXT;
  const L = Math.max(T.label.min, Math.round(T.label.size * k));
  const V = Math.max(T.small.min, Math.round(T.small.size * k));
  const n = spec.labels.length;
  const S = spec.series.length;
  const all = saidValues(spec);
  if (all.length === 0) return null;
  const min = Math.min(...all);
  const max = Math.max(...all);
  const title = fitTitle(spec.title, box.w, k);
  if (spec.title && !title) return null;
  let top = title ? title.h + TITLE_GAP : 0;
  const catCaption = spec.xLabel ? fitWords(spec.xLabel, { maxWidth: box.w * 0.45, maxLines: 1, maxSize: V, minSize: T.small.min }) : null;
  if (spec.xLabel && !catCaption) return null;
  const capTop = top;
  if (catCaption) top += catCaption.h + 8;

  // the names, one size for all, in at most 42 % of the width
  let cats: WordsLayout[] | null = null;
  for (let sz = L; sz >= T.label.min && !cats; sz--) {
    const laid = spec.labels.map((l) => measureWords(l, sz, { maxWidth: box.w * 0.42, maxLines: 2, balance: true }));
    if (laid.every(Boolean)) cats = laid as WordsLayout[];
  }
  if (!cats) return null;
  const xL = Math.max(...cats.map((m) => m.w)) + 12;

  // values at the bars' ends when every one fits beside its bar (none when a bar points left)
  let values: Array<Array<WordsLayout | null>> | null = null;
  if (min >= 0) {
    const laid = spec.series.map((sr) => sr.values.map((v) => (v === null ? null : measureWords(formatValue(v, spec.unit), V, { maxLines: 1 }))));
    if (laid.every((row, j) => row.every((m, i) => m || spec.series[j].values[i] === null))) values = laid;
  }
  const capText = spec.yLabel ? (spec.unit && !values ? `${spec.yLabel} (${spec.unit})` : spec.yLabel) : spec.unit && !values ? spec.unit : "";
  const caption = capText ? fitWords(capText, { maxWidth: box.w - xL, maxLines: 1, maxSize: V, minSize: T.small.min }) : null;
  if (capText && !caption) return null;
  const names = S > 1 && spec.series.some((sr) => sr.name) ? spec.series.map((sr, i) => sr.name ?? `Series ${i + 1}`) : null;
  const legend = names ? legendLayout(names, "bar", V, T.small.min, box.w) : null;
  if (names && !legend) return null;

  const numH = measureWords("0", L)!.h;
  const below = C.tickLen + C.tickGap + numH + (caption ? C.rowGap + caption.h : 0) + (legend ? C.rowGap + 4 + legend.h : 0);
  const plotTop = top + 4;
  const plotBottom = box.h - below;
  const rowH = (plotBottom - plotTop) / n;
  const valueH = values ? Math.max(0, ...values.flat().map((m) => m?.h ?? 0)) : 0;
  const groupH = rowH * (S === 1 ? 0.62 : 0.8);
  const barH = (groupH - (S - 1) * 2) / S;
  if (rowH < Math.max(...cats.map((m) => m.h)) + 4 || barH < 7) return null;
  // a value beside a thin bar of a group would touch the next one's
  if (values && S > 1 && valueH > barH + 2 + 3) values = null;
  const valueW = values ? Math.max(0, ...values.flat().map((m) => m?.w ?? 0)) + C.valueGap + 2 : 0;

  const scale = barScale(min, max);
  const nums = scale.ticks.map((v) => measureWords(formatNumber(v), L)!);
  // the last number is centred on the axis's end: room for its half, and for the longest bar's value
  const xR = Math.min(box.w - Math.max(0, valueW - 0.2 * 0), box.w - nums[nums.length - 1].w / 2 - 2);
  if (xR - xL < 140 * k) return null;
  const xOf = (v: number) => xL + ((v - scale.lo) / (scale.hi - scale.lo)) * (xR - xL);
  if (values && xOf(max) + valueW > box.w) return null;
  const spacing = (xR - xL) / Math.max(1, scale.ticks.length - 1);
  const every = Math.max(1, Math.ceil((Math.max(...nums.map((m) => m.w)) + 12) / spacing));
  const x0 = xOf(0);
  const ink = { color: INK.line };

  const s = new Sketch(seed);
  if (title) s.write("title", title, { x: box.w / 2, y: 0 }, "center", "top");
  // the axes: the 0 line the bars stand on, the value axis along the bottom
  s.draw("axis:y", (pen) => pen.line({ x: x0, y: plotTop - 4 }, { x: x0, y: plotBottom }), ink);
  s.draw("axis:x", (pen) => pen.line({ x: xL, y: plotBottom }, { x: xR + 6, y: plotBottom }), ink);
  s.draw("ticks:x", (pen) => scale.ticks.flatMap((v) => pen.line({ x: xOf(v), y: plotBottom }, { x: xOf(v), y: plotBottom + C.tickLen })), ink);
  const zeroIdx = Math.round((0 - scale.lo) / scale.step);
  scale.ticks.forEach((v, i) => {
    if ((i - zeroIdx) % every !== 0) return;
    s.write(`tick:x:${formatNumber(v)}`, nums[i], { x: xOf(v), y: plotBottom + C.tickLen + C.tickGap }, "center", "top");
  });
  let y = plotBottom + C.tickLen + C.tickGap + numH;
  if (caption) {
    y += C.rowGap;
    s.write("caption:y", caption, { x: (xL + xR) / 2, y }, "center", "top");
    y += caption.h;
  }
  if (catCaption) s.write("caption:x", catCaption, { x: xL - 12, y: capTop }, "right", "top");

  // each category: its name, its bars and their values
  const rowMid = (i: number) => plotTop + rowH * (i + 0.5);
  spec.labels.forEach((label, i) => {
    s.write(`label:${key(label)}`, cats![i], { x: xL - 12, y: rowMid(i) }, "right", "middle");
    spec.series.forEach((sr, j) => {
      const v = sr.values[i];
      if (v === null) return;
      const yb = rowMid(i) - groupH / 2 + j * (barH + 2);
      const xv = xOf(v);
      if (Math.abs(xv - x0) >= 1.5) {
        s.draw(
          `bar:${key(label)}:${j}`,
          (pen) =>
            closedStroke(pen, [
              { x: x0, y: yb },
              { x: xv, y: yb },
              { x: xv, y: yb + barH },
              { x: x0, y: yb + barH },
            ]),
          shapeStyle(seriesInk(j)),
        );
      }
      const m = values?.[j][i];
      if (m) s.write(`value:${key(label)}:${j}`, m, { x: xv + C.valueGap, y: yb + barH / 2 }, "left", "middle");
    });
  });

  if (legend) drawLegend(s, legend, "bar", (xL + xR) / 2, y + C.rowGap + 4, box.w);
  return s.finish(box, LECTURE_PACE.chart, L, { x: 0, y: 0 });
}

export function sketchCategoryChart(spec: CategoryChart, box: { w: number; h: number }, seed: number): LectureSketch | null {
  if (spec.labels.length < 1 || spec.series.length < 1 || spec.series.some((s) => s.values.length !== spec.labels.length)) return null;
  if (spec.series.some((s) => s.values.some((v) => v !== null && !Number.isFinite(v)))) return null;
  if (saidValues(spec).length === 0) return null;
  const inner = innerBox(box);
  const tryAll = (f: (k: number) => LectureSketch | null): LectureSketch | null => {
    for (const k of CATEGORY.levels) {
      const r = f(k);
      if (r) return r;
    }
    return null;
  };
  // short names (months, years, letters) stay under their bars, every other one a row lower if
  // need be — along the bottom is where a sequence reads; long names lay the bars on their side
  const short = spec.labels.every((l) => l.length <= 8);
  const upright = (stagger: boolean) => tryAll((k) => attempt(spec, inner, k, seed, stagger));
  const sideways = () => (spec.kind === "bar" ? tryAll((k) => attemptSideways(spec, inner, k, seed)) : null);
  return short ? (upright(true) ?? sideways()) : (upright(false) ?? sideways() ?? upright(true));
}
