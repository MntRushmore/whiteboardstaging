import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";
import {
  LECTURE_LIMITS,
  LECTURE_TIMING,
  LectureRequestSchema,
  type LectureAction,
  type LectureRequest,
  type LectureResponse,
  type LectureRunReport,
  type LectureScreen,
  type SpeechCallbacks,
  type SpeechSource,
} from "../contracts";
import { FOLLOW_UP_GAP_MS, HEARTBEAT_MS, LectureSession, timingForSpeed, updatingKind, type LectureSessionDeps } from "../session";
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
  run: ReturnType<typeof vi.fn<(actions: readonly LectureAction[]) => Promise<LectureRunReport>>>;
  saved: string[];
  requests: Array<{ req: LectureRequest; signal: AbortSignal; at?: number }>;
  request: ReturnType<typeof vi.fn<(req: LectureRequest, signal: AbortSignal) => Promise<LectureResponse>>>;
}

async function startSession(over: Partial<LectureSessionDeps> = {}): Promise<Harness> {
  const source = new FakeSource();
  const screen: LectureScreen = { empty: true, topic: null, drawn: [], room: 1, active: [] };
  const saved: string[] = [];
  const requests: Harness["requests"] = [];
  const run = vi.fn(async (actions: readonly LectureAction[]): Promise<LectureRunReport> => ({
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
    expect(h.run).toHaveBeenCalledWith([{ type: "new_screen" }, HEADING, NOTE]);
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

  it("a sales story: asked the moment it starts, then every liveTickMinMs, each ask carrying what was said since the last", async () => {
    const h = await timedSession();
    await play(h, SALES.slice(0, 7), 29_000);
    expect(h.session.snapshot().pace).toBe("live"); // "eighteen million" heard, not asked about yet
    await advance(2_000);
    h.source.say(SALES[7][1]);
    await advance(14_000);
    const times = askTimes(h);
    expect(times).toEqual([1_000, 9_000, 17_000, 25_000, 33_000]);
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBe(LECTURE_TIMING.liveTickMinMs);
    expect(h.requests[0].req.fresh).toBe("Let's look at how our sales went this year.");
    // the ask due at 9 s goes at 9 s exactly, just before that second's sentence is committed
    expect(h.requests[1].req.fresh).toBe("In the first quarter we sold twelve million units.");
    expect(h.requests[2].req.fresh).toBe("The second quarter was up to fifteen million. That is a twenty five percent jump.");
    expect(h.requests[1].req.context).toBe("Let's look at how our sales went this year.");
    expect(h.requests[4].req.fresh).toBe("And the fourth quarter finished at eighteen million. Our best quarter ever.");
  });

  it("chatter without numbers or steps stays at the usual pace", async () => {
    const h = await timedSession();
    const chatter: Array<[number, string]> = Array.from({ length: 30 }, (_, i) => [(i + 1) * 4_000, `${words(12, "chat")} and so on`]);
    await play(h, chatter, 125_000);
    expect(askTimes(h)).toEqual([40_000, 80_000, 120_000]);
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
      4_000,
    );
    expect(asked).toEqual([1_000]);
    await advance(2_000); // settled at 4 s; the follow-up waits for the 5 s budget gap (1 + 5 = 6 s)
    expect(asked).toEqual([1_000, 1_000 + FOLLOW_UP_GAP_MS]);
    expect(FOLLOW_UP_GAP_MS).toBe(5_000);
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
    expect(askTimes(h)).toEqual([0, 8_000]);
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
