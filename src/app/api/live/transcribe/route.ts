import { getServerEnv, hasElevenLabs } from "@/lib/env";
import { ASK_LIMITS, TranscribeResponseSchema, type TranscribeResponse } from "@/lib/live/ask/contracts";
import { SPEECH_UNAVAILABLE } from "@/lib/speech/contracts";
import {
  MAX_AUDIO_SECONDS,
  MIN_AUDIO_BYTES,
  MIN_AUDIO_SECONDS,
  SCRIBE_BATCH,
  TranscribeFieldsSchema,
  audioByteCap,
  audioSeconds,
  billedSeconds,
  parseScribeReply,
  scribeForm,
  scribeRefusal,
  scribeUnreadable,
  sniffAudio,
} from "@/lib/speech/transcribe";
import { json, requireUser } from "@/lib/server/auth";
import { userClient } from "@/lib/server/billing";
import { liveLogger, withRequestId } from "@/lib/server/live-route";
import { UpstreamError } from "@/lib/server/openrouter";
import { checkRateLimitDistributed, rateLimitedResponse, spendGlobalBudget, spendUserBudget } from "@/lib/server/rate-limit";
import { errorResponse, recordRouteEvent } from "@/lib/server/request";
import { speechEntitled } from "@/lib/server/speechAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** The multipart wrapping around the audio (boundaries, field headers, `lang`, `seconds`). */
const FORM_OVERHEAD_BYTES = 16_384;

const UNAVAILABLE_MESSAGE = "Speech to text is not set up on this deployment.";
const NOT_ENTITLED_MESSAGE = "Ask's listening comes with Agathon Unlimited.";
const BUDGET_MESSAGE = "Ask's listening is resting for today.";
const TOO_LONG_MESSAGE = `Recordings can be up to ${ASK_LIMITS.audioSeconds} seconds long.`;

/** 503 `speech_unavailable`: the mic uses the browser's own recognizer instead. */
function unavailable(message: string = UNAVAILABLE_MESSAGE): Response {
  return json(503, SPEECH_UNAVAILABLE, message, undefined, { "Cache-Control": "no-store" });
}

/** The words heard (`source: "none"` when there were none: the mic says so and sends nothing). */
function heard(text: string): Response {
  const body: TranscribeResponse = TranscribeResponseSchema.parse({ text, source: text ? "elevenlabs" : "none" });
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}

/**
 * POST /api/live/transcribe — Ask's ears: a kid holds the mic, says their question, lets go, and
 * the recording comes here as multipart `audio` (webm/Opus from Chrome, mp4/AAC from Safari and the
 * iPad, or WAV) with an optional `lang` and `seconds`. The words go back as `TranscribeResponse`
 * for the input box. ElevenLabs Scribe hears it (`src/lib/speech/transcribe.ts` says which model
 * and why).
 *
 * requireUser → the `liveTranscribe` budget → the size (ASK_LIMITS.audioBytes; 413 past it) → the
 * fields (zod) → the bytes must be a recording (415 otherwise), a compressed one at most
 * ASK_LIMITS.compressedAudioBytes (413: its length cannot be read before Scribe hears it, so its
 * size is what bounds it) and at most ~ASK_LIMITS.audioSeconds long by a WAV's header or the
 * client's word (413) → a recording with nothing in it is `source: "none"` without any call →
 * without ELEVENLABS_API_KEY, or for an account without Agathon Unlimited past its guided first
 * board (`speechEntitled`, the same rule as the voice): a 503 `speech_unavailable`, and the mic uses
 * the browser's recognizer → the account's seconds for the day (`USER_BUDGETS.liveTranscribeDaySeconds`,
 * 20 minutes, like read aloud's `liveSpeakDay`) and everyone's (`GLOBAL_BUDGETS.liveTranscribeSeconds`,
 * recorded for /admin), each spent with the recording's estimated length; either spent: the same
 * 503 → Scribe → both budgets trued up with the length Scribe measured (`audio_duration_secs`), so a
 * small low-bitrate file holding minutes is counted as what it is; past the mic's 60 s it is a 413
 * and its words are not given back.
 *
 * Not charged: the ask it carries is (`live/chat`), and saying a question should cost no more than
 * typing it. The recording is never stored or logged, and nor are the words: the log line has their
 * length. A refusal no retry fixes (a key without the Speech to Text permission, spent quota) is
 * answered like a missing key and recorded (`route.live.transcribe`); a recording Scribe cannot read
 * is "nothing heard", recorded as a warning; any other failure is a 502 through `errorResponse`,
 * also recorded.
 */
