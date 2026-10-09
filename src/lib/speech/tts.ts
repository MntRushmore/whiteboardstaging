/**
 * Read aloud's voice on the server: the ElevenLabs text-to-speech request POST /api/live/speak
 * makes, as plain data and pure functions so the route stays thin and the choices are tested.
 *
 * Why these choices:
 *  - `eleven_flash_v2_5`: ElevenLabs' lowest-latency model (~75 ms to the first audio), at half the
 *    characters' cost of their multilingual models. A hint must sound while it is still on screen.
 *  - "Jessica" (premade, young, warm, bright, American): friendly to a five-year-old without being
 *    a cartoon. The owner prefers ElevenLabs voices to the browser's; LIVE_VOICE_ID picks another.
 *  - `mp3_44100_64`: every browser plays MP3 in an <audio> element (iOS Safari included), and 64
 *    kbit/s is clear for one voice at a third of the bytes of 192.
 *  - speed 0.95 and steady settings: a touch slower than a grown-up's pace, the same voice every
 *    time.
 *
 * Server-only in use (the route), but it holds no secret: the key is the route's to add.
 */
import { z } from "zod";
import { SPEAK_MAX_CHARS, type SpeakRequest } from "./contracts";

export const TTS = {
  baseUrl: "https://api.elevenlabs.io/v1/text-to-speech",
  model: "eleven_flash_v2_5",
  /** Jessica: premade, so every ElevenLabs account has it */
  defaultVoiceId: "cgSgspJ2msm6clMCkdW9",
  outputFormat: "mp3_44100_64",
  language: "en",
  voiceSettings: { stability: 0.55, similarity_boost: 0.75, style: 0, use_speaker_boost: true, speed: 0.95 },
  /** ElevenLabs has not started answering after this long: the client uses the browser's voice */
  firstByteTimeoutMs: 8_000,
} as const;

/** POST /api/live/speak's body (the `SpeakRequest` contract): words to say, at most SPEAK_MAX_CHARS. */
export const SpeakRequestSchema: z.ZodType<SpeakRequest> = z
  .object({
    text: z
      .string()
      .trim()
      .min(1, "Nothing to say.")
      .max(SPEAK_MAX_CHARS, `At most ${SPEAK_MAX_CHARS} characters.`)
      .refine((t) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(t), "Plain text only."),
  })
  .strict();

/** An ElevenLabs voice id: letters and digits (premade ids are 20). Anything else could bend the URL. */
const VOICE_ID = /^[A-Za-z0-9]{10,40}$/;

/** The configured voice (LIVE_VOICE_ID) when it looks like a voice id, else the default. */
export function voiceIdOr(configured: string | null | undefined): { voiceId: string; ignored: boolean } {
  const v = configured?.trim();
  if (!v) return { voiceId: TTS.defaultVoiceId, ignored: false };
  return VOICE_ID.test(v) ? { voiceId: v, ignored: false } : { voiceId: TTS.defaultVoiceId, ignored: true };
}

/** The streaming endpoint for `voiceId`, in MP3. */
export function ttsUrl(voiceId: string): string {
  return `${TTS.baseUrl}/${encodeURIComponent(voiceId)}/stream?output_format=${TTS.outputFormat}`;
}

/** The request body for `text` (already spoken words: `spokenText`). */
export function ttsBody(text: string): Record<string, unknown> {
  return { text, model_id: TTS.model, language_code: TTS.language, voice_settings: { ...TTS.voiceSettings } };
}

/**
 * An ElevenLabs refusal that no retry fixes, which the route answers like a missing key (the
 * browser's voice) while the /admin page says why: `key` (401/403: a wrong key, or one without the
 * Text to Speech permission — the lecture's key was made for Scribe alone), `quota` (the account's
 * characters are spent), `voice` (LIVE_VOICE_ID names no voice this account has). null for anything
 * else (a 5xx, a 429), which is an upstream error.
 */
export function ttsRefusal(status: number, body: unknown): { kind: "key" | "quota" | "voice"; detail: string } | null {
  const detail = refusalDetail(body);
  if (status === 401 || status === 403) {
    return { kind: /quota/i.test(detail) ? "quota" : "key", detail };
  }
  if (status === 404 || (status === 400 && /voice/i.test(detail))) return { kind: "voice", detail };
  return null;
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
