import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { TLDrawShape } from "tldraw";
import { createFakeEditor, type FakeEditor } from "../__fixtures__/fakeEditor";
import { fixtureSingleLine } from "../__fixtures__/strokes";
import { settle, settleStable, settleUntil } from "@/lib/live/__fixtures__/settle";
import { useSyncHash } from "@/lib/live/__fixtures__/syncHash";
import {
  isLiveMeta,
  type LiveEngine,
  type LiveSseEvent,
  type MathShapeProps,
  type RecognizeResponse,
  type SolveStep,
} from "../contracts";
import { getEngine } from "../engine";
import { handSeedFor, handSizeFor, inlineHandSizeFor, planHandwriting } from "../handwriting";
import { createLiveLoop, type LiveLoop } from "../liveLoop";
import { liveStore, resetLiveStore } from "../liveStore";
import { RecognizeClient, type FetchJson } from "../recognizeClient";

/**
 * Solve, end to end through the loop, against the REAL local engine.
 *
 * The bug: a student wrote `36 + 2 =` and pressed Solve. `engine.solveLatex` only handles
 * equations with an unknown, so the line fell through to `/api/live/solve`, and the model's
 * `= r + 9\varepsilon` was drawn on their page as fact. Two rules are asserted here:
 *
 *   1. anything the local engine can answer is answered locally — no stream call at all;
 *   2. what the model does send is read by the engine before it is drawn, and a solution
 *      that does not survive that shows the ordinary solve failure instead of nonsense.
 */

/** Loading mathjs is real async work, so it happens once, before the fake clock starts. */
let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

function step(index: number, latex: string, final = false): LiveSseEvent {
  return { event: "step", data: { index, latex, explanation: "", final } satisfies SolveStep };
}

