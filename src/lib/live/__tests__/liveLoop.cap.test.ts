import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TLShape } from "tldraw";
import { createFakeEditor, type FakeEditor } from "../__fixtures__/fakeEditor";
import { writeLine } from "../__fixtures__/strokes";
import { LIVE_LIMITS, LIVE_TIMING, type LineAnalysis, type LiveEngine, type LiveSseEvent, type RecognizeResponse } from "../contracts";
import { createLiveLoop, type LiveLoop } from "../liveLoop";
import { liveStore, resetLiveStore } from "../liveStore";
import { RecognizeClient, type FetchJson } from "../recognizeClient";
import { settle } from "@/lib/live/__fixtures__/settle";
import { useSyncHash } from "@/lib/live/__fixtures__/syncHash";

/**
 * The cap on the tutor's marks per screen (`LIVE_LIMITS.maxLiveShapesPerBoard`) counts the tutor's
 * marks: what Clear marks takes away. It used to count each line's readback too, so every line
 * cost two (its readback and its tick) and a long page went quiet after about 30 lines.
 */

const engine: LiveEngine = {
  analyzeLine: (latex): LineAnalysis => ({ kind: "equation", math: latex, resultLatex: "", verdict: latex === "x=4" ? "ok" : "unknown", note: "" }),
  compileExpr: () => () => 0,
  solveLatex: () => null,
  verifyExpected: () => "unknown",
  balance: () => null,
  calculate: () => null,
};

const markOf = (s: TLShape) => String((s.meta as Record<string, unknown>).mark ?? "");

describe("live loop — the mark cap on a long page", () => {
  useSyncHash();

  let editor: FakeEditor;
  let loop: LiveLoop;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    resetLiveStore();
    editor = createFakeEditor();
    const fetchJson = vi.fn<FetchJson>(async (): Promise<RecognizeResponse> => ({ latex: "x=4", text: "x=4", kind: "math", confidence: 0.97, provider: "mathpix", ms: 100 }));
    loop = createLiveLoop(
      editor,
      { boardId: "board-1", mode: "feedback", enabled: true },
      {
        recognizer: new RecognizeClient({ fetchJson }),
        stream: async function* (): AsyncGenerator<LiveSseEvent, void, undefined> {},
        getEngine: async () => engine,
        fetchCapabilities: async () => ({ recognizer: "mathpix", liveEnabled: true, models: { check: "c", solve: "s", vision: "v" } }),
        events: null,
        isOnline: () => true,
        handwritingEnabled: () => true,
        reducedMotion: () => false,
      },
    );
    loop.start();
    await settle(2);
  });

  afterEach(() => {
    loop.stop();
    vi.useRealTimers();
  });

  /** the ticks on the page, one per line (a tick is several strokes sharing its key) */
  const ticks = () => new Set(editor.getCurrentPageShapes().map(markOf).filter((m) => m.startsWith("check:"))).size;

  it("line 31 onwards is still ticked: readbacks do not use up the cap", async () => {
    const LINES = 34;
    for (let i = 0; i < LINES; i++) {
      const column = i < 17 ? 100 : 700;
      editor.putUser(writeLine("x=4", column, 80 + (i % 17) * 55, 36));
      await vi.advanceTimersByTimeAsync(LIVE_TIMING.quietMs + 1);
      await settle(8);
      for (let f = 0; f < 60; f++) {
        await vi.advanceTimersByTimeAsync(16);
        await settle(1);
      }
    }
    expect(Object.keys(liveStore.lines.get())).toHaveLength(LINES);
    expect(editor.shapesOfType("math")).toHaveLength(LINES);
    // before: ticks stopped at 30 (30 readbacks + 30 ticks = the cap of 60)
    expect(ticks()).toBe(LINES);
    expect(liveStore.liveShapeCount.get()).toBe(LINES);
    expect(liveStore.liveShapeCount.get()).toBeLessThan(LIVE_LIMITS.maxLiveShapesPerBoard);

    // Clear marks takes every tick away and the count with it; the readbacks stay
    loop.clearMarks();
    await settle(4);
    expect(ticks()).toBe(0);
    expect(liveStore.liveShapeCount.get()).toBe(0);
    expect(editor.shapesOfType("math")).toHaveLength(LINES);
  });
});
