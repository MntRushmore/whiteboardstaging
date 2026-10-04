import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { createFakeEditor, type FakeEditor } from "../__fixtures__/fakeEditor";
import { writeLine as inkLine } from "../__fixtures__/strokes";
import { settleUntil } from "@/lib/live/__fixtures__/settle";
import { useSyncHash } from "@/lib/live/__fixtures__/syncHash";
import { LIVE_TIMING, type HelpMode, type LiveEngine, type LiveSseEvent, type RecognizeRequest, type RecognizeResponse } from "../contracts";
import { getEngine } from "../engine";
import { createLiveLoop, type LiveLoop } from "../liveLoop";
import { liveStore, resetLiveStore } from "../liveStore";
import { RecognizeClient, type FetchJson } from "../recognizeClient";
import { DEFAULT_SCREEN } from "@/lib/screens/screens";

/**
 * One screen is one context. The infinite canvas let a problem written further down the page
 * be read as the next step of the one above it; screens make that impossible by construction:
 * Live reads the current screen only and forgets the one the student left.
 */

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

describe("live loop — screens", () => {
  useSyncHash();

  let editor: FakeEditor;
  let fetchJson: Mock<FetchJson>;
  let loop: LiveLoop;
  let streamCalls: string[];
  let script: string[];
  let assigned: Map<string, string>;

  function makeLoop(mode: HelpMode): LiveLoop {
    const stream = async function* (path: string): AsyncGenerator<LiveSseEvent, void, undefined> {
      streamCalls.push(path);
    };
    return createLiveLoop(
      editor,
      { boardId: "board-1", mode, enabled: true },
      {
        recognizer: new RecognizeClient({ fetchJson }),
        stream,
        getEngine: async () => engine,
        fetchCapabilities: async () => ({ recognizer: "mathpix", liveEnabled: true, models: { check: "c", solve: "s", vision: "v" } }),
        events: null,
        isOnline: () => true,
        handwritingEnabled: () => true,
        reducedMotion: () => true,
      },
    );
  }

  /** Writes `ink` at `y`, read back as `latex`; resolves with the new line's id once it is read. */
  async function penLine(ink: string, y: number, latex: string): Promise<string> {
    script.push(latex);
    const before = new Set(Object.keys(liveStore.lines.get()));
    editor.putUser(inkLine(ink, 100, y, 40));
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.quietMs + 300);
    await settleUntil(() => Object.entries(liveStore.lines.get()).some(([id, st]) => !before.has(id) && Boolean(st.analysis)));
    const added = Object.keys(liveStore.lines.get()).find((id) => !before.has(id));
    if (!added) throw new Error(`${ink} produced no line`);
    return added;
  }

  function start(mode: HelpMode = "feedback"): void {
    loop = makeLoop(mode);
    loop.start();
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    resetLiveStore();
    editor = createFakeEditor();
    streamCalls = [];
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
  });

  afterEach(() => {
    loop?.stop();
    vi.useRealTimers();
  });

  it("on one canvas, a line under someone else's work is checked as its next step (the bug)", async () => {
    start();
    await penLine("2x=8", 200, "2x=8");
    const second = await penLine("x=1", 280, "x=1");
    expect(liveStore.lines.get()[second].analysis?.verdict).toBe("mismatch");
  });

  it("the same line on a new screen is a problem of its own", async () => {
    start();
    await penLine("2x=8", 200, "2x=8");
    const screen2 = editor.addPage({ screen: { ...DEFAULT_SCREEN } });
    editor.switchPage(screen2);
    expect(liveStore.lines.get()).toEqual({});

    const line = await penLine("x=1", 280, "x=1");
    const state = liveStore.lines.get()[line];
    expect(state.line.row).toBe(0);
    expect(state.analysis?.verdict).not.toBe("mismatch");
    // nothing from the first screen is in scope
    expect(Object.values(liveStore.lines.get()).map((s) => s.latex)).toEqual(["x=1"]);
  });

  it("coming back to a screen brings its lines back from their echoes", async () => {
    start();
    const first = editor.getCurrentPage().id;
    await penLine("2x=8", 200, "2x=8");
    const screen2 = editor.addPage({ screen: { ...DEFAULT_SCREEN } });
    editor.switchPage(screen2);
    await penLine("x=1", 280, "x=1");

    editor.switchPage(first);
    const latex = Object.values(liveStore.lines.get()).map((s) => s.latex);
    expect(latex).toEqual(["2x=8"]);
  });

  it("does not re-read or call a model on a screen switch", async () => {
    start();
    await penLine("2x=8", 200, "2x=8");
    const reads = fetchJson.mock.calls.length;
    const screen2 = editor.addPage({ screen: { ...DEFAULT_SCREEN } });
    editor.switchPage(screen2);
    editor.switchPage(editor.store.allRecords().find((r) => r.typeName === "page" && r.id !== screen2)!.id as typeof screen2);
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.stuckMs + 100);
    expect(fetchJson.mock.calls.length).toBe(reads);
    expect(streamCalls).toEqual([]);
  });

  it("does not write the same worked solution twice when Solve / Help is pressed again", async () => {
    start("answer");
    const line = await penLine("2x=8", 200, "2x=8");
    const tutorInk = () => editor.shapesOfType("draw").filter((s) => (s.meta as { live?: unknown }).live !== undefined).length;
    loop.requestSolve(line);
    await settleUntil(() => tutorInk() > 0);
    await vi.advanceTimersByTimeAsync(100);
    const once = tutorInk();
    loop.requestSolve(line);
    await vi.advanceTimersByTimeAsync(500);
    expect(tutorInk()).toBe(once);
    expect(streamCalls).toEqual([]);
  });

  it("places a solve step that would run off the bottom of the screen beside the work", async () => {
    start("answer");
    editor.store.put([{ ...editor.getCurrentPage(), meta: { screen: { x: 0, y: 0, w: 1600, h: 330 } } }]);
    // two steps (`2x = 8`, `x = 4`): a block too tall for the space under the work
    const line = await penLine("2x=8", 200, "2x+3=11");
    loop.requestSolve(line);
    await settleUntil(() => editor.shapesOfType("draw").some((s) => (s.meta as { live?: unknown }).live !== undefined));
    await vi.advanceTimersByTimeAsync(100);
    const tutor = editor.shapesOfType("draw").filter((s) => (s.meta as { live?: unknown }).live !== undefined);
    expect(tutor.length).toBeGreaterThan(0);
    for (const s of tutor) {
      const b = editor.getShapePageBounds(s)!;
      expect(b.maxY).toBeLessThanOrEqual(330);
      // beside the ink (which ends at x ≈ 240), not under it
      expect(b.x).toBeGreaterThan(240);
    }
    expect(streamCalls).toEqual([]);
  });
});
