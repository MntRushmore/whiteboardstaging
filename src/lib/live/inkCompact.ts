/**
 * The tutor's ink as light as it can be saved without looking any different.
 *
 * tldraw 4.2 keeps a draw shape's points as JSON `{"x":…,"y":…,"z":…}` — there is no packed
 * encoding — and the hand engine lays strokes out at full double precision: 17 significant
 * digits a coordinate, ~65 bytes a point. A lecture writes tens of thousands of points an hour,
 * and the autosave refuses a board over 4 MB. At 1/100 px a point is ~33 bytes, which is what
 * tldraw's own pen stores for the student's ink (`Drawing.mjs` keeps `toFixed()` points and
 * `z` to two decimals), so the tutor's ink is no finer than the student's and nothing on screen
 * can show the difference: a hundredth of a pixel is 1/25 of a screen pixel at 400 % zoom.
 *
 * What was measured and NOT done (the tutor's ink is drawn by tldraw's freehand renderer, which
 * smooths the points it is given — `streamline` 0.62 — so which points are stored changes what
 * is drawn, not only how much is saved):
 *  - `straight` segments (tldraw interpolates them at render time): `Vec.PointsBetween` gives
 *    the interpolated points a pressure of 0.5–0.825 whatever the stored `z`, so with `isPen`
 *    the line comes out ~30 % bolder (~40 % of the ink area changes).
 *  - fewer free points (Douglas–Peucker, or a subset put back wherever the smoothed outline
 *    moves more than 0.15–0.25 px): the smoothing lags by about one point spacing, so every
 *    curve and corner of a sparser stroke is drawn tighter. Kept faithful, only 1.1–1.5× fewer
 *    points survive — the dense sampling is what the ink looks like.
 * Pure, so it is tested in node.
 */

/** Points are stored at 1/INK_PRECISION px, like tldraw's own pen (0 keeps full precision). */
export const INK_PRECISION = 100;

export type InkPoint = { x: number; y: number; z: number };

/** `n` at `precision` steps per px (unchanged when precision is 0 or n is not finite). */
export function roundInk(n: number, precision: number = INK_PRECISION): number {
  if (!(precision > 0) || !Number.isFinite(n)) return n;
  const r = Math.round(n * precision) / precision;
  // never write "-0" into a saved board
  return r === 0 ? 0 : r;
}

/** A stroke's points at `precision`: x and y to 1/precision px, pressure to two decimals. */
export function roundInkPoints(points: readonly InkPoint[], precision: number = INK_PRECISION): InkPoint[] {
  if (!(precision > 0)) return points.map((p) => ({ ...p }));
  return points.map((p) => ({ x: roundInk(p.x, precision), y: roundInk(p.y, precision), z: roundInk(p.z, 100) }));
}
