/**
 * Ask's ears on the server: the ElevenLabs speech-to-text request POST /api/live/transcribe makes
 * (Scribe, the batch endpoint), and what the route checks about a recording before it pays for
 * one, as plain data and pure functions so the route stays thin and the choices are tested.
 *
 * Why these choices:
 *  - `scribe_v2`: the batch form of the model lecture mode streams to (`scribe_v2_realtime`,
 *    src/lib/live/lecture/speech/scribe.ts). A spoken ask is one short recording sent when the mic
 *    is let go, so one request beats a socket: no token to mint, nothing open while the kid thinks.
 *  - `tag_audio_events: false`: a giggle or a cough is not part of the question ("(laughs)" would
 *    end up in the input box); `diarize: false`: one speaker.
 *  - The language is the kid's browser's (`lang`, e.g. "en" from en-US) when the client sends it:
 *    a short "what is seven times eight" left to auto-detection can come back in another language.
 *  - The recording is checked by its bytes (`sniffAudio`), not its declared type: Safari's
 *    MediaRecorder says `audio/mp4`, Chrome's `audio/webm;codecs=opus`, and a client could say
 *    anything. The route never stores it: the bytes go to ElevenLabs and are dropped.
 *
 * Server-only in use (the route), but it holds no secret: the key is the route's to add.
 */
import { z } from "zod";
import { ASK_LIMITS } from "@/lib/live/ask/contracts";

export const SCRIBE_BATCH = {
  url: "https://api.elevenlabs.io/v1/speech-to-text",
  model: "scribe_v2",
  /** a minute of audio comes back in a few seconds; a stuck call must not hold the kid's ask */
  timeoutMs: 20_000,
} as const;

/** Less than this is a container's header and no sound: nothing was said, and nothing is sent. */
export const MIN_AUDIO_BYTES = 512;
/** A recording shorter than this (a tap on the mic) has no words in it. */
export const MIN_AUDIO_SECONDS = 0.25;
/** A little over the 60 s the mic allows: its timer and the recorder's last chunk can disagree. */
export const MAX_AUDIO_SECONDS = ASK_LIMITS.audioSeconds + 2;
/**
 * The most bytes a second of speech takes in a WAV the route accepts without a readable header
 * (16 kHz 16-bit mono): a floor on its length from its size.
 */
export const MAX_BYTES_PER_SECOND = 32_000;
/**
 * The most bytes a second takes in the compressed recordings the browsers make (128 kbit/s; the mic
 * asks for 32): a floor on a compressed recording's length from its size, so a client that says
 * "1 second" about a long recording still counts against the budgets before the call. Its real
 * length is Scribe's (`audio_duration_secs`), and the route trues the budgets up with it after.
 */
export const MAX_COMPRESSED_BYTES_PER_SECOND = 16_000;

/** The most bytes a recording of `kind` may have: a WAV's length is in its header; a compressed one's is not. */
export function audioByteCap(kind: AudioKind): number {
  return kind === "wav" ? ASK_LIMITS.audioBytes : ASK_LIMITS.compressedAudioBytes;
}

/** The multipart fields beside `audio`: the kid's language and the recording's length, both optional. */
export const TranscribeFieldsSchema = z
  .object({
    /** a BCP 47 tag or its language ("en-US", "en", "spa"); only the language goes to Scribe */
    lang: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$/, "a language tag")
      .transform((tag) => tag.split(/[-_]/)[0].toLowerCase())
      .optional(),
    /** what the client timed, in seconds */
    seconds: z.coerce.number().finite().min(0).max(600).optional(),
  })
  .strict();
export type TranscribeFields = z.infer<typeof TranscribeFieldsSchema>;

/** The containers the browsers record in (and a WAV, for tests and tools). */
export type AudioKind = "webm" | "mp4" | "wav" | "ogg" | "mpeg";

const MIME: Record<AudioKind, { type: string; name: string }> = {
  webm: { type: "audio/webm", name: "ask.webm" },
  mp4: { type: "audio/mp4", name: "ask.m4a" },
  wav: { type: "audio/wav", name: "ask.wav" },
  ogg: { type: "audio/ogg", name: "ask.ogg" },
  mpeg: { type: "audio/mpeg", name: "ask.mp3" },
};

function ascii(bytes: Uint8Array, at: number, text: string): boolean {
  if (bytes.length < at + text.length) return false;
  for (let i = 0; i < text.length; i++) if (bytes[at + i] !== text.charCodeAt(i)) return false;
  return true;
}

