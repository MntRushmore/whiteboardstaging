import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { TLShape } from "tldraw";
import { createFakeEditor, type FakeEditor } from "../__fixtures__/fakeEditor";
import { settle, settleStable, settleUntil } from "../__fixtures__/settle";
import { useSyncHash } from "../__fixtures__/syncHash";
import { youngLine, youngShapes, type Pt } from "../__fixtures__/youngInk";
import { isLiveMeta, LIVE_TIMING, type LiveEngine, type LiveSseEvent, type RecognizeRequest, type RecognizeResponse } from "../contracts";
import { getEngine } from "../engine";
import { createLiveLoop, type LiveLoop } from "../liveLoop";
import { liveStore, resetLiveStore } from "../liveStore";
import { RecognizeClient, type FetchJson } from "../recognizeClient";
import { DEFAULT_SCREEN } from "@/lib/screens/screens";
import { problemMetaOf } from "../chat/cells";
import type { ChatAction, ChatRunReport } from "../chat/contracts";

/**
 * A young student on an iPad answers the tutor's sums (a real board, 2026-10-06, made synthetic:
 * "Addition practice", `1. 4+3` … `4. 8+1`): she writes `=` as two wobbly bars, stops to think,
 * writes the number, and ticks it herself; she taps the pen here and there. Every right answer gets
 * the tutor's tick, and nothing she did right gets a "?".
 */

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

