import { after } from "next/server";
import { z } from "zod";
import { BugReplyBodySchema } from "@/lib/bugReports/contracts";
import { replyAsReporter } from "@/lib/bugReports/server";
import { sendReporterReplied } from "@/lib/email/bugReply";
import { emailDeps } from "@/lib/email/server";
import { logger } from "@/lib/logger";
import { json, requireUser } from "@/lib/server/auth";
import { userClient } from "@/lib/server/billing";
import { checkRateLimitDistributed, rateLimitedResponse } from "@/lib/server/rate-limit";
import { parseJsonBody } from "@/lib/server/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** One RPC; the operator's email goes after the answer (one Resend call, 10 s timeout). */
export const maxDuration = 20;

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * POST /api/bug-reports/<id>/messages `{ body }` (BugReplyBodySchema, src/lib/bugReports/contracts.ts):
 * the reporter writes back on their own bug report, from /reports.
 *
 * requireUser -> the `bugReply` budget (per user, across instances) -> a uuid id and a 1 to 4,000
 * character body (400) -> bug_report_reply() AS THE USER (src/lib/bugReports/server.ts: 404 for a
 * report that is not theirs or not there, 429 past the day's 20 replies on one report, 503 before the
 * migration) -> 200 `{ message }` (BugReplyResultSchema): the stored message, for the page to show.
 *
 * After the answer (next/server's `after`), the operator is emailed at ALERT_EMAIL: who replied, their
 * words, and a link to the report in the inbox (src/lib/email/bugReply.ts). That email never holds or
 * fails the reply; without ALERT_EMAIL or RESEND_API_KEY it is a log line.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();

  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;
  const { user, token } = auth;
  const log = logger.child({ module: "bug-reports", route: "messages", requestId, userId: user.id });

  const rl = await checkRateLimitDistributed({ token, userId: user.id, bucket: "bugReply" });
  if (!rl.ok) return rateLimitedResponse(rl.retryAfterMs, rl.backend);

  const id = z.string().uuid().safeParse((await ctx.params).id);
  if (!id.success) return json(400, "invalid_request", "The bug report id must be a uuid.", { requestId }, NO_STORE);
  const body = await parseJsonBody(req, BugReplyBodySchema);
  if ("response" in body) return body.response;

  const result = await replyAsReporter(userClient(token), id.data, body.data.body);
  if (!result.ok) {
    if (result.status >= 500) log.error({ reportId: id.data, status: result.status }, "bug reply not saved");
    return json(result.status, result.error, result.message, { requestId }, NO_STORE);
  }
  log.info({ reportId: id.data, length: result.message.body.length }, "reporter replied to their bug report");

  // The operator hears of it after the answer: never the reporter's wait, never their failure.
  const notify = async () => {
    try {
      await sendReporterReplied(emailDeps, { who: user.email, reportId: id.data, messageId: result.message.id, body: result.message.body }, log);
    } catch {
      /* sendReporterReplied logs its own failures */
    }
  };
  try {
    after(notify);
  } catch {
    // outside a request (a script, a test): `after` throws, and the email simply goes now
    void notify();
  }

  return Response.json({ message: result.message }, { headers: { ...NO_STORE, "X-Request-Id": requestId } });
}
