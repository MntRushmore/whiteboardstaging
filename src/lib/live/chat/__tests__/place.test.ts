import { describe, expect, it } from "vitest";
import type { Rect } from "../../contracts";
import { FREE_AREA, gridCells } from "../layout";
import { cellRegions, cellRoom, DRAWING_PLACE, legibleBoxes, placeDrawingRect, spotIn, type DrawingSize } from "../place";

/**
 * Where a drawing goes (`placeDrawingRect`): beside the problem it is about — right of its line in
 * its cell, else under it in the cell's work room, else anywhere free on the screen — every size
 * from the largest down before the next place, and never over anything on the screen. Geometry in,
 * a rect out: the sizes are a graph's and a figure's as the planners make them (y = 2x + 1 with its
 * equation above, 380 / 320 / 264 boxes; a 3-4-5 triangle in the figure boxes).
 */

const SCREEN: Rect = { x: 0, y: 0, w: 1600, h: 900 };
/** y = 2x + 1 and its equation, planned in the graph boxes (380×310, 320×262, 264×216) */
const GRAPH_SIZES: DrawingSize[] = [
  { w: 401, h: 353 },
  { w: 334, h: 305 },
  { w: 278, h: 259 },
];
/** a 3-4-5 triangle in the figure boxes */
const FIGURE_SIZES: DrawingSize[] = [
  { w: 458, h: 366 },
  { w: 378, h: 303 },
  { w: 299, h: 241 },
  { w: 259, h: 210 },
];

/** The chat's grid of n problems on the screen, each problem's ink at the top of its cell. */
function grid(cols: number, rows: number, head: DrawingSize): Array<{ cell: Rect; head: Rect }> {
  return gridCells(SCREEN, cols, rows).map((cell) => ({ cell, head: { x: cell.x + 14, y: cell.y + 14, w: head.w, h: head.h } }));
}
/** four fraction problems: 2 × 2 cells of 752 × 400, each problem ~148 × 64 at the grid's hand */
const FOUR = grid(2, 2, { w: 148, h: 64 });
/** six two-step equations: 3 × 2 cells of 501 × 400, each problem ~234 × 30 */
const SIX = grid(3, 2, { w: 234, h: 30 });

const inside = (r: Rect, outer: Rect) => r.x >= outer.x - 1e-6 && r.y >= outer.y - 1e-6 && r.x + r.w <= outer.x + outer.w + 1e-6 && r.y + r.h <= outer.y + outer.h + 1e-6;
const clear = (r: Rect, a: Rect, c = DRAWING_PLACE.clearance) => !(r.x - c < a.x + a.w && r.x + r.w + c > a.x && r.y - c < a.y + a.h && r.y + r.h + c > a.y);
const innerOf = cellRoom;

function place(problems: Array<{ cell: Rect; head: Rect }>, near: number | null, sizes: ReadonlyArray<DrawingSize | null>, extraInk: Rect[] = []) {
  return placeDrawingRect({
    screen: SCREEN,
    ink: [...problems.map((p) => p.head), ...extraInk],
    cells: problems.map((p) => p.cell),
    near: near === null ? null : problems[near - 1],
    sizes,
  });
}