describe("live loop — a young student's answers beside the tutor's sums", () => {
  useSyncHash();

  let editor: FakeEditor;
  let fetchJson: Mock<FetchJson>;
  let loop: LiveLoop;
  /** what Mathpix reads for a line of n strokes (the test's own script) */
  let reads: Map<number, string>;
  let recognized: number[];

  function start(): void {
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
        reducedMotion: () => true,
      },
    );
    loop.start();
  }

  async function run(actions: ChatAction[]): Promise<ChatRunReport> {
    let result: ChatRunReport | null = null;
    loop.runChatActions(actions).then((r) => (result = r));
    for (let i = 0; i < 400 && !result; i++) await vi.advanceTimersByTimeAsync(50);
    if (!result) throw new Error("the chat never finished");
    return result;
  }

  async function landed(): Promise<void> {
    await settle();
    await settleStable(() => String(editor.getCurrentPageShapes().length));
  }

  /** she writes these strokes, then lifts the pen long enough for the line to be read */
  async function write(strokes: Pt[][]): Promise<void> {
    const before = recognized.length;
    editor.putUser(youngShapes(strokes));
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.quietMs + 300);
    await settleUntil(() => recognized.length > before && !liveStore.status.get().startsWith("reading"));
    await landed();
  }

  /** she stops writing: the canvas settle (2.5 s) runs out */
  async function stop(): Promise<void> {
    await vi.advanceTimersByTimeAsync(3000);
    await landed();
  }

  const tutor = (): TLShape[] => editor.getCurrentPageShapes().filter((s) => isLiveMeta(s.meta) && s.meta.source === "ai");
  const meta = (s: TLShape) => s.meta as Record<string, unknown>;
  /** the tutor's problem n, as the box of its ink */
  const head = (n: number) => {
    const bs = tutor()
      .filter((s) => problemMetaOf(s.meta)?.n === n)
      .map((s) => editor.getShapePageBounds(s)!);
    return { x: Math.min(...bs.map((b) => b.x)), y: Math.min(...bs.map((b) => b.y)), r: Math.max(...bs.map((b) => b.maxX)), b: Math.max(...bs.map((b) => b.maxY)) };
  };
  /** the marks on the line holding this point of ink, by kind */
  const marksAt = (p: Pt): string[] => {
    const line = Object.values(liveStore.lines.get()).find((st) => {
      const b = st.line.bounds;
      return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
    });
    if (!line) return [];
    return [...new Set(tutor().filter((s) => s.meta.lineId === line.line.id && meta(s).mark).map((s) => String(meta(s).mark).split(":")[0]))];
  };
  const allMarks = () => tutor().filter((s) => meta(s).mark).map((s) => String(meta(s).mark).split(":")[0]);
  const lineAt = (p: Pt) =>
    Object.values(liveStore.lines.get()).find((st) => {
      const b = st.line.bounds;
      return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
    });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    resetLiveStore();
    editor = createFakeEditor();
    editor.store.put([{ ...editor.getCurrentPage(), meta: { screen: { ...DEFAULT_SCREEN } } }]);
    // an iPad: the board fitted at about half size, her digits ~100 page px tall
    editor.getBaseZoom = () => 0.49;
    reads = new Map();
    recognized = [];
    fetchJson = vi.fn<FetchJson>(async (_path, body): Promise<RecognizeResponse> => {
      const { strokes } = body as RecognizeRequest;
      recognized.push(strokes.x.length);
      const latex = reads.get(strokes.x.length) ?? "\\Delta";
      return { latex, text: "", kind: "math", confidence: 0.97, provider: "mathpix", ms: 300 };
    });
  });

  afterEach(() => {
    loop?.stop();
    vi.useRealTimers();
  });

  /** where she writes her answer to problem n: just after it, her digits standing a little above it */
  const answerAt = (n: number) => {
    const p = head(n);
    return { x: p.r + 30, y: p.y - 20 };
  };
  /** a point on the bars of the `=` she wrote at `at` */
  const onEquals = (at: Pt): Pt => ({ x: at.x + 20, y: at.y + 32 });

  it("an `=` she stops after is no line to question; the number she writes next joins it, and is ticked", async () => {
    start();
    await run([{ type: "write_problems", problems: [["4+3"], ["7+2"], ["5+6"], ["8+1"]] }]);
    // problem 2 first, all at once: `= 9`
    reads.set(4, "=9");
    await write(youngLine("=9", answerAt(2).x, answerAt(2).y));
    await stop();
    expect(marksAt(onEquals(answerAt(2)))).toEqual(["check"]);
    // problem 1: the `=`, then a pause to think
    const at = answerAt(1);
    const answer = youngLine("=7", at.x, at.y);
    reads.set(2, "=").set(3, "=7");
    await write(answer.slice(0, 2));
    await stop();
    expect(recognized).toEqual([4, 2]);
    expect(lineAt(onEquals(at))?.latex).toBe("=");
    expect(marksAt(onEquals(at))).toEqual([]);
    // the 7 beside it: one line, `= 7`, the answer to 4 + 3
    await write(answer.slice(2));
    await stop();
    expect(recognized).toEqual([4, 2, 3]);
    const line = lineAt(onEquals(at));
    expect(line?.line.strokeIds).toHaveLength(3);
    expect(line?.analysis).toMatchObject({ verdict: "ok", solved: true });
    expect(marksAt(onEquals(at))).toEqual(["check"]);
    expect(allMarks()).toEqual(["check", "check"]);
  });

  it("Mathpix's reads of her wobbly `=` (`\\smile`, `\\asymp 11`) are an `=`: no raw LaTeX, no ?, the answer ticked", async () => {
    start();
    await run([{ type: "write_problems", problems: [["4+3"], ["7+2"], ["5+6"], ["8+1"]] }]);
    reads.set(4, "=9");
    await write(youngLine("=9", answerAt(2).x, answerAt(2).y));
    const at = answerAt(3);
    const answer = youngLine("=11", at.x, at.y);
    reads.set(2, "\\smile").set(4, "\\asymp 11");
    await write(answer.slice(0, 2));
    await stop();
    expect(lineAt(onEquals(at))?.latex).toBe("=");
    expect(marksAt(onEquals(at))).toEqual([]);
    await write(answer.slice(2));
    await stop();
    const line = lineAt(onEquals(at));
    expect(line?.latex).toBe("= 11");
    expect(line?.analysis).toMatchObject({ verdict: "ok", solved: true });
    expect(marksAt(onEquals(at))).toEqual(["check"]);
    // no readback on the board shows a LaTeX command
    const echoes = editor.getCurrentPageShapes().filter((s) => s.type === "math").map((s) => (s.props as { latex: string }).latex);
    expect(echoes.filter((l) => /\\[a-zA-Z]/.test(l))).toEqual([]);
  });

  it("…and on her own line of numbers too, with no problem of the tutor's above it", async () => {
    start();
    reads.set(4, "4+3 \\asymp 7");
    // `4 + 3 = 7` on one line: a stroke standing in for `4+3`, her `=` and her `7`
    const sum: Pt[] = [{ x: 60, y: 300 }, { x: 140, y: 300 }, { x: 140, y: 380 }];
    await write([sum, ...youngLine("=7", 170, 280)]);
    await stop();
    expect(Object.values(liveStore.lines.get()).map((s) => s.latex)).toEqual(["4+3 = 7"]);
  });

  it("an `=` alone on an empty screen waits, unread and unmarked, for its number", async () => {
    start();
    await run([{ type: "write_problems", problems: [["4+3"], ["7+2"], ["5+6"], ["8+1"]] }]);
    const at = answerAt(1);
    const answer = youngLine("=7", at.x, at.y);
    reads.set(3, "=7");
    editor.putUser(youngShapes(answer.slice(0, 2)));
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.quietMs + 300);
    await stop();
    expect(allMarks()).toEqual([]);
    await write(answer.slice(2));
    await stop();
    expect(recognized).toEqual([3]);
    expect(marksAt(onEquals(at))).toEqual(["check"]);
  });
});
