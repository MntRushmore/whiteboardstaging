import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";
import { isSalient } from "../salience";
import {
  LECTURE_LIMITS,
  LECTURE_TIMING,
  LectureRequestSchema,
  type LectureAction,
  type LectureRequest,
  type LectureResponse,
  type LectureRunReport,
  type LectureScreen,
  type SketchDrawing,
  type SketchRequest,
  type SketchResponse,
  type SpeechCallbacks,
  type SpeechSource,
} from "../contracts";
import type { LectureRunOptions } from "../desk";
import { FOLLOW_UP_GAP_MS, HEARTBEAT_MS, LectureSession, REQUEST_MAX_WAIT_MS, RUN_ON, REQUEST_QUIET_MS, SKETCH_TIMEOUT_MS, sketchKind, timingForSpeed, updatingKind, type LectureSessionDeps } from "../session";
import { SpeechError } from "../speech/errors";

// ------------------------------------------------------------------ fakes

class FakeSource implements SpeechSource {
  readonly kind = "script" as const;
  cb: SpeechCallbacks | null = null;
  pause = vi.fn();
  resume = vi.fn();
  stop = vi.fn(() => {
    // like the real sources: what was being heard becomes a final on stop
    if (this.pending) this.cb?.onFinal({ text: this.pending, atMs: Date.now() - T0 });
    this.pending = "";
  });
  pending = "";
  async start(cb: SpeechCallbacks): Promise<void> {
    this.cb = cb;
    cb.onState("listening");
  }
  say(text: string): void {
    this.pending = "";
    this.cb?.onFinal({ text, atMs: Date.now() - T0 });
  }
  hear(text: string): void {
    this.pending = text;
    this.cb?.onPartial(text);
  }
}

const T0 = 1_790_000_000_000;
/** filler words with no digits, numbers, steps or changes in them: never salient */
const alpha = (i: number): string => (i < 26 ? String.fromCharCode(97 + i) : alpha(Math.floor(i / 26) - 1) + String.fromCharCode(97 + (i % 26)));
const words = (n: number, w = "w") => Array.from({ length: n }, (_, i) => `${w}${alpha(i)}`).join(" ");
const HEADING: LectureAction = { type: "heading", text: "Photosynthesis" };
const NOTE: LectureAction = { type: "note", text: "Light is absorbed" };

