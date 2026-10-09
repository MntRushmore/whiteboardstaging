import { describe, expect, it } from "vitest";
import { SNAKE_MIN_WIDTH, snakeLayout, trailShape } from "../pathLayout";

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
    expect(trailShape(390, 6, 112, 8)).toEqual({ mode: "scroll", cols: 6 });
    expect(trailShape(0, 4, 112, 8)).toEqual({ mode: "scroll", cols: 4 });
    expect(trailShape(Number.NaN, 4, 112, 8)).toEqual({ mode: "scroll", cols: 4 });
  });

  it("wider: one row when it fits, else as few rows as fit with the stops shared evenly", () => {
    expect(trailShape(SNAKE_MIN_WIDTH, 4, 120, 0)).toEqual({ mode: "snake", cols: 4 });
    expect(trailShape(1200, 6, 120, 0)).toEqual({ mode: "snake", cols: 6 });
    // 17 stops, 10 fit: two rows of 9 and 8
    expect(trailShape(1200, 17, 120, 0)).toEqual({ mode: "snake", cols: 9 });
    // 17 stops, 5 fit: four rows of 5, 5, 5 and 2
    expect(trailShape(600, 17, 120, 0)).toEqual({ mode: "snake", cols: 5 });
  });
});
