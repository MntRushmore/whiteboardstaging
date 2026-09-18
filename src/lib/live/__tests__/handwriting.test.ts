import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { TLDrawShape, TLShape } from "tldraw";
import { createFakeEditor, type FakeEditor } from "../__fixtures__/fakeEditor";
import { fixtureSingleLine } from "../__fixtures__/strokes";
import {
  LIVE_TIMING,
  isLiveMeta,
  type LineAnalysis,
  type LiveEngine,
  type LiveSseEvent,
  type Rect,
  type RecognizeResponse,
} from "../contracts";
import { HAND_WRITE, handBlockOf, handSeedFor, handSizeFor, planHandwriting, revealCounts } from "../handwriting";
import { createLiveLoop, type LiveLoop } from "../liveLoop";
import { liveStore, resetLiveStore } from "../liveStore";
import { rectsIntersect } from "../placement";
import { RecognizeClient, type FetchJson } from "../recognizeClient";
import { settle, settleUntil } from "@/lib/live/__fixtures__/settle";

/**
 * The tutor writes the worked steps by hand (WP-H). Everything here is the node-side
 * contract: the `unsupported` interlock, where the block lands, that the reveal is
 * cancellable and always leaves complete writing, and that nothing it draws feeds back into
 * recognition or the legacy image pipeline.
 */

const STUDENT_LATEX = "2x+3=11";
const STEPS = ["2x = 8", "x = 4"];

function engineWith(steps: string[] | null): LiveEngine {
  return {
    analyzeLine: (latex): LineAnalysis => ({
      kind: latex.includes("=") ? "equation" : "expression",
      math: latex,
      resultLatex: "",
      verdict: "unknown",
      note: "",
    }),
    compileExpr: () => () => 0,
    solveLatex: () => (steps ? { latex: steps[steps.length - 1], steps } : null),
    verifyExpected: () => "unknown",
    balance: () => null,
    calculate: () => null,
  };
}

describe("handwriting: planning and the unsupported interlock", () => {
  it("lays supported steps out as one plan per line, in drawing order, with a timeline", () => {
    const { plan, unsupported } = planHandwriting(STEPS, { size: 26, seed: 7 });
    expect(unsupported).toEqual([]);
    expect(plan).not.toBeNull();
    expect(plan!.lines).toHaveLength(2);
    expect(plan!.lines[0].startMs).toBe(0);
    // the second line waits for the first plus a thinking pause
    expect(plan!.lines[1].startMs).toBe(plan!.lines[0].durationMs + HAND_WRITE.lineGapMs);
    expect(plan!.totalMs).toBeCloseTo(plan!.lines[1].startMs + plan!.lines[1].durationMs, 6);
    for (const line of plan!.lines) {
      expect(line.strokes.length).toBeGreaterThan(0);
      expect(line.strokes.map((s) => s.order)).toEqual([...line.strokes].sort((a, b) => a.order - b.order).map((s) => s.order));
      // strokes are relative to the shape origin
      const xs = line.strokes.flatMap((s) => s.points.map((p) => p.x));
      const ys = line.strokes.flatMap((s) => s.points.map((p) => p.y));
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(-0.001);
      expect(Math.min(...ys)).toBeGreaterThanOrEqual(-0.001);
    }
    // the second line sits below the first
    expect(plan!.lines[1].y).toBeGreaterThan(plan!.lines[0].y);
  });

  it("refuses to draw anything when the hand engine reports an unsupported construct", () => {
    const { plan, unsupported } = planHandwriting(["\\sum_{i=1}^{n} i = 5", "x = 4"], { size: 26, seed: 1 });
    expect(unsupported.length).toBeGreaterThan(0);
    expect(plan).toBeNull();
    const matrix = planHandwriting(["\\begin{pmatrix}1&0\\end{pmatrix}"], { size: 26, seed: 1 });
    expect(matrix.plan).toBeNull();
    expect(matrix.unsupported.length).toBeGreaterThan(0);
  });

  it("reveals strokes in order: one pen-down at a time, whole strokes behind it", () => {
    const { plan } = planHandwriting(["x = 4"], { size: 26, seed: 3 });
    const line = plan!.lines[0];
    const full = line.strokes.map((s) => s.points.length);
    expect(revealCounts(line.strokes, 0).every((n) => n === 0)).toBe(true);

    const mid = revealCounts(line.strokes, line.durationMs / 2);
    // exactly one stroke is mid-flight; everything before it is whole, everything after unstarted
    const drawing = mid.findIndex((n, i) => n > 0 && n < full[i]);
    for (let i = 0; i < mid.length; i++) {
      if (drawing >= 0 && i > drawing) expect(mid[i]).toBe(0);
      else if (i !== drawing) expect(mid[i] === full[i] || mid[i] === 0).toBe(true);
    }
    expect(mid.some((n) => n > 0)).toBe(true);
    expect(revealCounts(line.strokes, Number.POSITIVE_INFINITY)).toEqual(full);
  });

  it("matches the hand to the student's ink, within readable bounds", () => {
    expect(handSizeFor(40)).toBe(40);
    expect(handSizeFor(4)).toBe(HAND_WRITE.minSize);
    expect(handSizeFor(400)).toBe(HAND_WRITE.maxSize);
  });
});

