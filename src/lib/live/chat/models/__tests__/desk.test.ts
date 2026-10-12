import { beforeAll, describe, expect, it } from "vitest";
import type { LiveEngine, Rect } from "../../../contracts";
import { getEngine } from "../../../engine";
import type { HandPlan } from "../../../handwriting";
import type { VisualModel } from "../../contracts";
import { CHAT_BLOCK_META, CHAT_MODEL_META, ChatDesk, type ChatHost, type ChatShape } from "../../desk";

/**
 * `draw_model` on the desk: the model planned by the board's own planners and written as ONE block
 * marked as a model (its kind on every stroke), on this screen while it fits; honest notes when the
 * hand is off, the spec doesn't add up, or there is no room; and its labels never read back as the
 * tutor's maths.
 */

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

const SCREEN: Rect = { x: 0, y: 0, w: 1600, h: 900 };

function fakeHost(opts: { shapes?: ChatShape[]; hand?: boolean; screens?: boolean } = {}) {
  const pages: ChatShape[][] = [opts.shapes ?? []];
  let page = 0;
  const writes: Array<{ plan: HandPlan; meta: Record<string, unknown> }> = [];
  const metrics: Array<{ name: string; data: Record<string, unknown> }> = [];
  const host: ChatHost = {
    engine: async () => engine,
    shapes: () => pages[page],
    screen: () => SCREEN,
    pageId: () => `page-${page}`,
    studentLines: () => [],
    handwriting: () => opts.hand ?? true,
    handBusy: () => false,
    write: async (plan, meta) => {
      writes.push({ plan, meta: meta as Record<string, unknown> });
      // each line as the board would hold it: strokes with the block's meta and the line's LaTeX
      for (const l of plan.lines) pages[page].push({ id: `s${pages[page].length}`, type: "draw", meta: { ...meta, live: true, source: "ai", handLine: l.latex }, bounds: { x: l.x, y: l.y, w: 10, h: 10 } });
    },
    typeset: () => ({ x: 0, y: 0, w: 10, h: 10 }),
    addScreen: () => {
      if (opts.screens === false) return false;
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
    metric: (name, data) => void metrics.push({ name, data }),
  };
  return { host, writes, metrics, pages: () => pages.length };
}

const CLOCK: VisualModel = { kind: "clock", hour: 3, minute: 45 };
const BARS: VisualModel = { kind: "fraction_bars", bars: [{ parts: 4, shaded: 3 }, { parts: 8, shaded: 5 }] };

describe("ChatDesk — draw_model", () => {
  it("writes the model as one block on this screen, marked as a model of its kind", async () => {
    const { host, writes, metrics } = fakeHost();
    const report = await new ChatDesk(host).run([{ type: "draw_model", model: BARS }]);
    expect(report.outcomes).toEqual([{ type: "draw_model", ok: true }]);
    expect(report.screensAdded).toBe(0);
    expect(writes).toHaveLength(1);
    expect(writes[0].meta).toEqual({ [CHAT_BLOCK_META]: "model", [CHAT_MODEL_META]: "fraction_bars" });
    // placed inside the screen, every line a named part with its own ink
    const b = writes[0].plan.bounds;
    expect(b.x).toBeGreaterThanOrEqual(SCREEN.x);
    expect(b.x + b.w).toBeLessThanOrEqual(SCREEN.x + SCREEN.w);
    expect(b.y + b.h).toBeLessThanOrEqual(SCREEN.y + SCREEN.h);
    expect(writes[0].plan.lines.every((l) => typeof l.part === "string" && l.part.length > 0)).toBe(true);
    expect(metrics).toContainEqual({ name: "live.chat.model", data: { kind: "fraction_bars", near: null } });
  });

  it("every kind is drawn", async () => {
    const kinds: VisualModel[] = [
      { kind: "number_line", from: 0, to: 10, marks: [], jumps: [{ from: 3, to: 7 }] },
      BARS,
      { kind: "fraction_circles", circles: [{ parts: 3, shaded: 1 }] },
      { kind: "array", rows: 3, cols: 4 },
      { kind: "equal_groups", groups: 3, each: 4 },
      { kind: "area_model", a: 23, b: 14 },
      { kind: "base_ten", value: 345 },
      { kind: "place_value", value: 3405.27 },
      { kind: "tape", rows: [{ segments: [{ units: 1, label: "8" }, { units: 1, label: "8" }] }], total: "?" },
      { kind: "ten_frame", filled: 7 },
      CLOCK,
    ];
    for (const model of kinds) {
      const { host, writes } = fakeHost();
      const report = await new ChatDesk(host).run([{ type: "draw_model", model }]);
      expect(report.outcomes, model.kind).toEqual([{ type: "draw_model", ok: true }]);
      expect(writes[0].meta[CHAT_MODEL_META], model.kind).toBe(model.kind);
    }
  });

  it("a model's labels are a drawing's, never the tutor's lines of maths in the screen's picture", async () => {
    const { host } = fakeHost();
    const desk = new ChatDesk(host);
    await desk.run([{ type: "draw_model", model: BARS }]);
    expect(desk.picture().tutor).toEqual([]);
    expect(desk.picture().empty).toBe(false);
  });

  it("the hand switched off: said so, nothing written", async () => {
    const { host, writes } = fakeHost({ hand: false });
    const report = await new ChatDesk(host).run([{ type: "draw_model", model: CLOCK }]);
    expect(report.outcomes).toEqual([{ type: "draw_model", ok: false, note: "The tutor's handwriting is switched off, so I can't draw that.", why: "hand_off" }]);
    expect(writes).toEqual([]);
  });

  it("a spec that doesn't add up (the gate normally sent it back) is not drawn", async () => {
    const { host, writes } = fakeHost();
    const report = await new ChatDesk(host).run([{ type: "draw_model", model: { kind: "fraction_bars", bars: [{ parts: 4, shaded: 5 }] } }]);
    expect(report.outcomes).toEqual([{ type: "draw_model", ok: false, note: "That picture didn't add up, so I didn't draw it.", why: "spec" }]);
    expect(writes).toEqual([]);
  });

  it("no room on this screen: a new screen, and the model on it", async () => {
    const full: ChatShape = { id: "ink", type: "draw", meta: {}, bounds: { x: 0, y: 0, w: 1600, h: 900 } };
    const { host, writes, pages } = fakeHost({ shapes: [full] });
    const report = await new ChatDesk(host).run([{ type: "draw_model", model: CLOCK }]);
    expect(report.outcomes).toEqual([{ type: "draw_model", ok: true }]);
    expect(report.screensAdded).toBe(1);
    expect(pages()).toBe(2);
    expect(writes).toHaveLength(1);
  });

  it("no room and no screen left: said so plainly", async () => {
    const full: ChatShape = { id: "ink", type: "draw", meta: {}, bounds: { x: 0, y: 0, w: 1600, h: 900 } };
    const { host, writes, metrics } = fakeHost({ shapes: [full], screens: false });
    const report = await new ChatDesk(host).run([{ type: "draw_model", model: CLOCK }]);
    expect(report.outcomes).toEqual([{ type: "draw_model", ok: false, note: "There's no room left for the picture.", why: "no_room" }]);
    expect(writes).toEqual([]);
    expect(metrics).toContainEqual({ name: "live.chat.model.dropped", data: { kind: "clock", why: "no_room" } });
  });

  it("a model no box can hold legibly is said so, without a screen started for it", async () => {
    // 41 ticks, each labelled where a jump lands: no box holds them legibly
    const crowded: VisualModel = { kind: "number_line", from: 0, to: 40, marks: [], jumps: Array.from({ length: 12 }, (_, i) => ({ from: i * 3, to: i * 3 + 1 })) };
    const { host, writes, pages } = fakeHost();
    const report = await new ChatDesk(host).run([{ type: "draw_model", model: crowded }]);
    expect(report.outcomes).toEqual([{ type: "draw_model", ok: false, note: "I couldn't draw that picture.", why: "unplannable" }]);
    expect(writes).toEqual([]);
    expect(pages()).toBe(1);
  });
});
