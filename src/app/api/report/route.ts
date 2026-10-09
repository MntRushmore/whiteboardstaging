import { logger } from "@/lib/logger";
import { requireUser } from "@/lib/server/auth";
import { checkRateLimitDistributed, rateLimitedResponse } from "@/lib/server/rate-limit";
import { parseReportQuery, reportAnswer, reportFailure, reportStore } from "@/lib/report/http";
import { readReport, reportDeps } from "@/lib/report/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = logger.child({ module: "report", route: "report" });

/**
 * GET /api/report?week=YYYY-MM-DD&tz=<IANA zone> — the caller's weekly report (`ReportAnswer`,
 * src/lib/report/contracts.ts): a grown-up gets each of their kids' weeks (and their own when they
 * practised too), a kid profile only their own, a solo student theirs. Read with the service role,
 * but only for the ids `reportScope` allowed from the caller's OWN family (src/lib/report/access.ts):
 * the caller's id comes from their verified token, never from the request.
 *
 * requireUser (401) -> the `report` bucket (429) -> the query (400 for a week that is not a date, in
 * the future or over a year back; parseReportQuery) -> 503 without the service role -> 200, or 502
 * when a read failed.
 */
export async function GET(req: Request) {
  const requestId = crypto.randomUUID();
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;
  const { user, token } = auth;

  const rl = await checkRateLimitDistributed({ token, userId: user.id, bucket: "report" });
  if (!rl.ok) return rateLimitedResponse(rl.retryAfterMs, rl.backend);

  const now = reportDeps.now();
  const query = parseReportQuery(req, now, requestId);
  if ("response" in query) return query.response;

  const env = reportStore(log, requestId);
  if ("response" in env) return env.response;

  try {
    const answer = await readReport(env.store, user, { ...query, now });
    log.info({ requestId, userId: user.id, weekStart: query.weekStart, role: answer.role, children: answer.report.children.length }, "weekly report read");
    return reportAnswer(answer, requestId);
  } catch (err) {
    return reportFailure(err, { log, requestId, userId: user.id, what: "read" });
  }
}
