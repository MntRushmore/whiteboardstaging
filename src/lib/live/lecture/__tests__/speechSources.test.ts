import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";
import { LISTEN_NOT_CONFIGURED, type ListenTokenResponse, type SpeechCallbacks, type SpeechState, type TranscriptSegment } from "../contracts";
import { BrowserSpeechSource, MAX_QUICK_ENDS, QUICK_END_MS, type RecognitionLike, type RecognitionResultEventLike } from "../speech/browser";
import { BACKLOG_MS, CONNECT_TIMEOUT_MS, ElevenLabsSource, HEALTHY_SESSION_MS, MAX_RECONNECT_ATTEMPTS, reconnectDelayMs, type MicCapture, type ScribeSocket } from "../speech/elevenlabs";
import { micErrorCode, SpeechError, speechErrorCodeFor } from "../speech/errors";
import { createSpeechSource } from "../speech/index";
import { createScriptSource, SCRIPT_PARTIAL_GAP_MS, scriptEvents } from "../speech/script";
import { SCRIBE } from "../speech/scribe";

// ------------------------------------------------------------------ helpers

function recorder() {
  const partials: string[] = [];
  const finals: TranscriptSegment[] = [];
  const states: Array<[SpeechState, string | undefined]> = [];
  const cb: SpeechCallbacks = {
    onPartial: (t) => partials.push(t),
    onFinal: (s) => finals.push(s),
    onState: (s, d) => states.push([s, d]),
  };
  return { cb, partials, finals, states, texts: () => finals.map((f) => f.text), last: () => states.at(-1)?.[0] };
}

class FakeSocket implements ScribeSocket {
  readyState = 0;
  sent: Array<Record<string, unknown>> = [];
  closed = false;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor(readonly url: string) {}
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.closed = true;
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  say(msg: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  drop() {
    this.readyState = 3;
    this.onclose?.({ code: 1006, reason: "" });
  }
}

class FakeMic implements MicCapture {
  onChunk: ((pcm: Int16Array) => void) | null = null;
  stopped = false;
  stop() {
    this.stopped = true;
  }
  chunk(n = 4000) {
    this.onChunk?.(new Int16Array(n).fill(7));
  }
}

const token = (i: number, expiresAt = Date.now() + 14 * 60_000): ListenTokenResponse => ({ provider: "elevenlabs", token: `t${i}`, url: `wss://example.test/rt?token=t${i}`, expiresAt });

function elevenlabs(opts: { first?: ListenTokenResponse | null; tokens?: Array<ListenTokenResponse | Error> } = {}) {
  const sockets: FakeSocket[] = [];
  const mics: FakeMic[] = [];
  let n = 0;
  const queue = [...(opts.tokens ?? [])];
  const requestToken = vi.fn(async () => {
    const next = queue.shift();
    if (next instanceof Error) throw next;
    return next ?? token(100 + n++);
  });
  const source = new ElevenLabsSource({
    requestToken,
    firstToken: opts.first === null ? undefined : (opts.first ?? token(0)),
    openSocket: (url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    },
    openMic: async () => {
      const m = new FakeMic();
      mics.push(m);
      return m;
    },
  });
  return { source, sockets, mics, requestToken, socket: () => sockets.at(-1)!, mic: () => mics.at(-1)! };
}

/** start() resolves once the socket opens: open it as soon as it exists. */
async function started(e: ReturnType<typeof elevenlabs>, rec: ReturnType<typeof recorder>) {
  const p = e.source.start(rec.cb);
  await vi.advanceTimersByTimeAsync(0);
  e.socket().open();
  await p;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_790_000_000_000);
});
afterEach(() => vi.useRealTimers());

// ------------------------------------------------------------------ ElevenLabs