describe("placeDrawingRect: beside the problem, on this screen", () => {
  it("a graph near problem 3 of four goes right of its line, in its cell, at its largest size, room kept for an answer", () => {
    const at = place(FOUR, 3, GRAPH_SIZES);
    expect(at).toMatchObject({ spot: "beside", index: 0 });
    const { cell, head } = FOUR[2];
    expect(inside(at!.rect, innerOf(cell))).toBe(true);
    // level with the problem, right of it with an answer's room between
    expect(at!.rect.y).toBe(head.y);
    expect(at!.rect.x).toBeGreaterThanOrEqual(head.x + head.w + DRAWING_PLACE.answerRoom);
    // as far right as the cell goes: the student's column under the problem stays wide
    expect(at!.rect.x + at!.rect.w).toBeCloseTo(cell.x + cell.w - DRAWING_PLACE.cellEdge);
    // and never against the next problem, which starts the grid's pad into its own cell
    expect(DRAWING_PLACE.cellEdge + 14).toBeGreaterThanOrEqual(40);
  });

  it("too wide to go beside the line in a grid of six: under it, at the right, leaving the student a column to work in", () => {
    const at = place(SIX, 2, GRAPH_SIZES);
    const { cell, head } = SIX[1];
    const inner = innerOf(cell);
    // the 320 box would fit under it too, but only by taking the student's column: the 264 box keeps it
    expect(at).toMatchObject({ spot: "work", index: 2 });
    expect(inside(at!.rect, inner)).toBe(true);
    expect(at!.rect.x).toBeGreaterThanOrEqual(inner.x + DRAWING_PLACE.workShare * inner.w - 1e-6);
    expect(at!.rect.y).toBeGreaterThanOrEqual(head.y + head.h + DRAWING_PLACE.clearance);
    expect(clear(at!.rect, head)).toBe(true);
  });

  it("a smaller size beside the line comes before the largest under it", () => {
    // beside problem 2 of six there is ~127 px; a drawing that fits there only when small goes there
    const at = place(SIX, 2, [{ w: 300, h: 200 }, { w: 120, h: 100 }]);
    expect(at).toMatchObject({ spot: "beside", index: 1 });
  });

  it("only the room the student hasn't written in: their work under the problem is kept clear of", () => {
    const { cell } = FOUR[0];
    // the student's working down the right half of the cell, and a line beside the problem
    const work: Rect[] = [
      { x: cell.x + 420, y: cell.y + 120, w: 300, h: 60 },
      { x: cell.x + 420, y: cell.y + 200, w: 280, h: 60 },
      { x: cell.x + 260, y: cell.y + 14, w: 120, h: 70 },
    ];
    const at = place(FOUR, 1, FIGURE_SIZES, work);
    expect(at).not.toBeNull();
    expect(inside(at!.rect, innerOf(cell))).toBe(true);
    for (const w of [...work, FOUR[0].head]) expect(clear(at!.rect, w)).toBe(true);
  });

  it("a cell full of the student's work: anywhere free on the screen, outside every problem's cell", () => {
    // one problem on a screen with room below its cell
    const one = [{ cell: { x: 48, y: 72, w: 752, h: 400 }, head: { x: 62, y: 86, w: 148, h: 64 } }];
    const full: Rect = { x: 62, y: 160, w: 724, h: 298 };
    const besideFull: Rect = { x: 300, y: 86, w: 486, h: 70 };
    const at = place(one, 1, FIGURE_SIZES, [full, besideFull]);
    expect(at).toMatchObject({ spot: "free", index: 0 });
    expect(clear(at!.rect, one[0].cell, FREE_AREA.clearance)).toBe(true);
  });

  it("nothing fits even at the smallest size: null, and only then a new screen", () => {
    // four problems fill the screen; problem 3's cell is full of the student's work
    const filled: Rect = { x: FOUR[2].cell.x + 14, y: FOUR[2].cell.y + 90, w: 724, h: 290 };
    const besideFilled: Rect = { x: FOUR[2].cell.x + 200, y: FOUR[2].cell.y + 14, w: 538, h: 80 };
    expect(place(FOUR, 3, GRAPH_SIZES, [filled, besideFilled])).toBeNull();
  });

  it("without near: anywhere free, never in a problem's cell (a grid that fills the screen leaves none)", () => {
    expect(place(FOUR, null, GRAPH_SIZES)).toBeNull();
    const one = [{ cell: { x: 48, y: 72, w: 752, h: 400 }, head: { x: 62, y: 86, w: 148, h: 64 } }];
    const at = place(one, null, GRAPH_SIZES);
    expect(at).toMatchObject({ spot: "free", index: 0 });
    expect(clear(at!.rect, one[0].cell, FREE_AREA.clearance)).toBe(true);
  });

  it("a size that could not be planned is skipped", () => {
    expect(place(FOUR, 3, [null, GRAPH_SIZES[1]])).toMatchObject({ spot: "beside", index: 1 });
    expect(place(FOUR, 3, [null, null])).toBeNull();
  });

  it("never over the student's ink, a problem or the tutor's writing; in the cell, only inside it (random boards)", () => {
    let seed = 7;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    let placed = 0;
    for (let trial = 0; trial < 150; trial++) {
      const problems = trial % 2 === 0 ? FOUR : SIX;
      const n = 1 + Math.floor(rnd() * problems.length);
      const ink: Rect[] = [];
      for (let k = Math.floor(rnd() * 8); k > 0; k--) {
        const c = problems[Math.floor(rnd() * problems.length)].cell;
        ink.push({ x: c.x + rnd() * c.w * 0.8, y: c.y + rnd() * c.h * 0.8, w: 30 + rnd() * 220, h: 20 + rnd() * 90 });
      }
      const at = place(problems, n, trial % 3 === 0 ? FIGURE_SIZES : GRAPH_SIZES, ink);
      if (!at) continue;
      placed++;
      for (const r of [...ink, ...problems.map((p) => p.head)]) expect(clear(at.rect, r)).toBe(true);
      if (at.spot !== "free") expect(inside(at.rect, innerOf(problems[n - 1].cell))).toBe(true);
      else for (const p of problems) expect(clear(at.rect, p.cell, FREE_AREA.clearance)).toBe(true);
    }
    expect(placed).toBeGreaterThan(100);
  });
});

describe("the pieces", () => {
  it("legibleBoxes: largest first, never below half the largest", () => {
    expect(legibleBoxes([{ w: 400, h: 300 }, { w: 300, h: 220 }, { w: 200, h: 150 }, { w: 180, h: 140 }])).toEqual([
      { w: 400, h: 300 },
      { w: 300, h: 220 },
      { w: 200, h: 150 },
    ]);
    expect(legibleBoxes([])).toEqual([]);
  });

  it("cellRegions: beside the line (room for an answer), then the work room's right, then all of it", () => {
    const { cell, head } = FOUR[0];
    const [beside, workRight, work] = cellRegions(cell, head);
    expect(beside).toMatchObject({ spot: "beside", region: { x: head.x + head.w + DRAWING_PLACE.answerRoom, y: cell.y + 14 } });
    expect(workRight.spot).toBe("work");
    expect(workRight.region.y).toBe(head.y + head.h);
    expect(work.region.x).toBe(cell.x + DRAWING_PLACE.cellEdge);
    expect(work.region.y + work.region.h).toBe(cell.y + cell.h - DRAWING_PLACE.cellEdge);
    // a problem as wide as its cell leaves nothing beside it
    expect(cellRegions(cell, { ...head, w: 700 }).map((r) => r.spot)).toEqual(["work", "work"]);
  });

  it("spotIn: the highest row first, the rightmost spot in it", () => {
    const region = { x: 0, y: 0, w: 500, h: 300 };
    expect(spotIn(region, { w: 100, h: 100 }, [])).toEqual({ x: 400, y: 0, w: 100, h: 100 });
    expect(spotIn(region, { w: 100, h: 100 }, [{ x: 380, y: 0, w: 120, h: 50 }])).toEqual({ x: 252, y: 0, w: 100, h: 100 });
    expect(spotIn(region, { w: 600, h: 100 }, [])).toBeNull();
  });
});
