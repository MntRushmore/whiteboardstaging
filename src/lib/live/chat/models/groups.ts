import type { Pt } from "../../graphing/pen";
import type { VisualModel } from "../contracts";
import { counter, fillInk, handCircle, measureLabel, MODEL_TEXT, ModelInk, tinted, FILL_EDGE_WEIGHT, type ModelSketch } from "./kit";

/**
 * Multiplication as a teacher draws it.
 *
 * ARRAY: rows × columns of round counters on an even grid, light orange inside a fine edge, drawn
 * row by row; under it the array's label (the spec's, else `rows × columns` — never the product:
 * that is the student's to count).
 *
 * EQUAL GROUPS: `groups` circles (a plate, a bag) in one row, or two when there are more than five,
 * each holding `each` counters in the same neat pattern (a dice five, rows of three), drawn a group
 * at a time; under them "3 groups of 4" (or the spec's label). An empty group (each = 0) is a plate
 * for sharing into.
 */

type ArrayModel = Extract<VisualModel, { kind: "array" }>;
type Groups = Extract<VisualModel, { kind: "equal_groups" }>;

export const ARRAY = {
  /** centre to centre of two counters: at most / at least */
  maxPitch: 60,
  minPitch: 22,
  /** a counter's radius as a fraction of the pitch */
  r: 0.34,
  /** the array to its label */
  labelGap: 18,
} as const;

export const GROUPS = {
  /** centre to centre of two counters in a group: at most / at least */
  maxPitch: 46,
  minPitch: 17,
  r: 0.36,
  /** a group's circle keeps this far (× pitch) out from its counters */
  pad: 0.62,
  /** between two groups (× the group's diameter), and the least */
  gap: 0.22,
  minGap: 18,
  /** most groups in a row */
  perRow: 5,
  labelGap: 18,
} as const;

const COUNTER_INK = "orange" as const;

function attemptArray(spec: ArrayModel, box: { w: number; h: number }, seed: number, size: number): ModelSketch | null {
  const A = ARRAY;
  const label = spec.label ?? `${spec.rows} \\times ${spec.cols}`;
  const m = measureLabel(label, size);
  if (!m) return null;
  const pitch = Math.min(A.maxPitch, (box.w - 8) / spec.cols, (box.h - 8 - A.labelGap - m.h) / spec.rows);
  if (pitch < A.minPitch) return null;
  const r = pitch * A.r;
  const ink = new ModelInk(seed);
  for (let i = 0; i < spec.rows; i++) {
    ink.draw(
      `row:${i}`,
      (pen) => Array.from({ length: spec.cols }, (_, j) => counter(pen, { x: pitch * (j + 0.5), y: pitch * (i + 0.5) }, r)).flat(),
      tinted(COUNTER_INK),
      0.7,
    );
  }
  const w = pitch * spec.cols;
  if (!ink.label("label", label, { x: w / 2, y: pitch * spec.rows + A.labelGap }, "center", "top", size)) return null;
  return ink.finish(box);
}

export function planArray(spec: ArrayModel, box: { w: number; h: number }, seed: number): ModelSketch | null {
  for (let size = MODEL_TEXT.label; size >= MODEL_TEXT.min; size -= 2) {
    const s = attemptArray(spec, box, seed, size);
    if (s) return s;
  }
  return null;
}

// ------------------------------------------------------------------ equal groups

/** Rows of counters for `n` in a group, top to bottom (each row centred): a dice five, rows of three… */
const PATTERNS: Record<number, number[]> = {
  0: [],
  1: [1],
  2: [2],
  3: [1, 2],
  4: [2, 2],
  5: [2, 1, 2],
  6: [3, 3],
  7: [2, 3, 2],
  8: [3, 2, 3],
  9: [3, 3, 3],
  10: [3, 4, 3],
  11: [4, 3, 4],
  12: [4, 4, 4],
};

/** Counter centres for `n`, in pitch units round (0, 0), and the radius (pitch units) they fill. */
function pattern(n: number): { pts: Pt[]; reach: number } {
  const rows = PATTERNS[n] ?? [];
  const rowStep = rows.some((c, i) => i > 0 && (c + rows[i - 1]) % 2 === 1) ? 0.87 : 1;
  const pts: Pt[] = [];
  rows.forEach((c, i) => {
    for (let j = 0; j < c; j++) pts.push({ x: j - (c - 1) / 2, y: (i - (rows.length - 1) / 2) * rowStep });
  });
  const reach = pts.reduce((a, p) => Math.max(a, Math.hypot(p.x, p.y)), 0);
  return { pts, reach };
}

function groupsLabel(spec: Groups): string {
  return spec.label ?? `${spec.groups} ${spec.groups === 1 ? "group" : "groups"} of ${spec.each}`;
}

function attemptGroups(spec: Groups, box: { w: number; h: number }, seed: number, size: number, rows: number): ModelSketch | null {
  const G = GROUPS;
  const label = groupsLabel(spec);
  const m = measureLabel(label, size);
  if (!m) return null;
  const perRow = Math.ceil(spec.groups / rows);
  if (perRow > G.perRow && rows === 1) return null;
  const { pts, reach } = pattern(spec.each);
  // a group's radius in pitch units: round its counters, with room inside the circle
  const R1 = Math.max(reach + G.r + G.pad, 1.1);
  // the pitch that fits: across, perRow circles and their gaps; down, the rows and the label
  const across = (box.w - 8) / (perRow * 2 * R1 * (1 + G.gap) - 2 * R1 * G.gap);
  const down = (box.h - 8 - G.labelGap - m.h) / (rows * 2 * R1 * (1 + G.gap) - 2 * R1 * G.gap);
  const pitch = Math.min(G.maxPitch, across, down);
  if (pitch < G.minPitch) return null;
  const R = R1 * pitch;
  const gap = Math.max(G.minGap, 2 * R * G.gap);
  const ink = new ModelInk(seed);
  const rowW = (k: number) => k * 2 * R + (k - 1) * gap;
  const fullW = rowW(perRow);
  for (let g = 0; g < spec.groups; g++) {
    const row = Math.floor(g / perRow);
    const inRow = Math.min(perRow, spec.groups - row * perRow);
    const left = (fullW - rowW(inRow)) / 2;
    const c = { x: left + R + (g - row * perRow) * (2 * R + gap), y: R + row * (2 * R + gap) };
    ink.draw(`group:${g}`, (pen) => handCircle(pen, c, R));
    if (pts.length > 0) {
      ink.draw(
        `group:${g}:counters`,
        (pen) => pts.flatMap((p) => counter(pen, { x: c.x + p.x * pitch, y: c.y + p.y * pitch }, pitch * G.r)),
        tinted(fillInk(0)),
        FILL_EDGE_WEIGHT + 0.3,
      );
    }
  }
  const bottom = rows * 2 * R + (rows - 1) * gap;
  if (!ink.label("label", label, { x: fullW / 2, y: bottom + G.labelGap }, "center", "top", size)) return null;
  return ink.finish(box);
}

export function planEqualGroups(spec: Groups, box: { w: number; h: number }, seed: number): ModelSketch | null {
  // one row when it holds them (and up to five), else two
  const rowsToTry = spec.groups <= GROUPS.perRow ? [1, 2] : [2];
  for (let size = MODEL_TEXT.words; size >= MODEL_TEXT.wordsMin; size -= 2) {
    for (const rows of rowsToTry) {
      if (rows > spec.groups) continue;
      const s = attemptGroups(spec, box, seed, size, rows);
      if (s) return s;
    }
  }
  return null;
}
