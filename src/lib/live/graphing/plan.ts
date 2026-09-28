import { placeStrokes, strokeBounds, totalDurationMs, type Stroke } from "@/lib/hand";
import type { GraphAsymptote, GraphCurve, GraphIntent, GraphKeyPoint, NumberLineIntent, PlaneGraphIntent, Rect } from "../contracts";
import { niceLatex } from "../engine/graphIntent";
import type { HandLinePlan, HandPlan } from "../handwriting";
import { Pen, clipPolyline, clipSegment, inRect, rectsOverlap, writeMath, type Pt, type Written } from "./pen";
import { chooseWindow, fromPx, numberLineWindow, ticksIn, toPx, type GraphWindow, type GraphWindowHint } from "./window";

/**
 * A graph as the tutor sketches it: `GraphIntent` (the maths, from the engine) in, a `HandPlan`
 * out — the same plan the worked steps are written from, so the HandWriter reveals a graph
 * exactly like writing, one pen stroke at a time, in the same blue hand.
 *
 * The plan's lines are the sketch's parts in the order a teacher draws them: the axes (with
 * arrowheads and their letters), the tick marks, the numbers, any asymptotes (dashed), the
 * curves (a strict inequality's boundary dashed, a transformation's parent dotted), the hatching
 * of a region, the key points' dots (a hole's open circle, the curve broken round it), a
 * transformation's arrows, and last the writing beside them: coordinates, each asymptote's
 * equation at its end (`x = -1`, `y = 1`), each curve's name (`f`, `g`). Everything is in the
 * plot box's own px (top-left 0, 0); the caller moves the plan onto the page with
 * `placeHandPlan`.
 *
 * No words: the only writing is numbers, the axis letters, coordinates like `(0, 1)`, an
 * asymptote's equation and a function's name.
 */

export const GRAPH = {
  /** the plot box (axes span); labels may hang a little outside */
  box: { w: 380, h: 310 },
  /** smaller boxes tried when the big one does not fit on the screen */
  fallbackBoxes: [
    { w: 320, h: 262 },
    { w: 264, h: 216 },
  ],
  /** number line: the axis length and the height of the drawing */
  line: { w: 380 },
  /** hand sizes (see HAND_WRITE.digitRatio: a digit is 0.63 of this) */
  text: { tick: 30, label: 34, axis: 30 },
  tickHalf: 5,
  /** ticks this close to an axis end are left out (the arrowhead lives there) */
  endClear: 22,
  hatchGap: 26,
  /** a hole's open circle, and the gap the curve leaves round it */
  holeR: 8,
  /** a transformation's parent: dots this long, this far apart */
  parentDash: { on: 3.5, off: 6 },
  /** an arrow from a parent's point to its image stops this short of each dot */
  arrowClear: 7,
  /** a curve's name keeps this far from any other curve */
  nameClear: 16,
  /** natural-pace pause between two parts of the sketch */
  groupGapMs: 180,
  /** the whole sketch takes about this long on the wall clock (see `graphPaceFor`) */
  pace: { naturalUpToMs: 3500, maxWallMs: 5500 },
} as const;

/** The pen's speed-up for a sketch that takes `naturalMs` at writing pace: drawn within ~4–6 s. */
export function graphPaceFor(naturalMs: number): number {
  const { naturalUpToMs, maxWallMs } = GRAPH.pace;
  if (!(naturalMs > naturalUpToMs)) return 1;
  const wall = Math.min(maxWallMs, naturalUpToMs + (naturalMs - naturalUpToMs) / 4);
  return naturalMs / wall;
}

interface Group {
  label: string;
  strokes: Stroke[];
}

/** Groups → a HandPlan: one plan line per part of the sketch, back to back. */
export function planFromGroups(groups: readonly Group[], size: number): HandPlan | null {
  const lines: HandLinePlan[] = [];
  let t = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const g of groups) {
    const b = strokeBounds(g.strokes);
    if (!b || g.strokes.length === 0) continue;
    const strokes = placeStrokes(g.strokes, { x: -b.minX, y: -b.minY });
    const durationMs = totalDurationMs(strokes);
    lines.push({ latex: g.label, x: b.minX, y: b.minY, baseline: b.height, strokes, startMs: t, durationMs });
    t += durationMs + GRAPH.groupGapMs;
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  }
  if (lines.length === 0) return null;
  const totalMs = Math.max(0, t - GRAPH.groupGapMs);
  return { lines, bounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY }, size, totalMs, pace: graphPaceFor(totalMs) };
}

/** A tick number as the hand writes it: `2`, `-0.5`, `10`. */
export function tickLatex(v: number): string {
  const s = Number(v.toPrecision(10)).toString();
  return /e/.test(s) ? v.toExponential(1) : s;
}

