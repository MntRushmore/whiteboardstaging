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
  /** what the recognizer answers next, whichever line it is (null: each line keeps its first read) */
  let nextRead: string | null;
  let confidence: number;

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
    nextRead = null;
    confidence = 0.97;
    fetchJson = vi.fn<FetchJson>(async (_path, body): Promise<RecognizeResponse> => {
      const { lineId } = body as RecognizeRequest;
      let latex = assigned.get(lineId);
      if (nextRead !== null) {
        // the student rewrote a line: this read is the new one
        latex = nextRead;
        nextRead = null;
        assigned.set(lineId, latex);
      } else if (latex === undefined) {
        latex = script[assigned.size] ?? "\\Delta";
        assigned.set(lineId, latex);
      }
      return { latex, text: "", kind: "math", confidence, provider: "mathpix", ms: 300 };
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

  describe("no silent lines under a problem", () => {
    const marksOf = (lineId: string) => tutor().filter((s) => s.meta.lineId === lineId && meta(s).mark);
    const kinds = (lineId: string) => [...new Set(marksOf(lineId).map((s) => String(meta(s).mark).split(":")[0]))];
    /** the student stops writing: the canvas settle (2.5 s) runs out */
    async function stop(): Promise<void> {
      await vi.advanceTimersByTimeAsync(3000);
      await landed();
    }

    it("a lone 2 under the problem gets the tutor's ? once the student stops — not before", async () => {
      start("feedback");
      await run([{ type: "write_problems", problems: [["2x + 3 = 11"]] }]);
      const two = await penLine("2", 120, 170, "2");
      await landed();
      expect(liveStore.lines.get()[two].latex).toBe("2");
      expect(kinds(two)).toEqual([]);
      await stop();
      expect(kinds(two)).toEqual(["question"]);
      // why, for the onboarding's first coach mark: there is nothing in it to check
      expect(new Set(marksOf(two).map((s) => meta(s).markWhy))).toEqual(new Set(["unjudged"]));
      expect(streamCalls).toEqual([]);
    });

    it("in Suggest and Solve too; never in Off", async () => {
      for (const m of ["suggest", "answer", "off"] as const) {
        loop?.stop();
        resetLiveStore();
        editor = createFakeEditor();
        editor.store.put([{ ...editor.getCurrentPage(), meta: { screen: { ...DEFAULT_SCREEN } } }]);
        assigned = new Map();
        script = [];
        start(m);
        await run([{ type: "write_problems", problems: [["3x = 12"]] }]);
        const two = await penLine("2", 120, 170, "2");
        await stop();
        expect(kinds(two), m).toEqual(m === "off" ? [] : ["question"]);
      }
    });

    it("the same lone 2 on a blank board stays silent: a label or a scratch number is the student's own", async () => {
      start("feedback");
      const two = await penLine("2", 120, 170, "2");
      await stop();
      expect(kinds(two)).toEqual([]);
      expect(tutor()).toEqual([]);
    });

    it("rewritten into a step the tutor can judge, the ? gives way to the tick", async () => {
      start("feedback");
      await run([{ type: "write_problems", problems: [["2x + 3 = 11"]] }]);
      const two = await penLine("2", 100, 200, "2");
      await stop();
      expect(kinds(two)).toEqual(["question"]);
      const first = liveStore.lines.get()[two].line.strokeIds[0];
      // the student writes on: the same line now reads 2x=8
      nextRead = "2x=8";
      const x0 = liveStore.lines.get()[two].line.bounds.x + liveStore.lines.get()[two].line.bounds.w + 12;
      editor.putUser(inkLine("x=8", x0, 200, 40));
      await vi.advanceTimersByTimeAsync(LIVE_TIMING.quietMs + 300);
      await settleUntil(() => Object.values(liveStore.lines.get()).some((s) => s.line.strokeIds.includes(first) && s.latex === "2x=8"));
      await landed();
      const line = Object.values(liveStore.lines.get()).find((s) => s.line.strokeIds.includes(first))!;
      expect(line.analysis?.verdict).toBe("ok");
      expect(kinds(line.line.id)).toEqual(["check"]);
      expect(tutor().filter((s) => String(meta(s).mark ?? "").startsWith("question:"))).toEqual([]);
    });

    it("a read the recognizer was unsure of: a ? that asks for clearer writing", async () => {
      start("feedback");
      await run([{ type: "write_problems", problems: [["2x + 3 = 11"]] }]);
      confidence = 0.3;
      const line = await penLine("2x=8", 100, 200, "2x=8");
      await stop();
      expect(kinds(line)).toEqual(["question"]);
      expect(new Set(marksOf(line).map((s) => meta(s).markWhy))).toEqual(new Set(["unread"]));
    });

    it("a line the tutor judges gets its tick, never a ?", async () => {
      start("feedback");
      await run([{ type: "write_problems", problems: [["2x + 3 = 11"]] }]);
      const line = await penLine("2x=8", 100, 200, "2x=8");
      await stop();
      expect(kinds(line)).toEqual(["check"]);
    });
  });

  describe("Ask: help with a problem on the board (help_problem)", () => {
    /** the owner's screen: three trig equations, each with its interval on the same line */
    const TRIG = [["2\\cos x = 1, 0^{\\circ} \\le x < 360^{\\circ}"], ["\\tan x = \\sqrt{3}, 0^{\\circ} \\le x < 360^{\\circ}"], ["\\sin x = -\\frac{1}{2}, 0^{\\circ} \\le x < 360^{\\circ}"]];

    it("'help me with 3', then 'solve it': a step under problem 3, then the rest — the engine's working, no model", async () => {
      start("answer");
      await run([{ type: "write_problems", problems: TRIG }]);
      const help = await run([{ type: "help_problem", problem: 3, depth: "step" }]);
      expect(help.outcomes).toEqual([{ type: "help_problem", ok: true }]);
      expect(workOn(3).map((w) => [w.kind, w.lines])).toEqual([["step", ["\\sin^{-1}\\left(\\frac{1}{2}\\right) = 30^{\\circ}"]]]);
      const solve = await run([{ type: "help_problem", problem: 3, depth: "solve" }]);
      expect(solve.outcomes).toEqual([{ type: "help_problem", ok: true }]);
      expect(workOn(3).map((w) => [w.kind, w.lines])).toEqual([
        ["step", ["\\sin^{-1}\\left(\\frac{1}{2}\\right) = 30^{\\circ}"]],
        ["solution", ["x = 180^{\\circ} + 30^{\\circ}, \\ x = 360^{\\circ} - 30^{\\circ}", "x = 210^{\\circ}, \\ x = 330^{\\circ}"]],
      ]);
      // the others untouched, nothing asked of a model, all of it inside problem 3's cell
      expect(workOn(1)).toEqual([]);
      expect(workOn(2)).toEqual([]);
      expect(streamCalls).toEqual([]);
      const cell = cellOf(3);
      for (const w of workOn(3)) {
        const b = box(w.shapes);
        expect(b.x).toBeGreaterThanOrEqual(cell.x);
        expect(b.r).toBeLessThanOrEqual(cell.x + cell.w);
        expect(b.b).toBeLessThanOrEqual(cell.y + cell.h);
        expect(overlaps(b, box(problemInk(3)))).toBe(false);
      }
      // asked again: nothing left to write, and the panel says so
      const again = await run([{ type: "help_problem", problem: 3, depth: "solve" }]);
      expect(again.outcomes).toEqual([{ type: "help_problem", ok: false, note: "Problem 3 is already worked out on the board." }]);
    });

    it("each of the three is worked to its answers in the interval: 60°, 300° / 60°, 240° / 210°, 330°", async () => {
      start("feedback");
      await run([{ type: "write_problems", problems: TRIG }]);
      await run([1, 2, 3].map((problem) => ({ type: "help_problem" as const, problem, depth: "solve" as const })));
      const answers = [1, 2, 3].map((n) => workOn(n)[0]?.lines.at(-1));
      expect(answers).toEqual(["x = 60^{\\circ}, \\ x = 300^{\\circ}", "x = 60^{\\circ}, \\ x = 240^{\\circ}", "x = 210^{\\circ}, \\ x = 330^{\\circ}"]);
    });

    it("a problem that is not on the screen: nothing written, and the panel says there is none", async () => {
      start("feedback");
      await run([{ type: "write_problems", problems: TRIG }]);
      const count = tutor().length;
      const report = await run([{ type: "help_problem", problem: 7, depth: "step" }]);
      expect(report.outcomes).toEqual([{ type: "help_problem", ok: false, note: "There's no problem 7 on this screen." }]);
      expect(tutor()).toHaveLength(count);
    });

    it("with the student's work under it: the next step from their line, as Help gives it", async () => {
      start("feedback");
      await run([{ type: "write_problems", problems: [["2x + 3 = 11"], ["3x = 12"]] }]);
      const line = await penLine("2x=8", 100, 200, "2x=8");
      await run([{ type: "help_problem", problem: 1, depth: "step" }]);
      expect(workOn(1)).toEqual([]);
      const next = tutor().filter((s) => s.meta.lineId === line && !meta(s).mark);
      expect(handLinesOf(next)).toEqual(["x = 4"]);
    });

    it("the student's lines under an interval problem get their marks: a wrong angle ringed, the answer ticked", async () => {
      start("feedback");
      await run([{ type: "write_problems", problems: TRIG }]);
      const cell = cellOf(3);
      const x0 = Math.round(cell.x + 40);
      const wrong = await penLine("x=4", x0, Math.round(cell.y + 110), "x = 50^{\\circ}");
      const right = await penLine("x=2", x0, Math.round(cell.y + 200), "x = 210^{\\circ}, 330^{\\circ}");
      await settleStable(() => String(tutor().length));
      const lines = liveStore.lines.get();
      expect(lines[wrong].analysis?.verdict).toBe("mismatch");

      expect(lines[right].analysis).toMatchObject({ verdict: "ok", solved: true });
      const kinds = (id: string) => [...new Set(tutor().filter((s) => s.meta.lineId === id && meta(s).mark).map((s) => String(meta(s).mark).split(":")[0]))];
      expect(kinds(wrong)).toEqual(["circle"]);
      expect(kinds(right)).toEqual(["check"]);
    });

    it("an angle outside the interval is ringed; one of the two answers is ticked, not solved", async () => {
      start("feedback");
      await run([{ type: "write_problems", problems: TRIG }]);
      const cell = cellOf(1);
      const outside = await penLine("x=4", Math.round(cell.x + 40), Math.round(cell.y + 110), "x = 420^{\\circ}");
      const one = await penLine("x=2", Math.round(cell.x + 40), Math.round(cell.y + 200), "x = 60^{\\circ}");
      const lines = liveStore.lines.get();
      expect(lines[outside].analysis?.verdict).toBe("mismatch");
      expect(lines[one].analysis).toMatchObject({ verdict: "ok", solved: false });
    });

    it("Solve from the student's step under a problem in radians: worked in its interval, in radians", async () => {
      start("answer");
      await run([{ type: "write_problems", problems: [["2\\cos x = 1, \\ 0 \\le x < 2\\pi"]] }]);
      const step = await penLine("x=4", 100, 200, "\\cos x = \\frac{1}{2}");
      expect(liveStore.lines.get()[step].analysis?.verdict).toBe("ok");
      await pressSolve();
      const written = handLinesOf(tutor().filter((s) => s.meta.lineId === step && meta(s).solvedLatex));
      expect(written.at(-1)).toBe("x = \\frac{\\pi}{3}, \\ x = \\frac{5\\pi}{3}");
      expect(written).not.toContain("0^{\\circ} \\le x < 360^{\\circ}");
    });

    it("a typed ask is answered whatever the dial says, Off included", async () => {
      start("off");
      await run([{ type: "write_problems", problems: [["3x = 12"]] }]);
      await run([{ type: "help_problem", problem: 1, depth: "solve" }]);
      expect(workOn(1).map((w) => w.lines)).toEqual([["x = 4"]]);
    });
  });
  describe("an ask while the tutor is writing a problem's work", () => {
    /** the tutor's hand at its real pace: its work is in flight until the clock moves on */
    const motion = { reducedMotion: () => false };
    /** lets every line in flight be written out */
    async function writeOut(): Promise<void> {
      for (let i = 0; i < 60; i++) await vi.advanceTimersByTimeAsync(500);
      await landed();
    }
    const at = (n: number) => {
      const t = liveStore.helpTarget.get();
      return t !== null && overlaps({ x: t.bounds.x, y: t.bounds.y, r: t.bounds.x + t.bounds.w, b: t.bounds.y + t.bounds.h }, box(problemInk(n)));
    };

    it("Solve it while Auto writes problem 1: problem 1 is finished whole, problem 2 waits for the next ask", async () => {
      start("feedback", motion);
      await run([{ type: "write_problems", problems: [["2x + 3 = 11"], ["3x = 12"]] }]);
      await writeOut();
      // the dial to Solve: Auto works problem 1 — still being written when the student taps Solve it
      mode = "answer";
      loop.setOptions({ boardId: "board-1", mode: "answer", enabled: true });
      await settle();
      await vi.advanceTimersByTimeAsync(300);
      loop.requestSolve();
      await settle();
      await writeOut();
      expect(workOn(1).map((w) => w.lines)).toEqual([["2x = 8", "x = 4"]]);
      expect(workOn(2)).toEqual([]);
      // the next ask is the next problem
      loop.requestSolve();
      await writeOut();
      expect(workOn(2).map((w) => w.lines)).toEqual([["x = 4"]]);
    });

    it("Help me in Feedback while the tutor writes problem 1's step: no step of problem 2 meanwhile", async () => {
      start("feedback", motion);
      await run([{ type: "write_problems", problems: [["2x + 3 = 11"], ["3x = 12"]] }]);
      await writeOut();
      loop.requestHelp();
      await settle();
      await vi.advanceTimersByTimeAsync(300);
      expect(loop.requestHelp()).toBe(true);
      await writeOut();
      expect(workOn(1).map((w) => w.lines)).toEqual([["2x = 8"]]);
      expect(workOn(2)).toEqual([]);
    });

    it("the outline is around the problem being worked, and moves on quietly once it is done", async () => {
      start("answer", motion);
      await run([{ type: "write_problems", problems: [["2x + 3 = 11"], ["3x = 12"], ["4x + 4 = 12"]] }]);
      await writeOut();
      // problem 1 worked first (the earlier ask), then Solve it: problem 2 is the one being written
      loop.requestSolve();
      await writeOut();
      expect(workOn(1)).toHaveLength(1);
      expect(at(2)).toBe(true);
      const changedAt = liveStore.helpTarget.get()!.changedAt;
      loop.requestSolve();
      await settle();
      await vi.advanceTimersByTimeAsync(300);
      expect(workOn(2)).toHaveLength(1);
      expect(at(2)).toBe(true);
      await writeOut();
      // done: the next ask's problem, without the flash a student's own move gives
      expect(at(3)).toBe(true);
      expect(liveStore.helpTarget.get()!.changedAt).toBe(changedAt);
    });
  });
});
