import { LECTURE_SKETCH_LIMITS, type SketchDrawing } from "@/lib/live/lecture/contracts";
import type { Pt } from "@/lib/server/sketch/geometry";
import { DEFAULT_MAX_SIDE, workingCopy, type Bitmap } from "./bitmap";
import { drawingOrder, dropSmallest, frameFor, place, splitLong, strokeInk, totalPoints, type Placed } from "./drawing";
import { cleanGraph, buildGraph } from "./graph";
import { inkMask, type IgnoreRegion } from "./ink";
import { dropSpecks, fillHoles, inkRadius, lineWidth, pad, ridgeRadii, widthOf } from "./raster";
import { dotSpiral, takeDots } from "./dots";
import { findSolids } from "./solids";
import { assemble, finishStroke } from "./strokes";
import { thin } from "./thin";

/**
 * CENTRELINE TRACING: a picture of line art (an image model's diagram — dark lines on near-white
 * paper, a few coloured ones, hand-lettered labels) → the pen strokes that would draw it, in the
 * board's drawing format (`SketchDrawing`), so the tutor's hand can redraw the picture as ink.
 *
 * Centreline, not outline: an outline tracer (potrace) draws the two edges of every line, which a
 * pen would draw as two lines. Here every line is drawn once, down its middle:
 *
 *   1. the working copy, ≤ 1024 px on the long side, area-averaged (`bitmap.ts`);
 *   2. ink against the paper: darker or more coloured than the paper around it, with hysteresis
 *      so faint fringes stay attached and faint blotches stay out (`ink.ts`);
 *   3. specks (much smaller than the lines) dropped, pinholes in thick lines filled
 *      (`raster.ts`); solid dots taken out to be drawn as dots (`dots.ts`); filled shapes (a solid
 *      arrowhead, a bar) found, to be outlined rather than thinned (`solids.ts`);
 *   4. a one-pixel skeleton (Guo–Hall, then strictly 8-thin: `thin.ts`);
 *   5. its graph — ends, crossings, the paths between — with split crossings merged and spurs
 *      pruned relative to the local line width (`graph.ts`);
 *   6. strokes walked through the crossings by direction, so "+" is two strokes and a rectangle
 *      one closed stroke, joined at sharp apexes (`strokes.ts`);
 *   7. smoothed with corners kept, Douglas–Peucker, placed in the 1000-wide box, inked, ordered as
 *      a person draws, within the contract's caps (`drawing.ts`).
 *
 * Pure and deterministic: no randomness, stable sorts, the same pixels give the same strokes. A
 * picture with no ink gives a drawing with no strokes — which `SketchDrawingSchema` refuses (it
 * needs one), so the caller reads an empty `strokes` as "nothing to draw"; anything else parses.
 * Labels are left empty: text the caller wants as words (an OCR's boxes) it passes as `ignore`.
 */

export type { Bitmap } from "./bitmap";
export { decodeImage } from "./bitmap";
export type { IgnoreRegion } from "./ink";
export { traceFidelity } from "./fidelity";

export interface TraceOptions {
  /** regions blanked before tracing (e.g. text boxes an OCR will rewrite as labels), in SOURCE pixel coords */
  ignore?: IgnoreRegion[];
  /** the working copy's long side, px (default 1024) */
  maxSide?: number;
  /** a pixel this much darker (or more coloured) than its paper seeds ink, 0..255 (default adaptive: under half the ink's contrast, 32..64, above the paper's noise) */
  threshold?: number;
  /** a pixel this much darker joins ink it touches (default half of `threshold`, above the noise) */
  fringe?: number;
  /** …and only if it is at least this share as inked as the strongest ink within 2 px (default 0.35: every line keeps its own width, grey or black) */
  relative?: number;
  /** ink smaller than this many working px is a speck (default: under 0.6 × the line width², 3..6 px) */
  minSpeck?: number;
  /** paper holes in ink up to this many working px are filled (default from the line width: ¼ width², 2..16) */
  maxHole?: number;
  /** a branch from a crossing to a free end is a spur when it reaches past the edge of the lines it leaves by less than this × their width (default 0.6) */
  spur?: number;
  /** two branches carry on through a crossing when they turn by at most this, degrees (default 45) */
  maxTurn?: number;
  /** two leftover branches at a crossing make one stroke round a corner (an arrowhead's V) up to this turn, degrees (default 150) */
  cornerTurn?: number;
  /** Douglas–Peucker tolerance, working px (default 0.7) */
  epsilon?: number;
}

export interface TraceStats {
  ms: number;
  workingSize: [number, number];
  inkPixels: number;
  strokes: number;
  points: number;
  closed: number;
  droppedSpecks: number;
  prunedSpurs: number;
  splitForLimits: number;
  /** small strokes dropped to keep within the contract's strokes / points */
  droppedForLimits: number;
  /** the ink thresholds used: seed, fringe */
  threshold: [number, number];
  /** the typical line width, working px */
  lineWidth: number;
  /** the Douglas–Peucker tolerance the drawing ended at (raised when it had too many points) */
  epsilon: number;
}

export interface TraceResult {
  drawing: SketchDrawing;
  stats: TraceStats;
}