/** The widest tick number, as the hand writes it (px). */
function widestTick(values: readonly number[], size: number): number {
  let w = 0;
  for (const v of values) w = Math.max(w, writeMath(tickLatex(v), { x: 0, y: 0 }, "left", "top", size, 1)?.rect.w ?? 0);
  return w;
}

export interface GraphPlanResult {
  plan: HandPlan;
  /** the plot box (px, plan-local) — the plane window, or the number line's extent */
  box: Rect;
  window: GraphWindow | null;
}

export interface PlanOptions {
  seed: number;
  box?: { w: number; h: number };
  /** a range someone asked for (a plane graph only); the board's own sketches choose theirs */
  window?: GraphWindowHint;
}

/** The sketch for a graph intent, or null when there is nothing the hand can draw. */
export function planGraph(intent: GraphIntent, opts: PlanOptions): GraphPlanResult | null {
  return intent.kind === "plane" ? planPlane(intent, opts) : planNumberLine(intent, opts);
}

// ------------------------------------------------------------------ plane

type Obstacle = { rect: Rect } | { points: Pt[] };

function hits(r: Rect, obstacles: readonly Obstacle[], pad = 2): number {
  let n = 0;
  for (const o of obstacles) {
    if ("rect" in o) {
      if (rectsOverlap(r, o.rect, pad)) n++;
    } else if (o.points.some((p) => inRect(p, r, pad))) n++;
  }
  return n;
}

/**
 * The curve of y = f(x) across the window, as px polylines: sampled every 1.5 px and refined
 * where it moves fast, broken at asymptotes and where f is not real, clipped to the box.
 */
export function traceFunction(f: (x: number) => number, win: GraphWindow, poles: readonly number[]): Pt[][] {
  const box: Rect = { x: 0, y: 0, w: win.w, h: win.h };
  const P = (x: number): Pt | null => {
    const y = f(x);
    return Number.isFinite(y) ? toPx(win, x, y) : null;
  };
  const inside = (p: Pt) => p.x >= -0.5 && p.x <= win.w + 0.5 && p.y >= -0.5 && p.y <= win.h + 0.5;
  const span = win.xMax - win.xMin;
  const eps = span * 1e-7;
  const cuts = [win.xMin, ...poles.filter((p) => p > win.xMin && p < win.xMax).sort((a, b) => a - b), win.xMax];
  const runs: Pt[][] = [];
  for (let c = 0; c < cuts.length - 1; c++) {
    const lo = cuts[c] + (c > 0 ? eps : 0);
    const hi = cuts[c + 1] - (c < cuts.length - 2 ? eps : 0);
    if (!(hi > lo)) continue;
    const n = Math.max(8, Math.ceil(((hi - lo) / span) * (win.w / 1.5)));
    let run: Pt[] = [];
    const flush = () => {
      if (run.length >= 2) runs.push(run);
      run = [];
    };
    const refine = (x0: number, p0: Pt, x1: number, p1: Pt, depth: number): void => {
      const visible = inside(p0) || inside(p1) || clipPolyline([p0, p1], box).length > 0;
      const len = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      if (!visible || len <= 2.5 || depth >= 18) {
        // still spanning the whole box after all that refining: a jump (a pole), not a curve
        if (depth >= 18 && len > win.h) {
          flush();
          run.push(p1);
          return;
        }
        run.push(p1);
        return;
      }
      const xm = (x0 + x1) / 2;
      const pm = P(xm);
      if (!pm) {
        refine(x0, p0, x1, p1, 18);
        return;
      }
      refine(x0, p0, xm, pm, depth + 1);
      refine(xm, pm, x1, p1, depth + 1);
    };
    /** the last x where f is still real, between a real x and one where it is not */
    const edge = (real: number, notReal: number): number => {
      let a = real;
      let b = notReal;
      for (let k = 0; k < 50; k++) {
        const m = (a + b) / 2;
        if (P(m)) a = m;
        else b = m;
      }
      return a;
    };
    let px = lo;
    let pp = P(lo);
    if (pp) run.push(pp);
    for (let i = 1; i <= n; i++) {
      const x = lo + ((hi - lo) * i) / n;
      const p = P(x);
      if (p && pp) refine(px, pp, x, p, 0);
      else if (p && !pp) {
        const e = edge(x, px);
        const pe = P(e);
        flush();
        if (pe) {
          run.push(pe);
          refine(e, pe, x, p, 0);
        } else run.push(p);
      } else if (!p && pp) {
        const e = edge(px, x);
        const pe = P(e);
        if (pe) refine(px, pp, e, pe, 0);
        flush();
      }
      px = x;
      pp = p;
    }
    flush();
  }
  return runs.flatMap((r) => clipPolyline(r, box));
}

