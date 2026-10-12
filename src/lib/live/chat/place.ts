import type { Rect } from "../contracts";
import { findFreeArea, FREE_AREA, PROBLEM_GRID } from "./layout";

/**
 * Where a drawing goes on the screen (docs/ASK-V2.md, "Placement"): a figure, a graph or a visual
 * model the desk can plan at several sizes, largest first. Pure geometry: rects in, a rect out; the
 * desk (`ChatDesk.placeDrawing`) plans the sizes and writes the drawing where this says.
 *
 * With the problem it goes with (`near`), the drawing stays beside that problem on THIS screen, in
 * this order, each step trying every size from the largest down before the next step:
 *   1. `beside`: right of the problem's line, inside its cell, as far right as the cell goes, so the
 *      row keeps room for an answer written after the problem (`= 4`);
 *   2. `work`: in the cell's work room under the problem, at its right, leaving the student a column
 *      to work in at its left (`workShare` of the cell); then anywhere in that room;
 *   3. `free`: anywhere free on the screen, outside every problem's cell.
 * Without `near`, only step 3. Null when nothing fits even at the smallest size: only then does the
 * caller start a new screen.
 *
 * It never covers anything on the screen — the student's ink, the problems, the tutor's writing
 * (`ink`, kept `clearance` clear of). In a cell it uses only the room the student hasn't written in
 * (their ink there is in `ink`); everywhere else every problem's cell is kept whole, as the student's
 * working space.
 */
export const DRAWING_PLACE = {
  /** the top of the cell's room: the grid's own pad, so a drawing beside the problem is level with it */
  cellPad: PROBLEM_GRID.cellPad,
  /**
   * kept from the cell's other edges: the next problem starts the grid's pad past its own cell's
   * edge, so a drawing stands ~44 px (about a problem's hand) from a neighbouring problem, never
   * against it (seen on the board: a graph's x-axis label 28 px from the next problem's number)
   */
  cellEdge: 30,
  /** space kept round the student's ink, the problems and the tutor's writing */
  clearance: FREE_AREA.clearance,
  /** right of the problem's line: room kept for an answer written on its row (`= 4` after `2 + 2`) */
  answerRoom: 96,
  /** under the problem: the student keeps at least this share of the cell's width to work in, at its left */
  workShare: 0.35,
  /** how finely positions in a cell are tried (px) */
  step: 12,
  /**
   * The legible floor: a drawing is never planned in a box smaller than this share of its largest
   * box (each kind's list stops at its own legible minimum; this holds whatever a list holds).
   */
  minScale: 0.5,
} as const;

export type DrawingSpot = "beside" | "work" | "free";

export interface DrawingSize {
  w: number;
  h: number;
}

export interface DrawingPlaceInput {
  /** the screen's rect */
  screen: Rect;
  /** the bounds of everything on the screen: the student's ink, the problems, the tutor's writing */
  ink: readonly Rect[];
  /** every problem's cell on the screen (kept whole outside the cell of the problem it goes with) */
  cells: readonly Rect[];
  /** the problem it goes with: its cell, and where its ink is (its number and lines) */
  near?: { cell: Rect; head: Rect } | null;
  /** the drawing's size planned in each box tried, largest first (null: it could not be planned in that box) */
  sizes: ReadonlyArray<DrawingSize | null>;
}

export interface DrawingPlace {
  /** which of `sizes` */
  index: number;
  /** where it goes: its top-left corner and size */
  rect: Rect;
  spot: DrawingSpot;
}

