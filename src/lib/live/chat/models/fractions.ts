import type { Pt } from "../../graphing/pen";
import { closedStroke } from "../../lecture/chart/sketch";
import type { VisualModel } from "../contracts";
import { arcPoints, fillInk, fillRect, fracLatex, handCircle, handRect, measureLabel, MODEL_TEXT, ModelInk, type ModelSketch } from "./kit";

/**
 * Fraction bars and fraction circles as a teacher draws them to compare fractions.
 *
 * BARS: every bar the same length (one whole is one whole), stacked with their left ends lined up,
 * each split into equal parts by lines at exactly k/parts of its length, the first `shaded` parts
 * coloured in (each bar its own light colour), and its fraction written to the right, centred on
 * it (the spec's label, else shaded/parts as the board works it out).
 *
 * CIRCLES: side by side, the same size, each divided exactly — diameters for an even number of
 * parts, radii for an odd one — from 12 o'clock; the first `shaded` parts clockwise coloured in
 * inside their lines; the fraction written under each.
 */

type Bars = Extract<VisualModel, { kind: "fraction_bars" }>;
type Circles = Extract<VisualModel, { kind: "fraction_circles" }>;

export const FRACTION_BARS = {
  /** a bar's length: at most this, as long as the box allows */
  maxLength: 640,
  /** the narrowest a part may be */
  minPart: 15,
  height: { max: 70, min: 46 },
  /** between two bars, as a fraction of the bar's height */
  gap: 0.42,
  /** the bar to its fraction */
  labelGap: 22,
  /** a shaded part is coloured this far in from its lines */
  inset: 4,
} as const;

export const FRACTION_CIRCLES = {
  maxR: 130,
  minR: 54,
  /** the shortest a part's arc may be (px) */
  minArc: 24,
  /** between two circles */
  gap: 40,
  /** the circle to its fraction under it */
  labelGap: 14,
  inset: 4,
} as const;

/** The label of a fraction part: the spec's, else shaded/parts. */
function fractionLabel(it: { parts: number; shaded: number; label?: string }): string {
  return it.label ?? fracLatex(it.shaded, it.parts);
}

function attemptBars(spec: Bars, box: { w: number; h: number }, seed: number, size: number): ModelSketch | null {
  const B = FRACTION_BARS;
  const labels = spec.bars.map(fractionLabel);
  const sizes = labels.map((l) => measureLabel(l, size));
  if (sizes.some((s) => !s)) return null;
  const labelW = Math.max(...sizes.map((s) => s!.w));
  const n = spec.bars.length;
  const length = Math.min(B.maxLength, box.w - B.labelGap - labelW - 8);
  const maxParts = Math.max(...spec.bars.map((b) => b.parts));
  if (length / maxParts < B.minPart) return null;
  // as tall as the box allows (a fraction label stacks two numbers: the bar is at least that tall)
  const labelH = Math.max(...sizes.map((s) => s!.h));
  const fit = (box.h - 8) / (n + (n - 1) * B.gap);
  const h = Math.min(B.height.max, fit);
  if (h < Math.max(B.height.min, labelH * 0.8)) return null;
  const gap = Math.max(h * B.gap, labelH - h + 12);
  const ink = new ModelInk(seed);
  spec.bars.forEach((bar, i) => {
    const y = i * (h + gap);
    const r = { x: 0, y, w: length, h };
    ink.draw(`bar:${i}`, (pen) => handRect(pen, r));
    if (bar.parts > 1) {
      ink.draw(`bar:${i}:parts`, (pen) =>
        Array.from({ length: bar.parts - 1 }, (_, k) => {
          const x = (length * (k + 1)) / bar.parts;
          return pen.line({ x, y }, { x, y: y + h });
        }).flat(),
      );
    }
    const color = fillInk(i);
    for (let k = 0; k < Math.min(bar.shaded, bar.parts); k++) {
      const part = { x: (length * k) / bar.parts, y, w: length / bar.parts, h };
      ink.fill(`bar:${i}:shade:${k}`, (pen) => fillRect(pen, part, B.inset), color);
    }
    if (!ink.label(`bar:${i}:label`, labels[i], { x: length + B.labelGap, y: y + h / 2 }, "left", "middle", size)) return;
  });
  if (ink.texts.length !== n) return null;
  return ink.finish(box);
}

