import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { TLShape } from "tldraw";
import { createFakeEditor, type FakeEditor } from "../__fixtures__/fakeEditor";
import { writeLine as inkLine } from "../__fixtures__/strokes";
import { settleStable, settleUntil } from "@/lib/live/__fixtures__/settle";
import { useSyncHash } from "@/lib/live/__fixtures__/syncHash";
import {
  LIVE_TIMING,
  isLiveMeta,
  type HelpMode,
  type LiveEngine,
  type LiveSseEvent,
  type MathShapeProps,
  type RecognizeRequest,
  type RecognizeResponse,
  type Rect,
} from "../contracts";
import { getEngine } from "../engine";
import { handBlockOf, handLinesOf } from "../handwriting";
import { ANSWER_SETTLE_MS, createLiveLoop, type LiveLoop } from "../liveLoop";
import { liveStore, resetLiveStore } from "../liveStore";
import { RecognizeClient, type FetchJson } from "../recognizeClient";

/**
 * A line the student ended with `=`, and the value of its letter written in the same column.
 *
 * The owner wrote, stacked on a desktop board,
 *
 *   3x + 24 =
 *     x = 3
 *
 * and the board asked the solve model, which answered `= 3(x+8)` — written in blue on the free row
 * under the `x = 3`, where it read `x = 3 = 3(x+8)`. The question is "3x + 24 at x = 3": 33, which
 * the engine works out with no model, written where the student left off, after their `=`. And a
 * step that does continue a line ending in `=` belongs to THAT line, never to a later one.
 *
 * The real engine and the real hand engine; the recognizer and the model are scripted.
 */

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

type Reply = { events?: LiveSseEvent[] };