/** A circle as px polylines, clipped to the box. */
function traceCircle(c: { cx: number; cy: number; r: number }, win: GraphWindow, pen: Pen): Pt[][] {
  const box: Rect = { x: 0, y: 0, w: win.w, h: win.h };
  const pts: Pt[] = [];
  const a0 = Math.PI * 0.75 + (pen.rng() - 0.5) * 0.3;
  const n = 180;
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((Math.PI * 2 + 0.06) * i) / n;
    pts.push(toPx(win, c.cx + c.r * Math.cos(a), c.cy + c.r * Math.sin(a)));
  }
  return clipPolyline(pts, box);
}

/** Is (x, y) in the region the inequality describes? (Boundary excluded.) */
function inRegion(c: GraphCurve, x: number, y: number): boolean {
  if (c.kind === "function") {
    const fx = c.f(x);
    if (!Number.isFinite(fx)) return false;
    return c.op === "<" || c.op === "<=" ? y < fx : y > fx;
  }
  const d = (x - c.cx) ** 2 + (y - c.cy) ** 2 - c.r * c.r;
  return c.op === "<" || c.op === "<=" ? d < 0 : d > 0;
}

/**
 * Light hatching of a region: parallel diagonal strokes `GRAPH.hatchGap` apart, only where the
 * inequality holds, stopping short of the boundary and of any writing.
 */
function hatch(c: GraphCurve, win: GraphWindow, dir: 1 | -1, avoid: readonly Rect[], pen: Pen): Pt[][] {
  const out: Pt[][] = [];
  const w = win.w;
  const h = win.h;
  const gap = GRAPH.hatchGap;
  const clear = 4;
  const ok = (p: Pt): boolean => {
    if (p.x < 2 || p.y < 2 || p.x > w - 2 || p.y > h - 2) return false;
    if (avoid.some((r) => inRect(p, r, 3))) return false;
    const d = fromPx(win, p.x, p.y);
    if (!inRegion(c, d.x, d.y)) return false;
    // keep a little air next to the boundary line
    const nearBoundary = [-clear, clear].some((o) => {
      const q = fromPx(win, p.x + o, p.y);
      const r = fromPx(win, p.x, p.y + o);
      return !inRegion(c, q.x, q.y) || !inRegion(c, r.x, r.y);
    });
    return !nearBoundary;
  };
  for (let s = gap / 2 + pen.rng() * 4; s < w + h; s += gap) {
    // the line through (s, 0) going down-left ("/", dir 1) or through (w - s, 0) going down-right ("\")
    const x0 = dir === 1 ? s : w - s;
    let seg: Pt[] = [];
    for (let k = 0; k <= h; k += 2) {
      const p = { x: x0 - dir * k, y: k };
      if (ok(p)) seg.push(p);
      else {
        if (seg.length >= 2) out.push(seg);
        seg = [];
      }
    }
    if (seg.length >= 2) out.push(seg);
  }
  return out.filter((seg) => Math.hypot(seg[seg.length - 1].x - seg[0].x, seg[seg.length - 1].y - seg[0].y) >= 10);
}

