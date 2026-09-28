import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { TLShape } from "tldraw";
import { createFakeEditor, type FakeEditor } from "../__fixtures__/fakeEditor";
import { writeLine as inkLine } from "../__fixtures__/strokes";
import { settle, settleStable, settleUntil } from "@/lib/live/__fixtures__/settle";
import { useSyncHash } from "@/lib/live/__fixtures__/syncHash";
import { isLiveMeta, LIVE_TIMING, type HelpMode, type LiveEngine, type LiveSseEvent, type RecognizeRequest, type RecognizeResponse } from "../contracts";
import { getEngine } from "../engine";
import { handBlockOf, handLinesOf } from "../handwriting";
import { createLiveLoop, type LiveLoop, type LiveLoopDeps } from "../liveLoop";
import { liveStore, resetLiveStore } from "../liveStore";
import { RecognizeClient, type FetchJson } from "../recognizeClient";
import { DEFAULT_SCREEN } from "@/lib/screens/screens";
import { problemMetaOf } from "../chat/cells";
import type { ChatAction, ChatRunReport } from "../chat/contracts";
import { PROBLEM_WORK_META } from "../chat/work";
import { analyzeColumn } from "../localSolve";

/**
 * The tutor works the problems it wrote. A student with nothing under `1. 2\sin x = 1` who presses
 * Solve steps, moves the dial to Solve or Suggest, or taps Help gets the problem worked — or its
 * next step written — under it, in the tutor's hand, by the engine: one problem at a time, never
 * twice, inside the problem's cell and clear of everything there.
 */

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

