import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { ApiError } from "@/lib/api-client";
import { createFakeEditor, type FakeEditor } from "../__fixtures__/fakeEditor";
import { fixtureSingleLine, writeLine } from "../__fixtures__/strokes";
import { settle, settleStable, settleUntil } from "@/lib/live/__fixtures__/settle";
import { useSyncHash } from "@/lib/live/__fixtures__/syncHash";
import {
  CheckRequestSchema,
  type CheckRequest,
  type LiveEngine,
  type LiveSseEvent,
  type MathShapeProps,
  type RecognizeResponse,
  type SolveRequest,
  type SolveStep,
  type UseLiveMathOptions,
} from "../contracts";
import { getEngine } from "../engine";
import { createLiveLoop, needsLook, NOTE_WRAP_CHARS, proseWordCount, textAsLatex, wrapWords, type LiveLoop } from "../liveLoop";
import { liveStore, resetLiveStore } from "../liveStore";
import { RecognizeClient, type FetchJson } from "../recognizeClient";

/**
 * "Help" — the board's one explicit ask, which replaced "Draw help" when the image pipeline
 * was removed. Everything it does is text/LaTeX the client renders; nothing is painted.
 *
 *  - Solve: the worked solution (word problems go to /api/live/solve with the prose as the
 *    question);
 *  - Feedback / Suggest: the next hint for the latest line;
 *  - ink Live cannot read as maths: "Ask about this" — a crop of that ink rides along on a
 *    normal check, and ONLY then: an automatic check never carries a picture.
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

function annotation(lineId: string | null, message: string, question?: string): LiveSseEvent {
  return { event: "annotation", data: { lineId, verdict: "info", kind: "concept", message, question, confidence: 0.8 } };
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

  function makeLoop(mode: UseLiveMathOptions["mode"]): LiveLoop {
    const stream = async function* (path: string, body: unknown): AsyncGenerator<LiveSseEvent, void, undefined> {
      calls.push({ path, body });
      for (const ev of script.shift() ?? []) yield ev;
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
        // the hand is ON: a word problem must still skip the local paths and reach the model
        handwritingEnabled: () => true,
        reducedMotion: () => true,
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

  // ------------------------------------------------------------ Ask about this
  it("unreadable ink: Help sends ONE check with a crop of that line and shows the answer as a typeset note", async () => {
    reads = [{ latex: "2x+?", confidence: 0.3 }];
    const lineId = await write();
    expect(editor.shapesOfType("math")).toHaveLength(0); // low confidence: no echo
    expect(calls).toEqual([]);
    expect(crops).toBe(0); // nothing is captured until the student asks

    script = [[annotation(lineId, "This looks like 2x + 7; rewrite the last symbol more clearly.")]];
    await help();

    expect(crops).toBe(1);
    expect(checks()).toHaveLength(1);
    const req = checks()[0];
    expect(req).toMatchObject({ crop: CROP, userAsked: true, focusLineId: lineId, mode: "feedback" });
    expect(req.lines.map((l) => l.id)).toContain(lineId);
    // what the loop sends is exactly what the route accepts
    expect(CheckRequestSchema.safeParse(req).success).toBe(true);
    expect(solves()).toEqual([]);

    expect(aiShapes()).toHaveLength(1);
    expect(aiShapes()[0]).toMatchObject({
      latex: textAsLatex("This looks like 2x + 7; rewrite the last symbol more clearly."),
      tone: "muted",
      lineId,
    });
  });

  it("a read that FAILED (no LaTeX at all) is asked about too: the focus line goes along empty", async () => {
    reads = [new ApiError("boom", 502, "upstream_error")];
    const lineId = await write();
    expect(liveStore.lines.get()[lineId].latex).toBe("");

    script = [[annotation(lineId, "I can't make this out; try writing it a little larger.")]];
    await help();

    const req = checks()[0];
    expect(req.crop).toBe(CROP);
    expect(req.lines.find((l) => l.id === lineId)).toMatchObject({ latex: "", local: { kind: "unknown" } });
    expect(CheckRequestSchema.safeParse(req).success).toBe(true);
    expect(aiShapes().map((p) => p.latex)).toEqual([textAsLatex("I can't make this out; try writing it a little larger.")]);
  });

  it("a lone symbol (a drawn \\Delta) in Suggest: the crop goes along and the question joins the note", async () => {
    start("suggest");
    reads = [{ latex: "\\Delta" }];
    const lineId = await write();
    script = [[annotation(lineId, "That triangle has no side lengths yet.", "Which side do you know?")]];
    await help();

    expect(checks()[0]).toMatchObject({ crop: CROP, mode: "suggest", userAsked: true });
    expect(aiShapes().map((p) => p.latex)).toEqual([textAsLatex("That triangle has no side lengths yet. Which side do you know?")]);
  });

  it("never fires on its own: automatic checks carry no crop and capture nothing", async () => {
    start("suggest");
    reads = [{ latex: "2x+3=11" }, { latex: "x=5" }, { latex: "2x+?", confidence: 0.3 }];
    await write(writeLine("2x+3=11", 100, 200, 40));
    await write(writeLine("x=3", 100, 300, 40)); // read as x=5: a mismatch: Suggest checks it by itself
    await write(writeLine("2x+1", 100, 400, 40)); // unreadable, but nobody asked
    await vi.advanceTimersByTimeAsync(30_000);
    await settle(8);

    expect(checks().length).toBeGreaterThan(0);
    for (const req of checks()) {
      expect(req.crop).toBeUndefined();
    }
    expect(crops).toBe(0);
  });

  it("does nothing with help set to Off", async () => {
    start("off");
    reads = [{ latex: "2x+?", confidence: 0.3 }];
    await write();
    await help();
    expect(calls).toEqual([]);
    expect(crops).toBe(0);
  });

  // ------------------------------------------------------------ readable maths
  it("Feedback on a readable line: the next hint for it, with no picture", async () => {
    reads = [{ latex: "2x+3=11" }, { latex: "x=5" }];
    await write(writeLine("2x+3=11", 100, 200, 40));
    const lineId = await write(writeLine("x=3", 100, 300, 40)); // read as x=5
    await help();

    expect(checks()).toHaveLength(1);
    expect(checks()[0]).toMatchObject({ focusLineId: lineId, userAsked: true, mode: "suggest" });
    expect(checks()[0].crop).toBeUndefined();
    expect(crops).toBe(0);
  });

  // ------------------------------------------------------------ word problems
  it("Solve on a word problem: the prose goes to /api/live/solve as the question, and assignment steps are drawn", async () => {
    start("answer");
    reads = [{ latex: WORD_PROBLEM }];
    const lineId = await write();
    expect(liveStore.lines.get()[lineId].analysis?.kind).toBe("text");

    script = [[step(1, "v = \\frac{60}{2}"), step(2, "\\boxed{v = 30}", true)]];
    await help();

    expect(checks()).toEqual([]);
    expect(solves()).toHaveLength(1);
    const req = solves()[0];
    expect(req.lines).toEqual([expect.objectContaining({ id: lineId, latex: WORD_PROBLEM, local: expect.objectContaining({ kind: "text" }) })]);
    // the guard lets the solution name its own quantity, and use it afterwards
    expect(aiShapes().map((p) => p.latex)).toEqual(["v = \\frac{60}{2}", "\\boxed{v = 30}"]);
    expect(liveStore.lastError.get()).toBeNull();
  });
});

describe("needsLook / textAsLatex", () => {
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

  it("escapes what KaTeX's \\text would choke on", () => {
    expect(textAsLatex("Use 50% of {x} & y_1 \\ ^ ~ #")).toBe("\\text{Use 50\\% of \\{x\\} \\& y\\_1 \\#}");
  });

  it("wraps a long note into a left-aligned block instead of one line off the screen", () => {
    const note =
      "This looks like a drawn triangle or a delta symbol with a curved side. Could you rewrite this symbol more clearly?";
    const lines = wrapWords(note);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(NOTE_WRAP_CHARS);
    expect(lines.join(" ")).toBe(note);
    const tex = textAsLatex(note);
    expect(tex.startsWith("\\begin{array}{l}\\text{")).toBe(true);
    expect(tex.endsWith("}\\end{array}")).toBe(true);
    expect(tex.split("\\\\").length).toBe(lines.length);
  });

  it("keeps a word longer than the limit whole", () => {
    expect(wrapWords(`a ${"x".repeat(60)} b`, 10)).toEqual(["a", "x".repeat(60), "b"]);
  });
});