describe("ElevenLabs source", () => {
  it("opens the microphone and the session with the token in hand; audio goes out as base64 chunks", async () => {
    const e = elevenlabs();
    const rec = recorder();
    await started(e, rec);
    expect(e.requestToken).not.toHaveBeenCalled();
    expect(e.socket().url).toBe("wss://example.test/rt?token=t0");
    expect(rec.states.map((s) => s[0])).toEqual(["connecting", "listening"]);
    e.mic().chunk(4000);
    const sent = e.socket().sent[0];
    expect(sent).toMatchObject({ message_type: "input_audio_chunk", commit: false, sample_rate: 16000 });
    expect(Buffer.from(sent.audio_base_64 as string, "base64")).toHaveLength(8000);
    expect(sent).not.toHaveProperty("previous_text"); // nothing heard before this session
  });

  it("partials and finals, with atMs since the start", async () => {
    const e = elevenlabs();
    const rec = recorder();
    await started(e, rec);
    await vi.advanceTimersByTimeAsync(2_500);
    e.socket().say({ message_type: "session_started", session_id: "s" });
    e.socket().say({ message_type: "partial_transcript", text: "light is" });
    e.socket().say({ message_type: "partial_transcript", text: "light is" }); // unchanged: not repeated
    e.socket().say({ message_type: "partial_transcript", text: "light is absorbed" });
    e.socket().say({ message_type: "committed_transcript", text: " Light is  absorbed. " });
    e.socket().say({ message_type: "committed_transcript", text: "   " }); // empty: nothing
    expect(rec.partials).toEqual(["light is", "light is absorbed"]);
    expect(rec.finals).toEqual([{ text: "Light is absorbed.", atMs: 2_500 }]);
  });

  it("a session that ends is replaced by a new one with a fresh token; the words being heard are kept", async () => {
    const e = elevenlabs();
    const rec = recorder();
    await started(e, rec);
    e.socket().say({ message_type: "committed_transcript", text: "The Krebs cycle has eight steps." });
    e.socket().say({ message_type: "partial_transcript", text: "it starts with" });
    await vi.advanceTimersByTimeAsync(HEALTHY_SESSION_MS);
    e.socket().say({ message_type: "session_time_limit_exceeded", error: "time" });
    expect(rec.texts()).toEqual(["The Krebs cycle has eight steps.", "it starts with"]);
    expect(rec.last()).toBe("reconnecting");
    expect(e.sockets[0].closed).toBe(true);
    // audio heard meanwhile is kept for the new session
    e.mic().chunk();
    e.mic().chunk();
    await vi.advanceTimersByTimeAsync(reconnectDelayMs(1));
    expect(e.requestToken).toHaveBeenCalledTimes(1);
    expect(e.sockets).toHaveLength(2);
    e.socket().open();
    expect(rec.last()).toBe("listening");
    const sent = e.socket().sent;
    expect(sent).toHaveLength(2);
    // the new session gets the last words as context, on its first chunk only
    expect(String(sent[0].previous_text)).toMatch(/it starts with$/);
    expect((sent[0].previous_text as string).length).toBeLessThanOrEqual(50);
    expect(sent[1]).not.toHaveProperty("previous_text");
  });

  it("keeps at most BACKLOG_MS of audio while reconnecting", async () => {
    const e = elevenlabs();
    const rec = recorder();
    await started(e, rec);
    e.socket().drop();
    for (let i = 0; i < 40; i++) e.mic().chunk();
    await vi.advanceTimersByTimeAsync(0);
    e.socket().open();
    expect(e.socket().sent).toHaveLength(BACKLOG_MS / SCRIBE.chunkMs);
  });

  it("backs off while sessions keep failing, and gives up after MAX_RECONNECT_ATTEMPTS", async () => {
    const e = elevenlabs({ tokens: Array.from({ length: 20 }, () => new TypeError("Failed to fetch")) });
    const rec = recorder();
    await started(e, rec);
    e.socket().drop();
    for (let i = 1; i <= MAX_RECONNECT_ATTEMPTS; i++) await vi.advanceTimersByTimeAsync(reconnectDelayMs(i));
    expect(e.requestToken).toHaveBeenCalledTimes(MAX_RECONNECT_ATTEMPTS);
    expect(rec.states.at(-1)).toEqual(["error", "network"]);
    expect(e.mic().stopped).toBe(true);
    expect(reconnectDelayMs(1)).toBe(0);
    expect(reconnectDelayMs(2)).toBe(500);
    expect(reconnectDelayMs(20)).toBe(15_000);
  });

  it("sessions that end as soon as they open do not reset the count (no token a second)", async () => {
    const e = elevenlabs();
    const rec = recorder();
    await started(e, rec);
    for (let i = 0; i < MAX_RECONNECT_ATTEMPTS + 1; i++) {
      e.socket().say({ message_type: "session_time_limit_exceeded", error: "x" });
      await vi.advanceTimersByTimeAsync(15_000);
      if (rec.last() === "error") break;
      e.socket().open();
    }
    expect(rec.last()).toBe("error");
    expect(e.requestToken.mock.calls.length).toBeLessThanOrEqual(MAX_RECONNECT_ATTEMPTS);
  });

  it("a socket that never opens counts as a failed attempt", async () => {
    const e = elevenlabs();
    const rec = recorder();
    await started(e, rec);
    e.socket().drop();
    await vi.advanceTimersByTimeAsync(0);
    expect(e.sockets).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS);
    expect(e.sockets[1].closed).toBe(true);
    await vi.advanceTimersByTimeAsync(reconnectDelayMs(2));
    expect(e.sockets).toHaveLength(3);
  });

  it("the token route's 402 while reconnecting ends it: out of ink", async () => {
    const e = elevenlabs({ tokens: [new ApiError("x", 402, "ink_empty")] });
    const rec = recorder();
    await started(e, rec);
    e.socket().drop();
    await vi.advanceTimersByTimeAsync(0);
    expect(rec.states.at(-1)).toEqual(["error", "ink"]);
  });

  it("a 429 from the token route waits its retry-after", async () => {
    const e = elevenlabs({ tokens: [new ApiError("x", 429, "rate_limited", undefined, 20_000)] });
    const rec = recorder();
    await started(e, rec);
    e.socket().drop();
    await vi.advanceTimersByTimeAsync(0);
    expect(e.requestToken).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(19_999);
    expect(e.requestToken).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(e.requestToken).toHaveBeenCalledTimes(2);
  });

  it("a fatal recognizer error ends it", async () => {
    const e = elevenlabs();
    const rec = recorder();
    await started(e, rec);
    e.socket().say({ message_type: "auth_error", error: "bad" });
    expect(rec.states.at(-1)).toEqual(["error", "recognizer"]);
    expect(e.mic().stopped).toBe(true);
  });

  it("pause lets go of the microphone and the session; resume opens both with a fresh token", async () => {
    const e = elevenlabs();
    const rec = recorder();
    await started(e, rec);
    e.socket().say({ message_type: "partial_transcript", text: "half a sentence" });
    e.source.pause();
    expect(rec.texts()).toEqual(["half a sentence"]);
    expect(rec.last()).toBe("paused");
    expect(e.mics[0].stopped).toBe(true);
    expect(e.sockets[0].closed).toBe(true);
    e.mics[0].chunk(); // nothing is sent while paused
    expect(e.sockets[0].sent).toHaveLength(0);
    e.source.resume();
    await vi.advanceTimersByTimeAsync(0);
    expect(e.requestToken).toHaveBeenCalledTimes(1);
    expect(e.mics).toHaveLength(2);
    e.socket().open();
    expect(rec.last()).toBe("listening");
    e.mic().chunk();
    expect(e.socket().sent).toHaveLength(1);
  });

  it("an expired first token is not used", async () => {
    const e = elevenlabs({ first: token(0, Date.now() - 1) });
    const rec = recorder();
    await started(e, rec);
    expect(e.requestToken).toHaveBeenCalledTimes(1);
    expect(e.socket().url).toContain("t100");
  });

  it("stop tears everything down, keeps what was being heard, and goes quiet", async () => {
    const e = elevenlabs();
    const rec = recorder();
    await started(e, rec);
    const sock = e.socket();
    sock.say({ message_type: "partial_transcript", text: "last words" });
    e.source.stop();
    expect(rec.texts()).toEqual(["last words"]);
    expect(rec.last()).toBe("idle");
    expect(sock.closed).toBe(true);
    expect(e.mic().stopped).toBe(true);
    const before = rec.states.length;
    sock.say({ message_type: "committed_transcript", text: "late" });
    sock.drop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(rec.states.length).toBe(before);
    expect(rec.texts()).toEqual(["last words"]);
  });

  it("a refused microphone fails the start with mic-denied", async () => {
    const source = new ElevenLabsSource({
      requestToken: vi.fn(),
      firstToken: token(0),
      openSocket: () => new FakeSocket("x"),
      openMic: async () => {
        throw new SpeechError("mic-denied");
      },
    });
    const rec = recorder();
    await expect(source.start(rec.cb)).rejects.toMatchObject({ code: "mic-denied" });
    expect(rec.states.at(-1)).toEqual(["error", "mic-denied"]);
  });
});

