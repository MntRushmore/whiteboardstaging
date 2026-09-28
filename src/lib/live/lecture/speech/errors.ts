import { isApiError } from "@/lib/api-client";

/**
 * Why listening could not start or had to end, as a code the lecture panel has words for
 * (`lectureView.ts`). A source reports it as the `detail` of `onState("error", code)`, and
 * `createSpeechSource` / `start()` throw it as a `SpeechError`.
 *
 *  - unsupported   no way to listen in this browser (no realtime recognizer here and no built-in one)
 *  - mic-denied    the microphone permission was refused
 *  - mic-missing   no microphone, or it is in use elsewhere
 *  - credits       the token route answered 402: this month's credits are used up
 *  - unauthorized  signed out
 *  - network       the recognizer could not be reached, again and again
 *  - recognizer    the recognizer refused the session (its key, its quota)
 */
export type SpeechErrorCode = "unsupported" | "mic-denied" | "mic-missing" | "credits" | "unauthorized" | "network" | "recognizer";

export const SPEECH_ERROR_CODES: readonly SpeechErrorCode[] = ["unsupported", "mic-denied", "mic-missing", "credits", "unauthorized", "network", "recognizer"];

export class SpeechError extends Error {
  readonly code: SpeechErrorCode;
  constructor(code: SpeechErrorCode, message: string = code) {
    super(message);
    this.name = "SpeechError";
    this.code = code;
  }
}

export function isSpeechErrorCode(v: unknown): v is SpeechErrorCode {
  return typeof v === "string" && (SPEECH_ERROR_CODES as readonly string[]).includes(v);
}

/** getUserMedia's rejection → a code (`NotAllowedError` is a refusal; `NotFoundError` / `NotReadableError` no usable microphone). */
export function micErrorCode(err: unknown): SpeechErrorCode {
  const name = err && typeof err === "object" && "name" in err ? String((err as { name: unknown }).name) : "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") return "mic-denied";
  if (name === "NotFoundError" || name === "NotReadableError" || name === "OverconstrainedError" || name === "AbortError") return "mic-missing";
  return "unsupported";
}

/** Any failure on the way to listening → a code: our API's errors by status, a `SpeechError` as it is. */
export function speechErrorCodeFor(err: unknown): SpeechErrorCode {
  if (err instanceof SpeechError) return err.code;
  if (isApiError(err)) {
    if (err.status === 402 || err.code === "credits_exhausted") return "credits";
    if (err.status === 401 || err.code === "unauthorized") return "unauthorized";
    return "network";
  }
  if (err instanceof TypeError) return "network";
  return "recognizer";
}

/** True for a failure worth trying again later (a hiccup), false for one that will fail the same way. */
export function isTransientSpeechFailure(err: unknown): boolean {
  if (err instanceof SpeechError) return err.code === "network";
  if (isApiError(err)) return !(err.status === 402 || err.status === 401 || err.code === "credits_exhausted" || err.code === "unauthorized" || err.code === "listen_not_configured");
  return true;
}