describe("handwriting: wired into Solve", () => {
  let editor: FakeEditor;
  let fetchJson: Mock<FetchJson>;
  let streamCalls: string[];
  let loop: LiveLoop;
  let handwriting: boolean;
  let reducedMotion: boolean;
  let engine: LiveEngine;

  function makeLoop(): LiveLoop {
    const stream = async function* (path: string): AsyncGenerator<LiveSseEvent, void, undefined> {
      streamCalls.push(path);
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
        reducedMotion: () => reducedMotion,
      },
    );
  }

  /** Solve streams only: the idle "unknown" check opens its own stream and is not the subject here. */
  function solveCalls(): string[] {
    return streamCalls.filter((p) => p.endsWith("/solve"));
  }

  /** The tutor's ink: one live-meta draw shape per stroke. */
  function handShapes(): TLDrawShape[] {
    return editor.shapesOfType("draw").filter((s) => isLiveMeta(s.meta)) as TLDrawShape[];
  }

  /** Those strokes grouped into written lines (every stroke of a line shares its origin). */
  function handLines(): TLDrawShape[][] {
    const byOrigin = new Map<string, TLDrawShape[]>();
    for (const s of handShapes()) {
      const key = `${s.x},${s.y}`;
      const group = byOrigin.get(key);
      if (group) group.push(s);
      else byOrigin.set(key, [s]);
    }
    return [...byOrigin.values()].sort((a, b) => a[0].y - b[0].y);
  }

  function pointsWritten(): number {
    return handShapes().reduce((n, s) => n + s.props.segments.reduce((m, g) => m + g.points.length, 0), 0);
  }

  /**
   * The exact plan the loop writes: the hand is sized from the student's ink and seeded from
   * the line id, so the same line is always written in the same hand.
   */
  function PLAN() {
    const st = Object.values(liveStore.lines.get())[0];
    return planHandwriting(STEPS, { size: handSizeFor(st.line.bounds.h), seed: handSeedFor(st.line.id) }).plan!;
  }

  function boundsOf(s: TLShape): Rect {
    const b = editor.getShapePageBounds(s)!;
    return { x: b.x, y: b.y, w: b.w, h: b.h };
  }

  async function writeStudentLine(): Promise<TLDrawShape[]> {
    const strokes = fixtureSingleLine();
    const before = fetchJson.mock.calls.length;
    editor.putUser(strokes);
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.quietMs + 1);
    // Wait for the recognize call and then for the echo it produces: both hang off a real
    // async digest, so a fixed tick count raced on slower CI runners.
    await settleUntil(() => fetchJson.mock.calls.length > before);
    await settleUntil(() => editor.shapesOfType("math").length > 0);
    return strokes;
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    resetLiveStore();
    editor = createFakeEditor();
    handwriting = true;
    reducedMotion = false;
    engine = engineWith(STEPS);
    fetchJson = vi.fn<FetchJson>(async (): Promise<RecognizeResponse> => ({
      latex: STUDENT_LATEX,
      text: "",
      kind: "math",
      confidence: 0.97,
      provider: "mathpix",
      ms: 300,
    }));
    streamCalls = [];
    loop = makeLoop();
    loop.start();
  });

  afterEach(() => {
    loop.stop();
    vi.useRealTimers();
  });

  it("writes the engine's steps by hand under the student's ink, once, with no model call", async () => {
    const ink = await writeStudentLine();
    expect(handShapes()).toHaveLength(0);

    loop.requestSolve();
    await settle();
    await vi.advanceTimersByTimeAsync(20_000);
    await settle(4);

    const lines = handLines();
    expect(lines).toHaveLength(STEPS.length);
    // one shape per stroke, so tldraw never joins two glyphs with a phantom line
    expect(lines.map((l) => l.length)).toEqual(PLAN().lines.map((l) => l.strokes.length));
    // no LLM: the steps came from the local engine
    expect(solveCalls()).toEqual([]);
    const hand = handShapes();
    const blocks = new Set(hand.map((s) => handBlockOf(s.meta)));
    expect(blocks.size).toBe(1);
    for (const shape of hand) {
      expect(shape.meta).toMatchObject({ live: true, source: "ai" });
      expect(shape.props.isComplete).toBe(true);
      expect(shape.props.color).toBe(HAND_WRITE.color);
      expect(shape.props.segments).toHaveLength(1);
      expect(shape.props.segments[0].points.length).toBeGreaterThan(0);
    }
    // the whole written block counts as one mark against the live shape cap
    expect(liveStore.liveShapeCount.get()).toBe(2); // the echo + this block

    // below the student's last line, never on top of their ink or the echo
    const inkRects = ink.map((s) => boundsOf(editor.getShape(s.id)!));
    const inkBottom = Math.max(...inkRects.map((r) => r.y + r.h));
    for (const shape of hand) {
      const r = boundsOf(shape);
      expect(r.y).toBeGreaterThanOrEqual(inkBottom);
      for (const ir of inkRects) expect(rectsIntersect(r, ir)).toBe(false);
    }
    const echoId = liveStore.lines.get()[Object.keys(liveStore.lines.get())[0]].mathShapeId!;
    const echo = boundsOf(editor.getShape(echoId)!);
    for (const shape of hand) expect(rectsIntersect(boundsOf(shape), echo)).toBe(false);

    // the second step is written below the first
    expect(lines[1][0].y).toBeGreaterThan(lines[0][0].y);

    // stable afterwards: no extra shapes, no further writes
    const after = handShapes().map((s) => `${s.id}:${s.props.segments.length}`);
    await vi.advanceTimersByTimeAsync(10_000);
    await settle();
    expect(handShapes().map((s) => `${s.id}:${s.props.segments.length}`)).toEqual(after);
  });

  it("reveals the strokes progressively rather than all at once", async () => {
    await writeStudentLine();
    loop.requestSolve();
    await settle();

    await vi.advanceTimersByTimeAsync(HAND_WRITE.frameMs * 3);
    await settle();
    const early = handShapes();
    expect(early.length).toBeGreaterThan(0);
    expect(handLines()).toHaveLength(1);
    const earlyPoints = pointsWritten();
    expect(early.some((s) => !s.props.isComplete)).toBe(true);

    await vi.advanceTimersByTimeAsync(300);
    await settle();
    expect(pointsWritten()).toBeGreaterThan(earlyPoints);
    expect(handLines()).toHaveLength(1); // still on the first step

    await vi.advanceTimersByTimeAsync(20_000);
    await settle();
    expect(handLines()).toHaveLength(STEPS.length);
  });

  it("cancels when the student writes again and leaves complete writing, never half a step", async () => {
    await writeStudentLine();
    loop.requestSolve();
    await settle();
    await vi.advanceTimersByTimeAsync(200);
    await settle();
    expect(handLines()).toHaveLength(1);
    expect(handShapes().length).toBeLessThan(PLAN().lines[0].strokes.length);

    // the student picks the pen back up
    editor.putUser(fixtureSingleLine().slice(0, 1).map((s) => ({ ...s, x: s.x, y: s.y + 400 })));
    await settle();

    const hand = handShapes();
    // only the step that had started is on the canvas — and it is written in full, because
    // half an equation would be wrong maths
    expect(handLines()).toHaveLength(1);
    expect(hand).toHaveLength(PLAN().lines[0].strokes.length);
    for (const s of hand) expect(s.props.isComplete).toBe(true);
    expect(pointsWritten()).toBe(PLAN().lines[0].strokes.reduce((n, s) => n + s.points.length, 0));

    const frozen = hand.map((s) => `${s.id}:${s.props.segments.length}`);
    await vi.advanceTimersByTimeAsync(20_000);
    await settle(8);
    expect(handShapes().map((s) => `${s.id}:${s.props.segments.length}`)).toEqual(frozen);
  });

  it("completes the writing when the loop stops mid-reveal (unmount / leaving the board)", async () => {
    await writeStudentLine();
    loop.requestSolve();
    await settle();
    await vi.advanceTimersByTimeAsync(200);
    await settle();
    const first = PLAN().lines[0];
    expect(handShapes().length).toBeLessThan(first.strokes.length);

    loop.stop();
    await settle();
    // every stroke of the first step is there, complete, and the untouched step is not
    expect(handLines()).toHaveLength(1);
    expect(handShapes()).toHaveLength(first.strokes.length);
    for (const s of handShapes()) expect(s.props.isComplete).toBe(true);
    // every stroke at its full length (store order is not creation order, so compare the sets)
    const written = handShapes().map((s) => s.props.segments[0].points.length).sort((a, b) => a - b);
    expect(written).toEqual(first.strokes.map((s) => s.points.length).sort((a, b) => a - b));

    await vi.advanceTimersByTimeAsync(20_000);
    await settle();
    expect(handShapes()).toHaveLength(first.strokes.length);
  });

  it("draws the finished result with no animation when the device asks for reduced motion", async () => {
    reducedMotion = true;
    await writeStudentLine();
    loop.requestSolve();
    await settle();
    // no timer has run at all
    expect(handLines()).toHaveLength(STEPS.length);
    for (const s of handShapes()) expect(s.props.isComplete).toBe(true);
    expect(pointsWritten()).toBe(PLAN().lines.reduce((n, l) => n + l.strokes.reduce((m, s) => m + s.points.length, 0), 0));
    expect(solveCalls()).toEqual([]);
  });

  it("falls back to the typeset solve stream when a step is not drawable", async () => {
    engine = engineWith(["\\sum_{i=1}^{4} i = 10", "x = 4"]);
    loop.stop();
    resetLiveStore();
    editor = createFakeEditor();
    loop = makeLoop();
    loop.start();
    await settle();

    await writeStudentLine();
    loop.requestSolve();
    await settle();
    await vi.advanceTimersByTimeAsync(20_000);
    await settle();

    expect(handShapes()).toHaveLength(0);
    expect(solveCalls()).toEqual(["/api/live/solve"]);
  });

  it("falls back to the typeset solve stream when the hand setting is off", async () => {
    handwriting = false;
    await writeStudentLine();
    loop.requestSolve();
    await settle();
    await vi.advanceTimersByTimeAsync(20_000);
    await settle();
    expect(handShapes()).toHaveLength(0);
    expect(solveCalls()).toEqual(["/api/live/solve"]);
  });

  it("falls back to the typeset solve stream when the engine has no steps", async () => {
    engine = engineWith(null);
    loop.stop();
    resetLiveStore();
    editor = createFakeEditor();
    loop = makeLoop();
    loop.start();
    await settle();

    await writeStudentLine();
    loop.requestSolve();
    await settle();
    await vi.advanceTimersByTimeAsync(20_000);
    await settle();
    expect(handShapes()).toHaveLength(0);
    expect(solveCalls()).toEqual(["/api/live/solve"]);
  });

  it("writes only the first step when Live escalates one rung", async () => {
    await writeStudentLine();
    const lineId = Object.keys(liveStore.lines.get())[0];
    loop.escalate(lineId); // rung 1: a check
    await settle();
    loop.escalate(lineId); // rung 2: one solve step
    await settle();
    await vi.advanceTimersByTimeAsync(20_000);
    await settle();
    expect(handLines()).toHaveLength(1);
  });

  it("nothing the tutor writes re-triggers recognition or the legacy pipeline", async () => {
    await writeStudentLine();
    expect(fetchJson).toHaveBeenCalledTimes(1);
    const lineCount = Object.keys(liveStore.lines.get()).length;

    loop.requestSolve();
    await settle();
    await vi.advanceTimersByTimeAsync(20_000);
    await settle(8);
    expect(handLines()).toHaveLength(STEPS.length);

    // no second recognition, no new ink line, and the legacy image pipeline stays parked
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.quietMs * 4);
    await settle(8);
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(Object.keys(liveStore.lines.get())).toHaveLength(lineCount);
    expect(liveStore.lastBurst.get()?.state).toBe("handled");
    expect(solveCalls()).toEqual([]);
    // the tutor's ink is never student ink: its strokes are not part of any line
    const handIds = new Set(handShapes().map((s) => s.id));
    for (const st of Object.values(liveStore.lines.get())) {
      for (const sid of st.line.strokeIds) expect(handIds.has(sid)).toBe(false);
    }
  });

  it("clearMarks removes the handwriting and stops a reveal in flight", async () => {
    await writeStudentLine();
    loop.requestSolve();
    await settle();
    await vi.advanceTimersByTimeAsync(200);
    await settle();
    expect(handShapes().length).toBeGreaterThan(0);

    loop.clearMarks();
    await settle();
    await vi.advanceTimersByTimeAsync(20_000);
    await settle();
    expect(handShapes()).toHaveLength(0);
    expect(editor.shapesOfType("math")).toHaveLength(1);
  });
});
