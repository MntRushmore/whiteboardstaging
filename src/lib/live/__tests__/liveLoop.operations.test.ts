import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { TLShape } from "tldraw";
import { createFakeEditor, type FakeEditor } from "../__fixtures__/fakeEditor";
import { drawShapeFromPoints, glyphs, writeLine as inkLine } from "../__fixtures__/strokes";
import { settleStable, settleUntil } from "@/lib/live/__fixtures__/settle";
import { useSyncHash } from "@/lib/live/__fixtures__/syncHash";
import { isLiveMeta, LIVE_TIMING, type HelpMode, type LiveEngine, type LiveSseEvent, type RecognizeRequest, type RecognizeResponse } from "../contracts";
import { getEngine } from "../engine";
import { handLinesOf } from "../handwriting";
import { createLiveLoop, type LiveLoop, type LiveLoopDeps } from "../liveLoop";
import { liveStore, resetLiveStore } from "../liveStore";
import { RecognizeClient, type FetchJson } from "../recognizeClient";
import { DEFAULT_SCREEN } from "@/lib/screens/screens";
import { problemMetaOf } from "../chat/cells";
import type { ChatAction, ChatRunReport } from "../chat/contracts";

/**
 * Both-sides operation lines on the board (`engine/operationLine.ts`): `-3 \quad -3` under the
 * student's `2x + 3 = 11`, and the owner's board — the tutor wrote `2\sin x = 1`, the student drew a
 * bar under the whole equation and a `2` under it (`diagrams.ts`' division bar), which Mathpix reads
 * as `2`. The operation line gets its tick (or ring), and the line after it is checked against the
 * equation above it.
 */

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

