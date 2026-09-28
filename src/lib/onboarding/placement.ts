/**
 * Where a coach mark's popover goes: beside the piece of UI it is about, inside the viewport, and
 * never over the rects it must keep clear (the starter problem, and the space under it where the
 * student writes). Pure geometry in client pixels; `CoachMark` measures and calls it.
 */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Side = "top" | "bottom" | "left" | "right";

export interface Placement {
  x: number;
  y: number;
  side: Side;
  /**
   * Where the arrow meets the popover's edge, along it (px from the popover's left for
   * top/bottom, from its top for left/right) — null when the popover had to move away from the
   * anchor to keep something clear (the anchor keeps its highlight ring).
   */
  arrow: number | null;
  /** it could not avoid every rect it was asked to keep clear */
  overlaps: boolean;
}

export interface PlaceInput {
  anchor: Box;
  size: { w: number; h: number };
  viewport: { w: number; h: number };
  avoid?: readonly Box[];
  prefer?: readonly Side[];
  /** between the anchor and the popover */
  gap?: number;
  /** kept to the viewport's edges */
  margin?: number;
}

const ARROW_INSET = 16;

function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function overlapArea(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/**
 * Tries each side in order of preference and, on each side, the popover centred on the anchor,
 * aligned to its start and end, and then slid clear past each rect to avoid. The first candidate that
 * fits the viewport and touches neither the anchor nor an avoided rect wins; failing that, the
 * one covering the least of them.
 */
export function placeCoachMark({ anchor, size, viewport, avoid = [], prefer = ["bottom", "top", "right", "left"], gap = 12, margin = 12 }: PlaceInput): Placement {
  const maxX = viewport.w - margin - size.w;
  const maxY = viewport.h - margin - size.h;
  const candidates: Placement[] = [];
  const ax = anchor.x + anchor.w / 2;
  const ay = anchor.y + anchor.h / 2;

  for (const side of prefer) {
    if (side === "top" || side === "bottom") {
      const y = side === "bottom" ? anchor.y + anchor.h + gap : anchor.y - gap - size.h;
      if (y < margin || y > maxY) continue;
      const xs = [ax - size.w / 2, anchor.x, anchor.x + anchor.w - size.w];
      for (const r of avoid) xs.push(r.x + r.w + gap, r.x - gap - size.w);
      for (const raw of xs) {
        const x = clamp(raw, margin, maxX);
        const arrow = ax >= x + ARROW_INSET && ax <= x + size.w - ARROW_INSET ? ax - x : null;
        candidates.push({ x, y, side, arrow, overlaps: false });
      }
    } else {
      const x = side === "right" ? anchor.x + anchor.w + gap : anchor.x - gap - size.w;
      if (x < margin || x > maxX) continue;
      const ys = [ay - size.h / 2, anchor.y, anchor.y + anchor.h - size.h];
      for (const r of avoid) ys.push(r.y + r.h + gap, r.y - gap - size.h);
      for (const raw of ys) {
        const y = clamp(raw, margin, maxY);
        const arrow = ay >= y + ARROW_INSET && ay <= y + size.h - ARROW_INSET ? ay - y : null;
        candidates.push({ x, y, side, arrow, overlaps: false });
      }
    }
  }

  const boxOf = (p: Placement): Box => ({ x: p.x, y: p.y, w: size.w, h: size.h });
  const covered = (p: Placement) => avoid.reduce((n, r) => n + overlapArea(boxOf(p), r), 0) + overlapArea(boxOf(p), anchor);
  const clear = candidates.find((p) => !intersects(boxOf(p), anchor) && !avoid.some((r) => intersects(boxOf(p), r)));
  if (clear) return clear;
  if (candidates.length > 0) {
    const best = candidates.reduce((a, b) => (covered(b) < covered(a) ? b : a));
    return { ...best, overlaps: true };
  }
  // nothing fits on any side (a tiny viewport): pin it to the bottom edge, full width
  return { x: margin, y: Math.max(margin, maxY), side: "top", arrow: null, overlaps: true };
}
