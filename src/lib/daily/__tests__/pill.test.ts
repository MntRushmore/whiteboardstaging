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

  describe("the simple board, whose More (92 px) takes the top-right corner", () => {
    // More: right-4 top-5, 48 px tall (GrownUpMore); the bar: Back and a 56 px Help me
    const more = (width: number) => ({ left: width - 16 - 92, bottom: 68 });

    it("an upright iPad (820): in the row, left of More, never under it", () => {
      const spot = pillSpot({ width: 820, bar: { top: 16, right: 268, bottom: 72 }, corner: more(820) });
      expect(spot).toEqual({ top: 26, right: 16 + 92 + PILL.gap, inline: true });
      // the pill's right edge stops a gap short of More's left edge
      expect(820 - spot.right).toBeLessThanOrEqual(more(820).left - PILL.gap);
    });

    it("an iPad sideways (1180): the same", () => {
      const spot = pillSpot({ width: 1180, bar: { top: 16, right: 268, bottom: 72 }, corner: more(1180) });
      expect(spot.inline).toBe(true);
      expect(1180 - spot.right).toBeLessThanOrEqual(more(1180).left - PILL.gap);
    });

    it("a phone (390), with no room in the row: under More, at the right", () => {
      expect(pillSpot({ width: 390, bar: { top: 16, right: 268, bottom: 72 }, corner: more(390) })).toEqual({ top: 80, right: PILL.gap, inline: false });
    });

    it("under the bar and More, whichever reaches lower (the bar wraps an error row under Help me)", () => {
      expect(pillSpot({ width: 390, bar: { top: 16, right: 374, bottom: 140 }, corner: more(390) }).top).toBe(148);
      expect(pillSpot({ width: 390, bar: { top: 16, right: 268, bottom: 60 }, corner: { left: 282, bottom: 90 } }).top).toBe(98);
    });

    it("a More narrower than the swatch's corner still keeps the swatch's", () => {
      expect(pillSpot({ width: 1440, bar: { top: 16, right: 600, bottom: 66 }, corner: { left: 1400, bottom: 60 } }).right).toBe(PILL.swatch);
    });
  });
});