describe("live loop — Solve answers locally, and checks the model when it cannot", () => {
  // Deterministic, synchronous stroke hashing: see the fixture for why.
  useSyncHash();

  let editor: FakeEditor;
  let fetchJson: Mock<FetchJson>;
  let loop: LiveLoop;
  let handwriting: boolean;
  let streamCalls: string[];
  /** events each solve stream yields, FIFO (an empty stream once exhausted) */
  let solveScript: LiveSseEvent[][];
  let latex: string;

  function makeLoop(): LiveLoop {
    const stream = async function* (path: string): AsyncGenerator<LiveSseEvent, void, undefined> {
      streamCalls.push(path);
      for (const ev of solveScript.shift() ?? []) yield ev;
    };
    return createLiveLoop(
      editor,
      { boardId: "board-1", mode: "answer", enabled: true, voiceActive: false },
      {
        recognizer: new RecognizeClient({ fetchJson }),
        stream,
        getEngine: async () => engine,
        fetchCapabilities: async () => ({ recognizer: "mathpix", liveEnabled: true, models: { check: "c", solve: "s", vision: "v" } }),
        events: null,
        isOnline: () => true,
        handwritingEnabled: () => handwriting,
        reducedMotion: () => true, // the reveal animation is handwriting.test.ts's subject, not this one
      },
    );
  }

  /** The tutor's ink: one live-meta draw shape per stroke. */
  function handShapes(): TLDrawShape[] {
    return editor.shapesOfType("draw").filter((s) => isLiveMeta(s.meta)) as TLDrawShape[];
  }

  /** The strokes on the canvas, as a geometry fingerprint independent of where the block landed. */
  function handWriting(): string {
    return handShapes()
      .map((s) => s.props.segments[0].points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" "))
      .sort()
      .join("|");
  }

  /**
   * The same fingerprint for the block these steps SHOULD produce, in this line's hand.
   *
   * `seedKey` is the line id for a worked solution written under the line, and `<id>:answer`
   * for the answer the tutor writes at the end of the student's own line — a different hand,
   * and a different size, for a different piece of writing.
   */
  function expectedWriting(steps: string[], seedKey?: string): string {
    const st = Object.values(liveStore.lines.get())[0];
    const h = st.line.bounds.h;
    const size = seedKey?.endsWith(":answer") ? inlineHandSizeFor(h) : handSizeFor(h);
    const plan = planHandwriting(steps, { size, seed: handSeedFor(seedKey ?? st.line.id) }).plan;
    if (!plan) throw new Error(`the hand engine cannot draw ${steps.join(" / ")}`);
    return plan.lines
      .flatMap((l) => l.strokes.map((s) => s.points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ")))
      .sort()
      .join("|");
  }

  /** The typeset steps the tutor placed (`source: 'ai'` math shapes, not the student's echo). */
  /**
   * The AI's typeset steps, in reading order.
   *
   * Sorted by y (placeStep lays step `index` out down the page), NOT by the order the store
   * happens to return them: the steps are created from a streamed generator, so store order is
   * arrival order and two steps landing in the same turn could come back either way round. That
   * is what made this file flake — the values were always right, the order was not.
   */
  function typesetSteps(): string[] {
    return editor
      .shapesOfType("math")
      .filter((s) => (s.props as MathShapeProps).source === "ai")
      .slice()
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .map((s) => (s.props as MathShapeProps).latex);
  }

  function solveCalls(): string[] {
    return streamCalls.filter((p) => p.endsWith("/solve"));
  }

  /** Writes one line of ink that the scripted recognizer reads back as `latex`. */
  async function writeStudentLine(): Promise<void> {
    const before = fetchJson.mock.calls.length;
    editor.putUser(fixtureSingleLine());
    await vi.advanceTimersByTimeAsync(2000);
    await settleUntil(() => fetchJson.mock.calls.length > before);
    await settleUntil(() => Object.values(liveStore.lines.get()).some((s) => s.latex === latex));
  }

  /** Writes the line, presses Solve and lets everything that is going to happen happen. */
  async function solve(line: string): Promise<void> {
    latex = line;
    await writeStudentLine();
    streamCalls.length = 0; // the recognition that got us here is not the subject
    loop.requestSolve();
    await settle();
    await vi.advanceTimersByTimeAsync(20_000);
    // Both outcomes end here: a local answer places its shape at once, a model answer runs a
    // detached async generator that may not have started yet. Waiting for the observable state
    // to stop changing covers both; a fixed tick count raced under full-suite load.
    await settleStable(
      () =>
        [
          liveStore.solving.get(),
          streamCalls.length,
          editor.shapesOfType("math").length,
          editor.shapesOfType("draw").length,
          liveStore.lastError.get()?.code ?? "-",
        ].join("|"),
    );
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    resetLiveStore();
    editor = createFakeEditor();
    handwriting = true;
    streamCalls = [];
    solveScript = [];
    latex = "36+2=";
    fetchJson = vi.fn<FetchJson>(async (): Promise<RecognizeResponse> => ({
      latex,
      text: "",
      kind: "math",
      confidence: 0.97,
      provider: "mathpix",
      ms: 300,
    }));
    loop = makeLoop();
    loop.start();
  });

  afterEach(() => {
    loop.stop();
    vi.useRealTimers();
  });

  // ------------------------------------------------------------ 1. the local answer

  it("has already finished `36 + 2 =` by the time Solve is pressed, and never opens the stream", async () => {
    // A line the student ended with `=` is answered where they left off as soon as it is read
    // (liveLoop.answer.test.ts owns that). Solve then finds its own answer already on the page:
    // it must not write a second copy, and it still has nothing to ask a model.
    await solve("36+2=");

    const lineId = Object.keys(liveStore.lines.get())[0];
    expect(handShapes().length).toBeGreaterThan(0);
    expect(handWriting()).toBe(expectedWriting(["38"], `${lineId}:answer`));
    // the whole point: a sum the engine can do is never sent to a model
    expect(streamCalls).toEqual([]);
    expect(typesetSteps()).toEqual([]);
    expect(liveStore.lastError.get()).toBeNull();
  });

  it.each([
    // the line the student wrote                what the tutor writes under it
    ["3.2 kg \\cdot 9.8 m/s^2", "= 31.36\\,\\mathrm{N}"], // units
    ["5 km/h \\text{ to } m/s", "= 1.389\\,\\mathrm{m/s}"], // a conversion
    ["\\frac{d}{dx} x^3", "= 3\\cdot{x}^{2}"], // a derivative
    ["100-45", "= 55"], // bare arithmetic the echo's calculator rule keeps quiet about
  ])("answers %s locally too", async (line, written) => {
    await solve(line);

    expect(handWriting()).toBe(expectedWriting([written]));
    expect(streamCalls).toEqual([]);
  });

  it.each([
    // a line the student finished with `=`: the answer continues it, bare
    ["36+2=", "38"],
    ["\\frac{1}{2}+\\frac{1}{3}=", "\\frac{5}{6}"],
  ])("answers %s at the end of the student's own line", async (line, written) => {
    await solve(line);

    const lineId = Object.keys(liveStore.lines.get())[0];
    expect(handWriting()).toBe(expectedWriting([written], `${lineId}:answer`));
    expect(streamCalls).toEqual([]);
  });

  it("still uses solveLatex for a real equation, and writes its steps", async () => {
    await solve("2x+3=11");

    // the engine's own worked steps, not a one-line answer
    expect(handWriting()).toBe(expectedWriting(["2x = 8", "x = 4"]));
    expect(streamCalls).toEqual([]);
  });

  it("typesets the local answer rather than asking a model when the hand is switched off", async () => {
    handwriting = false;
    await solve("36+2=");

    expect(handShapes()).toHaveLength(0);
    expect(typesetSteps()).toEqual(["= 38"]);
    // deterministic maths does not go through a model just because the hand is off
    expect(streamCalls).toEqual([]);
  });

  // ------------------------------------------------------------ 2. guarding the model

  it("a word problem still reaches the stream, and its steps are drawn", async () => {
    solveScript = [[step(1, "60 \\div 2 = 30"), step(2, "\\boxed{30\\,\\mathrm{km/h}}", true)]];
    await solve("\\text{A train travels 60 km in 2 h. How fast is it going?}");

    expect(solveCalls()).toEqual(["/api/live/solve"]);
    expect(typesetSteps()).toEqual(["60 \\div 2 = 30", "\\boxed{30\\,\\mathrm{km/h}}"]);
    expect(liveStore.lastError.get()).toBeNull();
  });

  it("discards a step the engine cannot read, and one that invents a variable", async () => {
    solveScript = [
      [
        step(1, "\\text{Sorry, I can't help with that}"), // prose, not maths
        step(2, "= r + 9\\varepsilon"), // the reported bug, verbatim
        step(3, "60 \\div 2 = 30"), // the one honest step
        step(4, "\\boxed{30 + 2\\lambda}", true), // a name from nowhere again
      ],
    ];
    await solve("\\text{A train travels 60 km in 2 h. How fast is it going?}");

    expect(typesetSteps()).toEqual(["60 \\div 2 = 30"]);
    expect(handShapes()).toHaveLength(0);
    // one step survived, so this is not a failure
    expect(liveStore.lastError.get()).toBeNull();
  });

  it("shows the ordinary solve failure — and draws nothing — when no step survives", async () => {
    solveScript = [[step(1, "= r + 9\\varepsilon"), step(2, "\\boxed{= r + 9\\varepsilon}", true)]];
    await solve("\\text{A train travels 60 km in 2 h. How fast is it going?}");

    expect(typesetSteps()).toEqual([]);
    expect(handShapes()).toHaveLength(0);
    const err = liveStore.lastError.get();
    expect(err).toMatchObject({ kind: "solve", userAsked: true, message: "Couldn't work this out" });
    // the retry affordance solve errors already have
    expect(liveStore.retryHandler.get()).toBeTypeOf("function");
  });

  it("keeps the student's own names in scope, so the engine's continuation is not rejected", async () => {
    solveScript = [[step(1, "2x = 8"), step(2, "\\boxed{x = 4}", true)]];
    // a line the local CAS declines (two unknowns) so the stream is genuinely needed
    await solve("2x + y = 8");

    expect(solveCalls()).toEqual(["/api/live/solve"]);
    expect(typesetSteps()).toEqual(["2x = 8", "\\boxed{x = 4}"]);
  });

  it("takes the first step that survives when Live escalates one rung", async () => {
    latex = "\\text{A train travels 60 km in 2 h. How fast is it going?}";
    await writeStudentLine();
    const lineId = Object.keys(liveStore.lines.get())[0];
    streamCalls.length = 0;
    solveScript = [[], [step(1, "= r + 9\\varepsilon"), step(2, "60 \\div 2 = 30"), step(3, "\\boxed{30}", true)]];

    loop.escalate(lineId); // rung 1: a check
    await settle();
    loop.escalate(lineId); // rung 2: one solve step
    await settle();
    await vi.advanceTimersByTimeAsync(20_000);
    await settle(4);

    // the invented step is skipped rather than counted as "the one step"
    expect(typesetSteps()).toEqual(["60 \\div 2 = 30"]);
  });
});