function planPlane(intent: PlaneGraphIntent, opts: PlanOptions): GraphPlanResult | null {
  const box = opts.box ?? GRAPH.box;
  const win = chooseWindow(intent, box, opts.window);
  const pen = new Pen(opts.seed);
  const T = GRAPH.text;
  const origin = toPx(win, 0, 0);
  const groups: Group[] = [];
  const obstacles: Obstacle[] = [];
  const textRects: Rect[] = [];

  // 1. the axes, arrowheads and their letters
  const axes: Stroke[] = [];
  axes.push(...pen.line({ x: 0, y: origin.y }, { x: win.w, y: origin.y }));
  axes.push(...pen.arrowhead({ x: win.w, y: origin.y }, 1, 0));
  axes.push(...pen.line({ x: origin.x, y: win.h }, { x: origin.x, y: 0 }));
  axes.push(...pen.arrowhead({ x: origin.x, y: 0 }, 0, -1));
  obstacles.push({ rect: { x: 0, y: origin.y - 2, w: win.w, h: 4 } }, { rect: { x: origin.x - 2, y: 0, w: 4, h: win.h } });
  const xLetter = writeMath(intent.variable, { x: win.w + 5, y: origin.y + 3 }, "left", "top", T.axis, pen.seed());
  const yLetter = writeMath("y", { x: origin.x + 8, y: -2 }, "left", "top", T.axis, pen.seed());
  for (const l of [xLetter, yLetter]) {
    if (!l) continue;
    axes.push(...l.strokes);
    textRects.push(l.rect);
    obstacles.push({ rect: l.rect });
  }
  groups.push({ label: "", strokes: axes });

  // 2. tick marks, and 3. their numbers (not every one when they would crowd)
  const ticks: Stroke[] = [];
  const numbers: Stroke[] = [];
  const clearOf = (p: number, end: number) => Math.abs(p - end) >= GRAPH.endClear;
  const xTicks = ticksIn(win.xMin, win.xMax, win.xStep).filter((v) => v !== 0 && clearOf(toPx(win, v, 0).x, win.w) && toPx(win, v, 0).x > 4);
  const yTicks = ticksIn(win.yMin, win.yMax, win.yStep).filter((v) => v !== 0 && clearOf(toPx(win, 0, v).y, 0) && toPx(win, 0, v).y < win.h - 4);
  const xSpacing = (win.xStep / (win.xMax - win.xMin)) * win.w;
  const ySpacing = (win.yStep / (win.yMax - win.yMin)) * win.h;
  const xEvery = Math.max(1, Math.ceil((widestTick(xTicks, T.tick) + 10) / xSpacing));
  const yEvery = Math.max(1, Math.ceil((T.tick * 0.9 + 6) / ySpacing));
  const labelled = (v: number, step: number, every: number) => Math.round(v / step) % every === 0;
  for (const v of xTicks) {
    const p = toPx(win, v, 0);
    ticks.push(...pen.line({ x: p.x, y: p.y - GRAPH.tickHalf }, { x: p.x, y: p.y + GRAPH.tickHalf }));
    if (!labelled(v, win.xStep, xEvery)) continue;
    const t = writeMath(tickLatex(v), { x: p.x, y: p.y + GRAPH.tickHalf + 4 }, "center", "top", T.tick, pen.seed());
    if (t && !textRects.some((r) => rectsOverlap(r, t.rect, 2))) {
      numbers.push(...t.strokes);
      textRects.push(t.rect);
      obstacles.push({ rect: t.rect });
    }
  }
  for (const v of yTicks) {
    const p = toPx(win, 0, v);
    ticks.push(...pen.line({ x: p.x - GRAPH.tickHalf, y: p.y }, { x: p.x + GRAPH.tickHalf, y: p.y }));
    if (!labelled(v, win.yStep, yEvery)) continue;
    const t = writeMath(tickLatex(v), { x: p.x - GRAPH.tickHalf - 5, y: p.y }, "right", "middle", T.tick, pen.seed());
    if (t && !textRects.some((r) => rectsOverlap(r, t.rect, 2))) {
      numbers.push(...t.strokes);
      textRects.push(t.rect);
      obstacles.push({ rect: t.rect });
    }
  }
  groups.push({ label: "", strokes: ticks }, { label: "", strokes: numbers });

  // 4. asymptotes (dashed), except where they are an axis already; a parent's only break its curve
  const asym: Stroke[] = [];
  const poles = intent.asymptotes.filter((a) => a.axis === "vertical").map((a) => a.at);
  /** each drawn asymptote's two ends in px, for its equation */
  const drawnAsymptotes: Array<{ a: GraphAsymptote; ends: [Pt, Pt] }> = [];
  for (const a of intent.asymptotes) {
    if (a.hidden) continue;
    const ends = asymptoteEnds(a, win);
    if (!ends) continue;
    asym.push(...pen.dashed(ends));
    obstacles.push({ points: sampleSegment(ends[0], ends[1], 3) });
    drawnAsymptotes.push({ a, ends });
  }
  // a dash never runs through a number
  const clearAsym = asym.filter((s) => !s.points.some((p) => textRects.some((r) => inRect(p, r, 2))));
  if (clearAsym.length) groups.push({ label: "", strokes: clearAsym });

  // 5. the curves (a strict inequality's boundary is dashed, a transformation's parent dotted),
  //    each broken round a hole so its open circle stays open
  const shown = intent.points.filter((p) => {
    const q = toPx(win, p.x, p.y);
    return q.x >= 2 && q.x <= win.w - 2 && q.y >= 2 && q.y <= win.h - 2;
  });
  const holes = shown.filter((p) => p.role === "hole").map((p) => toPx(win, p.x, p.y));
  /** every curve's px runs, for its name */
  const traced: Array<{ c: GraphCurve; runs: Pt[][] }> = [];
  for (const c of intent.curves) {
    const runs = breakAt(c.kind === "function" ? traceFunction(c.f, win, poles) : traceCircle(c, win, pen), holes, GRAPH.holeR + 1.5);
    const strict = c.op === "<" || c.op === ">";
    const parent = c.kind === "function" && c.role === "parent";
    const strokes = runs.flatMap((r) => (parent ? pen.dashed(r, GRAPH.parentDash.on, GRAPH.parentDash.off) : strict ? pen.dashed(r) : pen.polyline(r)));
    for (const r of runs) obstacles.push({ points: r.filter((_, i) => i % 2 === 0) });
    traced.push({ c, runs });
    if (strokes.length) groups.push({ label: c.latex, strokes });
  }

  // 6. the key points' dots (a hole's open circle), 7. their coordinates beside them
  const dots: Stroke[] = [];
  /** one group per label, so each reads back as its own line of maths */
  const labelGroups: Group[] = [];
  const keep = (p: GraphKeyPoint) => p.role === "vertex" || p.role === "intersection" || p.role === "center" || p.role === "hole";
  for (const p of shown) {
    const q = toPx(win, p.x, p.y);
    dots.push(...(p.role === "hole" ? pen.ring(q, GRAPH.holeR) : pen.dot(q)));
    const r = p.role === "hole" ? GRAPH.holeR + 1 : 4;
    obstacles.push({ rect: { x: q.x - r, y: q.y - r, w: 2 * r, h: 2 * r } });
  }
  // a transformation: from the parent's point to where it lands
  const arrows: Stroke[] = [];
  for (const arrow of intent.arrows ?? []) {
    const a = toPx(win, arrow.from.x, arrow.from.y);
    const b = toPx(win, arrow.to.x, arrow.to.y);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (!shown.some((p) => p.x === arrow.to.x && p.y === arrow.to.y) || len < 2 * GRAPH.arrowClear + 10) continue;
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    const from = { x: a.x + ux * GRAPH.arrowClear, y: a.y + uy * GRAPH.arrowClear };
    const to = { x: b.x - ux * GRAPH.arrowClear, y: b.y - uy * GRAPH.arrowClear };
    arrows.push(...pen.line(from, to), ...pen.arrowhead(to, ux, uy, 9));
    obstacles.push({ points: sampleSegment(from, to, 3) });
  }
  // the points that matter most get the first pick of a spot
  const byImportance = [...shown].sort((a, b) => Number(keep(b)) - Number(keep(a)));
  for (const p of byImportance) {
    if (!p.label) continue;
    const q = toPx(win, p.x, p.y);
    const best = placeLabel(p.label, q, win, obstacles, pen.seed());
    if (!best || (best.hits > 0 && !keep(p))) continue;
    labelGroups.push({ label: p.label, strokes: best.written.strokes });
    textRects.push(best.written.rect);
    obstacles.push({ rect: best.written.rect });
  }
  // each drawn asymptote's equation at one of its ends, where it is clear of the curves
  for (const { a, ends } of drawnAsymptotes) {
    const latex = asymptoteLatex(a, intent.variable);
    const spot = latex ? labelAtEnd(latex, a, ends, win, obstacles, pen.seed()) : null;
    if (!spot) continue;
    labelGroups.push({ label: latex!, strokes: spot.strokes });
    textRects.push(spot.rect);
    obstacles.push({ rect: spot.rect });
  }
  // two curves of one sketch (a parent and its image): each one's name beside it
  if (traced.length > 1) {
    for (const { c, runs } of traced) {
      if (c.kind !== "function" || !c.name) continue;
      const others = traced.filter((t) => t.c !== c).flatMap((t) => t.runs);
      const spot = nameBeside(c.name, runs, others, win, obstacles, pen.seed());
      if (!spot) continue;
      labelGroups.push({ label: c.name, strokes: spot.strokes });
      textRects.push(spot.rect);
      obstacles.push({ rect: spot.rect });
    }
  }

  // 8. a region's hatching, drawn round the writing
  const hatchStrokes: Stroke[] = [];
  let last: 1 | -1 | 0 = 0;
  for (const c of intent.curves) {
    if (c.op === "=") continue;
    // across the boundary, never along it: a falling hatch against a rising line and vice versa;
    // a second region the other way, so where they overlap is cross-hatched
    const dir: 1 | -1 = last !== 0 ? (last === 1 ? -1 : 1) : risesInPx(c, win) ? -1 : 1;
    for (const seg of hatch(c, win, dir, textRects, pen)) hatchStrokes.push(...pen.polyline(seg, 0.25));
    last = dir;
  }
  if (hatchStrokes.length) groups.push({ label: "", strokes: hatchStrokes });
  if (dots.length) groups.push({ label: "", strokes: dots });
  if (arrows.length) groups.push({ label: "", strokes: arrows });
  groups.push(...labelGroups);

  const plan = planFromGroups(groups, T.label);
  if (!plan) return null;
  return { plan, box: { x: 0, y: 0, w: win.w, h: win.h }, window: win };
}

