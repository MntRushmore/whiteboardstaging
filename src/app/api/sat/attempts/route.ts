import { SatAttemptRequestSchema } from "@/lib/sat/contracts";
import { isCorrect } from "@/lib/sat/answer";
import { isTimeZone, localDay } from "@/lib/sat/day";
import { nextReview } from "@/lib/sat/reviews";
import { json, requireUser } from "@/lib/server/auth";
import { withRequestId } from "@/lib/server/live-route";
import { checkRateLimitDistributed, rateLimitedResponse } from "@/lib/server/rate-limit";
import { parseJsonBody } from "@/lib/server/request";
import { satHeaders, satLogger } from "@/lib/server/sat/http";
import { insertAttempt, readQuestions, readReview, satStoreDeps, writeReview } from "@/lib/server/sat/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/sat/attempts {question_id, chosen, correct, seconds, used_tutor, tz?} — one checked
 * answer (docs/SAT-MODE.md): `{ ok: true, correct }`.
 *
 * Saved with the student's own token (owner-only RLS). `correct` is decided here, from the bank's
 * answer (src/lib/sat/answer.ts: an mcq's key, or a grid-in in any accepted form), so progress and
 * the estimate never rest on what a client said; the client's own verdict is only compared and
 * logged when it differs. The answer carries the server's verdict back (additive).
 *
 * The mistake deck (docs/SAT-V2.md, src/lib/sat/reviews.ts): with the server's verdict, a miss
 * schedules the question for tomorrow (step 1), a right answer on a due review moves it to the
 * 3-day review or clears it, a miss on a review goes back to step 1. "Tomorrow" is the student's,
 * from `tz` (an IANA zone; UTC when absent). The answer is saved first; a deck write that fails is
 * logged and the answer still counts (`ok`), so a retry never saves it twice.
 *
 * requireUser (401) -> `satAttempt` (429) -> the body and zone (400) -> a live question (404) -> 429
 * past the account's 2,000 answers a day -> 502 when it could not be saved. Never charged.
 */
export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  const headers = satHeaders(requestId);
  // SAT mode works without an account: an anonymous session is welcome here
  const auth = await requireUser(req, { allowAnonymous: true });
  if ("response" in auth) return withRequestId(auth.response, requestId);
  const { user, token } = auth;
  const log = satLogger.child({ requestId, route: "sat/attempts", userId: user.id });

  const rl = await checkRateLimitDistributed({ token, userId: user.id, bucket: "satAttempt" });
  if (!rl.ok) return withRequestId(rateLimitedResponse(rl.retryAfterMs, rl.backend), requestId);

  const parsed = await parseJsonBody(req, SatAttemptRequestSchema);
  if ("response" in parsed) return withRequestId(parsed.response, requestId);
  const body = parsed.data;
  const tz = body.tz ?? "UTC";
  if (!isTimeZone(tz)) return json(400, "invalid_request", "tz must be an IANA time zone, like America/New_York.", { requestId }, headers);

  try {
    const [question] = await readQuestions(token, [body.question_id]);
    if (!question) return json(404, "not_found", "That question is not in the bank.", { requestId }, headers);
    const correct = isCorrect(question, body.chosen);
    if (correct !== body.correct) log.info({ questionId: body.question_id, client: body.correct, server: correct }, "sat attempt: the app's verdict differs; the bank's answer is kept");
    const saved = await insertAttempt(token, user.id, {
      question_id: body.question_id,
      chosen: body.chosen,
      correct,
      used_tutor: body.used_tutor,
      seconds: body.seconds,
    });
    if (saved === "cap") return json(429, "rate_limited", "That's a lot of answers for one day. Take a break and come back tomorrow.", { requestId }, headers);
    let review: string = "unchanged";
    try {
      const now = satStoreDeps.now();
      const existing = await readReview(token, user.id, body.question_id);
      const schedule = nextReview(existing, correct, localDay(tz, now), new Date(now).toISOString());
      if (schedule) {
        await writeReview(token, user.id, body.question_id, schedule, existing !== null);
        review = schedule.cleared_at ? "cleared" : `step ${schedule.step} due ${schedule.due_on}`;
      }
    } catch (err) {
      review = "failed";
      log.error({ questionId: body.question_id, error: err instanceof Error ? err.message : String(err) }, "sat attempt: the mistake deck could not be updated; the answer is saved");
    }
    log.info({ questionId: body.question_id, correct, usedTutor: body.used_tutor, seconds: body.seconds, review }, "sat attempt");
    return Response.json({ ok: true, correct }, { headers });
  } catch (err) {
    log.error({ error: err instanceof Error ? err.message : String(err) }, "sat attempt failed");
    return json(502, "upstream_error", "Your answer couldn't be saved. Try again in a moment.", { requestId }, headers);
  }
}
