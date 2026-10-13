import { beforeAll, describe, expect, it } from "vitest";
import type { LiveEngine, PlaneGraphIntent, Rect } from "../../contracts";
import { getEngine } from "../../engine";
import { chooseWindow, GRAPH, planGraph, ticksIn, tickLatex } from "../../graphing";
import type { HandPlan } from "../../handwriting";
import { CHAT_PROBLEM_META } from "../cells";
import type { ChatAction, ChatWindow } from "../contracts";
import { CHAT_BLOCK_META, ChatDesk, windowedIntent, type ChatHost, type ChatShape } from "../desk";
import { gridCells } from "../layout";
import { CHAT_GRAPH_READ } from "../limits";

/**
 * The demo (2026-10-13): "explain this visually please" → the tutor said it graphed y = sin x and
 * the line y = √2/2 beside #1 from 0 to 2π, and the board said "I couldn't graph that" — four
 * times, on a new page too. The chat's relations are read as asked for by name (`CHAT_GRAPH_READ`),
 * the same way the route's gate reads them, so what the gate lets through, the board draws.
 */

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

const SCREEN: Rect = { x: 0, y: 0, w: 1600, h: 900 };
const DEMO: ChatAction = {
  type: "graph",
  relations: ["y = \\sin x", "y = \\frac{\\sqrt{2}}{2}"],
  window: { xMin: 0, xMax: 6.283185307179586 },
  near: 1,
};

/** Two trig problems as the chat writes them, side by side, each problem's ink at the top of its cell. */
function twoProblems(): ChatShape[] {
  return gridCells(SCREEN, 2, 1).map((cell, i) => ({
    id: `p${i + 1}`,
    type: "draw",
    meta: { [CHAT_PROBLEM_META]: { n: i + 1, lines: [i === 0 ? "\\sin x = \\frac{\\sqrt{2}}{2}" : "\\cos x = \\frac{1}{2}"], cell } },
    bounds: { x: cell.x + 14, y: cell.y + 14, w: 260, h: 64 },
  }));
}

