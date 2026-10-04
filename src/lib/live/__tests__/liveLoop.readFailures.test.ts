import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { TLDrawShape, TLShape } from "tldraw";
import { createFakeEditor, type FakeEditor } from "../__fixtures__/fakeEditor";
import { writeLine } from "../__fixtures__/strokes";
import { LIVE_TIMING, type LineAnalysis, type LiveEngine, type LiveSseEvent, type RecognizeResponse, type UseLiveMathOptions } from "../contracts";
import { createLiveLoop, type LiveLoop } from "../liveLoop";
import { liveStore, resetLiveStore } from "../liveStore";
import { RecognizeClient, type FetchJson } from "../recognizeClient";
import { settle } from "@/lib/live/__fixtures__/settle";
import { useSyncHash } from "@/lib/live/__fixtures__/syncHash";

/**
 * A line the tutor could not read must say so on the line itself, with the tutor's "?" — the
 * readback chip alone is hidden while the pen is in hand (MathShapeUtil), which is all the time
 * on a writing board — and it must not stay unread for want of one more try.
 */

const engine: LiveEngine = {
  analyzeLine: (latex): LineAnalysis => ({
    kind: "equation",
    math: latex,
    resultLatex: "",
    verdict: latex === "x=4" ? "ok" : "unknown",
    note: "",
  }),
  compileExpr: () => () => 0,
  solveLatex: () => null,
  verifyExpected: () => "unknown",
  balance: () => null,
  calculate: () => null,
};

const QUIET = LIVE_TIMING.rewriteQuietMs + LIVE_TIMING.quietMs + 1;
const markOf = (s: TLShape) => String((s.meta as Record<string, unknown>).mark ?? "");

function read(latex: string, confidence = 0.97): RecognizeResponse {
  return { latex, text: latex, kind: "math", confidence, provider: "mathpix", ms: 100 };
}

describe("live loop — reads that fail or come back unsure", () => {
  useSyncHash();

  let editor: FakeEditor;
  let loop: LiveLoop;
  let opts: UseLiveMathOptions;
  let fetchJson: Mock<FetchJson>;
  let online: boolean;
  /** what the recognizer does next, FIFO; the last one repeats */
  let script: Array<RecognizeResponse | Error>;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    resetLiveStore();
    editor = createFakeEditor();
    script = [read("2x=8")];
    online = true;
    fetchJson = vi.fn<FetchJson>(async (): Promise<RecognizeResponse> => {
      const next = script.length > 1 ? script.shift()! : script[0];
      if (next instanceof Error) throw next;
      return next;
    });
    opts = { boardId: "board-1", mode: "feedback", enabled: true };
    loop = createLiveLoop(editor, opts, {
      recognizer: new RecognizeClient({ fetchJson }),
      stream: async function* (): AsyncGenerator<LiveSseEvent, void, undefined> {},
      getEngine: async () => engine,
      fetchCapabilities: async () => ({ recognizer: "mathpix", liveEnabled: true, models: { check: "c", solve: "s", vision: "v" } }),
      events: null,
      isOnline: () => online,
      handwritingEnabled: () => true,
      reducedMotion: () => false,
    });
    loop.start();
    await settle(2);
  });

  afterEach(() => {
    loop.stop();
    vi.useRealTimers();
  });

  /** time passes in animation-sized steps, so the tutor's pen gets to write its marks */
  async function wait(ms: number): Promise<void> {
    for (let t = 0; t < ms; t += 50) {
      await vi.advanceTimersByTimeAsync(50);
      await settle(1);
    }
    await settle(4);
  }

  async function penUp(shapes: TLDrawShape[]): Promise<void> {
    editor.putUser(shapes);
    await vi.advanceTimersByTimeAsync(QUIET);
    await settle(8);
  }

  /** the "?" marks on the page, one per line (a mark is several strokes sharing its key) */
  const questions = () => [...new Set(editor.getCurrentPageShapes().map(markOf).filter((m) => m.startsWith("question:")))];
  const calls = () => fetchJson.mock.calls.length;
  const lineIds = () => Object.keys(liveStore.lines.get());

  // ---------------------------------------------------------------- the unsure read's "?"
  describe("a read the recognizer is unsure of", () => {
    it("gets its '?' back when the line is written on and read unsure again", async () => {
      script = [read("2x+?", 0.3)];
      const line = writeLine("2x=8", 100, 200);
      const last = line.pop()!;
      await penUp(line);
      await wait(LIVE_TIMING.unreadableChipMs + 400);
      expect(questions()).toHaveLength(1);

      // the student adds a stroke to the same line; still unsure
      await penUp([last]);
      expect(calls()).toBe(2);
      expect(lineIds()).toHaveLength(1);
      // the new read waits its own delay, like the first one did (the student may still be writing)
      await wait(1000);
      expect(questions()).toHaveLength(0);
      await wait(LIVE_TIMING.unreadableChipMs);
      // before: the "?" came off with the re-read and never came back
      expect(questions()).toHaveLength(1);
    });

    it("keeps its '?' when the line above is read again (a re-render of the same read)", async () => {
      script = [read("x=5"), read("2x+?", 0.3)];
      await penUp(writeLine("x=4", 100, 200));
      await penUp(writeLine("2x=8", 100, 290));
      expect(lineIds()).toHaveLength(2);
      await wait(LIVE_TIMING.unreadableChipMs + 400);
      expect(questions()).toHaveLength(1);

      // the line above grows (`x=5` -> `x=54`): read again, and the column under it re-rendered
      script = [read("x=54")];
      await penUp(writeLine("4", 214, 200));
      expect(calls()).toBe(3);
      expect(lineIds()).toHaveLength(2);
      await wait(1000);
      expect(questions()).toHaveLength(1);
    });
  });
});
