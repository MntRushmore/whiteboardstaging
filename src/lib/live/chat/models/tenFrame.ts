import type { VisualModel } from "../contracts";
import { counter, handRect, ModelInk, tinted, type ModelSketch } from "./kit";

/**
 * Ten frames as a teacher draws them: a 2 × 5 grid of square cells; counters fill the top row
 * left to right, then the bottom row, as children are taught to fill one. More than ten takes a
 * second frame under the first (or beside it in a wide, short box), its counters in a second
 * colour, so 13 reads as "ten and 3 more". No writing: the counters are the point.
 */

type TenFrame = Extract<VisualModel, { kind: "ten_frame" }>;

export const TEN_FRAME = {
  maxCell: 68,
  minCell: 34,
  /** a counter's radius as a fraction of the cell */
  r: 0.34,
  /** between two frames, as a fraction of a cell */
  gap: 0.5,
} as const;

const INKS = ["orange", "green"] as const;

function attempt(spec: TenFrame, box: { w: number; h: number }, seed: number, stacked: boolean): ModelSketch | null {
  const F = TEN_FRAME;
  const frames = spec.filled > 10 ? 2 : 1;
  const across = stacked ? 5 : frames * 5 + (frames - 1) * F.gap;
  const down = stacked ? frames * 2 + (frames - 1) * F.gap : 2;
  const cell = Math.min(F.maxCell, (box.w - 8) / across, (box.h - 8) / down);
  if (cell < F.minCell) return null;
  const ink = new ModelInk(seed);
  for (let f = 0; f < frames; f++) {
    const ox = stacked ? 0 : f * (5 + F.gap) * cell;
    const oy = stacked ? f * (2 + F.gap) * cell : 0;
    ink.draw(`frame:${f}`, (pen) => handRect(pen, { x: ox, y: oy, w: 5 * cell, h: 2 * cell }));
    ink.draw(`frame:${f}:cells`, (pen) => [
      ...pen.line({ x: ox, y: oy + cell }, { x: ox + 5 * cell, y: oy + cell }),
      ...[1, 2, 3, 4].flatMap((i) => pen.line({ x: ox + i * cell, y: oy }, { x: ox + i * cell, y: oy + 2 * cell })),
    ]);
  }
  for (let f = 0; f < frames; f++) {
    const n = Math.max(0, Math.min(10, spec.filled - f * 10));
    if (n === 0) continue;
    const ox = stacked ? 0 : f * (5 + F.gap) * cell;
    const oy = stacked ? f * (2 + F.gap) * cell : 0;
    ink.draw(
      `frame:${f}:counters`,
      (pen) => Array.from({ length: n }, (_, k) => counter(pen, { x: ox + ((k % 5) + 0.5) * cell, y: oy + (Math.floor(k / 5) + 0.5) * cell }, cell * F.r)).flat(),
      tinted(INKS[f]),
      0.7,
    );
  }
  return ink.finish(box);
}

/** The cell a layout gets in this box: two frames go side by side only when that makes them clearly bigger. */
function cellFor(box: { w: number; h: number }, frames: number, stacked: boolean): number {
  const F = TEN_FRAME;
  const across = stacked ? 5 : frames * 5 + (frames - 1) * F.gap;
  const down = stacked ? frames * 2 + (frames - 1) * F.gap : 2;
  return Math.min(F.maxCell, (box.w - 8) / across, (box.h - 8) / down);
}

export function planTenFrame(spec: TenFrame, box: { w: number; h: number }, seed: number): ModelSketch | null {
  const frames = spec.filled > 10 ? 2 : 1;
  const side = frames === 2 && cellFor(box, 2, false) > cellFor(box, 2, true) * 1.15;
  return attempt(spec, box, seed, !side) ?? (frames === 2 ? attempt(spec, box, seed, side) : null);
}
