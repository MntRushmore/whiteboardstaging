import type { z } from "zod";
import type pino from "pino";
import { logger } from "@/lib/logger";
import { requireUser, type AuthedUser } from "@/lib/server/auth";
import { checkRateLimitDistributed, rateLimitedResponse, type RateLimitBucket } from "@/lib/server/rate-limit";
import { parseJsonBody } from "@/lib/server/request";
import { refundCredits, type RefundInput, type RpcClient } from "@/lib/server/billing";
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
 * Route preamble: requireUser -> checkRateLimitDistributed -> parseJsonBody.
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

  const rl = await checkRateLimitDistributed({ token, userId: user.id, bucket });
  if (!rl.ok) {
    log.warn({ retryAfterMs: rl.retryAfterMs, backend: rl.backend }, "rate limited");
    return { response: withRequestId(rateLimitedResponse(rl.retryAfterMs, rl.backend), requestId) };
  }

  const parsed = await parseJsonBody(req, schema);
  if ("response" in parsed) {
    log.warn("invalid request body");
    return { response: withRequestId(parsed.response, requestId) };
  }

  return { requestId, user, token, log, data: parsed.data, startedAt };
}

/**
 * Run the body of a charged SSE route. When `run` rejects BEFORE anything billable was
 * delivered (`delivered()` is false: no annotation / no step emitted yet), the charge for
 * `input.requestId` is refunded and the error is rethrown so `sseResponse` still emits the
 * `error` frame. A failure after the first item is NOT refunded: the user received
 * (and keeps) partial output, and the model was paid for it.
 */
export async function runChargedStream(
  input: RefundInput,
  log: pino.Logger,
  delivered: () => boolean,
  run: () => Promise<void>,
  client?: RpcClient,
): Promise<void> {
  try {
    await run();
  } catch (err) {
    if (delivered()) {
      log.info({ requestId: input.requestId }, "stream failed after partial output; charge kept");
    } else {
      await refundCredits(input, log, client);
    }
    throw err;
  }
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
