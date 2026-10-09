import { logger } from "@/lib/logger";
import { listReferrals } from "@/lib/referral/server/admin";
import { requireAdmin } from "@/lib/server/admin";
import { consoleEnv, consoleFailure, NO_STORE } from "@/lib/server/adminConsole/http";
import { checkRateLimit, LIMITS, rateLimitKey, rateLimitedResponse } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

const log = logger.child({ module: "admin-console", route: "admin/referrals" });

/**
 * GET /api/admin/referrals: every referral, newest first (`AdminReferralList`,
 * src/lib/referral/admin.ts): who invited whom with both accounts' emails and the checkouts' payer
 * emails, the referrer's Stripe customer (where the free month's credit goes), the status and its
 * dates, and the counts per status. One call to admin_referrals() (src/lib/referral/server/admin.ts).
 *
 * `requireAdmin` first: requireUser(req) (401 signed out), then the admins table (404 for everyone
 * else: the route does not exist for them), before anything is read or limited. Then the console's
 * bucket (`adminConsole`), 503 without SUPABASE_SERVICE_ROLE_KEY, and 502 naming admin_referrals
 * when the call fails. Grown-ups' addresses only, no student content: nothing is written to
 * admin_audit for the read (the marks are).
 */
export async function GET(req: Request) {
  const requestId = crypto.randomUUID();
  const gate = await requireAdmin(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  const limited = checkRateLimit(rateLimitKey(user.id, "adminConsole"), LIMITS.adminConsole);
  if (!limited.ok) return rateLimitedResponse(limited.retryAfterMs, "memory");

  const env = consoleEnv(log, requestId);
  if ("response" in env) return env.response;

  const startedAt = Date.now();
  try {
    const list = await listReferrals(env.deps);
    log.info({ requestId, userId: user.id, referrals: list.referrals.length, due: list.counts.paid, ms: Date.now() - startedAt }, "admin referrals");
    return Response.json(list, { headers: { ...NO_STORE, "X-Request-Id": requestId } });
  } catch (err) {
    return consoleFailure(err, { log, requestId, userId: user.id, what: "referrals" });
  }
}