describe("live loop — operation lines under an equation", () => {
  useSyncHash();

  let editor: FakeEditor;
  let fetchJson: Mock<FetchJson>;
  let loop: LiveLoop;
  let script: string[];
  let assigned: Map<string, string>;
  let requests: Array<{ path: string; body: unknown }>;

  function start(mode: HelpMode = "feedback", deps: Partial<LiveLoopDeps> = {}): void {
    loop = createLiveLoop(
      editor,
      { boardId: "board-1", mode, enabled: true },
      {
        recognizer: new RecognizeClient({ fetchJson }),
        stream: async function* (path: string, body: unknown): AsyncGenerator<LiveSseEvent, void, undefined> {
          requests.push({ path, body });
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
    loop.runChatActions(actions).then((r) => (result = r));
    for (let i = 0; i < 400 && !result; i++) await vi.advanceTimersByTimeAsync(50);
    if (!result) throw new Error("the chat never finished");
    return result;
  }

  /** Puts `shapes` on the page as the student's ink, read back as `latex`; the new line's id once analysed. */
  async function pen(shapes: ReturnType<typeof inkLine>, latex: string): Promise<string> {
    script.push(latex);
    const before = new Set(Object.keys(liveStore.lines.get()));
    editor.putUser(shapes);
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.quietMs + 300);
    await settleUntil(() => Object.entries(liveStore.lines.get()).some(([id, st]) => !before.has(id) && Boolean(st.analysis)));
    const added = Object.keys(liveStore.lines.get()).find((id) => !before.has(id));
    if (!added) throw new Error(`${latex} produced no line`);
    return added;
  }

  /** A bar under `r` (a little past both ends) and a `2` under its middle. */
  function barAndTwo(r: { x: number; y: number; w: number; h: number }): ReturnType<typeof inkLine> {
    const y = r.y + r.h + 22;
    const bar = drawShapeFromPoints(glyphs.bar(r.x + 12, y, r.w + 40)[0]);
    return [bar, ...inkLine("2", r.x + r.w / 2, y + 14, 36)];
  }

  const shapes = (): TLShape[] => editor.getCurrentPageShapes();
  const tutor = (): TLShape[] => shapes().filter((s) => isLiveMeta(s.meta) && s.meta.source === "ai");
  const marksOf = (lineId: string) => tutor().filter((s) => s.meta.lineId === lineId && (s.meta as Record<string, unknown>).mark).map((s) => String((s.meta as Record<string, unknown>).mark).split(":")[0]);
  const analysisOf = (lineId: string) => liveStore.lines.get()[lineId]?.analysis;
  const inkBox = (list: TLShape[]) => {
    const bs = list.map((s) => editor.getShapePageBounds(s)!);
    const x = Math.min(...bs.map((b) => b.x));
    const y = Math.min(...bs.map((b) => b.y));
    return { x, y, w: Math.max(...bs.map((b) => b.x + b.w)) - x, h: Math.max(...bs.map((b) => b.y + b.h)) - y };
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    resetLiveStore();
    editor = createFakeEditor();
    const page = editor.getCurrentPage();
    editor.store.put([{ ...page, meta: { screen: { ...DEFAULT_SCREEN } } }]);
    script = [];
    requests = [];
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

  it("the owner's board: a bar and a 2 under the tutor's 2\\sin x = 1 is ÷ 2, ticked; then \\sin x = \\frac{1}{2} is ticked", async () => {
    start();
    await run([{ type: "write_problems", problems: [["2 \\sin x = 1"]] }]);
    const head = inkBox(tutor().filter((s) => problemMetaOf(s.meta)));
    // Mathpix drops the bar and reads the 2 (measured): the line is "divide both sides by 2"
    const op = await pen(barAndTwo(head), "2");
    expect(liveStore.lines.get()[op].latex).toBe("\\div 2");
    expect(analysisOf(op)).toMatchObject({ kind: "operation", verdict: "ok", operation: { op: "divide", operand: "2", result: "\\sin x = \\frac{1}{2}" } });
    // the bar and the 2 are one line, nothing a drawing
    expect(liveStore.lines.get()[op].line.strokeIds).toHaveLength(2);
    expect(liveStore.diagrams.get()).toEqual([]);
    await settleStable(() => String(tutor().length));
    expect(marksOf(op)).toEqual(["check"]);
    const opBox = liveStore.lines.get()[op].line.bounds;
    const next = await pen(inkLine("x=4", head.x + 20, opBox.y + opBox.h + 40, 40), "\\sin x = \\frac{1}{2}");
    expect(analysisOf(next)?.verdict).toBe("ok");
    await settleStable(() => String(tutor().length));
    expect(marksOf(next)).toEqual(["check"]);
  });

  it("-3 under each side of the student's 2x + 3 = 11 is ticked, and 2x = 8 under it is ticked too", async () => {
    start();
    await pen(inkLine("2x+3=11", 100, 200, 40), "2x + 3 = 11");
    const op = await pen(inkLine("3 3", 180, 262, 36), "\\begin{array}{ll}\n-3 & -3\n\\end{array}");
    expect(analysisOf(op)).toMatchObject({ kind: "operation", verdict: "ok" });
    const next = await pen(inkLine("2x=8", 100, 330, 40), "2x = 8");
    expect(analysisOf(next)?.verdict).toBe("ok");
    await settleStable(() => String(tutor().length));
    expect(marksOf(op)).toEqual(["check"]);
    expect(marksOf(next)).toEqual(["check"]);
  });

  it("a different number under each side is ringed; the line after it is still checked against the equation", async () => {
    start();
    await pen(inkLine("2x+3=11", 100, 200, 40), "2x + 3 = 11");
    const op = await pen(inkLine("3 4", 180, 262, 36), "-3 \\quad-4");
    expect(analysisOf(op)).toMatchObject({ kind: "operation", verdict: "mismatch" });
    const next = await pen(inkLine("2x=8", 100, 330, 40), "2x = 8");
    expect(analysisOf(next)?.verdict).toBe("ok");
    await settleStable(() => String(tutor().length));
    expect(marksOf(op)).toEqual(["circle"]);
  });

  it("a factor pair under a quadratic (-2, -5) is scratch: no mark, and the factored line under it is ticked", async () => {
    start();
    await pen(inkLine("2x+3=11", 100, 200, 40), "x^{2} - 7x + 10 = 0");
    const scratch = await pen(inkLine("2 8", 180, 262, 36), "-2 \\quad-5");
    expect(analysisOf(scratch)).toMatchObject({ kind: "operation", verdict: "none" });
    const next = await pen(inkLine("2x=8", 100, 330, 40), "(x - 2)(x - 5) = 0");
    expect(analysisOf(next)?.verdict).toBe("ok");
    await settleStable(() => String(tutor().length));
    expect(marksOf(scratch)).toEqual([]);
    expect(marksOf(next)).toEqual(["check"]);
  });

  it("dividing by 0 is ringed", async () => {
    start();
    await pen(inkLine("2x=8", 100, 200, 40), "2x = 8");
    const op = await pen(inkLine("8", 180, 262, 36), "\\div 0");
    expect(analysisOf(op)?.verdict).toBe("mismatch");
    await settleStable(() => String(tutor().length));
    expect(marksOf(op)).toEqual(["circle"]);
  });

  it("Suggest: once the student stops, the equation a right operation leads to is written under it", async () => {
    start("suggest");
    await pen(inkLine("2x+3=11", 100, 200, 40), "2x + 3 = 11");
    const op = await pen(inkLine("3 3", 180, 262, 36), "-3 \\quad-3");
    await vi.advanceTimersByTimeAsync(3000);
    await settleStable(() => String(tutor().length));
    const written = tutor().filter((s) => s.meta.lineId === op && (s.meta as Record<string, unknown>).operationResult);
    expect(handLinesOf(written)).toEqual(["2x = 8"]);
    // under the operation line
    const opBox = liveStore.lines.get()[op].line.bounds;
    expect(inkBox(written).y).toBeGreaterThan(opBox.y + opBox.h);
  });

  it("Feedback writes nothing under it; nor does Suggest once the student has written the next line", async () => {
    start("feedback");
    await pen(inkLine("2x+3=11", 100, 200, 40), "2x + 3 = 11");
    const op = await pen(inkLine("3 3", 180, 262, 36), "-3 \\quad-3");
    await vi.advanceTimersByTimeAsync(3000);
    await settleStable(() => String(tutor().length));
    expect(tutor().filter((s) => (s.meta as Record<string, unknown>).operationResult)).toEqual([]);
    loop.stop();
    start("suggest");
    await pen(inkLine("2x=8", 100, 330, 40), "2x = 8");
    await vi.advanceTimersByTimeAsync(3000);
    await settleStable(() => String(tutor().length));
    expect(tutor().filter((s) => s.meta.lineId === op && (s.meta as Record<string, unknown>).operationResult)).toEqual([]);
  });

  it("a model check does not see the operation line; the line after it follows the equation", async () => {
    start();
    await pen(inkLine("2x+3=11", 100, 200, 40), "2x + 3 = 11");
    await pen(inkLine("3 3", 180, 262, 36), "-3 \\quad-3");
    const next = await pen(inkLine("2x=8", 100, 330, 40), "2x = 8");
    loop.requestCheck(next);
    await settleUntil(() => requests.length > 0);
    const req = requests[0].body as { lines: Array<{ latex: string }> };
    expect(req.lines.map((l) => l.latex)).toEqual(["2x + 3 = 11", "2x = 8"]);
  });

  it("Solve on the operation line solves the equation above it, under the work", async () => {
    start("answer");
    await pen(inkLine("2x+3=11", 100, 200, 40), "2x + 3 = 11");
    const op = await pen(inkLine("3 3", 180, 262, 36), "-3 \\quad-3");
    loop.requestSolve(op);
    await settleStable(() => String(tutor().length));
    const solved = tutor().filter((s) => (s.meta as Record<string, unknown>).solvedLatex);
    expect(handLinesOf(solved)).toEqual(["2x = 8", "x = 4"]);
    expect(requests).toEqual([]);
  });
});
