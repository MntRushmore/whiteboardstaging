/**
 * Ask's board actions for the iPad (`src/lib/brain/chat.ts`): the web's own desk run on a copy of
 * the screen, every promise already settled, so the plan is the web's — the same blocks in the same
 * places — written down as operations for the app. The parity test runs the desk twice: once on
 * the planner's host, once on a host that settles each write a timer later as the board does, and
 * the plans must agree to the last point.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { call } from "@/lib/brain";
import { chatPicture, planChat, PlanningHost, type BrainChatShape, type ChatOp, type ChatPlanArgs } from "@/lib/brain/chat";
import { speechTake } from "@/lib/brain/speech";
import { takeSentences, sentenceWords } from "@/components/chat/voice/speechChunks";
import type { LiveEngine, Rect } from "@/lib/live/contracts";
import { getEngine } from "@/lib/live/engine";
import { CHAT_PROBLEM_META } from "@/lib/live/chat/cells";
import { CHAT_BLOCK_META, ChatDesk, type ChatHost, type ChatShape } from "@/lib/live/chat/desk";
import type { ChatAction } from "@/lib/live/chat/contracts";
import { planFigure } from "@/lib/live/figureDraw/plan";
import { handSeedFor, type HandPlan } from "@/lib/live/handwriting";

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

const SCREEN: Rect = { x: 0, y: 0, w: 1600, h: 900 };

function args(actions: unknown[], over: Partial<ChatPlanArgs> = {}): ChatPlanArgs {
  return { actions, shapes: [], screen: SCREEN, pageId: "screen:a", screenIndex: 1, studentLines: [], handwriting: true, screensLeft: 10, ...over };
}

const writes = (ops: ChatOp[]) => ops.filter((o): o is Extract<ChatOp, { op: "write" }> => o.op === "write");
const inside = (r: Rect, s: Rect) => r.x >= s.x - 0.5 && r.y >= s.y - 0.5 && r.x + r.w <= s.x + s.w + 0.5 && r.y + r.h <= s.y + s.h + 0.5;
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** The student's ink: a stroke box per glyph across a line, near the top left. */
function studentInk(y: number): BrainChatShape[] {
  return [0, 1, 2, 3, 4].map((i) => ({ id: `stroke:k${y}${i}`, type: "draw", meta: {}, bounds: { x: 120 + i * 40, y, w: 30, h: 44 } }));
}

