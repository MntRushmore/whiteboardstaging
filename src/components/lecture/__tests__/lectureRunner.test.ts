import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";
import { LECTURE_TIMING, type LectureRequest, type LectureResponse, type SketchRequest, type SketchResponse, type SpeechCallbacks, type SpeechSource } from "@/lib/live/lecture/contracts";
import type { LectureRunOptions } from "@/lib/live/lecture/desk";
import { createScriptSource } from "@/lib/live/lecture/speech/script";
import { LECTURE_OFF, LectureRunner, type LectureRunnerDeps } from "../lectureRunner";
import { LECTURE_CONSENT_KEY, type LectureControllerLike } from "../lectureView";

class MicSource implements SpeechSource {
  readonly kind = "elevenlabs" as const;
  cb: SpeechCallbacks | null = null;
  stopped = false;
  async start(cb: SpeechCallbacks) {
    this.cb = cb;
  }
  pause() {}
  resume() {}
  stop() {
    this.stopped = true;
  }
}

const controller = (): LectureControllerLike => ({
  lectureScreen: () => ({ empty: true, topic: null, drawn: [], room: 1, active: [] }),
  runLectureActions: vi.fn(async () => ({ outcomes: [], screensAdded: 0 })),
  saveLectureTranscript: vi.fn(),
});

function runner(over: Partial<LectureRunnerDeps> = {}) {
  const storage = new Map<string, string>();
  const mics: MicSource[] = [];
  const request = vi.fn<(req: LectureRequest, signal: AbortSignal) => Promise<LectureResponse>>(async () => ({ actions: [], notes: [], model: "m", ms: 1 }));
  const ctl = controller();
  const r = new LectureRunner({
    boardId: "board-1",
    controller: ctl,
    openSpeech: async () => {
      const m = new MicSource();
      mics.push(m);
      return m;
    },
    openScript: (lines, opts) => createScriptSource(lines, opts),
    request,
    storage: () => ({ getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => void storage.set(k, v) }),
    ...over,
  });
  return { r, storage, mics, request, ctl, status: () => r.coarse.get().status };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_790_000_000_000);
});
afterEach(() => vi.useRealTimers());

describe("LectureRunner: consent", () => {
  it("the first start on a device shows the note; confirming remembers it and starts", async () => {
    const h = runner();
    expect(h.r.coarse.get()).toEqual(LECTURE_OFF);
    h.r.start();
    expect(h.status()).toBe("consent");
    expect(h.mics).toHaveLength(0);
    h.r.confirmConsent();
    expect(h.storage.get(LECTURE_CONSENT_KEY)).toBe("1");
    expect(h.status()).toBe("starting");
    await vi.advanceTimersByTimeAsync(0);
    expect(h.status()).toBe("listening");
    expect(h.r.coarse.get().source).toBe("elevenlabs");
    expect(h.mics).toHaveLength(1);
  });

  it("cancel goes back to off; the next start asks again", () => {
    const h = runner();
    h.r.start();
    h.r.cancelConsent();
    expect(h.status()).toBe("off");
    h.r.start();
    expect(h.status()).toBe("consent");
  });

  it("with consent remembered, start goes straight to listening", async () => {
    const h = runner();
    h.storage.set(LECTURE_CONSENT_KEY, "1");
    h.r.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.status()).toBe("listening");
  });

  it("without storage, consent holds for the page's life", async () => {
    const h = runner({ storage: () => null });
    h.r.start();
    h.r.confirmConsent();
    await vi.advanceTimersByTimeAsync(0);
    h.r.stop();
    h.r.start();
    expect(h.status()).toBe("starting");
  });
});

