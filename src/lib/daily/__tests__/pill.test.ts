/**
 * Where the progress pill goes at a laptop's, an upright iPad's and a phone's board size (the bar
 * boxes measured on the dev server, 2026-10-08).
 */
import { describe, expect, it } from "vitest";
import { BIG_PILL, COMPACT_PILL, PILL, pillSpot } from "../pill";

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

    it("the simple board's 48 px bar (2026-10-12): its 48 px pill in the row, level with Back, Help me and More", () => {
      // Back, Help me and its choice, 48 px tall from 16 px down; More beside them at the same height
      const corner = { left: 1440 - 16 - 92, bottom: 64, right: 1440 - 16 };
      const spot = pillSpot({ width: 1440, bar: { top: 16, right: 237, bottom: 64 }, corner }, BIG_PILL);
      expect(spot).toEqual({ top: 16, right: 16 + 92 + PILL.gap, inline: true });
      expect(BIG_PILL.height).toBe(48);
    });

    it("a phone's 48 px bar: the whole pill does not fit its row, the short one (a star and 0/5) does", () => {
      // Back, Help me (16 px sides) and its choice end at 229; More is its "…" alone, 48 px
      const area = { width: 390, bar: { top: 16, right: 229, bottom: 64 }, corner: { left: 390 - 16 - 48, bottom: 64, right: 390 - 16 } };
      expect(pillSpot(area, BIG_PILL).inline).toBe(false);
      const spot = pillSpot(area, COMPACT_PILL);
      expect(spot).toEqual({ top: 16, right: 16 + 48 + PILL.gap, inline: true });
      // a gap either side: from Help me's choice, and (in `right`) from More
      expect(390 - spot.right - COMPACT_PILL.width - 229).toBeGreaterThanOrEqual(PILL.gap);
    });

    it("under More on a phone, its right edge on More's (not 4 px off it)", () => {
      const corner = { left: 390 - 16 - 92, bottom: 64, right: 390 - 16 };
      expect(pillSpot({ width: 390, bar: { top: 16, right: 237, bottom: 64 }, corner }, BIG_PILL)).toEqual({ top: 72, right: 16, inline: false });
    });

    it("a More narrower than the swatch's corner still keeps the swatch's", () => {
      expect(pillSpot({ width: 1440, bar: { top: 16, right: 600, bottom: 66 }, corner: { left: 1400, bottom: 60 } }).right).toBe(PILL.swatch);
    });
  });
});
