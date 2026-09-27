import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { TLDrawShape, TLShape } from "tldraw";
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
  type Rect,
  type RecognizeRequest,
  type RecognizeResponse,
} from "../contracts";
import { getEngine } from "../engine";
import { HAND_WRITE, handBlockOf, handLinesOf } from "../handwriting";
import { ANSWER_SETTLE_MS, createLiveLoop, type LiveLoop } from "../liveLoop";
import { liveStore, resetLiveStore } from "../liveStore";
import { rectsIntersect } from "../placement";
import { unionRects } from "../strokeClusters";
import { RecognizeClient, type FetchJson } from "../recognizeClient";

/**
 * Graphs, end to end through the loop against the REAL engine: a graph is an ANSWER, sketched
 * by the tutor's hand (draw strokes carrying `meta.graphFor`), never the old typeset card.
 * Solve sketches it when asked or once the student has stopped; Feedback / Suggest only on Help.
 */

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

const INK = ["2x=8", "x=4", "4x=8", "1+2="];

describe("live loop — graphs sketched by hand", () => {
  useSyncHash();

  let editor: FakeEditor;
  let fetchJson: Mock<FetchJson>;
  let loop: LiveLoop;
  let streamCalls: string[];
  let script: string[];
  let assigned: Map<string, string>;
  let handwriting: boolean;

  function makeLoop(mode: HelpMode): LiveLoop {
    return createLiveLoop(
      editor,
      { boardId: "board-1", mode, enabled: true, voiceActive: false },
      {
        recognizer: new RecognizeClient({ fetchJson }),
        stream: async function* (path: string): AsyncGenerator<LiveSseEvent, void, undefined> {
          streamCalls.push(path);
        },
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
      },
    );
  }

  function start(mode: HelpMode): void {
    loop = makeLoop(mode);
    loop.start();
  }

  /** One line of ink the scripted recognizer reads as `latex`; returns its line id. */
  async function penLine(row: number, latex: string): Promise<string> {
    script.push(latex);
    const before = new Set(Object.keys(liveStore.lines.get()));
    editor.putUser(inkLine(INK[row], 100, 120 + row * 110, 40));
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.quietMs + 300);
    await settleUntil(() => Object.entries(liveStore.lines.get()).some(([id, st]) => !before.has(id) && Boolean(st.latex)));
    return Object.keys(liveStore.lines.get()).find((id) => !before.has(id))!;
  }

  const tutor = (): TLShape[] => editor.getCurrentPageShapes().filter((s) => isLiveMeta(s.meta) && s.meta.source === "ai");
  const graphStrokes = (): TLDrawShape[] =>
    tutor().filter((s): s is TLDrawShape => s.type === "draw" && Boolean((s.meta as Record<string, unknown>).graphFor));
  const graphKeys = () => [...new Set(tutor().map((s) => (s.meta as Record<string, unknown>).graphFor).filter(Boolean))];
  const stepStrokes = () => tutor().filter((s) => (s.meta as Record<string, unknown>).solvedLatex);
  const studentInk = () => editor.getCurrentPageShapes().filter((s) => s.type === "draw" && !isLiveMeta(s.meta));
  const boundsOf = (shapes: TLShape[]): Rect => unionRects(shapes.map((s) => editor.getShapePageBounds(s)!));
  const quiesce = () => settleStable(() => `${tutor().length}|${streamCalls.length}`);
  const settleAnswers = async () => {
    await vi.advanceTimersByTimeAsync(ANSWER_SETTLE_MS + 100);
    await quiesce();
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    resetLiveStore();
    editor = createFakeEditor();
    streamCalls = [];
    script = [];
    assigned = new Map();
    handwriting = true;
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
    loop.stop();
    vi.useRealTimers();
  });

  it("Solve on `y = 2x + 1` sketches the graph by hand — axes, line, intercepts — with no card and no model", async () => {
    start("answer");
    const line = await penLine(0, "y=2x+1");
    loop.requestSolve(line);
    await quiesce();

    expect(streamCalls).toEqual([]);
    expect(editor.getCurrentPageShapes().filter((s) => s.type === "graph")).toHaveLength(0);
    const strokes = graphStrokes();
    expect(strokes.length).toBeGreaterThan(20);
    // one block, in the tutor's hand and colour
    expect(new Set(strokes.map((s) => handBlockOf(s.meta))).size).toBe(1);
    for (const s of strokes) expect(s.props.color).toBe(HAND_WRITE.color);
    expect(graphKeys()).toHaveLength(1);
    expect(String(graphKeys()[0])).toMatch(/^p:x:f=:/);
    // the coordinates written beside the dots, in maths
    const written = handLinesOf(strokes);
    expect(written).toContain("(0, 1)");
    expect(written).toContain("(-\\frac{1}{2}, 0)");
    expect(written).toContain("y=2x+1");
    // never over the student's ink
    const ink = boundsOf(studentInk());
    expect(rectsIntersect(boundsOf(strokes), ink)).toBe(false);
  });

  it("Solve pressed again draws nothing new", async () => {
    start("answer");
    const line = await penLine(0, "y=2x+1");
    loop.requestSolve(line);
    await quiesce();
    const count = tutor().length;
    loop.requestSolve(line);
    await quiesce();
    expect(tutor().length).toBe(count);
    expect(streamCalls).toEqual([]);
  });

  it("in Solve, the graph is an answer: it waits for the student to stop writing, then comes unasked", async () => {
    start("answer");
    await penLine(0, "y=2x+1");
    expect(graphStrokes()).toHaveLength(0);
    await settleAnswers();
    expect(graphStrokes().length).toBeGreaterThan(20);
    expect(streamCalls).toEqual([]);
  });

  it.each(["feedback", "suggest"] as const)("%s never graphs unasked; Help sketches it", async (mode) => {
    start(mode);
    await penLine(0, "y=x^{2}-4");
    await settleAnswers();
    await vi.advanceTimersByTimeAsync(6000);
    await quiesce();
    expect(graphStrokes()).toHaveLength(0);

    loop.requestHelp();
    await quiesce();
    expect(graphStrokes().length).toBeGreaterThan(20);
    const written = handLinesOf(graphStrokes());
    expect(written).toEqual(expect.arrayContaining(["(0, -4)", "(-2, 0)", "(2, 0)"]));
    // the graph was the help: no model asked for a next step
    expect(streamCalls).toEqual([]);
  });

  it("Solve on a system: the steps under the work, both lines and where they cross beside it", async () => {
    start("answer");
    await penLine(0, "x+y=18");
    const second = await penLine(1, "x-y=4");
    loop.requestSolve(second);
    await quiesce();

    expect(streamCalls).toEqual([]);
    const steps = stepStrokes();
    const graph = graphStrokes();
    expect(steps.length).toBeGreaterThan(0);
    expect(graph.length).toBeGreaterThan(20);
    expect(handLinesOf(steps)).toEqual(expect.arrayContaining(["x = 11", "y = 7"]));
    // two relations on one graph, and their crossing written as a point
    expect(String(graphKeys()[0]).split("|")).toHaveLength(2);
    expect(handLinesOf(graph)).toContain("(11, 7)");
    const ink = boundsOf(studentInk());
    const stepsRect = boundsOf(steps);
    const graphRect = boundsOf(graph);
    expect(graphRect.x).toBeGreaterThan(ink.x + ink.w);
    expect(rectsIntersect(graphRect, stepsRect)).toBe(false);
    expect(rectsIntersect(graphRect, ink)).toBe(false);
  });

  it("Solve on an inequality: the steps, then the answer's number line", async () => {
    start("answer");
    const line = await penLine(0, "2x+3>11");
    loop.requestSolve(line);
    await quiesce();
    expect(handLinesOf(stepStrokes())).toEqual(["2x > 8", "x > 4"]);
    expect(graphKeys()).toEqual(["n:x:(4,inf)"]);
    expect(rectsIntersect(boundsOf(graphStrokes()), boundsOf(stepStrokes()))).toBe(false);
    // it stays once the pen has stopped: the solution under the work is part of the column
    await settleAnswers();
    expect(graphKeys()).toEqual(["n:x:(4,inf)"]);
  });

  it("a finished inequality the student wrote gets its number line in Solve once they stop", async () => {
    start("answer");
    await penLine(0, "-2 \\le x < 3");
    await settleAnswers();
    expect(graphKeys()).toEqual(["n:x:[-2,3)"]);
  });

  it("substitution is not graphing: `x + y = 18`, `y = 9`, `x = ?` gets no graph", async () => {
    start("answer");
    await penLine(0, "x+y=18");
    await penLine(1, "y=9");
    const ask = await penLine(2, "x=?");
    loop.requestSolve(ask);
    await quiesce();
    await settleAnswers();
    expect(graphStrokes()).toHaveLength(0);
  });

  it("a line that changes takes its graph with it; its new maths gets a new graph", async () => {
    start("answer");
    const line = await penLine(0, "y=2x+1");
    await settleAnswers();
    const first = graphKeys();
    expect(first).toHaveLength(1);

    loop.retypeLine(line, "2x=8");
    await quiesce();
    expect(graphStrokes()).toHaveLength(0);

    loop.retypeLine(line, "y=-x+4");
    await quiesce();
    const next = graphKeys();
    expect(next).toHaveLength(1);
    expect(next[0]).not.toBe(first[0]);
  });

  it("a graph the student rubs out is not sketched again unasked; Solve brings it back", async () => {
    start("answer");
    const line = await penLine(0, "y=2x+1");
    await settleAnswers();
    const ids = graphStrokes().map((s) => s.id);
    expect(ids.length).toBeGreaterThan(0);
    editor.removeUser(ids);
    await quiesce();

    await penLine(1, "2x=8");
    await settleAnswers();
    expect(graphStrokes()).toHaveLength(0);

    loop.requestSolve(line);
    await quiesce();
    expect(graphStrokes().length).toBeGreaterThan(20);
  });

  it("with the hand switched off, a function's graph is the typeset card; a region has none", async () => {
    handwriting = false;
    start("answer");
    const line = await penLine(0, "y=2x+1");
    loop.requestSolve(line);
    await quiesce();
    const cards = editor.getCurrentPageShapes().filter((s) => s.type === "graph");
    expect(cards).toHaveLength(1);
    expect((cards[0].meta as Record<string, unknown>).graphFor).toMatch(/^p:x:/);
    expect(graphStrokes()).toHaveLength(0);
    expect(streamCalls).toEqual([]);
  });
});