function reply(actions: LectureAction[] = [], notes: string[] = []): LectureResponse {
  return { actions, notes, model: "test", ms: 5 };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface Harness {
  session: LectureSession;
  source: FakeSource;
  screen: LectureScreen;
  run: ReturnType<typeof vi.fn<(actions: readonly LectureAction[], opts?: LectureRunOptions) => Promise<LectureRunReport>>>;
  saved: string[];
  requests: Array<{ req: LectureRequest; signal: AbortSignal; at?: number }>;
  request: ReturnType<typeof vi.fn<(req: LectureRequest, signal: AbortSignal) => Promise<LectureResponse>>>;
}

async function startSession(over: Partial<LectureSessionDeps> = {}): Promise<Harness> {
  const source = new FakeSource();
  const screen: LectureScreen = { empty: true, topic: null, drawn: [], room: 1, active: [] };
  const saved: string[] = [];
  const requests: Harness["requests"] = [];
  const run = vi.fn<(actions: readonly LectureAction[], opts?: LectureRunOptions) => Promise<LectureRunReport>>(async (actions) => ({
    outcomes: actions.map((a) => ({ type: a.type, ok: true, what: a.type === "heading" ? `heading: ${a.text}` : a.type === "note" ? `note: ${a.text}` : a.type })),
    screensAdded: 0,
  }));
  const request = vi.fn(async (req: LectureRequest, signal: AbortSignal) => {
    requests.push({ req, signal });
    return reply();
  });
  const session = new LectureSession({
    boardId: "board-1",
    openSource: async () => source,
    board: { screen: () => screen, run, saveTranscript: (t) => saved.push(t) },
    request,
    ...over,
  });
  await session.start();
  return { session, source, screen, run, saved, requests, request };
}

const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

// ------------------------------------------------------------------ tests

describe("LectureSession: starting and hearing", () => {
  it("starts listening; finals are saved on the board and shown; partials are shown", async () => {
    const h = await startSession();
    expect(h.session.snapshot().status).toBe("listening");
    expect(h.session.snapshot().source).toBe("script");
    h.source.hear("Photosynthesis happens");
    expect(h.session.snapshot().stats.partial).toBe("Photosynthesis happens");
    h.source.say("Photosynthesis happens in the chloroplast.");
    h.source.say("First, light is absorbed.");
    h.source.say("Then water is split.");
    const s = h.session.snapshot();
    expect(s.stats.partial).toBe("");
    expect(s.stats.lines).toEqual(["First, light is absorbed.", "Then water is split."]);
    expect(s.stats.words).toBe(13);
    expect(h.saved).toEqual(["Photosynthesis happens in the chloroplast.", "First, light is absorbed.", "Then water is split."]);
  });

  it("a source that cannot start is an error with its code", async () => {
    const session = new LectureSession({
      boardId: "b",
      openSource: async () => {
        throw new SpeechError("unsupported");
      },
      board: { screen: () => ({ empty: true, topic: null, drawn: [], room: 1, active: [] }), run: vi.fn(), saveTranscript: vi.fn() },
      request: vi.fn(),
    });
    await session.start();
    expect(session.snapshot()).toMatchObject({ status: "error", error: "unsupported" });
  });

  it("the token route's 402 while opening the source is out of credits", async () => {
    const session = new LectureSession({
      boardId: "b",
      openSource: async () => {
        throw new ApiError("x", 402, "credits_exhausted");
      },
      board: { screen: () => ({ empty: true, topic: null, drawn: [], room: 1, active: [] }), run: vi.fn(), saveTranscript: vi.fn() },
      request: vi.fn(),
    });
    await session.start();
    expect(session.snapshot()).toMatchObject({ status: "error", error: "credits" });
  });

  it("the source failing for good ends the lecture with its code", async () => {
    const h = await startSession();
    h.source.cb?.onState("error", "mic-missing");
    expect(h.session.snapshot()).toMatchObject({ status: "error", error: "mic-missing" });
    expect(h.source.stop).toHaveBeenCalled();
    h.source.cb?.onState("error", "gibberish");
    expect(h.session.snapshot().error).toBe("mic-missing");
  });

  it("a reconnecting source keeps the lecture listening", async () => {
    const h = await startSession();
    h.source.cb?.onState("reconnecting");
    expect(h.session.snapshot()).toMatchObject({ status: "listening", speech: "reconnecting" });
  });
});

describe("LectureSession: pacing", () => {
  it("asks no sooner than tickMinMs after the start, then with the fresh words", async () => {
    const h = await startSession();
    await advance(5_000);
    h.source.say(words(50, "a"));
    await advance(LECTURE_TIMING.tickMinMs - 5_000 - HEARTBEAT_MS);
    expect(h.request).not.toHaveBeenCalled();
    await advance(HEARTBEAT_MS);
    expect(h.request).toHaveBeenCalledTimes(1);
    const req = h.requests[0].req;
    expect(req).toMatchObject({ boardId: "board-1", context: "", fresh: words(50, "a"), force: false, recent: [] });
    expect(LectureRequestSchema.safeParse(req).success).toBe(true);
  });

  it("needs tickMinWords new words as well: time alone asks nothing", async () => {
    const h = await startSession();
    h.source.say(words(LECTURE_TIMING.tickMinWords - 1));
    await advance(5 * 60_000);
    expect(h.request).not.toHaveBeenCalled();
    h.source.say("one more"); // the threshold is crossed by a final: asked at once
    await advance(0);
    expect(h.request).toHaveBeenCalledTimes(1);
  });

  it("after an ask, the next needs both the time and the words again; the first ask's words become context", async () => {
    const h = await startSession();
    h.source.say(words(50, "a"));
    await advance(LECTURE_TIMING.tickMinMs);
    expect(h.request).toHaveBeenCalledTimes(1);
    // enough words at once, but too soon
    h.source.say(words(60, "b"));
    await advance(LECTURE_TIMING.tickMinMs - HEARTBEAT_MS);
    expect(h.request).toHaveBeenCalledTimes(1);
    await advance(HEARTBEAT_MS);
    expect(h.request).toHaveBeenCalledTimes(2);
    expect(h.requests[1].req).toMatchObject({ context: words(50, "a"), fresh: words(60, "b") });
  });

  it("never has two asks in flight: the drawing of an answer counts as in flight", async () => {
    const answer = deferred<LectureResponse>();
    const drawn = deferred<LectureRunReport>();
    const h = await startSession({ request: vi.fn().mockImplementationOnce(() => answer.promise).mockResolvedValue(reply()) });
    h.run.mockImplementationOnce(() => drawn.promise);
    h.source.say(words(50));
    await advance(LECTURE_TIMING.tickMinMs);
    expect(h.session.snapshot().thinking).toBe(true);
    h.source.say(words(100, "x"));
    await advance(3 * LECTURE_TIMING.tickMinMs);
    const request = h.session["deps"].request as ReturnType<typeof vi.fn>;
    expect(request).toHaveBeenCalledTimes(1);
    answer.resolve(reply([HEADING]));
    await advance(0);
    expect(h.session.snapshot()).toMatchObject({ thinking: false, drawing: true });
    await advance(3 * LECTURE_TIMING.tickMinMs);
    expect(request).toHaveBeenCalledTimes(1);
    drawn.resolve({ outcomes: [{ type: "heading", ok: true, what: "heading: Photosynthesis" }], screensAdded: 1 });
    await advance(0);
    // the next ask goes the moment the drawing is done (the words and the time are both there)
    expect(request).toHaveBeenCalledTimes(2);
    expect(h.session.snapshot().stats).toMatchObject({ sketches: 1, lastWhat: "heading: Photosynthesis" });
  });

  it("runs the director's actions on the board and counts what was drawn (a new screen is not a sketch)", async () => {
    const h = await startSession();
    h.request.mockResolvedValueOnce(reply([{ type: "new_screen" }, HEADING, NOTE]));
    h.run.mockResolvedValueOnce({
      outcomes: [
        { type: "new_screen", ok: true, what: "new screen" },
        { type: "heading", ok: true, what: "heading: Photosynthesis" },
        { type: "note", ok: false, note: "no room" },
      ],
      screensAdded: 1,
    });
    h.source.say(words(50));
    await advance(LECTURE_TIMING.tickMinMs);
    expect(h.run).toHaveBeenCalledWith([{ type: "new_screen" }, HEADING, NOTE], expect.objectContaining({ onSketch: expect.any(Function) }));
    expect(h.session.snapshot().stats).toMatchObject({ sketches: 1, lastWhat: "heading: Photosynthesis" });
  });

  it("pauses its clock: no asks while paused, and the timer counts listening time only", async () => {
    const h = await startSession();
    h.source.say(words(50));
    await advance(10_000);
    h.session.pause();
    expect(h.source.pause).toHaveBeenCalled();
    expect(h.session.snapshot().status).toBe("paused");
    await advance(5 * 60_000);
    expect(h.request).not.toHaveBeenCalled();
    expect(h.session.snapshot().stats.elapsedMs).toBe(10_000);
    h.session.resume();
    expect(h.source.resume).toHaveBeenCalled();
    await advance(2_000);
    expect(h.session.snapshot().stats.elapsedMs).toBe(12_000);
    // the time since the last ask kept running while paused: the words are asked about at once
    expect(h.request).toHaveBeenCalledTimes(1);
  });
});

describe("LectureSession: Draw that", () => {
  it("asks at once about the last minute of speech, with force", async () => {
    const h = await startSession();
    h.source.say("Early words from the introduction.");
    await advance(90_000);
    h.source.say("Supply meets demand at the market price.");
    await advance(10_000);
    h.source.say("Demand shifts outward.");
    h.session.drawThat();
    expect(h.session.snapshot().forcing).toBe(true);
    await advance(0);
    expect(h.request).toHaveBeenCalledTimes(1);
    expect(h.requests[0].req).toMatchObject({ force: true, context: "Early words from the introduction.", fresh: "Supply meets demand at the market price. Demand shifts outward." });
    expect(h.session.snapshot().forcing).toBe(false);
  });

  it("waits forceMinGapMs after the last ask", async () => {
    const h = await startSession();
    h.source.say(words(50));
    await advance(LECTURE_TIMING.tickMinMs);
    expect(h.request).toHaveBeenCalledTimes(1);
    await advance(1_000);
    h.session.drawThat();
    await advance(LECTURE_TIMING.forceMinGapMs - 1_000 - 1);
    expect(h.request).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(h.request).toHaveBeenCalledTimes(2);
    expect(h.requests[1].req.force).toBe(true);
  });

  it("while an ask is in flight it is queued, once", async () => {
    const answer = deferred<LectureResponse>();
    const h = await startSession();
    h.request.mockImplementationOnce(() => answer.promise);
    h.source.say(words(50));
    await advance(LECTURE_TIMING.tickMinMs);
    h.session.drawThat();
    h.session.drawThat();
    h.session.drawThat();
    await advance(10_000);
    expect(h.request).toHaveBeenCalledTimes(1);
    answer.resolve(reply());
    await advance(0);
    expect(h.request).toHaveBeenCalledTimes(2);
    expect(h.request.mock.calls[1][0].force).toBe(true);
    await advance(60_000);
    expect(h.request.mock.calls.filter((c) => c[0].force)).toHaveLength(1);
  });

  it("nothing heard yet: nothing asked, and the panel says so", async () => {
    const h = await startSession();
    h.session.drawThat();
    await advance(10_000);
    expect(h.request).not.toHaveBeenCalled();
    expect(h.session.snapshot().notice).toEqual({ kind: "empty" });
  });

  it("an answer with nothing to draw says so, with the route's note", async () => {
    const h = await startSession();
    h.request.mockResolvedValueOnce(reply([], ["Nothing visual in the last minute."]));
    h.source.say("Good morning everyone.");
    h.session.drawThat();
    await advance(0);
    expect(h.session.snapshot().notice).toEqual({ kind: "nothing", note: "Nothing visual in the last minute." });
  });

  it("works while paused (about what was heard before the pause)", async () => {
    const h = await startSession();
    h.source.say("The water cycle moves water around the planet.");
    h.session.pause();
    h.session.drawThat();
    await advance(0);
    expect(h.request).toHaveBeenCalledTimes(1);
    expect(h.requests[0].req.fresh).toBe("The water cycle moves water around the planet.");
  });
});

describe("LectureSession: failures", () => {
  it("402 stops the lecture: out of credits, the source stopped, nothing more asked", async () => {
    const h = await startSession();
    h.request.mockRejectedValueOnce(new ApiError("x", 402, "credits_exhausted"));
    h.source.say(words(50));
    await advance(LECTURE_TIMING.tickMinMs);
    expect(h.session.snapshot()).toMatchObject({ status: "error", error: "credits" });
    expect(h.source.stop).toHaveBeenCalled();
    h.source.say(words(100));
    h.session.drawThat();
    await advance(5 * 60_000);
    expect(h.request).toHaveBeenCalledTimes(1);
  });

  it("401 stops it signed out", async () => {
    const h = await startSession();
    h.request.mockRejectedValueOnce(new ApiError("x", 401, "unauthorized"));
    h.source.say(words(50));
    await advance(LECTURE_TIMING.tickMinMs);
    expect(h.session.snapshot()).toMatchObject({ status: "error", error: "unauthorized" });
  });

  it("429 skips ticks until the server's retry-after", async () => {
    const h = await startSession();
    h.request.mockRejectedValueOnce(new ApiError("x", 429, "rate_limited", undefined, 90_000));
    h.source.say(words(50));
    await advance(LECTURE_TIMING.tickMinMs);
    expect(h.session.snapshot()).toMatchObject({ status: "listening", notice: { kind: "rate_limited", retryAtMs: T0 + LECTURE_TIMING.tickMinMs + 90_000 } });
    h.source.say(words(50, "b"));
    await advance(90_000 - HEARTBEAT_MS);
    expect(h.request).toHaveBeenCalledTimes(1);
    await advance(HEARTBEAT_MS);
    expect(h.request).toHaveBeenCalledTimes(2);
    expect(h.session.snapshot().notice).toBeNull();
  });

  it("a network error or a 5xx keeps listening; the next tick asks again with the same unread words", async () => {
    const h = await startSession();
    h.request.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    h.source.say(words(50, "a"));
    await advance(LECTURE_TIMING.tickMinMs);
    expect(h.session.snapshot()).toMatchObject({ status: "listening", notice: { kind: "retrying" } });
    h.request.mockRejectedValueOnce(new ApiError("x", 502, "upstream_error"));
    await advance(LECTURE_TIMING.tickMinMs);
    expect(h.request).toHaveBeenCalledTimes(2);
    await advance(LECTURE_TIMING.tickMinMs);
    expect(h.request).toHaveBeenCalledTimes(3);
    expect(h.request.mock.calls[2][0]).toMatchObject({ context: "", fresh: words(50, "a") });
    expect(h.session.snapshot().notice).toBeNull();
  });

  it("a director that does not answer is aborted after requestTimeoutMs, and tried again later", async () => {
    const h = await startSession({
      request: vi.fn(
        (_req: LectureRequest, signal: AbortSignal) =>
          new Promise<LectureResponse>((_, reject) => signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))),
      ),
    });
    h.source.say(words(50));
    await advance(LECTURE_TIMING.tickMinMs);
    expect(h.session.snapshot().thinking).toBe(true);
    const request = h.session["deps"].request as ReturnType<typeof vi.fn>;
    const first = request.mock.calls[0][1] as AbortSignal;
    await advance(LECTURE_TIMING.requestTimeoutMs - 1);
    expect(first.aborted).toBe(false);
    await advance(1);
    expect(first.aborted).toBe(true);
    // the same unread words are asked about again at the next tick (tickMinMs after the failed ask)
    await advance(HEARTBEAT_MS);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1][0].fresh).toBe(request.mock.calls[0][0].fresh);
    expect(h.session.snapshot().status).toBe("listening");
  });

  it("a board that fails to draw is a notice, not the end", async () => {
    const h = await startSession();
    h.request.mockResolvedValueOnce(reply([HEADING]));
    h.run.mockRejectedValueOnce(new Error("editor gone"));
    h.source.say(words(50));
    await advance(LECTURE_TIMING.tickMinMs);
    expect(h.session.snapshot()).toMatchObject({ status: "listening", drawing: false, notice: { kind: "board_failed" } });
  });
});

