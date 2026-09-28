"use client";

import type { Editor } from "tldraw";
import { readScreenMeta } from "@/lib/screens/screens";
import type { LiveShapeMeta, Rect } from "../contracts";
import { HandWriter, handSeedFor, placeHandPlan, type HandWriterDeps } from "../handwriting";
import { liveWrite } from "../liveWrite";
import { rectsIntersect } from "../placement";
import { checkFigure } from "./check";
import type { FigureSpec } from "./contracts";
import { FIGURE, planFigure } from "./plan";

/**
 * A figure put on the board by the tutor's hand, in free space on the current screen: the plan
 * from `planFigure`, revealed by the same `HandWriter` as the worked steps, every stroke carrying
 * the tutor's meta (`live: true`, `source: "ai"`) so the Live reader never takes it for the
 * student's ink. In development the board exposes it as `window.__agathonDrawFigure(spec)`; the
 * board chat's own placement is its business — this is the smallest honest way to see a figure
 * on the real board.
 */

/** meta key on every stroke of a drawn figure: the spec's hash */
export const FIGURE_META = "figure";

export type FigureBoardEditor = Pick<Editor, "store" | "createShapes" | "updateShapes" | "getShape" | "getCurrentPageShapes" | "getShapePageBounds" | "getViewportPageBounds" | "getCurrentPage">;

export interface DrawnFigure {
  /** what `checkFigure` says about the spec ([] when it is sound) */
  problems: string[];
  /** where the figure's ink went (page px), or null when nothing was drawn */
  rect: Rect | null;
  writer: HandWriter | null;
}

/** space kept round the figure, and the step of the search for a free spot */
const ROOM = { clearance: 16, step: 24, margin: 24 } as const;

/** The first spot (left to right, top to bottom) where a w × h block touches nothing on the page. */
function freeSpot(editor: FigureBoardEditor, size: { w: number; h: number }): { x: number; y: number } | null {
  const screen = readScreenMeta(editor.getCurrentPage().meta);
  const vp = editor.getViewportPageBounds();
  const bounds: Rect = screen ?? { x: vp.x, y: vp.y, w: vp.w, h: vp.h };
  const avoid: Rect[] = [];
  for (const s of editor.getCurrentPageShapes()) {
    const b = editor.getShapePageBounds(s);
    if (b) avoid.push({ x: b.x - ROOM.clearance, y: b.y - ROOM.clearance, w: b.w + 2 * ROOM.clearance, h: b.h + 2 * ROOM.clearance });
  }
  for (let y = bounds.y + ROOM.margin; y + size.h <= bounds.y + bounds.h - ROOM.margin; y += ROOM.step) {
    for (let x = bounds.x + ROOM.margin; x + size.w <= bounds.x + bounds.w - ROOM.margin; x += ROOM.step) {
      const r = { x, y, w: size.w, h: size.h };
      if (!avoid.some((a) => rectsIntersect(a, r))) return { x, y };
    }
  }
  return null;
}

export function drawFigureOnBoard(
  editor: FigureBoardEditor,
  spec: unknown,
  opts: { box?: { w: number; h: number }; seed?: number; deps?: Partial<HandWriterDeps> } = {},
): DrawnFigure {
  const figure = spec as FigureSpec;
  const problems = checkFigure(figure);
  const key = handSeedFor(JSON.stringify(spec)).toString(36);
  const planned = planFigure(figure, { seed: opts.seed ?? handSeedFor(key), box: opts.box ?? FIGURE.box });
  if (!planned) return { problems, rect: null, writer: null };
  const at = freeSpot(editor, { w: planned.plan.bounds.w, h: planned.plan.bounds.h });
  if (!at) return { problems, rect: null, writer: null };
  const plan = placeHandPlan(planned.plan, at);
  const writer = new HandWriter(
    {
      write: (fn) => liveWrite(editor as Editor, fn),
      createShapes: (shapes) => editor.createShapes(shapes),
      updateShapes: (shapes) => editor.updateShapes(shapes),
      getShape: (id) => editor.getShape(id),
    },
    opts.deps,
  );
  const now = opts.deps?.now?.() ?? Date.now();
  const meta: LiveShapeMeta = { live: true, source: "ai", lineId: `figure_${key}`, createdAt: now };
  writer.start(plan, { meta, extraMeta: { [FIGURE_META]: key }, whole: true });
  return { problems, rect: plan.bounds, writer };
}