/** The boxes worth planning: largest first, none below the legible floor (`minScale` of the largest). */
export function legibleBoxes<B extends DrawingSize>(boxes: readonly B[]): B[] {
  const first = boxes[0];
  if (!first) return [];
  return boxes.filter((b) => b.w > 0 && b.h > 0 && Math.min(b.w / first.w, b.h / first.h) >= DRAWING_PLACE.minScale - 1e-9);
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** `from` to `to` every `step`, both ends included (empty when `to` < `from`). */
function steps(from: number, to: number, step: number): number[] {
  if (to < from - 1e-9) return [];
  const out: number[] = [];
  for (let v = from; v < to - 1e-9; v += step) out.push(v);
  out.push(to);
  return out;
}

/**
 * The first spot for `size` inside `region` clear of `avoid` (each kept `clearance` away): the
 * highest row first, and in a row the rightmost spot first.
 */
export function spotIn(region: Rect, size: DrawingSize, avoid: readonly Rect[], clearance: number = DRAWING_PLACE.clearance, step: number = DRAWING_PLACE.step): Rect | null {
  if (size.w > region.w + 1e-9 || size.h > region.h + 1e-9) return null;
  const grownRegion = { x: region.x - clearance, y: region.y - clearance, w: region.w + 2 * clearance, h: region.h + 2 * clearance };
  const near = avoid.filter((a) => intersects(grownRegion, a));
  const xs = steps(region.x, region.x + region.w - size.w, step).reverse();
  for (const y of steps(region.y, region.y + region.h - size.h, step)) {
    for (const x of xs) {
      const grown = { x: x - clearance, y: y - clearance, w: size.w + 2 * clearance, h: size.h + 2 * clearance };
      if (!near.some((a) => intersects(grown, a))) return { x, y, w: size.w, h: size.h };
    }
  }
  return null;
}

/** The part of a problem's cell a drawing may use: from level with the problem, kept `cellEdge` from its other edges. */
export function cellRoom(cell: Rect): Rect {
  const { cellPad, cellEdge } = DRAWING_PLACE;
  return { x: cell.x + cellEdge, y: cell.y + cellPad, w: cell.w - 2 * cellEdge, h: cell.h - cellPad - cellEdge };
}

/** The regions of the cell a drawing may go in, in the order they are tried. */
export function cellRegions(cell: Rect, head: Rect): Array<{ spot: DrawingSpot; region: Rect }> {
  const inner = cellRoom(cell);
  const { answerRoom, workShare } = DRAWING_PLACE;
  const right = inner.x + inner.w;
  const bottom = inner.y + inner.h;
  const headRight = Math.max(inner.x, head.x + head.w);
  const headBottom = Math.max(inner.y, head.y + head.h);
  const besideX = headRight + answerRoom;
  const workX = inner.x + workShare * inner.w;
  const regions: Array<{ spot: DrawingSpot; region: Rect }> = [
    // right of the problem's line, as tall as the cell (it may reach down beside the work room)
    { spot: "beside", region: { x: besideX, y: inner.y, w: right - besideX, h: inner.h } },
    // under the problem, leaving the student a column to work in at the left
    { spot: "work", region: { x: workX, y: headBottom, w: right - workX, h: bottom - headBottom } },
    // anywhere in the work room the student hasn't written in
    { spot: "work", region: { x: inner.x, y: headBottom, w: inner.w, h: bottom - headBottom } },
  ];
  return regions.filter((r) => r.region.w > 0 && r.region.h > 0);
}

/**
 * Where the drawing goes on this screen, and at which size (`DRAWING_PLACE`, above); null when
 * nothing fits even at the smallest size (the caller starts a new screen).
 */
export function placeDrawingRect(input: DrawingPlaceInput): DrawingPlace | null {
  const { screen, ink, cells, near, sizes } = input;
  const first = (spot: DrawingSpot, find: (size: DrawingSize) => Rect | null): DrawingPlace | null => {
    for (let index = 0; index < sizes.length; index++) {
      const size = sizes[index];
      if (!size || !(size.w > 0) || !(size.h > 0)) continue;
      const rect = find(size);
      if (rect) return { index, rect, spot };
    }
    return null;
  };
  if (near) {
    // the problem's own ink is kept clear of even when the caller's ink leaves it out
    const avoid = [...ink, near.head];
    for (const { spot, region } of cellRegions(near.cell, near.head)) {
      const found = first(spot, (size) => spotIn(region, size, avoid));
      if (found) return found;
    }
  }
  const taken = [...ink, ...cells];
  return first("free", (size) => findFreeArea(size, screen, taken));
}