export async function POST(req: Request) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();

  const auth = await requireUser(req);
  if ("response" in auth) return withRequestId(auth.response, requestId);
  const { user, token } = auth;
  const log = liveLogger.child({ requestId, route: "transcribe", userId: user.id });

  const rl = await checkRateLimitDistributed({ token, userId: user.id, bucket: "liveTranscribe" });
  if (!rl.ok) {
    log.warn({ retryAfterMs: rl.retryAfterMs, backend: rl.backend }, "rate limited");
    return withRequestId(rateLimitedResponse(rl.retryAfterMs, rl.backend), requestId);
  }

  const tooBig = () => withRequestId(json(413, "invalid_request", "That recording is too big. Try a shorter one."), requestId);
  const declared = Number(req.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > ASK_LIMITS.audioBytes + FORM_OVERHEAD_BYTES) return tooBig();

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    log.warn("transcribe: the body is not multipart form data");
    return withRequestId(json(400, "invalid_request", "Send the recording as multipart form data with an `audio` file."), requestId);
  }
  const audio = form.get("audio");
  if (!(audio instanceof Blob)) return withRequestId(json(400, "invalid_request", "The `audio` file is missing."), requestId);
  if (audio.size > ASK_LIMITS.audioBytes) return tooBig();

  const field = (name: string) => {
    const v = form.get(name);
    return typeof v === "string" && v.trim() ? v : undefined;
  };
  const fields = TranscribeFieldsSchema.safeParse({ lang: field("lang"), seconds: field("seconds") });
  if (!fields.success) {
    log.warn({ issues: fields.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`) }, "invalid transcribe fields");
    return withRequestId(json(400, "invalid_request", "Invalid request body.", { issues: fields.error.issues.slice(0, 3) }), requestId);
  }

  const bytes = new Uint8Array(await audio.arrayBuffer());
  if (bytes.length < MIN_AUDIO_BYTES) {
    log.info({ bytes: bytes.length }, "transcribe: an empty recording (nothing heard)");
    return withRequestId(heard(""), requestId);
  }
  const kind = sniffAudio(bytes);
  if (!kind) {
    log.warn({ bytes: bytes.length, declaredType: audio.type.slice(0, 60) }, "transcribe: not a recording");
    return withRequestId(json(415, "invalid_request", "That isn't a recording we can listen to."), requestId);
  }
  if (bytes.length > audioByteCap(kind)) {
    log.warn({ bytes: bytes.length, kind }, "transcribe: a compressed recording past its cap");
    return tooBig();
  }
  const length = audioSeconds(kind, bytes, fields.data.seconds);
  if (length.seconds > MAX_AUDIO_SECONDS && (length.exact || (fields.data.seconds ?? 0) > MAX_AUDIO_SECONDS)) {
    return withRequestId(json(413, "invalid_request", TOO_LONG_MESSAGE), requestId);
  }
  if ((length.exact || fields.data.seconds !== undefined) && length.seconds < MIN_AUDIO_SECONDS) {
    log.info({ seconds: length.seconds }, "transcribe: too short to hold a word (nothing heard)");
    return withRequestId(heard(""), requestId);
  }

  if (!hasElevenLabs()) {
    log.info("ELEVENLABS_API_KEY is not set: the browser's recognizer");
    return withRequestId(unavailable(), requestId);
  }

  if (!(await speechEntitled(userClient(token), log))) {
    log.info("transcribe: not this account's (no plan, past the guided board, or the check failed): the browser's recognizer");
    return withRequestId(unavailable(NOT_ENTITLED_MESSAGE), requestId);
  }

  // What the recording is thought to be before Scribe hears it: a WAV's header, else the longer of
  // the client's word and what its size implies. Trued up with Scribe's own measure after the call.
  const seconds = Math.min(MAX_AUDIO_SECONDS, billedSeconds(length.seconds));
  const day = await spendUserBudget({ token, userId: user.id, bucket: "liveTranscribeDaySeconds", amount: seconds });
  if (!day.ok) {
    // the mic keeps working (the browser's recognizer); a 429 would leave the kid with no voice until tomorrow
    log.warn({ seconds, backend: day.backend, retryAfterMs: day.retryAfterMs }, "transcribe: this account's seconds for the day are spent: the browser's recognizer");
    return withRequestId(unavailable(BUDGET_MESSAGE), requestId);
  }
  const budget = await spendGlobalBudget("liveTranscribeSeconds", seconds);
  if (!budget.ok) {
    log.warn({ seconds, backend: budget.backend, retryAfterMs: budget.retryAfterMs }, "transcribe: the day's seconds for everyone are spent: the browser's recognizer");
    recordRouteEvent(log, {
      level: "error",
      code: "budget",
      message: "Ask's speech-to-text day budget for everyone is spent: every student gets the browser's recognizer until it turns",
      meta: { backend: budget.backend, retryAfterMs: budget.retryAfterMs },
    });
    return withRequestId(unavailable(BUDGET_MESSAGE), requestId);
  }

  // The whole call (the answer and its body) must be over within SCRIBE_BATCH.timeoutMs.
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), SCRIBE_BATCH.timeoutMs);
  const timedOut = (err: unknown) => (timeout.signal.aborted && !req.signal.aborted ? new UpstreamError(504, "ElevenLabs speech-to-text did not answer in time") : err);
  try {
    let upstream: Response;
    let body: unknown;
    try {
      upstream = await fetch(SCRIBE_BATCH.url, {
        method: "POST",
        headers: { "xi-api-key": getServerEnv().ELEVENLABS_API_KEY ?? "", Accept: "application/json" },
        body: scribeForm(bytes, kind, fields.data.lang),
        cache: "no-store",
        signal: AbortSignal.any([req.signal, timeout.signal]),
      });
      body = await upstream.json().catch((err: unknown) => {
        if (timeout.signal.aborted || req.signal.aborted) throw err;
        return null;
      });
    } catch (err) {
      throw timedOut(err);
    }

    if (!upstream.ok) {
      const refusal = scribeRefusal(upstream.status, body);
      if (refusal) {
        log.error({ upstreamStatus: upstream.status, refusal: refusal.kind, detail: refusal.detail }, "ElevenLabs refused speech-to-text: the browser's recognizer");
        recordRouteEvent(log, {
          level: "error",
          code: refusal.kind === "quota" ? "quota" : "unauthorized",
          message: `ElevenLabs refused speech-to-text (${upstream.status}${refusal.detail ? `, ${refusal.detail}` : ""})`,
          meta: { upstreamStatus: upstream.status, model: SCRIBE_BATCH.model },
        });
        return withRequestId(unavailable(), requestId);
      }
      if (scribeUnreadable(upstream.status)) {
        const detail = JSON.stringify((body as { detail?: unknown } | null)?.detail ?? "").slice(0, 160);
        log.warn({ upstreamStatus: upstream.status, kind, bytes: bytes.length, detail }, "ElevenLabs could not read the recording: nothing heard");
        recordRouteEvent(log, {
          level: "warn",
          code: "unreadable",
          message: `ElevenLabs could not read a ${kind} recording (${upstream.status})`,
          meta: { upstreamStatus: upstream.status, kind, bytes: bytes.length, detail },
        });
        return withRequestId(heard(""), requestId);
      }
      throw new UpstreamError(upstream.status, `ElevenLabs speech-to-text failed (${upstream.status})`);
    }

    const reply = parseScribeReply(body);
    if (!reply) throw new UpstreamError(502, "ElevenLabs speech-to-text: no text in the reply");

    // The true length, as Scribe measured (and bills) it: the budgets were spent with an estimate,
    // and a compressed recording's size says little (a low bitrate fits minutes in a few hundred KB).
    const measured = reply.heardSeconds !== null && Number.isFinite(reply.heardSeconds) ? billedSeconds(reply.heardSeconds) : null;
    const owed = measured !== null ? measured - seconds : 0;
    if (owed > 0) {
      const [userTrueUp, globalTrueUp] = await Promise.all([
        spendUserBudget({ token, userId: user.id, bucket: "liveTranscribeDaySeconds", amount: owed }),
        spendGlobalBudget("liveTranscribeSeconds", owed),
      ]);
      log.info({ estimated: seconds, heard: measured, owed, userOk: userTrueUp.ok, globalOk: globalTrueUp.ok }, "transcribe: the budgets trued up with Scribe's length");
    }
    if (measured !== null && measured > MAX_AUDIO_SECONDS) {
      // longer than the mic ever records: a long recording in a small file. Counted, but no words back.
      log.warn({ kind, bytes: bytes.length, estimated: seconds, heard: measured }, "transcribe: Scribe heard more than the mic records: refused");
      recordRouteEvent(log, {
        level: "warn",
        code: "too_long",
        message: `A ${kind} recording of ${bytes.length} bytes held ${measured} s of audio (the mic records at most ${ASK_LIMITS.audioSeconds} s)`,
        meta: { kind, bytes: bytes.length, estimated: seconds, heard: measured },
      });
      return withRequestId(json(413, "invalid_request", TOO_LONG_MESSAGE), requestId);
    }

    // the words' length, never the words
    log.info(
      { chars: reply.text.length, kind, bytes: bytes.length, seconds: length.seconds, heardSeconds: reply.heardSeconds, language: reply.language, model: SCRIBE_BATCH.model, ms: Date.now() - startedAt },
      "speech transcribed",
    );
    return withRequestId(heard(reply.text), requestId);
  } catch (err) {
    return withRequestId(errorResponse(err, log, { ms: Date.now() - startedAt, bytes: bytes.length, seconds: length.seconds }), requestId);
  } finally {
    clearTimeout(timer);
  }
}
