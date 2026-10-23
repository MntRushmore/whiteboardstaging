/**
 * The overlay as pen strokes, for the iPad's hand-drawn reveal ("have some kinda drawing animation
 * so it looks like it's working", the owner): the overlay's added pixels traced into centrelines by
 * the bake-off's tracer (`traceLineArt`, src/lib/server/trace), mapped back into the overlay's own
 * pixels, and put in the order a person writes:
 *
 *  - BLOCKS: strokes that sit together (boxes within ~1.5 letter heights side to side, ~1.2 up and
 *    down) are one block: a line of working, a margin note, a circled answer;
 *  - blocks in bands top to bottom (blocks beside each other share a band), left to right in a band;
 *  - in a block, LINES top to bottom (a stroke joins the line its middle is within 0.6 letter heights
 *    of), and left to right in a line;
 *  - each open stroke runs left to right, or top down when it is taller than wide (the tracer cannot
 *    know which end the pen started from).
 *
 * `width` is the stroke's own thickness in overlay px: twice the median distance from its centreline
 * to the edge of the ink (a chamfer distance transform of the overlay's mask).
 *
 * Within MAX_REVEAL_STROKES / MAX_REVEAL_POINTS, simplifying harder when over; past them still, or
 * when the tracer fails, `[]`: the client fades the overlay in instead.
 */
import { traceLineArt } from "@/lib/server/trace";
import { frameFor } from "@/lib/server/trace/drawing";
import { MAX_REVEAL_POINTS, MAX_REVEAL_STROKES, type RevealStroke } from "./contracts";

type Pt = [number, number];
type Box = { x0: number; y0: number; x1: number; y1: number };

const round1 = (n: number) => Math.round(n * 10) / 10;

function boxOf(pts: readonly Pt[]): Box {
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const [x, y] of pts) {
    if (x < b.x0) b.x0 = x;
    if (x > b.x1) b.x1 = x;
    if (y < b.y0) b.y0 = y;
    if (y > b.y1) b.y1 = y;
  }
  return b;
}

/**
 * Distance (px, 3-4 chamfer / 3) from each mask pixel to the nearest pixel outside the mask; 0
 * outside. Two passes.
 */
export function distanceInside(mask: Uint8Array, w: number, h: number): Float32Array {
  const BIG = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? BIG : 0;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x]);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], at(x - 1, y) + 3, at(x, y - 1) + 3, at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4);
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], at(x + 1, y) + 3, at(x, y + 1) + 3, at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4);
    }
  for (let i = 0; i < d.length; i++) d[i] /= 3;
  return d;
}

/** A stroke's thickness: twice the median inside-distance along it, at least 1. */
function widthAlong(pts: readonly Pt[], dist: Float32Array, w: number, h: number, fallback: number): number {
  const ds: number[] = [];
  const step = Math.max(1, Math.floor(pts.length / 60));
  for (let k = 0; k < pts.length; k += step) {
    const x = Math.round(pts[k][0]);
    const y = Math.round(pts[k][1]);
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const v = dist[y * w + x];
    if (v > 0) ds.push(v);
  }
  if (!ds.length) return Math.max(1, round1(fallback));
  ds.sort((a, b) => a - b);
  const med = ds[Math.floor(ds.length / 2)];
  // a 1 px line is 1 deep from both sides: 2·d − 1 is its width
  return Math.max(1, Math.min(80, round1(2 * med - 1)));
}

/** Left to right, or top down when taller than wide; closed strokes and dots as they are. */
function direct(pts: Pt[], closed: boolean): Pt[] {
  if (closed || pts.length < 2) return pts;
  const first = pts[0];
  const last = pts[pts.length - 1];
  const b = boxOf(pts);
  const wide = b.x1 - b.x0 >= b.y1 - b.y0;
  const backwards = wide ? last[0] < first[0] : last[1] < first[1];
  return backwards ? pts.slice().reverse() : pts;
}

