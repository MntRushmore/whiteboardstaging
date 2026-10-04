import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { TLDrawShape, TLShape, TLShapeId } from "tldraw";
import { createFakeEditor, type FakeEditor } from "../__fixtures__/fakeEditor";
import { writeLine } from "../__fixtures__/strokes";
import { settle, settleStable, settleUntil } from "@/lib/live/__fixtures__/settle";
import { useSyncHash } from "@/lib/live/__fixtures__/syncHash";
import { LIVE_TIMING, type HelpMode, type LiveEngine, type LiveSseEvent, type RecognizeRequest, type RecognizeResponse } from "../contracts";
import { getEngine } from "../engine";
import { createLiveLoop, type LiveLoop } from "../liveLoop";
import { liveStore, resetLiveStore } from "../liveStore";
import { RecognizeClient, type FetchJson } from "../recognizeClient";
import { DEFAULT_SCREEN } from "@/lib/screens/screens";
import { problemMetaOf } from "../chat/cells";
import type { ChatAction, ChatRunReport } from "../chat/contracts";

/**
 * "Multiple problems on the screen — how does the AI know?" Help me / Solve it act on the problem
 * the student is working on: the one they last wrote in with the pen, or the one they picked with
 * the select tool. Rubbing out, dragging or Undo in another problem re-reads lines there, and before
 * this the last line re-read was "the line": rub out a slip in A while working on B, tap Help, and
 * the tutor wrote under A.
 */

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

