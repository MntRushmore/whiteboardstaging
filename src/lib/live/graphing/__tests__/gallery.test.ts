import { beforeAll, describe, expect, it } from "vitest";
import type { LiveEngine } from "../../contracts";
import { getEngine } from "../../engine";
import { GRAPH_GALLERY, buildGallery, writeGallery } from "./gallery";

/**
 * The contact sheet in docs/graph/gallery.png, built in memory against the real engine: every
 * graph on it must still be recognised and sketched, within the pacing budget. Regenerate the
 * picture with `GRAPH_GALLERY=1 npx vitest run src/lib/live/graphing/__tests__/gallery.test.ts`
 * and look at it after changing the sketches.
 */
let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

describe("graph gallery", () => {
  it("sketches every gallery graph, each within ~6 s", () => {
    const { svg, cells } = buildGallery(engine);
    expect(cells).toHaveLength(GRAPH_GALLERY.length);
    for (const c of cells) {
      expect(c.kind, c.title).not.toBeNull();
      expect(c.strokes, c.title).toBeGreaterThan(5);
      expect(c.wallMs, c.title).toBeLessThanOrEqual(6000);
    }
    expect(svg).not.toContain("NaN");
    if (process.env.GRAPH_GALLERY === "1") console.log(`wrote ${writeGallery(process.cwd(), svg)}`);
  });
});
