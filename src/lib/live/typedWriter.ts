import type { TLDrawShape, TLShapeId } from "tldraw";
import { layoutMath } from "@/lib/hand";
import type { TypedLineRef, TypedSpot, WriteTypedArgs, WriteTypedResult } from "@/lib/typeMath/contracts";
import { TYPED_LATEX_META, TYPED_TEXT_META } from "@/lib/typeMath/contracts";
import { typeBarInset } from "@/lib/typeMath/barLink";
import type { InkStroke, LiveLineState, Rect } from "./contracts";
import { HAND_WRITE, handSeedFor, inlineHandSizeFor } from "./handwriting";
import type { LiveLoop, LiveLoopDeps } from "./liveLoop";
import { liveStore } from "./liveStore";
import { expandRect, rectMaxX, rectMaxY, rectsIntersect } from "./placement";
import { inkScale, median, medianStrokeHeight } from "./strokeClusters";
import { lineGroupsOf, type LineGroup } from "./typedInk";
import { readScreenMeta } from "@/lib/screens/screens";
import type { ProblemCell } from "./chat/cells";
import { FREE_AREA, findFreeArea } from "./chat/layout";
import { placeInCell } from "./chat/work";

/**
 * Type it's writer (docs/TYPE-MATH.md): where a typed line goes on the board, how big, and the
 * rewrite of one. Only the bar uses it, so it is never in the board's first load: the bar loads it
 * (`LiveController.prepareTyped`) with its own chunk. Reading a typed line, Undo, a reload and the
 * kid's ink itself stay in the Live loop, which works the same with no bar on the board.
 */

/**
 * How big a typed line is written and where it goes. Page px on a desktop; a board shown smaller
 * (`TypedHost.scale`) grows them, so the line looks the same on screen.
 */
export const TYPED = {
  /** with nothing of the kid's own writing to match: a little under the chat's problems (48), easy to read on a laptop */
  size: 40,
  /** matching a tiny trackpad hand, never smaller than this (a digit about 18 px tall) */
  minSize: 28,
  /** `layoutSteps`' line pitch, baseline to baseline, in sizes: the gap under the line above is this less a digit */
  pitch: 1.7,
  /** ...and at most this many of the column's lines, well inside the new-problem rule (2.5, f911cac) */
  maxGapLines: 1.5,
  /** "New problem" under one: this many of its lines further down, past the new-problem rule */
  problemGapLines: 3,
  /** what is still under a column: the tutor's work there is within this many of its lines of the next thing up */
  reachLines: 1.5,
  /** between a full column and the next */
  columnGap: 64,
  /** the typing bar docked over the bottom of the board, in CSS px, when it has not said how tall it is */
  barPx: 120,
} as const;

/** A problem on the board: its lines top to bottom, and the chat's problem heading them. */
export interface TypedTarget {
  states: LiveLineState[];
  head: ProblemCell | null;
}

/**
 * What the writer needs of the Live loop (`LiveLoop.typedHost`): the loop itself for what it does for
 * any line (its editor, `writeInk`, `retypeLine`), and three reads of its own state. Everything else
 * the writer works out here, so the host costs the board's first load next to nothing.
 */
export interface TypedHost {
  readonly loop: Pick<LiveLoop, "editor" | "writeInk" | "retypeLine">;
  readonly deps: Pick<LiveLoopDeps, "now" | "reducedMotion">;
  /** Live is running on this board: a line can be written and read */
  on(): boolean;
  /** this column's problem; with none given, the one Help acts on (where the kid last wrote or typed), else the chat's current problem */
  target(column?: number): TypedTarget | null;
  /** where the tutor's blocks still being written will be, whole */
  busy(): Rect[];
}

export interface TypedWriter {
  write(args: WriteTypedArgs): WriteTypedResult;
  spot(opts?: { newProblem?: boolean }): TypedSpot | null;
  lines(): TypedLineRef[];
}

/**
 * The writer over a loop. The bar counts what it writes and what is refused (`type.write`,
 * `type.edit`, `type.refused`), so nothing here is counted twice.
 */
