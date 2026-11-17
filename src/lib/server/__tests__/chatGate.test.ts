/**
 * `chatGate` on its own (the board chat's engine gates, shared by /api/live/chat and /api/live/ask):
 * the edges the route tests do not reach — nothing proposed, nothing readable, a model reply far over
 * the limits, unicode, a repair the route's time does not allow, a repair that fails on the network,
 * the route declining the refund, and a refund the database does not make.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  /** the figure drawer's check: [] is a clean figure */
  drawer: { check: (() => []) as (spec: unknown) => string[] },
  events: [] as Array<{ level: string; code: string; message: string; meta?: Record<string, unknown> }>,
}));

vi.mock("@/lib/server/openrouter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/openrouter")>();
  return { ...actual, chatJsonWithFallback: vi.fn() };
});
vi.mock("@/lib/server/billing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/billing")>();
  return { ...actual, refundInk: vi.fn() };
});
vi.mock("@/lib/server/request", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/request")>();
  return { ...actual, recordRouteEvent: (_log: unknown, e: (typeof fake.events)[number]) => void fake.events.push(e) };
});
vi.mock("@/lib/live/figureDraw/check", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/live/figureDraw/check")>();
  return { ...actual, checkFigure: (spec: unknown) => fake.drawer.check(spec) };
});

import type pino from "pino";
import { CHAT_LIMITS } from "@/lib/live/chat/limits";
import { refundInk } from "@/lib/server/billing";
import { chatGate, FIGURE_NOT_DRAWN, MODEL_NOT_DRAWN, type ChatGateContext } from "@/lib/server/chatGate";
import { chatJsonWithFallback, UpstreamError } from "@/lib/server/openrouter";

const TRIANGLE = {
  points: { A: { x: 0, y: 0 }, B: { x: 4, y: 0 }, C: { x: 0, y: 3 } },
  segments: [{ from: "A", to: "B", label: "4" }],
};
const FIGURE = { type: "draw_figure", figure: TRIANGLE };
/** a fraction bar with more shaded than parts: the spec check refuses it */
const BAD_MODEL = { type: "draw_model", model: { kind: "fraction_bars", bars: [{ parts: 4, shaded: 5 }] } };

const log = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() };

function ctx(over: Partial<ChatGateContext> = {}): ChatGateContext {
  const now = Date.now();
  return {
    request: { message: "draw it", history: [], screen: { empty: false, student: [], tutor: [], problems: ["2x + 3 = 11"] } },
    models: { primary: "primary/model", fallback: "fallback/model" },
    route: "chat",
    model: "primary/model",
    signal: new AbortController().signal,
    requestId: "req-1",
    userId: "user-1",
    log: log as unknown as pino.Logger,
    startedAt: now,
    deadline: now + 60_000,
    ...over,
  };
}

beforeEach(() => {
  fake.drawer.check = () => [];
  fake.events.length = 0;
  vi.mocked(chatJsonWithFallback).mockReset();
  vi.mocked(refundInk).mockReset();
  vi.mocked(refundInk).mockResolvedValue({ refunded: 3, remaining: 103 });
  for (const fn of Object.values(log)) fn.mockReset();
});