describe("live loop — a line ending in `=` evaluated at the value the column gives (`3x + 24 =` over `x = 3`)", () => {
  useSyncHash();

  let editor: FakeEditor;
  let fetchJson: Mock<FetchJson>;
  let loop: LiveLoop;
  let calls: Array<{ path: string; body: unknown }>;
  let replies: { check: Reply[]; solve: Reply[] };
  let handwriting: boolean;
  /** latex the recognizer gives each line, in the order the lines are first read */
  let script: string[];
  let assigned: Map<string, string>;

  function start(mode: HelpMode, opts: { auto?: boolean } = {}): void {
    loop?.stop();
    resetLiveStore();
    const stream = async function* (path: string, body: unknown): AsyncGenerator<LiveSseEvent, void, undefined> {
      calls.push({ path, body });
      const reply = (path.endsWith("/solve") ? replies.solve : replies.check).shift() ?? {};
      for (const ev of reply.events ?? []) yield ev;
    };
    loop = createLiveLoop(
      editor,
      { boardId: "board-1", mode, enabled: true, auto: opts.auto ?? true },
      {
        recognizer: new RecognizeClient({ fetchJson }),
        stream,
        getEngine: async () => engine,
        fetchCapabilities: async () => ({ recognizer: "mathpix", liveEnabled: true, models: { check: "c", solve: "s", vision: "v" } }),
        events: null,
        isOnline: () => true,
        handwritingEnabled: () => handwriting,
        reducedMotion: () => true,
        setup: async () => {
          throw new Error("no word problems here");
        },
        reread: async () => {
          throw new Error("no second reader here");
        },
        notify: () => undefined,
      },
    );
    loop.start();
  }

  /** One line of `ink` at (x, y), read as `latex`; the pen stays up just long enough for the read. */
  async function penLine(ink: string, latex: string, y: number, x = 100): Promise<string> {
    script.push(latex);
    const before = new Set(Object.keys(liveStore.lines.get()));
    editor.putUser(inkLine(ink, x, y, 40));
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.quietMs + 300);
    await settleUntil(() => Object.entries(liveStore.lines.get()).some(([id, st]) => !before.has(id) && Boolean(st.latex)));
    return Object.keys(liveStore.lines.get()).find((id) => !before.has(id))!;
  }

  const quiesce = () =>
    settleStable(() => [editor.getCurrentPageShapes().length, calls.length, liveStore.solving.get(), liveStore.lastError.get()?.id ?? ""].join("|"));

  /** Time passes with no ink. */
  async function wait(ms: number): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
    await quiesce();
  }

  const metaOf = (s: TLShape) => s.meta as Record<string, unknown>;
  const tutorInk = () => editor.getCurrentPageShapes().filter((s) => s.type === "draw" && isLiveMeta(s.meta) && !metaOf(s).mark);
  /** what the tutor wrote by hand that is not a mark, as lines of maths */
  const work = () => handLinesOf(tutorInk());
  const marks = () =>
    editor
      .getCurrentPageShapes()
      .filter((s) => isLiveMeta(s.meta) && metaOf(s).mark)
      .map((s) => String(metaOf(s).mark).split(":")[0]);
  const solves = () => calls.filter((c) => c.path.endsWith("/solve"));
  /** the typeset steps the tutor placed (`placeSolutionStep`), top to bottom */
  const typeset = () =>
    editor
      .shapesOfType("math")
      .filter((s) => isLiveMeta(s.meta) && s.meta.source === "ai")
      .sort((a, b) => a.y - b.y);
  const bounds = (id: string): Rect => liveStore.lines.get()[id].line.bounds;

  function boundsOf(shapes: TLShape[]): Rect {
    const boxes = shapes.map((s) => editor.getShapePageBounds(s)!);
    const x = Math.min(...boxes.map((b) => b.x));
    const y = Math.min(...boxes.map((b) => b.y));
    return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
  }

  /** Where the tutor wrote the hand line `latex`. */
  function whereIs(latex: string): Rect {
    const block = tutorInk().find((s) => handLinesOf([s]).includes(latex));
    if (!block) throw new Error(`the tutor did not write ${latex}: ${JSON.stringify(work())}`);
    return boundsOf(tutorInk().filter((s) => handBlockOf(s.meta) === handBlockOf(block.meta)));
  }

  /** Written after the line's last glyph, on its writing line: a continuation of it. */
  function expectAfter(written: Rect, line: Rect): void {
    expect(written.x).toBeGreaterThan(line.x + line.w);
    expect(written.x - (line.x + line.w)).toBeLessThan(40);
    expect(Math.abs(written.y + written.h - (line.y + line.h))).toBeLessThan(Math.max(6, line.h * 0.2));
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    editor = createFakeEditor();
    calls = [];
    replies = { check: [], solve: [] };
    handwriting = true;
    script = [];
    assigned = new Map();
    fetchJson = vi.fn<FetchJson>(async (_path, body): Promise<RecognizeResponse> => {
      const { lineId } = body as RecognizeRequest;
      let latex = assigned.get(lineId);
      if (latex === undefined) {
        latex = script[assigned.size] ?? "\\Delta";
        assigned.set(lineId, latex);
      }
      return { latex, text: "", kind: "math", confidence: 0.97, provider: "mathpix", ms: 300 };
    });
    liveStore.inkBalance.set(null);
  });

  afterEach(() => {
    loop.stop();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // ------------------------------------------------------------------ Solve

  describe("Solve", () => {
    it("Auto on: `33` after the `=` of `3x + 24 =` at the pause — no model, nothing under the `x = 3`", async () => {
      start("answer");
      const problem = await penLine("3x+24=", "3x+24=", 200);
      const given = await penLine("x=3", "x=3", 320);
      await wait(ANSWER_SETTLE_MS);
      expect(work()).toEqual(["33"]);
      expect(calls).toEqual([]);
      const answer = whereIs("33");
      expectAfter(answer, bounds(problem));
      expect(answer.y + answer.h).toBeLessThan(bounds(given).y);
      // Solve it now changes nothing: the problem is answered
      loop.noteAsked();
      loop.requestSolve();
      await wait(1000);
      expect(work()).toEqual(["33"]);
      expect(calls).toEqual([]);
    });

    it("Auto off: nothing until Solve it — asked on the `x = 3`, the line it evaluates is answered", async () => {
      start("answer", { auto: false });
      const problem = await penLine("3x+24=", "3x+24=", 200);
      await penLine("x=3", "x=3", 320);
      await wait(LIVE_TIMING.stuckMs);
      expect(work()).toEqual([]);

      loop.noteAsked();
      loop.requestSolve();
      await wait(1000);
      expect(work()).toEqual(["33"]);
      expect(solves()).toEqual([]);
      expectAfter(whereIs("33"), bounds(problem));
    });

    it("the given written ABOVE the line: `x = 3`, then `3x + 24 =`", async () => {
      start("answer");
      await penLine("x=3", "x=3", 200);
      const problem = await penLine("3x+24=", "3x+24=", 320);
      await wait(ANSWER_SETTLE_MS);
      expect(work()).toEqual(["33"]);
      expect(calls).toEqual([]);
      expectAfter(whereIs("33"), bounds(problem));
    });

    it("several givens, a negative and a fraction", async () => {
      start("answer");
      await penLine("2x+3x=", "2x+3y=", 200);
      await penLine("x=3", "x=3", 320);
      await penLine("x=2", "y=-2", 440);
      await wait(ANSWER_SETTLE_MS);
      expect(work()).toEqual(["0"]);

      await penLine("4x+1=", "4x+1=", 200, 700);
      await penLine("x=1", "x=\\frac{1}{2}", 320, 700);
      await wait(ANSWER_SETTLE_MS);
      expect(work().sort()).toEqual(["0", "3"]);
      expect(calls).toEqual([]);
    });

    it("`x = 3` read as two lines, `x =` and `3`: still the value of `x`", async () => {
      start("answer", { auto: false });
      const problem = await penLine("3x+24=", "3x+24=", 200);
      const half = await penLine("x=", "x=", 320);
      await penLine("3", "3", 440);
      loop.noteAsked();
      loop.requestSolve();
      await wait(1000);
      expect(work()).toEqual(["33"]);
      expect(calls).toEqual([]);
      expectAfter(whereIs("33"), bounds(problem));
      // `x =` itself is not answered with the 3 written after it
      expect(liveStore.lines.get()[half].analysis?.substituted).toBeUndefined();
      expect(marks()).toEqual([]);
    });

    it("the value rewritten: the old answer goes and the new one is written; rubbed out, the answer goes with it", async () => {
      start("answer");
      await penLine("3x+24=", "3x+24=", 200);
      const given = await penLine("x=3", "x=3", 320);
      await wait(ANSWER_SETTLE_MS);
      expect(work()).toEqual(["33"]);

      // rubbed out and written again with another value
      editor.removeUser(liveStore.lines.get()[given].line.strokeIds);
      await penLine("x=4", "x=4", 320);
      await wait(ANSWER_SETTLE_MS);
      expect(work()).toEqual(["36"]);

      // rubbed out: the answer goes with it
      const again = Object.values(liveStore.lines.get()).find((s) => s.latex === "x=4")!;
      editor.removeUser(again.line.strokeIds);
      await wait(ANSWER_SETTLE_MS);
      expect(work()).toEqual([]);
      expect(calls).toEqual([]);
    });

    it("typed over: the old value's answer goes at once", async () => {
      start("answer");
      await penLine("3x+24=", "3x+24=", 200);
      const given = await penLine("x=3", "x=3", 320);
      await wait(ANSWER_SETTLE_MS);
      expect(work()).toEqual(["33"]);
      loop.retypeLine(given, "x=4");
      await wait(1000);
      expect(work()).not.toContain("33");
    });

    it("no room after the `=` nor under the line: restated under the work (`3x + 24 = 33`), never `= 33` under the `x = 3`", async () => {
      start("answer", { auto: false });
      // so far right that nothing fits after the `=` on this screen, and the `x = 3` right under it
      await penLine("3x+24=", "3x+24=", 200, 1360);
      const given = await penLine("x=3", "x=3", 270, 1360);
      loop.noteAsked();
      loop.requestSolve();
      await wait(1000);
      expect(calls).toEqual([]);
      expect(work()).toEqual(["3x+24 = 33"]);
      expect(whereIs("3x+24 = 33").y).toBeGreaterThan(bounds(given).y + bounds(given).h);
    });

    it("typeset with the hand off: straight under the line when it fits there, else restated under the work", async () => {
      handwriting = false;
      start("answer", { auto: false });
      const problem = await penLine("3x+24=", "3x+24=", 200);
      const given = await penLine("x=3", "x=3", 320);
      loop.noteAsked();
      loop.requestSolve();
      await wait(1000);
      expect(calls).toEqual([]);
      let steps = typeset();
      expect(steps.map((s) => (s.props as MathShapeProps).latex)).toEqual(["= 33"]);
      expect(steps[0].y).toBeGreaterThan(bounds(problem).y + bounds(problem).h);
      expect(steps[0].y + (steps[0].props as MathShapeProps).h).toBeLessThan(bounds(given).y);

      // the next problem's lines close together: no room under the line
      await penLine("4x+1=", "4x+1=", 200, 700);
      const close = await penLine("x=1", "x=2", 250, 700);
      loop.noteAsked();
      loop.requestSolve();
      await wait(1000);
      steps = typeset().filter((s) => s.x >= 650);
      expect(steps.map((s) => (s.props as MathShapeProps).latex)).toEqual(["4x+1 = 9"]);
      expect(steps[0].y).toBeGreaterThan(bounds(close).y + bounds(close).h);
    });
  });

  // ------------------------------------------------------------------ Suggest and Feedback

  describe("Suggest and Feedback: the next step is the value put in", () => {
    it("Suggest, Help me on the `x = 3`: `3(3) + 24` after the `=`; asked again, nothing new", async () => {
      start("suggest", { auto: false });
      const problem = await penLine("3x+24=", "3x+24=", 200);
      await penLine("x=3", "x=3", 320);
      loop.noteAsked();
      loop.requestHelp();
      await wait(1000);
      expect(work()).toEqual(["3(3)+24"]);
      expectAfter(whereIs("3(3)+24"), bounds(problem));
      loop.noteAsked();
      loop.requestHelp();
      await wait(1000);
      expect(work()).toEqual(["3(3)+24"]);
      expect(calls).toEqual([]);
    });

    it("Suggest, Auto on: the same step at the stuck pause", async () => {
      start("suggest");
      await penLine("3x+24=", "3x+24=", 200);
      await penLine("x=3", "x=3", 320);
      await wait(LIVE_TIMING.stuckMs + 500);
      expect(work()).toEqual(["3(3)+24"]);
      expect(calls).toEqual([]);
    });

    it("...then Solve finishes the line after it: `3x + 24 = 3(3) + 24 = 33`", async () => {
      start("suggest", { auto: false });
      const problem = await penLine("3x+24=", "3x+24=", 200);
      await penLine("x=3", "x=3", 320);
      loop.noteAsked();
      loop.requestHelp();
      await wait(1000);
      loop.setOptions({ ...loop.getOptions(), mode: "answer" });
      loop.noteAsked();
      loop.requestSolve();
      await wait(1000);
      expect(work()).toEqual(["3(3)+24", "= 33"]);
      const step = whereIs("3(3)+24");
      expectAfter(whereIs("= 33"), { ...bounds(problem), w: step.x + step.w - bounds(problem).x });
    });

    it("Feedback: the given is no step — no ring and no tick, at the pause or asked; Help me writes the value put in", async () => {
      start("feedback");
      await penLine("3x+24=", "3x+24=", 200);
      await penLine("x=3", "x=3", 320);
      await wait(LIVE_TIMING.stuckMs + 500);
      expect(marks()).toEqual([]);
      expect(work()).toEqual([]);
      expect(calls).toEqual([]);

      loop.noteAsked();
      loop.requestHelp();
      await wait(1000);
      expect(marks()).toEqual([]);
      expect(work()).toEqual(["3(3)+24"]);
      expect(calls).toEqual([]);
    });
  });

  // ------------------------------------------------------------------ a model's step continuing a line ending in `=`

  describe("a step continuing a line ending in `=` belongs to THAT line", () => {
    const SOLVED: LiveSseEvent = { event: "step", data: { index: 1, latex: "= \\boxed{3(x+8)}", explanation: "", final: true } };

    it("the model's `= 3(x+8)` for `3x + 24 =` goes after its `=`, not under the line below it", async () => {
      start("answer", { auto: false });
      replies.solve.push({ events: [SOLVED] });
      // `y = 3` gives no value to the x of `3x + 24`: nothing local, the model is asked
      const problem = await penLine("3x+24=", "3x+24=", 200);
      const other = await penLine("x=3", "y=3", 320);
      loop.noteAsked();
      loop.requestSolve();
      await wait(1000);
      expect(solves()).toHaveLength(1);
      expect(work()).toEqual(["3(x+8)"]);
      const step = whereIs("3(x+8)");
      expectAfter(step, bounds(problem));
      expect(step.y + step.h).toBeLessThan(bounds(other).y);
    });

    it("...straight under it when it cannot go after it", async () => {
      start("answer", { auto: false });
      replies.solve.push({ events: [SOLVED] });
      const problem = await penLine("3x+24=", "3x+24=", 200, 1360);
      const other = await penLine("x=3", "y=3", 320, 1360);
      loop.noteAsked();
      loop.requestSolve();
      await wait(1000);
      expect(work()).toEqual(["= 3(x+8)"]);
      const step = whereIs("= 3(x+8)");
      expect(step.y).toBeGreaterThan(bounds(problem).y + bounds(problem).h);
      expect(step.y + step.h).toBeLessThan(bounds(other).y);
    });

    it("...restated as that line under the work when it fits neither after it nor under it", async () => {
      start("answer", { auto: false });
      replies.solve.push({ events: [SOLVED] });
      await penLine("3x+24=", "3x+24=", 200, 1360);
      const other = await penLine("x=3", "y=3", 270, 1360);
      loop.noteAsked();
      loop.requestSolve();
      await wait(1000);
      expect(work()).toEqual(["3x+24 = 3(x+8)"]);
      expect(whereIs("3x+24 = 3(x+8)").y).toBeGreaterThan(bounds(other).y + bounds(other).h);
    });
  });
});
