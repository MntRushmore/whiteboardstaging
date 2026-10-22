import { SatAttemptRequestSchema } from "@/lib/sat/contracts";
import { isCorrect } from "@/lib/sat/answer";
import { json, requireUser } from "@/lib/server/auth";
import { withRequestId } from "@/lib/server/live-route";
import { checkRateLimitDistributed, rateLimitedResponse } from "@/lib/server/rate-limit";
import { parseJsonBody } from "@/lib/server/request";
import { satHeaders, satLogger } from "@/lib/server/sat/http";
import { insertAttempt, readQuestions } from "@/lib/server/sat/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/sat/attempts {question_id, chosen, correct, seconds, used_tutor} — one checked answer
 * (docs/SAT-MODE.md): `{ ok: true, correct }`.
 *
 * Saved with the student's own token (owner-only RLS). `correct` is decided here, from the bank's
 * answer (src/lib/sat/answer.ts: an mcq's key, or a grid-in in any accepted form), so progress and
 * the estimate never rest on what a client said; the client's own verdict is only compared and
 * logged when it differs. The answer carries the server's verdict back (additive).
 *
 * requireUser (401) -> `satAttempt` (429) -> the body (400) -> a live question (404) -> 429 past
 * the account's 2,000 answers a day -> 502 when it could not be saved. Never charged.
 */
export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  const headers = satHeaders(requestId);
  const auth = await requireUser(req);
  if ("response" in auth) return withRequestId(auth.response, requestId);
  const { user, token } = auth;
  const log = satLogger.child({ requestId, route: "sat/attempts", userId: user.id });

  const rl = await checkRateLimitDistributed({ token, userId: user.id, bucket: "satAttempt" });
  if (!rl.ok) return withRequestId(rateLimitedResponse(rl.retryAfterMs, rl.backend), requestId);

  const parsed = await parseJsonBody(req, SatAttemptRequestSchema);
  if ("response" in parsed) return withRequestId(parsed.response, requestId);
  const body = parsed.data;

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
    log.info({ questionId: body.question_id, correct, usedTutor: body.used_tutor, seconds: body.seconds }, "sat attempt");
    return Response.json({ ok: true, correct }, { headers });
  } catch (err) {
    log.error({ error: err instanceof Error ? err.message : String(err) }, "sat attempt failed");
    return json(502, "upstream_error", "Your answer couldn't be saved. Try again in a moment.", { requestId }, headers);
  }
}
