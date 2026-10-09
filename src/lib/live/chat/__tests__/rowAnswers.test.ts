import { describe, expect, it } from "vitest";
import type { Rect } from "../../contracts";
import { splitInk } from "../../diagrams";
import { clusterLines } from "../../strokeClusters";
import { toInkStrokes, writeLine } from "../../__fixtures__/strokes";
import { cellOf, splitAcrossProblems, splitColumnsAtProblems, type ProblemCell } from "../cells";
import { gridCells, PROBLEM_GRID } from "../layout";

/**
 * Today's practice writes a young class's sums side by side (`1. 9 + 3   2. 4 + 9   3. 7 + 9`), and a
 * child writes her answers across the row, one under each. On a phone (zoom ~0.22) and an iPad
 * (~0.52) her digits are so big in page px that two answers a cell apart are closer than the
 * same-row join's reach (`sameRowMaxGapFactor`): the clusterer alone made them ONE line, ringed as
 * one. Each answer is a line of its own, in its own problem's column.
 */

const SCREEN: Rect = { x: 0, y: 0, w: 1600, h: 900 };

/** The chat's problems on a cols-wide grid, as the desk lays them out: the problem at the top of its cell. */
function grid(cols: number, count: number, problems: string[]): ProblemCell[] {
  const rows = Math.ceil(count / cols);
  return gridCells(SCREEN, cols, rows, count).map((cell, i) => ({
    key: `hb_${i + 1}`,
    n: i + 1,
    lines: [problems[i] ?? `${i} + 1`],
    head: { x: cell.x + PROBLEM_GRID.cellPad, y: cell.y + PROBLEM_GRID.cellPad, w: 230, h: PROBLEM_GRID.size },
    cell,
  }));
}

/**
 * A child's answer under problem `cell`, written `size` CSS px tall at `zoom`, starting `at` page px
 * into the cell and one glyph under the problem.
 */
function answer(text: string, cell: ProblemCell, at: number, size: number, zoom: number) {
  const h = Math.round(size / zoom);
  return toInkStrokes(writeLine(text, cell.cell.x + at, cell.head.y + cell.head.h + h * 0.6, h, Math.round(h * 0.15)));
}

const ids = (s: readonly { id: string }[]) => s.map((x) => x.id as string).sort();

function read(all: ReturnType<typeof answer>, cells: ProblemCell[], zoom: number) {
  const split = splitInk(all, [], { zoom });
  expect(split.writing).toHaveLength(all.length);
  const joined = clusterLines(split.writing, [], [], { zoom });
  const lines = clusterLines(split.writing, [], [], { zoom, apart: (g) => splitAcrossProblems(g, cells) });
  const lineOf = (s: { id: string }) => [...(lines.find((l) => l.strokeIds.includes(s.id as never))?.strokeIds ?? [])].sort();
  const joinedOf = (s: { id: string }) => [...(joined.find((l) => l.strokeIds.includes(s.id as never))?.strokeIds ?? [])].sort();
  return { lines, lineOf, joinedOf };
}

// [device, zoom, the child's digits in CSS px, where she starts under each problem (page px into its cell)]
const DEVICES = [
  ["a phone", 0.22, 30, [60, 60, 60]],
  ["an iPad", 0.52, 60, [200, 40, 40]],
] as const;

