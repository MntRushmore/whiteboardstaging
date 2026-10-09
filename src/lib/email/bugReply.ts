/**
 * The emails of a bug report's conversation (2026-10-09; src/lib/bugReports/contracts.ts):
 *
 *   staff reply     "We replied to your bug report" (templates.ts `bugReplyEmail`) to the reporter,
 *                   or to a kid profile's grown-up. The caller picks the address
 *                   (src/lib/server/adminConsole/bugReplies.ts: never a kid's, and sendEmail refuses
 *                   one anyway). Once per message: email_log, kind 'bug_reply', ref = the message's
 *                   id, on the reporter's account (claim, send, record: src/lib/email/log.ts).
 *   reporter wrote  "<address> replied to their bug report" (alerts.ts `reporterRepliedEmail`) to
 *                   ALERT_EMAIL. Like the health alerts it is not in email_log; Resend's
 *                   Idempotency-Key (one per message) keeps a retry from sending it twice.
 *
 * Neither fails what caused it: the message is saved first, and these answer what happened (sent,
 * skipped and why, failed) for the caller's log and answer. Without RESEND_API_KEY (development, a
 * preview) nothing is sent and the answer is `skipped`. Never throw.
 */
import type pino from "pino";
import type { AdminBugReplyEmail } from "@/lib/admin/contracts";
import { reporterRepliedEmail } from "@/lib/email/alerts";
import { sendOnce } from "@/lib/email/log";
import type { EmailDeps, EmailEnv } from "@/lib/email/server";
import { bugReplyEmail } from "@/lib/email/templates";

export const BUG_REPLY_KIND = "bug_reply" as const;

/** Who staff's reply goes to: the reporter's own address, or a kid profile's grown-up (with the kid's safe first name). */
export type BugReplyRecipient = { email: string; to: "reporter" | "grown_up"; kidName: string | null };

export type BugReplyEmailInput = {
  reportId: string;
  /** the reporter's account: the email_log row is theirs, and goes with it */
  reporterId: string;
  /** the reply's bug_report_messages id: once per message */
  messageId: string;
  reply: string;
  /** the report's own words, quoted as one line */
  reported: string;
  /** when the report was sent (ISO) */
  reportedAt: string;
  recipient: BugReplyRecipient;
};

/** Resend's Idempotency-Key for one reply's email. */
export function bugReplyIdempotencyKey(messageId: string): string {
  return `bug-reply/${messageId}`.slice(0, 256);
}

/** Resend's Idempotency-Key for the operator's "they replied" email. */
export function reporterRepliedIdempotencyKey(messageId: string): string {
  return `bug-reply-alert/${messageId}`.slice(0, 256);
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Staff's reply, emailed (see the module comment). Never throws. */
export async function sendBugReplyEmail(deps: Pick<EmailDeps, "logStore" | "send">, env: EmailEnv, input: BugReplyEmailInput, log: pino.Logger): Promise<AdminBugReplyEmail> {
  const to = input.recipient.to;
  const where = { email: BUG_REPLY_KIND, reportId: input.reportId, messageId: input.messageId, to };
  try {
    if (!env.resend.apiKey || !env.hasServiceRole) {
      log.warn(where, "bug reply email not sent: RESEND_API_KEY or SUPABASE_SERVICE_ROLE_KEY is not set (the reply is saved)");
      return { status: "skipped", reason: "not_configured" };
    }
    const at = new Date(input.reportedAt);
    const rendered = bugReplyEmail({
      siteUrl: env.siteUrl,
      reportId: input.reportId,
      reply: input.reply,
      reported: input.reported,
      reportedAt: Number.isNaN(at.getTime()) ? new Date() : at,
      ...(to === "grown_up" ? { kid: { name: input.recipient.kidName } } : {}),
    });
    const outcome = await sendOnce({
      store: deps.logStore(),
      key: { userId: input.reporterId, kind: BUG_REPLY_KIND, ref: input.messageId },
      message: { to: input.recipient.email, ...rendered, idempotencyKey: bugReplyIdempotencyKey(input.messageId), tags: { kind: BUG_REPLY_KIND } },
      send: (message) => deps.send(message, env.resend),
      log,
    });
    switch (outcome.status) {
      case "sent":
        log.info({ ...where, resendId: outcome.id }, "bug reply email sent");
        return { status: "sent", to };
      case "already_sent":
        return { status: "sent", to };
      case "failed":
        log.warn({ ...where, error: outcome.error, httpStatus: outcome.httpStatus, released: outcome.released }, "bug reply email not sent (the reply is saved)");
        return { status: "failed", to };
      case "log_error":
        log.warn({ ...where, error: outcome.error }, "bug reply email not sent: the email log could not be written (the reply is saved)");
        return { status: "failed", to };
    }
  } catch (err) {
    log.error({ ...where, error: errorText(err) }, "bug reply email failed (the reply is saved)");
    return { status: "failed", to };
  }
}

export type ReporterRepliedOutcome =
  | { status: "sent"; id: string }
  | { status: "skipped"; reason: "no_alert_email" | "not_configured" }
  | { status: "failed"; error: string };

/** The operator hears that a reporter wrote back (see the module comment). Never throws. */
export async function sendReporterReplied(
  deps: Pick<EmailDeps, "getEnv" | "send">,
  input: { who: string | null; reportId: string; messageId: string; body: string },
  log: pino.Logger,
): Promise<ReporterRepliedOutcome> {
  const where = { email: "bug_reply_alert", reportId: input.reportId, messageId: input.messageId };
  try {
    const env = deps.getEnv();
    if (!env.alertEmail) {
      log.warn(where, "ALERT_EMAIL is not set: nobody was emailed about the reporter's reply");
      return { status: "skipped", reason: "no_alert_email" };
    }
    if (!env.resend.apiKey) {
      log.warn(where, "RESEND_API_KEY is not set: nobody was emailed about the reporter's reply");
      return { status: "skipped", reason: "not_configured" };
    }
    const rendered = reporterRepliedEmail({ who: input.who, reportId: input.reportId, body: input.body }, { siteUrl: env.siteUrl });
    const result = await deps.send(
      { to: env.alertEmail, ...rendered, idempotencyKey: reporterRepliedIdempotencyKey(input.messageId), tags: { category: "alert", alert: "bug_reply" } },
      env.resend,
    );
    if (!result.ok) {
      log.warn({ ...where, error: result.error, httpStatus: result.status }, "the reporter's reply was saved, but its email to ALERT_EMAIL did not go out");
      return { status: "failed", error: result.error };
    }
    log.info({ ...where, resendId: result.id }, "reporter's reply emailed to ALERT_EMAIL");
    return { status: "sent", id: result.id };
  } catch (err) {
    log.error({ ...where, error: errorText(err) }, "the reporter's reply was saved, but its email to ALERT_EMAIL failed");
    return { status: "failed", error: errorText(err) };
  }
}