describe("LectureSession: idle and stop", () => {
  it("pauses itself after idlePauseMs without a final, and says why", async () => {
    const h = await startSession();
    h.source.say("Hello.");
    await advance(LECTURE_TIMING.idlePauseMs - HEARTBEAT_MS);
    expect(h.session.snapshot().status).toBe("listening");
    h.source.hear("still talking but nothing committed");
    await advance(HEARTBEAT_MS);
    expect(h.session.snapshot()).toMatchObject({ status: "paused", notice: { kind: "idle" } });
    expect(h.source.pause).toHaveBeenCalled();
    h.session.resume();
    expect(h.session.snapshot()).toMatchObject({ status: "listening", notice: null });
    await advance(LECTURE_TIMING.idlePauseMs - HEARTBEAT_MS);
    expect(h.session.snapshot().status).toBe("listening");
  });

  it("stop saves what was being heard, stops the source and asks nothing more", async () => {
    const h = await startSession();
    h.source.say(words(44));
    h.source.hear("and the last two words");
    h.session.stop();
    expect(h.source.stop).toHaveBeenCalled();
    expect(h.saved.at(-1)).toBe("and the last two words");
    expect(h.session.snapshot().status).toBe("stopped");
    await advance(5 * 60_000);
    expect(h.request).not.toHaveBeenCalled();
  });

  it("stop aborts an ask in flight", async () => {
    const h = await startSession({ request: vi.fn(() => new Promise<LectureResponse>(() => undefined)) });
    h.source.say(words(50));
    await advance(LECTURE_TIMING.tickMinMs);
    const signal = (h.session["deps"].request as ReturnType<typeof vi.fn>).mock.calls[0][1] as AbortSignal;
    expect(signal.aborted).toBe(false);
    h.session.stop();
    expect(signal.aborted).toBe(true);
  });

  it("stopped while the source was opening: the source is stopped once it arrives", async () => {
    const source = new FakeSource();
    const opened = deferred<SpeechSource>();
    const session = new LectureSession({
      boardId: "b",
      openSource: () => opened.promise,
      board: { screen: () => ({ empty: true, topic: null, drawn: [], room: 1, active: [] }), run: vi.fn(), saveTranscript: vi.fn() },
      request: vi.fn(),
    });
    const started = session.start();
    session.stop();
    opened.resolve(source);
    await started;
    expect(source.stop).toHaveBeenCalled();
    expect(source.cb).toBeNull();
    expect(session.snapshot().status).toBe("stopped");
  });
});

