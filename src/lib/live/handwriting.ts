"use client";

import {
  createShapeId,
  type JsonObject,
  type TLDrawShape,
  type TLShape,
  type TLShapeId,
  type TLShapePartial,
} from "tldraw";
import {
  STROKE_GAP_MS,
  layoutSteps,
  placeStrokes,
  strokeBounds,
  strokeDurationMs,
  totalDurationMs,
  type Stroke,
} from "@/lib/hand";
import type { LiveShapeMeta, Rect } from "./contracts";

/**
 * The tutor's handwriting on the tldraw canvas.
 *
 * `src/lib/hand` turns LaTeX into strokes; this file turns strokes into ink the student can
 * see appearing. Two halves, both testable in node:
 *
 *  - `planHandwriting` (pure): lays a list of LaTeX steps out with `layoutSteps`, enforces the
 *    `unsupported` interlock, and returns one shape-sized plan per line in page coordinates
 *    plus the timeline (when each line starts, how long it takes).
 *  - `HandWriter`: reveals that plan at a human writing pace as tldraw `draw` shapes (one per
 *    stroke), and can be cancelled at any moment without leaving a half-written line behind.
 *
 * ## Why native `draw` shapes and not a custom `handwriting` ShapeUtil
 *
 * A custom shape would have to be registered on both <Tldraw> mounts and carry `static
 * migrations` forever, and — see `src/shapes/__tests__/snapshotRoundTrip.test.ts` — a snapshot
 * containing one cannot be loaded by any store that lacks the util. A `draw` shape is part of
 * the base schema: it round-trips through every snapshot (including the legacy ones), exports
 * through `toSvg` with no extra code, and is selected, moved and erased exactly like the
 * student's own ink, which is the whole point — the tutor writes *on the same whiteboard*.
 *
 * ONE SHAPE PER STROKE, not per line: a draw shape models a single pen-down, and tldraw renders
 * every segment of one shape as one continuous line. Packing a line's strokes into the segments
 * of a single shape draws phantom joins right through the glyphs (verified in the browser). So
 * a written line is N draw shapes, all sharing the line's origin and a `meta.handBlock` key —
 * which `LiveLoop.recount` uses to count a whole written block as ONE mark against the live
 * shape cap, and which lets the student erase a single glyph like any other ink.
 */

export const HAND_WRITE = {
  /**
   * Max distance between two points of a stroke handed to tldraw, in px.
   *
   * tldraw's freehand renderer smooths input with `streamline: 0.62` (see
   * node_modules/tldraw/.../draw/getPath.mjs) — each point pulls the pen only ~47 % of the way
   * to the next one. That is right for stylus input sampled every pixel, but it eats the corner
   * of a 3-point stroke: in the browser the flag of a hand-written `4` collapsed into a nub.
   * Resampling the engine's polylines this finely (geometry unchanged, only extra collinear
   * points) makes the smoothing follow the glyph, and makes the reveal advance point by point.
   */
  resampleStepPx: 2,
  /** hard cap on the points of one stroke after resampling */
  maxPointsPerStroke: 400,
  /** the tutor's hand is about as tall as the student's own line, within these bounds */
  minSize: 18,
  maxSize: 40,
  sizeFactor: 1,
  /** animation tick; a frame that arrives late catches up, it never falls behind */
  frameMs: 32,
  /** the pause between two lines of a worked solution — someone thinking, not a print-out */
  lineGapMs: 450,
  /** tldraw draw-shape style of the tutor's ink (the accent tone of the AI shapes, never red) */
  color: "blue",
  size: "s",
} as const;

/** Resamples a polyline so no two points are further apart than `step` px (pressure lerped too). */
function densify(points: readonly { x: number; y: number; z: number }[], step: number): { x: number; y: number; z: number }[] {
  if (points.length < 2) return points.map((p) => ({ ...p }));
  const out = [{ ...points[0] }];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
      if (out.length >= HAND_WRITE.maxPointsPerStroke) return out;
    }
  }
  return out;
}

