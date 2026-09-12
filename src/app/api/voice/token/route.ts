import { voiceLogger } from "@/lib/logger";
import { getServerEnv, hasOpenAI } from "@/lib/env";
import { json, requireUser } from "@/lib/server/auth";
import { LIMITS, checkRateLimit, rateLimitKey, rateLimitedResponse } from "@/lib/server/rate-limit";
import { UpstreamError } from "@/lib/server/openrouter";
import { errorResponse } from "@/lib/server/request";

const REALTIME_MODEL = "gpt-realtime";
const CLIENT_SECRETS_URL = "https://api.openai.com/v1/realtime/client_secrets";
const LEGACY_SESSIONS_URL = "https://api.openai.com/v1/realtime/sessions";

type RealtimeTokenResponse = {
  value?: unknown;
  client_secret?: { value?: unknown } | string;
  client_secret_key?: unknown;
};

/** Pull the ephemeral secret out of either response shape. */
function extractClientSecret(data: RealtimeTokenResponse | null | undefined): string | null {
  if (!data) return null;
  const candidates: unknown[] = [
    data.value,
    typeof data.client_secret === "object" && data.client_secret ? data.client_secret.value : undefined,
    data.client_secret,
    data.client_secret_key,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.length > 0) return c;
  }
  return null;
}

/**
 * Creates an ephemeral Realtime session with OpenAI and returns the client secret
 * that the browser can use to establish a WebRTC connection.
 *
 * Tries the current `/v1/realtime/client_secrets` endpoint first and falls
 * back to the legacy `/v1/realtime/sessions` endpoint if OpenAI rejects it.
 */
export async function POST(req: Request) {
  const startTime = Date.now();
  const requestId = crypto.randomUUID();

  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;
  const { user } = auth;

  const log = voiceLogger.child({ requestId, userId: user.id, task: "token" });

  if (!hasOpenAI()) {
    log.warn("OPENAI_API_KEY not configured; voice tutor unavailable");
    return json(
      503,
      "voice_unavailable",
      "The voice tutor isn't available right now. Please try again later or use the drawing tools.",
      {
        code: "MISSING_API_KEY",
        provider: "openai",
        envVar: "OPENAI_API_KEY",
        signupUrl: "https://platform.openai.com/api-keys",
      },
    );
  }

  const rl = checkRateLimit(rateLimitKey(user.id, "voiceToken"), LIMITS.voiceToken);
  if (!rl.ok) {
    log.warn({ retryAfterMs: rl.retryAfterMs }, "Voice token rate limited");
    return rateLimitedResponse(rl.retryAfterMs);
  }

  const headers = {
    Authorization: `Bearer ${getServerEnv().OPENAI_API_KEY}`,
    "Content-Type": "application/json",
  };

  try {
    // 1) Current contract: POST /v1/realtime/client_secrets
    let response = await fetch(CLIENT_SECRETS_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ session: { type: "realtime", model: REALTIME_MODEL } }),
      signal: req.signal,
    });
    let endpoint: "client_secrets" | "sessions" = "client_secrets";

    // 2) Legacy fallback: POST /v1/realtime/sessions
    if (response.status === 404 || response.status === 400) {
      const rejected = await response.text().catch(() => "");
      log.info({ status: response.status, body: rejected.slice(0, 500) }, "client_secrets endpoint rejected; falling back to legacy sessions endpoint");
      response = await fetch(LEGACY_SESSIONS_URL, {
        method: "POST",
        headers,
        body: JSON.stringify({ model: REALTIME_MODEL }),
        signal: req.signal,
      });
      endpoint = "sessions";
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      log.error({ endpoint, status: response.status, error: errorText.slice(0, 1000) }, "Failed to create Realtime session");
      throw new UpstreamError(response.status, `OpenAI Realtime ${endpoint} request failed (${response.status})`);
    }

    const data = (await response.json()) as RealtimeTokenResponse;
    const clientSecret = extractClientSecret(data);

    if (!clientSecret) {
      log.error({ endpoint, rawResponseSnippet: JSON.stringify(data).slice(0, 1000) }, "Realtime session created but client secret missing or invalid");
      throw new UpstreamError(502, "Realtime session created but client secret missing");
    }

    const duration = Date.now() - startTime;
    log.info({ endpoint, duration }, "Realtime session token created successfully");

    return Response.json({ client_secret: clientSecret });
  } catch (error) {
    return errorResponse(error, log, { duration: Date.now() - startTime });
  }
}
