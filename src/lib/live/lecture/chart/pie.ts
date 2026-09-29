import type { Rect } from "../../contracts";
import { rectsOverlap, type Pt } from "../../graphing/pen";
import type { ChartSpec, LectureInk } from "../contracts";
import { fitWords, type WordsLayout } from "../words";
import { INK, LECTURE_PACE, LECTURE_TEXT, SERIES_INKS, Sketch, TITLE_GAP, closedStroke, fitTitle, innerBox, inside, partSeed, seriesInk, shapeStyle, type LectureSketch } from "./sketch";

/**
 * A pie chart as a teacher draws one: the slices clockwise in the order given (from 12 o'clock
 * unless starting elsewhere gives the labels more room), each a closed shape in the next colour,
 * tinted inside, and each slice's name and percentage — inside a slice big enough to hold them,
 * else just outside it, pushed clear of its neighbours and joined to its slice by a short line
 * when it had to move. Two or more slivers merge into "Other"; a lone sliver keeps its own label
 * on a line. Parts: "title", "slice:<name>", "label:<name>", "leader:<name>" (a live pie that
 * gains a slice redraws them all: every share moves).
 *
 * The circle is as large as the labels round it allow; null when even a small one leaves no room.
 */

export type PieChart = Extract<ChartSpec, { kind: "pie" }>;

export const PIE = {
  levels: [1, 0.92, 0.85],
  minR: 64,
  /** the circle to a label outside it */
  labelGap: 9,
  /** a sliver's label sits this much further out, on a leader line */
  sliverOut: 22,
  /** a slice under this share is a sliver */
  sliver: 0.05,
  /** two or more slices under this share become one "Other" */
  merge: 0.03,
  /** a label is tried inside a slice at least this big */
  insideShare: 0.13,
  /** px a label keeps from the circle and the radii when inside */
  insideClear: 6,
  /** px a pushed label may move out before it gives up */
  maxPush: 90,
} as const;

interface Slice {
  label: string;
  value: number;
  share: number;
  pct: string;
}

/** Percentages that add up to 100 (largest remainders), `<1%` for a sliver that rounds to 0. */
function percentages(values: readonly number[]): string[] {
  const total = values.reduce((a, b) => a + b, 0);
  const raw = values.map((v) => (v / total) * 100);
  const floor = raw.map(Math.floor);
  let left = 100 - floor.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (left <= 0) break;
    floor[i] += 1;
    left -= 1;
  }
  return floor.map((p, i) => (p === 0 && raw[i] > 0 ? "<1%" : `${p}%`));
}

/** The slices to draw: slivers merged into "Other" when there are two or more of them. */
function slicesOf(spec: PieChart): Slice[] {
  const total = spec.slices.reduce((a, s) => a + s.value, 0);
  let list = spec.slices.map((s) => ({ label: s.label, value: s.value }));
  const tiny = list.filter((s) => s.value / total < PIE.merge);
  if (tiny.length >= 2) {
    const other = list.find((s) => /^others?$/i.test(s.label.trim()));
    const rest = list.filter((s) => !tiny.includes(s) && s !== other);
    const sum = tiny.reduce((a, s) => a + s.value, 0) + (other && !tiny.includes(other) ? other.value : 0);
    list = [...rest, { label: other?.label ?? "Other", value: sum }];
  }
  const pcts = percentages(list.map((s) => s.value));
  return list.map((s, i) => ({ ...s, share: s.value / total, pct: pcts[i] }));
}

const TAU = Math.PI * 2;

/** Angle of a point round the centre, measured like the slices: clockwise from 12 o'clock, 0..2π. */
function angleOf(p: Pt, c: Pt): number {
  const a = Math.atan2(p.y - c.y, p.x - c.x) + Math.PI / 2;
  return ((a % TAU) + TAU) % TAU;
}

/** Points round a rect's edge every few px. */
function rim(r: Rect, step = 4): Pt[] {
  const out: Pt[] = [];
  const nx = Math.max(1, Math.ceil(r.w / step));
  const ny = Math.max(1, Math.ceil(r.h / step));
  for (let i = 0; i <= nx; i++) out.push({ x: r.x + (r.w * i) / nx, y: r.y }, { x: r.x + (r.w * i) / nx, y: r.y + r.h });
  for (let j = 1; j < ny; j++) out.push({ x: r.x, y: r.y + (r.h * j) / ny }, { x: r.x + r.w, y: r.y + (r.h * j) / ny });
  return out;
}

/** Is the rect well inside the slice from angle a0 to a1 (clockwise from 12 o'clock)? */
function inSlice(r: Rect, c: Pt, radius: number, a0: number, a1: number): boolean {
  const clear = PIE.insideClear;
  for (const p of rim(r)) {
    const d = Math.hypot(p.x - c.x, p.y - c.y);
    if (d > radius - clear || d < 4) return false;
    const a = angleOf(p, c);
    const rel = (((a - a0) % TAU) + TAU) % TAU;
    if (rel > a1 - a0) return false;
    // far enough from both radii
    const off0 = d * Math.sin(Math.min(rel, Math.PI / 2));
    const off1 = d * Math.sin(Math.min(a1 - a0 - rel, Math.PI / 2));
    if (off0 < clear || off1 < clear) return false;
  }
  return true;
}