/**
 * An asymptote's two ends in px, clipped to the box; null when it is an axis already (x = 0,
 * y = 0) or out of view.
 */
function asymptoteEnds(a: GraphAsymptote, win: GraphWindow): [Pt, Pt] | null {
  if (a.axis === "vertical") {
    if (Math.abs(a.at) < 1e-12 || a.at <= win.xMin || a.at >= win.xMax) return null;
    const x = toPx(win, a.at, 0).x;
    return [
      { x, y: 0 },
      { x, y: win.h },
    ];
  }
  if (a.axis === "horizontal") {
    if (Math.abs(a.at) < 1e-12 || a.at <= win.yMin || a.at >= win.yMax) return null;
    const y = toPx(win, 0, a.at).y;
    return [
      { x: 0, y },
      { x: win.w, y },
    ];
  }
  const m = a.slope ?? 0;
  const c = clipSegment(toPx(win, win.xMin, m * win.xMin + a.at), toPx(win, win.xMax, m * win.xMax + a.at), { x: 0, y: 0, w: win.w, h: win.h });
  return c && Math.hypot(c[1].x - c[0].x, c[1].y - c[0].y) > 20 ? [c[0], c[1]] : null;
}

/** Points every `step` px from a to b (an obstacle a label must keep off). */
function sampleSegment(a: Pt, b: Pt, step: number): Pt[] {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
  return Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }));
}

