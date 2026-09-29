import type { Rect } from "../../contracts";
import { rectsOverlap, type Pt } from "../../graphing/pen";
import type { DiagramSpec } from "../contracts";
import type { LectureSketch } from "../chart/sketch";
import { DIAGRAM, boxNode, drawDiagram, fitAll, nodeSize, roomUnder, sizesAt, type Item } from "./layout";

/**
 * A cycle as a teacher draws one: the steps round a loop, clockwise from the top, each in its box,
 * and a curved arrow along the loop from each to the next — the last back to the first. The loop
 * is an ellipse through the boxes' centres, as wide and tall as the box allows; the arrows are
 * its arcs between the boxes.
 *
 * LIVE. A step added to a cycle moves every step round the loop (they are spaced evenly): the
 * cycle is drawn again. Parts: "node:<i>", "node:<i>:text", "arrow:<i>-<j>".
 */

export type CycleDiagram = Extract<DiagramSpec, { kind: "cycle" }>;

export const CYCLE = {
  /** the widths tried for a step's words, widest first */
  textW: [150, 124, 104, 88],
  /** two boxes keep this far apart */
  nodeGap: 12,
  /** an arrow along the loop is at least this long */
  minArc: 20,
  /** the steps' boxes */
  accent: "green",
} as const;

function inGrown(p: Pt, r: Rect, by: number): boolean {
  return p.x > r.x - by && p.x < r.x + r.w + by && p.y > r.y - by && p.y < r.y + r.h + by;
}

/** The ellipse's px per radian at angle a. */
function speed(rx: number, ry: number, a: number): number {
  return Math.hypot(rx * Math.sin(a), ry * Math.cos(a));
}

interface Ring {
  rx: number;
  ry: number;
  rects: Rect[];
  /** each box's span along the loop (angles where the loop is inside the box, grown by the arrow's gap) */
  spans: Array<[number, number]>;
}

/** The loop and the boxes on it at angles `as`: as big as the room allows. */
function ring(sizes: ReadonlyArray<{ w: number; h: number }>, as: readonly number[], room: { w: number; h: number }, g: number): Ring | null {
  let rx = room.w / 2;
  let ry = room.h / 2;
  sizes.forEach((s, i) => {
    const cos = Math.abs(Math.cos(as[i]));
    const sin = Math.abs(Math.sin(as[i]));
    if (cos > 1e-6) rx = Math.min(rx, (room.w / 2 - s.w / 2 - 1) / cos);
    if (sin > 1e-6) ry = Math.min(ry, (room.h / 2 - s.h / 2 - 1) / sin);
  });
  if (!(rx > 50) || !(ry > 36)) return null;
  const c = { x: room.w / 2, y: room.h / 2 };
  const at = (a: number): Pt => ({ x: c.x + rx * Math.cos(a), y: c.y + ry * Math.sin(a) });
  const rects: Rect[] = sizes.map((s, i) => {
    const p = at(as[i]);
    return { x: p.x - s.w / 2, y: p.y - s.h / 2, w: s.w, h: s.h };
  });
  const spans = rects.map((r, i): [number, number] => {
    let lo = as[i];
    let hi = as[i];
    while (hi - as[i] < Math.PI && inGrown(at(hi), r, g)) hi += 0.01;
    while (as[i] - lo < Math.PI && inGrown(at(lo), r, g)) lo -= 0.01;
    return [lo, hi];
  });
  return { rx, ry, rects, spans };
}

export function layoutCycle(spec: CycleDiagram, k: number, textW: number, turn: number, relax: boolean, room: { w: number; h: number }): Item[] | null {
  const n = spec.steps.length;
  const { node: size } = sizesAt(k);
  const texts = fitAll(spec.steps, size, textW);
  if (!texts) return null;
  const sizes = texts.map(nodeSize);
  const g = DIAGRAM.linkGap + 1;
  // evenly round the loop; when that crowds (wide boxes near the flat top of a wide loop), each box
  // slides along it until the arrows between neighbours are about the same length
  // no arrangement round the loop can hold boxes whose sides add up to more than the loop is long
  const perimeter = Math.PI * (room.w + room.h) / 2;
  if (sizes.reduce((a, sz) => a + Math.min(sz.w, sz.h * 2) + CYCLE.minArc, 0) > perimeter) return null;
  const as = sizes.map((_, i) => -Math.PI / 2 + turn + (Math.PI * 2 * i) / n);
  let r = ring(sizes, as, room, g);
  for (let iter = 0; relax && iter < 40 && r; iter++) {
    const gaps = r.spans.map((sp, i) => {
      const next = r!.spans[(i + 1) % n];
      const end = sp[1];
      const start = next[0] + (i === n - 1 ? Math.PI * 2 : 0);
      return (start - end) * speed(r!.rx, r!.ry, (start + end) / 2);
    });
    let moved = 0;
    for (let i = 1; i < n; i++) {
      const d = (0.35 * (gaps[i] - gaps[i - 1])) / speed(r.rx, r.ry, as[i]);
      as[i] += Math.max(-0.05, Math.min(0.05, d));
      moved = Math.max(moved, Math.abs(d));
    }
    r = ring(sizes, as, room, g);
    if (moved < 0.002) break;
  }
  if (!r) return null;
  const { rx, ry, rects } = r;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (rectsOverlap(rects[i], rects[j], CYCLE.nodeGap)) return null;
  const c = { x: room.w / 2, y: room.h / 2 };
  const at = (a: number): Pt => ({ x: c.x + rx * Math.cos(a), y: c.y + ry * Math.sin(a) });

  const items: Item[] = [];
  for (let i = 0; i < n; i++) {
    items.push(...boxNode(rects[i], texts[i], `node:${i}`, CYCLE.accent));
    // the arc from this box to the next, clear of both
    const a0 = as[i];
    const a1 = i === n - 1 ? as[0] + Math.PI * 2 : as[i + 1];
    const N = 240;
    const pts: Pt[] = [];
    for (let s = 0; s <= N; s++) {
      const p = at(a0 + ((a1 - a0) * s) / N);
      if (inGrown(p, rects[i], g) || inGrown(p, rects[(i + 1) % n], g)) {
        if (pts.length > 0) break;
        continue;
      }
      pts.push(p);
    }
    let len = 0;
    for (let s = 1; s < pts.length; s++) len += Math.hypot(pts[s].x - pts[s - 1].x, pts[s].y - pts[s - 1].y);
    if (len < CYCLE.minArc) return null;
    // thin the arc to every ~6 px: the pen resamples it anyway
    const thin = pts.filter((_, s) => s % 3 === 0 || s === pts.length - 1);
    items.push({ t: "arrow", pts: thin, part: `arrow:${i}-${(i + 1) % n}` });
  }
  return items;
}

export function sketchCycle(spec: CycleDiagram, box: { w: number; h: number }, seed: number): LectureSketch | null {
  if (spec.steps.length < 2) return null;
  for (const k of DIAGRAM.levels) {
    const room = roomUnder(spec.title, box, k);
    if (!room) continue;
    for (const tw of CYCLE.textW) {
      // the first step at 12 o'clock; else half a step round, which leaves the flat top of a wide loop free
      for (const relax of [false, true]) {
        for (const turn of [0, Math.PI / spec.steps.length]) {
          const items = layoutCycle(spec, k, tw, turn, relax, room);
          const out = items ? drawDiagram(items, spec.title, box, k, seed, sizesAt(k).node) : null;
          if (out) return out;
        }
      }
    }
  }
  return null;
}