describe("LectureSession: what was drawn before", () => {
  it("recent: what this lecture drew that is not on the current screen, newest first, capped", async () => {
    const h = await startSession();
    const whats = Array.from({ length: 12 }, (_, i) => `note: point ${i}`);
    h.request.mockResolvedValueOnce(reply([NOTE]));
    h.run.mockResolvedValueOnce({ outcomes: whats.map((what) => ({ type: "note" as const, ok: true, what })), screensAdded: 0 });
    h.source.say(words(50));
    await advance(LECTURE_TIMING.tickMinMs);
    expect(h.session.snapshot().stats.sketches).toBe(12);

    // the current screen shows the last two: they are "drawn here", not "drawn before"
    const recent = h.session.recentFor({ drawn: ["note: point 11", "note: point 10"] });
    expect(recent).toHaveLength(LECTURE_LIMITS.recent);
    expect(recent[0]).toBe("note: point 9");
    expect(recent).not.toContain("note: point 11");
    expect(recent.at(-1)).toBe("note: point 2");

    // …and that is what the next ask carries
    h.screen.drawn = ["note: point 11", "note: point 10"];
    h.source.say(words(50, "b"));
    await advance(LECTURE_TIMING.tickMinMs);
    const next = h.request.mock.calls[1][0];
    expect(next.recent).toEqual(recent);
    expect(next.screen.drawn).toEqual(["note: point 11", "note: point 10"]);
  });

  it("failed outcomes and new screens are not recent", async () => {
    const h = await startSession();
    h.request.mockResolvedValueOnce(reply([HEADING]));
    h.run.mockResolvedValueOnce({
      outcomes: [
        { type: "new_screen", ok: true, what: "new screen" },
        { type: "chart", ok: false, what: "bar chart: nope", note: "no room" },
        { type: "heading", ok: true, what: "heading: Cells" },
      ],
      screensAdded: 1,
    });
    h.source.say(words(50));
    await advance(LECTURE_TIMING.tickMinMs);
    expect(h.session.recentFor({ drawn: [] })).toEqual(["heading: Cells"]);
  });
});

