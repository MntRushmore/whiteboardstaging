import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { TLDrawShape, TLShapeId } from "tldraw";
import { createFakeEditor, type FakeEditor } from "../__fixtures__/fakeEditor";
import { writeLine as inkLine } from "../__fixtures__/strokes";
import { settle, settleStable, settleUntil } from "@/lib/live/__fixtures__/settle";
import { useSyncHash } from "@/lib/live/__fixtures__/syncHash";
import {
  LIVE_TIMING,
  isLiveMeta,
  type CheckRequest,
  type HelpMode,
  type LiveEngine,
  type LiveSseEvent,
  type MathShapeProps,
  type RecognizeRequest,
  type RecognizeResponse,
} from "../contracts";
import { getEngine } from "../engine";
import { handBlockOf } from "../handwriting";
import { ANSWER_SETTLE_MS, createLiveLoop, type LiveLoop } from "../liveLoop";
import { liveStore, resetLiveStore } from "../liveStore";
import { RecognizeClient, type FetchJson } from "../recognizeClient";

/**
 * Marks may be immediate; answers must wait.
 *
 * The owner, watching a handwritten `38` land the instant `36 + 2 =` was read: "what if I keep
 * drawing, like a big problem. I don't want it to start spewing stuff until I'm fully done
 * (unless the feedback/suggest mode is on, so it can circle and tell me what I did wrong)."
 *
 * Halfway down a derivation, finishing the line the student is working on answers the step they
 * were about to take themselves. So the tutor's ANSWER waits for `ANSWER_SETTLE_MS` of no ink
 * ANYWHERE on the canvas — writing on another line, dragging ink and rubbing it out all count as
 * still working — while its MARKS (badge, solved chip, note, hint) keep the per-line cadence
 * they have today. An explicit ask skips the wait entirely.
 *
 * Everything here runs against the REAL local engine and the REAL hand engine: `36 + 2` is
 * arithmetic, and no assertion in this file may see a model call.
 */

/** Loading mathjs is real async work, so it happens once, before the fake clock starts. */
let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

/**
 * The pause the student leaves between lines while they are still working: longer than the
 * per-line quiet gate (so each line is read) and shorter than the settle (so the answer is not).
 */
const PEN_GAP = LIVE_TIMING.quietMs + 300;

/** A line of ink whose recognition the tutor has nothing to say about (policy: lone symbol). */
const SILENT = "\\Delta";

