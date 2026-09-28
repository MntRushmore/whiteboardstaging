import { describe, expect, it } from "vitest";
import { CHART_GALLERY, DIAGRAM_GALLERY, WORDS_GALLERY, buildGallery, buildLiveSheet, writeGallery } from "./gallery";

/**
 * The contact sheets in docs/lecture/ (charts, diagrams, words, live), built in memory: every chart, diagram, heading and note on
 * them must still be drawn, inside the desk's largest box, within its pacing budget. Regenerate the
 * pictures with `LECTURE_GALLERY=1 npx vitest run src/lib/live/lecture/__tests__/gallery.test.ts`
 * (`LECTURE_GALLERY=debug` outlines the writing) and look at them after changing a planner.
 */
describe("lecture gallery", () => {
  it("draws every gallery sketch in the big box, each within its time", () => {
    const flag = process.env.LECTURE_GALLERY;
    const { sheets, cells } = buildGallery(flag === "debug");
    // written before the assertions, so a failing sketch can be looked at
    if (flag) console.log(`wrote ${writeGallery(process.cwd(), sheets).join(", ")}`);
    expect(cells).toHaveLength(CHART_GALLERY.length + DIAGRAM_GALLERY.length + WORDS_GALLERY.length);
    for (const c of cells) {
      expect(c.drawn, c.title).toBe(true);
      expect(c.strokes, c.title).toBeGreaterThan(3);
      expect(c.wallMs, c.title).toBeLessThanOrEqual(8500);
    }
    for (const svg of Object.values(sheets)) expect(svg).not.toContain("NaN");
  });

  it("the live sheet: each update after the first writes a few parts, unless the axis overflows", () => {
    const { frames } = buildLiveSheet();
    for (const f of frames) expect(f.sketch, `${f.story}: ${f.caption}`).not.toBeNull();
    const sales = frames.filter((f) => f.story.startsWith("a sales chart"));
    expect(sales.slice(1, 4).map((f) => f.written.length)).toEqual([2, 2, 2]);
    const flow = frames.filter((f) => f.story.startsWith("a flow"));
    for (const f of flow.slice(1)) expect(f.written.length, f.caption).toBe(3);
  });
});
