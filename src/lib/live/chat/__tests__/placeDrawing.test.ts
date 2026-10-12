import { beforeAll, describe, expect, it } from "vitest";
import type { LiveEngine, Rect } from "../../contracts";
import { getEngine } from "../../engine";
import type { HandPlan } from "../../handwriting";
import { CHAT_PROBLEM_META } from "../cells";
import type { ChatAction } from "../contracts";
import { CHAT_BLOCK_META, CHAT_WRITE, ChatDesk, type ChatHost, type ChatShape } from "../desk";
import { PROBE_FIGURE } from "../figure";
import { gridCells } from "../layout";
import { DRAWING_PLACE } from "../place";

/**
 * The owner's bug: problems from the chat, then "draw problem 2" — and a new screen came, because
 * the problems' grid fills the screen and the drawing found no free area. Every drawing now goes
 * through `ChatDesk.placeDrawing`: beside the problem it is about (`near`), shrunk to fit, a new
 * screen only when nothing fits even at its smallest; and a `new_screen` sent with such a drawing
 * is not taken.
 */

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

const SCREEN: Rect = { x: 0, y: 0, w: 1600, h: 900 };

/** Four problems as the chat writes them: a 2 × 2 grid, each problem's ink at the top of its cell. */
function fourProblems(): ChatShape[] {
  return gridCells(SCREEN, 2, 2).map((cell, i) => ({
    id: `p${i + 1}`,
    type: "draw",
    meta: { [CHAT_PROBLEM_META]: { n: i + 1, lines: [`\\frac{${i + 1}}{4} + \\frac{1}{6}`], cell } },
    bounds: { x: cell.x + 14, y: cell.y + 14, w: 148, h: 64 },
  }));
}

/** A figure planned at a box: as big as the box (the drawer's plan fills it, true to scale). */
const boxPlan = (box: { w: number; h: number }): HandPlan => ({ lines: [], bounds: { x: 0, y: 0, w: box.w, h: box.h * 0.95 }, size: 22, totalMs: 1000, pace: 1 });

function fakeHost(opts: { shapes?: ChatShape[]; planFigure?: ChatHost["planFigure"] } = {}) {
  const pages: ChatShape[][] = [opts.shapes ?? []];
  let page = 0;
  const writes: Array<{ plan: HandPlan; meta: Record<string, unknown>; page: number }> = [];
  const metrics: Array<{ name: string; data: Record<string, unknown> }> = [];
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
    planFigure: opts.planFigure ?? ((_spec, o) => ({ plan: boxPlan(o.box), points: {} })),
    seed: () => 1,
    delay: async () => undefined,
    metric: (name, data) => metrics.push({ name, data }),
  };
  return { host, writes, metrics, pages: () => pages.length };
}

const within = (r: Rect, outer: Rect) => r.x >= outer.x && r.y >= outer.y && r.x + r.w <= outer.x + outer.w && r.y + r.h <= outer.y + outer.h;
const apart = (a: Rect, b: Rect) => a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
const cellOf = (shapes: ChatShape[], n: number) => (shapes[n - 1].meta as Record<string, { cell: Rect }>)[CHAT_PROBLEM_META].cell;

