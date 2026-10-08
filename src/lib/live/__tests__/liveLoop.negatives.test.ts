import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { TLShape } from "tldraw";
import { createFakeEditor, type FakeEditor } from "../__fixtures__/fakeEditor";
import { settle, settleStable } from "../__fixtures__/settle";
import { useSyncHash } from "../__fixtures__/syncHash";
import { negativeAnswers, youngShapes, type Pt } from "../__fixtures__/youngInk";
import { isLiveMeta, LIVE_TIMING, type LiveEngine, type LiveSseEvent, type RecognizeRequest, type RecognizeResponse } from "../contracts";
import { getEngine } from "../engine";
import { createLiveLoop, type LiveLoop } from "../liveLoop";
import { liveStore, resetLiveStore } from "../liveStore";
import { RecognizeClient, type FetchJson } from "../recognizeClient";
import { DEFAULT_SCREEN } from "@/lib/screens/screens";
import { problemMetaOf } from "../chat/cells";
import type { ChatAction, ChatRunReport } from "../chat/contracts";

/**
 * Negative numbers on an iPad (a field report, 2026-10-08, Chrome on an iPad, before the young-ink
 * fixes): the tutor's `1. -3 - 7`, `2. (-4)(-3)`, `3. -12 + 9`, `4. (-6) × (-9)` in a 2 × 2 grid.
 *
 *  1. `= - 10` beside problem 1 with big gaps between the `=`, the minus and the 10, its 0 ending
 *     just before problem 2's number: no mark at all; it wants a tick.
 *  2. `= -3` beside problem 3, a wobbly `=` then a minus then a 3 (three flat bars in a row): a "?"
 *     after the `=`, another after the minus, the 3 never read.
 *  3. a lone minus under problem 2, an answer just started: a "?".
 *  4. a wobbly `= 54` under problem 4: ticked.
 *
 * Synthetic strokes laid out as in the photos (page px on a board fitted at ~0.5: digits ~100 px,
 * bars 40–90 px and nearly flat), placed against the tutor's own problems. Mathpix's reads are the
 * ones it gave for these very strokes (2026-10-08).
 */

let engine: LiveEngine;
// the engine's modules load on first use: slow on a busy machine
beforeAll(async () => {
  engine = await getEngine();
}, 60_000);

const PROBLEMS = [["-3 - 7"], ["(-4)(-3)"], ["-12 + 9"], ["(-6) \\times (-9)"]];

