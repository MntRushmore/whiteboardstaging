/**
 * Where each stop of the skill path sits on screen. On a phone the trail is one row that scrolls
 * sideways; on a wider screen it winds like a snake: left to right, down, right to left, down, so
 * the trail never breaks and the next stop is always beside or below the last one. The list keeps
 * teaching order (what a screen reader and the Tab key follow); only the grid cells change.
 *
 * Pure: the number of stops and the columns in, each stop's row, column and link to the next one
 * out. Unit-tested in `__tests__/pathLayout.test.ts`.
 */

/** Which way the trail leaves a stop for the next one; null for the last stop. */
export type PathLink = "right" | "left" | "down" | null;

export interface PathCell {
  /** 0-based grid row */
  row: number;
  /** 0-based grid column */
  col: number;
  /** its row runs left to right (a row's "down" turns on the right), else right to left */
  forward: boolean;
  link: PathLink;
}

/**
 * The snake: `cols` stops to a row, every other row right to left, each row's last stop linked
 * down to the first of the next (which sits right under it).
 */
export function snakeLayout(count: number, cols: number): PathCell[] {
  const n = Math.max(0, Math.floor(count));
  const c = Math.max(1, Math.floor(cols));
  return Array.from({ length: n }, (_, i) => {
    const row = Math.floor(i / c);
    const k = i % c;
    const forward = row % 2 === 0;
    const col = forward ? k : c - 1 - k;
    const link: PathLink = i === n - 1 ? null : k === c - 1 ? "down" : forward ? "right" : "left";
    return { row, col, forward, link };
  });
}

/** The trail's shape: one scrolling row, or a snake of `cols` columns. */
export interface TrailShape {
  mode: "scroll" | "snake";
  cols: number;
}

/** Below this width the trail is one row that scrolls sideways (a phone). */
export const SNAKE_MIN_WIDTH = 600;

/**
 * The shape for a trail `width` pixels wide: on a phone (or before the width is known) one row of
 * every stop, scrolled; wider, as few rows as the columns that fit (at least `cell` pixels each, `gap`
 * between) allow, with the stops shared evenly between them (17 stops in two rows are 9 and 8, not
 * 11 and 6).
 */
export function trailShape(width: number, count: number, cell: number, gap: number): TrailShape {
  const n = Math.max(1, Math.floor(count));
  if (!(width >= SNAKE_MIN_WIDTH) || !(cell > 0)) return { mode: "scroll", cols: n };
  const fit = Math.max(1, Math.floor((width + Math.max(0, gap)) / (cell + Math.max(0, gap))));
  const rows = Math.ceil(n / fit);
  return { mode: "snake", cols: Math.ceil(n / rows) };
}