/** The runs with every stretch inside a hole's circle left out, each cut exactly at the circle. */
function breakAt(runs: readonly Pt[][], holes: readonly Pt[], r: number): Pt[][] {
  if (holes.length === 0) return [...runs];
  const inside = (p: Pt) => holes.some((h) => Math.hypot(p.x - h.x, p.y - h.y) < r);
  /** where the segment from the outside point a to the inside point b crosses the circle */
  const edge = (a: Pt, b: Pt): Pt => {
    let lo = 0;
    let hi = 1;
    for (let k = 0; k < 24; k++) {
      const t = (lo + hi) / 2;
      if (inside({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })) hi = t;
      else lo = t;
    }
    return { x: a.x + (b.x - a.x) * lo, y: a.y + (b.y - a.y) * lo };
  };
  const out: Pt[][] = [];
  for (const run of runs) {
    let cur: Pt[] = [];
    for (let i = 0; i < run.length; i++) {
      const p = run[i];
      const prev = run[i - 1];
      if (inside(p)) {
        if (prev && !inside(prev)) cur.push(edge(prev, p));
        if (cur.length >= 2) out.push(cur);
        cur = [];
        continue;
      }
      if (prev && inside(prev)) cur.push(edge(p, prev));
      cur.push(p);
    }
    if (cur.length >= 2) out.push(cur);
  }
  return out;
}

/** `x = -1`, `y = \frac{3}{2}`, `y = 2x - 1`; null when a number in it is not exact. */
export function asymptoteLatex(a: GraphAsymptote, variable: string): string | null {
  const at = niceLatex(a.at);
  if (at === null) return null;
  if (a.axis === "vertical") return `${variable} = ${at}`;
  if (a.axis === "horizontal") return `y = ${at}`;
  const m = a.slope ?? 0;
  const mTex = niceLatex(m);
  if (mTex === null) return null;
  const mx = m === 1 ? variable : m === -1 ? `-${variable}` : `${mTex}${variable}`;
  const tail = a.at === 0 ? "" : a.at > 0 ? ` + ${at}` : ` - ${niceLatex(-a.at)}`;
  return `y = ${mx}${tail}`;
}

/** The best clear spot among `spots` (top-left corners) for writing of size w × h inside the box. */
function bestSpot(spots: ReadonlyArray<[number, number]>, w: number, h: number, win: GraphWindow, obstacles: readonly Obstacle[]): [number, number] | null {
  let best: { at: [number, number]; hits: number } | null = null;
  for (const [x, y] of spots) {
    if (x < -4 || y < -4 || x + w > win.w + 4 || y + h > win.h + 4) continue;
    const n = hits({ x, y, w, h }, obstacles);
    if (!best || n < best.hits) best = { at: [x, y], hits: n };
    if (n === 0) break;
  }
  return best && best.hits === 0 ? best.at : null;
}

