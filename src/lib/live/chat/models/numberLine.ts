import type { Rect } from "../../contracts";
import { rectsOverlap, type Pt } from "../../graphing/pen";
import { curvedArrow } from "../../lecture/chart/sketch";
import type { VisualModel } from "../contracts";
import { fracLatex, measureLabel, MODEL_TEXT, ModelInk, numLatex, type LabelSize, type ModelSketch } from "./kit";
import { autoStep, intervalsOf, MAX_TICKS, same, stepDenominator } from "./maths";

/**
 * A number line as a teacher draws one: the line with an arrow at each end, evenly spaced ticks,
 * the numbers under them — every one when they fit, else every 2nd, 5th or 10th (a fraction step's
 * whole numbers first), always the ends and every number a jump or a mark lands on — then the marks
 * (a dot on the line, its label above) and the jumps: smooth arcs over the line from where they
 * start to where they land, an arrowhead at the end, each one's size written above its top ("+4",
 * worked out by the board when the spec gives none). Jumps that overlap are drawn one over the
 * other, never through each other's labels. A fraction step's ticks are written as fractions
 * (1/4, 2/4, 3/4, 1), its whole numbers on longer ticks.
 */

type NumberLine = Extract<VisualModel, { kind: "number_line" }>;

export const NUMBER_LINE = {
  /** the widest gap between two ticks: a short line is not stretched across the board */
  maxSpacing: 110,
  /** the closest two ticks may be */
  minSpacing: 16,
  /** the line runs on past the end ticks, to its arrowheads */
  overhang: 26,
  arrow: 12,
  tickHalf: { major: 12, minor: 8 },
  /** px from the end of a tick down to its number */
  numberGap: 8,
  /** px kept between two numbers side by side */
  labelGap: 10,
  /** a jump's arc rises this much of its width, within min–max, then higher to clear what is under it */
  arc: { frac: 0.32, min: 24, max: 80, step: 8, ceiling: 260 },
  /** an arc starts and lands this far above the line */
  arcFoot: 3,
  /** px from an arc's top to its label */
  arcLabelGap: 5,
  markR: 6.5,
} as const;

const JUMP_INK = "orange" as const;
const MARK_INK = "violet" as const;

/** A tick's number as the hand writes it: a fraction step's in its denominator (2/4 stays 2/4), whole numbers whole. */
function valueLatex(v: number, den: number): string {
  if (den > 0 && !same(v, Math.round(v))) {
    const n = Math.round(v * den);
    return `${n < 0 ? "-" : ""}${fracLatex(Math.abs(n), den)}`;
  }
  return numLatex(v);
}

/** A jump's size as the board works it out: +4, -3, +1/4. */
function jumpLatex(from: number, to: number, den: number): string {
  const d = to - from;
  return `${d > 0 ? "+" : "-"}${valueLatex(Math.abs(d), den)}`;
}

interface Label {
  x: number;
  text: string;
  size: LabelSize;
}

/** Labels side by side under the line: none closer than `gap` px. */
function clash(a: Label, b: Label, gap: number): boolean {
  return Math.abs(a.x - b.x) < (a.size.w + b.size.w) / 2 + gap;
}

/** The arc of a jump from xa to xb, its top `h` above the line's `y` (y down). */
function arcPoints(xa: number, xb: number, y: number, h: number): Pt[] {
  const n = Math.max(12, Math.ceil(Math.abs(xb - xa) / 4));
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push({ x: xa + (xb - xa) * t, y: y - NUMBER_LINE.arcFoot - h * Math.sin(Math.PI * t) });
  }
  return out;
}

function pointsHit(pts: readonly Pt[], r: Rect, pad: number): boolean {
  return pts.some((p) => p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad);
}

