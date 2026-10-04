import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { ApiError } from "@/lib/api-client";
import { createFakeEditor, type FakeEditor } from "../__fixtures__/fakeEditor";
import { fixtureSingleLine, writeLine } from "../__fixtures__/strokes";
import { settle, settleStable, settleUntil } from "@/lib/live/__fixtures__/settle";
import { useSyncHash } from "@/lib/live/__fixtures__/syncHash";
import {
  isLiveMeta,
  type CheckRequest,
  type LiveEngine,
  type LiveSseEvent,
  type MathShapeProps,
  type RecognizeResponse,
  type RereadRequest,
  type SetupRequest,
  type SolveRequest,
  type SolveStep,
  type UseLiveMathOptions,
} from "../contracts";
import { getEngine } from "../engine";
import { handLinesOf } from "../handwriting";
import { createLiveLoop, needsLook, type LiveLoop } from "../liveLoop";
import { proseWordCount } from "../wordProblem";
import { liveStore, resetLiveStore } from "../liveStore";
import { RecognizeClient, type FetchJson } from "../recognizeClient";

/**
 * "Help" — the board's one explicit ask. No words on the board: everything the tutor puts
 * there is maths in its hand or a mark.
 *
 *  - Solve: the worked solution (word problems go to /api/live/solve with the prose as the
 *    question), written by hand;
 *  - Feedback / Suggest: on a wrong line, the right next step by hand;
 *  - ink Live cannot read as maths: a question mark beside it. No model, no picture.
 */

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

const CROP = "data:image/jpeg;base64,ZmFrZQ==";
const WORD_PROBLEM = "\\text{A train travels 60 km in 2 hours. What is its speed?}";

/** Minimal FileReader (node has none) so `captureCrop` can turn the blob into a data URL. */
class FakeFileReader {
  result: string | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readAsDataURL(_blob: Blob): void {
    void _blob;
    this.result = CROP;
    queueMicrotask(() => this.onload?.());
  }
}

function step(index: number, latex: string, final = false): LiveSseEvent {
  return { event: "step", data: { index, latex, explanation: "", final } satisfies SolveStep };
}

