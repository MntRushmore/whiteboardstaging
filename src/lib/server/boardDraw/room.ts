/**
 * Where there is room on the board: the largest empty rectangle of the capture (a grid of cells,
 * a cell taken when it or a neighbour has ink), told to the tutor in words so it puts its additions
 * there. The picture bench (2026-10-26) found the painter writing over the kid's work when the tutor
 * asked for "below 204" on a zoomed-in page with nothing below 204, and over other sums on a crammed
 * page.
 */
import type { Rgb } from "./overlay";

/** A part of the board, as fractions of its width and height (0 top-left … 1). */
export type Room = { x: number; y: number; w: number; h: number };

/** Below this share of the board, the tutor is told the board is nearly full. */
export const SMALL_ROOM = 0.12;

/** The largest empty rectangle of the board (cells ~1/32 of its width), or null when there is none. */
export function largestEmpty(board: Rgb, cols = 32): Room | null {
  const W = board.width;
  const H = board.height;
  if (W <= 0 || H <= 0) return null;
  const rows = Math.max(4, Math.round((cols * H) / W));
  const cw = W / cols;
  const ch = H / rows;
  const ink = new Uint8Array(cols * rows);
  // every 2nd pixel is plenty to find ink in a cell
  for (let y = 0; y < H; y += 2)
    for (let x = 0; x < W; x += 2) {
      const i = (y * W + x) * 3;
      const l = 0.299 * board.data[i] + 0.587 * board.data[i + 1] + 0.114 * board.data[i + 2];
      if (l < 200) ink[Math.min(rows - 1, Math.floor(y / ch)) * cols + Math.min(cols - 1, Math.floor(x / cw))] = 1;
    }
  // a cell beside ink is not room either: a note there would touch the work
  const taken = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (!ink[r * cols + c]) continue;
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr;
          const cc = c + dc;
          if (rr >= 0 && rr < rows && cc >= 0 && cc < cols) taken[rr * cols + cc] = 1;
        }
    }
  // the largest all-free rectangle: a histogram per row, the largest rectangle under each
  const heights = new Array<number>(cols).fill(0);
  let best: { area: number; r0: number; c0: number; w: number; h: number } | null = null;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) heights[c] = taken[r * cols + c] ? 0 : heights[c] + 1;
    const stack: number[] = [];
    for (let c = 0; c <= cols; c++) {
      const h = c < cols ? heights[c] : 0;
      while (stack.length && heights[stack[stack.length - 1]] >= h) {
        const top = stack.pop()!;
        const height = heights[top];
        const left = stack.length ? stack[stack.length - 1] + 1 : 0;
        const width = c - left;
        const area = height * width;
        if (height > 0 && (!best || area > best.area)) best = { area, r0: r - height + 1, c0: left, w: width, h: height };
      }
      stack.push(c);
    }
  }
  if (!best) return null;
  return { x: best.c0 / cols, y: best.r0 / rows, w: best.w / cols, h: best.h / rows };
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Where a part of the board is, in words: "the bottom right", "the right side", "the middle". */
export function whereWords(room: Room): string {
  const cx = room.x + room.w / 2;
  const cy = room.y + room.h / 2;
  const across = room.w > 0.75 ? "" : cx < 0.36 ? "left" : cx > 0.64 ? "right" : "";
  const down = room.h > 0.75 ? "" : cy < 0.36 ? "top" : cy > 0.64 ? "bottom" : "";
  if (down && across) return `the ${down} ${across}`;
  if (across) return `the ${across} side`;
  if (down) return `the ${down}`;
  return "the middle";
}

/** Above this share free in one piece, the board is nearly blank and needs no word about room. */
export const BLANK_ROOM = 0.78;

/**
 * The line the tutor is given about room on the board (nothing when it is nearly blank). Even a
 * board two-thirds empty gets it: on a zoomed-in page the room was all to the right, and the tutor
 * still asked for "below 204", where there was none.
 */
export function roomLine(board: Rgb): string | null {
  const room = largestEmpty(board);
  if (!room) return "The board is full: add as little as possible, small, in whatever gap there is.";
  const area = room.w * room.h;
  if (area > BLANK_ROOM) return null;
  const where = `${whereWords(room)} of the board (from ${pct(room.x)} to ${pct(room.x + room.w)} across, ${pct(room.y)} to ${pct(room.y + room.h)} down)`;
  if (area < SMALL_ROOM) return `The board is nearly full: the only empty space is ${where}. Put everything you add there, small, and write as little as fits.`;
  return `The empty space on the board is ${where}: put what you add there, not over or squeezed between the student's writing.`;
}
