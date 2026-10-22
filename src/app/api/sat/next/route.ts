import { SatNextQuerySchema } from "@/lib/sat/contracts";
import { pickQuestions } from "@/lib/sat/pick";
import { json, requireUser } from "@/lib/server/auth";
import { withRequestId } from "@/lib/server/live-route";
import { checkRateLimitDistributed, rateLimitedResponse } from "@/lib/server/rate-limit";
import { readAttempts, readBankMeta, readQuestions, satStoreDeps } from "@/lib/server/sat/store";
import { satLogger, satHeaders } from "@/lib/server/sat/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/sat/next?count=10&domain=&skill=&difficulty= — the next SAT questions for the student
 * (docs/SAT-MODE.md): `{ questions: SATQuestion[] }`, each with its answer and solution (free
 * practice: the iPad checks answers offline and at once).
 *
 * The pick is adaptive (src/lib/sat/pick.ts): unseen first, weak skills weighted up, difficulty
 * following the last ~10 answers in each domain, the section's domain mix, and no question again
 * within 30 days unless the bank (or the filter) is exhausted. Fewer than `count` only when the
 * live bank has fewer matching questions; an empty bank is `{ questions: [] }`.
 *
 * requireUser (401) -> `satRead` (429) -> the query (400) -> 502 when the bank could not be read.
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
  const { count, domain, skill, difficulty } = query.data;

  try {
    const [bank, attempts] = await Promise.all([readBankMeta(token), readAttempts(token, user.id)]);
    const ids = pickQuestions({ bank, attempts, count, filter: { domain, skill, difficulty }, now: satStoreDeps.now() });
    const questions = await readQuestions(token, ids);
    log.info({ count, domain, skill, difficulty, bank: bank.length, answered: attempts.length, picked: questions.length }, "sat next");
    return Response.json({ questions }, { headers });
  } catch (err) {
    log.error({ error: err instanceof Error ? err.message : String(err) }, "sat next failed");
    return json(502, "upstream_error", "The questions couldn't be loaded. Try again in a moment.", { requestId }, headers);
  }
}