describe("chatGate", () => {
  it("nothing proposed (a polite no): no actions, the reply stands, no refund", async () => {
    const r = await chatGate([], ctx());
    expect(r).toMatchObject({ actions: [], notes: [], replacement: null, refunded: false, proposed: 0, dropped: [] });
    expect(refundInk).not.toHaveBeenCalled();
    expect(chatJsonWithFallback).not.toHaveBeenCalled();
  });

  it("nothing readable (null, arrays, strings, unknown types): every one dropped, a plain line instead, the ink back once", async () => {
    const raw = [null, undefined, 42, "write_lines", [], ["x"], {}, { type: "rm -rf" }, { type: "write_lines" }, { type: "write_lines", lines: [] }];
    const r = await chatGate(raw, ctx());
    expect(r.actions).toEqual([]);
    expect(r.proposed).toBe(raw.length);
    expect(r.dropped).toHaveLength(raw.length);
    expect(r.replacement).toBe("Sorry, I couldn't do that on the board. Try asking another way.");
    expect(r.notes).toEqual([]);
    expect(refundInk).toHaveBeenCalledTimes(1);
    expect(vi.mocked(refundInk).mock.calls[0]![0]).toEqual({ userId: "user-1", requestId: "req-1" });
    expect(r.refunded).toBe(true);
  });

  it("a board block that could not be read counts as proposed and dropped: refunded like any other loss", async () => {
    const r = await chatGate([], ctx(), [{ type: "?", reason: "board block was not JSON" }]);
    expect(r.proposed).toBe(1);
    expect(r.dropped).toEqual([{ type: "?", reason: "board block was not JSON" }]);
    expect(r.replacement).not.toBeNull();
    expect(refundInk).toHaveBeenCalledTimes(1);
  });

  it("the route may keep the charge (Ask's real explanation): refundWhen sees the replacement line and says no", async () => {
    const refundWhen = vi.fn(() => false);
    const r = await chatGate([{ type: "nope" }], ctx({ refundWhen }));
    expect(refundWhen).toHaveBeenCalledWith(r.replacement);
    expect(r.replacement).not.toBeNull();
    expect(r.refunded).toBe(false);
    expect(refundInk).not.toHaveBeenCalled();
  });

  it("a refund the database does not make is not reported as made", async () => {
    vi.mocked(refundInk).mockResolvedValue({ refunded: 0, reason: "refund_ink_for failed: boom" });
    const r = await chatGate([{ type: "nope" }], ctx());
    expect(refundInk).toHaveBeenCalledTimes(1);
    expect(r.refunded).toBe(false);
  });

  it("a reply far over the limits: only the first CHAT_LIMITS.actions go on, the rest dropped as too many, the charge kept", async () => {
    const raw = Array.from({ length: 200 }, (_, i) => ({ type: "write_lines", lines: [`x = ${i}`] }));
    const r = await chatGate(raw, ctx());
    expect(r.actions).toHaveLength(CHAT_LIMITS.actions);
    expect(r.actions.map((a) => (a.type === "write_lines" ? a.lines[0] : null))).toEqual(Array.from({ length: CHAT_LIMITS.actions }, (_, i) => `x = ${i}`));
    expect(r.dropped).toHaveLength(200 - CHAT_LIMITS.actions);
    expect(r.dropped.every((d) => d.reason === "too many actions")).toBe(true);
    expect(r.replacement).toBeNull();
    expect(refundInk).not.toHaveBeenCalled();
  });

  it("unicode in the maths goes through untouched", async () => {
    const lines = ["π r² ≈ 3.14 × r²", "x ≤ 5 ∧ y ≥ −2", "∠ABC = 90°", "√{2} 👋"];
    const r = await chatGate([{ type: "write_lines", lines }], ctx());
    expect(r.actions).toEqual([expect.objectContaining({ type: "write_lines", lines })]);
  });

  it("words smuggled into the maths (\\text in any script) drop the whole action, never half of it", async () => {
    const r = await chatGate([{ type: "write_lines", lines: ["x = 2", "\\text{Привет, 世界}"] }, { type: "write_lines", lines: ["y = 3"] }], ctx());
    expect(r.actions).toEqual([expect.objectContaining({ lines: ["y = 3"] })]);
    expect(r.dropped).toHaveLength(1);
  });

  it("no repair is started with too little of the route's time left: the figure is dropped, a budget event says so", async () => {
    fake.drawer.check = () => ["C is not on AB"];
    const now = Date.now();
    const r = await chatGate([FIGURE], ctx({ startedAt: now - 45_000, deadline: now + 1_000 }));
    expect(chatJsonWithFallback).not.toHaveBeenCalled();
    expect(r.actions).toEqual([]);
    expect(r.stats).toMatchObject({ repairs: 0, repairsSkipped: 1 });
    expect(r.replacement).toBe("Sorry, I couldn't draw that figure.");
    expect(refundInk).toHaveBeenCalledTimes(1);
    expect(fake.events).toEqual([expect.objectContaining({ level: "warn", code: "budget", meta: expect.objectContaining({ skipped: 1 }) })]);
  });

  it("a deadline already past: still answers (no repair, no throw)", async () => {
    fake.drawer.check = () => ["bad"];
    const now = Date.now();
    const r = await chatGate([FIGURE, BAD_MODEL, { type: "write_lines", lines: ["x = 1"] }], ctx({ deadline: now - 5_000 }));
    expect(chatJsonWithFallback).not.toHaveBeenCalled();
    expect(r.actions.map((a) => a.type)).toEqual(["write_lines"]);
    expect(r.notes).toEqual([FIGURE_NOT_DRAWN, MODEL_NOT_DRAWN]);
    expect(r.stats.repairsSkipped).toBe(2);
    expect(refundInk).not.toHaveBeenCalled();
  });

  it("a repair that fails on the network drops the figure with a warning; the request still answers", async () => {
    fake.drawer.check = () => ["C is not on AB"];
    vi.mocked(chatJsonWithFallback).mockRejectedValueOnce(new UpstreamError(504, "network down"));
    const r = await chatGate([FIGURE, { type: "write_lines", lines: ["x = 4"] }], ctx());
    expect(chatJsonWithFallback).toHaveBeenCalledTimes(1);
    expect(r.actions.map((a) => a.type)).toEqual(["write_lines"]);
    expect(r.notes).toEqual([FIGURE_NOT_DRAWN]);
    expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({ err: "network down" }), "chat figure repair failed");
    expect(refundInk).not.toHaveBeenCalled();
  });

  it("a repair reply that is no figure at all is a drop, not a crash", async () => {
    fake.drawer.check = () => ["bad"];
    vi.mocked(chatJsonWithFallback).mockResolvedValueOnce({ data: { figure: { points: "not points" } }, model: "primary/model" } as never);
    const r = await chatGate([FIGURE], ctx());
    expect(r.actions).toEqual([]);
    expect(r.replacement).toBe("Sorry, I couldn't draw that figure.");
  });

  it("the repairs use the route's word, models and deadline", async () => {
    fake.drawer.check = () => ["bad"];
    vi.mocked(chatJsonWithFallback).mockRejectedValueOnce(new Error("x"));
    const c = ctx({ route: "ask", models: { primary: "p", fallback: "f" } });
    await chatGate([FIGURE], c);
    const [primary, fallback, opts] = vi.mocked(chatJsonWithFallback).mock.calls[0]!;
    expect([primary, fallback]).toEqual(["p", "f"]);
    expect(opts).toMatchObject({ title: "Agathon Live - ask figure", deadline: c.deadline, requestId: "req-1", signal: c.signal });
  });

  it("a new screen the student asked for on its own is made; one only for a dropped figure is not", async () => {
    const alone = await chatGate([{ type: "new_screen" }], ctx());
    expect(alone.actions).toEqual([{ type: "new_screen" }]);
    expect(refundInk).not.toHaveBeenCalled();

    fake.drawer.check = () => ["bad"];
    vi.mocked(chatJsonWithFallback).mockRejectedValueOnce(new Error("x"));
    const forFigure = await chatGate([{ type: "new_screen" }, { type: "clear_tutor" }, FIGURE], ctx());
    expect(forFigure.actions).toEqual([]);
    expect(forFigure.replacement).toBe("Sorry, I couldn't draw that figure.");
    expect(refundInk).toHaveBeenCalledTimes(1);
  });

  it("help with a problem number the screen does not have is the only thing proposed: that note replaces the reply, ink back", async () => {
    const r = await chatGate([{ type: "help_problem", problem: 7 }], ctx());
    expect(r.actions).toEqual([]);
    expect(r.replacement).toBeTruthy();
    expect(r.replacement).not.toBe("Sorry, I couldn't do that on the board. Try asking another way.");
    expect(r.notes).toEqual([]);
    expect(refundInk).toHaveBeenCalledTimes(1);
  });

  it("calls in quick succession share nothing: each request's repair budget and refund are its own", async () => {
    fake.drawer.check = () => ["bad"];
    vi.mocked(chatJsonWithFallback).mockRejectedValue(new Error("x"));
    const results = await Promise.all(Array.from({ length: 5 }, (_, i) => chatGate([FIGURE], ctx({ requestId: `req-${i}` }))));
    // one repair attempt per request, not one in total
    expect(chatJsonWithFallback).toHaveBeenCalledTimes(5);
    expect(results.every((r) => r.stats.repairs === 1 && r.refunded)).toBe(true);
    expect(vi.mocked(refundInk).mock.calls.map((c) => c[0].requestId).sort()).toEqual(["req-0", "req-1", "req-2", "req-3", "req-4"]);
  });
});
