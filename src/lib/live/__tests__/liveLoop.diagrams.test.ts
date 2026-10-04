import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { LIVE_COPY } from "@/components/live/copy";
import type { TLShapeId } from "tldraw";
import { boundsOf, DRAWINGS, labelAt, Pen, writeAt, type Drawing } from "@/__eval__/drawings";
import { VARIANTS } from "@/__eval__/handwriting";
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
  type SolveRequest,
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
  /** a read of a row of ink as one line (`ink_…`); null: the same as `lineRead` */
  let inkRead: string | null;
  let labelRead: string;
  /** the solve model's steps, and what it was asked */
  let streamSteps: string[];
  let solveBodies: SolveRequest[];
  let setupReply: string[] | Error;
  let setupBodies: SetupRequest[];
  /** the quiet notes the board showed (`deps.notify`) */
  let notes: string[];
  /** while set, a read of a drawing's ink as maths (`ink_…`) waits for it; the solve stream likewise */
  let inkGate: Promise<void> | null;
  let streamGate: Promise<void> | null;

  const recognizeBodies = () => fetchJson.mock.calls.map((c) => c[1] as RecognizeRequest);
  const lineReads = () => recognizeBodies().filter((b) => !b.lineId.startsWith("dg_"));
  const labelReads = () => recognizeBodies().filter((b) => b.lineId.startsWith("dg_"));

  function start(mode: UseLiveMathOptions["mode"] = "answer"): void {
    loop?.stop();
    resetLiveStore();
    loop = createLiveLoop(
      editor,
      { boardId: "board-1", mode, enabled: true },
      {
        recognizer: new RecognizeClient({ fetchJson }),
        stream: async function* (path: string, body: unknown): AsyncGenerator<LiveSseEvent, void, undefined> {
          calls.push(path);
          if (path.endsWith("/solve")) solveBodies.push(body as SolveRequest);
          if (streamGate) await streamGate;
          for (const [i, latex] of streamSteps.entries()) yield { event: "step", data: { index: i + 1, latex, explanation: "", final: i === streamSteps.length - 1 } };
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
        notify: (message) => notes.push(message),
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
    inkRead = null;
    labelRead = "\\begin{array}{l}\nx \\\\\n3 \\\\\n4\n\\end{array}";
    streamSteps = [];
    solveBodies = [];
    setupReply = PYTHAGORAS;
    setupBodies = [];
    notes = [];
    inkGate = null;
    streamGate = null;
    fetchJson = vi.fn<FetchJson>(async (_path, body): Promise<RecognizeResponse> => {
      const req = body as RecognizeRequest;
      if (req.lineId.startsWith("ink_") && inkGate) await inkGate;
      const latex = req.lineId.startsWith("dg_") ? labelRead : req.lineId.startsWith("ink_") ? (inkRead ?? lineRead) : lineRead;
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

  it("on a phone, where the board is shown at a fifth of its size, `2x2` written big is a line of maths, not a drawing", async () => {
    // 130 page px tall: an ordinary hand on a phone held upright. Judged in desktop page px, both
    // 2s were "big curves" and the x their label, and Solve sent the "figure" to the vision model
    editor.getBaseZoom = () => 0.2;
    const ink = writeAt("2x2", 200, 200, undefined, 5);
    await draw(ink);
    expect(liveStore.diagrams.get()).toEqual([]);
    expect(lineReads()).toHaveLength(1);
    expect(lineReads()[0].strokes.x).toHaveLength(ink.length);
    expect(Object.values(liveStore.lines.get()).map((st) => [...st.line.strokeIds].sort())).toEqual([[...idsOf(ink)].sort()]);
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
    expect(liveStore.lastError.get()).toMatchObject({ kind: "solve", message: LIVE_COPY.solve.failed });
  });

  // ------------------------------------------------------------ writing taken for a drawing
  /**
   * The prod bug: `2x2` written with a finger on a phone, Solve it, "Couldn't work this out". Written
   * that large the ink came apart into "drawings" (`splitInk`); the figure model was asked what the
   * figure asks and rightly said nothing. Now a drawing that is no figure is read as maths first.
   * (`2x2` itself is a line now, at any size: three glyph columns in a row are writing. Two glyphs
   * side by side, `2^{3}`, could as well be two drawings, and still come apart.)
   */
  const largeInk = (latex: string) => writeAt(latex, 150, 200, VARIANTS[0], 8);
  const inkReads = () => recognizeBodies().filter((b) => b.lineId.startsWith("ink_"));

  it("Solve on `2^{3}` written large and taken for drawings: read as one line of maths, `= 8` beside it, no figure model", async () => {
    lineRead = "2^{3}";
    const ink = largeInk("2^{3}");
    await draw(ink);
    // the misreading this is about: no line, only drawings, none of them a figure
    expect(liveStore.diagrams.get().length).toBeGreaterThan(1);
    expect(Object.keys(liveStore.lines.get())).toEqual([]);
    await run(() => loop.requestSolve());

    // one read of the WHOLE row — every stroke — not of the piece that was touched last
    expect(inkReads()).toHaveLength(1);
    expect(inkReads()[0].strokes.x).toHaveLength(ink.reduce((n, st) => n + st.segments.length, 0));
    expect(setupBodies).toEqual([]);
    expect(handLinesOf(tutorInk())).toEqual(["= 8"]);
    const right = Math.max(...ink.map((st) => st.bounds.x + st.bounds.w));
    const below = Math.max(...ink.map((st) => st.bounds.y + st.bounds.h));
    expect(tutorInk().every((sh) => sh.x >= right || sh.y >= below)).toBe(true);
    expect(liveStore.lastError.get()).toBeNull();
    expect(liveStore.solving.get()).toBe(0);

    // asking again: the answer is there already, nothing new is written and nothing else is asked
    const written = tutorInk().length;
    await run(() => loop.requestHelp());
    expect(tutorInk()).toHaveLength(written);
    expect(setupBodies).toEqual([]);
  });

  it("an expression with nothing to do (`x^{2}`), written large: the note, not an error and not the figure model", async () => {
    lineRead = "x^{2}";
    await draw(largeInk("x^{2}"));
    await run(() => loop.requestSolve());
    expect(inkReads()).toHaveLength(1);
    expect(setupBodies).toEqual([]);
    expect(tutorInk()).toEqual([]);
    expect(notes).toEqual([LIVE_COPY.solve.simplest]);
    expect(liveStore.lastError.get()).toBeNull();
  });

  it("the screen left while the ink is read: nothing is written on the next screen, and its own solve keeps the pill's count", async () => {
    // a problem of the student's on a second screen, from before
    const first = editor.getCurrentPage().id;
    const second = editor.addPage();
    editor.switchPage(second);
    await settle();
    lineRead = "2a+b=8";
    await draw(writeAt("2a + b = 8", 200, 300));
    expect(echoes()).toHaveLength(1);
    editor.switchPage(first);
    await settle();

    // Solve on `2^{3}` written large: its ink is read as maths, slowly
    lineRead = "2^{3}";
    await draw(largeInk("2^{3}"));
    let release!: () => void;
    inkGate = new Promise<void>((r) => (release = r));
    // the read lands although the screen was left (it was still being hashed, or its reply was
    // already on its way): the recognizer's abort cannot be what keeps it off the next screen
    const abortAll = vi.spyOn(RecognizeClient.prototype, "abortAll").mockImplementation(() => {});
    let releaseStream!: () => void;
    try {
      loop.requestSolve();
      await settle();
      expect(inkReads()).toHaveLength(1);
      expect(liveStore.solving.get()).toBe(1);

      // the student goes to the other screen and asks Solve there: the model is on it
      streamGate = new Promise<void>((r) => (releaseStream = r));
      editor.switchPage(second);
      await settle();
      loop.requestSolve();
      await settle();
      expect(calls).toEqual(["/api/live/solve"]);
      expect(liveStore.solving.get()).toBe(1);

      release();
      await settle();
      await vi.advanceTimersByTimeAsync(500);
      await settle();
      const here = editor.getCurrentPageShapes().filter((sh) => sh.type === "draw" && isLiveMeta(sh.meta) && sh.meta.source === "ai" && !(sh.meta as Record<string, unknown>).mark);
      expect(handLinesOf(here)).toEqual([]);
      expect(liveStore.solving.get()).toBe(1);
    } finally {
      abortAll.mockRestore();
      releaseStream?.();
    }
    await settle();
    expect(liveStore.solving.get()).toBe(0);
  });

  it("ink that does not read as maths goes on to the figure model, as before", async () => {
    lineRead = "\\nearrow \\searrow";
    await draw(largeInk("2^{3}"));
    await run(() => loop.requestSolve());
    expect(inkReads()).toHaveLength(1);
    expect(setupBodies).toHaveLength(1);
    expect(setupBodies[0].crop).toBe(CROP);
  });

  // ------------------------------------------------------------ big writing on a desktop
  it("the owner's board: `(x+y)^2 =` written with 220 px brackets on a desktop is one line of maths, and Solve never asks the figure model", async () => {
    // before: the 30 px glyph cap made the x's two 120 px strokes "long diagonals" — a drawing
    // beside the line — and Solve sent it to the vision model, which said nothing was asked
    lineRead = "(x+y)^{2}=";
    const ink = writeAt("(x+y)^{2} =", 150, 200, VARIANTS[0], 7.5);
    expect(ink[0].bounds.h).toBeGreaterThan(210);
    await draw(ink);
    expect(liveStore.diagrams.get()).toEqual([]);
    expect(lineReads()).toHaveLength(1);
    expect(lineReads()[0].strokes.x).toHaveLength(ink.length);
    const state = lineOf(ink)!;
    expect([...state.line.strokeIds].sort()).toEqual([...idsOf(ink)].sort());
    await run(() => loop.requestSolve(state.line.id));
    expect(setupBodies).toEqual([]);
    expect(tutorInk().length).toBeGreaterThan(0);
    expect(liveStore.lastError.get()).toBeNull();
  });

  /**
   * A line of ordinary writing with one letter written big: its x — two 140 px diagonals beside a
   * 44 px hand — is still a drawing to `splitInk` (and the `2` before it its label), so the line is
   * read without them (`+3=11`, `!=24`). Before, Solve sent the "figure" to the vision model; when it
   * said nothing was asked, the worked solution was asked for the torn line, and a step naming the x
   * was thrown away as a symbol from nowhere: "Couldn't solve this one — try writing it again a bit
   * clearer". Now the row — the line and the drawing on it — is read as one line and solved.
   */
  function bigXIn(before: string, after: string): { line: InkStroke[]; drawn: InkStroke[] } {
    const left = before ? writeAt(before, 200, 300) : [];
    const lb = left.length > 0 ? boundsOf(left) : { x: 186, y: 300, w: 0, h: 26 };
    const right0 = writeAt(after, 0, 0);
    const mid = lb.y + lb.h / 2;
    const x0 = lb.x + lb.w + 14;
    const pen = new Pen("bigx", 3);
    const x = [pen.stroke({ x: x0, y: mid - 70 }, { x: x0 + 120, y: mid + 70 }), pen.stroke({ x: x0 + 120, y: mid - 70 }, { x: x0, y: mid + 70 })];
    const right = writeAt(after, x0 + 134, mid - boundsOf(right0).h / 2);
    return { line: right, drawn: [...left, ...x] };
  }

  it("Solve on a line with a big x torn out of it: the row is read as one line, the engine's answer goes under it, no figure model", async () => {
    lineRead = "+3=11";
    inkRead = "2x+3=11";
    const { line, drawn } = bigXIn("2", "+ 3 = 11");
    await draw([...drawn, ...line]);
    // the misreading this is about: the x (and the 2 beside it) a drawing, the line without them
    expect(liveStore.diagrams.get()).toEqual([expect.objectContaining({ kinds: ["segment"] })]);
    const state = lineOf(line)!;
    expect([...state.line.strokeIds].sort()).toEqual([...idsOf(line)].sort());

    await run(() => loop.requestSolve(state.line.id));
    // one read of the whole row: the line's strokes, the x's and the 2's
    expect(inkReads()).toHaveLength(1);
    expect(inkReads()[0].strokes.x).toHaveLength(line.length + drawn.length);
    expect(setupBodies).toEqual([]);
    expect(calls).toEqual([]);
    const steps = localSolve(engine, ["2x+3=11"], 0, { handwriting: true }).steps;
    expect(steps[steps.length - 1]).toBe("x = 4");
    expect(handLinesOf(tutorInk())).toEqual(steps);
    // under the work: the line and the ink on its row
    const bottom = Math.max(...[...line, ...drawn].map((st) => st.bounds.y + st.bounds.h));
    expect(Math.min(...tutorInk().map((sh) => sh.y))).toBeGreaterThan(bottom);
    expect(tutorInk().every((sh) => isLiveMeta(sh.meta) && sh.meta.lineId === state.line.id)).toBe(true);
    expect(liveStore.lastError.get()).toBeNull();
    expect(liveStore.solving.get()).toBe(0);

    // asked again: the answer is there, nothing is written twice and no model is asked
    const written = tutorInk().length;
    await run(() => loop.requestSolve(state.line.id));
    expect(tutorInk()).toHaveLength(written);
    expect(setupBodies).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("...and when the engine has nothing for the whole line, the model is asked with it, and its steps naming the x are kept", async () => {
    lineRead = "!=24";
    inkRead = "x!=24";
    streamSteps = ["x! = 4!", "x = 4"];
    const { line, drawn } = bigXIn("", "! = 24");
    await draw([...drawn, ...line]);
    expect(liveStore.diagrams.get()).toHaveLength(1);
    const state = lineOf(line)!;
    await run(() => loop.requestSolve(state.line.id));

    expect(setupBodies).toEqual([]);
    expect(calls).toEqual(["/api/live/solve"]);
    // the model was told the whole line, not the torn one
    expect(solveBodies[0].lines.find((l) => l.id === state.line.id)?.latex).toBe("x!=24");
    expect(handLinesOf(tutorInk())).toEqual(["x! = 4!", "x = 4"]);
    expect(liveStore.lastError.get()).toBeNull();
    expect(liveStore.solving.get()).toBe(0);
  });

  it("a big x read with its row that is no maths goes on to the figure model and its fallback, as any drawing beside the work", async () => {
    lineRead = "+3=11";
    inkRead = "\\nearrow \\searrow";
    setupReply = new Error("no figure here");
    const { line, drawn } = bigXIn("2", "+ 3 = 11");
    await draw([...drawn, ...line]);
    await run(() => loop.requestSolve(lineOf(line)!.line.id));
    expect(inkReads()).toHaveLength(1);
    expect(setupBodies).toHaveLength(1);
    expect(calls).toEqual(["/api/live/solve"]);
  });

  it("a real figure is never read as a line of maths", async () => {
    const tri = triangleAt(400, 200);
    await draw([...tri.strokes, ...tri.labels.flat()]);
    await run(() => loop.requestHelp());
    expect(inkReads()).toEqual([]);
    expect(setupBodies).toHaveLength(1);
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