// ------------------------------------------------------------------ the browser's recognizer

class FakeRecognition implements RecognitionLike {
  static all: FakeRecognition[] = [];
  continuous = false;
  interimResults = false;
  lang = "";
  maxAlternatives = 0;
  onstart: ((ev: unknown) => void) | null = null;
  onresult: ((ev: RecognitionResultEventLike) => void) | null = null;
  onerror: ((ev: { error: string }) => void) | null = null;
  onend: ((ev: unknown) => void) | null = null;
  starts = 0;
  aborted = 0;
  results: Array<{ isFinal: boolean; length: number; 0: { transcript: string } }> = [];
  constructor() {
    FakeRecognition.all.push(this);
  }
  start() {
    this.starts++;
    this.results = [];
  }
  stop() {}
  abort() {
    this.aborted++;
  }
  began() {
    this.onstart?.({});
  }
  result(text: string, isFinal: boolean) {
    const last = this.results.at(-1);
    const r = { isFinal, length: 1, 0: { transcript: text } };
    let index = this.results.length;
    if (last && !last.isFinal) {
      index = this.results.length - 1;
      this.results[index] = r;
    } else this.results.push(r);
    this.onresult?.({ resultIndex: index, results: this.results });
  }
  ended() {
    this.onend?.({});
  }
}

