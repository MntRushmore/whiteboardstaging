/**
 * The Training Center's server half: an admin-only area of the iPad app where the owner brute-tests
 * the tutor with real maths (a bench of problems written by the app, or his own handwriting with the
 * Pencil), and its results are kept in training_runs / training_cases
 * (supabase/migrations/20261020000000_training_center.sql).
 *
 * A training call is one of the five Live routes the iPad's tutor uses (TRAINING_ROUTES) with
 * `"training": true` in its JSON body. The Live schemas are not strict, so a server without this
 * code strips the flag and charges the call like any other; GET /api/training/status is how the app
 * tells the two apart before a bench (a 404 there: "this server would charge your ink").
 *
 * On a server with it, `livePreamble` (live-route.ts) runs `trainingGate` once the body has parsed,
 * after the route's own rate limit (which still applies):
 *  - the caller must be an admin (`adminStatus`, the cached service-role lookup behind requireAdmin):
 *    403 `forbidden` otherwise, 503 when that could not be checked. A non-admin's flag is refused,
 *    not ignored: a student's app never sends it, so whoever does is told plainly;
 *  - two buckets of its own, per admin (LIMITS.liveTraining, LIMITS.liveTrainingDay): training calls
 *    spend no ink, so these are what bound what a bench can cost;
 *  - each accepted call is an app event (`training_call`, info), so the admin page shows who benched
 *    when. The event writer collapses repeats (the same route and user within 30 s is one row), so a
 *    bench at a call a second is a row every half minute per route, not a flood.
 * Then `LiveContext.training` is true, and the route passes it to `enforceInk` and to every refund
 * (billing.ts): no ink, no fair-use count, nothing to give back.
 *
 * Only these five routes pass the context's flag on. Any other route on `livePreamble` (chat, ask,
 * proof, lecture, ...) runs the same gate for a body with the flag (a non-admin is refused there
 * too), but charges the admin's call as usual: the Training Center does not call them, and a route
 * spends no ink only where it says so in its own code.
 */
import type pino from "pino";
import { adminStatus } from "@/lib/server/admin";
import { json, type AuthedUser } from "@/lib/server/auth";
import type { BillableRoute } from "@/lib/server/billing";
import { checkRateLimitDistributed, LIMITS, rateLimitedResponse, type RateLimitBucket } from "@/lib/server/rate-limit";
import { recordRouteEvent } from "@/lib/server/request";

/** The Live routes whose training calls spend no ink (each passes `training: ctx.training` to billing). */
export const TRAINING_ROUTES = ["live/recognize", "live/reread", "live/setup", "live/check", "live/solve"] as const satisfies readonly BillableRoute[];

/** Training buckets, checked in this order: a call refused by the minute is not counted against the day. */
const TRAINING_BUCKETS: readonly RateLimitBucket[] = ["liveTraining", "liveTrainingDay"];

const TRAINING_FORBIDDEN_MESSAGE = "Training calls are for admins.";
const TRAINING_UNAVAILABLE_MESSAGE = "Training access could not be checked right now. Try again in a minute.";

/** Does this request body ask for a training call? Only the boolean `true` does. */
export function wantsTraining(raw: unknown): boolean {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw as Record<string, unknown>).training === true;
}

/**
 * Let a training call through, or answer why not (403 not an admin, 503 the admin lookup failed,
 * 429 over a training bucket). The caller has verified `user` and `token` (requireUser) and sets
 * `LiveContext.training` only on `{ ok: true }`.
 */
export async function trainingGate({ user, token, log }: { user: AuthedUser; token: string; log: pino.Logger }): Promise<{ ok: true } | { response: Response }> {
  const admin = await adminStatus(user.id);
  if (admin === null) {
    log.warn("training call refused: the admin lookup failed");
    return { response: json(503, "feature_unavailable", TRAINING_UNAVAILABLE_MESSAGE) };
  }
  if (!admin) {
    log.warn("training call refused: not an admin");
    return { response: json(403, "forbidden", TRAINING_FORBIDDEN_MESSAGE) };
  }

  for (const bucket of TRAINING_BUCKETS) {
    const rl = await checkRateLimitDistributed({ token, userId: user.id, bucket });
    if (!rl.ok) {
      log.warn({ bucket, retryAfterMs: rl.retryAfterMs, backend: rl.backend }, "training call rate limited");
      return { response: rateLimitedResponse(rl.retryAfterMs, rl.backend) };
    }
  }

  recordRouteEvent(log, { level: "info", code: "training_call", message: "A training call (admin, no ink)", meta: { training: true } });
  return { ok: true };
}

/** GET /api/training/status's answer: this server takes training calls, on these routes, within these limits. */
export function trainingStatus(): { training: true; routes: string[]; limits: { perMinute: number; perDay: number } } {
  return {
    training: true,
    routes: [...TRAINING_ROUTES],
    limits: { perMinute: LIMITS.liveTraining.limit, perDay: LIMITS.liveTrainingDay.limit },
  };
}
