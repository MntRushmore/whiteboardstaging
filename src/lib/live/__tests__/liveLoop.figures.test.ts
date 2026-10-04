import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { LIVE_COPY } from "@/components/live/copy";
import { angleArc, angleLabel, boundsOf, DRAWINGS, Pen, writeAt, type Drawing } from "@/__eval__/drawings";
import { createFakeEditor, type FakeEditor } from "../__fixtures__/fakeEditor";
import { drawShapeFromPoints } from "../__fixtures__/strokes";
import { settle, settleStable } from "@/lib/live/__fixtures__/settle";
import { useSyncHash } from "@/lib/live/__fixtures__/syncHash";
import { isLiveMeta, type InkStroke, type LiveEngine, type LiveSseEvent, type RecognizeRequest, type RecognizeResponse, type SetupRequest, type SetupResponse, type UseLiveMathOptions } from "../contracts";
import { getEngine } from "../engine";
import { handLinesOf } from "../handwriting";
import { ANSWER_SETTLE_MS, createLiveLoop, type LiveLoop } from "../liveLoop";
import { liveStore, resetLiveStore } from "../liveStore";
import { RecognizeClient, type FetchJson } from "../recognizeClient";

/**
 * "The tutor reads the figure", unasked (`LiveLoop.solveWantedFigures`): in Solve, a figure the
 * student labelled with an unknown and left is worked out beside it once they stop — once per
 * figure-and-labels version, never over an erase, never in Feedback / Suggest, never with a line
 * beside it or a proof on the screen — and the board writes only what it can check (`figureAnswer`).
 */

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

const CROP = "data:image/jpeg;base64,ZmFrZQ==";
const LABELS = "\\begin{array}{l}\n40^{\\circ} \\\\\nx \\\\\n65^{\\circ}\n\\end{array}";
const FACTS: SetupResponse = {
  lines: ["x + 40 + 65 = 180"],
  unknown: "x",
  model: "google/gemini-3.1-flash-lite",
  ms: 900,
  figure: { source: "facts", stages: [{ letter: "x", lines: ["x + 40 + 65 = 180"], value: 75, kind: "angle" }] },
};
const BLOCK = ["x + 40 + 65 = 180", "x + 105 = 180", "x = 75"];

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

/** A triangle with its angles labelled 40°, x, 65°, its top-left at (x, y). */
function triangleAt(x: number, y: number): Drawing {
  const raw = DRAWINGS.triangleOneStroke(0, 0, 3);
  const b = boundsOf([...raw.strokes, ...raw.labels.flat()]);
  return DRAWINGS.triangleOneStroke(x - b.x, y - b.y, 3);
}
const inkOf = (d: Drawing) => [...d.strokes, ...d.labels.flat()];