describe("live loop — Help (and Ask about this)", () => {
  useSyncHash();

  let editor: FakeEditor;
  let fetchJson: Mock<FetchJson>;
  let loop: LiveLoop;
  let calls: Array<{ path: string; body: unknown }>;
  let script: LiveSseEvent[][];
  /** what the recognizer answers next (last one repeats); an Error rejects */
  let reads: Array<Partial<RecognizeResponse> | Error>;
  let crops: number;
  /** what /api/live/setup answers for a word problem (an Error rejects) */
  let setupReply: string[] | Error;
  let setupBodies: SetupRequest[];
  /** the second reader's calls; it agrees with Mathpix here (liveLoop.reread.test.ts owns the rest) */
  let rereadBodies: RereadRequest[];

  function makeLoop(mode: UseLiveMathOptions["mode"]): LiveLoop {
    const stream = async function* (path: string, body: unknown): AsyncGenerator<LiveSseEvent, void, undefined> {
      calls.push({ path, body });
      for (const ev of script.shift() ?? []) yield ev;
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
        // the hand is ON: a word problem must still skip the local paths and reach the model
        handwritingEnabled: () => true,
        reducedMotion: () => true,
        setup: async (req) => {
          setupBodies.push(req);
          if (setupReply instanceof Error) throw setupReply;
          return { lines: setupReply, model: "openai/gpt-5.4-mini", ms: 700 };
        },
        reread: async (req) => {
          rereadBodies.push(req);
          return { latex: req.latex, changed: false, model: "google/gemini-3.1-flash-lite", ms: 800 };
        },
      },
    );
  }

  function start(mode: UseLiveMathOptions["mode"]): void {
    loop?.stop();
    resetLiveStore();
    loop = makeLoop(mode);
    loop.start();
  }

  async function write(strokes = fixtureSingleLine()): Promise<string> {
    const before = fetchJson.mock.calls.length;
    editor.putUser(strokes);
    await vi.advanceTimersByTimeAsync(2000);
    await settleUntil(() => fetchJson.mock.calls.length > before);
    await settle(8);
    const line = Object.values(liveStore.lines.get()).find((st) => st.line.strokeIds.includes(strokes[0].id));
    if (!line) throw new Error("the strokes just written are on no line");
    return line.line.id;
  }

  async function help(): Promise<void> {
    loop.requestHelp();
    await settle();
    await vi.advanceTimersByTimeAsync(5_000);
    await settleStable(() => [calls.length, editor.shapesOfType("math").length, liveStore.solving.get()].join("|"));
  }

  const checks = () => calls.filter((c) => c.path.endsWith("/check")).map((c) => c.body as CheckRequest);
  const solves = () => calls.filter((c) => c.path.endsWith("/solve")).map((c) => c.body as SolveRequest);
  const aiShapes = () =>
    editor
      .shapesOfType("math")
      .filter((s) => (s.props as MathShapeProps).source === "ai")
      // reading order: streamed steps can land in the same turn in either store order
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .map((s) => s.props as MathShapeProps);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.stubGlobal("FileReader", FakeFileReader);
    editor = createFakeEditor();
    crops = 0;
    editor.toImage = (async () => {
      crops++;
      return { blob: new Blob(["jpeg-bytes"], { type: "image/jpeg" }), width: 200, height: 40 };
    }) as unknown as FakeEditor["toImage"];
    calls = [];
    script = [];
    setupReply = new ApiError("The AI service returned an error. Please try again.", 502, "upstream_error");
    setupBodies = [];
    rereadBodies = [];
    reads = [{ latex: "2x+3=11" }];
    fetchJson = vi.fn<FetchJson>(async (): Promise<RecognizeResponse> => {
      const next = reads.length > 1 ? reads.shift()! : reads[0];
      if (next instanceof Error) throw next;
      return { latex: "", text: "", kind: "math", confidence: 0.97, provider: "mathpix", ms: 100, ...next };
    });
    start("feedback");
  });

  afterEach(() => {
    loop.stop();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const tutorInk = () => editor.shapesOfType("draw").filter((s) => isLiveMeta(s.meta) && s.meta.source === "ai");
  const marksOf = (kind: "check" | "circle" | "question") =>
    tutorInk().filter((s) => String((s.meta as Record<string, unknown>).mark ?? "").startsWith(`${kind}:`));
  const suggestions = () => tutorInk().filter((s) => typeof (s.meta as Record<string, unknown>).suggestFor === "string");

  // ------------------------------------------------------------ ink it cannot read
  it("unreadable ink: Help draws a question mark beside it — no model, no picture, no words", async () => {
    reads = [{ latex: "2x+?", confidence: 0.3 }];
    await write();
    expect(editor.shapesOfType("math")).toHaveLength(0); // low confidence: no echo
    // the second reader looked once (it agreed with Mathpix); Help itself sends nothing
    expect(rereadBodies).toHaveLength(1);
    const cropsBefore = crops;
    await help();
    expect(calls).toEqual([]);
    expect(crops).toBe(cropsBefore);
    expect(rereadBodies).toHaveLength(1);
    expect(marksOf("question").length).toBeGreaterThan(0);
    expect(editor.shapesOfType("math").filter((s) => (s.props as MathShapeProps).source === "ai")).toEqual([]);
  });

  it("a read that FAILED gets the same question mark", async () => {
    reads = [new ApiError("boom", 502, "upstream_error")];
    await write();
    await help();
    expect(calls).toEqual([]);
    expect(marksOf("question").length).toBeGreaterThan(0);
  });

  it("a lone symbol (a drawn \\Delta) in Suggest: a question mark, not a paragraph about triangles", async () => {
    start("suggest");
    reads = [{ latex: "\\Delta" }];
    await write();
    await help();
    expect(calls).toEqual([]);
    expect(marksOf("question").length).toBeGreaterThan(0);
  });

  it("does nothing with help set to Off", async () => {
    start("off");
    reads = [{ latex: "2x+?", confidence: 0.3 }];
    await write();
    await help();
    expect(calls).toEqual([]);
    expect(tutorInk()).toEqual([]);
  });

  // ------------------------------------------------------------ Help while the line is being read
  /**
   * Help me / Solve it tapped while the student's latest line was still being read: the line had no
   * read yet, so it was "ink Live cannot read" and got a "?" — write it again — about ink nobody had
   * finished reading. Help now waits for the read (as long as the recognizer's own timeout), then helps.
   */
  function slowRead(latex: string): () => void {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    fetchJson.mockImplementation(async (): Promise<RecognizeResponse> => {
      await gate;
      return { latex, text: "", kind: "math", confidence: 0.97, provider: "mathpix", ms: 100 };
    });
    return release;
  }

  async function startWriting(): Promise<void> {
    editor.putUser(fixtureSingleLine());
    await vi.advanceTimersByTimeAsync(2000);
    await settleUntil(() => fetchJson.mock.calls.length > 0);
  }

  const workedSteps = () => tutorInk().filter((s) => !(s.meta as Record<string, unknown>).mark);

  it("Help tapped while the line is still being read waits for the read, then helps — no \"?\" about unread ink", async () => {
    start("answer");
    const release = slowRead("2x+3=11");
    await startWriting();
    expect(Object.values(liveStore.lines.get()).map((st) => st.latex)).toEqual([""]);

    expect(loop.requestHelp()).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    await settle(8);
    // nothing about the line yet: it has not been read
    expect(marksOf("question")).toEqual([]);
    expect(workedSteps()).toEqual([]);

    release();
    await settle(8);
    await vi.advanceTimersByTimeAsync(1_000);
    await settleStable(() => [tutorInk().length, liveStore.solving.get()].join("|"));
    expect(marksOf("question")).toEqual([]);
    expect(handLinesOf(workedSteps())).toEqual(["2x = 8", "x = 4"]);
    expect(calls).toEqual([]);
  });

  it("a read that never lands: Help gives up waiting after the recognizer's timeout and does what it does for unread ink", async () => {
    slowRead("2x+3=11");
    await startWriting();
    expect(loop.requestHelp()).toBe(true);
    // a second tap joins the same wait
    expect(loop.requestHelp()).toBe(true);
    await vi.advanceTimersByTimeAsync(3_000);
    await settle(8);
    expect(marksOf("question")).toEqual([]);
    await vi.advanceTimersByTimeAsync(10_000);
    await settle(8);
    await settleStable(() => String(tutorInk().length));
    expect(calls).toEqual([]);
    expect(marksOf("question").length).toBeGreaterThan(0);
  });

  // ------------------------------------------------------------ marks
  it("marks instead of words: a tick after a right step, a ring round a wrong one", async () => {
    reads = [{ latex: "2x+3=11" }, { latex: "2x=8" }, { latex: "x=5" }];
    await write(writeLine("2x+3=11", 100, 200, 40));
    await write(writeLine("x=4", 100, 300, 40)); // read as 2x=8: right
    await write(writeLine("x=3", 100, 400, 40)); // read as x=5: wrong
    await settle(8);
    expect(marksOf("check").length).toBeGreaterThan(0);
    expect(marksOf("circle").length).toBeGreaterThan(0);
    // Feedback marks only: nothing written beside the wrong line, and no model asked
    expect(suggestions()).toEqual([]);
    expect(calls).toEqual([]);
    expect(liveStore.openHints.get()).toEqual([]);
  });

  it("Suggest: once the student stops, the right next step is written beside the ringed line", async () => {
    start("suggest");
    reads = [{ latex: "2x+3=11" }, { latex: "x=5" }];
    await write(writeLine("2x+3=11", 100, 200, 40));
    const wrong = await write(writeLine("x=3", 100, 300, 40)); // read as x=5
    await vi.advanceTimersByTimeAsync(3_000); // the settle
    await settle(8);
    expect(suggestions().length).toBeGreaterThan(0);
    expect(new Set(suggestions().map((s) => s.meta.lineId))).toEqual(new Set([wrong]));
    expect(calls).toEqual([]);
  });

  // ------------------------------------------------------------ readable maths
  it("Help on a wrong line in Feedback: the right next step by hand, straight away, from the engine", async () => {
    reads = [{ latex: "2x+3=11" }, { latex: "x=5" }];
    await write(writeLine("2x+3=11", 100, 200, 40));
    await write(writeLine("x=3", 100, 300, 40)); // read as x=5
    await help();
    expect(calls).toEqual([]);
    expect(suggestions().length).toBeGreaterThan(0);
    expect(crops).toBe(0);
  });

  // ------------------------------------------------------------ word problems
  it("Solve on a word problem: the setup is written with the engine's answer, by hand — no solve model", async () => {
    start("answer");
    reads = [{ latex: WORD_PROBLEM }];
    const lineId = await write();
    expect(liveStore.lines.get()[lineId].analysis?.kind).toBe("text");

    setupReply = ["v = \\frac{60}{2}"];
    await help();

    expect(setupBodies).toEqual([{ boardId: "board-1", lines: [WORD_PROBLEM] }]);
    expect(checks()).toEqual([]);
    expect(solves()).toEqual([]);
    expect(aiShapes()).toEqual([]);
    expect(tutorInk().length).toBeGreaterThan(0);
    expect(liveStore.lastError.get()).toBeNull();
  });

  it("Solve on a word problem whose setup fails: the prose goes to /api/live/solve, and the steps are written by hand", async () => {
    start("answer");
    reads = [{ latex: WORD_PROBLEM }];
    const lineId = await write();

    script = [[step(1, "v = \\frac{60}{2}"), step(2, "\\boxed{v = 30}", true)]];
    await help();

    expect(setupBodies).toHaveLength(1);
    expect(checks()).toEqual([]);
    expect(solves()).toHaveLength(1);
    const req = solves()[0];
    expect(req.lines).toEqual([expect.objectContaining({ id: lineId, latex: WORD_PROBLEM, local: expect.objectContaining({ kind: "text" }) })]);
    // the guard lets the solution name its own quantity; the result is ink, not cards
    expect(aiShapes()).toEqual([]);
    expect(tutorInk().length).toBeGreaterThan(0);
    expect(liveStore.lastError.get()).toBeNull();
  });
});