describe("live loop — the tutor works the problems it wrote", () => {
  useSyncHash();

  let editor: FakeEditor;
  let fetchJson: Mock<FetchJson>;
  let loop: LiveLoop;
  let script: string[];
  let assigned: Map<string, string>;
  let streamCalls: string[];
  let mode: HelpMode;

  function start(m: HelpMode = "feedback", deps: Partial<LiveLoopDeps> = {}): void {
    mode = m;
    loop = createLiveLoop(
      editor,
      { boardId: "board-1", mode, enabled: true },
      {
        recognizer: new RecognizeClient({ fetchJson }),
        stream: async function* (path: string): AsyncGenerator<LiveSseEvent, void, undefined> {
          streamCalls.push(path);
        },
        getEngine: async () => engine,
        fetchCapabilities: async () => ({ recognizer: "mathpix", liveEnabled: true, models: { check: "c", solve: "s", vision: "v" } }),
        events: null,
        isOnline: () => true,
        handwritingEnabled: () => true,
        reducedMotion: () => true,
        ...deps,
      },
    );
    loop.start();
  }

  async function run(actions: ChatAction[]): Promise<ChatRunReport> {
    let result: ChatRunReport | null = null;
    let error: unknown = null;
    loop.runChatActions(actions).then(
      (r) => (result = r),
      (e) => (error = e),
    );
    for (let i = 0; i < 400 && !result && !error; i++) await vi.advanceTimersByTimeAsync(50);
    if (error) throw error;
    if (!result) throw new Error("the chat never finished");
    return result;
  }

  /** Writes `ink` at (x, y), read back as `latex`; resolves with the new line's id once analysed. */
  async function penLine(ink: string, x: number, y: number, latex: string): Promise<string> {
    script.push(latex);
    const before = new Set(Object.keys(liveStore.lines.get()));
    editor.putUser(inkLine(ink, x, y, 40));
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.quietMs + 300);
    await settleUntil(() => Object.entries(liveStore.lines.get()).some(([id, st]) => !before.has(id) && Boolean(st.analysis)));
    const added = Object.keys(liveStore.lines.get()).find((id) => !before.has(id));
    if (!added) throw new Error(`${ink} produced no line`);
    return added;
  }

  /** Lets the tutor's writing land (live writes are queued on microtasks). */
  async function landed(): Promise<void> {
    await settle();
    await settleStable(() => String(editor.getCurrentPageShapes().length));
  }

  async function pressSolve(): Promise<void> {
    loop.requestSolve();
    await landed();
  }

  async function help(): Promise<void> {
    loop.requestHelp();
    await landed();
  }

  async function dial(to: HelpMode): Promise<void> {
    mode = to;
    loop.setOptions({ boardId: "board-1", mode: to, enabled: true });
    await landed();
  }

  const tutor = (): TLShape[] => editor.getCurrentPageShapes().filter((s) => isLiveMeta(s.meta) && s.meta.source === "ai");
  const meta = (s: TLShape) => s.meta as Record<string, unknown>;
  const problemInk = (n: number) => tutor().filter((s) => problemMetaOf(s.meta)?.n === n);
  const cellOf = (n: number) => problemMetaOf(problemInk(n)[0].meta)!.cell;
  /** the tutor's work under problem n, block by block, each as its written lines */
  const workOn = (n: number) => {
    const key = handBlockOf(problemInk(n)[0].meta);
    const mine = tutor().filter((s) => s.meta.lineId === `problem:${key}` && meta(s)[PROBLEM_WORK_META]);
    const blocks = new Map<string, TLShape[]>();
    for (const s of mine) blocks.set(handBlockOf(s.meta), [...(blocks.get(handBlockOf(s.meta)) ?? []), s]);
    return [...blocks.values()]
      .sort((a, b) => Math.min(...a.map((s) => s.y)) - Math.min(...b.map((s) => s.y)))
      .map((shapes) => ({ kind: String(meta(shapes[0])[PROBLEM_WORK_META]), lines: handLinesOf(shapes), shapes }));
  };
  const box = (shapes: TLShape[]) => {
    const bs = shapes.map((s) => editor.getShapePageBounds(s)!);
    return { x: Math.min(...bs.map((b) => b.x)), y: Math.min(...bs.map((b) => b.y)), r: Math.max(...bs.map((b) => b.maxX)), b: Math.max(...bs.map((b) => b.maxY)) };
  };
  const overlaps = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) => a.x < b.r && a.r > b.x && a.y < b.b && a.b > b.y;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    resetLiveStore();
    editor = createFakeEditor();
    const page = editor.getCurrentPage();
    editor.store.put([{ ...page, meta: { screen: { ...DEFAULT_SCREEN } } }]);
    script = [];
    streamCalls = [];
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
  });

  afterEach(() => {
    loop?.stop();
    vi.useRealTimers();
  });

  describe("Solve steps with only the tutor's problem on the screen", () => {
    it("works it out under it, in its cell: the engine's steps, by hand, no model", async () => {
      start("answer");
      await run([{ type: "write_problems", problems: [["2\\sin x = 1"]] }]);
      await pressSolve();
      const work = workOn(1);
      expect(work).toHaveLength(1);
      expect(work[0].kind).toBe("solution");
      // the engine's worked solution, without writing the problem out again under it
      expect(work[0].lines).toEqual([
        "0^{\\circ} \\le x < 360^{\\circ}",
        "\\sin x = \\frac{1}{2}",
        "\\sin^{-1}\\left(\\frac{1}{2}\\right) = 30^{\\circ}",
        "x = 30^{\\circ}, \\ x = 180^{\\circ} - 30^{\\circ}",
        "x = 30^{\\circ}, \\ x = 150^{\\circ}",
      ]);
      expect(meta(work[0].shapes[0]).solvedLatex).toBe("2\\sin x = 1");
      expect(streamCalls).toEqual([]);
      // under the problem, inside its cell, over nothing
      const cell = cellOf(1);
      const written = box(work[0].shapes);
      const problem = box(problemInk(1));
      expect(written.y).toBeGreaterThan(problem.b);
      expect(written.x).toBeGreaterThanOrEqual(cell.x);
      expect(written.r).toBeLessThanOrEqual(cell.x + cell.w);
      expect(written.b).toBeLessThanOrEqual(cell.y + cell.h);
      expect(overlaps(written, problem)).toBe(false);
      // every line of it checks out under the problem, as the engine sees it
      expect(analyzeColumn(engine, ["2\\sin x = 1", "\\sin x = \\frac{1}{2}"], "answer")[1]?.verdict).toBe("ok");
    });

    it("pressed again: nothing twice — the next problem, then nothing", async () => {
      start("answer");
      await run([{ type: "write_problems", problems: [["2x + 3 = 11"], ["3x = 12"]] }]);
      await pressSolve();
      expect(workOn(1).map((w) => w.lines)).toEqual([["2x = 8", "x = 4"]]);
      expect(workOn(2)).toEqual([]);
      await pressSolve();
      expect(workOn(1)).toHaveLength(1);
      expect(workOn(2).map((w) => w.lines)).toEqual([["x = 4"]]);
      const count = tutor().length;
      await pressSolve();
      expect(tutor()).toHaveLength(count);
    });

    it("after a reload it is still solved: pressing again does not write it again", async () => {
      start("answer");
      await run([{ type: "write_problems", problems: [["2x + 3 = 11"]] }]);
      await pressSolve();
      const count = tutor().length;
      loop.stop();
      resetLiveStore();
      start("answer");
      await landed();
      await pressSolve();
      expect(tutor()).toHaveLength(count);
      expect(workOn(1)).toHaveLength(1);
    });

    it("a lone 2 under the problem is not work to continue: the problem is worked, clear of it", async () => {
      start("answer");
      await run([{ type: "write_problems", problems: [["2x + 3 = 11"]] }]);
      const two = await penLine("2", 120, 170, "2");
      await pressSolve();
      expect(workOn(1).map((w) => w.lines)).toEqual([["2x = 8", "x = 4"]]);
      const ink = liveStore.lines.get()[two].line.bounds;
      expect(overlaps(box(workOn(1)[0].shapes), { x: ink.x, y: ink.y, r: ink.x + ink.w, b: ink.y + ink.h })).toBe(false);
    });

    it("with the student's own work under it, Solve continues from their line as it always has", async () => {
      start("answer");
      await run([{ type: "write_problems", problems: [["2x + 3 = 11"]] }]);
      const line = await penLine("2x=8", 100, 200, "2x=8");
      await pressSolve();
      expect(workOn(1)).toEqual([]);
      const solution = tutor().filter((s) => s.meta.lineId === line && meta(s).solvedLatex);
      expect(handLinesOf(solution)).toEqual(["x = 4"]);
    });
  });

  describe("the dial", () => {
    it("moved to Solve: the current problem is worked out — only that one, and only once", async () => {
      start("feedback");
      await run([{ type: "write_problems", problems: [["2x + 3 = 11"], ["3x = 12"], ["4x + 4 = 12"], ["x + 8 = 12"]] }]);
      expect(workOn(1)).toEqual([]);
      await dial("answer");
      expect(workOn(1).map((w) => [w.kind, w.lines])).toEqual([["solution", ["2x = 8", "x = 4"]]]);
      for (const n of [2, 3, 4]) expect(workOn(n)).toEqual([]);
      expect(streamCalls).toEqual([]);
      // not on load: a board opened in Solve writes nothing
      loop.stop();
      resetLiveStore();
      const count = tutor().length;
      start("answer");
      await landed();
      await vi.advanceTimersByTimeAsync(3000);
      await landed();
      expect(tutor()).toHaveLength(count);
      expect(workOn(1)).toHaveLength(1);
    });

    it("moved to Solve with the student's work under the current problem: nothing new", async () => {
      start("feedback");
      await run([{ type: "write_problems", problems: [["2x + 3 = 11"], ["3x = 12"]] }]);
      await penLine("2x=8", 100, 200, "2x=8");
      const count = tutor().length;
      await dial("answer");
      expect(workOn(1)).toEqual([]);
      expect(workOn(2)).toEqual([]);
      expect(tutor()).toHaveLength(count);
    });

    it("moved to Suggest: the first step where the student would write — once", async () => {
      start("feedback");
      await run([{ type: "write_problems", problems: [["2\\sin x = 1"]] }]);
      await dial("suggest");
      expect(workOn(1).map((w) => [w.kind, w.lines])).toEqual([["step", ["\\sin x = \\frac{1}{2}"]]]);
      expect(streamCalls).toEqual([]);
      await dial("feedback");
      await dial("suggest");
      expect(workOn(1)).toHaveLength(1);
      // Solve from there writes the rest under it, not the step again
      await dial("answer");
      expect(workOn(1).map((w) => [w.kind, w.lines])).toEqual([
        ["step", ["\\sin x = \\frac{1}{2}"]],
        ["solution", ["\\sin^{-1}\\left(\\frac{1}{2}\\right) = 30^{\\circ}", "x = 30^{\\circ}, \\ x = 180^{\\circ} - 30^{\\circ}", "x = 30^{\\circ}, \\ x = 150^{\\circ}"]],
      ]);
    });
  });

  describe("Help", () => {
    it("in Feedback with no line of the student's: the first step, then the next, then nothing more", async () => {
      start("feedback");
      await run([{ type: "write_problems", problems: [["2x + 3 = 11"]] }]);
      await help();
      expect(workOn(1).map((w) => [w.kind, w.lines])).toEqual([["step", ["2x = 8"]]]);
      await help();
      expect(workOn(1).map((w) => w.lines)).toEqual([["2x = 8"], ["x = 4"]]);
      // each step under the last, in the cell
      const [a, b] = workOn(1).map((w) => box(w.shapes));
      expect(b.y).toBeGreaterThan(a.b);
      const count = tutor().length;
      await help();
      expect(tutor()).toHaveLength(count);
      expect(streamCalls).toEqual([]);
    });

    it("in Solve: the problem worked out", async () => {
      start("answer");
      await run([{ type: "write_problems", problems: [["3x = 12"]] }]);
      await help();
      expect(workOn(1).map((w) => [w.kind, w.lines])).toEqual([["solution", ["x = 4"]]]);
    });

    it("the student's line under the tutor's first step is still checked against the problem", async () => {
      start("feedback");
      await run([{ type: "write_problems", problems: [["2x + 3 = 11"]] }]);
      await help();
      const step = box(workOn(1)[0].shapes);
      const line = await penLine("x=4", 100, Math.round(step.b + 40), "x=4");
      await settleStable(() => String(tutor().length));
      expect(liveStore.lines.get()[line].analysis).toMatchObject({ verdict: "ok", solved: true });
      const marks = tutor().filter((s) => s.meta.lineId === line && meta(s).mark).map((s) => String(meta(s).mark).split(":")[0]);
      expect(marks).toEqual(["check"]);
    });
  });
});
