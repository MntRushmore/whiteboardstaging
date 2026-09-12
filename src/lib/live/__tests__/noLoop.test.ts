import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { createShapeId, type Editor, type TLShape } from "tldraw";
import { createFakeEditor, type FakeEditor } from "../__fixtures__/fakeEditor";
import { fixtureSingleLine, fixtureTwoLines } from "../__fixtures__/strokes";
import {
  LIVE_TIMING,
  MATH_SHAPE_DEFAULTS,
  type LineAnalysis,
  type LiveEngine,
  type LiveSseEvent,
  type MathShapeProps,
  type RecognizeResponse,
} from "../contracts";
import { createLiveLoop, type LiveLoop } from "../liveLoop";
import { liveStore, resetLiveStore } from "../liveStore";
import { liveWrite } from "../liveWrite";
import { RecognizeClient, type FetchJson } from "../recognizeClient";

/**
 * Regression: the Live loop must never react to its own (remote-sourced) writes, and
 * a user pen-up must trigger exactly one recognition after the quiet gate.
 */

const engine: LiveEngine = {
  analyzeLine: (latex): LineAnalysis => ({
    kind: latex.includes("=") ? "equation" : "expression",
    math: latex,
    resultLatex: "",
    verdict: latex === "x=4" ? "ok" : "unknown",
    note: "",
    plot: latex.startsWith("y=") ? { expr: latex.slice(2), latex } : undefined,
  }),
  compileExpr: () => () => 0,
  solveLatex: () => null,
  verifyExpected: () => "unknown",
  balance: () => null,
  calculate: () => null,
};

async function settle(ticks = 4): Promise<void> {
  for (let i = 0; i < ticks; i++) {
    await new Promise<void>((r) => setImmediate(r));
    await Promise.resolve();
  }
}

