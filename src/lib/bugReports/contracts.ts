/**
 * Bug report replies (2026-10-09; supabase/migrations/20261009160000_bug_replies.sql): what a
 * reporter's page (/reports), its API route and the admin inbox agree on. A report's thread is its
 * messages, oldest first, each written by an admin (from /admin/bugs, service role) or by the reporter
 * (bug_report_reply(), as themselves).
 *
 *   /reports ──my_bug_reports() / bug_reports_mark_seen()──► Supabase (the user's own session)
 *   /reports ──POST /api/bug-reports/<id>/messages──► bug_report_reply() as the user ──► email to ALERT_EMAIL
 *   /admin/bugs ──POST /api/admin/bugs/<id>/messages──► service role ──► email to the reporter (a kid's: their grown-up)
 *   app header ──my_bug_unread_count()──► the dot on Report a bug
 *
 * Runtime dependency: zod only. Small on purpose: the reporter's page and the admin contract both
 * import it.
 */
import { z } from "zod";

/** A message's words at most (the table's check, bug_report_messages_body_len). */
export const BUG_MESSAGE_MAX = 4000;

/** Who wrote a message. */
export const BUG_MESSAGE_AUTHORS = ["admin", "reporter"] as const;
export type BugMessageAuthor = (typeof BUG_MESSAGE_AUTHORS)[number];

/** One message as my_bug_reports() returns it (`thread[]`) and the reply routes answer it. */
export const BugMessageSchema = z.object({
  id: z.string(),
  author: z.enum(BUG_MESSAGE_AUTHORS),
  body: z.string(),
  at: z.string(),
});
export type BugMessage = z.infer<typeof BugMessageSchema>;

/** A report's status, as the inbox sets it (BUG_STATUSES in src/lib/admin/contracts.ts). */
export const REPORT_STATUSES = ["new", "seen", "fixed", "wontfix"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

/** One row of my_bug_reports(): the caller's own report, without its screenshot, logs or diagnostics. */
export const MyBugReportSchema = z.object({
  id: z.string(),
  created_at: z.string(),
  message: z.string().nullable().transform((m) => m ?? ""),
  // a status the page does not know reads as "new" (a later migration adding one must not blank the page)
  status: z.string().transform((s): ReportStatus => ((REPORT_STATUSES as readonly string[]).includes(s) ? (s as ReportStatus) : "new")),
  resolved_at: z.string().nullable(),
  seen_at: z.string().nullable(),
  unread: z.number().int().nonnegative(),
  thread: z.array(BugMessageSchema),
});
export type MyBugReport = z.infer<typeof MyBugReportSchema>;

/** The body of a reply, from either side: trimmed, 1 to BUG_MESSAGE_MAX characters. */
export const BugReplyBodySchema = z.object({
  body: z.string().trim().min(1, "Write something first.").max(BUG_MESSAGE_MAX, `A message is at most ${BUG_MESSAGE_MAX} characters.`),
});

/** POST /api/bug-reports/<id>/messages answers the message it stored. */
export const BugReplyResultSchema = z.object({ message: BugMessageSchema });

export { REPORTS_PATH, reportHref } from "./paths";

/** The reporter's reply route. */
export function bugReplyApi(reportId: string): string {
  return `/api/bug-reports/${reportId}/messages`;
}

/** The RPCs (20261009160000_bug_replies.sql). */
export const BUG_REPLY_RPC = {
  list: "my_bug_reports",
  reply: "bug_report_reply",
  markSeen: "bug_reports_mark_seen",
  unread: "my_bug_unread_count",
} as const;
