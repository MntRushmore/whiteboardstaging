import { describe, expect, it } from "vitest";
import { VisualModelSchema, type VisualModelKind } from "../../contracts";
import { modelProblems } from "..";
import { buildSheet, GALLERY, writeSheets } from "./gallery";

/**
 * The models' contact sheets (docs/qa-screenshots/ask-v2-models/sheet-*.png), built in memory:
 * every gallery spec is one the route lets through, and every one is drawn in its largest box and
 * its smallest, within its time. Regenerate the pictures with
 * `MODEL_GALLERY=1 npx vitest run src/lib/live/chat/models/__tests__/gallery.test.ts`
 * (`MODEL_GALLERY=debug` shades the writing) and look at them after changing a planner.
 */
const GROUPS: Record<string, VisualModelKind[]> = {
  "sheet-lines": ["number_line"],
  "sheet-fractions": ["fraction_bars", "fraction_circles"],
  "sheet-arrays": ["array", "equal_groups"],
  "sheet-area": ["area_model"],
  "sheet-blocks": ["base_ten"],
  "sheet-place": ["place_value"],
  "sheet-tape": ["tape"],
  "sheet-frame-clock": ["ten_frame", "clock"],
};

describe("model gallery", () => {
  it("every gallery spec is valid and passes the spec check", () => {
    for (const g of GALLERY) {
      expect(VisualModelSchema.safeParse(g.model).success, g.title).toBe(true);
      expect(modelProblems(g.model), g.title).toEqual([]);
    }
  });

  it("draws every spec in its largest and its smallest box, each within its time", () => {
    const flag = process.env.MODEL_GALLERY;
    const built = Object.entries(GROUPS).map(([name, kinds]) => ({
      name,
      ...buildSheet(
        GALLERY.filter((g) => kinds.includes(g.model.kind)),
        { small: true, debug: flag === "debug", columns: 2 },
      ),
    }));
    // written before the checks: a failing sheet is the one to look at
    if (flag) console.log(`wrote ${writeSheets(process.cwd(), Object.fromEntries(built.map((b) => [b.name, b.svg]))).join(", ")}`);
    for (const { svg, cells } of built) {
      expect(svg).not.toContain("NaN");
      for (const c of cells) {
        // a spec too big for the kind's smallest box (999 in blocks) is drawn in a larger one
        if (c.big) continue;
        expect(c.sketch, c.title).not.toBeNull();
        const wall = c.sketch!.plan.totalMs / (c.sketch!.plan.pace ?? 1);
        expect(wall, c.title).toBeLessThanOrEqual(7500);
      }
    }
  }, 60_000);
});
