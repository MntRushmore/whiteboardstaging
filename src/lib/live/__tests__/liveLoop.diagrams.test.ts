import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { TLShapeId } from "tldraw";
import { boundsOf, DRAWINGS, labelAt, writeAt, type Drawing } from "@/__eval__/drawings";
import { createFakeEditor, type FakeEditor } from "../__fixtures__/fakeEditor";
import { drawShapeFromPoints } from "../__fixtures__/strokes";
import { settle, settleStable, settleUntil } from "@/lib/live/__fixtures__/settle";
import { useSyncHash } from "@/lib/live/__fixtures__/syncHash";
import {
  isLiveMeta,
  type InkStroke,
  type LiveEngine,
  type LiveSseEvent,
  type MathShapeProps,
  type RecognizeRequest,
  type RecognizeResponse,
  type SetupRequest,
  type UseLiveMathOptions,
} from "../contracts";
import { getEngine } from "../engine";
import { handLinesOf } from "../handwriting";
import { ANSWER_SETTLE_MS, createLiveLoop, type LiveLoop } from "../liveLoop";
import { liveStore, resetLiveStore } from "../liveStore";
import { localSolve } from "../localSolve";
import { RecognizeClient, type FetchJson } from "../recognizeClient";
import { setupBlock } from "../wordProblem";

/**
 * Drawings on the board (`src/lib/live/diagrams.ts`, `LiveLoop.flush`): a triangle beside a line of
 * maths is never recognized, never marked and never joined to the line; its labels are read once
 * the student stops, with ONE recognizer call; and Solve / Help on it — or on `x = ?` beside it —
 * sends a crop of it to /api/live/setup ("the tutor reads the figure"), whose lines the engine
 * solves and the tutor writes by hand.
 */

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

const CROP = "data:image/jpeg;base64,ZmFrZQ==";
const PYTHAGORAS = ["x^{2} = 3^{2} + 4^{2}", "x = \\sqrt{3^{2} + 4^{2}}"];

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

const shapesOf = (strokes: readonly InkStroke[]) => strokes.map((s) => drawShapeFromPoints(s.segments[0], s.id));
const idsOf = (strokes: readonly InkStroke[]) => new Set<string>(strokes.map((s) => s.id));

/** A right triangle (sides 3, 4, x) with its top-left at (x, y). */
function triangleAt(x: number, y: number): Drawing {
  const raw = DRAWINGS.rightTriangle(0, 0, 4);
  const b = boundsOf([...raw.strokes, ...raw.labels.flat()]);
  return DRAWINGS.rightTriangle(x - b.x, y - b.y, 4);
}