function browserSource() {
  FakeRecognition.all = [];
  const source = new BrowserSpeechSource({ Recognition: FakeRecognition, lang: "en-GB" });
  return { source, rec: () => FakeRecognition.all[0] };
}

describe("browser source", () => {
  it("continuous with interim results, in the given language; resolves once it has started", async () => {
    const b = browserSource();
    const rec = recorder();
    const p = b.source.start(rec.cb);
    const r = b.rec();
    expect(r).toMatchObject({ continuous: true, interimResults: true, lang: "en-GB" });
    r.began();
    await p;
    expect(rec.last()).toBe("listening");
  });

  it("interim results are partials; a final is sent once", async () => {
    const b = browserSource();
    const rec = recorder();
    const p = b.source.start(rec.cb);
    b.rec().began();
    await p;
    await vi.advanceTimersByTimeAsync(3_000);
    b.rec().result("the water", false);
    b.rec().result("the water cycle", false);
    b.rec().result("The water cycle.", true);
    // a later event that repeats the final result does not repeat it
    b.rec().onresult?.({ resultIndex: 0, results: b.rec().results });
    // a final clears the partial by itself (SpeechCallbacks): no empty partial is sent
    expect(rec.partials).toEqual(["the water", "the water cycle"]);
    expect(rec.finals).toEqual([{ text: "The water cycle.", atMs: 3_000 }]);
  });

  it("starts again when it ends by itself; backs off when it keeps ending at once, then gives up", async () => {
    const b = browserSource();
    const rec = recorder();
    const p = b.source.start(rec.cb);
    b.rec().began();
    await p;
    await vi.advanceTimersByTimeAsync(QUICK_END_MS + 10);
    b.rec().ended(); // a long run ending: straight back
    expect(rec.last()).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(0);
    expect(b.rec().starts).toBe(2);
    b.rec().began();
    expect(rec.last()).toBe("listening");
    for (let i = 0; i <= MAX_QUICK_ENDS; i++) {
      b.rec().ended();
      await vi.advanceTimersByTimeAsync(5_000);
      b.rec().began();
    }
    expect(rec.states.at(-1)).toEqual(["error", "network"]);
  });

  it("a refused microphone is fatal (and fails the start)", async () => {
    const b = browserSource();
    const rec = recorder();
    const p = b.source.start(rec.cb);
    b.rec().onerror?.({ error: "not-allowed" });
    await expect(p).rejects.toMatchObject({ code: "mic-denied" });
    expect(rec.states.at(-1)).toEqual(["error", "mic-denied"]);
    b.rec().ended();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(b.rec().starts).toBe(1);
  });

  it("a recognizer whose service is off (Safari: Dictation off) is fatal as speech-off, not 'unsupported'", async () => {
    const b = browserSource();
    const rec = recorder();
    const p = b.source.start(rec.cb);
    b.rec().onerror?.({ error: "service-not-allowed" });
    await expect(p).rejects.toMatchObject({ code: "speech-off" });
    expect(rec.states.at(-1)).toEqual(["error", "speech-off"]);
    // Safari sends no end after it: nothing is started again either way
    await vi.advanceTimersByTimeAsync(10_000);
    expect(b.rec().starts).toBe(1);
  });

  it("no-speech is not an error: it starts again", async () => {
    const b = browserSource();
    const rec = recorder();
    const p = b.source.start(rec.cb);
    b.rec().began();
    await p;
    b.rec().onerror?.({ error: "no-speech" });
    await vi.advanceTimersByTimeAsync(QUICK_END_MS);
    b.rec().ended();
    await vi.advanceTimersByTimeAsync(0);
    expect(b.rec().starts).toBe(2);
  });

  it("pause keeps what was being heard and does not start again; resume does; stop goes quiet", async () => {
    const b = browserSource();
    const rec = recorder();
    const p = b.source.start(rec.cb);
    b.rec().began();
    await p;
    b.rec().result("half a", false);
    b.source.pause();
    expect(rec.texts()).toEqual(["half a"]);
    expect(b.rec().aborted).toBe(1);
    b.rec().ended();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(b.rec().starts).toBe(1);
    b.source.resume();
    expect(b.rec().starts).toBe(2);
    b.rec().began();
    expect(rec.last()).toBe("listening");
    b.rec().result("more", false);
    b.source.stop();
    expect(rec.texts()).toEqual(["half a", "more"]);
    expect(rec.last()).toBe("idle");
  });
});

