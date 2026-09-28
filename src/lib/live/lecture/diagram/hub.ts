import type { Rect } from "../../contracts";
import { rectsOverlap, type Pt } from "../../graphing/pen";
import type { DiagramSpec } from "../contracts";
import type { LectureSketch } from "../chart/sketch";
import { ellipseExit, grow, rectExit, segmentHitsRect, shapeStyle } from "../chart/sketch";
import type { WordsLayout } from "../words";
import { DIAGRAM, boxNode, drawDiagram, fitAll, nodeSize, roomUnder, sizesAt, type Item } from "./layout";

/**
 * A hub (a concept map) as a teacher draws one: the idea in the middle in an ellipse, then each
 * part round it — a line out from the middle, the part in its box — clockwise from the top (or
 * from either side of it when that leaves more room). The parts sit on an ellipse as wide and tall
 * as the box allows.
 *
 * LIVE. The parts are spaced evenly, so one more moves them all: the spokes and parts are drawn
 * again, the middle stays. Parts: "centre", "centre:text", "spoke:<i>", "node:<i>", "node:<i>:text".
 */

export type HubDiagram = Extract<DiagramSpec, { kind: "hub" }>;

export const HUB = {
  /** the widths tried for a part's words, widest first */
  textW: [150, 126, 108, 92],
  /** the middle's words at most this wide */
  centreW: 150,
  /** the ellipse round the middle's words: how much bigger than their box (√2 holds its corners) */
  ring: 1.42,
  ringPad: { x: 8, y: 6 },
  nodeGap: 12,
  /** a spoke is long enough to see */
  minSpoke: 24,
  /** the middle's ellipse, and the parts' boxes */
  centreInk: "violet",
  accent: "orange",
  /** the rows-and-columns layout: the middle's words, a part's widest box, and the gaps */
  ringLayout: { centreW: 130, maxW: 190, gapX: 10, gapY: 10, gapSide: 36, gapRow: 36 },
} as const;

function layoutHub(spec: HubDiagram, k: number, textW: number, turn: number, room: { w: number; h: number }): Item[] | null {
  const n = spec.spokes.length;
  const { node: size } = sizesAt(k);
  const centre = fitAll([spec.center], size, HUB.centreW)?.[0];
  const texts = fitAll(spec.spokes, size, textW);
  if (!centre || !texts) return null;
  const rx = (centre.w / 2 + HUB.ringPad.x) * HUB.ring;
  // not a sliver of an ellipse round a single line of words
  const ry = Math.max((centre.h / 2 + HUB.ringPad.y) * HUB.ring, rx * 0.4);
  const sizes = texts.map(nodeSize);
  // the parts evenly round an ellipse as big as the room allows with every box inside it
  const angle = (i: number) => turn + (Math.PI * 2 * i) / n;
  let Rx = room.w / 2;
  let Ry = room.h / 2;
  sizes.forEach((sz, i) => {
    const cos = Math.abs(Math.cos(angle(i)));
    const sin = Math.abs(Math.sin(angle(i)));
    if (cos > 1e-6) Rx = Math.min(Rx, (room.w / 2 - sz.w / 2 - 1) / cos);
    if (sin > 1e-6) Ry = Math.min(Ry, (room.h / 2 - sz.h / 2 - 1) / sin);
  });
  if (Rx < rx + 20 || Ry < ry + 10) return null;
  const c = { x: room.w / 2, y: room.h / 2 };
  const hubRect: Rect = { x: c.x - rx, y: c.y - ry, w: 2 * rx, h: 2 * ry };
  const rects: Rect[] = sizes.map((sz, i) => {
    const p = { x: c.x + Rx * Math.cos(angle(i)), y: c.y + Ry * Math.sin(angle(i)) };
    return { x: p.x - sz.w / 2, y: p.y - sz.h / 2, w: sz.w, h: sz.h };
  });
  for (let i = 0; i < n; i++) {
    if (rectsOverlap(rects[i], hubRect, HUB.nodeGap)) return null;
    for (let j = i + 1; j < n; j++) if (rectsOverlap(rects[i], rects[j], HUB.nodeGap)) return null;
  }
  return spokes(centre, c, rx, ry, rects, texts);
}

/** The middle in its ellipse, then each part: its spoke, its box. Null when a spoke is too short or cuts across another part. */
function spokes(centre: WordsLayout, c: Pt, rx: number, ry: number, rects: readonly Rect[], texts: readonly WordsLayout[]): Item[] | null {
  const items: Item[] = [
    { t: "ellipse", c, rx, ry, part: "centre", style: shapeStyle(HUB.centreInk) },
    { t: "text", layout: centre, at: c, align: "center", valign: "middle", part: "centre:text" },
  ];
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    const mid = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    const from = ellipseExit(c, rx, ry, mid, 4);
    const to = rectExit(r, c, DIAGRAM.linkGap - 1);
    if (Math.hypot(to.x - from.x, to.y - from.y) < HUB.minSpoke) return null;
    if (rects.some((o, j) => j !== i && segmentHitsRect(from, to, grow(o, 3)))) return null;
    items.push({ t: "line", pts: [from, to], part: `spoke:${i}` }, ...boxNode(r, texts[i], `node:${i}`, HUB.accent));
  }
  return items;
}

/**
 * The parts round the middle as a teacher fits long ones on a wide board: a row across the top, a
 * column down each side of the middle, a row across the bottom (`[top, right, bottom, left]` of
 * them), clockwise from the top left.
 */