/** An asymptote's equation at an end of its dashed line, on whichever side is clear of the curves. */
function labelAtEnd(latex: string, a: GraphAsymptote, ends: [Pt, Pt], win: GraphWindow, obstacles: readonly Obstacle[], seed: number): Written | null {
  const size = GRAPH.text.tick;
  const probe = writeMath(latex, { x: 0, y: 0 }, "left", "top", size, seed);
  if (!probe) return null;
  const { w, h } = probe.rect;
  const spots: Array<[number, number]> = [];
  if (a.axis === "vertical") {
    const x = ends[0].x;
    for (const y of [4, win.h - h - 4, win.h * 0.25, win.h * 0.7]) spots.push([x + 7, y], [x - 7 - w, y]);
  } else if (a.axis === "horizontal") {
    const y = ends[0].y;
    for (const x of [win.w - w - 6, 6, win.w * 0.62, win.w * 0.2]) spots.push([x, y - h - 6], [x, y + 6]);
  } else {
    const [p, q] = ends;
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    const nx = -(q.y - p.y) / len;
    const ny = (q.x - p.x) / len;
    const off = Math.hypot(w, h) / 2 + 6;
    for (const t of [0.86, 0.14, 0.72, 0.28]) {
      const cx = p.x + (q.x - p.x) * t;
      const cy = p.y + (q.y - p.y) * t;
      for (const s of [1, -1]) spots.push([cx + s * nx * off - w / 2, cy + s * ny * off - h / 2]);
    }
  }
  const at = bestSpot(spots, w, h, win, obstacles);
  return at ? writeMath(latex, { x: at[0], y: at[1] }, "left", "top", size, seed) : null;
}

/**
 * A curve's name written beside it, walking in from its right-hand end: the first spot clear of
 * everything, and well clear of the OTHER curves — so `f` and `g` never sit where either could
 * be meant.
 */
function nameBeside(name: string, runs: readonly Pt[][], others: readonly Pt[][], win: GraphWindow, obstacles: readonly Obstacle[], seed: number): Written | null {
  const size = GRAPH.text.label;
  const probe = writeMath(name, { x: 0, y: 0 }, "left", "top", size, seed);
  if (!probe) return null;
  const { w, h } = probe.rect;
  const along = runs
    .flatMap((r) => r)
    .filter((p) => p.x > 14 && p.x < win.w - 14 && p.y > 14 && p.y < win.h - 14)
    .sort((a, b) => b.x - a.x);
  const theirs = others.flatMap((r) => r.filter((_, i) => i % 2 === 0));
  const spots: Array<[number, number]> = [];
  for (let i = 0; i < along.length; i += 10) {
    const p = along[i];
    for (const s of [
      [p.x + 8, p.y - h - 4],
      [p.x - w - 8, p.y - h - 4],
      [p.x + 8, p.y + 4],
      [p.x - w - 8, p.y + 4],
    ] as Array<[number, number]>) {
      const r = { x: s[0], y: s[1], w, h };
      if (!theirs.some((q) => inRect(q, r, GRAPH.nameClear))) spots.push(s);
    }
  }
  const at = bestSpot(spots, w, h, win, obstacles);
  return at ? writeMath(name, { x: at[0], y: at[1] }, "left", "top", size, seed) : null;
}

/** Does the boundary rise left to right across the window (a positive slope)? */
function risesInPx(c: GraphCurve, win: GraphWindow): boolean {
  if (c.kind !== "function") return false;
  const a = c.f(win.xMin + (win.xMax - win.xMin) * 0.3);
  const b = c.f(win.xMin + (win.xMax - win.xMin) * 0.7);
  return Number.isFinite(a) && Number.isFinite(b) && b > a;
}

/** The best spot for `(x, y)` beside its dot: fewest collisions, preferring up-right. */
function placeLabel(
  latex: string,
  q: Pt,
  win: GraphWindow,
  obstacles: readonly Obstacle[],
  seed: number,
): { written: Written; hits: number } | null {
  const probe = writeMath(latex, { x: 0, y: 0 }, "left", "top", GRAPH.text.label, seed);
  if (!probe) return null;
  const { w, h } = probe.rect;
  const spots: Array<[number, number]> = [];
  for (const d of [8, 18, 30]) {
    spots.push(
      [q.x + d, q.y - d - h],
      [q.x - d - w, q.y - d - h],
      [q.x + d, q.y + d],
      [q.x - d - w, q.y + d],
      [q.x + d + 3, q.y - h / 2],
      [q.x - d - 3 - w, q.y - h / 2],
      [q.x - w / 2, q.y - d - 3 - h],
      [q.x - w / 2, q.y + d + 3],
    );
  }
  const bounds: Rect = { x: -18, y: -14, w: win.w + 36, h: win.h + 28 };
  let best: { x: number; y: number; hits: number } | null = null;
  for (const [x, y] of spots) {
    const r = { x, y, w, h };
    if (r.x < bounds.x || r.y < bounds.y || r.x + r.w > bounds.x + bounds.w || r.y + r.h > bounds.y + bounds.h) continue;
    const n = hits(r, obstacles);
    if (!best || n < best.hits) best = { x, y, hits: n };
    if (n === 0) break;
  }
  if (!best) return null;
  const written = writeMath(latex, { x: best.x, y: best.y }, "left", "top", GRAPH.text.label, seed);
  return written ? { written, hits: best.hits } : null;
}

