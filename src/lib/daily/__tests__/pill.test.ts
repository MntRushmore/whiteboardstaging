/**
 * Where the progress pill goes at a laptop's, an upright iPad's and a phone's board size (the bar
 * boxes measured on the dev server, 2026-10-08).
 */
import { describe, expect, it } from "vitest";
import { PILL, pillSpot } from "../pill";

describe("pillSpot", () => {
  it("a laptop: in the bar's row, left of the pen's swatch", () => {
    expect(pillSpot({ width: 1440, bar: { top: 16, right: 892, bottom: 66 } })).toEqual({ top: 23, right: PILL.swatch, inline: true });
  });

  it("an upright iPad, whose one row leaves no room: under the bar at the right", () => {
    const spot = pillSpot({ width: 1024, bar: { top: 16, right: 926, bottom: 68 } });
    expect(spot.inline).toBe(false);
    expect(spot).toEqual({ top: 76, right: PILL.gap, inline: false });
  });

  it("a phone, whose bar wraps to three rows: under the last row", () => {
    expect(pillSpot({ width: 390, bar: { top: 16, right: 290, bottom: 178 } })).toEqual({ top: 186, right: PILL.gap, inline: false });
  });

  it("no bar to measure: the top right corner", () => {
    expect(pillSpot({ width: 800, bar: null })).toEqual({ top: PILL.top, right: PILL.gap, inline: false });
  });
});