function layoutHubRing(spec: HubDiagram, k: number, dist: readonly [number, number, number, number], room: { w: number; h: number }): Item[] | null {
  const [t, r, b, l] = dist;
  const { node: size } = sizesAt(k);
  const R = HUB.ringLayout;
  const P = DIAGRAM.node.padX;
  const centre = fitAll([spec.center], size, R.centreW)?.[0];
  if (!centre) return null;
  const rx = (centre.w / 2 + HUB.ringPad.x) * HUB.ring;
  const ry = Math.max((centre.h / 2 + HUB.ringPad.y) * HUB.ring, rx * 0.4);
  const rowBudget = (count: number) => (count ? Math.min(R.maxW, (room.w - (count - 1) * R.gapX) / count) : 0);
  const sideBudget = Math.min(R.maxW, room.w / 2 - rx - R.gapSide);
  const where: Array<"top" | "right" | "bottom" | "left"> = [...Array(t).fill("top"), ...Array(r).fill("right"), ...Array(b).fill("bottom"), ...Array(l).fill("left")];
  const texts = spec.spokes.map((sp, i) => {
    const budget = where[i] === "top" ? rowBudget(t) : where[i] === "bottom" ? rowBudget(b) : sideBudget;
    return budget - 2 * P >= 40 ? (fitAll([sp], size, budget - 2 * P)?.[0] ?? null) : null;
  });
  if (texts.some((x) => !x)) return null;
  const sizes = texts.map((x) => nodeSize(x!));
  const idx = (side: string) => where.map((w, i) => (w === side ? i : -1)).filter((i) => i >= 0);
  const top = idx("top");
  const right = idx("right");
  const bottom = idx("bottom").reverse();
  const left = idx("left").reverse();
  const rowH = (ids: number[]) => Math.max(0, ...ids.map((i) => sizes[i].h));
  const colH = (ids: number[]) => ids.reduce((a, i) => a + sizes[i].h, 0) + Math.max(0, ids.length - 1) * R.gapY;
  const topH = rowH(top);
  const bottomH = rowH(bottom);
  const band = Math.max(2 * ry, colH(left), colH(right));
  const total = topH + (top.length ? R.gapRow : 0) + band + (bottom.length ? R.gapRow : 0) + bottomH;
  if (total > room.h) return null;
  const c = { x: room.w / 2, y: topH + (top.length ? R.gapRow : 0) + band / 2 };
  const rects: Rect[] = Array(spec.spokes.length);
  const row = (ids: number[], yMid: number) => {
    const w = ids.reduce((a, i) => a + sizes[i].w, 0) + Math.max(0, ids.length - 1) * R.gapX;
    let x = c.x - w / 2;
    for (const i of ids) {
      rects[i] = { x, y: yMid - sizes[i].h / 2, w: sizes[i].w, h: sizes[i].h };
      x += sizes[i].w + R.gapX;
    }
  };
  const col = (ids: number[], side: 1 | -1) => {
    let y = c.y - colH(ids) / 2;
    for (const i of ids) {
      const x = side === 1 ? c.x + rx + R.gapSide : c.x - rx - R.gapSide - sizes[i].w;
      rects[i] = { x, y, w: sizes[i].w, h: sizes[i].h };
      y += sizes[i].h + R.gapY;
    }
  };
  row(top, topH / 2);
  row(bottom, total - bottomH / 2);
  col(right, 1);
  col(left, -1);
  const hubRect: Rect = { x: c.x - rx, y: c.y - ry, w: 2 * rx, h: 2 * ry };
  for (let i = 0; i < rects.length; i++) {
    const a = rects[i];
    if (a.x < -0.5 || a.x + a.w > room.w + 0.5 || rectsOverlap(a, hubRect, HUB.nodeGap)) return null;
    for (let j = i + 1; j < rects.length; j++) if (rectsOverlap(a, rects[j], R.gapY - 1)) return null;
  }
  return spokes(centre, c, rx, ry, rects, texts as WordsLayout[]);
}

/** The ways n parts can go round the middle, [top, right, bottom, left], most even first. */
function ringDistributions(n: number): Array<[number, number, number, number]> {
  const out: Array<{ d: [number, number, number, number]; score: number }> = [];
  for (let l = 0; l <= 2; l++)
    for (let r = 0; r <= 2; r++)
      for (let t = 0; t <= 4; t++) {
        const b = n - l - r - t;
        if (b < 0 || b > 4 || Math.abs(t - b) > 1 || Math.abs(l - r) > 1) continue;
        out.push({ d: [t, r, b, l], score: Math.abs(t - b) + Math.abs(l - r) + (l + r === 0 && n >= 3 ? 2 : 0) + Math.max(0, t + b - 6) });
      }
  return out.sort((a, b) => a.score - b.score).map((o) => o.d);
}

export function sketchHub(spec: HubDiagram, box: { w: number; h: number }, seed: number): LectureSketch | null {
  const n = spec.spokes.length;
  if (n < 1) return null;
  const top = -Math.PI / 2;
  // an even number of parts leaves the top and bottom free (a wide box has little room there)
  const turns = n % 2 === 0 ? [top + Math.PI / n, top] : [top, top + Math.PI / n];
  const draw = (items: Item[] | null, k: number) => (items ? drawDiagram(items, spec.title, box, k, seed, sizesAt(k).node) : null);
  // evenly round an ellipse while the parts are short enough to sit on one (at any size); else rows
  // and columns round the middle
  for (const k of DIAGRAM.levels) {
    const room = roomUnder(spec.title, box, k);
    if (!room) continue;
    for (const tw of HUB.textW) {
      for (const turn of turns) {
        const out = draw(layoutHub(spec, k, tw, turn, room), k);
        if (out) return out;
      }
    }
  }
  for (const k of DIAGRAM.levels) {
    const room = roomUnder(spec.title, box, k);
    if (!room) continue;
    for (const d of ringDistributions(n)) {
      const out = draw(layoutHubRing(spec, k, d, room), k);
      if (out) return out;
    }
  }
  return null;
}