/** Hand size for ink of this height, clamped to something readable. */
export function handSizeFor(lineHeight: number): number {
  const n = Math.round(lineHeight * HAND_WRITE.sizeFactor);
  return Math.min(HAND_WRITE.maxSize, Math.max(HAND_WRITE.minSize, Number.isFinite(n) ? n : HAND_WRITE.minSize));
}

/** Stable per-line seed so re-rendering the same line does not re-write it in another hand. */
export function handSeedFor(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** One written line: its strokes share the origin (x, y); each becomes its own draw shape. */
export interface HandLinePlan {
  latex: string;
  /** page coordinates of the shape origin (top-left of this line's ink) */
  x: number;
  y: number;
  /** strokes relative to (x, y), in drawing order */
  strokes: Stroke[];
  /** ms from the start of the block at which this line starts being written */
  startMs: number;
  /** ms this line takes to write */
  durationMs: number;
}

export interface HandPlan {
  lines: HandLinePlan[];
  /** page-space bounding box of the whole block */
  bounds: Rect;
  size: number;
  totalMs: number;
}

export interface HandPlanResult {
  /** null when nothing can be drawn — always check `unsupported` first */
  plan: HandPlan | null;
  /** non-empty means DO NOT draw: fall back to the typeset math shape */
  unsupported: string[];
}

/**
 * Lays `steps` out as handwriting anchored at `origin` (top-left of the block's ink).
 *
 * The safety interlock lives here: a line the hand engine cannot draw makes the whole block
 * unavailable (`plan: null`), because half a `\frac` on a whiteboard is wrong maths.
 */
export function planHandwriting(
  steps: readonly string[],
  opts: { size: number; seed: number; origin?: { x: number; y: number } },
): HandPlanResult {
  const origin = opts.origin ?? { x: 0, y: 0 };
  const block = layoutSteps(steps, { size: opts.size, seed: opts.seed });
  if (block.unsupported.length > 0) return { plan: null, unsupported: block.unsupported };

  const lines: HandLinePlan[] = [];
  let t = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const line of block.lines) {
    const b = strokeBounds(line.strokes);
    // A line that laid out to no ink at all (empty step) is skipped, not drawn empty.
    if (!b || line.strokes.length === 0) continue;
    const x = origin.x + b.minX;
    const y = origin.y + b.minY;
    const strokes = placeStrokes(line.strokes, { x: -b.minX, y: -b.minY }).map((st) => ({
      ...st,
      points: densify(st.points, HAND_WRITE.resampleStepPx),
    }));
    const durationMs = totalDurationMs(strokes);
    lines.push({ latex: line.latex, x, y, strokes, startMs: t, durationMs });
    t += durationMs + HAND_WRITE.lineGapMs;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + b.width);
    maxY = Math.max(maxY, y + b.height);
  }
  if (lines.length === 0) return { plan: null, unsupported: [] };

  return {
    plan: {
      lines,
      bounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
      size: opts.size,
      totalMs: Math.max(0, t - HAND_WRITE.lineGapMs),
    },
    unsupported: [],
  };
}

/** Moves a plan so its bounding box starts at `at` (page coordinates). */
export function placeHandPlan(plan: HandPlan, at: { x: number; y: number }): HandPlan {
  const dx = at.x - plan.bounds.x;
  const dy = at.y - plan.bounds.y;
  if (dx === 0 && dy === 0) return plan;
  return {
    ...plan,
    lines: plan.lines.map((l) => ({ ...l, x: l.x + dx, y: l.y + dy })),
    bounds: { ...plan.bounds, x: at.x, y: at.y },
  };
}


/**
 * How many points of each stroke are on the canvas at `localMs` into a line: `0` for a stroke
 * the pen has not reached, the full length for a finished one, and a partial count for the one
 * being drawn. `Infinity` gives the finished line.
 */