describe("LectureSession: scaled timing (a scripted demo)", () => {
  it("uses the pacing it is given", async () => {
    const h = await startSession({ timing: { tickMinMs: 10_000 } });
    h.source.say(words(50));
    await advance(10_000);
    expect(h.request).toHaveBeenCalledTimes(1);
  });
});

// ------------------------------------------------------------------ LIVE: the pace while numbers come

/** Plays timed finals (ms since the start) through the fake source, advancing the fake clock between them. */
async function play(h: Harness, lines: Array<[number, string]>, until: number): Promise<void> {
  let t = 0;
  for (const [at, text] of lines) {
    await advance(at - t);
    t = at;
    h.source.say(text);
  }
  await advance(until - t);
}

const askTimes = (h: Harness) => h.request.mock.invocationCallOrder.map((_, i) => h.requests[i]?.at ?? NaN);

describe("LectureSession: the live pace", () => {
  /** a director that records when it was asked */
  async function timedSession(over: Partial<LectureSessionDeps> = {}) {
    const h = await startSession(over);
    h.request.mockImplementation(async (req, signal) => {
      h.requests.push({ req, signal, at: Date.now() - T0 });
      return reply();
    });
    return h;
  }

  const SALES: Array<[number, string]> = [
    [1_000, "Let's look at how our sales went this year."],
    [4_000, "In the first quarter we sold twelve million units."],
    [9_000, "The second quarter was up to fifteen million."],
    [13_000, "That is a twenty five percent jump."],
    [18_000, "Then the third quarter dipped to eleven million."],
    [22_000, "Mostly because of the supply problems."],
    [27_000, "And the fourth quarter finished at eighteen million."],
    [31_000, "Our best quarter ever."],
  ];

  it("a sales story: asked the moment it starts, then at the live pace, every sentence reaching the director once and within one interval", async () => {
    const h = await timedSession();
    await play(h, SALES.slice(0, 7), 29_000);
    await advance(2_000);
    h.source.say(SALES[7][1]);
    await advance(14_000);
    const times = askTimes(h);
    // asked the moment the story starts, then never closer together than the live pace allows
    expect(times[0]).toBe(1_000);
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(LECTURE_TIMING.liveTickMinMs);
    expect(h.requests[0].req.fresh).toBe("Let's look at how our sales went this year.");
    expect(h.requests[1].req.context).toBe("Let's look at how our sales went this year.");
    // a sentence with numbers in it reaches the director exactly once, within one live interval; the
    // rest go with the next ask (an aside at the very end waits for more words, at the usual pace)
    for (const [at, text] of SALES) {
      const carrying = h.requests.filter((r) => r.req.fresh.includes(text));
      expect(carrying.length, text).toBeLessThanOrEqual(1);
      if (!isSalient(text)) continue;
      expect(carrying, text).toHaveLength(1);
      expect(carrying[0].at! - at, text).toBeLessThanOrEqual(LECTURE_TIMING.liveTickMinMs);
    }
  });

  it("chatter without numbers or steps stays at the usual pace", async () => {
    const h = await timedSession();
    const chatter: Array<[number, string]> = Array.from({ length: 30 }, (_, i) => [(i + 1) * 4_000, `${words(12, "chat")} and so on`]);
    await play(h, chatter, 125_000);
    expect(askTimes(h)).toEqual(Array.from({ length: Math.floor(125_000 / LECTURE_TIMING.tickMinMs) }, (_, i) => (i + 1) * LECTURE_TIMING.tickMinMs));
    expect(h.session.snapshot().pace).toBe("normal");
  });

  it("a salient segment is asked about the moment it is committed when the pace allows (no heartbeat wait)", async () => {
    const h = await timedSession();
    await advance(20_300);
    h.source.say("Revenue grew by 4 percent.");
    await advance(0);
    expect(askTimes(h)).toEqual([20_300]);
  });

  it("the live pace needs liveTickMinWords new words", async () => {
    const h = await timedSession();
    h.source.say("Twelve million.");
    await advance(60_000);
    expect(h.request).not.toHaveBeenCalled();
    h.source.say("Then fifteen in April.");
    await advance(0);
    expect(h.request).toHaveBeenCalledTimes(1);
  });

  it("salient segments heard while an ask is in flight make exactly one follow-up, right after it", async () => {
    const h = await startSession();
    const asked: number[] = [];
    h.request.mockImplementation(async (req) => {
      asked.push(Date.now() - T0);
      h.requests.push({ req, signal: new AbortController().signal });
      await new Promise((r) => setTimeout(r, 3_000)); // the director takes 3 s
      return reply();
    });
    await play(
      h,
      [
        [1_000, "Sales in the first quarter were twelve million."], // asked at once
        [2_000, "Then fifteen in the second."], // in flight
        [3_000, "Then eighteen in the third."], // in flight: coalesced with the one before
      ],
      3_500,
    );
    expect(asked).toEqual([1_000]); // the director is still thinking until 4 s
    await advance(2_500); // settled at 4 s; the follow-up goes at the later of that and the budget gap
    expect(FOLLOW_UP_GAP_MS).toBe(3_000);
    expect(asked).toEqual([1_000, Math.max(4_000, 1_000 + FOLLOW_UP_GAP_MS)]);
    expect(h.requests[1].req.fresh).toBe("Then fifteen in the second. Then eighteen in the third.");
    await advance(60_000);
    expect(asked).toHaveLength(2); // nothing new was said: no more asks
  });

  it("a follow-up goes straight after an ask that took longer than the budget gap", async () => {
    const h = await startSession();
    const asked: number[] = [];
    h.request.mockImplementation(async () => {
      asked.push(Date.now() - T0);
      await new Promise((r) => setTimeout(r, 6_000));
      return reply();
    });
    await play(h, [[1_000, "Sales were twelve million in March."], [3_000, "April was up to fifteen."]], 8_000);
    expect(asked).toEqual([1_000, 7_000]); // settled at 7 s, past the gap: straight away
  });

  it("chatter heard in flight asks for no follow-up", async () => {
    const h = await startSession();
    const asked: number[] = [];
    h.request.mockImplementation(async () => {
      asked.push(Date.now() - T0);
      await new Promise((r) => setTimeout(r, 3_000));
      return reply();
    });
    await play(h, [[1_000, "Sales were twelve million in March."], [2_000, words(12, "chat")]], 30_000);
    expect(asked).toEqual([1_000]); // the chatter waits for the usual pace
  });

  it("after a chart is drawn, the pace stays live for activeWindowMs, then goes back to normal", async () => {
    const h = await timedSession();
    h.request.mockImplementationOnce(async (req, signal) => {
      h.requests.push({ req, signal, at: Date.now() - T0 });
      return reply([{ type: "chart", chart: { kind: "bar", labels: ["Q1", "Q2"], series: [{ values: [12, null] }] } }]);
    });
    h.run.mockResolvedValueOnce({ outcomes: [{ type: "chart", ok: true, id: "c1", what: "bar chart: Q1, Q2" }], screensAdded: 0 });
    h.source.say("Sales in the first quarter were twelve million.");
    await advance(0);
    expect(askTimes(h)).toEqual([0]);
    expect(h.session.snapshot().liveVisual).toBe(true);
    // plain talk while the chart is live: still asked at the live pace
    await advance(2_000);
    h.source.say(words(8, "talk"));
    await advance(6_000);
    expect(askTimes(h)).toEqual([0, LECTURE_TIMING.liveTickMinMs]);
    // past the live window, plain talk is back to the usual pace
    await advance(LECTURE_TIMING.activeWindowMs);
    expect(h.session.snapshot().liveVisual).toBe(false);
    const n = h.requests.length;
    h.source.say(words(8, "talk"));
    await advance(LECTURE_TIMING.liveTickMinMs);
    expect(h.requests.length).toBe(n);
  });

  it("every request carries the session's id; another session has another", async () => {
    const h = await timedSession();
    await play(h, SALES, 35_000);
    const ids = new Set(h.requests.map((r) => r.req.session));
    expect(ids.size).toBe(1);
    expect([...ids][0]).toMatch(/^[A-Za-z0-9_-]{8,40}$/);
    expect([...ids][0]).toBe(h.session.sessionId);
    const other = await startSession();
    expect(other.session.sessionId).not.toBe(h.session.sessionId);
  });

  it("an update: 'updating the chart' while it is written, one sketch, and recent holds it once, as it is now", async () => {
    const drawn = deferred<LectureRunReport>();
    const h = await startSession();
    h.request
      .mockResolvedValueOnce(reply([{ type: "chart", chart: { kind: "bar", labels: ["Q1", "Q2"], series: [{ values: [12, null] }] } }]))
      .mockResolvedValueOnce(reply([{ type: "update_chart", target: "c1", chart: { kind: "bar", title: "Sales", labels: ["Q1", "Q2"], series: [{ values: [12, 15] }] } }]));
    h.run.mockResolvedValueOnce({ outcomes: [{ type: "chart", ok: true, id: "c1", what: "bar chart: Q1, Q2" }], screensAdded: 0 });
    h.run.mockImplementationOnce(() => drawn.promise);
    h.source.say("Sales in the first quarter were twelve million.");
    await advance(0);
    expect(h.session.snapshot().stats).toMatchObject({ sketches: 1, lastWhat: "bar chart: Q1, Q2", lastVerb: "drew" });
    await advance(8_000);
    h.source.say("The second quarter was fifteen million.");
    await advance(0);
    expect(h.session.snapshot()).toMatchObject({ drawing: true, updating: "chart" });
    drawn.resolve({ outcomes: [{ type: "update_chart", ok: true, id: "c1", what: "bar chart: Sales" }], screensAdded: 0 });
    await advance(0);
    expect(h.session.snapshot()).toMatchObject({ drawing: false, updating: null, stats: { sketches: 1, lastWhat: "bar chart: Sales", lastVerb: "updated" } });
    expect(h.session.recentFor({ drawn: [] })).toEqual(["bar chart: Sales"]);
  });

  it("scripted at 4×, the live pace is scaled too", () => {
    const t = timingForSpeed(4);
    expect(t.liveTickMinMs).toBe(LECTURE_TIMING.liveTickMinMs / 4);
    expect(t.activeWindowMs).toBe(LECTURE_TIMING.activeWindowMs / 4);
    expect(t.liveTickMinWords).toBe(LECTURE_TIMING.liveTickMinWords);
    expect(t.requestTimeoutMs).toBe(LECTURE_TIMING.requestTimeoutMs);
  });
});