describe("live loop — negative answers in a young hand", () => {
  useSyncHash();

  let editor: FakeEditor;
  let fetchJson: Mock<FetchJson>;
  let loop: LiveLoop;
  /** what Mathpix reads, by `problem:strokes` (the problem whose cell the line's middle is in) */
  let reads: Map<string, string>;
  let recognized: string[];

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
    await settleStable(() => `${editor.getCurrentPageShapes().length}|${recognized.length}|${liveStore.status.get()}`);
  }

  /** she writes these strokes and lifts the pen: the quiet gate runs, whatever is read is read */
  async function write(strokes: Pt[][]): Promise<void> {
    editor.putUser(youngShapes(strokes));
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.quietMs + 300);
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
  const problemAt = (p: Pt): number => {
    const cell = (n: number) => problemMetaOf(tutor().find((s) => problemMetaOf(s.meta)?.n === n)?.meta)?.cell;
    for (const n of [1, 2, 3, 4]) {
      const c = cell(n);
      if (c && p.x >= c.x && p.x <= c.x + c.w && p.y >= c.y - 60 && p.y <= c.y + c.h) return n;
    }
    return 0;
  };
  const lineAt = (p: Pt) =>
    Object.values(liveStore.lines.get()).find((st) => {
      const b = st.line.bounds;
      return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
    });
  const marksOn = (lineId: string | undefined): string[] =>
    lineId ? [...new Set(tutor().filter((s) => s.meta.lineId === lineId && meta(s).mark).map((s) => String(meta(s).mark).split(":")[0]))] : [];
  const marksAt = (p: Pt) => marksOn(lineAt(p)?.line.id);
  const allMarks = () => tutor().filter((s) => meta(s).mark).map((s) => String(meta(s).mark).split(":")[0]);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    resetLiveStore();
    editor = createFakeEditor();
    editor.store.put([{ ...editor.getCurrentPage(), meta: { screen: { ...DEFAULT_SCREEN } } }]);
    // an iPad: the board fitted at about half size
    editor.getBaseZoom = () => 0.49;
    reads = new Map();
    recognized = [];
    fetchJson = vi.fn<FetchJson>(async (_path, body): Promise<RecognizeResponse> => {
      const { lineId, strokes } = body as RecognizeRequest;
      const b = liveStore.lines.get()[lineId]?.line.bounds;
      const key = `${b ? problemAt({ x: b.x + b.w / 2, y: b.y + b.h / 2 }) : 0}:${strokes.x.length}`;
      recognized.push(key);
      return { latex: reads.get(key) ?? "\\Delta", text: "", kind: "math", confidence: 0.97, provider: "mathpix", ms: 300 };
    });
  });

  afterEach(() => {
    loop?.stop();
    vi.useRealTimers();
  });

  /** her answers, laid out against the tutor's problems as in the photos (`negativeAnswers`) */
  const answers = () => negativeAnswers([head(1), head(2), head(3), head(4)]);
  const answer1 = () => answers().one;
  const answer3 = () => answers().three;
  const answer4 = () => answers().four;

  it("1. `= - 10` with big gaps beside `-3 - 7` is one line, problem 1's, and ticked", async () => {
    start();
    await run([{ type: "write_problems", problems: PROBLEMS }]);
    const a = answer1();
    reads.set("1:2", "=").set("1:3", "=").set("1:1", "\\backslash").set("1:5", "=-10");
    // the `=`, a pause; the minus far to its right, a pause: nothing to read or question yet
    await write(a.eq);
    await stop();
    await write(a.minus);
    await stop();
    expect(allMarks()).toEqual([]);
    await write(a.ten);
    await stop();
    expect(recognized.at(-1)).toBe("1:5");
    const line = lineAt(a.at);
    expect(line?.line.strokeIds).toHaveLength(5);
    expect(line?.latex).toBe("=-10");
    expect(line?.analysis).toMatchObject({ verdict: "ok", solved: true, bareAnswer: true });
    expect(marksAt(a.at)).toEqual(["check"]);
    expect(allMarks()).toEqual(["check"]);
  });

  it("2. `= -3` beside `-12 + 9` (three flat bars in a row) is one line `=-3`, ticked: no ?, no `≡`", async () => {
    start();
    await run([{ type: "write_problems", problems: PROBLEMS }]);
    // something else on the screen first, to size the hand by: problem 4's answer
    const four = answer4();
    reads.set("4:5", "=54");
    await write([...four.eq, ...four.digits]);
    const a = answer3();
    reads.set("3:2", "=").set("3:3", "=-").set("3:4", "=-3");
    await write(a.eq);
    await stop();
    await write(a.minus);
    await stop();
    expect(marksAt(a.at)).toEqual([]);
    await write(a.three);
    await stop();
    const line = lineAt(a.at);
    expect(line?.line.strokeIds).toHaveLength(4);
    expect(line?.latex).toBe("=-3");
    expect(line?.analysis).toMatchObject({ verdict: "ok", solved: true });
    expect(marksAt(a.at)).toEqual(["check"]);
    expect(allMarks()).toEqual(["check", "check"]);
  });

  it("3. a lone minus under `(-4)(-3)`, an answer just started, gets no ? (Mathpix reads it `\\backslash`)", async () => {
    start();
    await run([{ type: "write_problems", problems: PROBLEMS }]);
    // as in the photo, problem 4 is answered already: her digits size her hand, so a bar is writing
    const four = answer4();
    reads.set("4:5", "=54");
    await write([...four.eq, ...four.digits]);
    reads.set("2:1", "\\backslash").set("3:2", "=").set("3:3", "=-");
    await write(answers().two.minus);
    await stop();
    expect(allMarks()).toEqual(["check"]);
    // ...nor an `=`, nor `= -`, under problem 3 while their number is still to come
    const a = answer3();
    await write(a.eq);
    await stop();
    await write(a.minus);
    await stop();
    expect(allMarks()).toEqual(["check"]);
    expect(marksAt(four.at)).toEqual(["check"]);
    // not even read: there is nothing to read yet
    expect(recognized).toEqual(["4:5"]);
  });

  it("4. a wobbly `= 54` under `(-6) × (-9)` is ticked — even when Mathpix reads its `=` as a minus (`-54`)", async () => {
    for (const read of ["=54", "-54", "\\simeq 54"]) {
      loop?.stop();
      resetLiveStore();
      editor = createFakeEditor();
      editor.store.put([{ ...editor.getCurrentPage(), meta: { screen: { ...DEFAULT_SCREEN } } }]);
      editor.getBaseZoom = () => 0.49;
      start();
      await run([{ type: "write_problems", problems: PROBLEMS }]);
      const a = answer4();
      reads.set("4:5", read);
      await write([...a.eq, ...a.digits]);
      await stop();
      expect(lineAt(a.at)?.analysis, read).toMatchObject({ verdict: "ok", solved: true });
      expect(marksAt(a.at), read).toEqual(["check"]);
    }
  });
});
