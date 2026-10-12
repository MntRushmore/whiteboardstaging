/**
 * Ask's mic, the decisions without the browser (docs/ASK-V2.md, part "voice"): which recorder
 * format, hold or tap, which way to hear (ElevenLabs Scribe through POST /api/live/transcribe, or
 * the browser's own recognizer), what the route's answer means, and what a failure tells the kid.
 * Pure (`__tests__/micLogic.test.ts`); `AskMic.tsx` and `micEngines.ts` do the browser's part.
 */
import { ASK_LIMITS, TranscribeResponseSchema } from "@/lib/live/ask/contracts";
import { SPEECH_UNAVAILABLE } from "@/lib/speech/contracts";
import { ASK_VOICE_COPY } from "./copy";

export const MIC = {
  /** a press held at least this long is hold-to-talk (let go: sent); shorter is a tap (tap again: sent) */
  holdMs: 350,
  /** the longest a kid may talk (the route's cap) */
  maxMs: ASK_LIMITS.audioSeconds * 1_000,
  /** the last seconds are counted down */
  countdownMs: 10_000,
  /** less than this is a slip of the finger: nothing is sent */
  minMs: 300,
  /**
   * Opus or AAC at 32 kbit/s: clear for one voice, ~240 KB a minute. The route takes at most
   * ASK_LIMITS.compressedAudioBytes (1.2 MB) of compressed audio, which even a browser that ignores
   * this and records at 128 kbit/s stays under for the mic's 60 s.
   */
  bitsPerSecond: 32_000,
  /** after the route said `speech_unavailable`, the browser's recognizer for this long */
  routeDownMs: 10 * 60_000,
  /** failures of the route in a row before the mic uses the browser's recognizer for a while */
  failuresBeforeFallback: 2,
  /** the route has not answered after this long: the kid is told, and may try again */
  requestTimeoutMs: 25_000,
  /** a problem's words stay this long */
  problemMs: 8_000,
} as const;

/** The formats a MediaRecorder is asked for, best first. */
const WEBM_FIRST = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/ogg;codecs=opus"];
/** Safari and every iPad browser (WebKit): AAC in MP4, its own and steadiest recording. */
const MP4_FIRST = ["audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/webm;codecs=opus", "audio/webm"];

/** Safari, or any browser on iOS/iPadOS (all WebKit underneath): records MP4 best. */
export function prefersMp4(userAgent: string): boolean {
  return /AppleWebKit/.test(userAgent) && !/(Chrome|Chromium|Edg|OPR|Firefox)\//.test(userAgent);
}

/** The recorder format to ask for ("" lets the browser choose), or null when it has no MediaRecorder. */
export function pickRecorderType(isTypeSupported: ((type: string) => boolean) | null, preferMp4: boolean): string | null {
  if (!isTypeSupported) return null;
  for (const type of preferMp4 ? MP4_FIRST : WEBM_FIRST) {
    try {
      if (isTypeSupported(type)) return type;
    } catch {
      // an old browser that throws on a type it does not know
    }
  }
  return "";
}

/** The file name the route gets for a recording of `type` (the route checks the bytes, not the name). */
export function recordingName(type: string): string {
  if (/mp4|aac|m4a/i.test(type)) return "ask.m4a";
  if (/ogg/i.test(type)) return "ask.ogg";
  if (/wav/i.test(type)) return "ask.wav";
  return "ask.webm";
}

/** The kid's language for Scribe, from the browser's ("en-US" → "en"); English when unsure. */
export function speechLang(browserLang: string | undefined | null): string {
  const m = /^([A-Za-z]{2,3})(?:[-_]|$)/.exec(browserLang ?? "");
  return m ? m[1].toLowerCase() : "en";
}

/** The browser recognizer's language tag: the browser's own, else US English. */
export function recognizerLang(browserLang: string | undefined | null): string {
  return browserLang && /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(browserLang) ? browserLang : "en-US";
}

/** Window event when the mic starts listening: Ask's voice stops (`useAskSpeech`), or it would be recorded too. */
export const ASK_MIC_EVENT = "agathon:ask-mic";

export type MicEngine = "recorder" | "browser";

/**
 * How to hear the kid: record and send to the route (Scribe) unless the route said lately it will
 * not (`routeDown`), else the browser's recognizer; recording anyway when there is no recognizer
 * (the route may be back). null: neither is here.
 */