describe("updatingKind", () => {
  const chart = { kind: "bar" as const, labels: ["a", "b"], series: [{ values: [1, 2] }] };
  it("an update of a chart or a diagram, or a new sketch", () => {
    expect(updatingKind([{ type: "update_chart", target: "c", chart }])).toBe("chart");
    expect(updatingKind([{ type: "new_screen" }, { type: "update_diagram", target: "d", diagram: { kind: "cycle", steps: ["a", "b", "c"] } }])).toBe("diagram");
    expect(updatingKind([{ type: "update_chart", target: "c", chart }, HEADING])).toBeNull();
    expect(updatingKind([{ type: "chart", chart }])).toBeNull();
    expect(updatingKind([])).toBeNull();
  });
});

describe("LectureSession: sketches", () => {
  const COMIC: LectureAction = { type: "sketch", title: "Officer Vega", cast: "Officer Vega: visor helmet, long coat", panels: [1, 2, 3, 4].map((i) => ({ prompt: `Officer Vega, scene ${i}` })) };
  const WHAT = "comic (4 panels): Officer Vega";
  const DRAWING: SketchDrawing = {
    w: 1000,
    h: 800,
    strokes: [
      {
        points: [
          [0, 0],
          [10, 10],
        ],
        closed: false,
        fill: false,
      },
    ],
    labels: [],
  };
  const PANEL = { prompt: "Officer Vega, scene 1", cast: "Officer Vega: visor helmet, long coat", panel: { index: 0, of: 4 }, aspect: 0.9 };

  /** A session with the illustrator, whose board draws a comic: it keeps the run's options, as the desk does. */
  async function withIllustrator() {
    const out: Array<{ req: SketchRequest; signal: AbortSignal; d: ReturnType<typeof deferred<SketchResponse>> }> = [];
    const requestSketch = vi.fn((req: SketchRequest, signal: AbortSignal) => {
      const d = deferred<SketchResponse>();
      out.push({ req, signal, d });
      return d.promise;
    });
    const h = await startSession({ requestSketch });
    let opts: LectureRunOptions | undefined;
    h.run.mockImplementation(async (_actions, o) => {
      opts = o;
      return { outcomes: [{ type: "sketch", ok: true, id: "lv_1", what: WHAT }], screensAdded: 0 };
    });
    h.request.mockResolvedValueOnce(reply([COMIC]));
    h.source.say(`draw me a comic ${words(50)}`);
    await advance(LECTURE_TIMING.tickMinMs);
    expect(opts).toBeDefined();
    return { h, out, requestSketch, opts: opts! };
  }

  it("the run is given the way to the illustrator: each panel asked with the board's and the session's ids, its drawing handed back", async () => {
    const { h, out, requestSketch, opts } = await withIllustrator();
    const panel = opts.requestSketch!(PANEL, new AbortController().signal);
    await advance(0);
    expect(requestSketch).toHaveBeenCalledTimes(1);
    expect(out[0].req).toEqual({ ...PANEL, boardId: "board-1", session: h.session.sessionId });
    out[0].d.resolve({ drawing: DRAWING, model: "m", ms: 9000, charged: true });
    await expect(panel).resolves.toEqual(DRAWING);
  });

  it('"Drawing the comic…" while its frames are written and while its panels come; the lecture goes on meanwhile', async () => {
    const h = await startSession({ requestSketch: vi.fn() });
    const frames = deferred<LectureRunReport>();
    let opts: LectureRunOptions | undefined;
    h.run.mockImplementationOnce((_a, o) => {
      opts = o;
      return frames.promise;
    });
    h.request.mockResolvedValueOnce(reply([COMIC]));
    h.source.say(words(50));
    await advance(LECTURE_TIMING.tickMinMs);
    expect(h.session.snapshot()).toMatchObject({ drawing: true, sketching: "comic" });
    opts!.onSketch!({ id: "lv_1", panels: 4, drawn: 0, failed: 0, done: false });
    frames.resolve({ outcomes: [{ type: "sketch", ok: true, id: "lv_1", what: WHAT }], screensAdded: 0 });
    await advance(0);
    // the run is over (the frames are on the board): the panels are still coming
    expect(h.session.snapshot()).toMatchObject({ drawing: false, thinking: false, sketching: "comic", stats: { sketches: 1, lastWhat: WHAT } });
    // …and the lecture goes on: the next ask is not held up by them
    h.source.say(words(50, "v"));
    await advance(LECTURE_TIMING.tickMinMs);
    expect(h.request).toHaveBeenCalledTimes(2);
    opts!.onSketch!({ id: "lv_1", panels: 4, drawn: 3, failed: 0, done: false });
    expect(h.session.snapshot().sketching).toBe("comic");
    opts!.onSketch!({ id: "lv_1", panels: 4, drawn: 4, failed: 0, done: true });
    expect(h.session.snapshot()).toMatchObject({ sketching: null, notice: null });
  });

  it("panels that could not be drawn are said, until something new is drawn", async () => {
    const { h, opts } = await withIllustrator();
    opts.onSketch!({ id: "lv_1", panels: 4, drawn: 3, failed: 1, done: true });
    expect(h.session.snapshot().notice).toEqual({ kind: "sketch_failed", failed: 1, panels: 4 });
    h.run.mockResolvedValueOnce({ outcomes: [{ type: "heading", ok: true, what: "heading: The future" }], screensAdded: 1 });
    h.request.mockResolvedValueOnce(reply([{ type: "heading", text: "The future" }]));
    h.source.say(words(50, "u"));
    await advance(LECTURE_TIMING.tickMinMs);
    expect(h.session.snapshot().notice).toBeNull();
  });

  it("a panel that takes too long is a failure (its frame gets a note); the desk calling one off, or the lecture ending, is not", async () => {
    const { h, out, opts } = await withIllustrator();
    // the request never answers (nor heeds its abort): it is given up all the same
    const slow = opts.requestSketch!(PANEL, new AbortController().signal).catch((e: unknown) => e);
    await advance(SKETCH_TIMEOUT_MS);
    const err = (await slow) as Error;
    expect(out[0].signal.aborted).toBe(true);
    expect(err.message).toBe("The drawing took too long.");
    expect(err.name).not.toBe("AbortError");

    const desk = new AbortController();
    const calledOff = opts.requestSketch!(PANEL, desk.signal).catch((e: unknown) => e);
    await advance(0);
    desk.abort();
    expect(out[1].signal.aborted).toBe(true);
    expect(((await calledOff) as Error).name).toBe("AbortError");
    // an answer after that changes nothing
    out[1].d.resolve({ drawing: DRAWING, model: "m", ms: 1 });

    const failed = opts.requestSketch!(PANEL, new AbortController().signal).catch((e: unknown) => e);
    await advance(0);
    out[2].d.reject(new Error("upstream 502"));
    expect(((await failed) as Error).message).toBe("upstream 502");

    const ended = opts.requestSketch!(PANEL, new AbortController().signal).catch((e: unknown) => e);
    await advance(0);
    h.session.stop();
    expect(out[3].signal.aborted).toBe(true);
    expect(((await ended) as Error).name).toBe("AbortError");
    // after the lecture, nothing more is asked
    await expect(opts.requestSketch!(PANEL, new AbortController().signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(out).toHaveLength(4);
    expect(h.session.snapshot().sketching).toBeNull();
  });

  it("without the illustrator, a run is given no way to it (the board leaves a sketch out)", async () => {
    const h = await startSession();
    h.request.mockResolvedValueOnce(reply([COMIC]));
    h.source.say(words(50));
    await advance(LECTURE_TIMING.tickMinMs);
    const opts = h.run.mock.calls[0][1];
    expect(opts?.requestSketch).toBeUndefined();
    expect(opts?.onSketch).toBeInstanceOf(Function);
  });

  it("a request to see something waits for the speaker to finish describing it, then all of it is asked about at once", async () => {
    const h = await startSession();
    // the owner's comic, as the recognizer commits it: the request, then its panels, a pause or two apart
    h.source.say("I'm thinking about making a comic strip for a video game about a futuristic police officer, and I would kind of like to see that on the whiteboard.");
    await advance(REQUEST_QUIET_MS - 1);
    expect(h.request).not.toHaveBeenCalled();
    h.source.say("I want, like, four different panels, and I want each of them to feature the police officer and talk about his adversities…");
    await advance(2_000);
    h.source.hear("the first two, but then");
    await advance(REQUEST_QUIET_MS);
    // still talking: not yet
    expect(h.request).not.toHaveBeenCalled();
    h.source.say("the first two, but then the next two… the future…");
    await advance(REQUEST_QUIET_MS - 1);
    expect(h.request).not.toHaveBeenCalled();
    await advance(1);
    expect(h.request).toHaveBeenCalledTimes(1);
    expect(h.requests[0].req.fresh).toMatch(/^I'm thinking about making a comic strip.*four different panels.*the future…$/);
  });

  it("…but not for ever: at most REQUEST_MAX_WAIT_MS after the request, even while the speaker goes on", async () => {
    const h = await startSession();
    h.source.say("Can you draw a plant cell for me?");
    for (let t = 0; t < REQUEST_MAX_WAIT_MS - 2_000; t += 2_000) {
      await advance(2_000);
      h.source.say(`and ${words(3, `x${t}`)}`);
    }
    expect(h.request).not.toHaveBeenCalled();
    await advance(2_000);
    expect(h.request).toHaveBeenCalledTimes(1);
  });

  it("sketchKind: a comic (more than one panel), a picture, or none", () => {
    expect(sketchKind([HEADING, COMIC])).toBe("comic");
    expect(sketchKind([{ type: "sketch", panels: [{ prompt: "a plant cell" }] }])).toBe("picture");
    expect(sketchKind([HEADING, NOTE])).toBeNull();
  });
});

describe("LectureSession: a speaker who never pauses", () => {
  /** a director that records when it was asked */
  async function timedSession() {
    const h = await startSession();
    h.request.mockImplementation(async (req, signal) => {
      h.requests.push({ req, signal, at: Date.now() - T0 });
      return { actions: [], notes: [], model: "m", ms: 1 };
    });
    return h;
  }

  /** one long run-on segment, heard word by word (a partial every ~0.25 s, ~4 words a second), never committed */
  const RUN =
    "So a rep makes 100 dials in a day and about 30 of those connect and of those 30 only 10 turn into a real conversation and of those 10 conversations 3 book a meeting so 100 dials gets you 3 meetings";

  async function runOn(h: Awaited<ReturnType<typeof timedSession>>, text: string, msPerWord = 250): Promise<void> {
    const words = text.split(" ");
    for (let i = 1; i <= words.length; i++) {
      h.source.hear(words.slice(0, i).join(" "));
      await advance(msPerWord);
    }
  }

  it("takes the settled words of a run-on segment as heard, and asks about them without waiting for a pause", async () => {
    const h = await timedSession();
    await runOn(h, RUN);
    expect(h.requests.length).toBeGreaterThan(0);
    // the first numbers reach the director within a few seconds of being said, not at the end
    expect(h.requests[0].at!).toBeLessThan(RUN_ON.ms + 3_000);
    expect(h.requests[0].req.fresh).toContain("100 dials");
  });

  it("when the recognizer commits the segment, only the words not already taken are added", async () => {
    const h = await timedSession();
    await runOn(h, RUN);
    h.source.say(RUN);
    await advance(60_000);
    const heard = h.requests.map((r) => r.req.fresh).join(" ");
    // every word of the segment reaches the director once, in order
    expect(heard.replace(/\s+/g, " ").trim()).toBe(RUN);
    // the panel shows nothing twice
    expect(h.session.snapshot().stats.lines.join(" ").replace(/\s+/g, " ")).not.toMatch(/100 dials.*100 dials in a day/);
  });

  it("the words still being heard show only what has not been taken", async () => {
    const h = await timedSession();
    await runOn(h, RUN);
    const partial = h.session.snapshot().stats.partial;
    expect(RUN.startsWith(partial)).toBe(false);
    expect(partial.split(" ").length).toBeLessThan(RUN_ON.words + RUN_ON.holdBack + 1);
  });
});
