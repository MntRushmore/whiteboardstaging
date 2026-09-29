import { describe, expect, it } from "vitest";
import { SketchDrawingSchema } from "../contracts";
import { writeGallery } from "./gallery";
import { COMICS, SKETCH_GALLERY, buildSketchGallery } from "./sketchGallery";

/**
 * The free-drawing contact sheet (docs/lecture/sketch.png), built in memory: every drawing on it is
 * one the route may send, and every picture and comic is drawn, in its box, within its time.
 * Regenerate the picture with `LECTURE_GALLERY=1 npx vitest run src/lib/live/lecture/__tests__/sketchGallery.test.ts`
 * (`LECTURE_GALLERY=debug` shades the writing and the drawing areas) and look at it after changing
 * the sketch planners.
 */
describe("sketch gallery", () => {
  it("every fixture is a drawing the route may send", () => {
    for (const g of SKETCH_GALLERY) expect(SketchDrawingSchema.safeParse(g.drawing).success, g.title).toBe(true);
  });

  it("draws every picture and every comic, each within its time", () => {
    const flag = process.env.LECTURE_GALLERY;
    const { svg, cells, comics } = buildSketchGallery(flag === "debug");
    // written before the assertions, so a failing sketch can be looked at
    if (flag) console.log(`wrote ${writeGallery(process.cwd(), { sketch: svg }).join(", ")}`);
    expect(svg).not.toContain("NaN");
    expect(cells).toHaveLength(SKETCH_GALLERY.length);
    for (const c of cells) {
      expect(c.sketch, c.title).not.toBeNull();
      const wall = c.sketch!.plan.totalMs / (c.sketch!.plan.pace ?? 1);
      expect(wall, c.title).toBeGreaterThan(2500);
      expect(wall, c.title).toBeLessThanOrEqual(7000);
    }
    // every label of every fixture found a place
    SKETCH_GALLERY.forEach((g, i) => expect(cells[i].sketch!.texts.length, g.title).toBe(g.drawing.labels.length));
    expect(comics).toHaveLength(COMICS.length);
    for (const c of comics) {
      expect(c.panels, c.title).not.toBeNull();
      for (const [i, d] of c.drawings.entries()) expect(d, `${c.title}: panel ${i}`).not.toBeNull();
      const wall = c.panels!.sketch.plan.totalMs / (c.panels!.sketch.plan.pace ?? 1);
      expect(wall, c.title).toBeLessThanOrEqual(3000);
    }
  });
});
