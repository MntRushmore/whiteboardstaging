import { z } from "zod";
import { DEFAULT_FUNNEL_TIME_ZONE, isTimeZone } from "@/lib/funnel/report";
import { logger } from "@/lib/logger";
import { requireAdmin } from "@/lib/server/admin";
import { buildFunnel } from "@/lib/server/adminConsole/funnel";
import { consoleEnv, consoleFailure, NO_STORE, parseQuery } from "@/lib/server/adminConsole/http";
import { checkRateLimit, LIMITS, rateLimitKey, rateLimitedResponse } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

const log = logger.child({ module: "admin-console", route: "admin/funnel" });

const QuerySchema = z.object({
  tz: z
    .string()
    .max(64)
    .refine(isTimeZone, "an IANA time zone, like America/New_York")
    .optional(),
});

/**
 * GET /api/admin/funnel?tz=<IANA zone>: where sign-ups come from and how far they get
 * (`FunnelReport`, src/lib/funnel/contracts.ts): totals, per sign-up week and per source, MRR. The
 * weeks and "came back another day" are read in `tz` (the admin's browser's; America/New_York
 * without one). One call to admin_funnel() (src/lib/server/adminConsole/funnel.ts).
 *
 * `requireAdmin` first: requireUser(req) (401 signed out), then the admins table (404 for everyone
 * else: the route does not exist for them), before anything is read or limited. Then the console's
 * bucket (`adminConsole`), 400 for a zone that is not one, 503 without
 * SUPABASE_SERVICE_ROLE_KEY, and 502 naming admin_funnel when the call fails. No student content is
 * read (counts only), so nothing is written to admin_audit.
 */
export async function GET(req: Request) {
  const requestId = crypto.randomUUID();
  const gate = await requireAdmin(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  const limited = checkRateLimit(rateLimitKey(user.id, "adminConsole"), LIMITS.adminConsole);
  if (!limited.ok) return rateLimitedResponse(limited.retryAfterMs, "memory");

  const query = parseQuery(req, QuerySchema, requestId);
  if ("response" in query) return query.response;

  const env = consoleEnv(log, requestId);
  if ("response" in env) return env.response;

  const startedAt = Date.now();
  try {
    const report = await buildFunnel(env.deps, query.data.tz ?? DEFAULT_FUNNEL_TIME_ZONE);
    log.info({ requestId, userId: user.id, signups: report.totals.counts.signed_up, ms: Date.now() - startedAt }, "admin funnel");
    return Response.json(report, { headers: { ...NO_STORE, "X-Request-Id": requestId } });
  } catch (err) {
    return consoleFailure(err, { log, requestId, userId: user.id, what: "funnel" });
  }
}
