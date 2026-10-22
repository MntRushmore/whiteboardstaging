import { SAT_LIMITS, SatProgressQuerySchema } from "@/lib/sat/contracts";
import { isTimeZone, localDay } from "@/lib/sat/day";
import { buildProgress } from "@/lib/sat/progress";
import { satFreeTutorPerDay } from "@/lib/env";
import { json, requireUser } from "@/lib/server/auth";
import { withRequestId } from "@/lib/server/live-route";
import { checkRateLimitDistributed, rateLimitedResponse } from "@/lib/server/rate-limit";
import { satHeaders, satLogger } from "@/lib/server/sat/http";
import { countPasses, readAttempts, readBankMeta, readUnlimited, satStoreDeps } from "@/lib/server/sat/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/sat/progress?tz= — the student's SAT practice so far (docs/SAT-MODE.md):
 * `{ answered, correct, by_domain, by_skill, streak_days, today: {answered, tutor_used, cap,
 * unlimited}, estimate: {low, high, note} | null }` (src/lib/sat/progress.ts).
 *
 * `estimate` is a rough 200–800 band from practice (src/lib/sat/estimate.ts), null below 15
 * answers, narrowing as more are answered; its `note` says it is not a score. Days ("today", the
 * streak) are the student's own, from `tz` (an IANA zone; UTC when absent).
 *
 * requireUser (401) -> `satRead` (429) -> the zone (400) -> 502 when a read failed. Never charged.
 */
export async function GET(req: Request) {
  const requestId = crypto.randomUUID();
  const headers = satHeaders(requestId);
  const auth = await requireUser(req);
  if ("response" in auth) return withRequestId(auth.response, requestId);
  const { user, token } = auth;
  const log = satLogger.child({ requestId, route: "sat/progress", userId: user.id });

  const rl = await checkRateLimitDistributed({ token, userId: user.id, bucket: "satRead" });
  if (!rl.ok) return withRequestId(rateLimitedResponse(rl.retryAfterMs, rl.backend), requestId);

  const query = SatProgressQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  const tz = query.success ? (query.data.tz ?? "UTC") : null;
  if (!tz || !isTimeZone(tz)) return json(400, "invalid_request", "tz must be an IANA time zone, like America/New_York.", { requestId }, headers);

  const now = satStoreDeps.now();
  try {
    const [bank, attempts, tutorUsedToday, unlimited] = await Promise.all([
      readBankMeta(token),
      readAttempts(token, user.id, SAT_LIMITS.progressWindow),
      countPasses(token, user.id, localDay(tz, now)),
      readUnlimited(token),
    ]);
    const meta = new Map(bank.map((q) => [q.id, q]));
    const body = buildProgress({
      attempts: attempts.map((a) => {
        const q = meta.get(a.question_id);
        return { ...a, meta: q ? { domain: q.domain, skill: q.skill, difficulty: q.difficulty } : null };
      }),
      tz,
      now,
      tutorUsedToday,
      cap: satFreeTutorPerDay(SAT_LIMITS.freeTutorPerDay),
      unlimited,
    });
    log.info({ answered: body.answered, streak: body.streak_days, estimate: body.estimate !== null }, "sat progress");
    return Response.json(body, { headers });
  } catch (err) {
    log.error({ error: err instanceof Error ? err.message : String(err) }, "sat progress failed");
    return json(502, "upstream_error", "Your progress couldn't be loaded. Try again in a moment.", { requestId }, headers);
  }
}
