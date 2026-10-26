import { describe, expect, it } from "vitest";
import type { Rgb } from "../overlay";
import { tutorText } from "../prompts";
import { largestEmpty, roomLine, whereWords } from "../room";

/** A white board with black boxes (fractions of its size). */
function board(w: number, h: number, boxes: Array<[number, number, number, number]>): Rgb {
  const data = new Uint8Array(w * h * 3).fill(255);
  for (const [x0, y0, x1, y1] of boxes)
    for (let y = Math.floor(y0 * h); y < Math.floor(y1 * h); y++)
      for (let x = Math.floor(x0 * w); x < Math.floor(x1 * w); x++) data.fill(0, (y * w + x) * 3, (y * w + x) * 3 + 3);
  return { width: w, height: h, data };
}

describe("room on the board", () => {
  it("says nothing about a nearly blank board, and speaks up once the work takes a fair share", () => {
    expect(roomLine(board(320, 180, [[0.02, 0.02, 0.1, 0.08]]))).toBeNull();
    expect(roomLine(board(320, 180, [[0.05, 0.05, 0.3, 0.2]]))).toMatch(/^The empty space on the board is/);
  });

  it("finds the empty right side when the work fills the left (a zoomed-in page)", () => {
    const b = board(320, 180, [[0.02, 0.05, 0.45, 0.95]]);
    const room = largestEmpty(b)!;
    expect(room.x).toBeGreaterThan(0.45);
    expect(whereWords(room)).toBe("the right side");
    expect(roomLine(b)).toMatch(/^The empty space on the board is the right side of the board/);
  });

  it("says the board is nearly full when only a corner is free (a crammed page)", () => {
    const b = board(320, 240, [[0, 0, 1, 0.75], [0, 0.75, 0.7, 1]]);
    const line = roomLine(b)!;
    expect(line).toMatch(/^The board is nearly full: the only empty space is the bottom right/);
  });

  it("goes in the tutor's text only when given", () => {
    expect(tutorText("answer", "ROOM LINE")).toContain("\nROOM LINE\n");
    expect(tutorText("answer")).not.toContain("ROOM LINE");
  });
});
