import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { TLShape } from "tldraw";
import { createFakeEditor, type FakeEditor } from "../__fixtures__/fakeEditor";
import { writeLine as inkLine } from "../__fixtures__/strokes";
import { settleStable, settleUntil } from "@/lib/live/__fixtures__/settle";
import { useSyncHash } from "@/lib/live/__fixtures__/syncHash";
import { isLiveMeta, LIVE_TIMING, type HelpMode, type LiveEngine, type LiveSseEvent, type RecognizeRequest, type RecognizeResponse } from "../contracts";
import { getEngine } from "../engine";
import { handBlockOf, handLinesOf, planHandwriting } from "../handwriting";
import { createLiveLoop, type LiveLoop, type LiveLoopDeps } from "../liveLoop";
import { liveStore, resetLiveStore } from "../liveStore";
import { RecognizeClient, type FetchJson } from "../recognizeClient";
import { DEFAULT_SCREEN } from "@/lib/screens/screens";
import { CHAT_PROBLEM_META, problemMetaOf } from "../chat/cells";
import type { ChatAction, ChatRunReport } from "../chat/contracts";
import { CHAT_BLOCK_META } from "../chat/desk";
import { PROBE_FIGURE } from "../chat/figure";
import { LINEAR_TEACH, OWNER_FIGURE, OWNER_TEACH } from "../chat/__tests__/teachFixtures";

/**
 * The board chat's hand in the loop: a reply's actions written one block at a time, problems the
 * engine checked first, laid out in a grid on an empty (or a new) screen — and a student solving
 * a problem the tutor wrote gets the same ticks and rings as on a problem of their own, because the
 * problem is the first line of the column they work under it.
 */

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
  // the writers the desk loads on first use: loaded now, so a fake clock never waits on the import
  await import("../chat/teachWrite");
});

