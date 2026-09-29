import type { Rect } from "../../contracts";
import type { DiagramSpec } from "../contracts";
import { measureWords, type WordsLayout } from "../words";
import type { LectureSketch } from "../chart/sketch";
import { DIAGRAM, boxNode, drawDiagram, fitAll, nodeSize, roomUnder, sizesAt, type Item } from "./layout";

/**
 * A flow as a teacher draws one: each step in a box, an arrow to the next, an arrow's label
 * written over it, left to right and then snaking — down, right to left, down — so the arrows
 * always say which way to read.
 *
 * LIVE. The columns are fixed by the box, not by the steps (three across the big box; as many as
 * there are steps when there are fewer): a step said later goes in the next slot and nothing drawn
 * moves — unless its box is taller than the others (every box is as tall as the tallest) or its
 * words need a smaller hand. When that grid will not hold the steps at a size, the flow is laid out
 * to fit them at that size instead: one row, a snake over two or three rows, two columns, one column.
 *
 * Parts: "node:<i>" (its box), "node:<i>:text", "arrow:<i>-<i+1>", "arrow:<i>-<i+1>:label".
 */

export type FlowDiagram = Extract<DiagramSpec, { kind: "flow" }>;

export const FLOW = {
  /** the least room between two columns (for an arrow) and between two rows */
  gap: { x: 42, y: 34 },
  /** an arrow's label: its widest, and its room round it */
  label: { maxW: 118, pad: 14 },
  /** a box is at least this wide (a lone short word in a tiny box looks like a button) */
  minBoxW: 76,
  /** the fixed grid: a column is at least this wide */
  minColW: 140,
  /** the steps' boxes */
  accent: "orange",
} as const;

/**
 * The layout in `C` columns (n = a row; 1 = a column), writing at level k; null when it does not fit
 * `room`. `fixed`: every column the same width, from the room (the live grid); else each column as
 * wide as its steps and the gaps as wide as their labels, the whole centred in the room.
 */