export function typedWriter(host: TypedHost): TypedWriter {
  const { editor } = host.loop;
  const zoom = () => editor.getBaseZoom?.();
  /** the line group this line is, whole and nothing else (as the loop reads it: `LiveLoop.typedGroupOf`) */
  const groupOf = (strokeIds: readonly TLShapeId[]): LineGroup | null => {
    const groups = lineGroupsOf(strokeIds.flatMap((id) => editor.getShape(id) ?? []));
    return groups.length === 1 && groups[0].strokeIds.length === strokeIds.length ? groups[0] : null;
  };
  /**
   * A line the kid typed, written on the board in their own ink by the hand engine and read as the
   * LaTeX they typed: the next line of the problem they are on (or a new problem), or `replaceLineId`
   * rewritten. A typed line is rewritten in place; a pen line keeps its ink and takes the typed
   * reading. Everything after the read is as for any line: marks, Auto, Help, the learning record.
   */
  const write = (args: WriteTypedArgs): WriteTypedResult => {
    const latex = args.latex.trim();
    if (!host.on()) return { ok: false, reason: "off" };
    if (!latex) return { ok: false, reason: "empty" };
    const old = args.replaceLineId ? liveStore.lines.get()[args.replaceLineId] : undefined;
    if (args.replaceLineId && !old) return { ok: false, reason: "noLine" };
    const group = old ? groupOf(old.line.strokeIds) : null;
    if (old && group?.latex === undefined) {
      // written with the pen: the ink is theirs and stays; what it says is what they typed
      host.loop.retypeLine(old.line.id, latex);
      return { ok: true, lineId: old.line.id, bounds: old.line.bounds };
    }
    const id = group?.id ?? `ty_${host.deps.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const target = host.target(old?.line.column);
    const size = sizeFor(target?.states ?? []);
    // the same id, the same hand: a line typed again is not written differently for nothing
    const layout = layoutMath(latex, { size, seed: handSeedFor(id) });
    if (layout.unsupported.length > 0 || layout.strokes.length === 0) return { ok: false, reason: "unwritable" };
    let at: { x: number; y: number };
    if (old && group?.latex) {
      // in its place: its left edge, on its writing line
      const was = layoutMath(group.latex, { size, seed: handSeedFor(id) });
      const b = old.line.bounds;
      at = { x: b.x, y: b.y + (was.height > 0 ? (b.h * was.baseline) / was.height : b.h) - layout.baseline };
    } else at = place(target, size, Boolean(args.newProblem), { w: layout.width, h: layout.height });
    const ids = host.loop.writeInk(layout.strokes, at, id, { [TYPED_LATEX_META]: latex, [TYPED_TEXT_META]: args.text }, group?.strokeIds);
    const line = Object.values(liveStore.lines.get()).find((s) => s.line.strokeIds.includes(ids[0]))?.line;
    const bounds = line?.bounds ?? { ...at, w: layout.width, h: layout.height };
    keepInView(bounds);
    return { ok: true, lineId: line?.id ?? "", bounds };
  };

  /** Where Enter writes next, for the bar's ghost caret: as `write` would, with nothing written. */
  const spot = (opts: { newProblem?: boolean } = {}): TypedSpot | null => {
    if (!host.on()) return null;
    const target = host.target();
    const size = sizeFor(target?.states ?? []);
    const h = size * HAND_WRITE.digitRatio;
    const at = place(target, size, Boolean(opts.newProblem), { w: 2 * size, h });
    return { x: at.x, baselineY: at.y + h, size };
  };

  /** The current problem's lines, top to bottom, for ↑ and the pencil in the bar. */
  const lines = (): TypedLineRef[] =>
    (host.target()?.states ?? []).map((s) => {
      const group = groupOf(s.line.strokeIds);
      return { lineId: s.line.id, typed: group?.latex !== undefined, typedText: group?.text ?? "", latex: s.latex, bounds: s.line.bounds };
    });

  /** The hand a typed line is written in: the height of the kid's own writing in the column (`inlineHandSizeFor`), else a readable default. */
  const sizeFor = (states: readonly LiveLineState[]): number => {
    const k = inkScale(zoom());
    const pen: InkStroke[] = [];
    for (const s of states) {
      if (groupOf(s.line.strokeIds)?.latex !== undefined) continue;
      for (const id of s.line.strokeIds) {
        const shape = editor.getShape(id);
        const b = shape?.type === "draw" ? editor.getShapePageBounds(shape) : undefined;
        if (!shape || !b) continue;
        // its glyph size is all that is asked of it (`medianStrokeHeight`): bounds, and its path's length
        const m = editor.getShapePageTransform(shape);
        const segments = (shape as TLDrawShape).props.segments.map((seg) => seg.points.map((p) => m.applyToPoint(p)));
        pen.push({ id, bounds: { x: b.x, y: b.y, w: b.w, h: b.h }, segments });
      }
    }
    if (pen.length === 0) return Math.round(TYPED.size * k);
    return Math.max(Math.round(TYPED.minSize * k), inlineHandSizeFor(medianStrokeHeight(pen), zoom()));
  };

  /**
   * The top-left of a typed line `dims` big: at the left edge of the problem's column, under the
   * lowest thing in its span (the kid's ink, the tutor's writing, readbacks, marks, a block still
   * being written) and down to the next problem there, a step's gap below — or, for a new problem,
   * past the new-problem gap. No room before the bar → the next column to the right; then anywhere
   * free on the screen; with none at all, under the column regardless (the camera follows).
   */
  const place = (target: TypedTarget | null, size: number, newProblem: boolean, dims: { w: number; h: number }): { x: number; y: number } => {
    const k = inkScale(zoom());
    // the screen (the whiteboard's own edge, whatever the zoom), else the viewport: as the loop places
    const view = editor.getViewportPageBounds();
    const screen = readScreenMeta(editor.getCurrentPage?.()?.meta) ?? { x: view.x, y: view.y, w: view.w, h: view.h };
    // the screen's writing area: clear of the board's bar on top and the typing bar at the bottom
    const room = { ...screen, h: screen.h - TYPED.barPx * Math.min(k, 2) };
    const area = { x: screen.x + FREE_AREA.margin, y: screen.y + FREE_AREA.top, w: screen.w - 2 * FREE_AREA.margin, h: room.h - FREE_AREA.top };
    const all = Object.values(liveStore.lines.get());
    const inLines = new Set<string>(all.flatMap((s) => s.line.strokeIds));
    const loose: Rect[] = [];
    const avoid: Rect[] = [];
    for (const s of editor.getCurrentPageShapes()) {
      const b = editor.getShapePageBounds(s);
      if (!b) continue;
      const r = { x: b.x, y: b.y, w: b.w, h: b.h };
      avoid.push(r);
      if (!inLines.has(s.id)) loose.push(r);
    }
    // the tutor's blocks still being written take their room too
    for (const r of host.busy()) {
      loose.push(r);
      avoid.push(r);
    }
    const own = target?.states.map((s) => s.line.bounds) ?? [];
    const col = target?.head ? [...own, target.head.head] : own;
    let below: { x: number; y: number } | null = null;
    let spread = 0;
    if (target && col.length > 0) {
      const head = target.head;
      const lefts = own.length > 0 ? own : col;
      const x = Math.min(...lefts.map((r) => r.x));
      const right = Math.max(...col.map(rectMaxX));
      const lineH = median(lefts.map((r) => r.h)) || dims.h;
      const inSpan = (r: Rect) => r.x < right && rectMaxX(r) > x;
      // a continued problem stays in the chat's cell it is under
      const limit = Math.min(rectMaxY(area), head && !newProblem ? rectMaxY(head.cell) : Infinity);
      const top = Math.min(...col.map((r) => r.y));
      let bottom = Math.max(...col.map(rectMaxY));
      // the next problem down in its span starts where everything under this one ends
      const mine = new Set(target.states.map((s) => s.line.id));
      const stop = Math.min(limit, ...all.filter((s) => !mine.has(s.line.id) && inSpan(s.line.bounds) && s.line.bounds.y >= bottom).map((s) => s.line.bounds.y));
      const reach = TYPED.reachLines * lineH;
      for (const r of loose.filter((r) => inSpan(r) && rectMaxY(r) > top && r.y < stop).sort((a, b) => a.y - b.y)) {
        if (r.y > bottom + reach) break;
        bottom = Math.max(bottom, rectMaxY(r));
      }
      const gap = newProblem
        ? TYPED.problemGapLines * Math.max(lineH, dims.h)
        : Math.max(0.32 * size, Math.min((TYPED.pitch - HAND_WRITE.digitRatio) * size, TYPED.maxGapLines * lineH));
      below = { x, y: bottom + gap };
      if (below.y + dims.h <= limit) return below;
      // no room under it: the next column, right of the work beside it, from the top
      const band = head && !newProblem ? head.cell : area;
      const from = Math.max(right, ...avoid.filter((r) => r.x >= x && rectsIntersect(r, band)).map(rectMaxX)) + TYPED.columnGap * k;
      const next = placeInCell(dims, { x: from, y: head && !newProblem ? rectMaxY(head.head) + gap : area.y }, { ...band, h: limit - band.y }, avoid);
      if (next && next.x >= from - 1) return next;
      // anywhere else, far enough from other work not to be read as part of it
      spread = TYPED.problemGapLines * lineH;
    }
    return findFreeArea(dims, room, spread > 0 ? avoid.map((r) => expandRect(r, spread)) : avoid) ?? below ?? { x: area.x, y: area.y };
  };

  /** The line just written is where the kid can see it: not off screen, not under the typing bar (a gentle pan). */
  const keepInView = (r: Rect): void => {
    const cam = editor.getCamera?.();
    if (!cam || !editor.setCamera) return;
    const view = editor.getViewportPageBounds();
    const z = editor.getZoomLevel?.() || 1;
    const pad = 24 / z;
    // the open bar's real height (it grows with the keys row and an on-screen keyboard), else its usual one
    const bar = typeBarInset.get() || TYPED.barPx;
    const dy = Math.max(0, rectMaxY(r) + pad - (view.y + view.h - bar / z)) || Math.min(0, r.y - pad - view.y);
    const dx = Math.max(0, rectMaxX(r) + pad - (view.x + view.w)) || Math.min(0, r.x - pad - view.x);
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    editor.setCamera({ x: cam.x - dx, y: cam.y - dy, z: cam.z }, host.deps.reducedMotion() ? undefined : { animation: { duration: 320 } });
  };

  return { write, spot, lines };
}
