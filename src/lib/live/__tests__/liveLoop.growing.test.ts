import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TLShape } from "tldraw";
import { createFakeEditor, type FakeEditor } from "../__fixtures__/fakeEditor";
import { fixtureFraction, writeLine } from "../__fixtures__/strokes";
import { LIVE_TIMING, type LineAnalysis, type LiveEngine, type LiveSseEvent, type RecognizeResponse } from "../contracts";
import { createLiveLoop, type LiveLoop } from "../liveLoop";
import { liveStore, resetLiveStore } from "../liveStore";
import { RecognizeClient, type FetchJson } from "../recognizeClient";
import { settle } from "@/lib/live/__fixtures__/settle";
import { useSyncHash } from "@/lib/live/__fixtures__/syncHash";

/**
 * A pause mid-line (found by the film session): lifting the pen for ~1.5 s before the last stroke
 * of the 12 in `2x = 12` gets the half line read as `2x = 1` and ringed. When the student goes on
 * writing that line, the ring comes off at once — it does not stand (or finish drawing) until the
 * finished line is read again and ticked. Ink on another line leaves it alone.
 */

const engine: LiveEngine = {
  analyzeLine: (latex): LineAnalysis => ({
    kind: "equation",
    math: latex,
    resultLatex: "",
    verdict: latex === "2x=12" ? "ok" : latex === "2x=1" ? "mismatch" : "unknown",
    note: "",
  }),
  compileExpr: () => () => 0,
  solveLatex: () => null,
  verifyExpected: () => "unknown",
  balance: () => null,
  calculate: () => null,
};

const markOf = (s: TLShape) => String((s.meta as Record<string, unknown>).mark ?? "");

describe("live loop — a ring on a line the student is still writing", () => {
  useSyncHash();

  let editor: FakeEditor;
  let loop: LiveLoop;
  let reads: string[];

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    resetLiveStore();
    editor = createFakeEditor();
    reads = [];
    const fetchJson = vi.fn<FetchJson>(async (): Promise<RecognizeResponse> => {
      const latex = reads.length > 1 ? reads.shift()! : reads[0];
      return { latex, text: latex, kind: "math", confidence: 0.97, provider: "mathpix", ms: 100 };
    });
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

  async function frames(n: number): Promise<void> {
    for (let i = 0; i < n; i++) {
      await vi.advanceTimersByTimeAsync(16);
      await settle(1);
    }
  }

  const rings = () => editor.getCurrentPageShapes().filter((s) => markOf(s).startsWith("circle:"));
  const ticks = () => editor.getCurrentPageShapes().filter((s) => markOf(s).startsWith("check:"));

  /** `2x = 1` of `2x = 12`, read during the pause and ringed (the ring part way through being drawn) */
  async function pauseMidLine() {
    const line = writeLine("2x=12", 100, 200);
    const tail = line.pop()!;
    reads = ["2x=1", "2x=12"];
    editor.putUser(line);
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.quietMs + 1);
    await settle(8);
    await frames(6);
    expect(rings().length).toBeGreaterThan(0);
    return tail;
  }

  it("the last stroke of the line takes the ring off at once; the finished line is ticked", async () => {
    const tail = await pauseMidLine();
    editor.putUser([tail]);
    await settle(4);
    // before the line is read again
    expect(rings()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.rewriteQuietMs + LIVE_TIMING.quietMs + 1);
    await settle(8);
    await frames(120);
    expect(rings()).toHaveLength(0);
    expect(ticks().length).toBeGreaterThan(0);
  });

  it("ink just past the ringed line that turns out to be a line of its own: the ring comes back", async () => {
    // a tall line (a fraction, 78 px) of ordinary glyphs (26 px): its two line heights reach
    // further than the clustering's same-row join (three glyphs)
    reads = ["2x=1"];
    editor.putUser(fixtureFraction());
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.quietMs + 1);
    await settle(8);
    await frames(120);
    const ringed = Object.keys(liveStore.lines.get());
    expect(ringed).toHaveLength(1);
    expect(rings().length).toBeGreaterThan(0);
    // on the row, 120 px past its end: `inkExtendsLine` takes it for more of the line...
    reads = ["y"];
    editor.putUser(writeLine("4", 360, 200));
    await settle(4);
    expect(rings()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.rewriteQuietMs + LIVE_TIMING.quietMs + 1);
    await settle(8);
    await frames(120);
    // ...but the clustering makes it a line of its own: the ringed line is unchanged, not read again
    const lines = liveStore.lines.get();
    expect(Object.keys(lines)).toHaveLength(2);
    expect(lines[ringed[0]]).toBeDefined();
    // before: the ring stayed off for good (only a read puts one back)
    expect(rings().length).toBeGreaterThan(0);
    expect(new Set(rings().map((s) => (s.meta as Record<string, unknown>).lineId))).toEqual(new Set(ringed));
  });

  it("a stroke on the next line leaves the ring where it is", async () => {
    await pauseMidLine();
    editor.putUser(writeLine("x", 100, 300));
    await settle(4);
    expect(rings().length).toBeGreaterThan(0);
  });
});