describe("chatPlan — the desk's plan as operations", () => {
  it("problems on an empty screen: one block each, numbered, in its cell, marked as the chat's problem", async () => {
    const res = await planChat(args([{ type: "write_problems", problems: [["2x + 3 = 11"], ["3x - 5 = 10"], ["x^{2} - 5x + 6 = 0"]] }]), () => engine);
    expect(res.failed).toBeUndefined();
    expect(res.report.problemsWritten).toBe(3);
    expect(res.report.outcomes).toEqual([{ type: "write_problems", ok: true }]);
    const w = writes(res.ops);
    expect(w).toHaveLength(3);
    w.forEach((op, i) => {
      const p = op.meta[CHAT_PROBLEM_META] as unknown as { n: number; lines: string[]; cell: Rect };
      expect(p.n).toBe(i + 1);
      expect(op.plan.lines[0].latex).toBe(`${i + 1}.`);
      expect(inside(op.plan.bounds, p.cell)).toBe(true);
      expect(inside(op.plan.bounds, SCREEN)).toBe(true);
      expect(op.page).toBe("screen:a");
    });
    expect(res.ops.some((o) => o.op === "problemsChanged")).toBe(true);
    expect(res.ops.some((o) => o.op === "addScreen")).toBe(false);
  });

  it("problems on a screen with work go on a new one, which carries nothing (no problems were left behind)", async () => {
    const res = await planChat(args([{ type: "write_problems", problems: [["2x = 8"]] }], { shapes: studentInk(100) }), () => engine);
    expect(res.ops[0]).toEqual({ op: "addScreen", page: "new:1" });
    expect(writes(res.ops)[0].page).toBe("new:1");
    expect(res.report.screensAdded).toBe(1);
    expect(res.carried).toEqual({});
  });

  it("a screen the tutor starts from its problems carries them, so a later picture lists them as `from`", async () => {
    const first = await planChat(args([{ type: "write_problems", problems: [["2x = 8"], ["3x = 12"]] }]), () => engine);
    const problemShapes: BrainChatShape[] = writes(first.ops).flatMap((op) =>
      op.plan.lines.map((l, i) => ({ id: `p${i}${l.latex}`, type: "draw", meta: { live: true, source: "ai", ...op.meta, handLine: l.latex }, bounds: { x: l.x, y: l.y, w: 40, h: 40 } })),
    );
    // a worked solution far too long for the room left: it goes on a new screen, which carries #1 and #2
    const teach = { type: "teach", steps: Array.from({ length: 6 }, (_, k) => ({ say: `Step ${k + 1} of the work.`, math: [`x = ${4}`] })), answer: "x = 4" };
    const crowded = [...problemShapes, ...[0, 1, 2, 3, 4, 5, 6, 7, 8].flatMap((r) => [0, 1, 2, 3].map((c) => ({ id: `ink${r}${c}`, type: "draw", meta: {}, bounds: { x: 30 + c * 400, y: 20 + r * 98, w: 380, h: 80 } })))];
    const res = await planChat(args([teach], { shapes: crowded }), () => engine);
    if (res.report.screensAdded > 0) {
      expect(Object.values(res.carried)[0]?.problems).toEqual(["2x = 8", "3x = 12"]);
      const picture = chatPicture({ shapes: [], pageId: "screen:b", carried: { "screen:b": Object.values(res.carried)[0] } }, () => engine);
      expect(picture.from?.problems).toEqual(["2x = 8", "3x = 12"]);
    } else {
      // the desk found room after all: the plan is still inside the screen
      for (const op of writes(res.ops)) expect(inside(op.plan.bounds, SCREEN)).toBe(true);
    }
  });

  it("lines, a graph and a visual model in one reply: each placed clear of the one before", async () => {
    const res = await planChat(
      args([
        { type: "write_lines", lines: ["a^{2} + b^{2} = c^{2}"] },
        { type: "graph", relations: ["y = x^{2} - 4"] },
        { type: "draw_model", model: { kind: "fraction_bars", bars: [{ parts: 4, shaded: 3 }, { parts: 8, shaded: 5 }] } },
      ]),
      () => engine,
    );
    expect(res.report.outcomes.map((o) => o.ok)).toEqual([true, true, true]);
    const w = writes(res.ops);
    expect(w.map((o) => o.meta[CHAT_BLOCK_META])).toEqual(["lines", "graph", "model"]);
    for (const op of w) expect(inside(op.plan.bounds, SCREEN)).toBe(true);
    // the desk keeps each block clear of the ink already there, stroke by stroke (as the web's shapes are)
    const strokes = (plan: HandPlan) =>
      plan.lines.flatMap((l) =>
        l.strokes.map((s) => {
          const xs = s.points.map((p) => p.x + l.x);
          const ys = s.points.map((p) => p.y + l.y);
          return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
        }),
      );
    for (let i = 0; i < w.length; i++)
      for (let j = i + 1; j < w.length; j++)
        for (const a of strokes(w[i].plan)) for (const b of strokes(w[j].plan)) expect(overlap(a, b), `${i} and ${j}`).toBe(false);
    // a model's shaded parts keep their fill style for the app's pen
    expect(w[2].plan.lines.some((l) => l.style?.closed === true && typeof l.style?.fill === "string")).toBe(true);
  });

  it("new_screen, clear_tutor: operations in order, the copy cleared for what follows", async () => {
    const tutorInk: BrainChatShape = { id: "t1", type: "draw", meta: { live: true, source: "ai", lineId: "chat", handLine: "x = 1" }, bounds: { x: 600, y: 300, w: 400, h: 300 } };
    const res = await planChat(args([{ type: "clear_tutor" }, { type: "write_lines", lines: ["x = 1"] }], { shapes: [tutorInk] }), () => engine);
    expect(res.ops.map((o) => o.op).filter((o) => o !== "metric")).toEqual(["clearTutor", "problemsChanged", "write"]);
    const screen = await planChat(args([{ type: "new_screen" }]), () => engine);
    expect(screen.ops).toEqual([{ op: "addScreen", page: "new:1" }]);
    expect(screen.report.outcomes).toEqual([{ type: "new_screen", ok: true }]);
  });

  it("at the board's cap a new screen is refused with the desk's own words", async () => {
    const res = await planChat(args([{ type: "new_screen" }], { screensLeft: 0 }), () => engine);
    expect(res.ops).toEqual([]);
    expect(res.report.outcomes[0]).toEqual({ type: "new_screen", ok: false, note: "This board already has the most screens it can hold." });
  });

  it("help: a problem not on the screen is a note; one that is goes to the app; nothing of the student's is said so", async () => {
    const missing = await planChat(args([{ type: "help_problem", problem: 4, depth: "step" }]), () => engine);
    expect(missing.ops.filter((o) => o.op === "helpProblem")).toEqual([]);
    expect(missing.report.outcomes[0].ok).toBe(false);
    const cell = { x: 0, y: 0, w: 800, h: 450 };
    const problem: BrainChatShape = { id: "p", type: "draw", meta: { live: true, source: "ai", [CHAT_PROBLEM_META]: { n: 2, lines: ["2x = 8"], cell } }, bounds: { x: 30, y: 30, w: 120, h: 40 } };
    const there = await planChat(args([{ type: "help_problem", problem: 2, depth: "solve" }], { shapes: [problem] }), () => engine);
    expect(there.ops).toContainEqual({ op: "helpProblem", page: "screen:a", n: 2, depth: "solve" });
    const own = await planChat(args([{ type: "help_board", depth: "step" }]), () => engine);
    expect(own.report.outcomes[0]).toMatchObject({ ok: false, why: "nothing" });
    const theirs = await planChat(args([{ type: "help_board", depth: "step" }], { shapes: studentInk(200), studentLines: ["2x + 3 = 11"] }), () => engine);
    expect(theirs.ops).toContainEqual({ op: "helpBoard", page: "screen:a", depth: "step" });
    expect(own.helpNotes.busy).toMatch(/still writing/);
  });

  it("a worked solution beside the student's work: sentences and maths in steps, with the desk's pauses", async () => {
    const res = await planChat(
      args([{ type: "teach", steps: [{ say: "Take 3 from both sides.", math: ["2x + 3 = 11", "2x = 8"] }, { say: "Divide both sides by 2.", math: ["x = 4"] }], answer: "x = 4" }], { shapes: studentInk(80) }),
      () => engine,
    );
    expect(res.report.outcomes[0]).toEqual({ type: "teach", ok: true });
    const w = writes(res.ops);
    expect(w.length).toBeGreaterThan(1);
    for (const op of w) expect(inside(op.plan.bounds, SCREEN)).toBe(true);
    expect(res.ops.some((o) => o.op === "pause")).toBe(true);
  });

  it("the hand off: problems are typeset in their cells", async () => {
    const res = await planChat(args([{ type: "write_problems", problems: [["2x = 8"], ["x + 1 = 3"]] }], { handwriting: false }), () => engine);
    const t = res.ops.filter((o) => o.op === "typeset");
    expect(t).toHaveLength(2);
    expect(t[0]).toMatchObject({ latex: "1.\\ \\ 2x = 8" });
  });

  it("an action that is not one is skipped; the rest run", async () => {
    const res = await planChat(args([{ type: "paint" }, { type: "new_screen" }]), () => engine);
    expect(res.skipped).toBe(1);
    expect(res.ops).toEqual([{ op: "addScreen", page: "new:1" }]);
  });

  it("parity: the same desk on a host that settles a timer later writes the same plans", async () => {
    const actions = [
      { type: "write_lines", lines: ["A = \\pi r^{2}"] },
      { type: "graph", relations: ["y = 2x + 1"] },
      { type: "draw_model", model: { kind: "number_line", from: 0, to: 10, marks: [{ at: 3 }], jumps: [{ from: 3, to: 7, label: "+4" }] } },
      { type: "draw_model", model: { kind: "clock", hour: 3, minute: 45 } },
    ] as ChatAction[];
    const shapes = studentInk(60);
    const planned = await planChat(args(actions, { shapes }), () => engine);
    // the web board's way: shapes in a list, each write a timer later
    const board: ChatShape[] = shapes.map((s) => ({ id: s.id, type: s.type, meta: s.meta ?? {}, bounds: s.bounds }));
    const plans: HandPlan[] = [];
    const host: ChatHost = {
      engine: async () => engine,
      shapes: () => board,
      screen: () => SCREEN,
      pageId: () => "screen:a",
      studentLines: () => [],
      handwriting: () => true,
      handBusy: () => false,
      write: (plan, meta) =>
        new Promise((resolve) => {
          plans.push(plan);
          for (const l of plan.lines)
            for (const s of l.strokes) {
              const xs = s.points.map((p) => p.x + l.x);
              const ys = s.points.map((p) => p.y + l.y);
              board.push({ id: `w${board.length}`, type: "draw", meta: { live: true, source: "ai", ...meta, handLine: l.latex }, bounds: { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) } });
            }
          setTimeout(resolve, 0);
        }),
      typeset: () => ({ x: 0, y: 0, w: 1, h: 1 }),
      addScreen: () => false,
      screenReady: () => true,
      clearTutor: () => undefined,
      problemsChanged: () => undefined,
      helpProblem: () => "missing",
      planFigure: (spec, opts) => planFigure(spec, opts),
      seed: handSeedFor,
      delay: (ms) => new Promise((r) => setTimeout(r, ms > 0 ? 1 : 0)),
    };
    await new ChatDesk(host).run(actions);
    expect(writes(planned.ops).map((o) => o.plan)).toEqual(plans);
  });
});

