import { logger } from "@/lib/logger";
import { ReferralMarkSchema } from "@/lib/referral/admin";
import { markReferral } from "@/lib/referral/server/admin";
import { requireAdmin } from "@/lib/server/admin";
import { json } from "@/lib/server/auth";
import { badRequest, consoleEnv, consoleFailure, NO_STORE, notFound } from "@/lib/server/adminConsole/http";
import { checkRateLimit, LIMITS, rateLimitKey, rateLimitedResponse } from "@/lib/server/rate-limit";
import { parseJsonBody } from "@/lib/server/request";

export const dynamic = "force-dynamic";

const log = logger.child({ module: "admin-console", route: "admin/referrals/[id]" });

/** A referral's id in the path: a positive whole number (referrals.id is an identity column). */
function parseReferralId(raw: string): number | null {
  if (!/^[1-9]\d{0,15}$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

/**
 * PATCH /api/admin/referrals/<id> `{ status: "rewarded" | "void" }` (ReferralMarkSchema,
 * src/lib/referral/admin.ts): "Mark rewarded" once the owner has applied the referrer's $25 credit
 * in Stripe (from `paid` only: rewarded_at, rewarded_by), or "Void" for abuse (from signed_up,
 * trialing or paid). Both are final. Answers the referral as it now stands (`AdminReferral`). The
 * database writes the admin_audit row ('referral.reward' / 'referral.void') in the same
 * transaction.
 *
 * `requireAdmin` first: requireUser(req) (401 signed out), then the admins table (404 for everyone
 * else), then the console's bucket (`adminConsole`). 400 for a bad id or body, 404 for no such
 * referral, 409 for a move its status does not allow, 503 without SUPABASE_SERVICE_ROLE_KEY, 502
 * when the write fails.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  const gate = await requireAdmin(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  const limited = checkRateLimit(rateLimitKey(user.id, "adminConsole"), LIMITS.adminConsole);
  if (!limited.ok) return rateLimitedResponse(limited.retryAfterMs, "memory");

  const id = parseReferralId((await ctx.params).id);
  if (id === null) return badRequest("The referral id must be a positive whole number.", requestId);
  const body = await parseJsonBody(req, ReferralMarkSchema);
  if ("response" in body) return body.response;

  const env = consoleEnv(log, requestId);
  if ("response" in env) return env.response;

  try {
    const result = await markReferral(env.deps, id, body.data.status, user.id);
    if (result.kind === "missing") return notFound("No referral has that id.", requestId);
    if (result.kind === "conflict") return json(409, "invalid_request", result.message, { requestId }, NO_STORE);
    log.info({ requestId, userId: user.id, referralId: id, status: body.data.status }, "admin referral marked");
    return Response.json(result.referral, { headers: { ...NO_STORE, "X-Request-Id": requestId } });
  } catch (err) {
    return consoleFailure(err, { log, requestId, userId: user.id, what: "referral update" });
  }
}