export function chooseEngine(has: { recorder: boolean; recognizer: boolean }, routeDown: boolean): MicEngine | null {
  if (has.recorder && !routeDown) return "recorder";
  if (has.recognizer) return "browser";
  return has.recorder ? "recorder" : null;
}

/** A press ended: hold-to-talk (send now) or a tap (keep listening until the next tap). */
export function pressKind(pressedAt: number, releasedAt: number): "hold" | "tap" {
  return releasedAt - pressedAt >= MIC.holdMs ? "hold" : "tap";
}

/** Seconds left to show while recording (only in the last MIC.countdownMs), else null. */
export function secondsLeft(elapsedMs: number): number | null {
  const left = MIC.maxMs - elapsedMs;
  if (left > MIC.countdownMs) return null;
  return Math.max(0, Math.ceil(left / 1_000));
}

// ------------------------------------------------------------------ what went wrong

export type MicProblem = "denied" | "no-mic" | "busy" | "unsupported" | "nothing" | "again" | "error" | "limited";

/** What a kid reads for a problem, and the line for a grown-up when only they can fix it. */
export function problemWords(problem: MicProblem): { kid: string; grownUp?: string } {
  switch (problem) {
    case "denied":
      return { kid: ASK_VOICE_COPY.denied, grownUp: ASK_VOICE_COPY.deniedHint };
    case "no-mic":
      return { kid: ASK_VOICE_COPY.noMic, grownUp: ASK_VOICE_COPY.noMicHint };
    case "busy":
      return { kid: ASK_VOICE_COPY.busy, grownUp: ASK_VOICE_COPY.busyHint };
    case "unsupported":
      return { kid: ASK_VOICE_COPY.unsupported };
    case "nothing":
      return { kid: ASK_VOICE_COPY.nothing };
    case "again":
      return { kid: ASK_VOICE_COPY.again };
    case "limited":
      return { kid: ASK_VOICE_COPY.limited };
    default:
      return { kid: ASK_VOICE_COPY.error };
  }
}

/** getUserMedia's (or MediaRecorder's) failure, as the kid's problem. */
export function micErrorProblem(err: unknown): MicProblem {
  const name = typeof err === "object" && err !== null ? String((err as { name?: unknown }).name ?? "") : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") return "no-mic";
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") return "busy";
  if (name === "NotSupportedError" || name === "TypeError") return "unsupported";
  return "error";
}

/** The browser recognizer's `error` code, as the kid's problem (null: not a problem, e.g. "aborted"). */
export function recognizerErrorProblem(code: string): MicProblem | null {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "denied";
    case "audio-capture":
      return "no-mic";
    case "no-speech":
      return "nothing";
    case "language-not-supported":
      return "unsupported";
    case "aborted":
      return null;
    default:
      return "error";
  }
}

// ------------------------------------------------------------------ the route's answer

export type TranscribeOutcome =
  /** the words said */
  | { kind: "text"; text: string }
  /** nothing was heard */
  | { kind: "nothing" }
  /** the route will not use ElevenLabs for this kid: the browser's recognizer from now on */
  | { kind: "fallback" }
  /** too many asks: wait */
  | { kind: "limited"; retryAfterMs?: number }
  | { kind: "error" };

/** POST /api/live/transcribe's answer (status and parsed JSON body) as what the mic does next. */
export function transcribeOutcome(status: number, body: unknown): TranscribeOutcome {
  if (status >= 200 && status < 300) {
    const parsed = TranscribeResponseSchema.safeParse(body);
    if (!parsed.success) return { kind: "error" };
    const text = parsed.data.text.trim();
    return text ? { kind: "text", text } : { kind: "nothing" };
  }
  const error = typeof body === "object" && body !== null ? (body as { error?: unknown }).error : undefined;
  if (status === 503 && error === SPEECH_UNAVAILABLE) return { kind: "fallback" };
  if (status === 429) {
    const ms = typeof body === "object" && body !== null ? Number((body as { retryAfterMs?: unknown }).retryAfterMs) : Number.NaN;
    return Number.isFinite(ms) && ms > 0 ? { kind: "limited", retryAfterMs: ms } : { kind: "limited" };
  }
  return { kind: "error" };
}

/** The browser recognizer's results as one line: the final words, else what it was still hearing. */
export function recognizerText(finals: readonly string[], interim: string): string {
  const said = finals.map((s) => s.trim()).filter(Boolean).join(" ");
  return (said || interim.trim()).replace(/\s+/g, " ").slice(0, ASK_LIMITS.message);
}