describe("live loop — a figure worked out unasked", () => {
  useSyncHash();

  let editor: FakeEditor;
  let fetchJson: Mock<FetchJson>;
  let loop: LiveLoop;
  let lineRead: string;
  let labelRead: string;
  let reply: SetupResponse | Error;
  let setupBodies: SetupRequest[];
  let streams: string[];
  /** the quiet notes the board showed (`deps.notify`: the toast, never the red card) */
  let notes: string[];

  function start(mode: UseLiveMathOptions["mode"] = "answer"): void {
    loop?.stop();
    resetLiveStore();
    loop = createLiveLoop(
      editor,
      { boardId: "board-1", mode, enabled: true },
      {
        recognizer: new RecognizeClient({ fetchJson }),
        stream: async function* (path: string): AsyncGenerator<LiveSseEvent, void, undefined> {
          streams.push(path);
        },
        getEngine: async () => engine,
        fetchCapabilities: async () => ({ recognizer: "mathpix", liveEnabled: true, models: { check: "c", solve: "s", vision: "v" } }),
        events: null,
        isOnline: () => true,
        handwritingEnabled: () => true,
        reducedMotion: () => true,
        setup: async (req) => {
          setupBodies.push(req);
          if (reply instanceof Error) throw reply;
          return reply;
        },
        reread: async () => {
          throw new Error("no second reader in this file");
        },
        notify: (message) => notes.push(message),
      },
    );
    loop.start();
  }

  async function draw(strokes: readonly InkStroke[]): Promise<void> {
    editor.putUser(shapesOf(strokes));
    await vi.advanceTimersByTimeAsync(1_000);
    await settleStable(() => `${fetchJson.mock.calls.length}|${editor.shapesOfType("math").length}`);
  }

  /** The student stops: the settle, the label read, the model call, the hand. */
  async function stop(): Promise<void> {
    await vi.advanceTimersByTimeAsync(ANSWER_SETTLE_MS + 100);
    await settle();
    await vi.advanceTimersByTimeAsync(3_000);
    await settleStable(() => [setupBodies.length, fetchJson.mock.calls.length, editor.shapesOfType("draw").length, liveStore.solving.get()].join("|"));
  }

  async function run(action: () => void): Promise<void> {
    action();
    await settle();
    await vi.advanceTimersByTimeAsync(5_000);
    await settleStable(() => [setupBodies.length, editor.shapesOfType("draw").length, liveStore.solving.get()].join("|"));
  }

  const tutorInk = () => editor.shapesOfType("draw").filter((s) => isLiveMeta(s.meta) && s.meta.source === "ai" && !(s.meta as Record<string, unknown>).mark);

  /**
   * The student taps the figure with the select tool: Help is about it (a pick wins over where the pen
   * last wrote, `helpTargetLine`), the same ink. Lifting a stroke and putting it back no longer did:
   * that is Undo, which never moves Help.
   */
  async function touch(d: Drawing): Promise<void> {
    editor.select(shapesOf(d.strokes).map((s) => s.id));
    await settle();
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.stubGlobal("FileReader", FakeFileReader);
    editor = createFakeEditor();
    editor.toImage = (async () => ({ blob: new Blob(["jpeg-bytes"], { type: "image/jpeg" }), width: 300, height: 200 })) as unknown as FakeEditor["toImage"];
    lineRead = "2x+3=11";
    labelRead = LABELS;
    reply = FACTS;
    setupBodies = [];
    streams = [];
    notes = [];
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

  it("in Solve, a labelled figure left alone is worked out beside it, once", async () => {
    const tri = triangleAt(300, 200);
    await draw(inkOf(tri));
    expect(setupBodies).toEqual([]);
    await stop();

    expect(setupBodies).toEqual([{ boardId: "board-1", lines: [], labels: ["40^{\\circ}", "x", "65^{\\circ}"], crop: CROP }]);
    expect(handLinesOf(tutorInk())).toEqual(BLOCK);
    const figure = liveStore.diagrams.get()[0];
    expect(Math.min(...tutorInk().map((s) => s.x))).toBeGreaterThan(figure.bounds.x + figure.bounds.w);
    expect(tutorInk().every((s) => isLiveMeta(s.meta) && s.meta.lineId === figure.id)).toBe(true);
    expect(liveStore.lastError.get()).toBeNull();
    expect(streams).toEqual([]);

    // writing elsewhere, far from it, and stopping again: nothing new, no second call
    await draw(writeAt("2x + 3 = 11", 1100, 700));
    await stop();
    expect(setupBodies).toHaveLength(1);
    expect(handLinesOf(tutorInk().filter((s) => isLiveMeta(s.meta) && s.meta.lineId === figure.id))).toEqual(BLOCK);
  });

  it("Feedback and Suggest stay quiet until asked", async () => {
    for (const mode of ["feedback", "suggest"] as const) {
      start(mode);
      await draw(inkOf(triangleAt(300, 200)));
      await stop();
      expect(setupBodies, mode).toEqual([]);
      expect(tutorInk(), mode).toEqual([]);
      editor.removeUser(editor.shapesOfType("draw").map((s) => s.id));
      await settle();
    }
  });

  it("a line written beside the figure (`x = ?`) is a question for Solve: nothing unasked", async () => {
    lineRead = "x=?";
    const tri = triangleAt(200, 200);
    const b = boundsOf(inkOf(tri));
    await draw([...inkOf(tri), ...writeAt("x = ?", b.x + b.w + 40, b.y + 60)]);
    await stop();
    expect(setupBodies).toEqual([]);
    expect(tutorInk()).toEqual([]);
  });

  it("a proof on the screen (Given / Prove) leaves its figure alone", async () => {
    lineRead = "\\text { Given: } \\overline{A B} \\cong \\overline{C D}";
    await draw([...inkOf(triangleAt(300, 150)), ...writeAt("x", 900, 700)]);
    await stop();
    expect(Object.values(liveStore.lines.get()).map((s) => s.latex)).toEqual([lineRead]);
    expect(setupBodies).toEqual([]);
  });

  it("axes labelled x and y are a graph, not a figure: not sent", async () => {
    labelRead = "\\begin{array}{l}\nx \\\\\ny \\\\\n(2,3)\n\\end{array}";
    const axes = DRAWINGS.axesAndLine(300, 150, 5);
    await draw(inkOf(axes));
    await stop();
    expect(liveStore.diagrams.get()[0]?.kinds).toContain("axes");
    expect(setupBodies).toEqual([]);
  });

  it("labels with nothing to find (numbers, vertex names) are not sent", async () => {
    labelRead = "\\begin{array}{l}\nA \\\\\n3 \\\\\n4\n\\end{array}";
    await draw(inkOf(triangleAt(300, 200)));
    await stop();
    expect(setupBodies).toEqual([]);
  });

  it("an answer the student rubs out is not written again unasked; asking brings it back with no second call", async () => {
    const tri = triangleAt(300, 200);
    await draw(inkOf(tri));
    await stop();
    expect(handLinesOf(tutorInk())).toEqual(BLOCK);
    const key = String((tutorInk()[0].meta as Record<string, unknown>).solvedLatex);
    expect(key).toMatch(/^figure: /);

    // rubbed out (all of it)
    editor.removeUser(tutorInk().map((s) => s.id));
    await settle();
    expect((editor.getCurrentPage().meta as Record<string, unknown>).liveFiguresDismissed).toEqual([key]);
    lineRead = "y"; // read as what it is: a stray letter, nothing for Auto to finish
    await draw(writeAt("y", 1200, 750));
    await stop();
    expect(tutorInk()).toEqual([]);
    expect(setupBodies).toHaveLength(1);

    // a reload agrees
    start();
    await draw(writeAt("z", 1200, 820));
    await stop();
    expect(tutorInk()).toEqual([]);
    expect(setupBodies).toHaveLength(1);

    // asking about it (the figure the last thing touched): it comes back (replies are kept in memory,
    // so after the reload this is the one new call)
    await touch(tri);
    await run(() => loop.requestHelp());
    expect(handLinesOf(tutorInk())).toEqual(BLOCK);
    expect(setupBodies).toHaveLength(2);
    expect((editor.getCurrentPage().meta as Record<string, unknown>).liveFiguresDismissed).toEqual([]);
  });

  it("rubbed out and asked for again in the same session: no second call", async () => {
    const tri = triangleAt(300, 200);
    await draw(inkOf(tri));
    await stop();
    editor.removeUser(tutorInk().map((s) => s.id));
    await settle();
    await touch(tri);
    await run(() => loop.requestHelp());
    expect(handLinesOf(tutorInk())).toEqual(BLOCK);
    expect(setupBodies).toHaveLength(1);
  });

  it("a reply the board cannot check is not written, says nothing, and is not asked for again", async () => {
    // the planner says 70, the engine solves its equation to 75: nothing is written
    reply = { ...FACTS, figure: { source: "facts", stages: [{ letter: "x", lines: ["x + 40 + 65 = 180"], value: 70, kind: "angle" }] } };
    await draw(inkOf(triangleAt(300, 200)));
    await stop();
    expect(setupBodies).toHaveLength(1);
    expect(tutorInk()).toEqual([]);
    expect(liveStore.lastError.get()).toBeNull();
    await draw(writeAt("y", 1200, 750));
    await stop();
    expect(setupBodies).toHaveLength(1);
  });

  it("the model's own lines are kept only when they solve to a sensible size", async () => {
    // a triangle whose angles would make x negative: nothing
    reply = { lines: ["x + 140 + 65 = 180"], unknown: "x", model: "m", ms: 900, figure: { source: "lines", reason: "the read did not hold up", kind: "angle" } };
    await draw(inkOf(triangleAt(300, 200)));
    await stop();
    expect(setupBodies).toHaveLength(1);
    expect(tutorInk()).toEqual([]);

    // another figure whose lines do solve: written
    reply = { lines: ["x + 40 + 65 = 180"], unknown: "x", model: "m", ms: 900, figure: { source: "lines", reason: "the read did not hold up", kind: "angle" } };
    editor.removeUser(editor.shapesOfType("draw").map((s) => s.id));
    await settle();
    await draw(inkOf(triangleAt(700, 250)));
    await stop();
    expect(setupBodies).toHaveLength(2);
    expect(handLinesOf(tutorInk())).toEqual(BLOCK);
  });

  it("a failed call is silent and not repeated unasked; Help asks again", async () => {
    reply = Object.assign(new Error("upstream"), { code: "upstream_error" });
    const tri = triangleAt(300, 200);
    await draw(inkOf(tri));
    await stop();
    expect(setupBodies).toHaveLength(1);
    expect(liveStore.lastError.get()).toBeNull();
    lineRead = "y"; // read as what it is: a stray letter, nothing for Auto to finish
    await draw(writeAt("y", 1200, 750));
    await stop();
    expect(setupBodies).toHaveLength(1);

    reply = FACTS;
    await touch(tri);
    await run(() => loop.requestHelp());
    expect(setupBodies).toHaveLength(2);
    expect(handLinesOf(tutorInk())).toEqual(BLOCK);
  });

  it("the student starting again while it is read: the reply waits for the next stop", async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((r) => (release = r));
    const slow = FACTS;
    loop.stop();
    resetLiveStore();
    loop = createLiveLoop(
      editor,
      { boardId: "board-1", mode: "answer", enabled: true },
      {
        recognizer: new RecognizeClient({ fetchJson }),
        stream: async function* (): AsyncGenerator<LiveSseEvent, void, undefined> {},
        getEngine: async () => engine,
        fetchCapabilities: async () => ({ recognizer: "mathpix", liveEnabled: true, models: { check: "c", solve: "s", vision: "v" } }),
        events: null,
        isOnline: () => true,
        handwritingEnabled: () => true,
        reducedMotion: () => true,
        setup: async (req) => {
          setupBodies.push(req);
          await gate;
          return slow;
        },
        reread: async () => {
          throw new Error("no second reader");
        },
      },
    );
    loop.start();
    await draw(inkOf(triangleAt(300, 200)));
    await vi.advanceTimersByTimeAsync(ANSWER_SETTLE_MS + 100);
    await settle(20);
    expect(setupBodies).toHaveLength(1);
    // pen down somewhere else, then the reply
    lineRead = "y"; // read as what it is: a stray letter, nothing for Auto to finish
    await draw(writeAt("y", 1200, 750));
    release!();
    await settle(20);
    expect(tutorInk()).toEqual([]);
    // stopped again: written from the reply already given
    await stop();
    expect(setupBodies).toHaveLength(1);
    expect(handLinesOf(tutorInk())).toEqual(BLOCK);
  });

  // ------------------------------------------------------------ nothing asked; not a figure

  const NOTHING_ASKED: SetupResponse = { lines: [], reason: "nothing_asked", model: "google/gemini-3.1-flash-lite", ms: 700 };

  it("asked on the drawing, a figure that asks nothing: a quiet note, never the red card; asking again costs nothing", async () => {
    start("feedback");
    reply = NOTHING_ASKED;
    labelRead = "\\begin{array}{l}\nA \\\\\nB\n\\end{array}";
    await draw(inkOf(triangleAt(300, 200)));
    await run(() => loop.requestHelp());
    expect(setupBodies).toHaveLength(1);
    expect(tutorInk()).toEqual([]);
    expect(liveStore.lastError.get()).toBeNull();
    expect(notes).toEqual([LIVE_COPY.solve.nothingAsked]);
    await run(() => loop.requestHelp());
    expect(setupBodies).toHaveLength(1);
    expect(notes).toEqual([LIVE_COPY.solve.nothingAsked, LIVE_COPY.solve.nothingAsked]);
    expect(liveStore.lastError.get()).toBeNull();
  });

  it("unasked, a figure that asks nothing is silent and not asked again", async () => {
    reply = NOTHING_ASKED;
    await draw(inkOf(triangleAt(300, 200)));
    await stop();
    expect(setupBodies).toHaveLength(1);
    lineRead = "y"; // read as what it is: a stray letter, nothing for Auto to finish
    await draw(writeAt("y", 1200, 750));
    await stop();
    expect(setupBodies).toHaveLength(1);
    expect(notes).toEqual([]);
    expect(liveStore.lastError.get()).toBeNull();
    expect(tutorInk()).toEqual([]);
  });

  /** Two lines crossing (open strokes), labelled x and 40°; with an arc in the x angle when `marked`. */
  function crossingAt(x: number, y: number, marked: boolean): InkStroke[] {
    const pen = new Pen(`cross${x}_${marked ? 1 : 0}`, 3);
    const v = { x: x + 150, y: y + 100 };
    const a = { x, y: y + 20 }, b = { x: x + 300, y: y + 180 }, c = { x: x + 40, y: y + 200 }, d = { x: x + 260, y };
    const strokes = [pen.stroke(a, b), pen.stroke(c, d)];
    if (marked) strokes.push(angleArc(pen, v, a, c, 24));
    return [...strokes, ...angleLabel("x", v, a, c, 60), ...angleLabel("40^{\\circ}", v, a, d, 60)];
  }

  it("unasked, open strokes with nothing on them are not a figure: not sent, whatever their labels say", async () => {
    // the prod bug: every pause in Solve sent large writing the board took for a drawing to the figure model
    labelRead = "\\begin{array}{l}\nx \\\\\n40^{\\circ}\n\\end{array}";
    await draw(crossingAt(300, 200, false));
    await stop();
    // a labelled drawing, its labels read (`x` asks): only that it is no figure keeps it from the model
    expect(liveStore.diagrams.get()).toEqual([expect.objectContaining({ labels: 2, read: ["x", "40^{\\circ}"] })]);
    expect(liveStore.diagrams.get().every((d) => !d.kinds.some((k) => ["triangle", "quadrilateral", "polygon", "circle"].includes(k)))).toBe(true);
    expect(setupBodies).toEqual([]);
    expect(liveStore.lastError.get()).toBeNull();
  });

  it("unasked, lines carrying an angle mark are a figure: sent", async () => {
    labelRead = "\\begin{array}{l}\nx \\\\\n40^{\\circ}\n\\end{array}";
    reply = { lines: ["x + 40 = 180"], unknown: "x", model: "m", ms: 900, figure: { source: "lines", reason: "r", kind: "angle" } };
    await draw(crossingAt(300, 200, true));
    await stop();
    expect(setupBodies).toHaveLength(1);
  });

  it.each([
    ["a lone unknown", "x"],
    ["an expression with nothing to find it from", "2x+10"],
    ["two letters", "\\begin{array}{l}\nx \\\\\ny\n\\end{array}"],
  ])("unasked, a figure whose labels give %s is not sent", async (_what, read) => {
    labelRead = read;
    await draw(inkOf(triangleAt(300, 200)));
    await stop();
    expect(setupBodies).toEqual([]);
  });

  it("asked on the drawing, a facts reply the engine disagrees with shows the pill and writes nothing", async () => {
    start("feedback");
    reply = { ...FACTS, figure: { source: "facts", stages: [{ letter: "x", lines: ["x + 40 + 65 = 180"], value: 70, kind: "angle" }] } };
    await draw(inkOf(triangleAt(300, 200)));
    await run(() => loop.requestHelp());
    expect(tutorInk()).toEqual([]);
    expect(liveStore.lastError.get()).toMatchObject({ kind: "solve", message: LIVE_COPY.solve.failed });
  });
});
