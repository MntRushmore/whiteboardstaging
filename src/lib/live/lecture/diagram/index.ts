import type { DiagramSpec } from "../contracts";
import type { LectureSketch } from "../chart/sketch";
import { hyphenating } from "../words";
import { sketchCycle } from "./cycle";
import { sketchFlow } from "./flow";
import { sketchHub } from "./hub";
import { sketchTimeline } from "./timeline";
import { sketchTree } from "./tree";
import { sketchVenn } from "./venn";

/**
 * A diagram in the tutor's hand: `DiagramSpec` (the structure, from the director) in, a sketch
 * out. See `layout.ts` for what they share, and each kind's file for how it is laid out.
 *
 * What gives way when it does not fit, in order: a word too long for its box is broken with a
 * hyphen (`hyphenating`); then the title is left off — the screen's heading usually says the
 * topic, and the diagram is the point. Only then null.
 */
export function sketchDiagram(spec: DiagramSpec, opts: { seed: number; box: { w: number; h: number } }): LectureSketch | null {
  const run = (sp: typeof spec) => sketchKind(sp, opts) ?? hyphenating(true, () => sketchKind(sp, opts));
  return run(spec) ?? (spec.title ? run({ ...spec, title: undefined }) : null);
}

function sketchKind(spec: DiagramSpec, opts: { seed: number; box: { w: number; h: number } }): LectureSketch | null {
  switch (spec.kind) {
    case "flow":
      return sketchFlow(spec, opts.box, opts.seed);
    case "cycle":
      return sketchCycle(spec, opts.box, opts.seed);
    case "timeline":
      return sketchTimeline(spec, opts.box, opts.seed);
    case "hub":
      return sketchHub(spec, opts.box, opts.seed);
    case "tree":
      return sketchTree(spec, opts.box, opts.seed);
    case "venn":
      return sketchVenn(spec, opts.box, opts.seed);
  }
}
