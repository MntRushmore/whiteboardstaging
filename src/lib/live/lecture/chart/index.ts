import type { ChartSpec } from "../contracts";
import { sketchCategoryChart } from "./category";
import { sketchPie } from "./pie";
import { sketchScatter } from "./scatter";
import type { LectureSketch } from "./sketch";
import { hyphenating } from "../words";
import { sketchTable } from "./table";

/**
 * A chart in the tutor's hand: `ChartSpec` (numbers and names, from the director) in, a sketch out.
 * See `category.ts` (bar, line), `pie.ts`, `scatter.ts` and `table.ts` for how each is drawn.
 *
 * What gives way when it does not fit, in order: a word too long for its place is broken with a
 * hyphen (`hyphenating`); then the title is left off — the screen's heading usually says the
 * topic, and the numbers are the point. Only then null.
 */
export function sketchChart(spec: ChartSpec, opts: { seed: number; box: { w: number; h: number } }): LectureSketch | null {
  const run = (sp: typeof spec) => sketchKind(sp, opts) ?? hyphenating(true, () => sketchKind(sp, opts));
  return run(spec) ?? (spec.title ? run({ ...spec, title: undefined }) : null);
}

function sketchKind(spec: ChartSpec, opts: { seed: number; box: { w: number; h: number } }): LectureSketch | null {
  switch (spec.kind) {
    case "bar":
    case "line":
      return sketchCategoryChart(spec, opts.box, opts.seed);
    case "pie":
      return sketchPie(spec, opts.box, opts.seed);
    case "scatter":
      return sketchScatter(spec, opts.box, opts.seed);
    case "table":
      return sketchTable(spec, opts.box, opts.seed);
  }
}

export type { LectureSketch, PlacedText } from "./sketch";