function attempt(spec: NumberLine, box: { w: number; h: number }, seed: number, size: number): ModelSketch | null {
  const N = NUMBER_LINE;
  const { from, to } = spec;
  const step = spec.step ?? autoStep(from, to);
  const { n } = intervalsOf(from, to, step);
  if (n < 1 || n + 1 > MAX_TICKS) return null;
  const den = stepDenominator(step);
  const values = Array.from({ length: n + 1 }, (_, k) => Math.round((from + k * step) * 1e9) / 1e9);
  const onTick = (v: number) => values.findIndex((t) => same(t, v));

  // the numbers under the line, measured
  const tickText = values.map((v) => valueLatex(v, den));
  const tickSize: LabelSize[] = [];
  for (const t of tickText) {
    const m = measureLabel(t, size);
    if (!m) return null;
    tickSize.push(m);
  }
  // values a jump or a mark lands on between ticks: a tick and a number of their own
  const extra = new Map<number, string>();
  for (const j of spec.jumps) for (const v of [j.from, j.to]) if (onTick(v) < 0) extra.set(v, valueLatex(v, den));
  for (const m of spec.marks) if (!m.label && onTick(m.at) < 0) extra.set(m.at, valueLatex(m.at, den));

  // across: as long as the box allows, never more than maxSpacing between ticks
  const firstW = tickSize[0].w;
  const lastW = tickSize[n].w;
  const mL = Math.max(N.overhang + 4, firstW / 2 + 2);
  const mR = Math.max(N.overhang + 4, lastW / 2 + 2);
  const L = Math.min(box.w - mL - mR - 8, n * N.maxSpacing);
  const sp = L / n;
  if (!(sp >= N.minSpacing)) return null;
  const x = (v: number) => mL + ((v - from) / (to - from)) * L;

  // which ticks get their number: a regular every-k, plus the ends and what jumps and marks land on
  const priority = new Set<number>([0, n]);
  for (const j of spec.jumps) for (const v of [j.from, j.to]) if (onTick(v) >= 0) priority.add(onTick(v));
  for (const m of spec.marks) if (!m.label && onTick(m.at) >= 0) priority.add(onTick(m.at));
  const ladder = den > 0 ? [...new Set([1, den % 2 === 0 ? 2 : den, den, 2 * den, 5 * den, 10 * den])].sort((a, b) => a - b) : [1, 2, 5, 10, 20, 25, 50, 100];
  const extraLabels: Label[] = [...extra.entries()].map(([v, t]) => ({ x: x(v), text: t, size: measureLabel(t, size)! }));
  if (extraLabels.some((l) => !l.size)) return null;
  // A regular pattern (every 1st, 2nd, 5th…) is kept only whole: one that would lose a number beside
  // an end or a landing point reads as random (0 2 5 8 10…), so the next, sparser one is tried;
  // when none is clear, only the ends and the landing points are written.
  const label = (k: number): Label => ({ x: x(values[k]), text: tickText[k], size: tickSize[k] });
  const clear = (ls: readonly Label[]) => {
    const sorted = [...ls].sort((a, b) => a.x - b.x);
    return sorted.every((l, i) => i === 0 || !clash(sorted[i - 1], l, N.labelGap));
  };
  let shown: number[] | null = null;
  for (const every of [...ladder, Infinity]) {
    const keep = new Set<number>(priority);
    if (every !== Infinity) for (let k = 0; k <= n; k++) if (Math.round(values[k] / step) % every === 0) keep.add(k);
    if (clear([...[...keep].map(label), ...extraLabels])) {
      shown = [...keep].sort((a, b) => a - b);
      break;
    }
  }
  if (!shown) return null;

  const ink = new ModelInk(seed);
  const lineY = 0;
  const x0 = x(from) - N.overhang;
  const x1 = x(to) + N.overhang;
  ink.draw("line", (pen) => [...pen.line({ x: x0, y: lineY }, { x: x1, y: lineY }), ...pen.arrowhead({ x: x1, y: lineY }, 1, 0, N.arrow), ...pen.arrowhead({ x: x0, y: lineY }, -1, 0, N.arrow)]);
  // whole numbers on a fraction (or decimal) line are the longer ticks
  const major = (v: number) => step >= 1 - 1e-9 || same(v, Math.round(v));
  ink.draw("ticks", (pen) =>
    [...values, ...extra.keys()].flatMap((v) => {
      const half = major(v) ? N.tickHalf.major : N.tickHalf.minor;
      return pen.line({ x: x(v), y: lineY - half }, { x: x(v), y: lineY + half });
    }),
  );
  const numbersTop = lineY + N.tickHalf.major + N.numberGap;
  const placed: Rect[] = [];
  for (const k of shown) {
    const r = ink.label(`number:${k}`, tickText[k], { x: x(values[k]), y: numbersTop }, "center", "top", size);
    if (!r) return null;
    placed.push(r);
  }
  for (const e of extraLabels) {
    const r = ink.label(`number:${e.text}`, e.text, { x: e.x, y: numbersTop }, "center", "top", size);
    if (!r) return null;
    placed.push(r);
  }
  const numbersBottom = Math.max(numbersTop, ...placed.map((r) => r.y + r.h));

  // marks: a dot on the line, the label above it (or, when the jumps take that space, under the numbers)
  const arcs: Pt[][] = [];
  const markLabels: Array<{ part: string; text: string; x: number }> = [];
  spec.marks.forEach((m, i) => {
    ink.draw(`mark:${i}`, (pen) => pen.disc({ x: x(m.at), y: lineY }, N.markR), { color: MARK_INK });
    if (m.label) markLabels.push({ part: `mark:${i}:label`, text: m.label, x: x(m.at) });
  });

  // jumps: the smallest first, each arc as low as it can go without running through what is already there
  const order = spec.jumps.map((j, i) => ({ j, i })).sort((a, b) => Math.abs(a.j.to - a.j.from) - Math.abs(b.j.to - b.j.from));
  const jumpParts: Array<{ i: number; pts: Pt[]; label: string; at: Pt }> = [];
  const taken: Rect[] = [];
  for (const { j, i } of order) {
    const xa = x(j.from);
    const xb = x(j.to);
    const text = j.label ?? jumpLatex(j.from, j.to, den);
    const m = measureLabel(text, size);
    if (!m) return null;
    let h = Math.min(N.arc.max, Math.max(N.arc.min, Math.abs(xb - xa) * N.arc.frac));
    for (;;) {
      const pts = arcPoints(xa, xb, lineY, h);
      const top = lineY - N.arcFoot - h;
      const at = { x: (xa + xb) / 2, y: top - N.arcLabelGap };
      const rect = { x: at.x - m.w / 2, y: at.y - m.h, w: m.w, h: m.h };
      const clear = !taken.some((t) => pointsHit(pts, t, 4) || rectsOverlap(t, rect, 6)) && !arcs.some((a) => pointsHit(a, rect, 5));
      if (clear) {
        arcs.push(pts);
        taken.push(rect);
        jumpParts.push({ i, pts, label: text, at });
        break;
      }
      h += N.arc.step;
      if (h > N.arc.ceiling) return null;
    }
  }
  // drawn in the order given, each arc then its size
  jumpParts.sort((a, b) => a.i - b.i);
  for (const p of jumpParts) {
    ink.draw(`jump:${p.i}`, (pen) => curvedArrow(pen, p.pts, N.arrow), { color: JUMP_INK });
    if (!ink.label(`jump:${p.i}:label`, p.label, p.at, "center", "bottom", size, JUMP_INK)) return null;
  }
  for (const ml of markLabels) {
    const m = measureLabel(ml.text, size);
    if (!m) return null;
    const above = { x: ml.x - m.w / 2, y: lineY - N.markR - 8 - m.h, w: m.w, h: m.h };
    const clearAbove = !arcs.some((a) => pointsHit(a, above, 5)) && !ink.hitsText(above, 6);
    const at = clearAbove ? { x: ml.x, y: lineY - N.markR - 8 } : { x: ml.x, y: numbersBottom + 10 };
    const r = ink.label(ml.part, ml.text, at, "center", clearAbove ? "bottom" : "top", size, MARK_INK);
    if (!r) return null;
    if (!clearAbove && ink.texts.some((t) => t.part !== ml.part && rectsOverlap(t.rect, r, 6))) return null;
  }
  return ink.finish(box);
}

export function planNumberLine(spec: NumberLine, box: { w: number; h: number }, seed: number): ModelSketch | null {
  if (!(spec.to > spec.from)) return null;
  for (let size = MODEL_TEXT.label; size >= MODEL_TEXT.min; size -= 2) {
    const s = attempt(spec, box, seed, size);
    if (s) return s;
  }
  return null;
}
