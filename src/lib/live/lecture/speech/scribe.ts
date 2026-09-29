/**
 * ElevenLabs Scribe v2 Realtime, as lecture mode speaks to it: the endpoints, the session's query,
 * the audio format and the messages both ways. Pure (no DOM, no network), shared by the token route
 * (which puts the socket URL together) and the browser source (`elevenlabs.ts`, which speaks the
 * protocol), so the two can never disagree about a parameter.
 *
 * Checked against the ElevenLabs API reference (2026-09-28):
 *  - `POST https://api.elevenlabs.io/v1/single-use-token/realtime_scribe` with `xi-api-key` →
 *    `{ token }`; the token opens ONE session and expires 15 minutes after it was made.
 *  - `wss://api.elevenlabs.io/v1/speech-to-text/realtime?model_id=…&token=…` with the session's
 *    settings as query parameters (`audio_format`, `commit_strategy`, `vad_*`, `language_code`, …).
 *  - audio in: `{ message_type: "input_audio_chunk", audio_base_64, commit, sample_rate }`, 16-bit
 *    little-endian mono PCM at the rate `audio_format` names; 0.1–1 s per chunk is recommended.
 *    `previous_text` (best under 50 characters) may ride on the first chunk of a session only.
 *  - out: `session_started`, `partial_transcript { text }` (what is being heard, replaced by the
 *    next), `committed_transcript { text }` (a finished segment), and errors as
 *    `{ message_type: <code>, error }` (`auth_error`, `quota_exceeded`,
 *    `session_time_limit_exceeded`, …). The model also commits by itself after ~36 s of audio.
 *  - the maximum length of a session is not published; `session_time_limit_exceeded` (or the
 *    socket closing) ends one, and the source opens the next with a fresh token.
 */

export const SCRIBE = {
  tokenUrl: "https://api.elevenlabs.io/v1/single-use-token/realtime_scribe",
  socketUrl: "wss://api.elevenlabs.io/v1/speech-to-text/realtime",
  model: "scribe_v2_realtime",
  /** what the microphone is downsampled to: speech needs nothing more, and it is the API's default */
  sampleRate: 16_000,
  audioFormat: "pcm_16000",
  /**
   * The recognizer commits a segment itself when the speaker pauses (voice activity detection),
   * which is what a lecture is: nobody presses "commit". The silence that ends a segment is the
   * first wait between a number being said and its bar on the board, so it is kept short: half a
   * second (the API's example is 1.5). A fast talker hardly pauses longer than that between
   * sentences; at 1 s their segments ran on for many sentences and the board fell behind.
   */
  commitStrategy: "vad",
  vadSilenceSecs: 0.5,
  /** a single-use token lives 15 minutes; the route reports a little less so nobody cuts it fine */
  tokenTtlMs: 15 * 60_000,
  tokenSafetyMs: 30_000,
  /** audio per message: a tenth of a second (the low end of the recommended 0.1–1 s: less to wait for) */
  chunkMs: 100,
  /** `previous_text` on a reconnected session's first chunk: best under 50 characters */
  previousTextChars: 50,
} as const;

/** 16-bit mono PCM bytes per second at `SCRIBE.sampleRate`. */
export const SCRIBE_BYTES_PER_SECOND = SCRIBE.sampleRate * 2;

/** The session's socket URL, token and settings on it. */
export function scribeSocketUrl(token: string, opts: { languageCode?: string } = {}): string {
  const q = new URLSearchParams({
    model_id: SCRIBE.model,
    audio_format: SCRIBE.audioFormat,
    commit_strategy: SCRIBE.commitStrategy,
    vad_silence_threshold_secs: String(SCRIBE.vadSilenceSecs),
    token,
  });
  // No language: the model detects it (a lecture in French is transcribed in French).
  if (opts.languageCode) q.set("language_code", opts.languageCode);
  return `${SCRIBE.socketUrl}?${q.toString()}`;
}

// ------------------------------------------------------------------ messages

export interface ScribeAudioMessage {
  message_type: "input_audio_chunk";
  audio_base_64: string;
  commit: boolean;
  sample_rate: number;
  previous_text?: string;
}

/** One chunk of audio for the socket (already base64). */
export function scribeAudioMessage(base64: string, opts: { previousText?: string } = {}): string {
  const msg: ScribeAudioMessage = { message_type: "input_audio_chunk", audio_base_64: base64, commit: false, sample_rate: SCRIBE.sampleRate };
  const prev = opts.previousText?.trim();
  if (prev) msg.previous_text = prev.slice(-SCRIBE.previousTextChars);
  return JSON.stringify(msg);
}

/**
 * The error codes that end a session for good (the key, the account, the request itself): a
 * reconnect would fail the same way. Everything else — a time limit, a hiccup, throttling — is
 * answered by opening a new session.
 */
const FATAL_ERRORS = new Set(["auth_error", "quota_exceeded", "unaccepted_terms", "invalid_request", "input_error"]);

export type ScribeEvent =
  | { kind: "started"; sessionId: string | null }
  | { kind: "partial"; text: string }
  | { kind: "committed"; text: string }
  | { kind: "error"; code: string; message: string; fatal: boolean }
  | { kind: "other"; type: string };