/** Reading order (see the header): blocks in bands, lines in blocks, left to right in a line. */
export function readingOrder<S>(items: ReadonlyArray<{ item: S; box: Box }>): S[] {
  if (items.length <= 1) return items.map((it) => it.item);
  const heights = items.map((it) => it.box.y1 - it.box.y0).sort((a, b) => a - b);
  const rowH = Math.max(4, heights[Math.floor(heights.length / 2)]);
  const gx = 1.5 * rowH;
  const gy = 1.2 * rowH;

  // blocks: union of boxes that come within (gx, gy) of each other
  const parent = items.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i].box;
      const b = items[j].box;
      if (a.x0 - gx <= b.x1 && b.x0 - gx <= a.x1 && a.y0 - gy <= b.y1 && b.y0 - gy <= a.y1) parent[find(i)] = find(j);
    }
  const groups = new Map<number, number[]>();
  items.forEach((_, i) => {
    const r = find(i);
    const g = groups.get(r);
    if (g) g.push(i);
    else groups.set(r, [i]);
  });
  const blocks = [...groups.values()].map((members) => {
    const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (const i of members) {
      const b = items[i].box;
      box.x0 = Math.min(box.x0, b.x0);
      box.y0 = Math.min(box.y0, b.y0);
      box.x1 = Math.max(box.x1, b.x1);
      box.y1 = Math.max(box.y1, b.y1);
    }
    return { members, box, first: Math.min(...members) };
  });

  // bands of blocks: a block joins the band whose vertical span it overlaps by half its own height
  blocks.sort((a, b) => a.box.y0 - b.box.y0 || a.box.x0 - b.box.x0 || a.first - b.first);
  const bands: Array<{ y0: number; y1: number; blocks: typeof blocks }> = [];
  for (const bl of blocks) {
    const band = bands[bands.length - 1];
    const overlap = band ? Math.min(band.y1, bl.box.y1) - Math.max(band.y0, bl.box.y0) : -1;
    if (band && overlap >= 0.5 * Math.min(bl.box.y1 - bl.box.y0, band.y1 - band.y0)) {
      band.blocks.push(bl);
      band.y1 = Math.max(band.y1, bl.box.y1);
    } else bands.push({ y0: bl.box.y0, y1: bl.box.y1, blocks: [bl] });
  }

  const out: S[] = [];
  for (const band of bands) {
    band.blocks.sort((a, b) => a.box.x0 - b.box.x0 || a.first - b.first);
    for (const bl of band.blocks) {
      // lines in the block
      const its = bl.members
        .map((i) => ({ i, cy: (items[i].box.y0 + items[i].box.y1) / 2, x0: items[i].box.x0 }))
        .sort((a, b) => a.cy - b.cy || a.x0 - b.x0 || a.i - b.i);
      const lines: Array<{ sum: number; n: number; its: typeof its }> = [];
      for (const it of its) {
        const line = lines[lines.length - 1];
        if (line && Math.abs(it.cy - line.sum / line.n) <= 0.6 * rowH) {
          line.its.push(it);
          line.sum += it.cy;
          line.n++;
        } else lines.push({ sum: it.cy, n: 1, its: [it] });
      }
      for (const line of lines) {
        line.its.sort((a, b) => a.x0 - b.x0 || a.cy - b.cy || a.i - b.i);
        for (const it of line.its) out.push(items[it.i].item);
      }
    }
  }
  return out;
}

export interface RevealResult {
  strokes: RevealStroke[];
  ms: number;
  /** why the strokes are empty, when they are and the overlay is not */
  dropped?: "trace_failed" | "over_budget";
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** The overlay's mask (1 = drawn), W×H, as ordered reveal strokes in its pixels. */
export function revealStrokes(mask: Uint8Array, width: number, height: number): RevealResult {
  const t0 = now();
  const done = (strokes: RevealStroke[], dropped?: RevealResult["dropped"]): RevealResult => ({ strokes, ms: Math.round(now() - t0), ...(dropped ? { dropped } : {}) });
  let any = false;
  for (let i = 0; i < mask.length; i++)
    if (mask[i]) {
      any = true;
      break;
    }
  if (!any) return done([]);
  try {
    // the added pixels as black on white paper: the tracer's line art
    const grey = new Uint8Array(width * height);
    for (let i = 0; i < grey.length; i++) grey[i] = mask[i] ? 0 : 255;
    const bitmap = { width, height, channels: 1 as const, data: grey };
    const dist = distanceInside(mask, width, height);

    for (const epsilon of [0.7, 1.4, 2.8]) {
      const { drawing, stats } = traceLineArt(bitmap, { epsilon });
      const [ww, wh] = stats.workingSize;
      const f = frameFor(ww, wh);
      const sx = width / ww;
      const sy = height / wh;
      const traced = drawing.strokes
        .map((s) => {
          let pts: Pt[] = s.points.map(([x, y]) => [((x - f.ox) / f.s) * sx, ((y - f.oy) / f.s) * sy]);
          if (s.closed && pts.length >= 3) pts = [...pts, pts[0]];
          pts = direct(pts, !!s.closed);
          return { item: pts, box: boxOf(pts) };
        })
        .filter((s) => s.item.length >= 2);
      const points = traced.reduce((n, s) => n + s.item.length, 0);
      if (traced.length > MAX_REVEAL_STROKES || points > MAX_REVEAL_POINTS) continue;
      const ordered = readingOrder(traced);
      const strokes = ordered.map((pts) => ({
        points: pts.flatMap(([x, y]) => [round1(Math.max(0, Math.min(width, x))), round1(Math.max(0, Math.min(height, y)))]),
        width: widthAlong(pts, dist, width, height, stats.lineWidth * sx),
      }));
      return done(strokes);
    }
    return done([], "over_budget");
  } catch {
    return done([], "trace_failed");
  }
}
