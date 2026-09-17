import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { TLDrawShape } from "tldraw";
import { pillLabelFor } from "@/components/live/copy";
import { createFakeEditor, type FakeEditor } from "../__fixtures__/fakeEditor";
import { fixtureSingleLine, toInkStrokes, writeLine } from "../__fixtures__/strokes";
import {
  LIVE_TIMING,
  type LineAnalysis,
  type LiveEngine,
  type LiveSseEvent,
  type MathShapeProps,
  type RecognizeRequest,
  type RecognizeResponse,
  type UseLiveMathOptions,
} from "../contracts";
import { createLiveLoop, type LiveLoop } from "../liveLoop";
import { liveStore, resetLiveStore } from "../liveStore";
import { RecognizeClient, type FetchJson } from "../recognizeClient";
import { buildPayload, hashPayload } from "../strokePayload";

/**
 * Offline behaviour of the live loop: recognition queued while offline is replayed in
 * full (no cap, no duplicates, current ink) and LLM streams asked for offline never spin.
 */

const engine: LiveEngine = {
  analyzeLine: (latex): LineAnalysis => ({
    kind: "equation",
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

async function settle(ticks = 4): Promise<void> {
  for (let i = 0; i < ticks; i++) {
    await new Promise<void>((r) => setImmediate(r));
    await Promise.resolve();
  }
}

const QUIET = LIVE_TIMING.rewriteQuietMs + LIVE_TIMING.quietMs + 1;

describe("live loop — offline queue and replay", () => {
  let editor: FakeEditor;
  let fetchJson: Mock<FetchJson>;
  let recognizer: RecognizeClient;
  let streamCalls: string[];
  let online: boolean;
  let loop: LiveLoop;
  let opts: UseLiveMathOptions;
  /** latex the scripted recognizer returns (FIFO; the last one repeats) */
  let latexQueue: string[];

  function makeLoop(mode: UseLiveMathOptions["mode"] = "feedback"): LiveLoop {
    const stream = async function* (path: string): AsyncGenerator<LiveSseEvent, void, undefined> {
      streamCalls.push(path);
    };
    opts = { boardId: "board-1", mode, enabled: true, voiceActive: false };
    recognizer = new RecognizeClient({ fetchJson });
    return createLiveLoop(editor, opts, {
      recognizer,
      stream,
      getEngine: async () => engine,
      fetchCapabilities: async () => ({ recognizer: "mathpix", liveEnabled: true, models: { check: "c", solve: "s", vision: "v" } }),
      events: null,
      isOnline: () => online,
    });
  }

  /** Flips connectivity the way the hook does: a setOptions after navigator.onLine moved. */
  function goOnline(): void {
    online = true;
    loop.setOptions({ ...opts });
  }
  function goOffline(): void {
    online = false;
    loop.setOptions({ ...opts });
  }

  function recognizedLineIds(): string[] {
    return fetchJson.mock.calls.map(([, body]) => (body as RecognizeRequest).lineId);
  }

  function echoesByLine(): Map<string, number> {
    const out = new Map<string, number>();
    for (const s of editor.shapesOfType("math")) {
      const p = s.props as MathShapeProps;
      if (p.source !== "echo") continue;
      out.set(p.lineId, (out.get(p.lineId) ?? 0) + 1);
    }
    return out;
  }

  async function penUp(shapes: TLDrawShape[]): Promise<void> {
    editor.putUser(shapes);
    await vi.advanceTimersByTimeAsync(QUIET);
    await settle(8);
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    resetLiveStore();
    editor = createFakeEditor();
    latexQueue = [];
    let last = "2x=8";
    fetchJson = vi.fn<FetchJson>(async (): Promise<RecognizeResponse> => {
      last = latexQueue.shift() ?? last;
      return { latex: last, text: "", kind: "math", confidence: 0.97, provider: "mathpix", ms: 300 };
    });
    streamCalls = [];
    online = true;
    loop = makeLoop();
    loop.start();
  });

  afterEach(() => {
    loop.stop();
    vi.useRealTimers();
  });

  it("(a) 7 pen-ups on 7 lines while offline are all recognized after reconnect, once each", async () => {
    goOffline();
    expect(liveStore.status.get()).toBe("offline");
    for (let i = 0; i < 7; i++) await penUp(writeLine("2x=8", 100, 200 + i * 90, 40));
    expect(fetchJson).not.toHaveBeenCalled();
    expect(Object.keys(liveStore.lines.get())).toHaveLength(7);
    expect(liveStore.offlineQueued.get()).toBe(7);
    expect(editor.shapesOfType("math")).toHaveLength(0);

    goOnline();
    expect(liveStore.offlineQueued.get()).toBe(0);
    expect(liveStore.status.get()).toBe("idle");
    await vi.advanceTimersByTimeAsync(QUIET);
    await settle(12);

    const ids = recognizedLineIds();
    expect(ids).toHaveLength(7);
    expect(new Set(ids).size).toBe(7);
    expect(new Set(ids)).toEqual(new Set(Object.keys(liveStore.lines.get())));
    expect(editor.shapesOfType("math")).toHaveLength(7);
    expect([...echoesByLine().values()].every((n) => n === 1)).toBe(true);

    // Nothing left over: no second wave.
    await vi.advanceTimersByTimeAsync(QUIET * 3);
    await settle(8);
    expect(fetchJson).toHaveBeenCalledTimes(7);
  });

  it("(b) the same line dirtied three times offline is recognized exactly once", async () => {
    goOffline();
    const strokes = fixtureSingleLine();
    await penUp(strokes.slice(0, 4));
    await penUp(strokes.slice(4, 7));
    await penUp(strokes.slice(7));
    expect(Object.keys(liveStore.lines.get())).toHaveLength(1);
    expect(liveStore.offlineQueued.get()).toBe(1);
    expect(fetchJson).not.toHaveBeenCalled();

    goOnline();
    await vi.advanceTimersByTimeAsync(QUIET);
    await settle(12);
    expect(fetchJson).toHaveBeenCalledTimes(1);
    const body = fetchJson.mock.calls[0][1] as RecognizeRequest;
    expect(body.strokes.x).toHaveLength(strokes.length);
    expect(editor.shapesOfType("math")).toHaveLength(1);
  });

  it("(c) a line erased while offline is skipped, leaves no echo and leaves the queue", async () => {
    goOffline();
    const keep = writeLine("2x=8", 100, 200, 40);
    const gone = writeLine("x=4", 100, 290, 40);
    await penUp(keep);
    await penUp(gone);
    expect(liveStore.offlineQueued.get()).toBe(2);

    // Erase the second line and reconnect before its quiet gate fires.
    editor.removeUser(gone.map((s) => s.id));
    goOnline();
    expect(liveStore.offlineQueued.get()).toBe(0);
    await vi.advanceTimersByTimeAsync(QUIET);
    await settle(12);

    expect(fetchJson).toHaveBeenCalledTimes(1);
    const lines = Object.values(liveStore.lines.get());
    expect(lines).toHaveLength(1);
    expect(new Set(lines[0].line.strokeIds)).toEqual(new Set(keep.map((s) => s.id)));
    expect(editor.shapesOfType("math")).toHaveLength(1);
    expect(recognizedLineIds()[0]).toBe(lines[0].line.id);
  });

  it("(c') erased after the offline flush already dropped it: still nothing recognized for it", async () => {
    goOffline();
    const gone = fixtureSingleLine();
    await penUp(gone);
    editor.removeUser(gone.map((s) => s.id));
    await vi.advanceTimersByTimeAsync(QUIET);
    await settle(8);
    expect(Object.keys(liveStore.lines.get())).toHaveLength(0);

    goOnline();
    await vi.advanceTimersByTimeAsync(QUIET);
    await settle(8);
    expect(fetchJson).not.toHaveBeenCalled();
    expect(editor.shapesOfType("math")).toHaveLength(0);
    expect(liveStore.offlineQueued.get()).toBe(0);
  });

  it("(d) a line rewritten while offline is recognized once with the hash of its latest ink", async () => {
    goOffline();
    const strokes = fixtureSingleLine();
    await penUp(strokes.slice(0, 6));
    const [lineId] = Object.keys(liveStore.lines.get());
    const staleHash = liveStore.lines.get()[lineId].line.hash;
    await penUp(strokes.slice(6));
    expect(Object.keys(liveStore.lines.get())).toEqual([lineId]);
    expect(liveStore.offlineQueued.get()).toBe(1);

    goOnline();
    await vi.advanceTimersByTimeAsync(QUIET);
    await settle(12);
    expect(fetchJson).toHaveBeenCalledTimes(1);
    const st = liveStore.lines.get()[lineId];
    const expected = await hashPayload(buildPayload(st.line, toInkStrokes(strokes))!);
    expect(st.line.hash).toBe(expected);
    expect(st.line.hash).not.toBe(staleHash);
    expect(recognizer.peek(expected)).toBeDefined();
    expect((fetchJson.mock.calls[0][1] as RecognizeRequest).strokes.x).toHaveLength(strokes.length);
  });

  it("(d') a line recognized online, then edited offline, is re-recognized with the new ink (not treated as a move)", async () => {
    const strokes = fixtureSingleLine();
    await penUp(strokes.slice(0, 7));
    expect(fetchJson).toHaveBeenCalledTimes(1);
    const [lineId] = Object.keys(liveStore.lines.get());
    const echoId = liveStore.lines.get()[lineId].mathShapeId;
    expect(echoId).not.toBeNull();

    goOffline();
    latexQueue.push("2x+3=11");
    await penUp(strokes.slice(7));
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(liveStore.offlineQueued.get()).toBe(1);
    expect(Object.keys(liveStore.lines.get())).toEqual([lineId]);

    goOnline();
    await vi.advanceTimersByTimeAsync(QUIET);
    await settle(12);
    expect(fetchJson).toHaveBeenCalledTimes(2);
    expect((fetchJson.mock.calls[1][1] as RecognizeRequest).strokes.x).toHaveLength(strokes.length);
    const st = liveStore.lines.get()[lineId];
    expect(st.latex).toBe("2x+3=11");
    // Same echo, updated in place.
    expect(st.mathShapeId).toBe(echoId);
    expect(editor.shapesOfType("math")).toHaveLength(1);
    expect((editor.shapesOfType("math")[0].props as MathShapeProps).latex).toBe("2x+3=11");
  });

  it("(e) ink whose hash is cached needs no network, offline or after reconnect", async () => {
    const strokes = fixtureSingleLine();
    await penUp(strokes);
    expect(fetchJson).toHaveBeenCalledTimes(1);
    const hash = Object.values(liveStore.lines.get())[0].line.hash;
    expect(recognizer.peek(hash)).toBeDefined();

    goOffline();
    // Erase and redraw the identical strokes: a new line with a known hash.
    editor.removeUser(strokes.map((s) => s.id));
    await vi.advanceTimersByTimeAsync(QUIET);
    await settle(8);
    expect(editor.shapesOfType("math")).toHaveLength(0);
    await penUp(strokes);
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(liveStore.offlineQueued.get()).toBe(0);
    expect(editor.shapesOfType("math")).toHaveLength(1);

    goOnline();
    await vi.advanceTimersByTimeAsync(QUIET * 2);
    await settle(8);
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(editor.shapesOfType("math")).toHaveLength(1);
  });

  it("(f) requestCheck offline starts no stream; one runs after reconnect when the line is still amber", async () => {
    latexQueue.push("x=5");
    await penUp(fixtureSingleLine());
    const [lineId] = Object.keys(liveStore.lines.get());
    expect(liveStore.lines.get()[lineId].analysis?.verdict).toBe("mismatch");
    expect(streamCalls).toHaveLength(0);

    goOffline();
    loop.requestCheck(lineId);
    loop.requestCheck(lineId);
    await settle(4);
    expect(streamCalls).toHaveLength(0);
    expect(liveStore.status.get()).toBe("offline");

    goOnline();
    await settle(6);
    expect(streamCalls).toEqual(["/api/live/check"]);
    // Once only: nothing else is retried later.
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.unknownIdleMs * 2);
    await settle(6);
    expect(streamCalls).toHaveLength(1);
  });

  it("(f') a pending check is dropped when the line became ok meanwhile, or while voice is active", async () => {
    latexQueue.push("x=5");
    await penUp(fixtureSingleLine());
    const [lineId] = Object.keys(liveStore.lines.get());

    goOffline();
    loop.requestCheck(lineId);
    await settle(4);
    expect(streamCalls).toHaveLength(0);
    loop.retypeLine(lineId, "x=4");
    await settle(6);
    expect(liveStore.lines.get()[lineId].analysis?.verdict).toBe("ok");

    goOnline();
    await settle(6);
    expect(streamCalls).toHaveLength(0);

    // Still amber but voice is on at reconnect: never call the LLM.
    loop.retypeLine(lineId, "x=5");
    await settle(6);
    goOffline();
    loop.requestCheck(lineId);
    await settle(4);
    online = true;
    loop.setOptions({ ...opts, voiceActive: true });
    await settle(6);
    expect(streamCalls).toHaveLength(0);
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it("(f'') a check whose fetch fails with a TypeError is deferred, not retried", async () => {
    latexQueue.push("x=5");
    await penUp(fixtureSingleLine());
    const [lineId] = Object.keys(liveStore.lines.get());
    loop.stop();
    let failNext = true;
    const stream = async function* (path: string): AsyncGenerator<LiveSseEvent, void, undefined> {
      streamCalls.push(path);
      if (failNext) {
        failNext = false;
        throw new TypeError("Failed to fetch");
      }
    };
    loop = createLiveLoop(editor, opts, {
      recognizer,
      stream,
      getEngine: async () => engine,
      fetchCapabilities: async () => ({ recognizer: "mathpix", liveEnabled: true, models: { check: "c", solve: "s", vision: "v" } }),
      events: null,
      isOnline: () => online,
    });
    loop.start();
    await settle(4);

    loop.requestCheck(lineId);
    await settle(6);
    expect(streamCalls).toHaveLength(1);
    expect(liveStore.status.get()).toBe("offline");
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.pillFadeMs * 3);
    await settle(4);
    expect(streamCalls).toHaveLength(1);

    // A real reconnect event replays it once.
    goOffline();
    goOnline();
    await settle(6);
    expect(streamCalls).toHaveLength(2);
    expect(liveStore.status.get()).toBe("idle");
  });

  it("(g) offlineQueued mirrors the queue and returns to 0 after replay; stop() clears it", async () => {
    expect(liveStore.offlineQueued.get()).toBe(0);
    goOffline();
    await penUp(writeLine("2x=8", 100, 200, 40));
    expect(liveStore.offlineQueued.get()).toBe(1);
    await penUp(writeLine("x=4", 100, 290, 40));
    expect(liveStore.offlineQueued.get()).toBe(2);
    // More ink on the second line: no growth.
    await penUp(writeLine("2", 214, 290, 40));
    expect(liveStore.offlineQueued.get()).toBe(2);
    expect(pillLabelFor("offline", "mathpix", liveStore.offlineQueued.get())).toBe("Offline — 2 lines waiting");

    goOnline();
    expect(liveStore.offlineQueued.get()).toBe(0);
    await vi.advanceTimersByTimeAsync(QUIET);
    await settle(12);
    expect(fetchJson).toHaveBeenCalledTimes(2);
    expect(liveStore.offlineQueued.get()).toBe(0);

    goOffline();
    await penUp(writeLine("1", 100, 400, 40));
    expect(liveStore.offlineQueued.get()).toBe(1);
    loop.stop();
    expect(liveStore.offlineQueued.get()).toBe(0);
    loop.start();
  });

  it("(h) replay never produces two math shapes for one line", async () => {
    goOffline();
    const a = writeLine("2x=8", 100, 200, 40);
    const b = writeLine("x=4", 100, 290, 40);
    await penUp(a);
    await penUp(b);
    // Touch both again offline so each is queued twice over.
    editor.updateUser(a[0].id, (s) => ({ ...s, x: s.x + 1 }));
    editor.updateUser(b[0].id, (s) => ({ ...s, x: s.x + 1 }));
    await vi.advanceTimersByTimeAsync(QUIET);
    await settle(8);
    expect(liveStore.offlineQueued.get()).toBe(2);

    goOnline();
    // A pen-up lands while the replay is pending: one flush handles all of it.
    editor.putUser(writeLine("3", 500, 290, 40));
    await vi.advanceTimersByTimeAsync(QUIET);
    await settle(16);
    const perLine = echoesByLine();
    expect([...perLine.values()].every((n) => n === 1)).toBe(true);
    expect(perLine.size).toBe(Object.keys(liveStore.lines.get()).length);
    const ids = recognizedLineIds();
    expect(new Set(ids).size).toBe(ids.length);
    await vi.advanceTimersByTimeAsync(QUIET * 2);
    await settle(8);
    expect([...echoesByLine().values()].every((n) => n === 1)).toBe(true);
  });

  it("requestSolve offline is deferred and runs once after reconnect in Solve mode", async () => {
    loop.stop();
    resetLiveStore();
    loop = makeLoop("answer");
    loop.start();
    latexQueue.push("x=5");
    await penUp(fixtureSingleLine());
    const [lineId] = Object.keys(liveStore.lines.get());
    const before = streamCalls.length;

    goOffline();
    loop.requestSolve(lineId);
    await settle(4);
    expect(streamCalls.length).toBe(before);
    expect(liveStore.status.get()).toBe("offline");

    goOnline();
    await settle(6);
    expect(streamCalls.slice(before)).toEqual(["/api/live/solve"]);
  });

  it("pill copy: offline label carries the waiting count", () => {
    expect(pillLabelFor("offline", "mathpix")).toBe("Offline");
    expect(pillLabelFor("offline", "mathpix", 0)).toBe("Offline");
    expect(pillLabelFor("offline", "mathpix", 1)).toBe("Offline — 1 line waiting");
    expect(pillLabelFor("offline", "vision", 7)).toBe("Offline — 7 lines waiting");
    expect(pillLabelFor("idle", "mathpix", 7)).toBe("Live");
    expect(pillLabelFor("reading", "mathpix", 7)).toBe("Reading…");
  });
});
