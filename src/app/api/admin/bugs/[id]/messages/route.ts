import { AdminBugReplyInputSchema } from "@/lib/admin/contracts";
import { emailDeps } from "@/lib/email/server";
import { logger } from "@/lib/logger";
import { requireAdmin } from "@/lib/server/admin";
import { emailReporter, replyToBug } from "@/lib/server/adminConsole/bugReplies";
import { consoleEnv, consoleFailure, NO_STORE, notFound, parseId } from "@/lib/server/adminConsole/http";
import { checkRateLimit, LIMITS, rateLimitKey, rateLimitedResponse } from "@/lib/server/rate-limit";
import { parseJsonBody, recordRouteEvent } from "@/lib/server/request";

export const dynamic = "force-dynamic";
/** The reply's writes and reads, then one Resend call (10 s timeout). */
export const maxDuration = 30;

const log = logger.child({ module: "admin-console", route: "admin/bugs/[id]/messages" });

/**
 * POST /api/admin/bugs/<id>/messages `{ body }` (AdminBugReplyInputSchema, src/lib/admin/contracts.ts):
 * reply to a bug report's reporter (src/lib/server/adminConsole/bugReplies.ts). The reply is saved,
 * a report still new moves to seen, admin_audit gets 'bug.reply' (the length, never the words), and
 * then the reporter is emailed: their own address, or a kid profile's grown-up, never a kid's.
 * Answers `{ bug, email }` (AdminBugReplySchema): the report as it now stands, the reply last in its
 * thread, and whether the email went (sent, skipped and why, failed). The email never fails the
 * reply: a failed one is a warning in the log and an app event (`email_failed`).
 *
 * `requireAdmin` first: requireUser(req) (401 signed out), then the admins table (404 for everyone
 * else), then the console's bucket (`adminConsole`). 400 for a bad id or body (empty, or over 4,000
 * characters), 404 for no such report, 503 without SUPABASE_SERVICE_ROLE_KEY, 502 when a write fails.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  const gate = await requireAdmin(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  const limited = checkRateLimit(rateLimitKey(user.id, "adminConsole"), LIMITS.adminConsole);
  if (!limited.ok) return rateLimitedResponse(limited.retryAfterMs, "memory");

  const id = await parseId(ctx.params, "bug report", requestId);
  if ("response" in id) return id.response;
  const body = await parseJsonBody(req, AdminBugReplyInputSchema);
  if ("response" in body) return body.response;

  const env = consoleEnv(log, requestId);
  if ("response" in env) return env.response;

  const reqLog = log.child({ requestId, userId: user.id });
  try {
    const reply = await replyToBug(env.deps, id.id, body.data.body, user.id);
    if (!reply) return notFound("No bug report has that id.", requestId);
    const email = await emailReporter(env.deps, reply, emailDeps, reqLog);
    if (email.status === "failed") {
      recordRouteEvent(reqLog, { level: "warn", code: "email_failed", message: "A bug reply was saved, but its email to the reporter did not go out", meta: { to: email.to ?? "unknown" } });
    }
    reqLog.info({ bugId: id.id, length: body.data.body.length, email: email.status, ...(email.status === "skipped" ? { reason: email.reason } : {}) }, "admin bug reply");
    return Response.json({ bug: reply.bug, email }, { headers: { ...NO_STORE, "X-Request-Id": requestId } });
  } catch (err) {
    return consoleFailure(err, { log, requestId, userId: user.id, what: "bug reply" });
  }
}