/** What the bytes are (their magic numbers), or null for anything that is not a recording. */
export function sniffAudio(bytes: Uint8Array): AudioKind | null {
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "webm"; // EBML
  if (ascii(bytes, 4, "ftyp")) return "mp4";
  if (ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "WAVE")) return "wav";
  if (ascii(bytes, 0, "OggS")) return "ogg";
  if (ascii(bytes, 0, "ID3") || (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return "mpeg"; // MP3 or ADTS AAC
  return null;
}

/** The type and file name the recording is sent to Scribe with. */
export function audioFile(kind: AudioKind): { type: string; name: string } {
  return MIME[kind];
}

/**
 * A WAV's exact length in seconds from its header (`fmt ` byte rate, `data` size), or null when the
 * header cannot say. A streamed WAV's `data` size may be a placeholder: the bytes present cap it.
 */
export function wavSeconds(bytes: Uint8Array): number | null {
  if (!ascii(bytes, 0, "RIFF") || !ascii(bytes, 8, "WAVE")) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 12;
  let byteRate = 0;
  while (at + 8 <= bytes.length) {
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (ascii(bytes, at, "fmt ") && body + 12 <= bytes.length) byteRate = view.getUint32(body + 8, true);
    if (ascii(bytes, at, "data")) {
      if (!byteRate) return null;
      return Math.min(size, bytes.length - body) / byteRate;
    }
    at = body + size + (size % 2); // chunks are padded to an even length
  }
  return null;
}

/**
 * How long the recording is, for the length cap and the budgets before the call: a WAV's own header
 * (`wavSeconds`); else the longer of what the client timed and what the size implies
 * (MAX_BYTES_PER_SECOND for a WAV whose header cannot say, MAX_COMPRESSED_BYTES_PER_SECOND for the
 * rest). `exact` is true only for the header. A compressed recording's real length is only known
 * once Scribe has heard it (`parseScribeReply`'s `heardSeconds`).
 */
export function audioSeconds(kind: AudioKind, bytes: Uint8Array, claimed: number | undefined): { seconds: number; exact: boolean } {
  if (kind === "wav") {
    const s = wavSeconds(bytes);
    if (s !== null) return { seconds: s, exact: true };
  }
  const perSecond = kind === "wav" ? MAX_BYTES_PER_SECOND : MAX_COMPRESSED_BYTES_PER_SECOND;
  return { seconds: Math.max(claimed ?? 0, bytes.length / perSecond), exact: false };
}

/** Whole seconds for a budget: at least 1, rounded up. */
export function billedSeconds(seconds: number): number {
  return Math.max(1, Math.ceil(seconds));
}

/** The multipart body for Scribe: the recording, the model, and the settings above. */
export function scribeForm(audio: Uint8Array, kind: AudioKind, lang?: string): FormData {
  const { type, name } = audioFile(kind);
  const form = new FormData();
  form.set("model_id", SCRIBE_BATCH.model);
  form.set("file", new Blob([audio as BlobPart], { type }), name);
  form.set("tag_audio_events", "false");
  form.set("diarize", "false");
  if (lang) form.set("language_code", lang);
  return form;
}

const ScribeReplySchema = z.object({
  text: z.string(),
  language_code: z.string().optional(),
  /** the recording's length as Scribe measured it (what the account is billed for) */
  audio_duration_secs: z.number().optional(),
  words: z.array(z.object({ end: z.number().optional(), type: z.string().optional() }).passthrough()).optional(),
});

/**
 * Scribe's answer (checked 2026-10-11 with scribe_v2: `{ language_code, language_probability, text,
 * words[{ text, start, end, type }], transcription_id, audio_duration_secs }`): the words, the
 * language it heard, and the audio's length (its own measure, else where the last word ended).
 */
export function parseScribeReply(body: unknown): { text: string; language: string | null; heardSeconds: number | null } | null {
  const parsed = ScribeReplySchema.safeParse(body);
  if (!parsed.success) return null;
  const ends = (parsed.data.words ?? []).map((w) => w.end).filter((e): e is number => typeof e === "number" && Number.isFinite(e));
  return {
    text: cleanTranscript(parsed.data.text),
    language: parsed.data.language_code ?? null,
    heardSeconds: parsed.data.audio_duration_secs ?? (ends.length ? Math.max(...ends) : null),
  };
}

/**
 * The words as the input box gets them: sound tags gone ("(laughs)", "[music]": Scribe adds them
 * when it is asked to, and sometimes for silence), spaces tidied, at most ASK_LIMITS.message
 * characters on a word boundary.
 */
export function cleanTranscript(text: string): string {
  const words = text
    .replace(/\[[^\]\n]{1,40}\]/g, " ")
    .replace(/\((?:[a-z][a-z' -]{0,38})\)/gi, (tag) => (/\d/.test(tag) ? tag : " "))
    .replace(/\s+/g, " ")
    .trim();
  if (words.length <= ASK_LIMITS.message) return words;
  const cut = words.slice(0, ASK_LIMITS.message + 1);
  const space = cut.lastIndexOf(" ");
  return (space > ASK_LIMITS.message / 2 ? cut.slice(0, space) : cut.slice(0, ASK_LIMITS.message)).trim();
}

/**
 * A Scribe refusal that no retry fixes, answered like a missing key (the browser's recognizer) and
 * recorded for /admin: `key` (401/403: a wrong key, or one without the Speech to Text permission),
 * `quota` (the account's hours are spent). null for anything else: a 422 about the audio is the
 * recording's fault (`unreadable`, below), a 5xx or 429 an upstream error.
 */
export function scribeRefusal(status: number, body: unknown): { kind: "key" | "quota"; detail: string } | null {
  if (status !== 401 && status !== 403) return null;
  const detail = refusalDetail(body);
  return { kind: /quota/i.test(detail) ? "quota" : "key", detail };
}

/** Scribe could not make sense of the recording (a 400/422 about the file): nothing heard, not an outage. */
export function scribeUnreadable(status: number): boolean {
  return status === 400 || status === 422;
}

/** `detail.status` and `detail.message` from an ElevenLabs error body, as one short line. */
function refusalDetail(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const d = (body as { detail?: unknown }).detail;
  if (typeof d === "string") return d.slice(0, 200);
  if (!d || typeof d !== "object") return "";
  const { status, message } = d as { status?: unknown; message?: unknown };
  return [status, message]
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .join(": ")
    .slice(0, 200);
}
