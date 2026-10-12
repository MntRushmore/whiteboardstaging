import { beforeAll, describe, expect, it } from "vitest";
import type { LiveEngine, Rect } from "../../contracts";
import { getEngine } from "../../engine";
import type { HandPlan } from "../../handwriting";
import { problemMetaOf } from "../cells";
import { ChatDesk, type ChatHost, type ChatShape } from "../desk";
import { PROBE_FIGURE } from "../figure";

/**
 * How the desk runs a reply when the board is awkward: a problem too wide for any screen, a figure
 * the drawer can plan only in its largest box with no room for it here. What it cannot do is said
 * plainly, and never takes the rest down with it.
 */

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

const SCREEN: Rect = { x: 0, y: 0, w: 1600, h: 900 };

function fakeHost(opts: { shapes?: ChatShape[]; planFigure?: ChatHost["planFigure"] } = {}) {
  const pages: ChatShape[][] = [opts.shapes ?? []];
  let page = 0;
  const writes: Array<{ plan: HandPlan; meta: Record<string, unknown> }> = [];
  const host: ChatHost = {
    engine: async () => engine,
    shapes: () => pages[page],
    screen: () => SCREEN,
    pageId: () => `page-${page}`,
    studentLines: () => [],
    handwriting: () => true,
    handBusy: () => false,
    write: async (plan, meta) => {
      writes.push({ plan, meta: meta as Record<string, unknown> });
      pages[page].push({ id: `s${writes.length}`, type: "draw", meta, bounds: plan.bounds });
    },
    typeset: () => ({ x: 0, y: 0, w: 10, h: 10 }),
    addScreen: () => {
      pages.push([]);
      page = pages.length - 1;
      return true;
    },
    screenReady: () => true,
    clearTutor: () => undefined,
    problemsChanged: () => undefined,
    helpProblem: () => "missing",
    planFigure: opts.planFigure ?? (() => null),
    seed: () => 1,
    delay: async () => undefined,
  };
  return { host, writes, pages: () => pages.length };
}

describe("ChatDesk — when the board is awkward", () => {
  it("one problem too wide for any screen is left out on its own; the rest of the set is written", async () => {
    // a sum the engine checks (= 1830) but no screen is wide enough for, even in the smallest hand
    const wide = Array.from({ length: 60 }, (_, i) => i + 1).join(" + ");
    const { host, writes } = fakeHost();
    const report = await new ChatDesk(host).run([{ type: "write_problems", problems: [["2x + 3 = 11"], [wide], ["3x = 12"]] }]);
    expect(report).toMatchObject({ problemsWritten: 2, problemsDropped: 1 });
    expect(report.outcomes).toEqual([{ type: "write_problems", ok: true, note: "1 problem didn't fit, so I left it out." }]);
    expect(writes.map((w) => problemMetaOf(w.meta)?.lines)).toEqual([["2x + 3 = 11"], ["3x = 12"]]);
    expect(writes.map((w) => problemMetaOf(w.meta)?.n)).toEqual([1, 2]);
  });

  it("a figure drawn only in the largest box, with no room for it here: on a new screen, not 'couldn't draw'", async () => {
    // the screen is taken, all but a strip too small for the figure
    const taken: ChatShape = { id: "ink", type: "draw", meta: {}, bounds: { x: 0, y: 0, w: 1600, h: 700 } };
    const plan: HandPlan = { lines: [], bounds: { x: 0, y: 0, w: 440, h: 360 }, size: 30, totalMs: 1000, pace: 1 };
    const { host, writes, pages } = fakeHost({ shapes: [taken], planFigure: (_spec, o) => (o.box.w >= 460 ? { plan, points: {} } : null) });
    const report = await new ChatDesk(host).run([{ type: "draw_figure", figure: PROBE_FIGURE }]);
    expect(report.outcomes).toEqual([{ type: "draw_figure", ok: true }]);
    expect(report.screensAdded).toBe(1);
    expect(pages()).toBe(2);
    expect(writes).toHaveLength(1);
  });

  it("a figure the drawer cannot plan at all is still said so", async () => {
    const { host, writes } = fakeHost({ planFigure: () => null });
    const report = await new ChatDesk(host).run([{ type: "draw_figure", figure: PROBE_FIGURE }]);
    expect(report.outcomes).toEqual([{ type: "draw_figure", ok: false, note: "I couldn't draw that figure." }]);
    expect(writes).toEqual([]);
  });
});