describe("needsLook", () => {
  const st = (latex: string, confidence = 0.95, kind: "label" | "text" | "equation" = "equation") => ({
    latex,
    confidence,
    analysis: { kind, math: "", resultLatex: "", verdict: "none" as const, note: "" },
  });

  it("asks about ink that is not readable maths, and only that", () => {
    expect(needsLook(st(""))).toBe(true);
    expect(needsLook(st("2x+3=11", 0.3))).toBe(true);
    expect(needsLook(st("\\Delta"))).toBe(true);
    expect(needsLook(st("A", 0.95, "label"))).toBe(true);
    expect(needsLook(st("2x+3=11"))).toBe(false);
    // a word problem is readable: its words are the question, not a picture to look at
    expect(needsLook(st(WORD_PROBLEM, 0.95, "text"))).toBe(false);
  });

  it("a doodle read as a scrap of prose is a picture, not a word problem", () => {
    // what Mathpix made of a hand-drawn star
    expect(needsLook(st("\\text { is }", 0.9, "text"))).toBe(true);
    expect(needsLook(st("\\text{Sn a}", 0.9, "text"))).toBe(true);
    expect(needsLook(st("\\text{Find the area of the triangle}", 0.9, "text"))).toBe(false);
  });

  it("counts prose words through \\text and commands", () => {
    expect(proseWordCount("\\text { is }")).toBe(1);
    expect(proseWordCount("\\text{A train travels } 60 \\mathrm{~km}")).toBe(5);
  });
});
