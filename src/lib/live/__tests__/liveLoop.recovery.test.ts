import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { TLDrawShape } from "tldraw";
import { ApiError, apiErrorFromResponse } from "@/lib/api-client";
import { createFakeEditor, type FakeEditor } from "../__fixtures__/fakeEditor";
import { fixtureSingleLine, writeLine } from "../__fixtures__/strokes";
import {
  LIVE_TIMING,
  type CapabilitiesResponse,
  type LineAnalysis,
  type LiveEngine,
  type LiveSseEvent,
  type MathShapeProps,
  type RecognizeRequest,
  type RecognizeResponse,
  type UseLiveMathOptions,
} from "../contracts";
import { createLiveLoop, isAiNote, type LiveLoop } from "../liveLoop";
import { liveStore, resetLiveStore } from "../liveStore";
import { RecognizeClient, recognizeFailureHints, type FetchJson } from "../recognizeClient";
import { settle } from "@/lib/live/__fixtures__/settle";
import { useSyncHash } from "@/lib/live/__fixtures__/syncHash";

/**
 * BUG-2 — a broken Mathpix must degrade to the vision recognizer instead of failing every
 * line with a 502. The server marks such a failure `needsCrop` (and `recognizerDown` when
 * the credentials themselves are bad); the client retries that one line WITH a crop and,
 * after a credential failure, attaches the crop on the first attempt from then on.
 *
 * BUG-4 — a note the model wrote must survive a reload. `reanalyzeAll` on mount used to
 * recompute the echo from the local engine and persist note:"" over the model's hint.
 */

/** Local engine: '2x=8' and '2x+3=11' are amber with no words of their own, 'x=4' is green. */
let localNotes: Record<string, string> = {};
const engine: LiveEngine = {
  analyzeLine: (latex): LineAnalysis => ({
    kind: "equation",
    math: latex,
    resultLatex: "",
    verdict: latex === "x=4" ? "ok" : latex ? "mismatch" : "unknown",
    note: localNotes[latex] ?? "",
  }),
  compileExpr: () => () => 0,
  solveLatex: () => null,
  verifyExpected: () => "unknown",
  balance: () => null,
  calculate: () => null,
};

const CAPS: CapabilitiesResponse = {
  recognizer: "mathpix",
  liveEnabled: true,
  models: { check: "c", solve: "s", vision: "v" },
};
const QUIET = LIVE_TIMING.rewriteQuietMs + LIVE_TIMING.quietMs + 1;
const CROP = "data:image/jpeg;base64,ZmFrZQ==";
const LLM_NOTE = "Check your division on the right side of line 3.";

function ok(latex: string, provider: RecognizeResponse["provider"] = "mathpix"): RecognizeResponse {
  return { latex, text: latex, kind: "math", confidence: 0.97, provider, ms: 120 };
}

/** The 502 the recognize route sends, with whatever additive hints the case needs. */
function recognizerFailed(hints: Record<string, unknown> = {}): ApiError {
  const err = new ApiError("Couldn't read this line right now.", 502, "recognizer_failed");
  err.body = { error: "recognizer_failed", message: "Couldn't read this line right now.", provider: null, ...hints };
  return err;
}

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

