import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { TLDrawShape, TLRecord } from "tldraw";
import { createFakeEditor, type FakeEditor } from "../__fixtures__/fakeEditor";
import { fixtureTwoLines } from "../__fixtures__/strokes";
import { LIVE_TIMING, type HelpMode, type LineAnalysis, type LiveEngine, type LiveSseEvent, type RecognizeResponse } from "../contracts";
import { createLiveLoop, type LiveLoop } from "../liveLoop";
import { resetLiveStore } from "../liveStore";
import { RecognizeClient, type FetchJson } from "../recognizeClient";
import { settle } from "@/lib/live/__fixtures__/settle";
import { useSyncHash } from "@/lib/live/__fixtures__/syncHash";

/**
 * One tutor pen at a time. Turning the dial from Off straight to Suggest (or Solve) on a column with
 * a slip re-rendered the ring (`reanalyzeAll`) and wrote the right next step beside it
 * (`checkMismatchesAfterLadderRise`) in the same tick, each with its own writer: two pens writing
 * at once for about a second. The ring comes first, then the step — as when the dial is already on
 * Suggest, or goes there from Feedback (where the ring is already on the page).
 */

const engine: LiveEngine = {
  analyzeLine: (latex): LineAnalysis => {
    const base: LineAnalysis = { kind: "equation", math: latex, resultLatex: "", verdict: "unknown", note: "" };
    if (latex === "2x=8") return { ...base, verdict: "ok" };
    if (latex === "x=5") return { ...base, verdict: "mismatch", note: "Check the division" };
    return base;
  },
  compileExpr: () => () => 0,
  solveLatex: (latex) => (latex === "2x=8" ? { latex: "x = 4", steps: ["x = 4"] } : null),
  verifyExpected: () => "unknown",
  balance: () => null,
  calculate: () => null,
};

type Ev = { t: number; kind: "ring" | "step" };

describe("live loop — the dial raised from Off: the ring, then the step", () => {
  useSyncHash();

  let editor: FakeEditor;
  let fetchJson: Mock<FetchJson>;
  let loop: LiveLoop;
  let queue: string[];
  let timeline: Ev[];

  function makeLoop(mode: HelpMode): LiveLoop {
    return createLiveLoop(
      editor,
      { boardId: "board-1", mode, enabled: true },
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
  }

  async function write(shapes: TLDrawShape[], latex: string): Promise<void> {
    queue.push(latex);
    editor.putUser(shapes);
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.rewriteQuietMs + LIVE_TIMING.quietMs + 1);
    await settle(8);
  }

  /** Every write of the tutor's ring or step strokes, timestamped (fake clock). */
  function track(): void {
    const kindOf = (r: TLRecord): Ev["kind"] | null => {
      if (r.typeName !== "shape") return null;
      const meta = r.meta as Record<string, unknown>;
      if (typeof meta.mark === "string" && meta.mark.startsWith("circle:")) return "ring";
      if (typeof meta.suggestFor === "string") return "step";
      return null;
    };
    editor.store.listen(
      (entry) => {
        const touched = [...Object.values(entry.changes.added), ...Object.values(entry.changes.updated).map(([, to]) => to)];
        for (const r of touched) {
          const kind = kindOf(r);
          if (kind) timeline.push({ t: Date.now(), kind });
        }
      },
      { source: "all", scope: "document" },
    );
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    resetLiveStore();
    editor = createFakeEditor();
    queue = [];
    timeline = [];
    fetchJson = vi.fn<FetchJson>(async (): Promise<RecognizeResponse> => {
      const latex = queue.shift() ?? "x=5";
      return { latex, text: latex, kind: "math", confidence: 0.97, provider: "mathpix", ms: 100 };
    });
  });

  afterEach(() => {
    loop.stop();
    vi.useRealTimers();
  });

  it.each(["suggest", "answer"] as const)("Off -> %s: the step starts only once the ring is finished", async (mode) => {
    loop = makeLoop("off");
    loop.start();
    await settle(2);
    const [top, bottom] = [fixtureTwoLines().slice(0, 6), fixtureTwoLines().slice(6)];
    await write(top, "2x=8");
    await write(bottom, "x=5");
    // the student has stopped (the settle), then turns the dial
    await vi.advanceTimersByTimeAsync(3_000);
    await settle(4);
    track();
    loop.setOptions({ boardId: "board-1", mode, enabled: true });
    for (let i = 0; i < 300; i++) {
      await vi.advanceTimersByTimeAsync(16);
      await settle(1);
    }
    const ring = timeline.filter((e) => e.kind === "ring");
    const step = timeline.filter((e) => e.kind === "step");
    expect(ring.length).toBeGreaterThan(0);
    expect(step.length).toBeGreaterThan(0);
    // never both pens at once: the first stroke of the step after the last of the ring
    expect(step[0].t).toBeGreaterThanOrEqual(ring[ring.length - 1].t);
  });

  /** The step's strokes on the page: how many, and in how many written blocks. */
  function steps(): { shapes: number; blocks: number } {
    const shapes = editor.getCurrentPageShapes().filter((s) => typeof (s.meta as Record<string, unknown>).suggestFor === "string");
    return { shapes: shapes.length, blocks: new Set(shapes.map((s) => String((s.meta as Record<string, unknown>).handBlock))).size };
  }

  async function ringThenStep(during: () => void): Promise<{ shapes: number; blocks: number }> {
    loop = makeLoop("off");
    loop.start();
    await settle(2);
    const [top, bottom] = [fixtureTwoLines().slice(0, 6), fixtureTwoLines().slice(6)];
    await write(top, "2x=8");
    await write(bottom, "x=5");
    await vi.advanceTimersByTimeAsync(3_000);
    await settle(4);
    loop.setOptions({ boardId: "board-1", mode: "suggest", enabled: true });
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(16);
      await settle(1);
    }
    during();
    for (let i = 0; i < 400; i++) {
      await vi.advanceTimersByTimeAsync(16);
      await settle(1);
    }
    return steps();
  }

  it("asked twice while the ring is written (the dial down and up, or Help), the step is written once", async () => {
    const once = await ringThenStep(() => undefined);
    loop.stop();
    resetLiveStore();
    editor = createFakeEditor();
    queue = [];
    const twice = await ringThenStep(() => {
      loop.setOptions({ boardId: "board-1", mode: "off", enabled: true });
      loop.setOptions({ boardId: "board-1", mode: "suggest", enabled: true });
      loop.requestHelp();
    });
    expect(once.blocks).toBe(1);
    expect(twice).toEqual(once);
  });
});