// ------------------------------------------------------------------ the script

describe("script source", () => {
  it("events: growing partials, then the final at its time", () => {
    const ev = scriptEvents([{ atMs: 5_000, text: "Supply meets demand here" }]);
    expect(ev).toEqual([
      { t: 5_000 - 3 * SCRIPT_PARTIAL_GAP_MS, kind: "partial", text: "Supply" },
      { t: 5_000 - 2 * SCRIPT_PARTIAL_GAP_MS, kind: "partial", text: "Supply meets" },
      { t: 5_000 - SCRIPT_PARTIAL_GAP_MS, kind: "partial", text: "Supply meets demand" },
      { t: 5_000, kind: "final", text: "Supply meets demand here" },
    ]);
    // lines are sorted, blanks dropped, partials never before the previous final
    const two = scriptEvents([{ atMs: 1_000, text: "b c" }, { atMs: 0, text: "a" }, { atMs: 500, text: " " }]);
    expect(two.map((e) => `${e.kind}:${e.text}@${e.t}`)).toEqual(["final:a@0", "partial:b@600", "final:b c@1000"]);
  });

  it("plays the lines on time, faster with speed, finals in script time", async () => {
    const src = createScriptSource(
      [
        { atMs: 2_000, text: "one two three" },
        { atMs: 6_000, text: "four five" },
      ],
      { speed: 2 },
    );
    const rec = recorder();
    await src.start(rec.cb);
    expect(rec.last()).toBe("listening");
    await vi.advanceTimersByTimeAsync(999);
    expect(rec.finals).toEqual([]);
    expect(rec.partials.length).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(rec.finals).toEqual([{ text: "one two three", atMs: 2_000 }]);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(rec.finals.map((f) => f.atMs)).toEqual([2_000, 6_000]);
  });

  it("pause holds the script's clock; resume carries on", async () => {
    const src = createScriptSource([{ atMs: 4_000, text: "held" }]);
    const rec = recorder();
    await src.start(rec.cb);
    await vi.advanceTimersByTimeAsync(3_000);
    src.pause();
    expect(rec.last()).toBe("paused");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(rec.finals).toEqual([]);
    src.resume();
    await vi.advanceTimersByTimeAsync(999);
    expect(rec.finals).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(rec.finals).toEqual([{ text: "held", atMs: 4_000 }]);
    src.stop();
    expect(rec.last()).toBe("idle");
  });
});

