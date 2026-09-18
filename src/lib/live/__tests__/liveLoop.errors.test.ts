import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { TLDrawShape } from "tldraw";
import { pillLabelFor } from "@/components/live/copy";
import { RATE_LIMIT_FALLBACK_MS, showsHintCard } from "@/components/live/errorView";
import { ApiError } from "@/lib/api-client";
import { createFakeEditor, type FakeEditor } from "../__fixtures__/fakeEditor";
import { fixtureSingleLine, writeLine } from "../__fixtures__/strokes";
import {
  LIVE_TIMING,
  type CapabilitiesResponse,
  type LineAnalysis,
  type LiveEngine,
  type LiveSseEvent,
  type MathShapeProps,
  type RecognizeResponse,
  type UseLiveMathOptions,
} from "../contracts";
import { createLiveLoop, type LiveLoop } from "../liveLoop";
import { clearLiveError, legacyShouldSkip, liveStore, resetLiveStore, retryLiveError } from "../liveStore";
import { RecognizeClient, type FetchJson } from "../recognizeClient";
import { settle, settleUntil } from "@/lib/live/__fixtures__/settle";
import { useSyncHash } from "@/lib/live/__fixtures__/syncHash";

/**
 * Visible errors + retry paths of the live loop (owner's rule: no silent failure in the
 * recognition / solve pipeline). Recognizer, stream and capabilities are scripted fakes.
 */

const engine: LiveEngine = {
  analyzeLine: (latex): LineAnalysis => ({
    // A line still ending in its relation is half-written, which is what the real engine
    // calls `incomplete` — the state the burst gate used to mishandle.
    kind: latex.endsWith("=") ? "incomplete" : "equation",
    math: latex,
    resultLatex: "",
    verdict: latex === "x=5" ? "mismatch" : latex === "x=4" ? "ok" : "unknown",
    note: latex === "x=5" ? "Check the division" : "",
  }),
  compileExpr: () => () => 0,
  solveLatex: () => null,
  verifyExpected: () => "unknown",
  balance: () => null,
  calculate: () => null,
};

const CAPS: CapabilitiesResponse = { recognizer: "mathpix", liveEnabled: true, models: { check: "c", solve: "s", vision: "v" } };
const QUIET = LIVE_TIMING.rewriteQuietMs + LIVE_TIMING.quietMs + 1;

function ok(latex: string): RecognizeResponse {
  return { latex, text: "", kind: "math", confidence: 0.97, provider: "mathpix", ms: 300 };
}

