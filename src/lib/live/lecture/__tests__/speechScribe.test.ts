import { describe, expect, it } from "vitest";
import {
  bytesToBase64,
  parseScribeMessage,
  PCM_WORKLET_NAME,
  PCM_WORKLET_SOURCE,
  pcm16leBytes,
  PcmDownsampler,
  SCRIBE,
  SCRIBE_CHUNK_SAMPLES,
  scribeAudioMessage,
  scribeSocketUrl,
} from "../speech/scribe";

describe("Scribe: the session's socket URL", () => {
  it("carries the token and the session's settings", () => {
    const url = new URL(scribeSocketUrl("tok_1"));
    expect(`${url.protocol}//${url.host}${url.pathname}`).toBe("wss://api.elevenlabs.io/v1/speech-to-text/realtime");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      model_id: "scribe_v2_realtime",
      audio_format: "pcm_16000",
      commit_strategy: "vad",
      vad_silence_threshold_secs: "0.5",
      token: "tok_1",
    });
  });

  it("names a language only when asked (otherwise the model detects it)", () => {
    expect(new URL(scribeSocketUrl("t", { languageCode: "fr" })).searchParams.get("language_code")).toBe("fr");
    expect(new URL(scribeSocketUrl("t")).searchParams.has("language_code")).toBe(false);
  });

  it("escapes a token with URL characters", () => {
    expect(new URL(scribeSocketUrl("a+b/c=")).searchParams.get("token")).toBe("a+b/c=");
  });
});

describe("Scribe: messages", () => {
  it("an audio chunk, with previous_text (at most 50 characters) only when given", () => {
    expect(JSON.parse(scribeAudioMessage("AAAA"))).toEqual({ message_type: "input_audio_chunk", audio_base_64: "AAAA", commit: false, sample_rate: 16000 });
    const withPrev = JSON.parse(scribeAudioMessage("AAAA", { previousText: `${"x".repeat(80)} the end` }));
    expect(withPrev.previous_text).toHaveLength(50);
    expect(withPrev.previous_text.endsWith("the end")).toBe(true);
    expect(JSON.parse(scribeAudioMessage("AAAA", { previousText: "   " }))).not.toHaveProperty("previous_text");
  });

  it("parses what the socket says", () => {
    expect(parseScribeMessage(JSON.stringify({ message_type: "session_started", session_id: "s1", config: {} }))).toEqual({ kind: "started", sessionId: "s1" });
    expect(parseScribeMessage(JSON.stringify({ message_type: "partial_transcript", text: "light is" }))).toEqual({ kind: "partial", text: "light is" });
    expect(parseScribeMessage(JSON.stringify({ message_type: "committed_transcript", text: "Light is absorbed." }))).toEqual({ kind: "committed", text: "Light is absorbed." });
    expect(parseScribeMessage({ message_type: "committed_transcript_with_timestamps", text: "x", words: [] })).toEqual({ kind: "other", type: "committed_transcript_with_timestamps" });
    expect(parseScribeMessage("not json")).toEqual({ kind: "other", type: "invalid_json" });
    expect(parseScribeMessage(null)).toEqual({ kind: "other", type: "invalid" });
    expect(parseScribeMessage({ message_type: "something_new" })).toEqual({ kind: "other", type: "something_new" });
  });

  it("errors: the key, the quota and a bad request are fatal; a time limit or a hiccup is not", () => {
    expect(parseScribeMessage({ message_type: "auth_error", error: "bad token" })).toEqual({ kind: "error", code: "auth_error", message: "bad token", fatal: true });
    expect(parseScribeMessage({ message_type: "quota_exceeded", error: "q" })).toMatchObject({ kind: "error", fatal: true });
    expect(parseScribeMessage({ message_type: "input_error", error: "e" })).toMatchObject({ kind: "error", fatal: true });
    for (const code of ["session_time_limit_exceeded", "rate_limited", "queue_overflow", "resource_exhausted", "transcriber_error", "insufficient_audio_activity", "commit_throttled"]) {
      expect(parseScribeMessage({ message_type: code, error: "x" }), code).toMatchObject({ kind: "error", code, fatal: false });
    }
  });
});

describe("Scribe: audio", () => {
  it("PCM samples → little-endian bytes → base64", () => {
    const bytes = pcm16leBytes(new Int16Array([1, -2, 0x1234]));
    expect([...bytes]).toEqual([0x01, 0x00, 0xfe, 0xff, 0x34, 0x12]);
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
  });

  it("base64 of a large chunk matches node's", () => {
    const big = new Uint8Array(70_000).map((_, i) => (i * 31) & 0xff);
    expect(bytesToBase64(big)).toBe(Buffer.from(big).toString("base64"));
  });

  it("48 kHz → 16 kHz: three samples in, one out, the mean of them, scaled to 16 bits", () => {
    const d = new PcmDownsampler(48_000, 16_000);
    const out = d.push(new Float32Array([0.5, 0.5, 0.5, -1, -1, -1, 1, 1]));
    expect([...out]).toEqual([Math.round(0.5 * 0x7fff), -0x8000]);
    // the two samples left over are carried into the next push
    expect([...d.push(new Float32Array([1]))]).toEqual([0x7fff]);
  });

  it("44.1 kHz → 16 kHz keeps the rate over time (a fractional ratio)", () => {
    const d = new PcmDownsampler(44_100, 16_000);
    let n = 0;
    for (let i = 0; i < 100; i++) n += d.push(new Float32Array(441)).length; // one second in 10 ms blocks
    expect(Math.abs(n - 16_000)).toBeLessThanOrEqual(1);
  });

  it("clamps samples beyond [-1, 1]", () => {
    const d = new PcmDownsampler(16_000, 16_000);
    expect([...d.push(new Float32Array([2, -3]))]).toEqual([0x7fff, -0x8000]);
  });

  it("the worklet's source runs: 48 kHz blocks in, 100 ms chunks of 16 kHz PCM out", () => {
    const posted: Int16Array[] = [];
    let Processor: (new () => { process(inputs: Float32Array[][]): boolean; port: { postMessage(m: Int16Array): void } }) | null = null;
    let registered = "";
    class AudioWorkletProcessor {
      port = { postMessage: (m: Int16Array) => posted.push(m) };
    }
    const register = (name: string, ctor: typeof Processor) => {
      registered = name;
      Processor = ctor;
    };
    new Function("AudioWorkletProcessor", "registerProcessor", "sampleRate", PCM_WORKLET_SOURCE)(AudioWorkletProcessor, register, 48_000);
    expect(registered).toBe(PCM_WORKLET_NAME);
    const node = new Processor!();
    const block = new Float32Array(128).fill(0.25);
    for (let i = 0; i < 375; i++) expect(node.process([[block]])).toBe(true); // 1 s of 48 kHz
    expect(node.process([[]])).toBe(true); // no input (a muted track): keeps going
    expect(SCRIBE_CHUNK_SAMPLES).toBe(1600);
    expect(posted).toHaveLength(10);
    expect(posted.every((c) => c.length === SCRIBE_CHUNK_SAMPLES)).toBe(true);
    expect(posted[0][10]).toBe(Math.round(0.25 * 0x7fff));
    expect(SCRIBE.sampleRate).toBe(16_000);
  });
});
