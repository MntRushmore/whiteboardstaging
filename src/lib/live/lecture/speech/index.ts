import type { ListenTokenResponse, SpeechSource } from "../contracts";
import { isListenNotConfigured, requestListenToken } from "../client";
import { browserRecognition, createBrowserSource, type RecognitionCtor } from "./browser";
import { canStreamMicrophone, createElevenLabsSource } from "./elevenlabs";
import { SpeechError } from "./errors";

export { createScriptSource, type ScriptLine } from "./script";
export { SpeechError, speechErrorCodeFor, type SpeechErrorCode } from "./errors";

/**
 * Picks how lecture mode listens:
 *
 *  1. ElevenLabs Scribe (realtime, the same in every browser): when this browser can stream the
 *     microphone and the token route hands out a token. The first token is fetched here, so a
 *     deployment without a key is known before the microphone is opened.
 *  2. The browser's own recognizer: when the route answers `listen_not_configured` (no key, or a
 *     key ElevenLabs rejects), or this browser cannot stream audio.
 *  3. Neither: a `SpeechError("unsupported")` the panel explains ("Lecture mode needs Chrome,
 *     Edge or Safari").
 *
 * Any other failure of the token route (out of ink, signed out, the network) is thrown as it
 * is, for the session to report.
 */

export interface SpeechEnvironment {
  /** microphone → PCM → websocket is possible here */
  canStream: boolean;
  /** the browser's recognizer class, when it has one */
  Recognition: RecognitionCtor | null;
}

export function detectSpeechEnvironment(): SpeechEnvironment {
  return { canStream: canStreamMicrophone(), Recognition: browserRecognition() };
}

export interface CreateSpeechSourceOptions {
  requestToken?: () => Promise<ListenTokenResponse>;
  env?: SpeechEnvironment;
  /** the browser recognizer's language (default: the browser's) */
  lang?: string;
  /** the microphone permission as the browser reports it (default: the Permissions API) */
  micPermission?: () => Promise<PermissionState | "unknown">;
}

/** "denied" when the microphone was refused for this site before; "unknown" where the browser cannot say. */
export async function microphonePermission(): Promise<PermissionState | "unknown"> {
  try {
    if (typeof navigator === "undefined" || !navigator.permissions?.query) return "unknown";
    const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
    return status.state;
  } catch {
    return "unknown"; // Firefox and older Safari do not know "microphone"
  }
}

export async function createSpeechSource(opts: CreateSpeechSourceOptions = {}): Promise<SpeechSource> {
  const env = opts.env ?? detectSpeechEnvironment();
  const requestToken = opts.requestToken ?? (() => requestListenToken());
  const browser = (): SpeechSource => {
    if (!env.Recognition) throw new SpeechError("unsupported", "no speech recognition in this browser");
    return createBrowserSource({ Recognition: env.Recognition, lang: opts.lang });
  };

  if (!env.canStream) return browser();
  // A microphone already refused is known without asking: no token (a credit) is spent on it.
  if ((await (opts.micPermission ?? microphonePermission)()) === "denied") throw new SpeechError("mic-denied");
  let firstToken: ListenTokenResponse;
  try {
    firstToken = await requestToken();
  } catch (err) {
    if (isListenNotConfigured(err)) return browser();
    throw err;
  }
  return createElevenLabsSource({ firstToken, requestToken });
}