const deg = (d: number) => (d * Math.PI) / 180;
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export function traceLineArt(bitmap: Bitmap, opts: TraceOptions = {}): TraceResult {
  const t0 = now();
  const work = workingCopy(bitmap, opts.maxSide ?? DEFAULT_MAX_SIDE);
  const { w, h } = work;
  const ink = inkMask(work, { threshold: opts.threshold, fringe: opts.fringe, relative: opts.relative }, opts.ignore);

  const P = pad(ink.mask, w, h);
  let r = inkRadius(P);
  const droppedSpecks = dropSpecks(P, opts.minSpeck ?? 6, opts.minSpeck === undefined ? r : undefined);
  const w0 = lineWidth(P, r);
  const maxHole = opts.maxHole ?? Math.max(2, Math.min(16, Math.round(0.25 * w0 * w0)));
  if (fillHoles(P, maxHole)) r = inkRadius(P);
  const ridges = ridgeRadii(P, r);
  const width = widthOf(ridges) || w0 || 1;
  let inkPixels = 0;
  for (let i = 0; i < P.img.length; i++) inkPixels += P.img[i];

  // dots are drawn as dots, filled: a spiral under the pen's width, never smaller than 1.2 half-widths
  const frame = frameFor(w, h);
  const dotPitch = Math.max(1.5, Math.min(2.8, 0.8 * width * frame.s)) / frame.s;
  const dotMin = 0.6 * width;
  const dots = takeDots(P, r, width);
  const inkCopy = P.img.slice();

  // filled shapes are outlined, not thinned: their skeleton goes, the lines into them stay
  const solids = findSolids(inkCopy, r, P.W2, widthOf(ridges, 6) || 3);
  let list = thin(P);
  if (solids) {
    for (const p of list) if (solids.mask[p]) P.img[p] = 0;
    list = list.filter((p) => !solids.mask[p]);
  }
  const g = buildGraph(P.img, list, P.W2, r);
  const prunedSpurs = cleanGraph(g, { spur: opts.spur ?? 0.6, minSpur: 1.5, bridge: 0.75 });
  const look = Math.max(4, Math.min(16, 2 * width + 2));
  const raw = assemble(g, {
    maxTurn: deg(opts.maxTurn ?? 45),
    cornerTurn: deg(opts.cornerTurn ?? 150),
    look,
    closeGap: Math.max(2, Math.min(6, width)),
    lineWidth: width,
    ink: inkCopy,
    skel: P.img,
    solid: solids?.mask,
    dotPitch,
    dotMin,
    W2: P.W2,
    r,
  });
  if (solids) {
    // a short stroke wholly in a solid's corners is its leftover skeleton; its outline replaces it
    const W2 = P.W2;
    const inNear = (q: Pt) => solids.near[(Math.floor(q[1]) + 1) * W2 + Math.floor(q[0]) + 1] === 1;
    for (let i = raw.length - 1; i >= 0; i--) if (raw[i].pts.every(inNear)) raw.splice(i, 1);
    for (const o of solids.outlines) {
      if (o.disc) raw.push({ pts: dotSpiral(o.disc.x, o.disc.y, Math.max(o.disc.r, dotMin), dotPitch), corners: [], closed: false, px: o.px, dot: false, fixed: true });
      else raw.push({ pts: o.pts, corners: [], closed: true, px: o.px, dot: false });
    }
  }
  for (const d of dots) raw.push({ pts: dotSpiral(d.x, d.y, Math.max(d.r, dotMin), dotPitch), corners: [], closed: false, px: d.px, dot: false, fixed: true });

  const colours = raw.map((s) => strokeInk(s.px, P.W2, work, ink));
  // what thinning left as a lone pixel (a small mark that is not round) is a dot too
  const tapDot = (s: (typeof raw)[number]): Pt[] => {
    const [x, y] = s.pts[0];
    return dotSpiral(x, y, Math.max(dotMin, (r[s.px[0]] || 0) + 0.5), dotPitch);
  };
  const finishAll = (eps: number): Array<Placed & { dot: boolean }> =>
    raw
      .map((s, i) => {
        const pts = s.dot ? tapDot(s) : finishStroke(s, eps, width);
        let points = place(pts, frame);
        if (points.length === 1) points = [points[0], [Math.min(1000, points[0][0] + 0.5), points[0][1]]];
        return { points, closed: s.closed && points.length >= 3, color: colours[i], dot: s.dot };
      })
      .filter((s) => s.points.length >= 2);

  let epsilon = opts.epsilon ?? 0.7;
  let strokes = finishAll(epsilon);
  for (let k = 0; k < 4 && totalPoints(strokes) > LECTURE_SKETCH_LIMITS.points; k++) {
    epsilon *= 1.6;
    strokes = finishAll(epsilon);
  }
  const split = splitLong(strokes);
  const capped = dropSmallest(split.strokes);
  const ordered = drawingOrder(capped.strokes);

  const drawing: SketchDrawing = {
    w: 1000,
    h: frame.h,
    strokes: ordered.map((s) => ({ points: s.points, closed: s.closed, color: s.color, fill: false })),
    labels: [],
  };
  const stats: TraceStats = {
    ms: Math.round((now() - t0) * 10) / 10,
    workingSize: [w, h],
    inkPixels,
    strokes: drawing.strokes.length,
    points: totalPoints(drawing.strokes),
    closed: drawing.strokes.filter((s) => s.closed).length,
    droppedSpecks,
    prunedSpurs,
    splitForLimits: split.split,
    droppedForLimits: capped.dropped,
    threshold: [ink.hi, ink.lo],
    lineWidth: width,
    epsilon: Math.round(epsilon * 100) / 100,
  };
  return { drawing, stats };
}