interface Placed {
  layout: WordsLayout;
  rect: Rect;
  at: Pt;
  align: "left" | "center" | "right";
  valign: "top" | "middle" | "bottom";
  leader: [Pt, Pt] | null;
}

function rectAt(l: WordsLayout, at: Pt, align: Placed["align"], valign: Placed["valign"]): Rect {
  const x = align === "left" ? at.x : align === "center" ? at.x - l.w / 2 : at.x - l.w;
  const y = valign === "top" ? at.y : valign === "middle" ? at.y - l.h / 2 : at.y - l.h;
  return { x, y, w: l.w, h: l.h };
}

/** The point of a rect nearest to p. */
function nearest(r: Rect, p: Pt): Pt {
  return { x: Math.max(r.x, Math.min(r.x + r.w, p.x)), y: Math.max(r.y, Math.min(r.y + r.h, p.y)) };
}

/** Labels for every slice round a circle of radius r whose first slice starts at `start`; null when one finds no spot. */
function placeLabels(
  slices: readonly Slice[],
  stacked: readonly WordsLayout[],
  oneLine: ReadonlyArray<WordsLayout | null>,
  c: Pt,
  r: number,
  start: number,
  area: Rect,
): Placed[] | null {
  const placed: Placed[] = [];
  let cum = 0;
  for (let i = 0; i < slices.length; i++) {
    const s = slices[i];
    const a0 = start + cum * TAU;
    const a1 = start + (cum + s.share) * TAU;
    cum += s.share;
    const mid = (a0 + a1) / 2;
    const ux = Math.sin(mid);
    const uy = -Math.cos(mid);

    // inside the slice, when it is big enough to hold its words
    if (s.share >= PIE.insideShare) {
      let done = false;
      for (const f of [0.58, 0.5, 0.66, 0.42]) {
        const at = { x: c.x + ux * r * f, y: c.y + uy * r * f };
        const rect = rectAt(stacked[i], at, "center", "middle");
        if (inSlice(rect, c, r, ((a0 % TAU) + TAU) % TAU, ((a0 % TAU) + TAU) % TAU + (a1 - a0)) && !placed.some((p) => rectsOverlap(p.rect, rect, 6))) {
          placed.push({ layout: stacked[i], rect, at, align: "center", valign: "middle", leader: null });
          done = true;
          break;
        }
      }
      if (done) continue;
    }

    // outside: beside the slice's middle, on the side away from the circle; when that is taken,
    // further out or along the rim — the smallest move first — and a line back to the slice
    const layout = Math.abs(uy) > 0.85 && oneLine[i] ? oneLine[i]! : stacked[i];
    const align: Placed["align"] = ux > 0.3 ? "left" : ux < -0.3 ? "right" : "center";
    const valign: Placed["valign"] = uy > 0.3 ? "top" : uy < -0.3 ? "bottom" : "middle";
    const sliver = s.share < PIE.sliver;
    const moves: Array<[number, number]> = [];
    for (let push = sliver ? PIE.sliverOut : 0; push <= PIE.maxPush; push += 6) {
      for (let t = 0; t <= 60; t += 8) {
        moves.push([push, t]);
        if (t) moves.push([push, -t]);
      }
    }
    moves.sort((m, n) => Math.abs(m[0]) + Math.abs(m[1]) - (Math.abs(n[0]) + Math.abs(n[1])));
    let found: Placed | null = null;
    for (const [push, t] of moves) {
      const d = r + PIE.labelGap + push;
      const at = { x: c.x + ux * d - uy * t, y: c.y + uy * d + ux * t };
      const rect = rectAt(layout, at, align, valign);
      if (!inside({ x: rect.x - area.x, y: rect.y - area.y, w: rect.w, h: rect.h }, area)) continue;
      if (placed.some((p) => rectsOverlap(p.rect, rect, 7))) continue;
      if (!rim(rect, 3).every((p) => Math.hypot(p.x - c.x, p.y - c.y) > r + 5)) continue;
      let leader: [Pt, Pt] | null = null;
      if (push + Math.abs(t) > 10) {
        const from = { x: c.x + ux * (r + 3), y: c.y + uy * (r + 3) };
        const n = nearest(rect, from);
        const len = Math.hypot(n.x - from.x, n.y - from.y);
        if (len > 10) leader = [from, { x: n.x + ((from.x - n.x) / len) * 4, y: n.y + ((from.y - n.y) / len) * 4 }];
      }
      found = { layout, rect, at, align, valign, leader };
      break;
    }
    if (!found) return null;
    placed.push(found);
  }
  // a leader must not cross another slice's words
  if (placed.some((p) => p.leader && placed.some((q) => q !== p && segmentNear(p.leader!, q.rect)))) return null;
  return placed;
}

