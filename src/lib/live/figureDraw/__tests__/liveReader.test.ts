import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { createShapeId, type TLShape } from "tldraw";
import { createFakeEditor, type FakeEditor } from "../../__fixtures__/fakeEditor";
import { settleStable } from "../../__fixtures__/settle";
import { useSyncHash } from "../../__fixtures__/syncHash";
import { LIVE_TIMING, isLiveMeta, type LiveEngine, type LiveSseEvent, type RecognizeResponse } from "../../contracts";
import { getEngine } from "../../engine";
import { HAND_WRITE } from "../../handwriting";
import { ANSWER_SETTLE_MS, createLiveLoop, type LiveLoop } from "../../liveLoop";
import { liveStore, resetLiveStore } from "../../liveStore";
import { RecognizeClient, type FetchJson } from "../../recognizeClient";
import { FIGURE_META, drawFigureOnBoard, type FigureBoardEditor } from "../board";
import { FIGURE_GALLERY } from "./gallery";

/**
 * A figure the tutor draws is the tutor's ink, not the student's: every stroke carries the Live
 * meta (`live: true`, `source: "ai"`), and the Live reader (`isStudentInk` in liveLoop.ts) passes
 * over it — no recognition, no line, no drawing read as the student's — even when its records
 * come back user-sourced (an undo, a paste). The same strokes without that meta ARE read, which
 * is what makes the first half of the test mean something.
 */
let engine: LiveEngine;
// the engine's first load is slow on a loaded machine (the whole suite in parallel)
beforeAll(async () => {
  engine = await getEngine();
}, 60_000);

describe("a figure drawn by the tutor, and the Live reader", () => {
  useSyncHash();

  let editor: FakeEditor;
  let fetchJson: Mock<FetchJson>;
  let loop: LiveLoop;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    resetLiveStore();
    editor = createFakeEditor();
    fetchJson = vi.fn<FetchJson>(async (): Promise<RecognizeResponse> => ({ latex: "A", text: "", kind: "math", confidence: 0.97, provider: "mathpix", ms: 300 }));
    loop = createLiveLoop(
      editor,
      { boardId: "board-1", mode: "answer", enabled: true },
      {
        recognizer: new RecognizeClient({ fetchJson }),
        stream: async function* (): AsyncGenerator<LiveSseEvent, void, undefined> {},
        getEngine: async () => engine,
        fetchCapabilities: async () => ({ recognizer: "mathpix", liveEnabled: true, models: { check: "c", solve: "s", vision: "v" } }),
        events: null,
        isOnline: () => true,
        handwritingEnabled: () => true,
        reducedMotion: () => true,
        setup: async () => {
          throw new Error("no word problems here");
        },
        reread: async () => {
          throw new Error("no second reader here");
        },
      },
    );
    loop.start();
  });

  afterEach(() => {
    loop.stop();
    vi.useRealTimers();
  });

  const figureStrokes = (): TLShape[] => editor.getCurrentPageShapes().filter((s) => Boolean((s.meta as Record<string, unknown>)[FIGURE_META]));
  const idle = async () => {
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.quietMs + ANSWER_SETTLE_MS + 1000);
    await settleStable(() => `${fetchJson.mock.calls.length}|${Object.keys(liveStore.lines.get()).length}|${liveStore.diagrams.get().length}`);
  };
  const copies = (shapes: readonly TLShape[], meta?: object): TLShape[] => shapes.map((s) => ({ ...s, id: createShapeId(), meta: (meta ?? s.meta) as TLShape["meta"] }));

  it("is written in the tutor's hand and never read as the student's ink", async () => {
    const spec = FIGURE_GALLERY[0].spec;
    const drawn = drawFigureOnBoard(editor as unknown as FigureBoardEditor, spec, { seed: 3 });
    expect(drawn.problems).toEqual([]);
    expect(drawn.rect).not.toBeNull();
    await vi.advanceTimersByTimeAsync(8000);
    expect(drawn.writer?.active).toBe(false);

    const strokes = figureStrokes();
    expect(strokes.length).toBeGreaterThan(10);
    for (const s of strokes) {
      expect(s.type).toBe("draw");
      expect(isLiveMeta(s.meta) && s.meta.source === "ai").toBe(true);
      expect((s.props as { color: string }).color).toBe(HAND_WRITE.color);
    }
    await idle();
    expect(fetchJson).not.toHaveBeenCalled();
    expect(liveStore.lines.get()).toEqual({});
    expect(liveStore.diagrams.get()).toEqual([]);

    // the same records put back user-sourced (an undo, a paste): still the tutor's
    editor.putUser(copies(strokes));
    await idle();
    expect(fetchJson).not.toHaveBeenCalled();
    expect(liveStore.lines.get()).toEqual({});
    expect(liveStore.diagrams.get()).toEqual([]);

    // control: the very same strokes without the tutor's meta are the student's, and are read
    editor.putUser(copies(strokes, {}));
    await idle();
    expect(fetchJson.mock.calls.length + liveStore.diagrams.get().length + Object.keys(liveStore.lines.get()).length).toBeGreaterThan(0);
  }, 30_000);
});