describe("useLiveMath loop isolation (noLoop)", () => {
  let editor: FakeEditor;
  let fetchJson: Mock<FetchJson>;
  let streamCalls: number;
  let loop: LiveLoop;

  function makeLoop(mode: "off" | "feedback" | "suggest" | "answer" = "feedback"): LiveLoop {
    const stream = async function* (): AsyncGenerator<LiveSseEvent, void, undefined> {
      streamCalls++;
    };
    return createLiveLoop(
      editor,
      { boardId: "board-1", mode, enabled: true, voiceActive: false },
      {
        recognizer: new RecognizeClient({ fetchJson }),
        stream,
        getEngine: async () => engine,
        fetchCapabilities: async () => ({ recognizer: "mathpix", liveEnabled: true, models: { check: "c", solve: "s", vision: "v" } }),
        events: null,
        isOnline: () => true,
      },
    );
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    resetLiveStore();
    editor = createFakeEditor();
    fetchJson = vi.fn<FetchJson>(async (_path: string, body: unknown): Promise<RecognizeResponse> => {
      const req = body as { lineId: string };
      return { latex: `2x+3=11:${req.lineId.length}`, text: "", kind: "math", confidence: 0.97, provider: "mathpix", ms: 300 };
    });
    streamCalls = 0;
    loop = makeLoop();
    loop.start();
  });

  afterEach(() => {
    loop.stop();
    vi.useRealTimers();
  });

  it("a math shape created via liveWrite (source 'remote') triggers no recognize call", async () => {
    liveWrite(editor as unknown as Editor, () => {
      editor.createShapes([
        {
          id: createShapeId(),
          type: "math",
          x: 10,
          y: 10,
          props: { ...MATH_SHAPE_DEFAULTS, latex: "x=1", source: "ai", anchorIds: [], lineId: "" },
          meta: { live: true, source: "ai", lineId: "", createdAt: 1 },
        },
      ]);
    });
    await settle();
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.quietMs * 5);
    await settle();
    expect(fetchJson).not.toHaveBeenCalled();
    expect(Object.keys(liveStore.lines.get())).toHaveLength(0);
  });

  it("a completed user draw triggers exactly one recognize after the quiet gate and creates one echo", async () => {
    const strokes = fixtureSingleLine();
    editor.putUser(strokes);
    expect(fetchJson).not.toHaveBeenCalled();
    expect(liveStore.lastBurst.get()?.state).toBe("pending");

    await vi.advanceTimersByTimeAsync(LIVE_TIMING.quietMs - 1);
    await settle();
    expect(fetchJson).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2);
    await settle(8);
    expect(fetchJson).toHaveBeenCalledTimes(1);
    const body = fetchJson.mock.calls[0][1] as { boardId: string; strokes: { x: number[][] }; bounds: { h: number } };
    expect(body.boardId).toBe("board-1");
    expect(body.strokes.x).toHaveLength(strokes.length);
    expect(Math.abs(body.bounds.h - 180)).toBeLessThanOrEqual(1);

    const echoes = editor.shapesOfType("math");
    expect(echoes).toHaveLength(1);
    const props = echoes[0].props as MathShapeProps;
    expect(props.source).toBe("echo");
    expect(props.anchorIds).toHaveLength(strokes.length);
    expect(props.latex).toMatch(/^2x\+3=11/);
    expect(echoes[0].meta).toMatchObject({ live: true, source: "echo" });
    // 24 px right of the ink
    const inkRight = Math.max(...strokes.map((s) => editor.getShapePageBounds(s.id)!.maxX));
    expect(echoes[0].x).toBe(inkRight + 24);
    expect(liveStore.lastBurst.get()?.state).toBe("handled");
    expect(liveStore.liveShapeCount.get()).toBe(1);

    // The echo write itself must not have re-triggered anything.
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.quietMs * 3);
    await settle();
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(streamCalls).toBe(0);
  });

  it("ignores protected and live-meta ink", async () => {
    const strokes = fixtureSingleLine().map((s, i) => ({ ...s, meta: i % 2 ? { isProtected: true } : { live: true, source: "ai", lineId: "", createdAt: 1 } }));
    editor.putUser(strokes as TLShape[]);
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.quietMs * 2);
    await settle();
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("rebuilds lines from echoes on remount without re-recognizing; erasing all anchors deletes the echo", async () => {
    const strokes = fixtureTwoLines();
    editor.putUser(strokes);
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.quietMs + 1);
    await settle(8);
    expect(fetchJson).toHaveBeenCalledTimes(2);
    expect(editor.shapesOfType("math")).toHaveLength(2);

    // Remount over the same store (reload).
    loop.stop();
    resetLiveStore();
    loop = makeLoop();
    loop.start();
    await settle();
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.quietMs * 2);
    await settle();
    expect(fetchJson).toHaveBeenCalledTimes(2);
    const lines = Object.values(liveStore.lines.get());
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => l.mathShapeId && l.latex)).toBe(true);
    expect(new Set(lines.map((l) => l.line.row))).toEqual(new Set([0, 1]));

    // Erase the second line's strokes -> its echo goes away, first stays.
    const second = lines.find((l) => l.line.row === 1)!;
    editor.removeUser(second.line.strokeIds);
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.rewriteQuietMs + LIVE_TIMING.quietMs);
    await settle(8);
    expect(editor.shapesOfType("math")).toHaveLength(1);
    expect(Object.keys(liveStore.lines.get())).toHaveLength(1);
    // Nothing new was recognized (the first line was untouched).
    expect(fetchJson).toHaveBeenCalledTimes(2);
  });

  it("moving a line re-places its echo without recognizing again", async () => {
    const strokes = fixtureSingleLine();
    editor.putUser(strokes);
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.quietMs + 1);
    await settle(8);
    expect(fetchJson).toHaveBeenCalledTimes(1);
    const before = editor.shapesOfType("math")[0];

    for (const s of strokes) editor.updateUser(s.id, (shape) => ({ ...shape, x: shape.x + 200, y: shape.y + 100 }));
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.rewriteQuietMs + 1);
    await settle(8);
    expect(fetchJson).toHaveBeenCalledTimes(1);
    const after = editor.shapesOfType("math")[0];
    expect(after.id).toBe(before.id);
    // Re-placed from the moved ink bounds: equal up to floating-point noise.
    expect(after.x).toBeCloseTo(before.x + 200, 6);
    expect(after.y).toBeCloseTo(before.y + 100, 6);
  });

  it("student edits of the echo latex retype the line locally (no recognition)", async () => {
    editor.putUser(fixtureSingleLine());
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.quietMs + 1);
    await settle(8);
    const echo = editor.shapesOfType("math")[0];
    const lineId = (echo.props as MathShapeProps).lineId;
    editor.updateUser(echo.id, (s) => ({ ...s, props: { ...s.props, latex: "x=4" } }) as TLShape);
    await settle(4);
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.quietMs * 2);
    await settle(4);
    const st = liveStore.lines.get()[lineId];
    expect(st.provider).toBe("typed");
    expect(st.edited).toBe(true);
    expect(st.latex).toBe("x=4");
    expect(st.analysis?.verdict).toBe("ok");
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect((editor.shapesOfType("math")[0].props as MathShapeProps).status).toBe("ok");
  });

  it("never calls the LLM in off mode and pauses it while voice is active", async () => {
    loop.stop();
    resetLiveStore();
    loop = makeLoop("off");
    loop.start();
    editor.putUser(fixtureSingleLine());
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.quietMs + 1);
    await settle(8);
    expect(editor.shapesOfType("math")).toHaveLength(1);
    loop.requestCheck();
    loop.requestSolve();
    await settle();
    expect(streamCalls).toBe(0);
    loop.setOptions({ boardId: "board-1", mode: "suggest", enabled: true, voiceActive: true });
    loop.requestCheck();
    await settle();
    expect(streamCalls).toBe(0);
    loop.setOptions({ boardId: "board-1", mode: "suggest", enabled: true, voiceActive: false });
    loop.requestCheck();
    await settle();
    expect(streamCalls).toBe(1);
  });

  it("feedback: an 'unknown' equation triggers the LLM check only after the idle window, once", async () => {
    editor.putUser(fixtureSingleLine());
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.quietMs + 1);
    await settle(8);
    expect(editor.shapesOfType("math")).toHaveLength(1);
    expect(streamCalls).toBe(0);
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.unknownIdleMs - 10);
    await settle();
    expect(streamCalls).toBe(0);
    await vi.advanceTimersByTimeAsync(20);
    await settle(4);
    expect(streamCalls).toBe(1);
    // The idle re-render must not arm another idle timer (no repeated checks).
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.unknownIdleMs * 2);
    await settle(4);
    expect(streamCalls).toBe(1);
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it("low-confidence ink shows the unreadable chip after the delay, and new ink on the line cancels it", async () => {
    fetchJson.mockImplementation(async () => ({ latex: "2x+?", text: "", kind: "math", confidence: 0.3, provider: "mathpix", ms: 300 }));
    const strokes = fixtureSingleLine();
    editor.putUser(strokes.slice(0, -1));
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.quietMs + 1);
    await settle(8);
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(editor.shapesOfType("math")).toHaveLength(0);

    // Halfway through the chip delay the student adds the last stroke: the pending
    // chip is cancelled and the line is recognized again.
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.unreadableChipMs / 2);
    editor.putUser(strokes.slice(-1));
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.quietMs + 1);
    await settle(8);
    expect(fetchJson).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.unreadableChipMs / 2);
    await settle(4);
    expect(editor.shapesOfType("math")).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(LIVE_TIMING.unreadableChipMs / 2 + 5);
    await settle(4);
    const chips = editor.shapesOfType("math");
    expect(chips).toHaveLength(1);
    expect((chips[0].props as MathShapeProps).status).toBe("unknown");
    expect((chips[0].props as MathShapeProps).latex).toBe("");
    expect((chips[0].props as MathShapeProps).note).toMatch(/Couldn't read this/);
    expect(streamCalls).toBe(0);
  });

  it("controller: transcript, placeMath and plotFunction write live-meta shapes", async () => {
    editor.putUser(fixtureSingleLine());
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.quietMs + 1);
    await settle(8);
    const t = loop.getTranscript();
    expect(t.lines).toHaveLength(1);
    expect(t.lines[0].latex).toMatch(/^2x\+3=11/);
    const id = loop.placeMath({ latex: "2x = 8", nearLineId: t.lines[0].id });
    const gid = loop.plotFunction({ expr: "x^2", nearLineId: t.lines[0].id });
    expect(id).not.toBeNull();
    expect(gid).not.toBeNull();
    await settle();
    const placed = editor.getShape(id!)!;
    expect(placed.meta).toMatchObject({ live: true, source: "ai" });
    expect((placed.props as MathShapeProps).source).toBe("ai");
    const echoBounds = editor.getShapePageBounds(liveStore.lines.get()[t.lines[0].id].mathShapeId!)!;
    expect(placed.y).toBeGreaterThanOrEqual(echoBounds.maxY);
    expect(editor.getShape(gid!)!.type).toBe("graph");
    expect(liveStore.liveShapeCount.get()).toBe(3);
    // clearMarks removes AI shapes and keeps the echo
    loop.clearMarks();
    await settle();
    expect(editor.shapesOfType("math")).toHaveLength(1);
    expect(editor.shapesOfType("graph")).toHaveLength(0);
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });
});