describe("ChatDesk.placeDrawing — a drawing of a problem stays on its screen", () => {
  it("draw_figure near 2: beside problem 2, in its cell, at the largest box — no new screen", async () => {
    const shapes = fourProblems();
    const { host, writes, metrics } = fakeHost({ shapes });
    const report = await new ChatDesk(host).run([{ type: "draw_figure", figure: PROBE_FIGURE, near: 2 }]);
    expect(report).toMatchObject({ screensAdded: 0, outcomes: [{ type: "draw_figure", ok: true }] });
    const placed = writes[0].plan.bounds;
    expect(within(placed, cellOf(shapes, 2))).toBe(true);
    expect(apart(placed, shapes[1].bounds!)).toBe(true);
    // beside a 148 px problem in a 752 px cell there is room for the largest figure
    expect(placed.w).toBe(CHAT_WRITE.figureBoxes[0].w);
    expect(placed.y).toBe(shapes[1].bounds!.y);
    expect(metrics.find((m) => m.name === "live.chat.place")?.data).toMatchObject({ spot: "beside", near: true, found: true });
  });

  it("graph near 3 (the engine's own sketch and its equation): beside problem 3, no new screen", async () => {
    const shapes = fourProblems();
    const { host, writes } = fakeHost({ shapes });
    const report = await new ChatDesk(host).run([{ type: "graph", relations: ["y = 2x + 1"], near: 3 }]);
    expect(report).toMatchObject({ screensAdded: 0, outcomes: [{ type: "graph", ok: true }] });
    expect(writes[0].meta[CHAT_BLOCK_META]).toBe("graph");
    const placed = writes[0].plan.bounds;
    expect(within(placed, cellOf(shapes, 3))).toBe(true);
    for (const s of shapes.slice(0, 4)) expect(apart(placed, s.bounds!)).toBe(true);
  });

  it("shrinks to fit before it would start a new screen", async () => {
    const shapes = fourProblems();
    const cell = cellOf(shapes, 1);
    // the student's working fills the cell but for a corner at the bottom right
    const work: ChatShape = { id: "ink", type: "draw", meta: {}, bounds: { x: cell.x + 14, y: cell.y + 100, w: 430, h: 286 } };
    const besideWork: ChatShape = { id: "ink2", type: "draw", meta: {}, bounds: { x: cell.x + 200, y: cell.y + 14, w: 538, h: 140 } };
    const { host, writes } = fakeHost({ shapes: [...shapes, work, besideWork] });
    const report = await new ChatDesk(host).run([{ type: "draw_figure", figure: PROBE_FIGURE, near: 1 }]);
    expect(report).toMatchObject({ screensAdded: 0, outcomes: [{ type: "draw_figure", ok: true }] });
    const placed = writes[0].plan.bounds;
    expect(placed.w).toBe(CHAT_WRITE.figureBoxes[3].w);
    expect(within(placed, cell)).toBe(true);
    for (const s of [work, besideWork]) expect(apart(placed, s.bounds!)).toBe(true);
  });

  it("a new screen only when nothing fits even at the smallest: the drawing at its largest there", async () => {
    const shapes = fourProblems();
    const cell = cellOf(shapes, 2);
    const full: ChatShape = { id: "ink", type: "draw", meta: {}, bounds: { x: cell.x + 14, y: cell.y + 90, w: cell.w - 28, h: cell.h - 104 } };
    const row: ChatShape = { id: "ink2", type: "draw", meta: {}, bounds: { x: cell.x + 170, y: cell.y + 14, w: cell.w - 184, h: 70 } };
    const { host, writes, metrics } = fakeHost({ shapes: [...shapes, full, row] });
    const report = await new ChatDesk(host).run([{ type: "draw_figure", figure: PROBE_FIGURE, near: 2 }]);
    expect(report).toMatchObject({ screensAdded: 1, outcomes: [{ type: "draw_figure", ok: true }] });
    expect(writes[0]).toMatchObject({ page: 1 });
    expect(writes[0].plan.bounds.w).toBe(CHAT_WRITE.figureBoxes[0].w);
    expect(metrics.find((m) => m.name === "live.chat.place")?.data).toMatchObject({ spot: "new_screen", size: 0 });
  });

  it("without near, a drawing on a screen the grid fills goes on a new screen, as before", async () => {
    const { host, writes } = fakeHost({ shapes: fourProblems() });
    const report = await new ChatDesk(host).run([{ type: "draw_figure", figure: PROBE_FIGURE }]);
    expect(report).toMatchObject({ screensAdded: 1, outcomes: [{ type: "draw_figure", ok: true }] });
    expect(writes[0]).toMatchObject({ page: 1 });
  });

  it("near a problem that isn't on this screen: placed as without near", async () => {
    const { host, metrics } = fakeHost({ shapes: fourProblems() });
    const report = await new ChatDesk(host).run([{ type: "draw_figure", figure: PROBE_FIGURE, near: 9 }]);
    expect(report).toMatchObject({ screensAdded: 1, outcomes: [{ type: "draw_figure", ok: true }] });
    expect(metrics.find((m) => m.name === "live.chat.place")?.data).toMatchObject({ near: true, found: false });
  });

  it("a figure the drawer plans in no box is still 'couldn't draw'; one with no room anywhere is 'no room'", async () => {
    const none = fakeHost({ planFigure: () => null });
    expect((await new ChatDesk(none.host).run([{ type: "draw_figure", figure: PROBE_FIGURE, near: 1 }])).outcomes).toEqual([{ type: "draw_figure", ok: false, note: "I couldn't draw that figure." }]);
    const full = fakeHost({ shapes: fourProblems() });
    full.host.addScreen = () => false;
    expect((await new ChatDesk(full.host).run([{ type: "draw_figure", figure: PROBE_FIGURE }])).outcomes).toEqual([{ type: "draw_figure", ok: false, note: "There's no room left for the figure." }]);
  });

  it("a graph and a figure never shrink below the legible floor", () => {
    for (const boxes of [CHAT_WRITE.figureBoxes, CHAT_WRITE.graphBoxes]) {
      const last = boxes[boxes.length - 1];
      expect(Math.min(last.w / boxes[0].w, last.h / boxes[0].h)).toBeGreaterThanOrEqual(DRAWING_PLACE.minScale);
    }
  });
});

describe("ChatDesk: a new_screen sent with a drawing of a problem on this screen", () => {
  it("is not taken, and a metric says so; the drawing goes beside its problem", async () => {
    const shapes = fourProblems();
    const { host, writes, metrics, pages } = fakeHost({ shapes });
    const actions: ChatAction[] = [{ type: "new_screen" }, { type: "graph", relations: ["y = 2x + 1"], near: 3 }];
    const report = await new ChatDesk(host).run(actions);
    expect(report.screensAdded).toBe(0);
    expect(pages()).toBe(1);
    // one outcome per action, in order (the panel and the learning record read them by index)
    expect(report.outcomes).toEqual([
      { type: "new_screen", ok: false, why: "near_drawing" },
      { type: "graph", ok: true },
    ]);
    expect(within(writes[0].plan.bounds, cellOf(shapes, 3))).toBe(true);
    expect(metrics).toContainEqual({ name: "live.chat.newScreen.ignored", data: { drawings: "graph" } });
  });

  it("also after it: the student is not taken away from the drawing they asked for", async () => {
    const { host, pages } = fakeHost({ shapes: fourProblems() });
    const report = await new ChatDesk(host).run([{ type: "draw_figure", figure: PROBE_FIGURE, near: 1 }, { type: "new_screen" }]);
    expect(report).toMatchObject({ screensAdded: 0, outcomes: [{ type: "draw_figure", ok: true }, { type: "new_screen", ok: false }] });
    expect(pages()).toBe(1);
  });

  it("a new_screen with a drawing that names no problem is still taken", async () => {
    const { host, pages } = fakeHost({ shapes: fourProblems() });
    const report = await new ChatDesk(host).run([{ type: "new_screen" }, { type: "draw_figure", figure: PROBE_FIGURE }]);
    expect(report).toMatchObject({ screensAdded: 1, outcomes: [{ type: "new_screen", ok: true }, { type: "draw_figure", ok: true }] });
    expect(pages()).toBe(2);
  });
});
