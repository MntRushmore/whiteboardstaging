import { getServerEnv, hasElevenLabs } from "@/lib/env";
import { spokenText } from "@/lib/speech/spoken";
import { SpeakRequestSchema, TTS, ttsBody, ttsRefusal, ttsUrl, voiceIdOr } from "@/lib/speech/tts";
import { json } from "@/lib/server/auth";
import { livePreamble, withRequestId } from "@/lib/server/live-route";
import { UpstreamError } from "@/lib/server/openrouter";
import { checkRateLimitDistributed, rateLimitedResponse } from "@/lib/server/rate-limit";
import { errorResponse, recordRouteEvent } from "@/lib/server/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const UNAVAILABLE_MESSAGE = "Read aloud's voice is not set up on this deployment.";

/** 503 `feature_unavailable`: the client says it with the browser's own voice instead. */
function unavailable(): Response {
  return json(503, "feature_unavailable", UNAVAILABLE_MESSAGE, undefined, { "Cache-Control": "no-store" });
}

/**
 * POST /api/live/speak — read aloud: the tutor's words (a hint, a question, a coach mark) as
 * speech, so a child who cannot read yet hears them. `{ text }` in (plain words, at most
 * SPEAK_MAX_CHARS: `SpeakRequest`), `audio/mpeg` out, streamed from ElevenLabs as it is made
 * (`src/lib/speech/tts.ts` says which model and voice, and why).
 *
 * requireUser → the `liveSpeak` minute budget → the body → the `liveSpeakDay` cap → without
 * ELEVENLABS_API_KEY a 503 `feature_unavailable` (the client falls back to the browser's voice) →
 * ElevenLabs. The text is made speakable again here (`spokenText`), so a client that sent LaTeX
 * still gets words.
 *
 * Not charged: a hint the tutor already wrote should not cost ink twice, and a five-year-old never
 * asked for it; the two budgets bound the bill instead. What it costs shows in the log line (the
 * characters sent). A refusal no retry fixes (a key without the Text to Speech permission, spent
 * quota, an unknown voice) is answered like a missing key and recorded for the /admin page
 * (`route.live.speak`); any other failure is a 502 through `errorResponse`, also recorded.
 */
export async function POST(req: Request) {
  const ctx = await livePreamble(req, "speak", "liveSpeak", SpeakRequestSchema);
  if ("response" in ctx) return ctx.response;
  const { requestId, user, token, log, data, startedAt } = ctx;

  const day = await checkRateLimitDistributed({ token, userId: user.id, bucket: "liveSpeakDay" });
  if (!day.ok) {
    log.warn({ retryAfterMs: day.retryAfterMs, backend: day.backend }, "read aloud: the day's cap is reached");
    return withRequestId(rateLimitedResponse(day.retryAfterMs, day.backend), requestId);
  }

  if (!hasElevenLabs()) {
    log.info("ELEVENLABS_API_KEY is not set: the browser's voice");
    return withRequestId(unavailable(), requestId);
  }

  const text = spokenText(data.text);
  if (!text) return withRequestId(json(400, "invalid_request", "Nothing to say."), requestId);

  const env = getServerEnv();
  const voice = voiceIdOr(env.LIVE_VOICE_ID);
  if (voice.ignored) log.warn("LIVE_VOICE_ID is not a voice id: the default voice");

  // The first byte must come quickly; the stream itself may take as long as the phrase does.
  const firstByte = new AbortController();
  const timer = setTimeout(() => firstByte.abort(), TTS.firstByteTimeoutMs);
  try {
    let upstream: Response;
    try {
      upstream = await fetch(ttsUrl(voice.voiceId), {
        method: "POST",
        headers: { "xi-api-key": env.ELEVENLABS_API_KEY ?? "", "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify(ttsBody(text)),
        cache: "no-store",
        signal: AbortSignal.any([req.signal, firstByte.signal]),
      });
    } catch (err) {
      if (firstByte.signal.aborted && !req.signal.aborted) throw new UpstreamError(504, "ElevenLabs text-to-speech did not answer in time");
      throw err;
    } finally {
      clearTimeout(timer);
    }

    if (!upstream.ok) {
      const body = await upstream.json().catch(() => null);
      const refusal = ttsRefusal(upstream.status, body);
      if (refusal) {
        log.error({ upstreamStatus: upstream.status, refusal: refusal.kind, detail: refusal.detail }, "ElevenLabs refused text-to-speech: the browser's voice");
        recordRouteEvent(log, {
          level: "error",
          code: refusal.kind === "quota" ? "quota" : refusal.kind === "voice" ? "voice" : "unauthorized",
          message: `ElevenLabs refused text-to-speech (${upstream.status}${refusal.detail ? `, ${refusal.detail}` : ""})`,
          meta: { upstreamStatus: upstream.status, voice: voice.voiceId },
        });
        return withRequestId(unavailable(), requestId);
      }
      throw new UpstreamError(upstream.status, `ElevenLabs text-to-speech failed (${upstream.status})`);
    }
    if (!upstream.body) throw new UpstreamError(502, "ElevenLabs text-to-speech sent no audio");

    log.info({ chars: text.length, voice: voice.voiceId, model: TTS.model, ms: Date.now() - startedAt }, "speech started");
    return withRequestId(
      new Response(upstream.body, {
        status: 200,
        headers: {
          "Content-Type": "audio/mpeg",
          // one student's request: never kept by a shared cache (the client keeps its own copy)
          "Cache-Control": "private, no-store",
          "X-Speech-Chars": String(text.length),
        },
      }),
      requestId,
    );
  } catch (err) {
    return withRequestId(errorResponse(err, log, { ms: Date.now() - startedAt, chars: text.length }), requestId);
  }
}