describe("live loop — the board chat", () => {
  useSyncHash();

  let editor: FakeEditor;
  let fetchJson: Mock<FetchJson>;
  let loop: LiveLoop;
  let script: string[];
  let assigned: Map<string, string>;
  let streamCalls: string[];

  function start(mode: HelpMode = "feedback", deps: Partial<LiveLoopDeps> = {}): void {
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

  /** Runs a reply's actions and turns the clock until they are all on the page. */
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

  const shapes = (): TLShape[] => editor.getCurrentPageShapes();
  const tutor = (): TLShape[] => shapes().filter((s) => isLiveMeta(s.meta) && s.meta.source === "ai");
  const problems = () => {
    const byBlock = new Map<string, { n: number; lines: string[]; written: string[]; cell: { x: number; y: number; w: number; h: number } }>();
    for (const s of tutor()) {
      const p = problemMetaOf(s.meta);
      if (!p) continue;
      const block = handBlockOf(s.meta);
      // the number sits on the problem's writing line, so its ink starts lower: sorted, not in page order
      if (!byBlock.has(block)) byBlock.set(block, { ...p, written: handLinesOf(tutor().filter((t) => handBlockOf(t.meta) === block)).sort() });
    }
    return [...byBlock.values()].sort((a, b) => a.n - b.n);
  };
  const marksOf = (lineId: string) => tutor().filter((s) => s.meta.lineId === lineId && (s.meta as Record<string, unknown>).mark).map((s) => String((s.meta as Record<string, unknown>).mark).split(":")[0]);

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

  describe("problems", () => {
    it("an empty screen: the problems are written on it, numbered, one block each, in a grid", async () => {
      start();
      const report = await run([{ type: "write_problems", problems: [["2x + 3 = 11"], ["5x - 2 = 13"], ["x^{2} + 5x + 6"], ["x + y = 10", "x - y = 2"]] }]);
      expect(report).toMatchObject({ problemsWritten: 4, problemsDropped: 0, screensAdded: 0 });
      expect(report.outcomes).toEqual([{ type: "write_problems", ok: true }]);
      expect(editor.getPages()).toHaveLength(1);
      const ps = problems();
      expect(ps.map((p) => p.n)).toEqual([1, 2, 3, 4]);
      expect(ps.map((p) => p.written)).toEqual([
        ["1.", "2x + 3 = 11"],
        ["2.", "5x - 2 = 13"],
        ["3.", "x^{2} + 5x + 6"],
        ["4.", "x + y = 10", "x - y = 2"],
      ]);
      // the number is left of its problem, on the same line
      const one = tutor().filter((s) => problemMetaOf(s.meta)?.n === 1);
      const numberInk = one.filter((s) => (s.meta as Record<string, unknown>).handLine === "1.").map((s) => editor.getShapePageBounds(s)!);
      const bodyInk = one.filter((s) => (s.meta as Record<string, unknown>).handLine !== "1.").map((s) => editor.getShapePageBounds(s)!);
      expect(Math.max(...numberInk.map((b) => b.x + b.w))).toBeLessThan(Math.min(...bodyInk.map((b) => b.x)));
      expect(Math.abs(Math.max(...numberInk.map((b) => b.y + b.h)) - Math.max(...bodyInk.map((b) => b.y + b.h)))).toBeLessThan(8);
      // 2 × 2, reading order, inside the screen
      const [a, b, c, d] = ps.map((p) => p.cell);
      expect(b.x).toBeGreaterThan(a.x);
      expect(b.y).toBe(a.y);
      expect(c.y).toBeGreaterThan(a.y);
      expect(d.x).toBe(b.x);
      for (const cell of [a, b, c, d]) {
        expect(cell.x).toBeGreaterThanOrEqual(0);
        expect(cell.x + cell.w).toBeLessThanOrEqual(1600);
        expect(cell.y + cell.h).toBeLessThanOrEqual(900);
      }
      // each problem's ink sits at the top of its own cell
      for (const p of ps) {
        const ink = tutor().filter((s) => problemMetaOf(s.meta)?.n === p.n);
        for (const s of ink) {
          const bb = editor.getShapePageBounds(s)!;
          expect(bb.x).toBeGreaterThanOrEqual(p.cell.x);
          expect(bb.x + bb.w).toBeLessThanOrEqual(p.cell.x + p.cell.w);
          expect(bb.y).toBeLessThan(p.cell.y + 120);
        }
      }
    });

    it("a problem the engine cannot solve is left out and said so; the rest are numbered on", async () => {
      start();
      const report = await run([{ type: "write_problems", problems: [["2x + 3 = 11"], ["y = 2x - 5"], ["2 + 2 = 5"], ["3x = 12"]] }]);
      expect(report).toMatchObject({ problemsWritten: 2, problemsDropped: 2 });
      expect(report.outcomes[0].note).toBe("2 of 4 problems couldn't be checked, so I left them out.");
      // why, for the report: the engine's commonest reason (`y = 2x - 5` cannot be solved, `2 + 2 = 5` is false: the first)
      expect(report.outcomes[0].why).toBe("unsolved");
      expect(problems().map((p) => p.written)).toEqual([
        ["1.", "2x + 3 = 11"],
        ["2.", "3x = 12"],
      ]);
    });

    it("none checks out: nothing is written", async () => {
      start();
      const report = await run([{ type: "write_problems", problems: [["y = 2x - 5"]] }]);
      expect(report.outcomes).toEqual([{ type: "write_problems", ok: false, note: "I couldn't check that problem, so I didn't write it.", why: "unsolved" }]);
      expect(tutor()).toEqual([]);
    });

    it("a screen with work on it keeps it: the problems go on a new screen", async () => {
      start();
      await penLine("2x=8", 100, 200, "2x=8");
      const first = editor.getCurrentPage().id;
      const report = await run([{ type: "write_problems", problems: [["2x + 3 = 11"], ["3x = 12"]] }]);
      expect(report.screensAdded).toBe(1);
      expect(editor.getPages()).toHaveLength(2);
      expect(editor.getCurrentPage().id).not.toBe(first);
      expect(problems()).toHaveLength(2);
    });

    it("with the hand animated: every problem on a new screen, then the graph on the next (the problems fill theirs), one block after another", async () => {
      start("feedback", { reducedMotion: () => false });
      await penLine("2x=8", 100, 200, "2x=8");
      const report = await run([{ type: "write_problems", problems: [["2x + 3 = 11"], ["3x = 12"]] }, { type: "graph", relations: ["y = x^{2}"] }]);
      expect(report).toMatchObject({ problemsWritten: 2, screensAdded: 2 });
      expect(tutor().filter((s) => (s.meta as Record<string, unknown>)[CHAT_BLOCK_META] === "graph").length).toBeGreaterThan(20);
      editor.switchPage(editor.getPages()[1].id);
      expect(problems().map((p) => p.n)).toEqual([1, 2]);
    });

    it("more than six spill onto more screens, spread evenly and numbered on", async () => {
      start();
      const set = ["x + 1 = 2", "x + 2 = 4", "x + 3 = 6", "x + 4 = 8", "2x = 4", "2x = 6", "2x = 8", "2x = 10"].map((l) => [l]);
      const report = await run([{ type: "write_problems", problems: set }]);
      expect(report).toMatchObject({ problemsWritten: 8, screensAdded: 1 });
      expect(problems().map((p) => p.n)).toEqual([5, 6, 7, 8]);
      // the request names them as numbered on the board: "help me with 7"
      expect(loop.chatScreen().numbers).toEqual([5, 6, 7, 8]);
      editor.switchPage(editor.getPages()[0].id);
      expect(problems().map((p) => p.n)).toEqual([1, 2, 3, 4]);
    });

    it("the screen picture names the problems, the student's lines and whether it is empty", async () => {
      start();
      expect(loop.chatScreen()).toEqual({ empty: true, student: [], tutor: [], problems: [] });
      await run([{ type: "write_problems", problems: [["2x + 3 = 11"], ["x + y = 10", "x - y = 2"]] }]);
      await penLine("2x=8", 100, 200, "2x=8");
      expect(loop.chatScreen()).toEqual({ empty: false, student: ["2x=8"], tutor: [], problems: ["2x + 3 = 11", "x + y = 10; x - y = 2"], numbers: [1, 2] });
    });
  });

  describe("checking work under a problem the tutor wrote", () => {
    /** four problems in a 2 × 2 grid: cell 1 is x 48–800, y 72–472; cell 3 is under it */
    async function grid(mode: HelpMode = "feedback"): Promise<void> {
      start(mode);
      await run([{ type: "write_problems", problems: [["2x + 3 = 11"], ["3x = 12"], ["4x + 4 = 12"], ["x + 8 = 12"]] }]);
    }

    it("a right first step under problem 1 gets a tick: the problem is its line above", async () => {
      await grid();
      const line = await penLine("2x=8", 100, 200, "2x=8");
      await settleStable(() => String(tutor().length));
      expect(liveStore.lines.get()[line].analysis?.verdict).toBe("ok");
      expect(marksOf(line)).toEqual(["check"]);
    });

    it("the answer under it is ticked as solved; a wrong step is ringed", async () => {
      await grid();
      await penLine("2x=8", 100, 200, "2x=8");
      const answer = await penLine("x=4", 100, 280, "x=4");
      expect(liveStore.lines.get()[answer].analysis).toMatchObject({ verdict: "ok", solved: true });
      const wrong = await penLine("x=2", 900, 200, "x=2");
      // under problem 2 (3x = 12), x = 2 is wrong
      expect(liveStore.lines.get()[wrong].analysis?.verdict).toBe("mismatch");
      await settleStable(() => String(tutor().length));
      expect(marksOf(wrong)).toEqual(["circle"]);
    });

    it("without the problem the same line is not checked (it is the tutor's line that makes the tick)", async () => {
      start();
      const line = await penLine("2x=8", 100, 200, "2x=8");
      expect(liveStore.lines.get()[line].analysis?.verdict).not.toBe("ok");
    });

    it("work low in cell 1 and high in cell 3 are two columns, each under its own problem", async () => {
      await grid();
      const low = await penLine("x=4", 100, 400, "x=4");
      const high = await penLine("4x=8", 100, 560, "4x=8");
      const lines = liveStore.lines.get();
      expect(lines[low].line.column).not.toBe(lines[high].line.column);
      expect(lines[low].analysis?.verdict).toBe("ok");
      // 4x + 4 = 12 → 4x = 8
      expect(lines[high].analysis?.verdict).toBe("ok");
    });

    it("in Suggest, a wrong first step gets the right one beside it, from the problem", async () => {
      await grid("suggest");
      const wrong = await penLine("2x=14", 100, 200, "2x=14");
      expect(liveStore.lines.get()[wrong].analysis?.verdict).toBe("mismatch");
      await vi.advanceTimersByTimeAsync(3000);
      await settleStable(() => String(tutor().length));
      const suggestion = tutor().filter((s) => s.meta.lineId === wrong && (s.meta as Record<string, unknown>).suggestFor);
      expect(handLinesOf(suggestion)).toEqual(["2x = 8"]);
    });

    it("a model check sees the problem as the column's first line", async () => {
      await grid();
      const line = await penLine("2x=8", 100, 200, "2x=8");
      const requests: unknown[] = [];
      loop.stop();
      start("feedback", {
        stream: async function* (path: string, body: unknown): AsyncGenerator<LiveSseEvent, void, undefined> {
          streamCalls.push(path);
          requests.push(body);
        },
      });
      await settleUntil(() => Boolean(liveStore.lines.get()[line]?.analysis));
      loop.requestCheck(line);
      await settleUntil(() => requests.length > 0);
      const req = requests[0] as { lines: Array<{ id: string; latex: string }> };
      expect(req.lines.map((l) => l.latex)).toEqual(["2x + 3 = 11", "2x=8"]);
      expect(req.lines[0].id).toBe("chat-problem-1-0");
    });

    it("rubbing a problem out: the line under it is no longer checked against it", async () => {
      await grid();
      const line = await penLine("2x=8", 100, 200, "2x=8");
      expect(liveStore.lines.get()[line].analysis?.verdict).toBe("ok");
      const ids = tutor().filter((s) => problemMetaOf(s.meta)?.n === 1).map((s) => s.id);
      editor.removeUser(ids);
      await settleStable(() => String(liveStore.lines.get()[line]?.analysis?.verdict));
      expect(liveStore.lines.get()[line].analysis?.verdict).not.toBe("ok");
    });

    it("after a reload the problems still head their columns (the cells come back from the strokes)", async () => {
      await grid();
      const line = await penLine("2x=8", 100, 200, "2x=8");
      loop.stop();
      resetLiveStore();
      start();
      await settleUntil(() => Boolean(liveStore.lines.get()[line]?.analysis));
      expect(liveStore.lines.get()[line].analysis?.verdict).toBe("ok");
    });
  });

  describe("lines, graphs, figures, screens", () => {
    it("write_lines: the formula in the tutor's hand in free space; a false step is left out", async () => {
      start();
      const report = await run([
        { type: "write_lines", lines: ["x = \\frac{-b \\pm \\sqrt{b^{2} - 4ac}}{2a}"] },
        { type: "write_lines", lines: ["x^{2} + 6x + 5 = 0", "x^{2} + 6x = -5", "x^{2} + 6x + 9 = 5"] },
      ]);
      expect(report.outcomes).toEqual([
        { type: "write_lines", ok: true },
        { type: "write_lines", ok: false, note: "I left out lines that didn't check out.", why: "false" },
      ]);
      expect(handLinesOf(tutor())).toEqual(["x = \\frac{-b \\pm \\sqrt{b^{2} - 4ac}}{2a}"]);
      expect(tutor().every((s) => (s.meta as Record<string, unknown>)[CHAT_BLOCK_META] === "lines")).toBe(true);
    });

    it("graph: the equation and the sketch, beside the work; a window is honoured; nothing to graph is said so", async () => {
      start();
      await penLine("2x=8", 100, 200, "2x=8");
      const report = await run([
        { type: "graph", relations: ["y = \\sin x"], window: { xMin: -6.2832, xMax: 6.2832 } },
        { type: "graph", relations: ["2x + 3"] },
      ]);
      expect(report.outcomes).toEqual([
        { type: "graph", ok: true },
        { type: "graph", ok: false, note: "I couldn't graph that." },
      ]);
      const sketch = tutor().filter((s) => (s.meta as Record<string, unknown>)[CHAT_BLOCK_META] === "graph");
      expect(sketch.length).toBeGreaterThan(20);
      expect(new Set(sketch.map((s) => handBlockOf(s.meta))).size).toBe(1);
      // the equation is written above the sketch (the curve's own strokes carry its LaTeX too)
      expect(handLinesOf(sketch)).toContain("y = \\sin x");
      const isEquation = (s: TLShape) => (s.meta as Record<string, unknown>).handLine === "y = \\sin x";
      const equationTop = Math.min(...sketch.filter(isEquation).map((s) => editor.getShapePageBounds(s)!.minY));
      const axesTop = Math.min(...sketch.filter((s) => !isEquation(s)).map((s) => editor.getShapePageBounds(s)!.minY));
      expect(equationTop).toBeLessThan(axesTop);
      // clear of the student's line
      const ink = shapes().filter((s) => !isLiveMeta(s.meta)).map((s) => editor.getShapePageBounds(s)!);
      const work = { x: Math.min(...ink.map((b) => b.x)), y: Math.min(...ink.map((b) => b.y)), r: Math.max(...ink.map((b) => b.x + b.w)), b: Math.max(...ink.map((b) => b.y + b.h)) };
      for (const s of sketch) {
        const bb = editor.getShapePageBounds(s)!;
        const overlaps = bb.x < work.r && bb.x + bb.w > work.x && bb.y < work.b && bb.y + bb.h > work.y;
        expect(overlaps).toBe(false);
      }
    });

    it("a problem's cell is the student's working space: a graph asked for on a screen of problems goes on a new screen", async () => {
      start();
      await run([{ type: "write_problems", problems: [["2x + 3 = 11"], ["3x = 12"], ["x + 8 = 12"], ["4x = 20"]] }]);
      const report = await run([{ type: "graph", relations: ["y = x^{2}"] }]);
      expect(report).toMatchObject({ screensAdded: 1, outcomes: [{ type: "graph", ok: true }] });
      expect(editor.getPages()).toHaveLength(2);
      expect(problems()).toEqual([]);
      expect(tutor().some((s) => (s.meta as Record<string, unknown>)[CHAT_BLOCK_META] === "graph")).toBe(true);
    });

    it("draw_figure: the drawer's figure, true to scale, in free space beside the work", async () => {
      start();
      await penLine("2x=8", 100, 200, "2x=8");
      const report = await run([{ type: "draw_figure", figure: PROBE_FIGURE }]);
      expect(report.outcomes).toEqual([{ type: "draw_figure", ok: true }]);
      const figure = tutor().filter((s) => (s.meta as Record<string, unknown>)[CHAT_BLOCK_META] === "figure");
      expect(figure.length).toBeGreaterThan(5);
      expect(new Set(figure.map((s) => handBlockOf(s.meta))).size).toBe(1);
      // its labels are maths in the hand: the side lengths and the unknown
      expect(handLinesOf(figure)).toEqual(expect.arrayContaining(["3", "4", "x"]));
      // inside the screen, clear of the student's line
      const bounds = figure.map((s) => editor.getShapePageBounds(s)!);
      const box = { x: Math.min(...bounds.map((b) => b.x)), y: Math.min(...bounds.map((b) => b.y)), r: Math.max(...bounds.map((b) => b.maxX)), b: Math.max(...bounds.map((b) => b.maxY)) };
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.r).toBeLessThanOrEqual(1600);
      expect(box.b).toBeLessThanOrEqual(900);
      const ink = shapes().filter((s) => !isLiveMeta(s.meta)).map((s) => editor.getShapePageBounds(s)!);
      for (const b of ink) expect(b.x < box.r && b.maxX > box.x && b.y < box.b && b.maxY > box.y).toBe(false);
    });

    it("draw_figure: a spec the drawer cannot draw at all is said so, and nothing is written", async () => {
      start("feedback", { planFigure: () => null });
      const report = await run([{ type: "draw_figure", figure: PROBE_FIGURE }]);
      expect(report.outcomes).toEqual([{ type: "draw_figure", ok: false, note: "I couldn't draw that figure." }]);
      expect(tutor()).toEqual([]);
    });

    it("new_screen moves to a blank screen; clear_tutor erases the tutor's ink and keeps the student's", async () => {
      start();
      await run([{ type: "write_problems", problems: [["2x + 3 = 11"]] }]);
      await penLine("2x=8", 100, 200, "2x=8");
      expect(tutor().length).toBeGreaterThan(0);
      const cleared = await run([{ type: "clear_tutor" }]);
      expect(cleared.outcomes).toEqual([{ type: "clear_tutor", ok: true }]);
      await settleStable(() => String(tutor().length));
      expect(problems()).toEqual([]);
      expect(shapes().some((s) => !isLiveMeta(s.meta))).toBe(true);
      const first = editor.getCurrentPage().id;
      const moved = await run([{ type: "new_screen" }]);
      expect(moved).toMatchObject({ screensAdded: 1, outcomes: [{ type: "new_screen", ok: true }] });
      expect(editor.getCurrentPage().id).not.toBe(first);
      expect(editor.getCurrentPage().meta).toMatchObject({ screen: DEFAULT_SCREEN });
    });

    it("one at a time: a second reply waits for the first; everything lands in order", async () => {
      start();
      const order: string[] = [];
      const a = loop.runChatActions([{ type: "write_problems", problems: [["2x + 3 = 11"], ["3x = 12"]] }]).then(() => order.push("problems"));
      const b = loop.runChatActions([{ type: "new_screen" }]).then(() => order.push("screen"));
      for (let i = 0; i < 200 && order.length < 2; i++) await vi.advanceTimersByTimeAsync(50);
      await Promise.all([a, b]);
      expect(order).toEqual(["problems", "screen"]);
      // the problems went on the first screen before the new one was added
      editor.switchPage(editor.getPages()[0].id);
      expect(problems()).toHaveLength(2);
    });

    it("the student moving to another screen mid-reply stops the rest", async () => {
      const other = editor.addPage({ screen: { ...DEFAULT_SCREEN } });
      const drawn = planHandwriting(["A"], { size: 30, seed: 1 }).plan!;
      // the student switches screens while the figure is being planned (the first action)
      start("feedback", {
        planFigure: () => {
          editor.switchPage(other);
          return { plan: drawn, points: {} };
        },
      });
      const report = await run([{ type: "draw_figure", figure: PROBE_FIGURE }, { type: "write_lines", lines: ["A = \\pi r^{2}"] }]);
      expect(report.outcomes[1]).toEqual({ type: "write_lines", ok: false, note: "I stopped because you moved to another screen." });
      expect(handLinesOf(tutor())).not.toContain("A = \\pi r^{2}");
    });
  });

  describe("teach: a worked solution, checked, written as a teacher writes it", () => {
    const teachAction = (t: typeof OWNER_TEACH, figure?: typeof OWNER_FIGURE): ChatAction => ({
      type: "teach",
      ...(figure ? { figure } : {}),
      steps: t.steps.map((s) => ({ say: s.say, math: [...(s.math ?? [])] })),
      ...(t.answer ? { answer: t.answer } : {}),
    });
    const metaOf = (s: TLShape) => s.meta as Record<string, unknown>;
    const blocksOf = (kind: string) => new Set(tutor().filter((s) => metaOf(s)[CHAT_BLOCK_META] === kind).map((s) => handBlockOf(s.meta)));

    it("on an empty screen: the figure, each step (its sentence, then its maths) and the boxed answer, inside the screen, never marked", async () => {
      start();
      const report = await run([teachAction(OWNER_TEACH, OWNER_FIGURE)]);
      expect(report.outcomes).toEqual([{ type: "teach", ok: true }]);
      expect(report.screensAdded).toBe(0);
      // one block for the figure, one per step, one for the answer and its box
      expect(blocksOf("figure").size).toBe(1);
      expect(blocksOf("teach").size).toBe(OWNER_TEACH.steps.length + 1);
      const teach = tutor().filter((s) => metaOf(s)[CHAT_BLOCK_META] === "teach");
      const maths = handLinesOf(teach).filter(Boolean);
      for (const line of OWNER_TEACH.steps.flatMap((s) => s.math ?? [])) expect(maths).toContain(line);
      expect(maths).toContain("RS^{2} = 62");
      // the sentences are ink too (words in the tutor's hand), stamped as the step's words
      expect(teach.some((s) => String(metaOf(s).handPart ?? "").startsWith("say:"))).toBe(true);
      // everything inside the 1600×900 screen
      for (const s of tutor()) {
        const b = editor.getShapePageBounds(s)!;
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.maxX).toBeLessThanOrEqual(1600);
        expect(b.y).toBeGreaterThanOrEqual(0);
        expect(b.maxY).toBeLessThanOrEqual(900);
      }
      // the picture of the screen lists the tutor's maths (a follow-up refers to it), not the sentences
      const picture = loop.chatScreen();
      expect(picture.tutor).toEqual(expect.arrayContaining(["OR = \\sqrt{(x_2 - x_1)^2 + (y_2 - y_1)^2}", "RS^{2} = 62"]));
      expect(picture.tutor.some((l) => /radii|distance/.test(l))).toBe(false);
      // the tutor's own lines are never read or marked
      await vi.advanceTimersByTimeAsync(4000);
      expect(tutor().filter((s) => metaOf(s).mark)).toEqual([]);
      expect(Object.keys(liveStore.lines.get())).toEqual([]);
    });

    it("a solution the engine cannot check is not written at all; the panel is told", async () => {
      start();
      const slip = teachAction({ ...LINEAR_TEACH, steps: [LINEAR_TEACH.steps[0], { say: "Divide by 2.", math: ["x = 5"] }], answer: "x = 5" });
      const report = await run([slip]);
      expect(report.outcomes).toEqual([{ type: "teach", ok: false, note: "I couldn't check that working, so I didn't write it." }]);
      expect(tutor()).toEqual([]);
    });

    it("beside the student's work when there is room, clear of it; a full screen gets a new one", async () => {
      start();
      await penLine("2x=8", 100, 200, "2x=8");
      const report = await run([teachAction(LINEAR_TEACH)]);
      expect(report).toMatchObject({ screensAdded: 0, outcomes: [{ type: "teach", ok: true }] });
      const ink = shapes().filter((s) => !isLiveMeta(s.meta)).map((s) => editor.getShapePageBounds(s)!);
      for (const s of tutor().filter((t) => metaOf(t)[CHAT_BLOCK_META] === "teach")) {
        const b = editor.getShapePageBounds(s)!;
        for (const i of ink) expect(b.x < i.maxX && b.maxX > i.x && b.y < i.maxY && b.maxY > i.y).toBe(false);
      }
      // a second worked solution never goes beside the first: a new screen
      const second = await run([teachAction(OWNER_TEACH, OWNER_FIGURE)]);
      expect(second).toMatchObject({ screensAdded: 1, outcomes: [{ type: "teach", ok: true }] });
      expect(editor.getPages()).toHaveLength(2);
    });
  });

  it("problem meta carries the problem and its cell on every stroke of it", async () => {
    start();
    await run([{ type: "write_problems", problems: [["2x + 3 = 11"]] }]);
    const metas = tutor().map((s) => (s.meta as Record<string, unknown>)[CHAT_PROBLEM_META]);
    expect(metas.length).toBeGreaterThan(3);
    for (const m of metas) expect(m).toMatchObject({ n: 1, lines: ["2x + 3 = 11"], cell: { x: expect.any(Number), w: expect.any(Number) } });
  });
});