describe("live loop — the answer waits for the student to stop writing", () => {
  // Deterministic, synchronous stroke hashing: see the fixture for why.
  useSyncHash();

  let editor: FakeEditor;
  let fetchJson: Mock<FetchJson>;
  let loop: LiveLoop;
  let streamCalls: string[];
  /**
   * Events the scripted check/solve stream yields per call (FIFO; an empty stream after). Each
   * one is built from the request, because an annotation has to name a line id the loop only
   * minted once the ink was clustered.
   */
  let streamQueue: Array<Array<(req: CheckRequest) => LiveSseEvent>>;
  /** latex the scripted recognizer hands each line, in the order the lines are first read */
  let script: string[];
  let assigned: Map<string, string>;

  function makeLoop(mode: HelpMode = "answer"): LiveLoop {
    const stream = async function* (path: string, body: unknown): AsyncGenerator<LiveSseEvent, void, undefined> {
      streamCalls.push(path);
      for (const make of streamQueue.shift() ?? []) yield make(body as CheckRequest);
    };
    return createLiveLoop(
      editor,
      { boardId: "board-1", mode, enabled: true, voiceActive: false },
      {
        recognizer: new RecognizeClient({ fetchJson }),
        stream,
        getEngine: async () => engine,
        fetchCapabilities: async () => ({ recognizer: "mathpix", liveEnabled: true, models: { check: "c", solve: "s", vision: "v" } }),
        events: null,
        isOnline: () => true,
        handwritingEnabled: () => true,
        reducedMotion: () => true, // the reveal animation is handwriting.test.ts's subject
      },
    );
  }

  // ------------------------------------------------------------------ reading the page

  function handShapes(): TLDrawShape[] {
    return editor.shapesOfType("draw").filter((s) => isLiveMeta(s.meta)) as TLDrawShape[];
  }

  /** How many separate written blocks the tutor has put on the page. */
  function handBlocks(): number {
    return new Set(handShapes().map((s) => handBlockOf(s.meta))).size;
  }

  /**
   * Everything on the page that STATES A RESULT, whichever way it was written: the latex of
   * each handwritten answer block, plus the `resultLatex` of any typeset echo. Sorted, so a
   * stacked duplicate shows up as a repeated entry rather than as a re-ordering.
   */
  function answersOnPage(): string[] {
    const byBlock = new Map<string, string>();
    for (const s of handShapes()) {
      const block = handBlockOf(s.meta);
      const tex = (s.meta as { answerLatex?: unknown }).answerLatex;
      if (block && typeof tex === "string") byBlock.set(block, tex);
    }
    const typeset = editor
      .shapesOfType("math")
      .map((s) => (s.props as MathShapeProps).resultLatex)
      .filter((tex) => tex !== "");
    return [...byBlock.values(), ...typeset].sort();
  }

  function echoOf(lineId: string): MathShapeProps | null {
    const id = liveStore.lines.get()[lineId]?.mathShapeId;
    const shape = id ? editor.getShape(id) : undefined;
    return shape && shape.type === "math" ? (shape.props as MathShapeProps) : null;
  }

  function strokesOf(lineId: string): TLShapeId[] {
    return [...(liveStore.lines.get()[lineId]?.line.strokeIds ?? [])];
  }

  // ------------------------------------------------------------------ driving the pen

  /** Distinct ink per row: identical strokes would hit the recognizer's content cache. */
  const ROW_INK = ["2x=8", "x=4", "3+4=", "8+1=", "4x=8", "1+2="];

  /**
   * Writes one line of ink at `row`, read back as `latex`, and leaves the pen up for `PEN_GAP`
   * — long enough for the line to be recognized, short enough that the student still counts as
   * working. Returns the new line's id.
   */
  async function penLine(row: number, latex: string): Promise<string> {
    script.push(latex);
    const before = new Set(Object.keys(liveStore.lines.get()));
    editor.putUser(inkLine(ROW_INK[row], 100, 200 + row * 120, 40));
    await vi.advanceTimersByTimeAsync(PEN_GAP);
    await settleUntil(() => {
      const added = Object.entries(liveStore.lines.get()).find(([id]) => !before.has(id));
      return Boolean(added && added[1].latex);
    });
    const added = Object.keys(liveStore.lines.get()).find((id) => !before.has(id));
    if (!added) throw new Error(`row ${row} produced no line`);
    return added;
  }

  /** The student puts the pen down for good: the settle elapses and whatever follows lands. */
  async function stopWriting(): Promise<void> {
    await vi.advanceTimersByTimeAsync(ANSWER_SETTLE_MS + 100);
    await quiesce();
  }

  /**
   * Waits for the page to stop changing. The answer is written from a detached path (a timer
   * callback into a scheduled live write), so there is no single condition to wait on and a
   * fixed tick count raced here before.
   */
  async function quiesce(): Promise<void> {
    await settleStable(() =>
      [
        editor.shapesOfType("draw").length,
        editor.shapesOfType("math").length,
        streamCalls.length,
        answersOnPage().join(","),
      ].join("|"),
    );
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    resetLiveStore();
    editor = createFakeEditor();
    streamCalls = [];
    streamQueue = [];
    script = [];
    assigned = new Map();
    fetchJson = vi.fn<FetchJson>(async (_path, body): Promise<RecognizeResponse> => {
      const { lineId } = body as RecognizeRequest;
      let latex = assigned.get(lineId);
      if (latex === undefined) {
        latex = script[assigned.size] ?? SILENT;
        assigned.set(lineId, latex);
      }
      return { latex, text: "", kind: "math", confidence: 0.97, provider: "mathpix", ms: 300 };
    });
    loop = makeLoop();
    loop.start();
  });

  afterEach(() => {
    loop.stop();
    vi.useRealTimers();
  });

  // ------------------------------------------------------------ 1. nothing while they write

  it("says nothing about `36 + 2 =` while the ink keeps coming", async () => {
    await penLine(0, "36+2=");
    expect(answersOnPage()).toEqual([]);

    // three more lines of a long problem, each within the settle of the one before
    await penLine(1, SILENT);
    expect(answersOnPage()).toEqual([]);
    await penLine(2, SILENT);
    expect(answersOnPage()).toEqual([]);
    await penLine(3, SILENT);

    // well past ANSWER_SETTLE_MS of total elapsed time — but never that long without ink
    expect(answersOnPage()).toEqual([]);
    expect(handShapes()).toEqual([]);
    expect(streamCalls).toEqual([]);
  });

  it("counts ink dragged somewhere else as still working", async () => {
    await penLine(0, "36+2=");
    const other = await penLine(1, SILENT);

    await vi.advanceTimersByTimeAsync(ANSWER_SETTLE_MS - PEN_GAP - 200);
    expect(answersOnPage()).toEqual([]);
    editor.updateUser(strokesOf(other)[0], (s) => ({ ...s, x: s.x + 7 }));
    await vi.advanceTimersByTimeAsync(ANSWER_SETTLE_MS - 200);
    await settle();

    // the clock restarted with the drag, so the answer is still not on the page
    expect(answersOnPage()).toEqual([]);
    await stopWriting();
    expect(answersOnPage()).toEqual(["38"]);
  });

  it("counts erasing as still working", async () => {
    await penLine(0, "36+2=");
    const other = await penLine(1, SILENT);

    await vi.advanceTimersByTimeAsync(ANSWER_SETTLE_MS - PEN_GAP - 200);
    expect(answersOnPage()).toEqual([]);
    editor.removeUser([strokesOf(other)[0]]);
    await vi.advanceTimersByTimeAsync(ANSWER_SETTLE_MS - 200);
    await settle();

    expect(answersOnPage()).toEqual([]);
    await stopWriting();
    expect(answersOnPage()).toEqual(["38"]);
  });

  // ------------------------------------------------------------ 2. the answer once they stop

  it("writes it, once, a beat after they stop", async () => {
    const lineId = await penLine(0, "36+2=");
    expect(answersOnPage()).toEqual([]);

    await stopWriting();

    expect(answersOnPage()).toEqual(["38"]);
    expect(handBlocks()).toBe(1);
    // the answer replaces the echo rather than joining it: a finished sum wants its value
    expect(echoOf(lineId)).toBeNull();
    // deterministic arithmetic, so still no model and no second look at the ink
    expect(streamCalls).toEqual([]);
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it("settling re-renders without re-reading the ink or opening a stream", async () => {
    await penLine(0, "36+2=");
    const reads = fetchJson.mock.calls.length;

    await stopWriting();

    expect(fetchJson.mock.calls.length).toBe(reads);
    expect(streamCalls).toEqual([]);
  });

  // ------------------------------------------------------------ 3. cancelled, never queued

  it("cancels the pending answer when more ink arrives, rather than queueing it", async () => {
    await penLine(0, "36+2=");
    // 200 ms short of the settle: still nothing
    await vi.advanceTimersByTimeAsync(ANSWER_SETTLE_MS - PEN_GAP - 200);
    expect(answersOnPage()).toEqual([]);

    // the student writes again; the clock starts over
    await penLine(1, SILENT);
    expect(answersOnPage()).toEqual([]);
    // past the moment the FIRST clock would have fired: a queued answer would land here
    await vi.advanceTimersByTimeAsync(400);
    await settle();
    expect(answersOnPage()).toEqual([]);
    expect(handShapes()).toEqual([]);

    // and when they do stop, exactly one answer — not the cancelled one plus a new one
    await stopWriting();
    expect(answersOnPage()).toEqual(["38"]);
    expect(handBlocks()).toBe(1);
  });

  it("leaves nothing half-written behind a cancelled answer", async () => {
    await penLine(0, "36+2=");
    await vi.advanceTimersByTimeAsync(ANSWER_SETTLE_MS - PEN_GAP - 100);
    await penLine(1, SILENT);

    // not one stroke of the tutor's hand: the answer was never started, so there is no
    // partial glyph to clean up
    expect(handShapes()).toEqual([]);
  });

  // ------------------------------------------------------------ 4. marks stay immediate

  it("badges and the solved chip keep their per-line cadence", async () => {
    loop.stop();
    resetLiveStore();
    loop = makeLoop("feedback");
    loop.start();

    await penLine(0, "2x=8");
    const solvedLine = await penLine(1, "x=4");

    // within PEN_GAP of the pen-up — no settle has elapsed and none is waited for
    expect(echoOf(solvedLine)).toMatchObject({ latex: "x=4", status: "solved" });
  });

  it("flags a wrong line and opens its hint without waiting for the settle", async () => {
    loop.stop();
    resetLiveStore();
    loop = makeLoop("suggest");
    loop.start();

    await penLine(0, "2x=8");
    streamQueue.push([
      (req) => ({
        event: "annotation",
        data: {
          lineId: req.lines[req.lines.length - 1].id,
          verdict: "warn",
          kind: "arithmetic",
          message: "Look again at the right side",
          question: "What is 8 / 2?",
          confidence: 0.9,
        },
      }),
    ]);
    const wrong = await penLine(1, "x=5");
    await settleUntil(() => liveStore.openHints.get().length > 0);

    expect(echoOf(wrong)).toMatchObject({ latex: "x=5", status: "warn" });
    expect(streamCalls).toEqual(["/api/live/check"]);
    expect(liveStore.openHints.get()).toHaveLength(1);
  });

  // ------------------------------------------------------------ 5. asking means now

  it("answers a Solve-steps request at once, with no settle wait", async () => {
    await penLine(0, "36+2=");
    expect(answersOnPage()).toEqual([]);

    loop.requestSolve();
    await settle();
    await quiesce();

    // not one millisecond of extra fake time has passed
    expect(answersOnPage()).toEqual(["38"]);
    expect(handBlocks()).toBe(1);
    expect(streamCalls).toEqual([]);
  });

  it("does not answer twice when the student stops after asking", async () => {
    await penLine(0, "36+2=");
    loop.requestSolve();
    await settle();
    await stopWriting();

    expect(answersOnPage()).toEqual(["38"]);
    expect(handBlocks()).toBe(1);
    expect(streamCalls).toEqual([]);
  });

  // ------------------------------------------------------------ 6. the modes

  /**
   * A bare answer is the student's own next step written for them, and that is Solve's job.
   * Feedback points at mistakes and Suggest nudges: both still mark `36 + 2 =` and read it
   * back, neither ever hands over `38` — however long the student sits there, and even if
   * they ask.
   */
  it.each(["off", "feedback", "suggest"] as const)("never hands over the answer in %s", async (mode) => {
    loop.stop();
    resetLiveStore();
    loop = makeLoop(mode);
    loop.start();

    const lineId = await penLine(0, "36+2=");
    await stopWriting();

    expect(answersOnPage()).toEqual([]);
    expect(handShapes()).toEqual([]);
    // the line is still read back to them, it just is not finished for them
    expect(echoOf(lineId)).toMatchObject({ latex: "36+2=", resultLatex: "" });

    // and asking does not unlock it either: asking in Feedback asks for feedback
    loop.requestSolve();
    await settle();
    await quiesce();
    expect(answersOnPage()).toEqual([]);
  });

  it("answers in Solve, and only in Solve", async () => {
    await penLine(0, "36+2=");
    await stopWriting();
    expect(answersOnPage()).toEqual(["38"]);
  });

  // ------------------------------------------------------------ 7. no duplicates, ever

  it("answers each line once across write / stop / write / stop", async () => {
    await penLine(0, "36+2=");
    await stopWriting();
    expect(answersOnPage()).toEqual(["38"]);

    await penLine(1, "3+4=");
    await stopWriting();

    expect(answersOnPage()).toEqual(["38", "7"]);
    expect(handBlocks()).toBe(2);
    expect(streamCalls).toEqual([]);
  });

  it("replaces the answer when the line is rewritten, rather than stacking a second one", async () => {
    const lineId = await penLine(0, "36+2=");
    await stopWriting();
    expect(answersOnPage()).toEqual(["38"]);

    // the student changes their ink; the recognizer now reads a different sum
    assigned.set(lineId, "36+3=");
    editor.updateUser(strokesOf(lineId)[0], (s) => ({ ...s, x: s.x + 3 }));
    await vi.advanceTimersByTimeAsync(PEN_GAP);
    await settleUntil(() => liveStore.lines.get()[lineId]?.latex === "36+3=");
    await stopWriting();

    expect(answersOnPage()).toEqual(["39"]);
    expect(handBlocks()).toBe(1);
  });
});