// ------------------------------------------------------------------ choosing a source

describe("createSpeechSource", () => {
  const Recognition = FakeRecognition;
  const granted = async () => "granted" as const;

  it("ElevenLabs when the token route hands out a token", async () => {
    const requestToken = vi.fn(async () => token(1));
    const src = await createSpeechSource({ requestToken, env: { canStream: true, Recognition }, micPermission: granted });
    expect(src.kind).toBe("elevenlabs");
    expect(requestToken).toHaveBeenCalledTimes(1);
  });

  it("the browser's recognizer when the route has no key", async () => {
    const requestToken = vi.fn(async () => {
      throw new ApiError("not set up", 503, LISTEN_NOT_CONFIGURED);
    });
    const src = await createSpeechSource({ requestToken, env: { canStream: true, Recognition }, micPermission: granted });
    expect(src.kind).toBe("browser");
  });

  it("the browser's recognizer, without asking for a token, when this browser cannot stream audio", async () => {
    const requestToken = vi.fn();
    const src = await createSpeechSource({ requestToken, env: { canStream: false, Recognition }, micPermission: granted });
    expect(src.kind).toBe("browser");
    expect(requestToken).not.toHaveBeenCalled();
  });

  it("neither: unsupported (the panel says which browsers work)", async () => {
    const notConfigured = async () => {
      throw new ApiError("not set up", 503, LISTEN_NOT_CONFIGURED);
    };
    await expect(createSpeechSource({ requestToken: notConfigured, env: { canStream: true, Recognition: null }, micPermission: granted })).rejects.toMatchObject({ code: "unsupported" });
    await expect(createSpeechSource({ requestToken: vi.fn(), env: { canStream: false, Recognition: null } })).rejects.toBeInstanceOf(SpeechError);
  });

  it("a microphone refused before: no token is spent", async () => {
    const requestToken = vi.fn();
    await expect(createSpeechSource({ requestToken, env: { canStream: true, Recognition }, micPermission: async () => "denied" })).rejects.toMatchObject({ code: "mic-denied" });
    expect(requestToken).not.toHaveBeenCalled();
  });

  it("any other failure of the token route is thrown as it is", async () => {
    const err = new ApiError("x", 402, "ink_empty");
    await expect(
      createSpeechSource({
        requestToken: async () => {
          throw err;
        },
        env: { canStream: true, Recognition },
        micPermission: granted,
      }),
    ).rejects.toBe(err);
  });
});

describe("speech error codes", () => {
  it("maps failures to what the panel can explain", () => {
    expect(speechErrorCodeFor(new SpeechError("mic-missing"))).toBe("mic-missing");
    expect(speechErrorCodeFor(new ApiError("x", 402, "ink_empty"))).toBe("ink");
    expect(speechErrorCodeFor(new ApiError("x", 401, "unauthorized"))).toBe("unauthorized");
    expect(speechErrorCodeFor(new ApiError("x", 502, "upstream_error"))).toBe("network");
    expect(speechErrorCodeFor(new TypeError("Failed to fetch"))).toBe("network");
    expect(speechErrorCodeFor(new Error("?"))).toBe("recognizer");
    expect(micErrorCode({ name: "NotAllowedError" })).toBe("mic-denied");
    expect(micErrorCode({ name: "NotFoundError" })).toBe("mic-missing");
    expect(micErrorCode({ name: "NotReadableError" })).toBe("mic-missing");
    expect(micErrorCode(new Error("?"))).toBe("unsupported");
  });
});