describe("live loop — which problem Help acts on", () => {
  useSyncHash();

  let editor: FakeEditor;
  let fetchJson: Mock<FetchJson>;
  let loop: LiveLoop;
  /** reads in writing order: each new line takes the next one, and keeps it when read again */
  let script: string[];
  let assigned: Map<string, string>;

  function start(mode: HelpMode = "feedback"): void {
    loop = createLiveLoop(
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
        reducedMotion: () => true,
      },
    );
    loop.start();
  }

  /** The pen writes `ink` at (x, y), read as `latex`; resolves with its line once it is analysed. */
  async function pen(ink: string, x: number, y: number, latex: string): Promise<{ id: string; strokes: TLDrawShape[] }> {
    script.push(latex);
    const before = new Set(Object.keys(liveStore.lines.get()));
    const strokes = writeLine(ink, x, y, 40);
    editor.putUser(strokes);
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.quietMs + 300);
    await settleUntil(() => Object.entries(liveStore.lines.get()).some(([id, st]) => !before.has(id) && Boolean(st.analysis)));
    const id = Object.keys(liveStore.lines.get()).find((k) => !before.has(k));
    if (!id) throw new Error(`${ink} produced no line`);
    return { id, strokes };
  }

  /** Lets a flush and its reads run out. */
  async function quiet(): Promise<void> {
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.rewriteQuietMs + 300);
    await settle();
    await settleStable(() => `${fetchJson.mock.calls.length}|${editor.getCurrentPageShapes().length}`);
  }

  async function run(actions: ChatAction[]): Promise<ChatRunReport> {
    let result: ChatRunReport | null = null;
    void loop.runChatActions(actions).then((r) => (result = r));
    for (let i = 0; i < 400 && !result; i++) await vi.advanceTimersByTimeAsync(50);
    if (!result) throw new Error("the chat never finished");
    return result;
  }

  /** What Help acts on: the line `escalate` is given (Feedback / Suggest on a line it can act on). */
  function helpLine(): string | undefined {
    const asked = vi.spyOn(loop, "escalate").mockImplementation(() => {});
    loop.requestHelp();
    const id = asked.mock.calls.at(-1)?.[0];
    asked.mockRestore();
    return id;
  }

  const lineOf = (id: string) => liveStore.lines.get()[id];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    resetLiveStore();
    editor = createFakeEditor();
    const page = editor.getCurrentPage();
    editor.store.put([{ ...page, meta: { screen: { ...DEFAULT_SCREEN } } }]);
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

  describe("two problems of the student's own, side by side", () => {
    /** A: `2x = 8`, `x = 4` on the left; B: `3x = 12` on the right, written last. */
    async function twoProblems() {
      start("feedback");
      const a1 = await pen("2x=8", 100, 200, "2x=8");
      const a2 = await pen("x=4", 100, 290, "x=4");
      const b1 = await pen("3x=12", 800, 200, "3x=12");
      expect(lineOf(a1.id).line.column).not.toBe(lineOf(b1.id).line.column);
      return { a1, a2, b1 };
    }

    it("writes in A, then B, then rubs something out in A: Help acts on B", async () => {
      const { a2, b1 } = await twoProblems();
      expect(helpLine()).toBe(b1.id);
      // a slip rubbed out in A: A's line is read again (Live's last read is there now)
      editor.removeUser([a2.strokes.at(-1)!.id]);
      await quiet();
      expect(fetchJson.mock.calls.some(([, body]) => (body as RecognizeRequest).lineId === a2.id)).toBe(true);
      expect(loop.helpTargetLine()?.line.id).toBe(b1.id);
      expect(helpLine()).toBe(b1.id);
    });

    it("Solve it acts on B too", async () => {
      const { a2, b1 } = await twoProblems();
      loop.setOptions({ boardId: "board-1", mode: "answer", enabled: true });
      editor.removeUser([a2.strokes.at(-1)!.id]);
      await quiet();
      const solved = vi.spyOn(loop, "requestSolve");
      loop.requestHelp();
      expect(solved.mock.calls[0]?.[0]).toBe(b1.id);
    });

    it("dragging all of A's ink (one pass re-reads both its lines) does not move Help either", async () => {
      const { a1, a2, b1 } = await twoProblems();
      for (const s of [...a1.strokes, ...a2.strokes]) editor.updateUser(s.id, (shape) => ({ ...shape, x: shape.x + 6, y: shape.y + 4 }) as TLShape);
      await quiet();
      expect(helpLine()).toBe(b1.id);
    });

    it("Undo in A (strokes rubbed out coming back) is not the pen: Help stays on B", async () => {
      const { a2, b1 } = await twoProblems();
      editor.removeUser(a2.strokes.map((s) => s.id));
      await quiet();
      editor.putUser(a2.strokes);
      await quiet();
      expect(helpLine()).toBe(b1.id);
    });

    it("the pen going back to A moves Help back to A", async () => {
      const { b1 } = await twoProblems();
      expect(helpLine()).toBe(b1.id);
      const a3 = await pen("x=4", 100, 380, "x=4");
      expect(helpLine()).toBe(a3.id);
    });

    it("rubbing out the very line the pen wrote: Help stays with that problem while the line is there", async () => {
      const { b1 } = await twoProblems();
      const b2 = await pen("x=4", 800, 290, "x=4");
      editor.removeUser([b2.strokes.at(-1)!.id]);
      await quiet();
      expect(helpLine()).toBe(b2.id);
      expect(lineOf(b1.id)).toBeDefined();
    });

    it("a tap on A with the select tool picks it — its line, its readback, a lasso of all of it — until the selection is cleared", async () => {
      const { a1, a2, b1 } = await twoProblems();
      editor.select([a1.strokes[0].id]);
      expect(helpLine()).toBe(a1.id);
      // a lasso over all of A, clipping a stroke of B: A's lowest line
      editor.select([...a1.strokes, ...a2.strokes, b1.strokes[0]].map((s) => s.id));
      expect(helpLine()).toBe(a2.id);
      // its readback picks the line it reads
      const echo = lineOf(a1.id).mathShapeId;
      expect(echo).toBeTruthy();
      editor.select([echo!]);
      expect(helpLine()).toBe(a1.id);
      // cleared: the pen again
      editor.select([]);
      expect(helpLine()).toBe(b1.id);
    });

    it("picked, then the pen writes elsewhere: Help follows the pen (tldraw keeps the selection, unseen)", async () => {
      const { a1, a2, b1 } = await twoProblems();
      editor.select([...a1.strokes, ...a2.strokes].map((s) => s.id));
      expect(helpLine()).toBe(a2.id);
      const b2 = await pen("x=4", 800, 290, "x=4");
      expect(editor.getSelectedShapeIds()).not.toEqual([]);
      expect(helpLine()).toBe(b2.id);
      // a stroke rubbed out leaves the selection: that picks nothing either
      editor.select(a1.strokes.map((s) => s.id));
      editor.select(a1.strokes.slice(1).map((s) => s.id));
      await pen("x=4", 800, 380, "x=4");
      editor.select(a1.strokes.slice(2).map((s) => s.id));
      expect(helpLine()).not.toBe(a1.id);
      // picking A again: A
      editor.select([a2.strokes[0].id]);
      expect(helpLine()).toBe(a2.id);
      expect(b1.id).toBeTruthy();
    });

    it("a pick of something that is no problem's (a sticky note, a box of their own) leaves Help with the pen", async () => {
      const { b1 } = await twoProblems();
      editor.createShapes([{ id: "shape:own" as TLShapeId, type: "math", x: 1200, y: 600, meta: {}, props: { latex: "y" } }]);
      editor.select(["shape:own" as TLShapeId]);
      expect(helpLine()).toBe(b1.id);
    });

    it("publishes the problem for the outline: B with a moment when the pen moved there, unmoved by A's rub-out, A once picked", async () => {
      const { a1, a2, b1 } = await twoProblems();
      const onB = liveStore.helpTarget.get();
      expect(onB).toMatchObject({ key: `c:${b1.id}`, column: lineOf(b1.id).line.column, by: "pen", problems: 2 });
      expect(onB!.changedAt).toBeGreaterThan(0);
      expect(onB!.bounds).toEqual(lineOf(b1.id).line.bounds);

      editor.removeUser([a2.strokes.at(-1)!.id]);
      await quiet();
      expect(liveStore.helpTarget.get()?.key).toBe(`c:${b1.id}`);
      expect(liveStore.helpTarget.get()?.changedAt).toBe(onB!.changedAt);

      vi.advanceTimersByTime(5_000);
      editor.select([a2.strokes[0].id]);
      const onA = liveStore.helpTarget.get()!;
      expect(onA).toMatchObject({ key: `c:${a1.id}`, by: "selection", problems: 2 });
      expect(onA.changedAt).toBeGreaterThan(onB!.changedAt);
      // the whole of A: both its lines
      const r1 = lineOf(a1.id).line.bounds;
      const r2 = lineOf(a2.id).line.bounds;
      expect(onA.bounds.y).toBe(Math.min(r1.y, r2.y));
      expect(onA.bounds.y + onA.bounds.h).toBe(Math.max(r1.y + r1.h, r2.y + r2.h));

      editor.select([]);
      expect(liveStore.helpTarget.get()).toMatchObject({ key: `c:${b1.id}`, by: "pen" });
    });

    it("an ask is stamped for the outline", async () => {
      await twoProblems();
      vi.setSystemTime(new Date(2_000_000));
      helpLine();
      expect(liveStore.askedAt.get()).toBe(2_000_000);
    });

    it("one problem: published all the same (the outline is what stays quiet), and nothing on a fresh screen", async () => {
      start("feedback");
      expect(liveStore.helpTarget.get()).toBeNull();
      const a1 = await pen("2x=8", 100, 200, "2x=8");
      expect(liveStore.helpTarget.get()).toMatchObject({ key: `c:${a1.id}`, problems: 1, changedAt: 0 });
    });
  });

  describe("the chat's problems", () => {
    const meta = (s: TLShape) => s.meta as Record<string, unknown>;
    const problemInk = (n: number) => editor.getCurrentPageShapes().filter((s) => problemMetaOf(meta(s))?.n === n);
    /** where the student writes under problem n: just under its ink, inside its cell */
    function under(n: number): { x: number; y: number } {
      const bs = problemInk(n).map((s) => editor.getShapePageBounds(s)!);
      return { x: Math.min(...bs.map((b) => b.x)) + 10, y: Math.max(...bs.map((b) => b.maxY)) + 40 };
    }

    it("the current problem follows the pen too: work under 1, then 2, a rub-out under 1 — Help is about 2", async () => {
      start("feedback");
      await run([{ type: "write_problems", problems: [["2x + 3 = 11"], ["3x = 12"]] }]);
      const p1 = under(1);
      const one = await pen("2x=8", p1.x, p1.y, "2x=8");
      const p2 = under(2);
      const two = await pen("x=4", p2.x, p2.y, "x=4");
      expect(helpLine()).toBe(two.id);
      editor.removeUser([one.strokes.at(-1)!.id]);
      await quiet();
      expect(helpLine()).toBe(two.id);
      // picking problem 1's own ink: its work
      editor.select(problemInk(1).map((s) => s.id));
      expect(helpLine()).toBe(one.id);
      expect(liveStore.helpTarget.get()?.key.startsWith("p:")).toBe(true);
      expect(liveStore.helpTarget.get()?.by).toBe("selection");
    });
  });
});