describe("LectureRunner: running", () => {
  it("start while running does nothing; stop ends it (the source stopped, the live view cleared)", async () => {
    const h = runner();
    h.storage.set(LECTURE_CONSENT_KEY, "1");
    h.r.start();
    await vi.advanceTimersByTimeAsync(0);
    h.r.start();
    expect(h.mics).toHaveLength(1);
    expect(h.r.live.get()?.snapshot.status).toBe("listening");
    h.r.stop();
    expect(h.status()).toBe("off");
    expect(h.mics[0].stopped).toBe(true);
    expect(h.r.live.get()).toBeNull();
  });

  it("pause and resume pass through", async () => {
    const h = runner();
    h.storage.set(LECTURE_CONSENT_KEY, "1");
    h.r.start();
    await vi.advanceTimersByTimeAsync(0);
    h.r.pause();
    expect(h.status()).toBe("paused");
    h.r.resume();
    expect(h.status()).toBe("listening");
  });

  it("the state store changes only when the state does; the live store at every word", async () => {
    const h = runner();
    h.storage.set(LECTURE_CONSENT_KEY, "1");
    const coarse = vi.fn();
    const live = vi.fn();
    h.r.coarse.subscribe(coarse);
    h.r.live.subscribe(live);
    h.r.start();
    await vi.advanceTimersByTimeAsync(0);
    const coarseCalls = coarse.mock.calls.length;
    for (let i = 0; i < 10; i++) h.mics[0].cb?.onPartial(`word ${i}`);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(coarse.mock.calls.length).toBe(coarseCalls);
    expect(live.mock.calls.length).toBeGreaterThan(10);
    expect(h.r.live.get()?.snapshot.stats.partial).toBe("word 9");
  });

  it("the board without lecture methods is an error, with nothing opened", () => {
    const h = runner({ controller: {} });
    h.storage.set(LECTURE_CONSENT_KEY, "1");
    h.r.start();
    expect(h.r.coarse.get()).toEqual({ status: "error", error: "board", source: null });
    expect(h.mics).toHaveLength(0);
    // Try again from the error state
    h.r.start();
    expect(h.status()).toBe("error");
  });

  it("a failure to start is an error with its code; Try again starts afresh", async () => {
    let fail = true;
    const h = runner({
      openSpeech: async () => {
        if (fail) throw new ApiError("x", 402, "ink_empty");
        return new MicSource();
      },
    });
    h.storage.set(LECTURE_CONSENT_KEY, "1");
    h.r.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.r.coarse.get()).toMatchObject({ status: "error", error: "ink" });
    fail = false;
    h.r.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.status()).toBe("listening");
  });

  it("keeps the screen on while starting and listening, lets it sleep when paused, stopped or failed", async () => {
    const calls: string[] = [];
    const wakeLock = { hold: () => calls.push("hold"), release: () => calls.push("release") };
    let fail = false;
    const h = runner({
      wakeLock,
      openSpeech: async () => {
        if (fail) throw new ApiError("x", 402, "ink_empty");
        return new MicSource();
      },
    });
    h.storage.set(LECTURE_CONSENT_KEY, "1");
    h.r.start();
    expect(calls).toEqual(["hold"]); // starting: in the tap that started it
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.at(-1)).toBe("hold"); // listening
    h.r.pause();
    expect(calls.at(-1)).toBe("release");
    h.r.resume();
    expect(calls.at(-1)).toBe("hold");
    h.r.stop();
    expect(calls.at(-1)).toBe("release");
    fail = true;
    h.r.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.status()).toBe("error");
    expect(calls.at(-1)).toBe("release");
  });

  it("dispose ends the lecture", async () => {
    const h = runner();
    h.storage.set(LECTURE_CONSENT_KEY, "1");
    h.r.start();
    await vi.advanceTimersByTimeAsync(0);
    h.r.dispose();
    expect(h.status()).toBe("off");
    expect(h.mics[0].stopped).toBe(true);
  });
});