describe("answers written across a row of the chat's problems", () => {
  for (const [device, zoom, size, at] of DEVICES) {
    it(`two on a row (${device}, zoom ${zoom}): each answer its own line, in its own problem's column`, () => {
      // five problems: three on the first row, problems 4 and 5 on the second
      const cells = grid(3, 5, ["9 + 3", "4 + 9", "7 + 4", "5 + 7", "8 + 6"]);
      const one = answer("12", cells[3], at[0], size, zoom);
      const two = answer("14", cells[4], at[1], size, zoom);
      const { lines, lineOf, joinedOf } = read([...one, ...two], cells, zoom);
      // the clusterer alone joins them (the bug): the fix is what tells them apart
      expect(joinedOf(one[0])).toEqual(ids([...one, ...two]));
      expect(lines).toHaveLength(2);
      expect(lineOf(one[0])).toEqual(ids(one));
      expect(lineOf(two[0])).toEqual(ids(two));
      // each under its own problem, a column of its own
      const { lines: cols, heads } = splitColumnsAtProblems(lines, cells);
      const columnOf = (s: { id: string }) => cols.find((l) => l.strokeIds.includes(s.id as never))!.column;
      expect(columnOf(one[0])).not.toBe(columnOf(two[0]));
      expect(heads.get(columnOf(one[0]))?.n).toBe(4);
      expect(heads.get(columnOf(two[0]))?.n).toBe(5);
    });

    it(`three on a row (${device}, zoom ${zoom}): three lines, one per problem`, () => {
      const cells = grid(3, 5, ["9 + 3", "4 + 9", "7 + 4", "5 + 3", "8 + 8"]);
      const one = answer("12", cells[0], at[0], size, zoom);
      const two = answer("13", cells[1], at[1], size, zoom);
      const three = answer("11", cells[2], at[2], size, zoom);
      const { lines, lineOf, joinedOf } = read([...one, ...two, ...three], cells, zoom);
      expect(joinedOf(two[0]).length).toBeGreaterThan(two.length);
      expect(lines).toHaveLength(3);
      expect(lineOf(one[0])).toEqual(ids(one));
      expect(lineOf(two[0])).toEqual(ids(two));
      expect(lineOf(three[0])).toEqual(ids(three));
      for (const [k, strokes] of [one, two, three].entries()) {
        const box = lines.find((l) => l.strokeIds.includes(strokes[0].id))!.bounds;
        expect(cellOf(box, cells)?.n).toBe(k + 1);
      }
    });
  }

  it("the first answer keeps its line (and its tick) when the second is written beside it", () => {
    const zoom = 0.52;
    const cells = grid(3, 5, ["9 + 3", "4 + 9", "7 + 4", "5 + 3", "8 + 8"]);
    const one = answer("12", cells[0], 200, 60, zoom);
    const before = clusterLines(splitInk(one, [], { zoom }).writing, [], [], { zoom, apart: (g) => splitAcrossProblems(g, cells) });
    expect(before).toHaveLength(1);
    const two = answer("13", cells[1], 40, 60, zoom);
    const after = clusterLines(splitInk([...one, ...two], [], { zoom }).writing, before, [], { zoom, apart: (g) => splitAcrossProblems(g, cells) });
    const first = after.find((l) => l.strokeIds.includes(one[0].id))!;
    // same id, same strokes, same hash: it is not read or marked again
    expect(first.id).toBe(before[0].id);
    expect([...first.strokeIds].sort()).toEqual(ids(one));
    expect(after.find((l) => l.strokeIds.includes(two[0].id))!.id).not.toBe(before[0].id);
  });

  it("answers beside two problems on their row (`= 12`, `= 13`) on a phone: two lines", () => {
    const zoom = 0.22;
    const cells = grid(3, 5, ["9 + 3", "4 + 9", "7 + 4", "5 + 3", "8 + 8"]);
    const h = Math.round(30 / zoom);
    const beside = (text: string, c: ProblemCell) => toInkStrokes(writeLine(text, c.head.x + c.head.w + 20, c.head.y + c.head.h / 2 - h / 2, h, Math.round(h * 0.15)));
    const one = beside("=12", cells[0]);
    const two = beside("=13", cells[1]);
    const g = [...one, ...two];
    const parts = splitAcrossProblems(g, cells).map((p) => ids(p));
    expect(parts).toEqual([ids(one), ids(two)]);
  });

  it("a line written under one problem that runs on under the next, a glyph's space between: one line", () => {
    const cells = grid(3, 5, ["2x + 3 = 11", "4 + 9", "7 + 4", "5 + 3", "8 + 8"]);
    // its glyphs a normal space apart, the last ones past the cell's edge
    const run = toInkStrokes(writeLine("2x+3=11", cells[0].cell.x + cells[0].cell.w - 280, 200, 60, 10));
    expect(splitAcrossProblems(run, cells)).toEqual([run]);
  });
});