function attempt(spec: PieChart, box: { w: number; h: number }, k: number, seed: number): LectureSketch | null {
  const T = LECTURE_TEXT;
  const L = Math.max(T.label.min, Math.round(T.label.size * k));
  const slices = slicesOf(spec);
  const title = fitTitle(spec.title, box.w, k);
  if (spec.title && !title) return null;
  const top = title ? title.h + TITLE_GAP : 0;
  const H = box.h - top;
  // the labels keep below the title
  const area: Rect = { x: 0, y: top, w: box.w, h: H };

  // each slice's writing: its name (up to two lines) over its percentage, or on one line
  const stacked: WordsLayout[] = [];
  const oneLine: Array<WordsLayout | null> = [];
  for (const s of slices) {
    const st = fitWords(`${s.label}\n${s.pct}`, { maxWidth: Math.min(170, box.w * 0.34), maxLines: 3, maxSize: L, minSize: T.label.min, balance: true });
    if (!st) return null;
    stacked.push(st);
    oneLine.push(fitWords(`${s.label} ${s.pct}`, { maxWidth: box.w * 0.6, maxLines: 1, maxSize: st.size, minSize: st.size }));
  }

  // clockwise from 12 o'clock as a teacher starts one — unless starting elsewhere lets the
  // circle be clearly bigger (slivers at the top crowd the title)
  const rMax = Math.min(box.w / 2, H / 2) - 6;
  const c = { x: box.w / 2, y: top + H / 2 };
  let best: { r: number; start: number; placed: Placed[] } | null = null;
  for (const start of [0, TAU / 4, -TAU / 4, TAU / 2, TAU / 8, -TAU / 8]) {
    for (let r = rMax; r >= PIE.minR * k && (!best || r > best.r + 8); r -= 4) {
      const placed = placeLabels(slices, stacked, oneLine, c, r, start, area);
      if (placed) {
        best = { r, start, placed };
        break;
      }
    }
    if (best && best.r >= rMax - 4) break;
  }
  if (!best) return null;
  const { r, start, placed } = best;

  const sk = new Sketch(seed);
  if (title) sk.write("title", title, { x: box.w / 2, y: 0 }, "center", "top");
  // each slice one closed stroke — out along its first radius, round its arc, and the pen closes
  // it back down the second — in the palette's colours in turn, tinted inside. The circle wobbles
  // the same for every slice (seeded by the sketch), so the arcs meet at the radii.
  const wob = partSeed(seed, "pie:wobble") % 628 / 100;
  const rim = (a: number) => r * (1 + 0.008 * Math.sin(2 * a + wob));
  const colours = sliceColours(slices.length);
  let acc = 0;
  slices.forEach((sl, i) => {
    const a0 = start + acc * TAU;
    const a1 = start + (acc + sl.share) * TAU;
    acc += sl.share;
    const n = Math.max(4, Math.ceil(((a1 - a0) * r) / 6));
    const pts: Pt[] = [c];
    for (let q = 0; q <= n; q++) {
      const a = a0 + ((a1 - a0) * q) / n;
      pts.push({ x: c.x + Math.sin(a) * rim(a), y: c.y - Math.cos(a) * rim(a) });
    }
    sk.draw(`slice:${sl.label}`, (pen) => closedStroke(pen, pts, 0.2), shapeStyle(colours[i]));
  });
  placed.forEach((p, i) => {
    if (p.leader) sk.draw(`leader:${slices[i].label}`, (pen) => pen.line(p.leader![0], p.leader![1]), { color: INK.line });
    sk.write(`label:${slices[i].label}`, p.layout, p.at, p.align, p.valign);
  });
  return sk.finish(box, LECTURE_PACE.chart, L, { x: 0, y: 0 });
}

/** A colour per slice, the palette in turn, never the same as a neighbour (the last one meets the first). */
function sliceColours(n: number): LectureInk[] {
  const out = Array.from({ length: n }, (_, i) => seriesInk(i));
  if (n > 2 && out[n - 1] === out[0]) out[n - 1] = SERIES_INKS.find((c) => c !== out[0] && c !== out[n - 2])!;
  return out;
}

function segmentNear(seg: [Pt, Pt], r: Rect): boolean {
  const [a, b] = seg;
  const n = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 3));
  for (let i = 0; i <= n; i++) {
    const p = { x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n };
    if (p.x >= r.x - 3 && p.x <= r.x + r.w + 3 && p.y >= r.y - 3 && p.y <= r.y + r.h + 3) return true;
  }
  return false;
}

export function sketchPie(spec: PieChart, box: { w: number; h: number }, seed: number): LectureSketch | null {
  if (spec.slices.length < 1 || spec.slices.some((s) => !(s.value > 0) || !Number.isFinite(s.value))) return null;
  for (const k of PIE.levels) {
    const r = attempt(spec, innerBox(box), k, seed);
    if (r && inside(r.plan.bounds, box)) return r;
  }
  return null;
}