describe("live loop — drawings", () => {
  useSyncHash();

  let editor: FakeEditor;
  let fetchJson: Mock<FetchJson>;
  let loop: LiveLoop;
  let calls: string[];
  let lineRead: string;
  let labelRead: string;
  let setupReply: string[] | Error;
  let setupBodies: SetupRequest[];

  const recognizeBodies = () => fetchJson.mock.calls.map((c) => c[1] as RecognizeRequest);
  const lineReads = () => recognizeBodies().filter((b) => !b.lineId.startsWith("dg_"));
  const labelReads = () => recognizeBodies().filter((b) => b.lineId.startsWith("dg_"));

  function start(mode: UseLiveMathOptions["mode"] = "answer"): void {
    loop?.stop();
    resetLiveStore();
    loop = createLiveLoop(
      editor,
      { boardId: "board-1", mode, enabled: true, voiceActive: false },
      {
        recognizer: new RecognizeClient({ fetchJson }),
        stream: async function* (path: string): AsyncGenerator<LiveSseEvent, void, undefined> {
          calls.push(path);
        },
        getEngine: async () => engine,
        fetchCapabilities: async () => ({ recognizer: "mathpix", liveEnabled: true, models: { check: "c", solve: "s", vision: "v" } }),
        events: null,
        isOnline: () => true,
        handwritingEnabled: () => true,
        reducedMotion: () => true,
        setup: async (req) => {
          setupBodies.push(req);
          if (setupReply instanceof Error) throw setupReply;
          return { lines: setupReply, model: "google/gemini-3.1-flash-lite", ms: 900 };
        },
        reread: async () => {
          throw new Error("no second reader in this file");
        },
      },
    );
    loop.start();
  }

  /** Puts ink on the board and lets the quiet gate and recognition run. */
  async function draw(strokes: readonly InkStroke[]): Promise<void> {
    editor.putUser(shapesOf(strokes));
    await vi.advanceTimersByTimeAsync(1_000);
    await settleStable(() => `${fetchJson.mock.calls.length}|${editor.shapesOfType("math").length}`);
  }

  /** The student stops: the settle clock runs out. */
  async function stop(): Promise<void> {
    await vi.advanceTimersByTimeAsync(ANSWER_SETTLE_MS + 100);
    await settleStable(() => `${fetchJson.mock.calls.length}|${liveStore.diagrams.get().map((d) => d.read?.length ?? -1).join(",")}`);
  }

  async function run(action: () => void): Promise<void> {
    action();
    await settle();
    await vi.advanceTimersByTimeAsync(5_000);
    await settleStable(() => [calls.length, setupBodies.length, fetchJson.mock.calls.length, editor.shapesOfType("draw").length, liveStore.solving.get()].join("|"));
  }

  const tutorInk = () => editor.shapesOfType("draw").filter((s) => isLiveMeta(s.meta) && s.meta.source === "ai" && !(s.meta as Record<string, unknown>).mark);
  const marks = () => editor.shapesOfType("draw").filter((s) => isLiveMeta(s.meta) && Boolean((s.meta as Record<string, unknown>).mark));
  const echoes = () => editor.shapesOfType("math").map((s) => s.props as MathShapeProps).filter((p) => p.source === "echo");
  const lineOf = (strokes: readonly InkStroke[]) => Object.values(liveStore.lines.get()).find((st) => st.line.strokeIds.includes(strokes[0].id as TLShapeId));
  const expectedBlock = (setup: string[]) => setupBlock(setup, localSolve(engine, setup, undefined, { handwriting: true }).steps);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.stubGlobal("FileReader", FakeFileReader);
    editor = createFakeEditor();
    editor.toImage = (async () => ({ blob: new Blob(["jpeg-bytes"], { type: "image/jpeg" }), width: 300, height: 200 })) as unknown as FakeEditor["toImage"];
    calls = [];
    lineRead = "a^{2}+b^{2}=c^{2}";
    labelRead = "\\begin{array}{l}\nx \\\\\n3 \\\\\n4\n\\end{array}";
    setupReply = PYTHAGORAS;
    setupBodies = [];
    fetchJson = vi.fn<FetchJson>(async (_path, body): Promise<RecognizeResponse> => {
      const req = body as RecognizeRequest;
      const latex = req.lineId.startsWith("dg_") ? labelRead : lineRead;
      return { latex, text: latex, kind: "math", confidence: 0.98, provider: "mathpix", ms: 90 };
    });
    start();
  });

  afterEach(() => {
    loop.stop();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("a triangle beside a line of maths: only the line is recognized, and the triangle gets nothing", async () => {
    const math = writeAt("a^{2} + b^{2} = c^{2}", 200, 300);
    const line = boundsOf(math);
    const tri = triangleAt(line.x + line.w + 30, line.y - 60);
    await draw([...math, ...tri.strokes, ...tri.labels.flat()]);

    // one recognize call, for exactly the maths line's strokes
    expect(lineReads()).toHaveLength(1);
    expect(lineReads()[0].strokes.x).toHaveLength(math.length);
    expect(Object.values(liveStore.lines.get()).map((st) => [...st.line.strokeIds].sort())).toEqual([[...idsOf(math)].sort()]);
    // the drawing is known, with its three labels, and is not a line
    expect(liveStore.diagrams.get()).toEqual([expect.objectContaining({ kinds: ["triangle"], labels: 3, read: null })]);
    // no echo, tick, ring or "?" for the drawing or its labels
    const drawn = idsOf([...tri.strokes, ...tri.labels.flat()]);
    expect(echoes().every((p) => p.anchorIds.every((id) => !drawn.has(id)))).toBe(true);
    expect(marks().filter((m) => String((m.meta as Record<string, unknown>).mark).startsWith("question"))).toEqual([]);
    expect(labelReads()).toEqual([]);
  });

  it("reads the labels once the student stops: one call for all of them, and not again for the same ink", async () => {
    const tri = triangleAt(400, 200);
    await draw([...tri.strokes, ...tri.labels.flat()]);
    expect(labelReads()).toEqual([]);
    await stop();
    expect(labelReads()).toHaveLength(1);
    // the three labels, stacked: every label stroke in the one payload
    expect(labelReads()[0].strokes.x).toHaveLength(tri.labels.flat().length);
    expect(liveStore.diagrams.get()[0].read).toEqual(["x", "3", "4"]);
    // writing elsewhere and stopping again does not read the same labels again
    await draw(writeAt("2x + 3 = 11", 100, 600));
    await stop();
    expect(labelReads()).toHaveLength(1);
    // a new label is a new read
    await draw(labelAt("A", 395, 190));
    await stop();
    expect(labelReads()).toHaveLength(2);
  });

  it("Help on the drawing: the tutor reads the figure and writes the setup and the answer beside it", async () => {
    const tri = triangleAt(400, 200);
    await draw([...tri.strokes, ...tri.labels.flat()]);
    await run(() => loop.requestHelp());

    expect(setupBodies).toEqual([{ boardId: "board-1", lines: [], labels: ["x", "3", "4"], crop: CROP }]);
    const block = expectedBlock(PYTHAGORAS);
    expect(block.slice(0, 2)).toEqual(PYTHAGORAS);
    expect(block[block.length - 1]).toBe("x = 5");
    expect(handLinesOf(tutorInk())).toEqual(block);
    // beside the figure, never a "?"
    const figure = liveStore.diagrams.get()[0];
    expect(Math.min(...tutorInk().map((s) => s.x))).toBeGreaterThan(figure.bounds.x + figure.bounds.w);
    expect(tutorInk().every((s) => isLiveMeta(s.meta) && s.meta.lineId === figure.id)).toBe(true);
    expect(marks()).toEqual([]);
    expect(liveStore.lastError.get()).toBeNull();
    expect(liveStore.solving.get()).toBe(0);

    // asking again about the same figure costs nothing
    const ink = tutorInk().length;
    await run(() => loop.requestHelp());
    expect(setupBodies).toHaveLength(1);
    expect(tutorInk()).toHaveLength(ink);
  });

  it("in Feedback, Help on the drawing writes the first line of the setup only", async () => {
    start("feedback");
    const tri = triangleAt(400, 200);
    await draw([...tri.strokes, ...tri.labels.flat()]);
    await run(() => loop.requestHelp());
    expect(setupBodies).toHaveLength(1);
    expect(handLinesOf(tutorInk())).toEqual([PYTHAGORAS[0]]);
  });

  it("`x = ?` beside the figure: Solve reads the figure with the line, and writes under the line", async () => {
    lineRead = "x=?";
    const tri = triangleAt(200, 200);
    const b = boundsOf([...tri.strokes, ...tri.labels.flat()]);
    const ask = writeAt("x = ?", b.x + b.w + 40, b.y + 60);
    await draw([...tri.strokes, ...tri.labels.flat(), ...ask]);
    const state = lineOf(ask)!;
    expect(state.latex).toBe("x=?");
    await run(() => loop.requestSolve(state.line.id));

    expect(setupBodies).toEqual([{ boardId: "board-1", lines: ["x=?"], labels: ["x", "3", "4"], crop: CROP }]);
    expect(calls).toEqual([]);
    expect(handLinesOf(tutorInk())).toEqual(expectedBlock(PYTHAGORAS));
    expect(Math.min(...tutorInk().map((s) => s.y))).toBeGreaterThan(state.line.bounds.y + state.line.bounds.h);
    expect(tutorInk().every((s) => isLiveMeta(s.meta) && s.meta.lineId === state.line.id)).toBe(true);
  });

  it("a figure the model cannot set up: from a line the worked solution is asked; on the drawing the pill says so", async () => {
    setupReply = ["\\text{it is a right triangle}"];
    lineRead = "x=?";
    const tri = triangleAt(200, 200);
    const b = boundsOf([...tri.strokes, ...tri.labels.flat()]);
    const ask = writeAt("x = ?", b.x + b.w + 40, b.y + 60);
    await draw([...tri.strokes, ...tri.labels.flat(), ...ask]);
    await run(() => loop.requestSolve(lineOf(ask)!.line.id));
    expect(setupBodies).toHaveLength(1);
    expect(calls.filter((p) => p.endsWith("/solve"))).toHaveLength(1);

    await draw(labelAt("A", 195, 190));
    await run(() => loop.requestHelp());
    expect(setupBodies).toHaveLength(2);
    expect(setupBodies[1].lines).toEqual([]);
    expect(tutorInk()).toEqual([]);
    expect(liveStore.lastError.get()).toMatchObject({ kind: "solve", message: "Couldn't work this out" });
  });

  it("a drawing stroke does not hold back a line waiting to be read", async () => {
    const math = writeAt("2x + 3 = 11", 200, 300);
    editor.putUser(shapesOf(math));
    await vi.advanceTimersByTimeAsync(400);
    // a long diagonal (a triangle's side) 400 ms later
    const tri = triangleAt(600, 250);
    editor.putUser(shapesOf([tri.strokes[2]]));
    await vi.advanceTimersByTimeAsync(250);
    await settleUntil(() => lineReads().length > 0);
    expect(lineReads()).toHaveLength(1);

    // while writing does
    const more = writeAt("x = 4", 200, 380);
    editor.putUser(shapesOf(more.slice(0, 1)));
    await vi.advanceTimersByTimeAsync(400);
    editor.putUser(shapesOf(more.slice(1)));
    await vi.advanceTimersByTimeAsync(250);
    await settle(8);
    expect(lineReads()).toHaveLength(1);
  });

  it("a label written before the drawing stops being a line once the drawing is there", async () => {
    lineRead = "3";
    const tri = triangleAt(400, 200);
    const three = tri.labels[0];
    await draw(three);
    expect(lineOf(three)).toBeDefined();
    await draw([...tri.strokes, ...tri.labels.slice(1).flat()]);
    expect(lineOf(three)).toBeUndefined();
    expect(Object.keys(liveStore.lines.get())).toEqual([]);
    expect(echoes()).toEqual([]);
  });

  it("rubbing the drawing out takes the tutor's answer about it with it", async () => {
    const tri = triangleAt(400, 200);
    await draw([...tri.strokes, ...tri.labels.flat()]);
    await run(() => loop.requestHelp());
    expect(tutorInk().length).toBeGreaterThan(0);
    editor.removeUser([...tri.strokes, ...tri.labels.flat()].map((s) => s.id));
    await vi.advanceTimersByTimeAsync(1_000);
    await settleStable(() => `${tutorInk().length}|${liveStore.diagrams.get().length}`);
    expect(liveStore.diagrams.get()).toEqual([]);
    expect(tutorInk()).toEqual([]);
  });

  it("after a reload the drawing is found again from the ink, and Solve beside it still reads it", async () => {
    lineRead = "x=?";
    const tri = triangleAt(200, 200);
    const b = boundsOf([...tri.strokes, ...tri.labels.flat()]);
    const ask = writeAt("x = ?", b.x + b.w + 40, b.y + 60);
    await draw([...tri.strokes, ...tri.labels.flat(), ...ask]);
    start();
    expect(liveStore.diagrams.get()).toHaveLength(1);
    await settleUntil(() => Object.values(liveStore.lines.get()).some((st) => st.analysis !== null));
    const state = Object.values(liveStore.lines.get())[0];
    await run(() => loop.requestSolve(state.line.id));
    expect(setupBodies).toHaveLength(1);
  });
});
