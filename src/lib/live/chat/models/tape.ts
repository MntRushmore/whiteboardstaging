import type { Rect } from "../../contracts";
import { rectsOverlap } from "../../graphing/pen";
import type { VisualModel } from "../contracts";
import { bracePoints, fillInk, fillRect, handRect, labelForm, measureLabel, MODEL_TEXT, ModelInk, type LabelSize, type ModelSketch } from "./kit";

/**
 * A tape (bar) diagram as a teacher draws one for a word problem: one or two rows of segments on
 * one scale — each segment as long as its units, so 3 units is three times 1 — the rows' left ends
 * lined up, each row's name to its left ("Sam", "Ann"), each segment's label inside it (or above or
 * under it when it is too narrow), the known parts lightly coloured in and an unknown one ("?", a
 * letter) left white, and the total with a curly brace: under a single row, or down the right of
 * two (what they make together), its label beside the brace's tip.
 */

type Tape = Extract<VisualModel, { kind: "tape" }>;

export const TAPE = {
  /** the longest row at most this long */
  maxLength: 680,
  /** a unit's least length */
  minUnit: 12,
  height: { max: 70, min: 52 },
  /** between two rows */
  rowGap: 26,
  /** a row's name to the row */
  nameGap: 16,
  /** the brace: how far it sits off the tape, its depth, and its tip to the total */
  braceGap: 10,
  braceDepth: 18,
  totalGap: 10,
  /** a segment's label keeps this far from its lines */
  labelPad: 8,
  inset: 4,
} as const;

/** A label for something unknown: "?" or a single letter (x, n). */
function unknown(label: string | undefined): boolean {
  if (!label) return false;
  const f = labelForm(label);
  return f.math && /^(\?|[a-zA-Z]|\\square)$/.test(f.latex.trim());
}

function attempt(spec: Tape, box: { w: number; h: number }, seed: number, size: number): ModelSketch | null {
  const T = TAPE;
  const rows = spec.rows;
  const two = rows.length === 2;
  const names = rows.map((r) => (r.label ? measureLabel(r.label, Math.min(size, MODEL_TEXT.words)) : null));
  if (rows.some((r, i) => r.label && !names[i])) return null;
  const nameW = Math.max(0, ...names.map((n) => n?.w ?? 0));
  const left = nameW > 0 ? nameW + T.nameGap : 0;
  const total = spec.total ? measureLabel(spec.total, size) : null;
  if (spec.total && !total) return null;
  // the brace's room: down the right of two rows, under one
  const right = two && total ? T.braceGap + T.braceDepth + T.totalGap + total.w : 0;
  const under = !two && total ? T.braceGap + T.braceDepth + T.totalGap + total.h : 0;
  const units = rows.map((r) => r.segments.reduce((a, s) => a + s.units, 0));
  const maxUnits = Math.max(...units);
  const length = Math.min(T.maxLength, box.w - 8 - left - right);
  const k = length / maxUnits;
  if (k * Math.min(...rows.flatMap((r) => r.segments.map((s) => s.units))) < T.minUnit) return null;
  const segM: Array<Array<LabelSize | null>> = rows.map((r) => r.segments.map((s) => (s.label ? measureLabel(s.label, size) : null)));
  if (rows.some((r, i) => r.segments.some((s, j) => s.label && !segM[i][j]))) return null;
  const labelH = Math.max(0, ...segM.flat().map((m) => m?.h ?? 0));
  const h = Math.min(T.height.max, Math.max(T.height.min, labelH * 2.3));
  // a label too wide for its segment goes outside it: over the first row, under the last
  const outside = rows.map((r, i) => r.segments.map((s, j) => (segM[i][j] ? segM[i][j]!.w + 2 * T.labelPad > s.units * k : false)));
  const aboveRoom = outside[0].some(Boolean) ? labelH + 8 : 0;
  const belowRoom = two && outside[1].some(Boolean) ? labelH + 8 : 0;
  const y0 = aboveRoom;
  const rowY = (i: number) => y0 + i * (h + T.rowGap);
  const tapeBottom = rowY(rows.length - 1) + h;
  if (tapeBottom + belowRoom + under > box.h - 8) return null;

  const ink = new ModelInk(seed);
  const placed: Rect[] = [];
  rows.forEach((row, i) => {
    const y = rowY(i);
    const w = units[i] * k;
    if (row.label) ink.label(`row:${i}:name`, row.label, { x: left - T.nameGap, y: y + h / 2 }, "right", "middle", Math.min(size, MODEL_TEXT.words));
    ink.draw(`row:${i}`, (pen) => handRect(pen, { x: left, y, w, h }));
    let x = left;
    const edges: number[] = [];
    row.segments.forEach((s, j) => {
      if (j > 0) edges.push(x);
      x += s.units * k;
    });
    if (edges.length) ink.draw(`row:${i}:split`, (pen) => edges.flatMap((ex) => pen.line({ x: ex, y }, { x: ex, y: y + h })));
    x = left;
    row.segments.forEach((s, j) => {
      const seg = { x, y, w: s.units * k, h };
      if (!unknown(s.label)) ink.fill(`row:${i}:seg:${j}:fill`, (pen) => fillRect(pen, seg, T.inset), fillInk(i));
      if (s.label) {
        const out = outside[i][j];
        const at = !out ? { x: seg.x + seg.w / 2, y: y + h / 2 } : i === 0 ? { x: seg.x + seg.w / 2, y: y - 8 } : { x: seg.x + seg.w / 2, y: y + h + 8 };
        const r = ink.label(`row:${i}:seg:${j}`, s.label, at, "center", !out ? "middle" : i === 0 ? "bottom" : "top", size);
        if (r) placed.push(r);
      }
      x += seg.w;
    });
  });
  if (spec.total) {
    const lastY = rowY(rows.length - 1);
    if (two) {
      const xr = left + maxUnits * k + T.braceGap;
      // down the right: from the top of the first row to the bottom of the second, tip to the right
      ink.draw("total:brace", (pen) => pen.polyline(bracePoints({ x: xr, y: rowY(0) }, { x: xr, y: lastY + h }, T.braceDepth), 0.25));
      ink.label("total", spec.total, { x: xr + T.braceDepth + T.totalGap, y: (rowY(0) + lastY + h) / 2 }, "left", "middle", size);
    } else {
      const yb = tapeBottom + T.braceGap;
      const w = units[0] * k;
      // under the row, tip down
      ink.draw("total:brace", (pen) => pen.polyline(bracePoints({ x: left + w, y: yb }, { x: left, y: yb }, T.braceDepth), 0.25));
      ink.label("total", spec.total, { x: left + w / 2, y: yb + T.braceDepth + T.totalGap }, "center", "top", size);
    }
  }
  // every label written, none touching another
  const expected = rows.reduce((a, r) => a + (r.label ? 1 : 0) + r.segments.filter((s) => s.label).length, 0) + (spec.total ? 1 : 0);
  if (ink.texts.length !== expected) return null;
  if (placed.some((r, i) => placed.some((q, j) => j > i && rectsOverlap(r, q, 4)))) return null;
  return ink.finish(box);
}

export function planTape(spec: Tape, box: { w: number; h: number }, seed: number): ModelSketch | null {
  for (let size = MODEL_TEXT.label; size >= MODEL_TEXT.min; size -= 2) {
    const s = attempt(spec, box, seed, size);
    if (s) return s;
  }
  return null;
}