export function revealCounts(strokes: readonly Stroke[], localMs: number): number[] {
  const out = strokes.map(() => 0);
  let t = 0;
  for (let i = 0; i < strokes.length; i++) {
    const stroke = strokes[i];
    const ms = strokeDurationMs(stroke);
    if (localMs >= t + ms) {
      out[i] = stroke.points.length;
      t += ms + STROKE_GAP_MS;
      continue;
    }
    if (localMs <= t) break;
    const frac = (localMs - t) / ms;
    out[i] = Math.min(stroke.points.length, Math.max(2, Math.ceil(frac * stroke.points.length)));
    break;
  }
  return out;
}

/** The slice of the editor the writer touches, plus the batched Live write. */
export interface HandCanvas {
  /** runs `fn` through liveWrite/scheduleLiveWrite: remote-sourced, outside the undo stack */
  write(fn: () => void): void;
  createShapes(shapes: TLShapePartial[]): unknown;
  updateShapes(shapes: TLShapePartial[]): unknown;
  getShape(id: TLShapeId): TLShape | undefined;
}

export interface HandWriterDeps {
  now: () => number;
  setTimer: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer: (t: ReturnType<typeof setTimeout>) => void;
  /** true honours prefers-reduced-motion: the finished writing appears with no animation */
  reducedMotion: () => boolean;
}

export interface HandWriteOptions {
  /** meta stamped on every stroke shape; `handBlockMeta` adds the block key */
  meta: LiveShapeMeta;
  onDone?: () => void;
}

/** meta key grouping the stroke shapes of one written block, so the shape cap counts it as one mark. */
export const HAND_BLOCK_META = "handBlock";

/** The block key of a live shape, or "" when it is not handwriting. */
export function handBlockOf(meta: unknown): string {
  if (typeof meta !== "object" || meta === null) return "";
  const v = (meta as Record<string, unknown>)[HAND_BLOCK_META];
  return typeof v === "string" ? v : "";
}

function defaultDeps(): HandWriterDeps {
  return {
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (t) => clearTimeout(t),
    reducedMotion: () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  };
}

let blockSeq = 0;

/** How the reveal is being ended: normally, or cut short by the student / a mode change. */
type ApplyMode = "reveal" | "finishStarted" | "finishAll";

/**
 * Reveals one `HandPlan` stroke by stroke.
 *
 * ONE tldraw `draw` shape per stroke — a draw shape is a single pen-down, and tldraw renders
 * all the segments of one shape as one continuous line, so packing a whole line into one shape
 * draws phantom joins between the glyphs (seen in the browser, hence this shape).
 *
 * Every frame recomputes the reveal from the wall clock and writes the whole block in one
 * batch, so a slow frame catches up instead of drifting and a repeated frame writes nothing.
 * Cancelling finishes every line that had started, whole: what the autosave persists is always
 * complete writing, never half an equation.
 */
export class HandWriter {
  private readonly canvas: HandCanvas;
  private readonly deps: HandWriterDeps;
  private plan: HandPlan | null = null;
  private meta: JsonObject | null = null;
  private onDone: (() => void) | undefined;
  /** per line, per stroke: the shape carrying that stroke (null until the pen reaches it) */
  private ids: (TLShapeId | null)[][] = [];
  /** strokes whose shape the student erased mid-write: never re-created */
  private dropped: boolean[][] = [];
  private revealed: number[][] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private startedAt = 0;
  private running = false;

  constructor(canvas: HandCanvas, deps: Partial<HandWriterDeps> = {}) {
    this.canvas = canvas;
    this.deps = { ...defaultDeps(), ...deps };
  }

  get active(): boolean {
    return this.running;
  }

  /** Shape ids written so far. */
  get shapeIds(): TLShapeId[] {
    return this.ids.flat().filter((id): id is TLShapeId => id !== null);
  }

