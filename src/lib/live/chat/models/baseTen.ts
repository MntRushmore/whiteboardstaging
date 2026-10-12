import type { Rect } from "../../contracts";
import type { Pen } from "../../graphing/pen";
import type { Stroke } from "@/lib/hand";
import type { LectureInk } from "../../lecture/contracts";
import type { VisualModel } from "../contracts";
import { handRect, measureLabel, MODEL_TEXT, ModelInk, tinted, type ModelSketch } from "./kit";

/**
 * Base-ten blocks as a teacher draws them, to scale on one unit `u`: hundreds as flats (10 × 10
 * grids, up to three a row), tens as rods (10 cells tall, side by side), ones as small cubes (in a
 * column of up to five, then another), left to right; each place in its own light colour, its
 * cells drawn with a fine pen so a grid reads as a grid, and under each its count in words ("3
 * hundreds", "4 tens", "5 ones"). A place with no blocks (the 0 of 305) is left out.
 */

type BaseTen = Extract<VisualModel, { kind: "base_ten" }>;

export const BASE_TEN = {
  /** the unit (one cube's side): at most / at least */
  maxU: 15,
  minU: 8.5,
  /** between two flats / rods / cubes, as a fraction of u */
  flatGap: 0.7,
  rodGap: 0.55,
  cubeGap: 0.45,
  /** flats in a row: three, or two when the box is narrow */
  flatsPerRow: [3, 2],
  /** cubes in a column */
  cubesPerColumn: 5,
  /** between two places' blocks */
  placeGap: 28,
  /** the blocks to their count */
  labelGap: 16,
  /** a grid's inner lines are drawn this fine */
  gridWeight: 0.42,
} as const;

const PLACE_INK: Record<"hundreds" | "tens" | "ones", LectureInk> = { hundreds: "green", tens: "orange", ones: "violet" };

/** A block: its outline (tinted inside), then its inner lines, fine. */
function block(ink: ModelInk, part: string, r: Rect, cols: number, rows: number, color: LectureInk): void {
  ink.draw(part, (pen) => handRect(pen, r), tinted(color));
  if (cols > 1 || rows > 1) {
    ink.draw(
      `${part}:grid`,
      (pen: Pen): Stroke[] => [
        ...Array.from({ length: cols - 1 }, (_, i) => pen.line({ x: r.x + (r.w * (i + 1)) / cols, y: r.y }, { x: r.x + (r.w * (i + 1)) / cols, y: r.y + r.h })).flat(),
        ...Array.from({ length: rows - 1 }, (_, i) => pen.line({ x: r.x, y: r.y + (r.h * (i + 1)) / rows }, { x: r.x + r.w, y: r.y + (r.h * (i + 1)) / rows })).flat(),
      ],
      { color },
      BASE_TEN.gridWeight,
    );
  }
}

const countWords = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function attempt(spec: BaseTen, box: { w: number; h: number }, seed: number, size: number, u: number, flatsPerRow: number): ModelSketch | null {
  const B = BASE_TEN;
  const hundreds = Math.floor(spec.value / 100);
  const tens = Math.floor(spec.value / 10) % 10;
  const ones = spec.value % 10;
  type Place = { key: "hundreds" | "tens" | "ones"; count: number; label: string; w: number; h: number };
  const places: Place[] = [];
  if (hundreds > 0) {
    const perRow = Math.min(flatsPerRow, hundreds);
    const rows = Math.ceil(hundreds / flatsPerRow);
    places.push({ key: "hundreds", count: hundreds, label: countWords(hundreds, "hundred", "hundreds"), w: perRow * 10 * u + (perRow - 1) * B.flatGap * u, h: rows * 10 * u + (rows - 1) * B.flatGap * u });
  }
  if (tens > 0) places.push({ key: "tens", count: tens, label: countWords(tens, "ten", "tens"), w: tens * u + (tens - 1) * B.rodGap * u, h: 10 * u });
  if (ones > 0) {
    const cols = Math.ceil(ones / B.cubesPerColumn);
    const rows = Math.min(ones, B.cubesPerColumn);
    places.push({ key: "ones", count: ones, label: countWords(ones, "one", "ones"), w: cols * u + (cols - 1) * B.cubeGap * u, h: rows * u + (rows - 1) * B.cubeGap * u });
  }
  if (places.length === 0) return null;
  const labels = places.map((p) => measureLabel(p.label, size));
  if (labels.some((l) => !l)) return null;
  // each place's column is as wide as its blocks or its words
  const colW = places.map((p, i) => Math.max(p.w, labels[i]!.w));
  const width = colW.reduce((a, b) => a + b, 0) + (places.length - 1) * B.placeGap;
  const blocksH = Math.max(...places.map((p) => p.h));
  const labelH = Math.max(...labels.map((l) => l!.h));
  if (width > box.w - 8 || blocksH + B.labelGap + labelH > box.h - 8) return null;

  const ink = new ModelInk(seed);
  let left = 0;
  places.forEach((p, i) => {
    const x = left + (colW[i] - p.w) / 2;
    // the blocks stand on one line: a short column of cubes sits at the bottom, beside the rods
    const y = blocksH - p.h;
    const color = PLACE_INK[p.key];
    for (let k = 0; k < p.count; k++) {
      if (p.key === "hundreds") {
        const col = k % flatsPerRow;
        const row = Math.floor(k / flatsPerRow);
        block(ink, `flat:${k}`, { x: x + col * (10 + B.flatGap) * u, y: y + row * (10 + B.flatGap) * u, w: 10 * u, h: 10 * u }, 10, 10, color);
      } else if (p.key === "tens") {
        block(ink, `rod:${k}`, { x: x + k * (1 + B.rodGap) * u, y, w: u, h: 10 * u }, 1, 10, color);
      } else {
        const col = Math.floor(k / B.cubesPerColumn);
        const row = k % B.cubesPerColumn;
        const rows = Math.min(p.count, B.cubesPerColumn);
        // a column of cubes from the bottom up
        const cy = y + (rows - 1 - row) * (1 + B.cubeGap) * u;
        block(ink, `cube:${k}`, { x: x + col * (1 + B.cubeGap) * u, y: cy, w: u, h: u }, 1, 1, color);
      }
    }
    ink.label(`count:${p.key}`, p.label, { x: left + colW[i] / 2, y: blocksH + B.labelGap }, "center", "top", size);
    left += colW[i] + B.placeGap;
  });
  if (ink.texts.length !== places.length) return null;
  return ink.finish(box);
}

export function planBaseTen(spec: BaseTen, box: { w: number; h: number }, seed: number): ModelSketch | null {
  if (!(spec.value >= 1)) return null;
  for (let u = BASE_TEN.maxU; u >= BASE_TEN.minU - 1e-9; u -= 0.5) {
    for (const perRow of BASE_TEN.flatsPerRow) {
      for (let size = MODEL_TEXT.words; size >= MODEL_TEXT.wordsMin; size -= 4) {
        const s = attempt(spec, box, seed, size, u, perRow);
        if (s) return s;
      }
    }
  }
  return null;
}
