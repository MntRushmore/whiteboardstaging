import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { TLDrawShape, TLPageId, TLShape } from "tldraw";
import { createFakeEditor, type FakeEditor } from "../__fixtures__/fakeEditor";
import { drawShapeFromPoints, fixtureTwoLines } from "../__fixtures__/strokes";
import { isLiveMeta, LIVE_TIMING, type LineAnalysis, type LiveEngine, type LiveSseEvent, type RecognizeResponse } from "../contracts";
import { createLiveLoop, type LiveLoop } from "../liveLoop";
import { liveStore, resetLiveStore } from "../liveStore";
import { RecognizeClient, type FetchJson } from "../recognizeClient";
import { settle } from "@/lib/live/__fixtures__/settle";
import { useSyncHash } from "@/lib/live/__fixtures__/syncHash";

/**
 * Deleting a screen while the tutor is writing on it. The rest of the writing used to land on the
 * next screen: a writer's strokes carry the deleted page as parent and tldraw puts a shape with a
 * missing parent on the current page. And the restore put back what was on the page at that moment
 * — a step half written ("x = 1" for "x = 14"). Live now finishes every pen in place first
 * (`liveStore.finishWriting`, called by `deleteScreen`), and a writer whose page is gone writes nothing.
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

const meta = (s: TLShape) => s.meta as Record<string, unknown>;
const isStep = (s: TLShape) => typeof meta(s).suggestFor === "string";
const isRing = (s: TLShape) => typeof meta(s).mark === "string" && String(meta(s).mark).startsWith("circle:");

describe("live loop — a screen deleted while the tutor writes on it", () => {
  useSyncHash();

  let editor: FakeEditor;
  let loop: LiveLoop;
  let queue: string[];
  let first: TLPageId;
  let second: TLPageId;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    resetLiveStore();
    editor = createFakeEditor();
    queue = [];
    const fetchJson: Mock<FetchJson> = vi.fn<FetchJson>(async (): Promise<RecognizeResponse> => {
      const latex = queue.shift() ?? "x=5";
      return { latex, text: latex, kind: "math", confidence: 0.97, provider: "mathpix", ms: 100 };
    });
    first = editor.getCurrentPage().id;
    second = editor.addPage();
    loop = createLiveLoop(
      editor,
      { boardId: "board-1", mode: "suggest", enabled: true },
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
    editor.switchPage(second);
    await settle(2);
  });

  afterEach(() => {
    loop.stop();
    vi.useRealTimers();
  });

  async function write(shapes: TLDrawShape[], latex: string): Promise<void> {
    queue.push(latex);
    editor.putUser(shapes);
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.rewriteQuietMs + LIVE_TIMING.quietMs + 1);
    await settle(8);
  }

  async function frames(n: number): Promise<void> {
    for (let i = 0; i < n; i++) {
      await vi.advanceTimersByTimeAsync(16);
      await settle(1);
    }
  }

  /** A wrong line on the second screen: its ring, then (once the student stops) its step. */
  async function slip(): Promise<void> {
    const [top, bottom] = [fixtureTwoLines().slice(0, 6), fixtureTwoLines().slice(6)];
    await write(top, "2x=8");
    await write(bottom, "x=5");
  }

  /** Waits until the step has started but not finished. */
  async function midStep(): Promise<void> {
    for (let i = 0; i < 400 && !editor.getCurrentPageShapes().some(isStep); i++) await frames(1);
    expect(editor.getCurrentPageShapes().some(isStep)).toBe(true);
  }

  function shapesOn(page: TLPageId): TLShape[] {
    return editor.store.allRecords().filter((r): r is TLShape => r.typeName === "shape" && r.parentId === page);
  }

  /** What tldraw's deletePage does: show the screen before, delete the page's shapes and the page. */
  function deletePage(page: TLPageId, next: TLPageId): void {
    editor.switchPage(next);
    editor.removeUser(shapesOn(page).map((s) => s.id));
    editor.store.remove([page]);
  }

  it("finishing the pens first leaves the step whole on its own screen", async () => {
    await slip();
    await frames(400);
    const whole = shapesOn(second).filter(isStep).length;
    const ring = shapesOn(second).filter(isRing).length;
    expect(whole).toBeGreaterThan(0);

    // the same again on a fresh second screen, finished part way through the step
    const third = editor.addPage();
    editor.switchPage(third);
    await settle(2);
    await slip();
    await midStep();
    expect(shapesOn(third).filter(isStep).length).toBeLessThan(whole);
    liveStore.finishWriting.get()!();
    await settle(4);
    expect(shapesOn(third).filter(isStep)).toHaveLength(whole);
    expect(shapesOn(third).filter(isRing)).toHaveLength(ring);
  });

  it("a figure answer deleted with its screen is not 'dismissed' on the next one; rubbed out here, it is", async () => {
    /** the tutor's answer about a figure (a live write, not the student's) */
    const putAnswer = (id: string, page: TLPageId) => {
      const stroke = drawShapeFromPoints([{ x: 100, y: 100 }, { x: 120, y: 120 }], `shape:${id}` as TLShape["id"]);
      const meta = { live: true, source: "ai", lineId: "dg_1", createdAt: 1, solvedLatex: `figure:${id}` };
      editor.store.mergeRemoteChanges(() => editor.store.put([{ ...stroke, parentId: page, meta } as TLShape]));
    };
    const dismissed = (page: TLPageId) => (editor.store.get(page) as { meta: Record<string, unknown> } | undefined)?.meta.liveFiguresDismissed;
    putAnswer("gone", second);
    deletePage(second, first);
    await settle(4);
    expect(dismissed(first)).toBeUndefined();
    // the same on this screen, rubbed out by the student: remembered here
    putAnswer("here", first);
    editor.removeUser(["shape:here" as TLShape["id"]]);
    await settle(4);
    expect(dismissed(first)).toEqual(["figure:here"]);
  });

  it("whatever was still being written when the screen went, nothing of it lands on the next one", async () => {
    await slip();
    await midStep();
    const before = shapesOn(first).length;
    deletePage(second, first);
    await frames(300);
    expect(shapesOn(first).filter((s) => isLiveMeta(s.meta))).toHaveLength(0);
    expect(shapesOn(first)).toHaveLength(before);
  });
});
