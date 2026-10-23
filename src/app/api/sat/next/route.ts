import { SatNextQuerySchema, type SatNextResponse } from "@/lib/sat/contracts";
import { isTimeZone, localDay } from "@/lib/sat/day";
import { pickQuestions } from "@/lib/sat/pick";
import { dueReviews } from "@/lib/sat/reviews";
import { json, requireUser } from "@/lib/server/auth";
import { withRequestId } from "@/lib/server/live-route";
import { checkRateLimitDistributed, rateLimitedResponse } from "@/lib/server/rate-limit";
import { readAttempts, readBankMeta, readOpenReviews, readQuestions, satStoreDeps } from "@/lib/server/sat/store";
import { satLogger, satHeaders } from "@/lib/server/sat/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/sat/next?count=10&domain=&skill=&difficulty=&tz= — the next SAT questions for the
 * student (docs/SAT-MODE.md, docs/SAT-V2.md): `{ questions: [SATQuestion & {review}] }`, each with
 * its answer, solution and the bank's optional notes (`nudge`, `choices[].why`, `common_wrong`,
 * `solution.desmos_steps`, passed through unchanged; free practice: the iPad checks answers offline
 * and at once).
 *
 * The set starts with the mistake deck: the student's reviews due today (or overdue) in their zone
 * (`tz`, an IANA zone; UTC when absent), oldest first, within the same domain / skill / difficulty
 * filter, `review: true`. The rest (`review: false`) is the adaptive pick over the other questions.
 *
 * The pick is adaptive (src/lib/sat/pick.ts): unseen first, weak skills weighted up, difficulty
 * following the last ~10 answers in each domain, the section's domain mix, and no question again
 * within 30 days unless the bank (or the filter) is exhausted. Fewer than `count` only when the
 * live bank has fewer matching questions; an empty bank is `{ questions: [] }`.
 *
 * requireUser (401) -> `satRead` (429) -> the query and zone (400) -> 502 when the bank could not be read.
 * Never charged; no-store.
 */
export async function GET(req: Request) {
  const requestId = crypto.randomUUID();
  const headers = satHeaders(requestId);
  // SAT mode works without an account: an anonymous session is welcome here
  const auth = await requireUser(req, { allowAnonymous: true });
  if ("response" in auth) return withRequestId(auth.response, requestId);
  const { user, token } = auth;
  const log = satLogger.child({ requestId, route: "sat/next", userId: user.id });

  const rl = await checkRateLimitDistributed({ token, userId: user.id, bucket: "satRead" });
  if (!rl.ok) return withRequestId(rateLimitedResponse(rl.retryAfterMs, rl.backend), requestId);

  const query = SatNextQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!query.success) {
    return json(400, "invalid_request", `Invalid query: ${query.error.issues[0]?.message ?? "bad value"}`, { requestId }, headers);
  }
  const { count, domain, skill, difficulty, tz } = query.data;
  if (!isTimeZone(tz)) return json(400, "invalid_request", "tz must be an IANA time zone, like America/New_York.", { requestId }, headers);

  try {
    const now = satStoreDeps.now();
    const [bank, attempts, reviews] = await Promise.all([readBankMeta(token), readAttempts(token, user.id), readOpenReviews(token, user.id)]);
    // the reviews due today first: live questions only, within the filter
    const meta = new Map(bank.map((q) => [q.id, q]));
    const fits = (id: string) => {
      const q = meta.get(id);
      return Boolean(q) && (!domain || q!.domain === domain) && (!skill || q!.skill === skill) && (!difficulty || q!.difficulty === difficulty);
    };
    const reviewIds = dueReviews(reviews, localDay(tz, now))
      .map((r) => r.question_id)
      .filter(fits)
      .slice(0, count);
    const due = new Set(reviewIds);
    const picked = pickQuestions({ bank: bank.filter((q) => !due.has(q.id)), attempts, count: count - reviewIds.length, filter: { domain, skill, difficulty }, now });
    const rows = await readQuestions(token, [...reviewIds, ...picked]);
    const questions: SatNextResponse["questions"] = rows.map((q) => ({ ...q, review: due.has(q.id) }));
    log.info({ count, domain, skill, difficulty, bank: bank.length, answered: attempts.length, reviews: reviewIds.length, picked: questions.length }, "sat next");
    return Response.json({ questions } satisfies SatNextResponse, { headers });
  } catch (err) {
    log.error({ error: err instanceof Error ? err.message : String(err) }, "sat next failed");
    return json(502, "upstream_error", "The questions couldn't be loaded. Try again in a moment.", { requestId }, headers);
  }
}