function layoutFlow(spec: FlowDiagram, C: number, k: number, room: { w: number; h: number }, fixed: boolean): Item[] | null {
  const n = spec.steps.length;
  const rows = Math.ceil(n / C);
  const { node: size, small } = sizesAt(k);
  const P = DIAGRAM.node.padX;
  const rowOf = (i: number) => Math.floor(i / C);
  const colOf = (i: number) => (rowOf(i) % 2 === 0 ? i % C : C - 1 - (i % C));

  // the arrows' labels, and the room they need
  const labels: Array<WordsLayout | null> = [];
  for (let i = 0; i < n - 1; i++) {
    const a = spec.arrows?.[i]?.trim();
    if (!a) {
      labels.push(null);
      continue;
    }
    const m = measureWords(a, small, { maxWidth: FLOW.label.maxW, maxLines: 2, balance: true });
    if (!m) return null;
    labels.push(m);
  }
  const gapW = Array(Math.max(0, C - 1)).fill(FLOW.gap.x) as number[];
  const gapH = Array(Math.max(0, rows - 1)).fill(FLOW.gap.y) as number[];
  for (let i = 0; i < n - 1; i++) {
    const l = labels[i];
    if (!l) continue;
    if (rowOf(i) === rowOf(i + 1)) {
      // the live grid's gaps are fixed: a label must fit between the two boxes as they come out
      if (!fixed) {
        const j = Math.min(colOf(i), colOf(i + 1));
        gapW[j] = Math.max(gapW[j], l.w + FLOW.label.pad * 2);
      }
    } else gapH[rowOf(i)] = Math.max(gapH[rowOf(i)], l.h + 2 * DIAGRAM.linkGap + 10);
  }

  // every step's words in a column's width
  const slotW = (room.w - gapW.reduce((a, b) => a + b, 0)) / C;
  if (fixed && slotW < FLOW.minColW) return null;
  const colText = slotW - 2 * P;
  if (colText < 40) return null;
  const texts = fitAll(spec.steps, size, colText);
  if (!texts) return null;
  const sizes = texts.map((t) => nodeSize(t));
  const H = Math.max(...sizes.map((s) => s.h));
  const boxW = (i: number) => Math.max(sizes[i].w, Math.min(FLOW.minBoxW, colText + 2 * P));
  const colW = Array(C).fill(fixed ? slotW : 0) as number[];
  if (!fixed) for (let i = 0; i < n; i++) colW[colOf(i)] = Math.max(colW[colOf(i)], boxW(i));
  const total = colW.reduce((a, b) => a + b, 0) + gapW.reduce((a, b) => a + b, 0);
  const x0 = fixed ? 0 : (room.w - total) / 2;
  const colX: number[] = [x0];
  for (let j = 1; j < C; j++) colX.push(colX[j - 1] + colW[j - 1] + gapW[j - 1]);
  const rowY: number[] = [0];
  for (let r = 1; r < rows; r++) rowY.push(rowY[r - 1] + H + gapH[r - 1]);
  if (total > room.w + 0.5 || rowY[rows - 1] + H > room.h + 0.5) return null;

  const rects: Rect[] = sizes.map((_, i) => {
    const w = boxW(i);
    return { x: colX[colOf(i)] + (colW[colOf(i)] - w) / 2, y: rowY[rowOf(i)], w, h: H };
  });

  const items: Item[] = [];
  const g = DIAGRAM.linkGap;
  for (let i = 0; i < n; i++) {
    items.push(...boxNode(rects[i], texts[i], `node:${i}`, FLOW.accent));
    if (i === n - 1) break;
    const a = rects[i];
    const b = rects[i + 1];
    const label = labels[i];
    const part = `arrow:${i}-${i + 1}`;
    if (rowOf(i) === rowOf(i + 1)) {
      const right = b.x > a.x;
      const y = a.y + a.h / 2;
      const from = { x: right ? a.x + a.w + g : a.x - g, y };
      const to = { x: right ? b.x - g : b.x + b.w + g, y };
      if (Math.abs(to.x - from.x) < Math.max(24, label ? label.w + 2 * (FLOW.label.pad - DIAGRAM.linkGap) : 0)) return null;
      items.push({ t: "arrow", pts: [from, to], part });
      if (label) items.push({ t: "text", layout: label, at: { x: (from.x + to.x) / 2, y: y - 7 }, align: "center", valign: "bottom", part: `${part}:label` });
    } else {
      // the turn: straight down to the next row, its label on the inside of the bend
      const x = a.x + a.w / 2;
      const from = { x, y: a.y + a.h + g };
      const to = { x, y: b.y - g };
      items.push({ t: "arrow", pts: [from, to], part });
      if (label) {
        const inner = C === 1 || colOf(i) === 0 ? "left" : "right";
        items.push({ t: "text", layout: label, at: { x: inner === "left" ? x + 13 : x - 13, y: (from.y + to.y) / 2 }, align: inner, valign: "middle", part: `${part}:label` });
      }
    }
  }
  return items;
}

export function sketchFlow(spec: FlowDiagram, box: { w: number; h: number }, seed: number): LectureSketch | null {
  const n = spec.steps.length;
  if (n < 1) return null;
  // the other shapes, when the live grid will not do: a row; a snake over two or three rows; two columns; one column
  const shapes = [...new Set([1, 2, 3, Math.ceil(n / 2), n].filter((r) => r <= n))];
  const draw = (items: Item[] | null, k: number, anchor: "room" | "content") => (items ? drawDiagram(items, spec.title, box, k, seed, sizesAt(k).node, anchor) : null);
  // the largest writing first; at each size the live grid (as many columns as the box holds, as
  // many as there are steps when fewer), then the shapes fitted to the steps
  for (const k of DIAGRAM.levels) {
    const room = roomUnder(spec.title, box, k);
    if (!room) continue;
    const most = Math.max(1, Math.floor((room.w + FLOW.gap.x) / (FLOW.minColW + FLOW.gap.x)));
    const out = draw(layoutFlow(spec, Math.min(n, most), k, room, true), k, "room");
    if (out) return out;
    for (const R of shapes) {
      const fitted = draw(layoutFlow(spec, Math.ceil(n / R), k, room, false), k, "content");
      if (fitted) return fitted;
    }
  }
  return null;
}
