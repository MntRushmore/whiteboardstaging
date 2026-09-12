import { logger } from "@/lib/logger";
import { requireUser } from "@/lib/server/auth";
import { LIMITS, checkRateLimit, rateLimitKey, rateLimitedResponse } from "@/lib/server/rate-limit";
import { OPENROUTER_CREDITS_URL, UpstreamError, openrouterHeaders } from "@/lib/server/openrouter";
import { errorResponse } from "@/lib/server/request";

const creditsLogger = logger.child({ module: "credits" });

type CreditPayload = {
  total: number;
  used: number;
  remaining: number;
};

// Cache credit results for 30s so we don't hammer OpenRouter on every dashboard load.
// Shared across users on purpose: the balance is account-wide, not per user.
let cache: { data: CreditPayload; expiresAt: number } | null = null;
const TTL_MS = 30_000;

export async function GET(req: Request) {
  const requestId = crypto.randomUUID();

  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;
  const { user } = auth;

  const log = creditsLogger.child({ requestId, userId: user.id });

  const rl = checkRateLimit(rateLimitKey(user.id, "credits"), LIMITS.credits);
  if (!rl.ok) return rateLimitedResponse(rl.retryAfterMs);

  if (cache && cache.expiresAt > Date.now()) {
    return Response.json(cache.data, { headers: { "Cache-Control": "private, no-store" } });
  }

  try {
    const res = await fetch(OPENROUTER_CREDITS_URL, {
      headers: { Authorization: openrouterHeaders().Authorization },
      cache: "no-store",
      signal: req.signal,
    });

    if (!res.ok) {
      throw new UpstreamError(res.status, `OpenRouter credits request failed (${res.status})`);
    }

    const body = (await res.json()) as { data?: { total_credits?: unknown; total_usage?: unknown } };
    const total = Number(body?.data?.total_credits ?? 0);
    const used = Number(body?.data?.total_usage ?? 0);
    const payload: CreditPayload = {
      total: Number.isFinite(total) ? total : 0,
      used: Number.isFinite(used) ? used : 0,
      remaining: Math.max(0, (Number.isFinite(total) ? total : 0) - (Number.isFinite(used) ? used : 0)),
    };

    cache = { data: payload, expiresAt: Date.now() + TTL_MS };
    log.debug({ remaining: payload.remaining }, "Credits refreshed");
    return Response.json(payload, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error, log);
  }
}