  start(plan: HandPlan, opts: HandWriteOptions): void {
    this.plan = plan;
    this.meta = { ...opts.meta, [HAND_BLOCK_META]: `hb_${++blockSeq}_${this.deps.now().toString(36)}` };
    this.onDone = opts.onDone;
    this.ids = plan.lines.map((l) => l.strokes.map(() => null));
    this.dropped = plan.lines.map((l) => l.strokes.map(() => false));
    this.revealed = plan.lines.map((l) => l.strokes.map(() => 0));
    this.running = true;
    this.startedAt = this.deps.now();
    if (this.deps.reducedMotion()) {
      this.finish("finishAll");
      return;
    }
    this.apply(0, "reveal");
    this.timer = this.deps.setTimer(() => this.frame(), HAND_WRITE.frameMs);
  }

  /**
   * Stops the reveal. Every line the pen had started is completed instantly — all of its
   * strokes, not just the ones drawn so far, because half an equation is wrong maths. A line
   * that had not begun is not written at all.
   */
  cancel(): void {
    if (!this.running) return;
    this.finish("finishStarted");
  }

  private frame(): void {
    this.timer = null;
    if (!this.running || !this.plan) return;
    const t = this.deps.now() - this.startedAt;
    this.apply(t, "reveal");
    if (t >= this.plan.totalMs) {
      this.finish("finishAll");
      return;
    }
    this.timer = this.deps.setTimer(() => this.frame(), HAND_WRITE.frameMs);
  }

  private finish(mode: ApplyMode): void {
    if (this.timer !== null) {
      this.deps.clearTimer(this.timer);
      this.timer = null;
    }
    this.apply(Number.POSITIVE_INFINITY, mode);
    this.running = false;
    this.onDone?.();
  }

  private startedLine(i: number): boolean {
    return this.ids[i].some((id) => id !== null) || this.dropped[i].some(Boolean);
  }

  private apply(t: number, mode: ApplyMode): void {
    const plan = this.plan;
    const meta = this.meta;
    if (!plan || !meta) return;
    this.canvas.write(() => {
      const creates: TLShapePartial[] = [];
      const updates: TLShapePartial[] = [];
      for (let i = 0; i < plan.lines.length; i++) {
        const line = plan.lines[i];
        if (mode === "finishStarted" && !this.startedLine(i)) continue;
        const local = mode === "reveal" ? t - line.startMs : Number.POSITIVE_INFINITY;
        if (local <= 0) continue;
        const counts = revealCounts(line.strokes, local);
        for (let j = 0; j < line.strokes.length; j++) {
          if (this.dropped[i][j]) continue;
          const want = counts[j];
          if (want === 0) break;
          const stroke = line.strokes[j];
          const points = stroke.points.slice(0, want).map((p) => ({ ...p }));
          const isComplete = want === stroke.points.length;
          const id = this.ids[i][j];
          if (id === null) {
            const fresh = createShapeId();
            this.ids[i][j] = fresh;
            this.revealed[i][j] = want;
            creates.push({
              id: fresh,
              type: "draw",
              x: line.x,
              y: line.y,
              props: {
                color: HAND_WRITE.color,
                fill: "none",
                dash: "draw",
                size: HAND_WRITE.size,
                segments: [{ type: "free", points }],
                isComplete,
                isClosed: false,
                isPen: true,
                scale: 1,
              },
              meta: { ...meta },
            } satisfies TLShapePartial<TLDrawShape>);
            continue;
          }
          // The student erased this stroke of the tutor's writing: leave it erased.
          if (!this.canvas.getShape(id)) {
            this.dropped[i][j] = true;
            continue;
          }
          if (want === this.revealed[i][j]) continue;
          this.revealed[i][j] = want;
          updates.push({
            id,
            type: "draw",
            props: { segments: [{ type: "free", points }], isComplete },
          } satisfies TLShapePartial<TLDrawShape>);
        }
      }
      if (creates.length > 0) this.canvas.createShapes(creates);
      if (updates.length > 0) this.canvas.updateShapes(updates);
    });
  }
}
