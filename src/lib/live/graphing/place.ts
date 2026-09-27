import type { Rect } from "../contracts";
import { PLACEMENT, rectMaxX, rectMaxY, rectsIntersect } from "../placement";

/**
 * Where a graph goes on the screen: BESIDE the work (right of the column, level with its top),
 * else UNDER it (below the work and any solution being written there), sliding right and down
 * past whatever is in the way. Always wholly inside the screen and clear of every shape — a
 * graph drawn over the student's ink is worse than no graph, so there is no forced fallback:
 * null means "no room" and the caller tries a smaller sketch, then gives up.
 */

export const GRAPH_PLACE = {
  /** space kept round the sketch's ink */
  clearance: 10,
  slideX: 40,
  slideY: 24,
  maxSlideX: 320,
} as const;

export interface GraphPlaceContext {
  /** the student's lines of this problem */
  column: Rect;
  /** the column plus anything the tutor is writing under it (the solution block) */
  under: Rect;
  /** the screen (or viewport) the sketch must stay inside */
  bounds: Rect;
  /** every shape on the page, and anything reserved for writing still to come */
  avoid: readonly Rect[];
}

export function placeGraphBlock(size: { w: number; h: number }, ctx: GraphPlaceContext): Rect | null {
  const m = PLACEMENT.viewportMargin;
  const { bounds } = ctx;
  const inside = (r: Rect) =>
    r.x >= bounds.x + m && r.y >= bounds.y + m && rectMaxX(r) <= rectMaxX(bounds) - m && rectMaxY(r) <= rectMaxY(bounds) - m;
  const c = GRAPH_PLACE.clearance;
  const free = (r: Rect) => !ctx.avoid.some((a) => rectsIntersect({ x: r.x - c, y: r.y - c, w: r.w + 2 * c, h: r.h + 2 * c }, a));
  const lowest = rectMaxY(bounds) - m - size.h;
  const candidates: Rect[] = [
    // beside the work, level with its top (or as high as still fits)
    { x: rectMaxX(ctx.column) + PLACEMENT.sideGap, y: Math.max(bounds.y + m, Math.min(ctx.column.y, lowest)), ...size },
    // under the work and its solution
    { x: ctx.column.x, y: rectMaxY(ctx.under) + PLACEMENT.stepGap * 2, ...size },
  ];
  // Right before down: past the line's echo (hidden until hover, but it is there) at the same
  // height, so a graph beside the work stays level with it rather than dropping under the line.
  for (const cand of candidates) {
    for (let y = cand.y; y <= lowest; y += GRAPH_PLACE.slideY) {
      for (let dx = 0; dx <= GRAPH_PLACE.maxSlideX; dx += GRAPH_PLACE.slideX) {
        const r = { ...cand, x: cand.x + dx, y };
        if (rectMaxX(r) > rectMaxX(bounds) - m) break;
        if (inside(r) && free(r)) return r;
      }
    }
  }
  return null;
}