describe("live loop — visible errors and retry", () => {
  // Deterministic, synchronous stroke hashing: see the fixture for why.
  useSyncHash();

  let editor: FakeEditor;
  let fetchJson: Mock<FetchJson>;
  let recognizer: RecognizeClient;
  let loop: LiveLoop;
  let opts: UseLiveMathOptions;
  let online: boolean;
  /** scripted recognizer outcomes, FIFO; a thrown value rejects, a string resolves (last repeats) */
  let recognizeScript: Array<string | Error>;
  let streamCalls: string[];
  /** per stream call: events to yield, or an error to throw (FIFO; empty stream when exhausted) */
  let streamScript: Array<LiveSseEvent[] | Error>;
  let capsCalls: number;
  let capsScript: Array<CapabilitiesResponse | Error>;
  /** when set, solve streams wait on this before yielding */
  let solveGate: Promise<void> | null;

  function makeLoop(mode: UseLiveMathOptions["mode"] = "feedback", timeoutMs?: number): LiveLoop {
    const stream = async function* (path: string): AsyncGenerator<LiveSseEvent, void, undefined> {
      streamCalls.push(path);
      if (path.endsWith("/solve") && solveGate) await solveGate;
      const next = streamScript.shift() ?? [];
      if (next instanceof Error) throw next;
      for (const ev of next) yield ev;
    };
    opts = { boardId: "board-1", mode, enabled: true, voiceActive: false };
    recognizer = new RecognizeClient({ fetchJson, timeoutMs });
    return createLiveLoop(editor, opts, {
      recognizer,
      stream,
      getEngine: async () => engine,
      fetchCapabilities: async () => {
        capsCalls++;
        const next = capsScript.shift() ?? CAPS;
        if (next instanceof Error) throw next;
        return next;
      },
      events: null,
      isOnline: () => online,
    });
  }

  async function penUp(shapes: TLDrawShape[]): Promise<void> {
    // The recognize call is gated on a real async digest, not just the fake timers, so wait
    // for the call itself rather than a fixed number of event-loop turns (that raced on CI).
    const before = fetchJson.mock.calls.length;
    editor.putUser(shapes);
    await vi.advanceTimersByTimeAsync(QUIET);
    await settleUntil(() => fetchJson.mock.calls.length > before);
    // Then the original flush budget, so everything downstream of the call (apply, render,
    // policy) gets at least as many turns as before this helper waited on a condition.
    await settle(8);
  }

  function echoOf(lineId: string): MathShapeProps | null {
    const id = liveStore.lines.get()[lineId]?.mathShapeId;
    const shape = id ? editor.getShape(id) : undefined;
    return shape ? (shape.props as MathShapeProps) : null;
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    resetLiveStore();
    editor = createFakeEditor();
    recognizeScript = [];
    let last = "2x=8";
    fetchJson = vi.fn<FetchJson>(async (_path, _body, init): Promise<RecognizeResponse> => {
      const next = recognizeScript.shift();
      if (next instanceof Error) throw next;
      if (next === "<hang>") {
        // never resolves on its own; rejects like fetch does when the signal aborts
        return new Promise<RecognizeResponse>((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
        });
      }
      if (typeof next === "string") last = next;
      return ok(last);
    });
    streamCalls = [];
    streamScript = [];
    capsCalls = 0;
    capsScript = [];
    solveGate = null;
    online = true;
    loop = makeLoop();
    loop.start();
  });

  afterEach(() => {
    loop.stop();
    vi.useRealTimers();
  });

  // ------------------------------------------------------------------ recognize
  it("recognizer 500: lastError recognize/upstream, chip under the ink, retry recognizes once and clears", async () => {
    recognizeScript.push(new ApiError("boom", 500, "internal_error"));
    await penUp(fixtureSingleLine());
    expect(fetchJson).toHaveBeenCalledTimes(1);
    const [lineId] = Object.keys(liveStore.lines.get());

    const err = liveStore.lastError.get();
    expect(err).toMatchObject({ kind: "recognize", code: "upstream", lineId, message: "The tutor service had a hiccup" });
    // never a silent blank: the line stays in state with a note and an 'unknown' chip
    const st = liveStore.lines.get()[lineId];
    expect(st.latex).toBe("");
    expect(st.analysis?.verdict).toBe("unknown");
    expect(st.analysis?.note).toBe("Couldn't read this line — tap Retry");
    expect(echoOf(lineId)).toMatchObject({ latex: "", status: "unknown", note: "Couldn't read this line — tap Retry" });
    // legacy status never flips to a self-clearing 'error'
    expect(liveStore.status.get()).toBe("idle");

    // Retry bypasses the quiet gate: exactly one more recognition, right away.
    recognizeScript.push("2x=8");
    retryLiveError();
    await settle(8);
    expect(fetchJson).toHaveBeenCalledTimes(2);
    expect(liveStore.lastError.get()).toBeNull();
    expect(liveStore.lines.get()[lineId].latex).toBe("2x=8");
    // the chip became a real echo again (the fixture engine has no verdict for 2x=8: badge 'none')
    expect(echoOf(lineId)).toMatchObject({ latex: "2x=8", status: "none", note: "" });
    expect(editor.shapesOfType("math")).toHaveLength(1);
  });

  it("a repeated failure after Retry updates the error with the attempt count", async () => {
    recognizeScript.push(new ApiError("boom", 502, "upstream_error"), new ApiError("boom", 502, "upstream_error"));
    await penUp(fixtureSingleLine());
    const first = liveStore.lastError.get();
    expect(first?.message).toBe("The tutor service had a hiccup");
    loop.retryLastError();
    await settle(8);
    const second = liveStore.lastError.get();
    expect(second).not.toBeNull();
    expect(second?.id).not.toBe(first?.id);
    expect(second?.message).toBe("The tutor service had a hiccup — tried 2 times");
    expect(fetchJson).toHaveBeenCalledTimes(2);
  });

  it("429 -> rate_limited with retryAfterMs from the error, or the fallback when it is missing", async () => {
    const limited = new ApiError("Too many requests", 429, "rate_limited");
    (limited as ApiError & { retryAfterMs?: number }).retryAfterMs = 1500;
    recognizeScript.push(limited);
    await penUp(fixtureSingleLine());
    expect(liveStore.lastError.get()).toMatchObject({
      kind: "recognize",
      code: "rate_limited",
      retryAfterMs: 1500,
      message: "Slowing down — try again in 2 s",
    });
    // sign-in / rate-limit / credits are the pill's job: no chip, no shape
    expect(editor.shapesOfType("math")).toHaveLength(0);

    recognizeScript.push(new ApiError("Too many requests", 429, "rate_limited"));
    loop.retryLastError();
    await settle(8);
    expect(liveStore.lastError.get()).toMatchObject({ code: "rate_limited", retryAfterMs: RATE_LIMIT_FALLBACK_MS });
  });

  it("401 -> unauthorized 'Please sign in again'; 402 -> credits with the server message", async () => {
    recognizeScript.push(new ApiError("You need to be signed in.", 401, "unauthorized"));
    await penUp(writeLine("2x=8", 100, 200, 40));
    expect(liveStore.lastError.get()).toMatchObject({ kind: "recognize", code: "unauthorized", message: "Please sign in again" });

    recognizeScript.push(new ApiError("Your class is out of credits for today.", 402, "credits_exhausted"));
    await penUp(writeLine("x=4", 100, 300, 40));
    expect(liveStore.lastError.get()).toMatchObject({ code: "credits", message: "Your class is out of credits for today." });
  });

  it("recognition timeout -> timeout error with a chip; retry re-runs it", async () => {
    loop.stop();
    loop = makeLoop("feedback", 200);
    loop.start();
    recognizeScript.push("<hang>");
    editor.putUser(fixtureSingleLine());
    await vi.advanceTimersByTimeAsync(QUIET);
    await settle(4);
    expect(fetchJson).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(250);
    await settle(8);
    const [lineId] = Object.keys(liveStore.lines.get());
    expect(liveStore.lastError.get()).toMatchObject({ kind: "recognize", code: "timeout", lineId, message: "Reading took too long" });
    expect(echoOf(lineId)).toMatchObject({ status: "unknown", note: "Couldn't read this line — tap Retry" });

    recognizeScript.push("2x=8");
    loop.retryLastError();
    await settle(8);
    expect(fetchJson).toHaveBeenCalledTimes(2);
    expect(liveStore.lastError.get()).toBeNull();
    expect(echoOf(lineId)?.latex).toBe("2x=8");
  });

  it("rewriting the failed line clears the recognize error (new ink makes it stale)", async () => {
    recognizeScript.push(new ApiError("boom", 500, "internal_error"));
    const strokes = fixtureSingleLine();
    await penUp(strokes.slice(0, -1));
    expect(liveStore.lastError.get()?.kind).toBe("recognize");
    recognizeScript.push("2x+3=11");
    await penUp(strokes.slice(-1));
    expect(fetchJson).toHaveBeenCalledTimes(2);
    expect(liveStore.lastError.get()).toBeNull();
    expect(Object.values(liveStore.lines.get())[0].latex).toBe("2x+3=11");
  });

  it("erasing the failed line removes its error", async () => {
    recognizeScript.push(new ApiError("boom", 500, "internal_error"));
    const strokes = fixtureSingleLine();
    await penUp(strokes);
    expect(liveStore.lastError.get()).not.toBeNull();
    editor.removeUser(strokes.map((s) => s.id));
    await vi.advanceTimersByTimeAsync(QUIET);
    await settle(8);
    expect(liveStore.lastError.get()).toBeNull();
    expect(Object.keys(liveStore.lines.get())).toHaveLength(0);
  });

  it("errors never auto-clear on a timer; Dismiss clears them", async () => {
    recognizeScript.push(new ApiError("boom", 500, "internal_error"));
    await penUp(fixtureSingleLine());
    expect(liveStore.lastError.get()).not.toBeNull();
    await vi.advanceTimersByTimeAsync(60_000);
    await settle(4);
    expect(liveStore.lastError.get()).not.toBeNull();
    expect(liveStore.status.get()).toBe("idle");
    clearLiveError();
    expect(liveStore.lastError.get()).toBeNull();
    // Dismissed: retry is a no-op.
    retryLiveError();
    await settle(4);
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it("offline path is unchanged: a network failure while offline queues the line and sets no error", async () => {
    online = false;
    loop.setOptions({ ...opts });
    recognizeScript.push(new TypeError("Failed to fetch"));
    await penUp(fixtureSingleLine());
    expect(fetchJson).not.toHaveBeenCalled(); // offline lines never hit the network
    expect(liveStore.lastError.get()).toBeNull();
    expect(liveStore.status.get()).toBe("offline");
    expect(liveStore.offlineQueued.get()).toBe(1);
  });

  it("a fetch TypeError while the browser says online is a visible 'network' error and still replays on reconnect", async () => {
    recognizeScript.push(new TypeError("Failed to fetch"));
    await penUp(fixtureSingleLine());
    const [lineId] = Object.keys(liveStore.lines.get());
    expect(liveStore.lastError.get()).toMatchObject({ kind: "recognize", code: "network", lineId, message: "Couldn't reach the tutor service" });
    expect(echoOf(lineId)).toMatchObject({ status: "unknown", note: "Couldn't read this line — tap Retry" });
    expect(liveStore.offlineQueued.get()).toBe(1);

    recognizeScript.push("2x=8");
    loop.retryLastError();
    await settle(8);
    expect(fetchJson).toHaveBeenCalledTimes(2);
    expect(liveStore.lastError.get()).toBeNull();
    expect(liveStore.offlineQueued.get()).toBe(0);
    expect(echoOf(lineId)?.latex).toBe("2x=8");
  });

  // ------------------------------------------------------------------ check / solve
  it("stream 'error' event on a user-asked check -> kind check / upstream with the server message; retry reopens one stream", async () => {
    recognizeScript.push("x=5");
    await penUp(fixtureSingleLine());
    const [lineId] = Object.keys(liveStore.lines.get());
    expect(liveStore.lines.get()[lineId].analysis?.verdict).toBe("mismatch");
    expect(streamCalls).toHaveLength(0);

    streamScript.push([{ event: "error", data: { error: "upstream_error", message: "The model is busy" } }]);
    loop.requestCheck(lineId);
    await settle(6);
    expect(streamCalls).toEqual(["/api/live/check"]);
    const err = liveStore.lastError.get();
    expect(err).toMatchObject({ kind: "check", code: "upstream", lineId, userAsked: true, message: "The model is busy" });
    expect(showsHintCard(err)).toBe(true);
    expect(liveStore.status.get()).toBe("idle");

    // No timer clears it.
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.pillFadeMs * 4);
    await settle(4);
    expect(liveStore.lastError.get()?.id).toBe(err?.id);

    streamScript.push([]);
    retryLiveError();
    await settle(6);
    expect(streamCalls).toEqual(["/api/live/check", "/api/live/check"]);
    expect(liveStore.lastError.get()).toBeNull();
  });

  it("a check stream that throws ApiError 429 / 401 maps like the recognizer; a TypeError while online is 'network'", async () => {
    recognizeScript.push("x=5");
    await penUp(fixtureSingleLine());
    const [lineId] = Object.keys(liveStore.lines.get());

    const limited = new ApiError("Too many requests", 429, "rate_limited");
    (limited as ApiError & { retryAfterMs?: number }).retryAfterMs = 3000;
    streamScript.push(limited);
    loop.requestCheck(lineId);
    await settle(6);
    expect(liveStore.lastError.get()).toMatchObject({ kind: "check", code: "rate_limited", retryAfterMs: 3000, lineId });

    streamScript.push(new ApiError("You need to be signed in.", 401, "unauthorized"));
    loop.retryLastError();
    await settle(6);
    expect(liveStore.lastError.get()).toMatchObject({ kind: "check", code: "unauthorized", message: "Please sign in again — tried 2 times" });

    streamScript.push(new TypeError("Failed to fetch"));
    loop.retryLastError();
    await settle(6);
    expect(liveStore.lastError.get()).toMatchObject({ kind: "check", code: "network" });
    expect(streamCalls).toHaveLength(3);
  });

  it("a check that fails while offline sets no error (the reconnect replay owns it)", async () => {
    recognizeScript.push("x=5");
    await penUp(fixtureSingleLine());
    const [lineId] = Object.keys(liveStore.lines.get());
    online = false;
    loop.setOptions({ ...opts });
    loop.requestCheck(lineId);
    await settle(6);
    expect(streamCalls).toHaveLength(0);
    expect(liveStore.lastError.get()).toBeNull();
    expect(liveStore.status.get()).toBe("offline");
  });

  it("solve: 'Solving…' while the stream is open; a stream error is kind solve and retry reopens one stream", async () => {
    loop.stop();
    resetLiveStore();
    loop = makeLoop("answer");
    loop.start();
    recognizeScript.push("x=5");
    await penUp(fixtureSingleLine());
    const [lineId] = Object.keys(liveStore.lines.get());
    const before = streamCalls.length;

    let open!: () => void;
    solveGate = new Promise<void>((r) => (open = r));
    streamScript.push([{ event: "error", data: { error: "upstream_error", message: "No steps right now" } }]);
    loop.requestSolve(lineId);
    await settle(4);
    expect(streamCalls.slice(before)).toEqual(["/api/live/solve"]);
    expect(liveStore.solving.get()).toBe(1);
    expect(liveStore.status.get()).toBe("checking");
    expect(pillLabelFor(liveStore.status.get(), "mathpix", 0, liveStore.solving.get() > 0)).toBe("Solving…");

    open();
    await settle(6);
    expect(liveStore.solving.get()).toBe(0);
    expect(liveStore.status.get()).toBe("idle");
    expect(liveStore.lastError.get()).toMatchObject({ kind: "solve", code: "upstream", lineId, userAsked: true, message: "No steps right now" });

    solveGate = null;
    streamScript.push([{ event: "step", data: { index: 1, latex: "x=4", explanation: "Divide both sides by 2", final: true } }]);
    loop.retryLastError();
    await settle(6);
    expect(streamCalls.slice(before)).toEqual(["/api/live/solve", "/api/live/solve"]);
    expect(liveStore.lastError.get()).toBeNull();
    expect(liveStore.solving.get()).toBe(0);
  });

  // ------------------------------------------------------------------ capabilities
  it("capabilities failure while online -> kind capabilities; retry re-fetches once and clears", async () => {
    loop.stop();
    resetLiveStore();
    capsCalls = 0; // the beforeEach loop already fetched once
    capsScript.push(new ApiError("boom", 502, "upstream_error"));
    loop = makeLoop();
    loop.start();
    await settle(4);
    expect(capsCalls).toBe(1);
    expect(liveStore.recognizer.get()).toBe("unknown");
    expect(liveStore.lastError.get()).toMatchObject({ kind: "capabilities", code: "upstream" });

    retryLiveError();
    await settle(4);
    expect(capsCalls).toBe(2);
    expect(liveStore.lastError.get()).toBeNull();
    expect(liveStore.recognizer.get()).toBe("mathpix");
  });

  it("capabilities failure while offline stays quiet", async () => {
    loop.stop();
    resetLiveStore();
    capsCalls = 0;
    online = false;
    capsScript.push(new TypeError("Failed to fetch"));
    loop = makeLoop();
    loop.start();
    await settle(4);
    expect(capsCalls).toBe(1);
    expect(liveStore.lastError.get()).toBeNull();
  });

  // ------------------------------------------------------------------ burst gate (legacy pipeline)
  describe("a failed read marks the burst 'failed' so the paid image pipeline stays quiet", () => {
    const PAUSED = "Drawn help is paused until reading works again — use Draw help to force it";

    it("recognizer 500 -> lastBurst 'failed', legacyShouldSkip true, second line on the error", async () => {
      recognizeScript.push(new ApiError("boom", 500, "internal_error"));
      await penUp(fixtureSingleLine());
      expect(liveStore.lastBurst.get()?.state).toBe("failed");
      expect(legacyShouldSkip(LIVE_TIMING.legacyIdleMs)).toBe(true);
      expect(liveStore.lastError.get()).toMatchObject({ kind: "recognize", code: "upstream", detail: PAUSED });
    });

    it("a fetch TypeError while online (network) is a failure too", async () => {
      recognizeScript.push(new TypeError("Failed to fetch"));
      await penUp(fixtureSingleLine());
      expect(liveStore.lastBurst.get()?.state).toBe("failed");
      expect(liveStore.lastError.get()?.detail).toBe(PAUSED);
    });

    it("a recognition timeout is a failure: 'pending' while the read hangs, 'failed' once it times out", async () => {
      loop.stop();
      loop = makeLoop("feedback", 200);
      loop.start();
      recognizeScript.push("<hang>");
      editor.putUser(fixtureSingleLine());
      // advance just past the quiet gate: the 200 ms recognizer timeout must not be able to
      // fire inside this same advance (the payload hash resolves on a real thread)
      await vi.advanceTimersByTimeAsync(LIVE_TIMING.quietMs + 1);
      await settle(8);
      expect(fetchJson).toHaveBeenCalledTimes(1);
      expect(liveStore.lastBurst.get()?.state).toBe("pending");
      expect(legacyShouldSkip(LIVE_TIMING.legacyIdleMs)).toBe(true);
      await vi.advanceTimersByTimeAsync(250);
      await settle(8);
      expect(liveStore.lastError.get()).toMatchObject({ code: "timeout", detail: PAUSED });
      expect(liveStore.lastBurst.get()?.state).toBe("failed");
    });

    it("401 / 429 / 402 are failures as well (the pill carries them, the image pipeline waits)", async () => {
      recognizeScript.push(new ApiError("Too many requests", 429, "rate_limited"));
      await penUp(fixtureSingleLine());
      expect(liveStore.lastError.get()?.code).toBe("rate_limited");
      expect(liveStore.lastBurst.get()?.state).toBe("failed");
      expect(legacyShouldSkip(LIVE_TIMING.legacyIdleMs)).toBe(true);
    });

    it("a low-confidence read is not a failure: the burst ends 'unhandled' as before", async () => {
      fetchJson.mockImplementationOnce(async () => ({ latex: "2x+?", text: "", kind: "math", confidence: 0.3, provider: "mathpix", ms: 300 }));
      await penUp(fixtureSingleLine());
      expect(fetchJson).toHaveBeenCalledTimes(1);
      expect(liveStore.lastError.get()).toBeNull();
      expect(editor.shapesOfType("math")).toHaveLength(0);
      expect(liveStore.lastBurst.get()?.state).toBe("unhandled");
      expect(legacyShouldSkip(LIVE_TIMING.legacyIdleMs)).toBe(false);
    });

    // prose (kind 'text') is covered by liveLoop.qa.test.ts B2/B8 with an engine that knows \\text
    it("lone-symbol ink (a drawn \\Delta) stays 'unhandled' so diagrams keep the image overlay", async () => {
      recognizeScript.push("\\Delta");
      await penUp(fixtureSingleLine());
      expect(fetchJson).toHaveBeenCalledTimes(1);
      expect(liveStore.lastError.get()).toBeNull();
      expect(editor.shapesOfType("math")).toHaveLength(0);
      expect(liveStore.lastBurst.get()?.state).toBe("unhandled");
      expect(legacyShouldSkip(LIVE_TIMING.legacyIdleMs)).toBe(false);
    });

    /**
     * Reported from production: the student wrote `32 + 6 =`, the recognizer read the 2 as an
     * a, and a slow image model drew `3(a+2)` on the page in its own black ink — a correct
     * factorisation of a line the student never wrote, presented as their answer.
     *
     * The line reached the image model because Live was silent about it, and the gate read
     * silence as "nothing to offer". A half-written line is the opposite: it is maths Live is
     * deliberately holding, because the student has not finished the thought.
     */
    it("a half-written line is Live's to hold, not the image model's to finish", async () => {
      recognizeScript.push("3a+6=");
      await penUp(fixtureSingleLine());

      // silent, as it should be: nothing is drawn on a line still being written
      expect(editor.shapesOfType("math")).toHaveLength(0);
      expect(liveStore.lastError.get()).toBeNull();
      // but claimed, so the paid image pipeline does not offer to finish it for them
      expect(liveStore.lastBurst.get()?.state).toBe("handled");
      expect(legacyShouldSkip(LIVE_TIMING.legacyIdleMs)).toBe(true);
    });

    it("a successful Retry turns the failed burst into 'handled'", async () => {
      recognizeScript.push(new ApiError("boom", 502, "upstream_error"));
      await penUp(fixtureSingleLine());
      expect(liveStore.lastBurst.get()?.state).toBe("failed");

      recognizeScript.push("2x=8");
      retryLiveError();
      await settle(8);
      expect(liveStore.lastError.get()).toBeNull();
      expect(editor.shapesOfType("math")).toHaveLength(1);
      expect(liveStore.lastBurst.get()?.state).toBe("handled");
      expect(legacyShouldSkip(LIVE_TIMING.legacyIdleMs)).toBe(true);
    });

    it("a Retry that fails again keeps the burst 'failed'; new ink starts a fresh 'pending' burst", async () => {
      recognizeScript.push(new ApiError("boom", 502, "upstream_error"), new ApiError("boom", 502, "upstream_error"));
      const strokes = fixtureSingleLine();
      await penUp(strokes.slice(0, -1));
      retryLiveError();
      await settle(8);
      expect(liveStore.lastBurst.get()?.state).toBe("failed");
      expect(liveStore.lastError.get()?.detail).toBe(PAUSED);

      recognizeScript.push("2x+3=11");
      editor.putUser(strokes.slice(-1));
      expect(liveStore.lastBurst.get()?.state).toBe("pending");
      await vi.advanceTimersByTimeAsync(QUIET);
      await settle(8);
      expect(liveStore.lastBurst.get()?.state).toBe("handled");
    });

    it("a mixed burst where one line echoes and another fails stays gated ('handled')", async () => {
      recognizeScript.push("2x=8", new ApiError("boom", 500, "internal_error"));
      await penUp([...writeLine("2x=8", 100, 200, 40), ...writeLine("x=4", 100, 300, 40)]);
      expect(fetchJson).toHaveBeenCalledTimes(2);
      expect(liveStore.lastBurst.get()?.state).toBe("handled");
      expect(legacyShouldSkip(LIVE_TIMING.legacyIdleMs)).toBe(true);
    });

    it("offline is unchanged: a queued line is not a failure and carries no second line", async () => {
      online = false;
      loop.setOptions({ ...opts });
      await penUp(fixtureSingleLine());
      expect(liveStore.lastError.get()).toBeNull();
      expect(liveStore.lastBurst.get()?.state).not.toBe("failed");
    });

    it("a capabilities failure with no burst yet leaves the burst alone and adds no second line", async () => {
      loop.stop();
      resetLiveStore();
      capsScript.push(new ApiError("boom", 502, "upstream_error"));
      loop = makeLoop();
      loop.start();
      await settle(4);
      expect(liveStore.lastError.get()).toMatchObject({ kind: "capabilities", code: "upstream" });
      expect(liveStore.lastError.get()?.detail).toBeUndefined();
      expect(liveStore.lastBurst.get()).toBeNull();
    });
  });

  // ------------------------------------------------------------------ handler lifecycle
  it("the retry handler is installed on start and removed on stop", async () => {
    expect(liveStore.retryHandler.get()).not.toBeNull();
    loop.stop();
    expect(liveStore.retryHandler.get()).toBeNull();
    loop.start();
    expect(liveStore.retryHandler.get()).not.toBeNull();
  });
});
