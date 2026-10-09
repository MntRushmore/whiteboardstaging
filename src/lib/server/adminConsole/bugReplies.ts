/**
 * Answering a bug report from the inbox (POST /api/admin/bugs/<id>/messages; 2026-10-09,
 * 20261009160000_bug_replies.sql). With the service role, in this order:
 *
 *   1. the report is read (none: null, the route's 404);
 *   2. the reply is written to bug_report_messages (author 'admin', author_id the admin);
 *   3. a report still 'new' moves to 'seen' (only from new: a fixed or set-aside report stays where
 *      the admin put it);
 *   4. admin_audit 'bug.reply' with the reply's length, never its words (a failed log line is an
 *      error in the server log, not a failed reply: src/lib/server/adminConsole/audit.ts);
 *   5. the report is read back with its thread (`bugsWhere`), and the route answers it.
 *
 * Then the email (`emailReporter`): to the reporter's account address, or, when the reporter is a
 * kid profile (src/lib/family; an address on the kid domain), to the kid's grown-up
 * (family_members.parent_id), never to the kid. The kid's name in it is `safeFirstName` of their
 * display name. The reply is saved whatever the email does; `emailReporter` never throws.
 */
import type pino from "pino";
import type { AdminBug, AdminBugReplyEmail } from "@/lib/admin/contracts";
import type { BugMessage } from "@/lib/bugReports/contracts";
import { safeFirstName } from "@/lib/email/activity";
import { sendBugReplyEmail, type BugReplyRecipient } from "@/lib/email/bugReply";
import { isSendableAddress } from "@/lib/email/resend";
import type { EmailDeps } from "@/lib/email/server";
import { isKidEmail } from "@/lib/family/kidEmail";
import { auditChange } from "./audit";
import { bugsWhere } from "./bugs";
import { restClient, type ConsoleDeps, type Rest } from "./rest";

/** The report a reply answers, as the email needs it. */
export interface RepliedReport {
  id: string;
  userId: string | null;
  /** bug_reports.user_email: the address stamped from the reporter's token when they sent it */
  email: string | null;
  message: string;
  at: string;
}

export interface BugReplyResult {
  /** the report as it now stands, the reply last in its thread */
  bug: AdminBug;
  message: BugMessage;
  report: RepliedReport;
}

type ReportRow = { id: string; user_id: string | null; user_email: string | null; message: string | null; status: string | null; created_at: string };

/** Steps 1 to 5 of the module comment. Null when there is no such report. */
export async function replyToBug(deps: ConsoleDeps, id: string, body: string, adminId: string): Promise<BugReplyResult | null> {
  const rest = restClient(deps);
  const row = await rest.one<ReportRow>({ table: "bug_reports", params: { select: "id,user_id,user_email,message,status,created_at", id: `eq.${id}` } });
  if (!row) return null;
  const text = body.trim();
  // the id is ours, so the reply is found again in the thread without a second kind of write
  const messageId = crypto.randomUUID();
  await rest.insert("bug_report_messages", { id: messageId, report_id: id, author: "admin", author_id: adminId, body: text });
  if (row.status === "new") {
    await rest.patch({ table: "bug_reports", params: { id: `eq.${id}`, status: "eq.new", select: "id" } }, { status: "seen" });
  }
  await auditChange(rest, { adminId, action: "bug.reply", targetKind: "bug", targetId: id, meta: { length: text.length } });
  const [bug] = await bugsWhere(rest, { id: `eq.${id}` }, 1);
  if (!bug) return null;
  const message = bug.thread.find((m) => m.id === messageId) ?? { id: messageId, author: "admin" as const, body: text, at: new Date(rest.now).toISOString() };
  return { bug, message, report: { id, userId: row.user_id, email: row.user_email, message: row.message ?? "", at: row.created_at } };
}

export type ReporterAddress = BugReplyRecipient | { skip: "no_reporter" | "no_email" | "no_grown_up" };

/** An address an email may go to: one plain address, never a kid profile's. */
const usable = (address: string | null | undefined): address is string => Boolean(address) && isSendableAddress(address!) && !isKidEmail(address);

/**
 * Where the reply's email goes: the reporter's account address (the auth admin API's, else the one
 * stamped on the report), or, for a kid profile, their grown-up's. Throws ConsoleQueryError when the
 * family or profile cannot be read.
 */
export async function reporterAddress(rest: Rest, report: Pick<RepliedReport, "userId" | "email">): Promise<ReporterAddress> {
  if (!report.userId) return { skip: "no_reporter" };
  const account = await rest.authUser(report.userId);
  const address = (account?.email ?? report.email ?? "").trim();
  if (!address) return { skip: "no_email" };
  if (!isKidEmail(address)) return usable(address) ? { email: address, to: "reporter", kidName: null } : { skip: "no_email" };

  // a kid profile: their grown-up, with the kid's first name
  const member = await rest.one<{ parent_id: string }>({ table: "family_members", params: { select: "parent_id", child_id: `eq.${report.userId}` } });
  if (!member?.parent_id) return { skip: "no_grown_up" };
  const [parent, profile] = await Promise.all([
    rest.authUser(member.parent_id),
    rest.one<{ display_name: string | null }>({ table: "profiles", params: { select: "display_name", user_id: `eq.${report.userId}` } }),
  ]);
  const parentAddress = parent?.email?.trim() ?? "";
  if (!usable(parentAddress)) return { skip: "no_grown_up" };
  return { email: parentAddress, to: "grown_up", kidName: safeFirstName(profile?.display_name) };
}

/**
 * The reply's email (see the module comment): what happened, for the answer and the log. Not
 * configured here (no RESEND_API_KEY or service role): skipped before any address is looked up.
 * Never throws.
 */
export async function emailReporter(deps: ConsoleDeps, reply: BugReplyResult, email: Pick<EmailDeps, "getEnv" | "logStore" | "send">, log: pino.Logger): Promise<AdminBugReplyEmail> {
  try {
    const env = email.getEnv();
    if (!env.resend.apiKey || !env.hasServiceRole) {
      log.info({ bugId: reply.report.id }, "bug reply saved; no email: RESEND_API_KEY or SUPABASE_SERVICE_ROLE_KEY is not set");
      return { status: "skipped", reason: "not_configured" };
    }
    const who = await reporterAddress(restClient(deps), reply.report);
    if ("skip" in who) {
      log.info({ bugId: reply.report.id, reason: who.skip }, "bug reply saved; no one to email");
      return { status: "skipped", reason: who.skip };
    }
    return await sendBugReplyEmail(
      email,
      env,
      {
        reportId: reply.report.id,
        reporterId: reply.report.userId!,
        messageId: reply.message.id,
        reply: reply.message.body,
        reported: reply.report.message,
        reportedAt: reply.report.at,
        recipient: who,
      },
      log,
    );
  } catch (err) {
    log.warn({ bugId: reply.report.id, error: err instanceof Error ? err.message : String(err) }, "bug reply saved; its email could not be sent");
    return { status: "failed", to: null };
  }
}
