import { describe, expect, it } from "vitest";
import { checkFigure } from "../check";
import { FIGURE_GALLERY, buildGallery, writeGallery } from "./gallery";

/**
 * The contact sheet in docs/figure/gallery.png, built in memory: every figure on it must be a
 * spec the check passes, drawn with every label clear, within the pacing budget. Regenerate the
 * picture with `FIGURE_GALLERY=1 npx vitest run src/lib/live/figureDraw/__tests__/gallery.test.ts`
 * and look at it after changing the drawer.
 */
describe("figure gallery", () => {
  it("every gallery spec passes the check", () => {
    for (const item of FIGURE_GALLERY) expect(checkFigure(item.spec), item.title).toEqual([]);
  });

  it("draws every gallery figure, labels clear, each within ~6 s", () => {
    const { svg, cells } = buildGallery();
    // written before the assertions, so a failing figure can be looked at
    if (process.env.FIGURE_GALLERY === "1") console.log(`wrote ${writeGallery(process.cwd(), svg).join(", ")}`);
    expect(cells).toHaveLength(FIGURE_GALLERY.length);
    for (const c of cells) {
      expect(c.drawn, c.title).toBe(true);
      expect(c.strokes, c.title).toBeGreaterThan(3);
      expect(c.collisions, c.title).toBe(0);
      expect(c.wallMs, c.title).toBeLessThanOrEqual(6000);
    }
    expect(svg).not.toContain("NaN");
  });
});
