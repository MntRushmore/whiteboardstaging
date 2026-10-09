import { describe, expect, it } from "vitest";
import { SNAKE_MIN_WIDTH, snakeLayout, trailShape, trailWindow } from "../pathLayout";

describe("the snake", () => {
  it("one row when every stop fits: left to right, each linked to the next", () => {
    expect(snakeLayout(4, 4)).toEqual([
      { row: 0, col: 0, forward: true, link: "right" },
      { row: 0, col: 1, forward: true, link: "right" },
      { row: 0, col: 2, forward: true, link: "right" },
      { row: 0, col: 3, forward: true, link: null },
    ]);
  });

  it("winds: down at a row's end, back right to left, the next stop always beside or under the last", () => {
    const cells = snakeLayout(7, 3);
    expect(cells.map((c) => [c.row, c.col, c.link])).toEqual([
      [0, 0, "right"],
      [0, 1, "right"],
      [0, 2, "down"],
      [1, 2, "left"],
      [1, 1, "left"],
      [1, 0, "down"],
      [2, 0, null],
    ]);
    // a turn is on the side its row runs to: the first on the right, the second on the left
    expect(cells.filter((c) => c.link === "down").map((c) => c.forward)).toEqual([true, false]);
    for (let i = 0; i < cells.length - 1; i++) {
      const [a, b] = [cells[i], cells[i + 1]];
      if (a.link === "down") expect([b.row - a.row, b.col - a.col]).toEqual([1, 0]);
      if (a.link === "right") expect([b.row - a.row, b.col - a.col]).toEqual([0, 1]);
      if (a.link === "left") expect([b.row - a.row, b.col - a.col]).toEqual([0, -1]);
    }
  });

  it("nothing, or a bad column count, never breaks it", () => {
    expect(snakeLayout(0, 3)).toEqual([]);
    expect(snakeLayout(2, 0).map((c) => c.link)).toEqual(["down", null]);
  });
});

describe("the trail's shape", () => {
  it("a phone, or a width not known yet: one row of every stop, scrolled sideways", () => {
    expect(trailShape(390, 6, 112, 8)).toEqual({ mode: "scroll", cols: 6, fit: 6 });
    expect(trailShape(0, 4, 112, 8)).toEqual({ mode: "scroll", cols: 4, fit: 4 });
    expect(trailShape(Number.NaN, 4, 112, 8)).toEqual({ mode: "scroll", cols: 4, fit: 4 });
  });

  it("wider: one row when it fits, else as few rows as fit with the stops shared evenly", () => {
    expect(trailShape(SNAKE_MIN_WIDTH, 4, 120, 0)).toEqual({ mode: "snake", cols: 4, fit: 5 });
    expect(trailShape(1200, 6, 120, 0)).toEqual({ mode: "snake", cols: 6, fit: 10 });
    // 17 stops, 10 fit: two rows of 9 and 8
    expect(trailShape(1200, 17, 120, 0)).toEqual({ mode: "snake", cols: 9, fit: 10 });
    // 17 stops, 5 fit: four rows of 5, 5, 5 and 2
    expect(trailShape(600, 17, 120, 0)).toEqual({ mode: "snake", cols: 5, fit: 5 });
  });
});

describe("the home's one row of a long path", () => {
  it("a path that fits shows whole", () => {
    expect(trailWindow(4, 1, 8)).toEqual({ start: 0, end: 4, before: 0, after: 0 });
    expect(trailWindow(8, 7, 8)).toEqual({ start: 0, end: 8, before: 0, after: 0 });
  });

  it("from one stop before the next one, the rest behind a + stop at the end", () => {
    // Algebra 1, 17 stops, 8 places, next is the 2nd: stops 1–7, then "+10"
    expect(trailWindow(17, 1, 8)).toEqual({ start: 0, end: 7, before: 0, after: 10 });
    // next is the 6th: stops 5–11, then "+6"
    expect(trailWindow(17, 5, 8)).toEqual({ start: 4, end: 11, before: 0, after: 6 });
  });

  it("near the end (or all done): the last stops, with the + stop first for the ones before", () => {
    expect(trailWindow(17, 15, 8)).toEqual({ start: 10, end: 17, before: 10, after: 0 });
    expect(trailWindow(17, -1, 8)).toEqual({ start: 10, end: 17, before: 10, after: 0 });
  });

  it("every stop is in the window or counted outside it", () => {
    for (let current = -1; current < 17; current++) {
      const w = trailWindow(17, current, 6);
      expect(w.end - w.start + 1, String(current)).toBe(6);
      expect(w.end - w.start + w.after + (w.before > 0 ? w.before : w.start), String(current)).toBe(17);
      if (current >= 0) expect(current >= w.start && current < w.end, String(current)).toBe(true);
    }
  });
});