export function planFractionBars(spec: Bars, box: { w: number; h: number }, seed: number): ModelSketch | null {
  for (let size = MODEL_TEXT.fraction; size >= MODEL_TEXT.min; size -= 2) {
    const s = attemptBars(spec, box, seed, size);
    if (s) return s;
  }
  return null;
}

// ------------------------------------------------------------------ circles

/** Angle of part k's first edge: from 12 o'clock, clockwise (y down). */
const edge = (k: number, parts: number) => -Math.PI / 2 + (Math.PI * 2 * k) / parts;

/**
 * A shaded part of a circle, coloured in `inset` px inside its two edges and its arc: the wedge
 * between edges a0 and a1 drawn as one closed stroke.
 */
function wedge(c: Pt, r: number, a0: number, a1: number, inset: number, parts: number): Pt[] | null {
  const R = r - inset;
  if (parts === 1) return arcPoints(c, R, -Math.PI / 2, (Math.PI * 3) / 2);
  const half = (a1 - a0) / 2;
  const mid = a0 + half;
  // the corner where the two edges, each moved `inset` into the part, meet
  const tip = inset / Math.sin(half);
  if (tip > R * 0.7) return null;
  const corner = { x: c.x + tip * Math.cos(mid), y: c.y + tip * Math.sin(mid) };
  // where each moved edge meets the inner arc
  const along = Math.sqrt(R * R - inset * inset);
  const d = Math.atan2(inset, along);
  const arc = arcPoints(c, R, a0 + d, a1 - d);
  return [corner, ...arc, corner];
}

function attemptCircles(spec: Circles, box: { w: number; h: number }, seed: number, size: number): ModelSketch | null {
  const C = FRACTION_CIRCLES;
  const labels = spec.circles.map(fractionLabel);
  const sizes = labels.map((l) => measureLabel(l, size));
  if (sizes.some((s) => !s)) return null;
  const n = spec.circles.length;
  const labelH = Math.max(...sizes.map((s) => s!.h));
  const labelW = Math.max(...sizes.map((s) => s!.w));
  const r = Math.min(C.maxR, (box.w - 8 - (n - 1) * C.gap) / (2 * n), (box.h - 8 - C.labelGap - labelH) / 2);
  const maxParts = Math.max(...spec.circles.map((c) => c.parts));
  if (r < C.minR || (Math.PI * 2 * r) / maxParts < C.minArc) return null;
  const gap = Math.max(C.gap, labelW - 2 * r + 24);
  const ink = new ModelInk(seed);
  spec.circles.forEach((circle, i) => {
    const c = { x: r + i * (2 * r + gap), y: r };
    ink.draw(`circle:${i}`, (pen) => handCircle(pen, c, r));
    const p = circle.parts;
    if (p > 1) {
      ink.draw(`circle:${i}:parts`, (pen) => {
        const rim = (a: number) => ({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });
        // an even number of parts: diameters, as a hand cuts a pie; an odd one: radii from the centre
        if (p % 2 === 0) return Array.from({ length: p / 2 }, (_, k) => pen.line(rim(edge(k, p)), rim(edge(k + p / 2, p)))).flat();
        return Array.from({ length: p }, (_, k) => pen.line(c, rim(edge(k, p)))).flat();
      });
    }
    const color = fillInk(i);
    for (let k = 0; k < Math.min(circle.shaded, p); k++) {
      const pts = wedge(c, r, edge(k, p), edge(k + 1, p), C.inset, p);
      if (pts) ink.fill(`circle:${i}:shade:${k}`, (pen) => closedStroke(pen, pts, 0.15), color);
    }
    ink.label(`circle:${i}:label`, labels[i], { x: c.x, y: c.y + r + C.labelGap }, "center", "top", size);
  });
  if (ink.texts.length !== n) return null;
  return ink.finish(box);
}

export function planFractionCircles(spec: Circles, box: { w: number; h: number }, seed: number): ModelSketch | null {
  for (let size = MODEL_TEXT.fraction; size >= MODEL_TEXT.min; size -= 2) {
    const s = attemptCircles(spec, box, seed, size);
    if (s) return s;
  }
  return null;
}
