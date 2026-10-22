import { SAT_LIMITS, SatTutorRequestSchema } from "@/lib/sat/contracts";
import { isTimeZone, localDay } from "@/lib/sat/day";
import { satFreeTutorPerDay } from "@/lib/env";
import { json, requireUser } from "@/lib/server/auth";
import { withRequestId } from "@/lib/server/live-route";
import { checkRateLimitDistributed, rateLimitedResponse } from "@/lib/server/rate-limit";
import { parseJsonBody } from "@/lib/server/request";
import { satHeaders, satLogger } from "@/lib/server/sat/http";
import { satStoreDeps, takeTutorPass } from "@/lib/server/sat/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/sat/tutor {question_id, tz} — may the live tutor help on this question today?
 * (docs/SAT-MODE.md): `{ allowed, used_today, cap, unlimited }`.
 *
 * Without Agathon Unlimited a student has SAT_FREE_TUTOR_PER_DAY free tutor questions a day (default
 * 5), counted on their own date (`tz`, an IANA zone). Asking takes one pass for the question, once:
 * the same question on the same day is allowed again without a second pass (idempotent). Unlimited is
 * always allowed (the pass is still recorded, so `used_today` counts it). When `allowed` is false the
 * app keeps the tutor off for that page; the live routes refuse an SAT call without a pass anyway
 * (enforceInk, src/lib/server/billing.ts).
 *
 * The pass is taken by `sat_take_tutor_pass` with the service role, under a per-profile lock, so
 * parallel calls cannot pass the cap. requireUser (401) -> `satTutor` (429) -> the body and the zone
 * (400) -> a live question (404) -> 503 without the service role -> 502 when the database failed.
 */
export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  const headers = satHeaders(requestId);
  const auth = await requireUser(req);
  if ("response" in auth) return withRequestId(auth.response, requestId);
  const { user, token } = auth;
  const log = satLogger.child({ requestId, route: "sat/tutor", userId: user.id });

  const rl = await checkRateLimitDistributed({ token, userId: user.id, bucket: "satTutor" });
  if (!rl.ok) return withRequestId(rateLimitedResponse(rl.retryAfterMs, rl.backend), requestId);

  const parsed = await parseJsonBody(req, SatTutorRequestSchema);
  if ("response" in parsed) return withRequestId(parsed.response, requestId);
  const { question_id, tz } = parsed.data;
  if (!isTimeZone(tz)) return json(400, "invalid_request", "tz must be an IANA time zone, like America/New_York.", { requestId }, headers);

  const day = localDay(tz, satStoreDeps.now());
  const cap = satFreeTutorPerDay(SAT_LIMITS.freeTutorPerDay);
  try {
    const pass = await takeTutorPass(user.id, question_id, day, cap);
    if (pass === "missing") return json(404, "not_found", "That question is not in the bank.", { requestId }, headers);
    if (pass === "no_service") {
      log.error("sat tutor: SUPABASE_SERVICE_ROLE_KEY is not set");
      return json(503, "feature_unavailable", "The SAT tutor is not set up on this deployment.", { requestId }, headers);
    }
    log.info({ questionId: question_id, day, ...pass }, "sat tutor pass");
    return Response.json(pass, { headers });
  } catch (err) {
    log.error({ error: err instanceof Error ? err.message : String(err) }, "sat tutor pass failed");
    return json(502, "upstream_error", "The tutor couldn't be checked. Try again in a moment.", { requestId }, headers);
  }
}