describe("chatPlan across the boundary: start, then read on the next call", () => {
  it("the ticket's result is there once the microtasks have run, and only once", async () => {
    const started = JSON.parse(call("chatPlan", JSON.stringify(args([{ type: "write_lines", lines: ["x = 4"] }])))) as { ok: boolean; result: { ticket: number } };
    expect(started.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    const taken = JSON.parse(call("chatResult", JSON.stringify({ ticket: started.result.ticket }))) as { ok: boolean; result: { done: boolean; result: { ops: ChatOp[] } } };
    expect(taken.result.done).toBe(true);
    expect(writes(taken.result.result.ops)).toHaveLength(1);
    const again = JSON.parse(call("chatResult", JSON.stringify({ ticket: started.result.ticket }))) as { result: { error?: string } };
    expect(again.result.error).toMatch(/no chat plan/);
  });

  it("chatPicture is the desk's picture: the tutor's problems numbered, the student's lines, drawings left out", () => {
    const cell = { x: 0, y: 0, w: 800, h: 450 };
    const shapes: BrainChatShape[] = [
      { id: "p1", type: "draw", meta: { live: true, source: "ai", [CHAT_PROBLEM_META]: { n: 5, lines: ["2x = 8"], cell } }, bounds: { x: 30, y: 30, w: 100, h: 40 } },
      { id: "g", type: "draw", meta: { live: true, source: "ai", [CHAT_BLOCK_META]: "graph", handLine: "y = x" }, bounds: { x: 900, y: 30, w: 100, h: 40 } },
      { id: "l", type: "draw", meta: { live: true, source: "ai", [CHAT_BLOCK_META]: "lines", handLine: "a^{2} + b^{2} = c^{2}" }, bounds: { x: 900, y: 500, w: 100, h: 40 } },
    ];
    const picture = chatPicture({ shapes, pageId: "screen:a", studentLines: ["x = 4"] }, () => engine);
    expect(picture).toEqual({ empty: false, student: ["x = 4"], tutor: ["a^{2} + b^{2} = c^{2}"], problems: ["2x = 8"], numbers: [5] });
    expect(chatPicture({ shapes: [], pageId: "screen:a" }, () => engine).empty).toBe(true);
  });

  it("a fresh host: no busy hand, screens ready, and the student's lines only on the screen it started on", () => {
    const host = new PlanningHost(args([], { studentLines: ["x = 1"] }), () => engine);
    expect(host.handBusy()).toBe(false);
    expect(host.studentLines()).toEqual(["x = 1"]);
    expect(host.addScreen()).toBe(true);
    expect(host.studentLines()).toEqual([]);
    expect(host.screenIndex()).toBe(2);
  });
});

describe("speech chunking across the boundary", () => {
  it("speechTake is the web's takeSentences with each sentence's words", () => {
    const text = "Great question! A half is $\\frac{1}{2}$ of a pizza. Then we add 3.5 more";
    const mine = speechTake({ text, from: 0, final: false });
    const web = takeSentences(text, 0, false);
    expect(mine.next).toBe(web.next);
    expect(mine.sentences.map((s) => s.text)).toEqual(web.sentences);
    expect(mine.sentences.map((s) => s.words)).toEqual(web.sentences.map(sentenceWords));
    expect(mine.sentences[1].words).toMatch(/one half/);
    const rest = speechTake({ text, from: mine.next, final: true });
    expect(rest.sentences.map((s) => s.text)).toEqual(["Then we add 3.5 more"]);
  });
});