describe("live loop — vision fallback (BUG-2) and note provenance (BUG-4)", () => {
  // Deterministic, synchronous stroke hashing: see the fixture for why.
  useSyncHash();

  let editor: FakeEditor;
  let fetchJson: Mock<FetchJson>;
  let loop: LiveLoop;
  let opts: UseLiveMathOptions;
  /** every recognize body the loop sent, in order */
  let requests: RecognizeRequest[];
  /** FIFO recognize outcomes; a thrown value rejects. The last entry repeats. */
  let script: Array<RecognizeResponse | Error>;
  let streamScript: LiveSseEvent[][];
  let crops: number;

  function makeLoop(mode: UseLiveMathOptions["mode"] = "feedback"): LiveLoop {
    const stream = async function* (): AsyncGenerator<LiveSseEvent, void, undefined> {
      for (const ev of streamScript.shift() ?? []) yield ev;
    };
    opts = { boardId: "board-1", mode, enabled: true, voiceActive: false };
    return createLiveLoop(editor, opts, {
      recognizer: new RecognizeClient({ fetchJson }),
      stream,
      getEngine: async () => engine,
      fetchCapabilities: async () => CAPS,
      events: null,
      isOnline: () => true,
    });
  }

  async function penUp(shapes: TLDrawShape[]): Promise<void> {
    editor.putUser(shapes);
    await vi.advanceTimersByTimeAsync(QUIET);
    await settle();
  }

  function echo(): (MathShapeProps & { aiNote: boolean }) | null {
    const shape = editor.shapesOfType("math")[0];
    if (!shape) return null;
    return { ...(shape.props as MathShapeProps), aiNote: isAiNote(shape.meta) };
  }

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.stubGlobal("FileReader", FakeFileReader);
    resetLiveStore();
    localNotes = {};
    editor = createFakeEditor();
    crops = 0;
    editor.toImage = (async () => {
      crops++;
      return { blob: new Blob(["jpeg-bytes"], { type: "image/jpeg" }), width: 200, height: 40 };
    }) as unknown as FakeEditor["toImage"];
    requests = [];
    script = [];
    streamScript = [];
    fetchJson = vi.fn<FetchJson>(async (_path, body) => {
      requests.push(body as RecognizeRequest);
      const next = script.length > 1 ? script.shift() : script[0];
      if (next instanceof Error) throw next;
      return next ?? ok("2x=8");
    });
    loop = makeLoop();
    loop.start();
    await settle(2); // capabilities land -> recognizer 'mathpix'
  });

  afterEach(() => {
    loop.stop();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  // ---------------------------------------------------------------- BUG-2
  it("reads the additive hints off a real 502 body (needsCrop / recognizerDown)", async () => {
    const res = new Response(
      JSON.stringify({ error: "recognizer_failed", message: "nope", provider: null, needsCrop: true, recognizerDown: true }),
      { status: 502 },
    );
    const err = await apiErrorFromResponse(res);
    expect(recognizeFailureHints(err)).toEqual({ needsCrop: true, recognizerDown: true });
    // a plain recognizer_failed (no hints) and any other error mean "no fallback available"
    expect(recognizeFailureHints(recognizerFailed())).toEqual({ needsCrop: false, recognizerDown: false });
    expect(recognizeFailureHints(new ApiError("boom", 500, "internal_error"))).toEqual({
      needsCrop: false,
      recognizerDown: false,
    });
    expect(recognizeFailureHints(new TypeError("Failed to fetch"))).toEqual({ needsCrop: false, recognizerDown: false });
  });

  it("Mathpix down + needsCrop: exactly one retry, WITH a crop, and the echo appears", async () => {
    script = [recognizerFailed({ needsCrop: true }), ok("2x=8", "vision")];
    await penUp(fixtureSingleLine());

    expect(fetchJson).toHaveBeenCalledTimes(2);
    expect(requests[0].crop).toBeUndefined();
    expect(requests[1].crop).toBe(CROP);
    expect(requests[1].lineId).toBe(requests[0].lineId);
    expect(crops).toBe(1);

    const [lineId] = Object.keys(liveStore.lines.get());
    expect(liveStore.lines.get()[lineId]).toMatchObject({ latex: "2x=8", provider: "vision" });
    expect(echo()).toMatchObject({ latex: "2x=8", status: "warn" });
    expect(liveStore.lastError.get()).toBeNull();
    // the burst is 'handled', so the legacy image pipeline stays quiet
    expect(liveStore.lastBurst.get()?.state).toBe("handled");
  });

  it("the retry failing too shows the failed-read state and never loops", async () => {
    script = [recognizerFailed({ needsCrop: true }), recognizerFailed({ needsCrop: true })];
    await penUp(fixtureSingleLine());
    await vi.advanceTimersByTimeAsync(30_000);
    await settle();

    // exactly two calls: the first attempt and its single retry
    expect(fetchJson).toHaveBeenCalledTimes(2);
    expect(requests[1].crop).toBe(CROP);
    expect(echo()).toMatchObject({ latex: "", status: "unknown", note: "Couldn't read this line — tap Retry" });
    expect(liveStore.lastError.get()).toMatchObject({ kind: "recognize", code: "upstream" });
    expect(liveStore.lastBurst.get()?.state).toBe("failed");
  });

  it("after a credential failure the NEXT line's first attempt already carries a crop", async () => {
    script = [recognizerFailed({ needsCrop: true, recognizerDown: true }), ok("2x=8", "vision")];
    await penUp(writeLine("2x=8", 100, 200, 40));
    expect(fetchJson).toHaveBeenCalledTimes(2);
    expect(liveStore.recognizer.get()).toBe("vision");

    script = [ok("x=4", "vision")];
    await penUp(writeLine("x=4", 100, 320, 40));
    expect(fetchJson).toHaveBeenCalledTimes(3);
    // no failed round-trip for the second line: the crop rode along on the first attempt
    expect(requests[2].crop).toBe(CROP);
    expect(liveStore.lastError.get()).toBeNull();
    expect(editor.shapesOfType("math")).toHaveLength(2);
  });

  it("needsCrop without recognizerDown leaves the recognizer on mathpix", async () => {
    script = [recognizerFailed({ needsCrop: true }), ok("2x=8", "vision")];
    await penUp(fixtureSingleLine());
    expect(liveStore.recognizer.get()).toBe("mathpix");
  });

  it("a recognizer_failed WITHOUT needsCrop is not retried (the server had a crop already)", async () => {
    script = [recognizerFailed()];
    await penUp(fixtureSingleLine());
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(crops).toBe(0);
    expect(echo()).toMatchObject({ status: "unknown", note: "Couldn't read this line — tap Retry" });
  });

  it("the normal success path still sends no crop and captures no image", async () => {
    script = [ok("2x=8")];
    await penUp(fixtureSingleLine());
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(requests[0].crop).toBeUndefined();
    expect(crops).toBe(0);
    expect(echo()).toMatchObject({ latex: "2x=8" });
  });

  // ---------------------------------------------------------------- BUG-4
  /** Drops the loop and mounts a new one on the same store: what a page reload does. */
  async function reload(): Promise<void> {
    loop.stop();
    resetLiveStore();
    loop = makeLoop();
    loop.start();
    await settle();
  }

  async function writeLineWithLlmNote(): Promise<string> {
    script = [ok("2x=8")];
    await penUp(fixtureSingleLine());
    const [lineId] = Object.keys(liveStore.lines.get());
    // the local engine has no words for this mismatch; only the model does
    expect(echo()).toMatchObject({ latex: "2x=8", status: "warn", note: "", aiNote: false });

    streamScript = [[{ event: "annotation", data: { lineId, verdict: "warn", kind: "algebra", message: LLM_NOTE, confidence: 0.9 } }]];
    loop.requestCheck(lineId);
    await settle();
    expect(echo()).toMatchObject({ note: LLM_NOTE, status: "warn", aiNote: true });
    return lineId;
  }

  it("an LLM note survives a reload (re-analysis on mount no longer wipes it)", async () => {
    await writeLineWithLlmNote();
    const shapesBefore = editor.shapesOfType("math").length;

    await reload();

    expect(editor.shapesOfType("math")).toHaveLength(shapesBefore);
    expect(echo()).toMatchObject({ latex: "2x=8", note: LLM_NOTE, aiNote: true });
    // and a second reload does not erode it either
    await reload();
    expect(echo()).toMatchObject({ note: LLM_NOTE, aiNote: true });
  });

  it("the note is cleared when the line is rewritten", async () => {
    // same fixture, split so the last stroke arrives as a rewrite of the same line
    const strokes = fixtureSingleLine();
    script = [ok("2x=8")];
    await penUp(strokes.slice(0, -1));
    const [lineId] = Object.keys(liveStore.lines.get());
    streamScript = [[{ event: "annotation", data: { lineId, verdict: "warn", kind: "algebra", message: LLM_NOTE, confidence: 0.9 } }]];
    loop.requestCheck(lineId);
    await settle();
    expect(echo()).toMatchObject({ note: LLM_NOTE, aiNote: true });

    script = [ok("2x+3=11")];
    await penUp(strokes.slice(-1));
    expect(echo()).toMatchObject({ latex: "2x+3=11", note: "", aiNote: false });

    // and it stays gone across a reload
    await reload();
    expect(echo()).toMatchObject({ latex: "2x+3=11", note: "" });
  });

  it("retyping the echo also clears the note", async () => {
    const lineId = await writeLineWithLlmNote();
    const shapeId = liveStore.lines.get()[lineId].mathShapeId;
    expect(shapeId).not.toBeNull();
    editor.updateUser(shapeId!, (s) => ({ ...s, props: { ...s.props, latex: "x=4" } }));
    await settle();
    expect(echo()).toMatchObject({ latex: "x=4", status: "ok", note: "", aiNote: false });
  });

  it("a purely local note still updates normally on re-analysis", async () => {
    localNotes = { "2x=8": "These units don't match" };
    script = [ok("2x=8")];
    await penUp(fixtureSingleLine());
    expect(echo()).toMatchObject({ note: "These units don't match", aiNote: false });

    // the engine's answer changes (new context / new rules): the local note must follow
    localNotes = { "2x=8": "Divide both sides by 2" };
    await reload();
    expect(echo()).toMatchObject({ latex: "2x=8", note: "Divide both sides by 2", aiNote: false });
  });

  it("'Clear feedback' (clearMarks) drops an LLM note and its provenance", async () => {
    await writeLineWithLlmNote();
    loop.clearMarks();
    await settle();
    expect(echo()).toMatchObject({ note: "", aiNote: false });
    await reload();
    expect(echo()).toMatchObject({ note: "" });
  });
});
