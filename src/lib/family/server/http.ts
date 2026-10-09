/**
 * What the /api/family routes share once the caller is signed in and within their rate limit: the
 * store (503 without the service role), the answer for a refusal (`Refusal`, src/lib/family/server
 * /service.ts) or a success, a path id (400 unless a uuid) and a failure (502). Every answer is
 * no-store and carries the request id: these answers name family members and carry sessions.
 */
import type pino from "pino";
import { z } from "zod";
import { json } from "@/lib/server/auth";
import { rateLimitedResponse } from "@/lib/server/rate-limit";
import type { Outcome } from "./service";
import { familyDeps, type FamilyStore } from "./store";

export const NO_STORE = { "Cache-Control": "no-store" } as const;

/** The store, or the answer when the server cannot reach the family tables. */
export function familyStore(log: pino.Logger, requestId: string): { store: FamilyStore } | { response: Response } {
  let store: FamilyStore | null;
  try {
    store = familyDeps.store();
  } catch (err) {
    log.error({ requestId, err: err instanceof Error ? err.message : String(err) }, "family: server env invalid");
    return { response: json(500, "internal_error", "The server's environment is not set up.", { requestId }, NO_STORE) };
  }
  if (!store) return { response: json(503, "feature_unavailable", "Families are not set up on this deployment (SUPABASE_SERVICE_ROLE_KEY).", { requestId }, NO_STORE) };
  return { store };
}

/** An outcome as the route's answer: the value as JSON, or the refusal's status and words. */
export function answer<T>(outcome: Outcome<T>, requestId: string, status = 200): Response {
  if (outcome.ok) return Response.json(outcome.value, { status, headers: { ...NO_STORE, "X-Request-Id": requestId } });
  if (outcome.status === 429) {
    const retryAfterMs = outcome.retryAfterMs ?? 60_000;
    const res = rateLimitedResponse(retryAfterMs, outcome.backend);
    res.headers.set("Cache-Control", "no-store");
    res.headers.set("X-Request-Id", requestId);
    if (!outcome.extra) return res;
    // A family limit with its own words and `reason` (a locked PIN, the kids added today): the same
    // 429 shape and Retry-After, with the refusal's message and extra.
    return json(429, "rate_limited", outcome.message, { retryAfterMs, ...(outcome.backend ? { backend: outcome.backend } : {}), requestId, ...outcome.extra }, res.headers);
  }
  return json(outcome.status, outcome.code, outcome.message, { requestId, ...(outcome.extra ?? {}) }, { ...NO_STORE, "X-Request-Id": requestId });
}

/** A kid's id in the path: a uuid, or the 400 to answer. */
export async function parseKidId(params: Promise<{ id: string }>, requestId: string): Promise<{ id: string } | { response: Response }> {
  const parsed = z.string().uuid().safeParse((await params).id);
  return parsed.success ? { id: parsed.data } : { response: json(400, "invalid_request", "The profile id must be a uuid.", { requestId }, NO_STORE) };
}

/** Something failed after the checks (a read, a write, Auth): 502, logged with what. */
export function familyFailure(err: unknown, ctx: { log: pino.Logger; requestId: string; userId: string; what: string }): Response {
  ctx.log.error({ requestId: ctx.requestId, userId: ctx.userId, err: err instanceof Error ? err.message : String(err) }, `family ${ctx.what} failed`);
  return json(502, "upstream_error", "Something went wrong on our side. Try again in a moment.", { requestId: ctx.requestId }, { ...NO_STORE, "X-Request-Id": ctx.requestId });
}

/** The caller's time zone offset from `?tz=` (minutes behind UTC, Date#getTimezoneOffset); 0 if absent or odd. */
export function tzOffsetOf(req: Request): number {
  const raw = new URL(req.url).searchParams.get("tz");
  const parsed = z.coerce.number().int().min(-840).max(840).safeParse(raw ?? undefined);
  return parsed.success ? parsed.data : 0;
}