describe("LectureRunner: the scripted demo", () => {
  /** letters only: no digits, so the words are not salient */
  const words = (n: number) => Array.from({ length: n }, (_, i) => `w${String.fromCharCode(97 + (i % 26))}`).join(" ");

  it("plays without consent or microphone, and asks the director at the script's pace", async () => {
    const h = runner();
    h.r.startScripted(
      [
        { atMs: 1_000, text: words(30) },
        { atMs: 8_000, text: words(30) },
      ],
      { speed: 4 },
    );
    expect(h.status()).toBe("starting");
    await vi.advanceTimersByTimeAsync(0);
    expect(h.r.coarse.get()).toMatchObject({ status: "listening", source: "script" });
    expect(h.mics).toHaveLength(0);
    expect(h.storage.has(LECTURE_CONSENT_KEY)).toBe(false);
    // the usual interval is scaled too: tickMinMs / 4 of wall time from the start
    await vi.advanceTimersByTimeAsync(LECTURE_TIMING.tickMinMs / 4 - 1);
    expect(h.request).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(h.request).toHaveBeenCalledTimes(1);
    // 8 s of script at 4× = 2 s: both lines heard and saved
    await vi.advanceTimersByTimeAsync(2_000);
    expect(h.ctl.saveLectureTranscript).toHaveBeenCalledTimes(2);
    expect(h.request.mock.calls[0][0]).toMatchObject({ boardId: "board-1", force: false });
    expect(h.request.mock.calls[0][0].session).toMatch(/^[A-Za-z0-9_-]{8,40}$/);
  });

  it("a scripted sales story is asked about as soon as it is heard, then at the live pace, scaled too", async () => {
    const h = runner();
    h.r.startScripted(
      [
        { atMs: 4_000, text: "Sales in the first quarter were twelve million." },
        { atMs: 6_000, text: "The second quarter was up to fifteen million." },
      ],
      { speed: 4 },
    );
    await vi.advanceTimersByTimeAsync(999);
    expect(h.request).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); // 4 s of script at 4×: the first sentence, asked at once
    expect(h.request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(LECTURE_TIMING.liveTickMinMs / 4 - 1); // the next is heard at 1.5 s, due at 3 s
    expect(h.request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.request).toHaveBeenCalledTimes(2);
  });

  it("a request to draw is asked about at once; the sketch's panels go to the illustrator through the session, with the board and the session", async () => {
    const drawing = { w: 1000 as const, h: 800, strokes: [{ points: [[0, 0], [5, 5]] as Array<[number, number]>, closed: false, fill: false }], labels: [] };
    const requestSketch = vi.fn<(req: SketchRequest, signal: AbortSignal) => Promise<SketchResponse>>(async () => ({ drawing, model: "m", ms: 1 }));
    const h = runner({ requestSketch });
    h.request.mockResolvedValueOnce({ actions: [{ type: "sketch", panels: [{ prompt: "a plant cell" }] }], notes: [], model: "m", ms: 1 });
    h.r.startScripted([{ atMs: 4_000, text: "Can you draw a plant cell for me?" }], { speed: 4 });
    await vi.advanceTimersByTimeAsync(1_000 - 1);
    expect(h.request).not.toHaveBeenCalled(); // 4 s of script at 4×: not heard yet
    await vi.advanceTimersByTimeAsync(1);
    expect(h.request).toHaveBeenCalledTimes(1); // heard, and asked about at once
    const run = h.ctl.runLectureActions as ReturnType<typeof vi.fn>;
    expect(run).toHaveBeenCalledTimes(1);
    const opts = run.mock.calls[0][1] as LectureRunOptions;
    await expect(opts.requestSketch!({ prompt: "a plant cell", aspect: 1.2 }, new AbortController().signal)).resolves.toEqual(drawing);
    expect(requestSketch.mock.calls[0][0]).toEqual({ prompt: "a plant cell", aspect: 1.2, boardId: "board-1", session: h.request.mock.calls[0][0].session });
  });
});

describe("LectureRunner: the controller", () => {
  it("a running session reaches the newest controller", async () => {
    const h = runner();
    h.storage.set(LECTURE_CONSENT_KEY, "1");
    h.r.start();
    await vi.advanceTimersByTimeAsync(0);
    const next = controller();
    h.r.setController(next);
    h.mics[0].cb?.onFinal({ text: "Heard after the swap.", atMs: 10 });
    expect(next.saveLectureTranscript).toHaveBeenCalledWith("Heard after the swap.");
    expect(h.ctl.saveLectureTranscript).not.toHaveBeenCalled();
  });
});
