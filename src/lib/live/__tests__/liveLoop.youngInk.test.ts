import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { TLShape } from "tldraw";
import { createFakeEditor, type FakeEditor } from "../__fixtures__/fakeEditor";
import { settle, settleStable, settleUntil } from "../__fixtures__/settle";
import { useSyncHash } from "../__fixtures__/syncHash";
import { youngGlyphs, youngLine, youngShapes, type Pt } from "../__fixtures__/youngInk";
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
// the engine's modules load on first use: slow on a busy machine
beforeAll(async () => {
  engine = await getEngine();
}, 60_000);

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
    // problem 1: the `=`, then a pause to think — an answer started: not read, not questioned
    const at = answerAt(1);
    const answer = youngLine("=7", at.x, at.y);
    reads.set(2, "=").set(3, "=7");
    await write(answer.slice(0, 2));
    await stop();
    expect(recognized).toEqual([4]);
    expect(lineAt(onEquals(at))).toBeUndefined();
    expect(allMarks()).toEqual(["check"]);
    // the 7 beside it: one line, `= 7`, the answer to 4 + 3
    await write(answer.slice(2));
    await stop();
    expect(recognized).toEqual([4, 3]);
    const line = lineAt(onEquals(at));
    expect(line?.line.strokeIds).toHaveLength(3);
    expect(line?.analysis).toMatchObject({ verdict: "ok", solved: true });
    expect(marksAt(onEquals(at))).toEqual(["check"]);
    expect(allMarks()).toEqual(["check", "check"]);
  });

  it("Mathpix's reads of her wobbly `=` (`\\smile 11`, `\\asymp 11`) are an `=`: no raw LaTeX, no ?, the answer ticked", async () => {
    for (const read of ["\\asymp 11", "\\smile 11"]) {
      loop?.stop();
      resetLiveStore();
      editor = createFakeEditor();
      editor.store.put([{ ...editor.getCurrentPage(), meta: { screen: { ...DEFAULT_SCREEN } } }]);
      editor.getBaseZoom = () => 0.49;
      recognized = [];
      start();
      await run([{ type: "write_problems", problems: [["4+3"], ["7+2"], ["5+6"], ["8+1"]] }]);
      reads.set(4, "=9");
      await write(youngLine("=9", answerAt(2).x, answerAt(2).y));
      const at = answerAt(3);
      const answer = youngLine("=11", at.x, at.y);
      await write(answer.slice(0, 2));
      await stop();
      expect(marksAt(onEquals(at))).toEqual([]);
      reads.set(4, read);
      await write(answer.slice(2));
      await stop();
      const line = lineAt(onEquals(at));
      expect(line?.latex, read).toBe("= 11");
      expect(line?.analysis).toMatchObject({ verdict: "ok", solved: true });
      expect(marksAt(onEquals(at))).toEqual(["check"]);
    }
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

  it("`= 9` on the problem's own row is its answer, however much taller than the problem she writes", async () => {
    start();
    await run([{ type: "write_problems", problems: [["4+3"], ["7+2"], ["5+6"], ["8+1"]] }]);
    const p = head(2);
    // her digits stand 100 px tall beside a problem 30 px tall: the line's middle is above its top
    const at = { x: p.r + 30, y: p.y - 60 };
    reads.set(4, "=9");
    await write(youngLine("=9", at.x, at.y));
    await stop();
    const line = lineAt(onEquals(at));
    expect(line!.line.bounds.y + line!.line.bounds.h / 2).toBeLessThan(p.y);
    expect(line?.analysis).toMatchObject({ verdict: "ok", solved: true, bareAnswer: true });
    expect(marksAt(onEquals(at))).toEqual(["check"]);
  });

  it("`3 = 7` after the tutor's `4 +` (she rubbed its 3 out and wrote her own) is the answer 7: ticked, not ringed", async () => {
    start();
    await run([{ type: "write_problems", problems: [["4+3"], ["7+2"], ["5+6"], ["8+1"]] }]);
    const p = head(1);
    const three: Pt[] = [
      ...Array.from({ length: 10 }, (_, i) => ({ x: p.r + 5 + 20 * Math.sin((i / 9) * Math.PI), y: p.y - 10 + 4 * i })),
      ...Array.from({ length: 10 }, (_, i) => ({ x: p.r + 5 + 22 * Math.sin((i / 9) * Math.PI), y: p.y + 30 + 4 * i })),
    ];
    reads.set(4, "3=7");
    const at = { x: p.r + 50, y: p.y - 20 };
    await write([three, ...youngLine("=7", at.x, at.y)]);
    await stop();
    expect(lineAt(onEquals(at))?.analysis).toMatchObject({ verdict: "ok", solved: true, bareAnswer: true });
    expect(marksAt(onEquals(at))).toEqual(["check"]);
    // ...and `3 = 8` there is a wrong answer, ringed
    reads.set(5, "3=8");
    await write([[{ x: at.x + 130, y: at.y + 90 }, { x: at.x + 140, y: at.y + 92 }, { x: at.x + 150, y: at.y + 94 }]]);
    await stop();
    expect(lineAt(onEquals(at))?.analysis).toMatchObject({ verdict: "mismatch", bareAnswer: true });
    expect(marksAt(onEquals(at))).toEqual(["circle"]);
  });

  it("the tick she draws after `= 11` is not read with it: the 11 is ticked, not read as 11² and ringed", async () => {
    start();
    await run([{ type: "write_problems", problems: [["4+3"], ["7+2"], ["5+6"], ["8+1"]] }]);
    const at = answerAt(3);
    // as Mathpix reads them: with the tick, `=11^{2}` (a real read of child-like ink)
    reads.set(4, "=11").set(5, "=11^{2}");
    await write(youngLine("=11✓", at.x, at.y));
    await stop();
    expect(recognized).toEqual([4]);
    expect(lineAt(onEquals(at))?.line.strokeIds).toHaveLength(4);
    expect(marksAt(onEquals(at))).toEqual(["check"]);
    // ...and a tick written a moment later, on its own, changes nothing
    await write(youngLine("=11✓", at.x, at.y + 160).slice(4));
    await stop();
    expect(recognized).toEqual([4]);
    expect(allMarks()).toEqual(["check"]);
  });

  it("taps of the pen, one or a row of them, are never read and never get a ?", async () => {
    start();
    await run([{ type: "write_problems", problems: [["4+3"], ["7+2"], ["5+6"], ["8+1"]] }]);
    reads.set(1, "\\text { - }").set(6, "\\cdots");
    // a tap at the right of problem 4's cell, then a row of them in problem 2's
    editor.putUser(youngShapes(youngGlyphs.dot(1460, 748)));
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.quietMs + 300);
    await stop();
    editor.putUser(youngShapes([0, 8, 24, 33, 45].flatMap((dx) => youngGlyphs.dot(1472 + dx, 405))));
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.quietMs + 300);
    await stop();
    expect(recognized).toEqual([]);
    expect(allMarks()).toEqual([]);
    expect(editor.getCurrentPageShapes().filter((s) => s.type === "math")).toEqual([]);
    // ...and with an answer on the screen (her digits now size the hand) still none
    reads.set(4, "=9");
    await write(youngLine("=9", answerAt(2).x, answerAt(2).y));
    editor.putUser(youngShapes(youngGlyphs.dot(1400, 300)));
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.quietMs + 300);
    await stop();
    expect(recognized).toEqual([4]);
    expect(allMarks()).toEqual(["check"]);
  });

  it("the reported board, synthetic: four right answers, four ticks — no ?, no raw LaTeX", async () => {
    start();
    await run([{ type: "write_problems", problems: [["4+3"], ["7+2"], ["5+6"], ["8+1"]] }]);
    // Mathpix's reads of each, by its strokes: `= 7` (3), `= 9` (4: the 9 a loop and a stem), `= 11` (4)
    const answers: Array<[number, string, string]> = [
      [1, "=7✓", "\\approx 7"],
      [2, "=9", "=9"],
      [3, "=11✓", "\\asymp 11"],
      [4, "=9✓", "\\smile 9"],
    ];
    editor.putUser(youngShapes(youngGlyphs.dot(1460, 748)));
    for (const [n, text, read] of answers) {
      const at = answerAt(n);
      const strokes = youngLine(text, at.x, at.y);
      // the `=` first (read as one of her `=`s: a smile), a pause, then the rest
      reads.set(2, "\\smile");
      await write(strokes.slice(0, 2));
      reads.set(strokes.length - (text.endsWith("✓") ? 1 : 0), read);
      await write(strokes.slice(2));
    }
    editor.putUser(youngShapes([0, 8, 24, 33, 45].flatMap((dx) => youngGlyphs.dot(1472 + dx, 405))));
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.quietMs + 300);
    await stop();
    for (const [n] of answers) expect(marksAt(onEquals(answerAt(n))), `problem ${n}`).toEqual(["check"]);
    expect(allMarks()).toEqual(["check", "check", "check", "check"]);
    const echoes = editor.getCurrentPageShapes().filter((s) => s.type === "math").map((s) => (s.props as { latex: string }).latex);
    expect(echoes.filter((l) => /\\[a-zA-Z]/.test(l))).toEqual([]);
  });

  it("a minus, or `= -`, started under a problem is not read and gets no ? until its number comes", async () => {
    start();
    await run([{ type: "write_problems", problems: [["4+3"], ["7+2"], ["5+6"], ["8+1"]] }]);
    // her digits on the screen already size her hand: a bar is writing, not a drawing
    reads.set(4, "=9");
    await write(youngLine("=9", answerAt(2).x, answerAt(2).y));
    // Mathpix reads a lone minus `\backslash`, and `= -` as `=`
    reads.set(1, "\\backslash").set(3, "=");
    const p1 = head(1);
    editor.putUser(youngShapes(youngGlyphs.minus(p1.x + 40, p1.b + 60, 48)));
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.quietMs + 300);
    await stop();
    const at = answerAt(3);
    editor.putUser(youngShapes(youngLine("=-", at.x, at.y)));
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.quietMs + 300);
    await stop();
    expect(recognized).toEqual([4]);
    expect(allMarks()).toEqual(["check"]);
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