function fakeHost(shapes: ChatShape[] = []) {
  const pages: ChatShape[][] = [shapes];
  let page = 0;
  const writes: Array<{ plan: HandPlan; meta: Record<string, unknown>; page: number }> = [];
  const host: ChatHost = {
    engine: async () => engine,
    shapes: () => pages[page],
    screen: () => SCREEN,
    pageId: () => `page-${page}`,
    studentLines: () => [],
    handwriting: () => true,
    handBusy: () => false,
    write: async (plan, meta) => {
      writes.push({ plan, meta: meta as Record<string, unknown>, page });
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
    planFigure: () => null,
    seed: () => 1,
    delay: async () => undefined,
  };
  return { host, writes, pages: () => pages.length };
}

const within = (r: Rect, outer: Rect) => r.x >= outer.x && r.y >= outer.y && r.x + r.w <= outer.x + outer.w && r.y + r.h <= outer.y + outer.h;
const cellOf = (shapes: ChatShape[], n: number) => (shapes[n - 1].meta as Record<string, { cell: Rect }>)[CHAT_PROBLEM_META].cell;

describe("ChatDesk.graph — relations asked for by name", () => {
  it("the demo: y = sin x and y = √2/2 from 0 to 2π beside #1 is drawn there, as one block", async () => {
    const shapes = twoProblems();
    const { host, writes } = fakeHost(shapes);
    const report = await new ChatDesk(host).run([DEMO]);
    expect(report).toMatchObject({ screensAdded: 0, outcomes: [{ type: "graph", ok: true }] });
    expect(writes).toHaveLength(1);
    expect(writes[0].meta).toMatchObject({ [CHAT_BLOCK_META]: "graph", chatGraph: expect.any(String) });
    expect(within(writes[0].plan.bounds, cellOf(shapes, 1))).toBe(true);
  });

  it("the window asked for: 0 to 2π across, sin's two meetings with √2/2 in it as dots, whole-number ticks", () => {
    const win = (DEMO as { window: ChatWindow }).window;
    const intent = engine.graphFor!(DEMO.type === "graph" ? DEMO.relations : [], CHAT_GRAPH_READ);
    expect(intent?.kind).toBe("plane");
    const shown = windowedIntent(intent!, win) as PlaneGraphIntent;
    const meets = shown.points.filter((p) => p.role === "intersection").map((p) => p.x);
    expect(meets).toHaveLength(2);
    expect(meets.sort((a, b) => a - b).map((x) => x / Math.PI)).toEqual([expect.closeTo(0.25, 9), expect.closeTo(0.75, 9)]);
    const w = chooseWindow(shown, GRAPH.box, win);
    expect(w.xMin).toBeLessThan(0);
    expect(w.xMax).toBeGreaterThan(2 * Math.PI);
    expect(w.yMin).toBeLessThan(-1);
    expect(w.yMax).toBeGreaterThan(1);
    // the numbers on the axes are numbers a student reads: 1, 2, 3 …, 0.5 — never 0.7853981
    for (const v of [...ticksIn(w.xMin, w.xMax, w.xStep), ...ticksIn(w.yMin, w.yMax, w.yStep)]) expect(tickLatex(v)).toMatch(/^-?\d+(\.\d)?$/);
    expect(w.xStep).toBe(1);
    expect(planGraph(shown, { seed: 1, window: win })?.plan.lines.length).toBeGreaterThan(0);
  });

  it("'try graphing it on a new page': a new screen, then the graph on it", async () => {
    const { host, writes, pages } = fakeHost(twoProblems());
    const demo = DEMO as Extract<ChatAction, { type: "graph" }>;
    const report = await new ChatDesk(host).run([{ type: "new_screen" }, { type: "graph", relations: demo.relations, window: demo.window }]);
    expect(report).toMatchObject({ screensAdded: 1, outcomes: [{ type: "new_screen", ok: true }, { type: "graph", ok: true }] });
    expect(pages()).toBe(2);
    expect(writes).toMatchObject([{ page: 1 }]);
  });

  it("a new screen sent with the graph beside #1 is not taken; the graph goes beside #1", async () => {
    const shapes = twoProblems();
    const { host, writes, pages } = fakeHost(shapes);
    const report = await new ChatDesk(host).run([{ type: "new_screen" }, DEMO]);
    expect(report.outcomes).toEqual([
      { type: "new_screen", ok: false, why: "near_drawing" },
      { type: "graph", ok: true },
    ]);
    expect(pages()).toBe(1);
    expect(within(writes[0].plan.bounds, cellOf(shapes, 1))).toBe(true);
  });

  it("near a problem that is not on this screen (an empty one): drawn anywhere free", async () => {
    const { host, writes } = fakeHost();
    const report = await new ChatDesk(host).run([DEMO]);
    expect(report).toMatchObject({ screensAdded: 0, outcomes: [{ type: "graph", ok: true }] });
    expect(within(writes[0].plan.bounds, SCREEN)).toBe(true);
  });

  it("the board draws exactly what the engine graphs as the gate reads it (`CHAT_GRAPH_READ`)", async () => {
    const sets = [
      ["y = \\sin x", "y = \\frac{\\sqrt{2}}{2}"],
      ["y = \\cos x", "y = 0.5"],
      ["y = \\frac{\\sqrt{2}}{2}"],
      ["y = \\pi"],
      ["y = x^{2}", "y = 4"],
      ["y < x + 1", "y > -2"],
      ["y = \\frac{1}{x - 1}", "x = 1"],
      ["x > 3"],
      ["x = 2"],
      ["y = x^{2}", "x = 2"],
      ["y = \\sin x", "\\text{the sine wave}"],
    ];
    for (const relations of sets) {
      const { host } = fakeHost();
      const graphed = engine.graphFor!(relations, CHAT_GRAPH_READ) !== null;
      const report = await new ChatDesk(host).run([{ type: "graph", relations }]);
      expect(report.outcomes[0].ok, relations.join(" / ")).toBe(graphed);
      if (!graphed) expect(report.outcomes[0]).toEqual({ type: "graph", ok: false, note: "I couldn't graph that." });
    }
    // the ones the demo needed are drawn; a vertical line is not (the gate drops it before the board)
    expect(engine.graphFor!(sets[0], CHAT_GRAPH_READ)).not.toBeNull();
    expect(engine.graphFor!(["x = 2"], CHAT_GRAPH_READ)).toBeNull();
  });
});
