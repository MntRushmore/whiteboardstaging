import { getServerEnv, hasElevenLabs } from "@/lib/env";
import { LISTEN_NOT_CONFIGURED, ListenTokenResponseSchema, type ListenTokenResponse } from "@/lib/live/lecture/contracts";
import { SCRIBE, scribeSocketUrl } from "@/lib/live/lecture/speech/scribe";
import { requireUser } from "@/lib/server/auth";
import { enforceInk, runCharged } from "@/lib/server/billing";
import { liveLogger, withRequestId } from "@/lib/server/live-route";
import { UpstreamError } from "@/lib/server/openrouter";
import { checkRateLimitDistributed, rateLimitedResponse } from "@/lib/server/rate-limit";
import { errorResponse } from "@/lib/server/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

/** Minting a token is one small call; a stuck one should not hold the lecture's start. */
const TOKEN_TIMEOUT_MS = 8_000;

const NOT_CONFIGURED_MESSAGE = "Realtime transcription is not set up on this deployment.";

/** 503 `listen_not_configured`: the client falls back to the browser's own recognizer. */
function notConfigured(): Response {
  return Response.json({ error: LISTEN_NOT_CONFIGURED, message: NOT_CONFIGURED_MESSAGE }, { status: 503, headers: { "Cache-Control": "no-store" } });
}

/**
 * POST /api/live/lecture/token — a single-use ElevenLabs token for one realtime speech-to-text
 * session (Scribe v2 Realtime), so the browser streams the microphone straight to the recognizer
 * and our key never leaves the server. The answer carries the socket URL with the token and the
 * session's settings already on it (`scribeSocketUrl`), so the client cannot drift from them.
 *
 * No body: the handler never reads one (NO_BODY_ROUTES in scripts/lib/routes.mjs).
 * requireUser → the `liveListen` budget (a reconnect opens another session, so a few a minute) →
 * without ELEVENLABS_API_KEY a 503 `listen_not_configured` with nothing charged → `live/listen`
 * (1 ink) up front → the token, refunded by `runCharged` on any non-2xx. A key ElevenLabs
 * rejects (401/403) is answered like a missing one, so the lecture still starts on the browser's
 * recognizer instead of failing for everyone until an operator notices.
 */
export async function POST(req: Request) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();

  const auth = await requireUser(req);
  if ("response" in auth) return withRequestId(auth.response, requestId);
  const { user, token } = auth;
  const log = liveLogger.child({ requestId, route: "lecture/token", userId: user.id });

  const rl = await checkRateLimitDistributed({ token, userId: user.id, bucket: "liveListen" });
  if (!rl.ok) {
    log.warn({ retryAfterMs: rl.retryAfterMs, backend: rl.backend }, "rate limited");
    return withRequestId(rateLimitedResponse(rl.retryAfterMs, rl.backend), requestId);
  }

  if (!hasElevenLabs()) {
    log.info("ELEVENLABS_API_KEY is not set: the browser's recognizer");
    return withRequestId(notConfigured(), requestId);
  }

  const billing = await enforceInk({ token, route: "live/listen", requestId, model: SCRIBE.model }, log);
  if ("response" in billing) return withRequestId(billing.response, requestId);

  return runCharged(
    { token, requestId },
    log,
    async () => {
      const key = getServerEnv().ELEVENLABS_API_KEY ?? "";
      const res = await fetch(SCRIBE.tokenUrl, {
        method: "POST",
        headers: { "xi-api-key": key },
        cache: "no-store",
        signal: AbortSignal.any([req.signal, AbortSignal.timeout(TOKEN_TIMEOUT_MS)]),
      });
      if (res.status === 401 || res.status === 403) {
        log.error({ upstreamStatus: res.status }, "ElevenLabs rejected the API key: the browser's recognizer");
        return withRequestId(notConfigured(), requestId);
      }
      if (!res.ok) throw new UpstreamError(res.status, `ElevenLabs single-use token failed (${res.status})`);
      const raw = (await res.json().catch(() => null)) as { token?: unknown } | null;
      if (!raw || typeof raw.token !== "string" || !raw.token) throw new UpstreamError(502, "ElevenLabs single-use token: no token in the reply");

      const body: ListenTokenResponse = ListenTokenResponseSchema.parse({
        provider: "elevenlabs",
        token: raw.token,
        url: scribeSocketUrl(raw.token),
        expiresAt: Date.now() + SCRIBE.tokenTtlMs - SCRIBE.tokenSafetyMs,
      });
      log.info({ ms: Date.now() - startedAt }, "listen token minted");
      return withRequestId(Response.json(body, { headers: { "Cache-Control": "no-store" } }), requestId);
    },
    (err) => withRequestId(errorResponse(err, log, { ms: Date.now() - startedAt }), requestId),
  );
}
