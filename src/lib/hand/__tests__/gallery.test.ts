import { describe, expect, it } from "vitest";

import { COL_W, GALLERY, buildSheet } from "./gallery";

/**
 * The contact sheet in docs/hand/gallery.png, built in memory: every line on it must
 * still draw completely and fit its column. Regenerate the picture with
 * `npx jiti src/lib/hand/__tests__/gallery.ts` and look at it after changing the hand.
 */
describe("hand gallery", () => {
  it("draws every gallery line, and every line fits its column", () => {
    const { placed, svg } = buildSheet(GALLERY);
    expect(placed.length).toBeGreaterThanOrEqual(40);
    for (const p of placed) {
      expect(p.unsupported, p.latex).toEqual([]);
      expect(p.d.length, p.latex).toBeGreaterThan(0);
      expect(p.w, p.latex).toBeLessThan(COL_W);
    }
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).not.toContain("NaN");
  });
});