// ------------------------------------------------------------------ number line

function planNumberLine(intent: NumberLineIntent, opts: PlanOptions): GraphPlanResult | null {
  const w = opts.box?.w ?? GRAPH.line.w;
  const pen = new Pen(opts.seed);
  const T = GRAPH.text;
  const nl = numberLineWindow(intent);
  const end = 20;
  const axisY = 30;
  const setY = axisY - 17;
  const px = (v: number) => end + ((v - nl.lo) / (nl.hi - nl.lo)) * (w - 2 * end);
  const groups: Group[] = [];

  // the line, arrows both ways
  const axis: Stroke[] = [
    ...pen.line({ x: 0, y: axisY }, { x: w, y: axisY }),
    ...pen.arrowhead({ x: w, y: axisY }, 1, 0),
    ...pen.arrowhead({ x: 0, y: axisY }, -1, 0),
  ];
  groups.push({ label: "", strokes: axis });

  // ticks, and the numbers under them
  const ticks: Stroke[] = [];
  const numbers: Stroke[] = [];
  const rects: Rect[] = [];
  const values = ticksIn(nl.lo, nl.hi, nl.step);
  const spacing = (w - 2 * end) / Math.max(1, values.length - 1);
  const every = Math.max(1, Math.ceil((widestTick(values, T.tick) + 8) / spacing));
  const offTick = intent.marks.filter((m) => !values.some((v) => Math.abs(v - m.at) < 1e-9));
  // an answer's own values that fall between ticks are written first, so the ticks' numbers give way
  for (const m of offTick) {
    const x = px(m.at);
    ticks.push(...pen.line({ x, y: axisY - GRAPH.tickHalf }, { x, y: axisY + GRAPH.tickHalf }));
    const t = writeMath(m.latex, { x, y: axisY + GRAPH.tickHalf + 5 }, "center", "top", T.tick, pen.seed());
    if (t) {
      numbers.push(...t.strokes);
      rects.push(t.rect);
    }
  }
  for (const v of values) {
    const x = px(v);
    ticks.push(...pen.line({ x, y: axisY - GRAPH.tickHalf }, { x, y: axisY + GRAPH.tickHalf }));
    const isMark = intent.marks.some((m) => Math.abs(m.at - v) < 1e-9);
    if (!isMark && Math.round((v - nl.lo) / nl.step) % every !== 0) continue;
    const t = writeMath(tickLatex(v), { x, y: axisY + GRAPH.tickHalf + 5 }, "center", "top", T.tick, pen.seed());
    if (t && !rects.some((r) => rectsOverlap(r, t.rect, 2))) {
      numbers.push(...t.strokes);
      rects.push(t.rect);
    }
  }
  groups.push({ label: "", strokes: ticks }, { label: "", strokes: numbers });

  // the answer: circles over its end points (open when the end is not included), joined, arrows to infinity
  const set: Stroke[] = [];
  const r = 5.5;
  const circled = new Set<number>();
  for (const iv of intent.intervals) {
    const a = iv.from === null ? null : px(iv.from);
    const b = iv.to === null ? null : px(iv.to);
    for (const [x, closed, v] of [
      [a, iv.fromClosed, iv.from],
      [b, iv.toClosed, iv.to],
    ] as const) {
      if (x === null || v === null || circled.has(v)) continue;
      circled.add(v);
      set.push(...(closed ? pen.disc({ x, y: setY }, r) : pen.ring({ x, y: setY }, r)));
    }
    const from = a === null ? 2 : a + r + 1;
    const to = b === null ? w - 2 : b - r - 1;
    if (to - from < 2) continue;
    set.push(...pen.line({ x: from, y: setY }, { x: to, y: setY }));
    if (b === null) set.push(...pen.arrowhead({ x: to, y: setY }, 1, 0, 9));
    if (a === null) set.push(...pen.arrowhead({ x: from, y: setY }, -1, 0, 9));
  }
  groups.push({ label: "", strokes: set });

  const plan = planFromGroups(groups, T.tick);
  if (!plan) return null;
  return { plan, box: { x: 0, y: 0, w, h: axisY + 30 }, window: null };
}
