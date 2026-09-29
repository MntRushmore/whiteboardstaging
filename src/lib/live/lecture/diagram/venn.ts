import type { Pt } from "../../graphing/pen";
import type { DiagramSpec } from "../contracts";
import type { LectureSketch } from "../chart/sketch";
import { fitWords, measureWords, type WordsLayout } from "../words";
import { DIAGRAM, drawDiagram, roomUnder, sizesAt, type Item } from "./layout";

/**
 * A Venn diagram as a teacher draws one: two overlapping circles (a little wider than tall, to
 * give the words room), each one's name above it, and the items written in the three regions —
 * what is only the left's, what both share (in the overlap), what is only the right's — one under
 * another, each line centred in the width its region has at that height.
 *
 * LIVE. An item added to a region re-centres that region's items; the circles and the names stay
 * while the items still fit. Parts: "circle:left", "circle:right", "name:left", "name:right",
 * "item:<left|both|right>:<i>".
 */

export type VennDiagram = Extract<DiagramSpec, { kind: "venn" }>;

export const VENN = {
  /** how much of a circle's width the overlap takes, tried in order */
  overlap: [0.46, 0.4, 0.52, 0.34, 0.58],
  /** px an item keeps inside its region's outlines */
  margin: 9,
  /** between two items of a region */
  gap: 5,
  /** a name to the top of its circle */
  nameGap: 8,
  /** the circles are no taller than this × their width */
  aspect: 1.08,
  ink: { left: "orange", right: "green" },
} as const;

type Region = "left" | "both" | "right";

/**
 * Each item's centre x in its region, row by row, or null when a row is wider than its region
 * there. `s(y)`: half the circle's width at height y, as a fraction of rx.
 */
function placeRegion(
  items: readonly WordsLayout[],
  region: Region,
  geo: { cxL: number; cxR: number; cy: number; rx: number; ry: number },
): Array<{ at: Pt; layout: WordsLayout; part: string }> | null {
  if (items.length === 0) return [];
  const { cxL, cxR, cy, rx, ry } = geo;
  const m = VENN.margin;
  const s = (y: number) => Math.sqrt(Math.max(0, 1 - ((y - cy) / ry) ** 2));
  const total = items.reduce((a, it) => a + it.h, 0) + (items.length - 1) * VENN.gap;
  let y = cy - total / 2;
  const out: Array<{ at: Pt; layout: WordsLayout; part: string }> = [];
  for (const [idx, it] of items.entries()) {
    const top = y;
    const bottom = y + it.h;
    const far = Math.abs(top - cy) > Math.abs(bottom - cy) ? top : bottom;
    const near = Math.min(bottom, Math.max(top, cy));
    let lo: number;
    let hi: number;
    if (region === "left") {
      lo = cxL - rx * s(far) + m;
      hi = cxR - rx * s(near) - m;
    } else if (region === "both") {
      lo = cxR - rx * s(far) + m;
      hi = cxL + rx * s(far) - m;
    } else {
      lo = cxL + rx * s(near) + m;
      hi = cxR + rx * s(far) - m;
    }
    if (hi - lo < it.w) return null;
    // left and right items lean towards the outside (the crescent is widest there); shared ones sit in the middle
    const x = (lo + hi) / 2;
    out.push({ at: { x, y: top + it.h / 2 }, layout: it, part: `item:${region}:${idx}` });
    y = bottom + VENN.gap;
  }
  return out;
}

function layoutVenn(spec: VennDiagram, k: number, overlap: number, room: { w: number; h: number }): Item[] | null {
  const { node: size, small } = sizesAt(k);
  // the circles: 2 rx + d = room width, the overlap 2 rx - d = overlap × 2 rx
  const rx = (room.w - 2) / (2 * (2 - overlap));
  const d = 2 * rx * (1 - overlap);
  const leftName = fitWords(spec.left, { maxWidth: rx + d / 2 - 8, maxLines: 1, maxSize: size, minSize: DIAGRAM.node.min });
  const rightName = fitWords(spec.right, { maxWidth: rx + d / 2 - 8, maxLines: 1, maxSize: size, minSize: DIAGRAM.node.min });
  if (!leftName || !rightName) return null;
  const nameH = Math.max(leftName.h, rightName.h) + VENN.nameGap;
  const ry = Math.min(rx * VENN.aspect, (room.h - nameH) / 2);
  if (ry < rx * 0.62) return null;
  const cxL = rx + 1;
  const cxR = rx + d;
  const cy = nameH + ry;
  const geo = { cxL, cxR, cy, rx, ry };
  const widths: Record<Region, number> = { left: d - 2 * VENN.margin, both: 2 * rx - d - 2 * VENN.margin, right: d - 2 * VENN.margin };
  const regions: Array<[Region, string[]]> = [
    ["left", spec.leftOnly],
    ["both", spec.both],
    ["right", spec.rightOnly],
  ];
  const placed: Array<{ at: Pt; layout: WordsLayout; part: string }> = [];
  for (const [region, texts] of regions) {
    const laid: WordsLayout[] = [];
    for (const t of texts) {
      const m = measureWords(t, small, { maxWidth: widths[region] * 0.92, maxLines: 2, balance: true });
      if (!m) return null;
      laid.push(m);
    }
    const p = placeRegion(laid, region, geo);
    if (!p) return null;
    placed.push(...p);
  }
  // each name over its own circle, kept to its own side of the middle
  const mid = (cxL + cxR) / 2;
  const lx = Math.min(cxL, mid - 8 - leftName.w / 2);
  const rxName = Math.max(cxR, mid + 8 + rightName.w / 2);
  // the circles in their own colours, not filled: the board's fills are opaque, and one would hide
  // the other where they overlap; each name in its circle's colour
  const items: Item[] = [
    { t: "ellipse", c: { x: cxL, y: cy }, rx, ry, part: "circle:left", style: { color: VENN.ink.left } },
    { t: "ellipse", c: { x: cxR, y: cy }, rx, ry, part: "circle:right", style: { color: VENN.ink.right } },
    { t: "text", layout: leftName, at: { x: lx, y: cy - ry - VENN.nameGap }, align: "center", valign: "bottom", part: "name:left", style: { color: VENN.ink.left } },
    { t: "text", layout: rightName, at: { x: rxName, y: cy - ry - VENN.nameGap }, align: "center", valign: "bottom", part: "name:right", style: { color: VENN.ink.right } },
    ...placed.map((p) => ({ t: "text" as const, layout: p.layout, at: p.at, align: "center" as const, valign: "middle" as const, part: p.part })),
  ];
  return items;
}

export function sketchVenn(spec: VennDiagram, box: { w: number; h: number }, seed: number): LectureSketch | null {
  for (const k of DIAGRAM.levels) {
    const room = roomUnder(spec.title, box, k);
    if (!room) continue;
    for (const o of VENN.overlap) {
      const items = layoutVenn(spec, k, o, room);
      const out = items ? drawDiagram(items, spec.title, box, k, seed, sizesAt(k).node) : null;
      if (out) return out;
    }
  }
  return null;
}
