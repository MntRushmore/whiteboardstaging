import type { z } from "zod";
import type pino from "pino";
import { logger } from "@/lib/logger";
import { requireUser, type AuthedUser } from "@/lib/server/auth";
import { LIMITS, checkRateLimit, rateLimitKey, rateLimitedResponse, type RateLimitBucket } from "@/lib/server/rate-limit";
import { parseJsonBody } from "@/lib/server/request";
import { CreditsExhaustedError, UpstreamError } from "@/lib/server/openrouter";

/** Shared plumbing for the /api/live/* route handlers. */

export const liveLogger = logger.child({ module: "live" });

export const REQUEST_ID_HEADER = "X-Request-Id";

/** Attach `X-Request-Id` to any Response (falls back to a copy when headers are immutable). */
export function withRequestId(res: Response, requestId: string): Response {
  try {
    res.headers.set(REQUEST_ID_HEADER, requestId);
    return res;
  } catch {
    const headers = new Headers(res.headers);
    headers.set(REQUEST_ID_HEADER, requestId);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  }
}

export type LiveContext<T> = {
  requestId: string;
  user: AuthedUser;
  /** Verified access token (for acting as the user, e.g. `enforceCredits`). */
  token: string;
  log: pino.Logger;
  data: T;
  startedAt: number;
};

/**
 * Route preamble: requireUser -> checkRateLimit -> parseJsonBody.
 * Returns `{ response }` (already carrying X-Request-Id) on any failure.
 */
export async function livePreamble<S extends z.ZodTypeAny>(
  req: Request,
  route: string,
  bucket: RateLimitBucket,
  schema: S,
): Promise<LiveContext<z.infer<S>> | { response: Response }> {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();

  const auth = await requireUser(req);
  if ("response" in auth) return { response: withRequestId(auth.response, requestId) };
  const { user, token } = auth;
  const log = liveLogger.child({ requestId, route, userId: user.id });

  const rl = checkRateLimit(rateLimitKey(user.id, bucket), LIMITS[bucket]);
  if (!rl.ok) {
    log.warn({ retryAfterMs: rl.retryAfterMs }, "rate limited");
    return { response: withRequestId(rateLimitedResponse(rl.retryAfterMs), requestId) };
  }

  const parsed = await parseJsonBody(req, schema);
  if ("response" in parsed) {
    log.warn("invalid request body");
    return { response: withRequestId(parsed.response, requestId) };
  }

  return { requestId, user, token, log, data: parsed.data, startedAt };
}

/** Map a thrown error to the SSE `error` frame payload (same codes as the JSON error contract). */
export function sseErrorPayload(err: unknown): { error: string; message: string } {
  if (err instanceof CreditsExhaustedError) return { error: "credits_exhausted", message: err.message };
  if (err instanceof UpstreamError) {
    return { error: "upstream_error", message: "The AI service returned an error. Please try again." };
  }
  if (err instanceof Error && err.name === "AbortError") return { error: "internal_error", message: "Request was cancelled." };
  return { error: "internal_error", message: "Something went wrong on our side. Please try again." };
}