/** A message from the socket, in the terms the source needs. Unknown or malformed → `other`. */
export function parseScribeMessage(data: unknown): ScribeEvent {
  let msg: unknown = data;
  if (typeof data === "string") {
    try {
      msg = JSON.parse(data);
    } catch {
      return { kind: "other", type: "invalid_json" };
    }
  }
  if (!msg || typeof msg !== "object") return { kind: "other", type: "invalid" };
  const m = msg as Record<string, unknown>;
  const type = typeof m.message_type === "string" ? m.message_type : "";
  const text = typeof m.text === "string" ? m.text : "";
  switch (type) {
    case "session_started":
      return { kind: "started", sessionId: typeof m.session_id === "string" ? m.session_id : null };
    case "partial_transcript":
      return { kind: "partial", text };
    case "committed_transcript":
      return { kind: "committed", text };
    // with timestamps / entities / edits the same words arrive again: the plain commit is enough
    case "committed_transcript_with_timestamps":
    case "committed_transcript_entities":
    case "edited_transcript":
    case "warning":
      return { kind: "other", type };
  }
  if (typeof m.error === "string" || /error|exceeded|limited|overflow|exhausted|throttled|terms/.test(type)) {
    const code = type || "error";
    return { kind: "error", code, message: typeof m.error === "string" ? m.error : code, fatal: FATAL_ERRORS.has(code) };
  }
  return { kind: "other", type: type || "unknown" };
}

// ------------------------------------------------------------------ audio

const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

/** 16-bit PCM samples as little-endian bytes (the wire format), whatever the platform's order. */
export function pcm16leBytes(samples: Int16Array): Uint8Array {
  if (LITTLE_ENDIAN) return new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  const out = new Uint8Array(samples.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < samples.length; i++) view.setInt16(i * 2, samples[i], true);
  return out;
}

/** Bytes → base64 without building one huge argument list (a 100 ms chunk is 3.2 KB). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const STEP = 0x2000;
  for (let i = 0; i < bytes.length; i += STEP) binary += String.fromCharCode(...bytes.subarray(i, i + STEP));
  return btoa(binary);
}

/**
 * The microphone's float samples (usually 48 kHz, sometimes 44.1 kHz) → 16 kHz 16-bit PCM.
 * Each output sample is the mean of the input samples in its window: a box filter, which keeps
 * the aliasing of plain decimation out of speech at no cost, and handles a ratio that is not a
 * whole number (44.1 → 16 is 2.756…) by carrying the fraction over.
 *
 * Self-contained on purpose (no outer names, no class fields): the AudioWorklet's source is built
 * from this class's own text (`PCM_WORKLET_SOURCE`), and it is unit-tested here in node.
 */
export class PcmDownsampler {
  // `declare`: no class fields in the emitted code (a compiler helper for them would not exist
  // inside the worklet); the constructor assigns them.
  declare step: number;
  declare pos: number;
  declare sum: number;
  declare count: number;

  constructor(inputRate: number, outputRate: number) {
    this.step = Math.max(1, inputRate / outputRate);
    this.pos = 0;
    this.sum = 0;
    this.count = 0;
  }

  /** Feed float samples in [-1, 1]; returns the 16-bit samples completed by them. */
  push(input: Float32Array): Int16Array {
    const out = new Int16Array(Math.ceil((input.length + this.pos) / this.step) + 1);
    let n = 0;
    for (let i = 0; i < input.length; i++) {
      this.sum += input[i];
      this.count += 1;
      this.pos += 1;
      if (this.pos >= this.step) {
        const v = Math.max(-1, Math.min(1, this.sum / this.count));
        out[n++] = v < 0 ? Math.round(v * 0x8000) : Math.round(v * 0x7fff);
        this.pos -= this.step;
        this.sum = 0;
        this.count = 0;
      }
    }
    return out.slice(0, n);
  }
}

/** Samples of 16 kHz audio in one message (`SCRIBE.chunkMs`). */
export const SCRIBE_CHUNK_SAMPLES = (SCRIBE.sampleRate * SCRIBE.chunkMs) / 1000;

/**
 * The AudioWorklet that turns the microphone into chunks for the socket: downsampled in the audio
 * thread and posted to the page one `SCRIBE.chunkMs` chunk at a time (transferred, not copied).
 * Loaded from a Blob URL, so there is no extra file to serve.
 */
export const PCM_WORKLET_NAME = "agathon-pcm16";
export const PCM_WORKLET_SOURCE = `
const Downsampler = (${PcmDownsampler.toString()});
class AgathonPcm16 extends AudioWorkletProcessor {
  constructor() {
    super();
    this.down = new Downsampler(sampleRate, ${SCRIBE.sampleRate});
    this.buf = new Int16Array(${SCRIBE_CHUNK_SAMPLES});
    this.n = 0;
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    const out = this.down.push(channel);
    for (let i = 0; i < out.length; i++) {
      this.buf[this.n++] = out[i];
      if (this.n === this.buf.length) {
        this.port.postMessage(this.buf, [this.buf.buffer]);
        this.buf = new Int16Array(${SCRIBE_CHUNK_SAMPLES});
        this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor("${PCM_WORKLET_NAME}", AgathonPcm16);
`;
