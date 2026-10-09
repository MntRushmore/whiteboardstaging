"use client";

/**
 * The reporter's page talks to Supabase with the user's own session, like /account and /progress:
 * my_bug_reports() to read, bug_reports_mark_seen() once they have opened their replies
 * (20261009160000_bug_replies.sql). Writing back goes through POST /api/bug-reports/<id>/messages,
 * which also tells the team (src/app/api/bug-reports/[id]/messages/route.ts).
 */
import { z } from "zod";
import { apiJson } from "@/lib/api-client";
import { supabase } from "@/lib/supabase";
import { BUG_REPLY_RPC, BugReplyResultSchema, MyBugReportSchema, bugReplyApi, type BugMessage, type MyBugReport } from "./contracts";

const ListSchema = z.array(MyBugReportSchema);

/** The signed-in user's reports, newest first. Throws with words a person can read. */
export async function loadMyReports(): Promise<MyBugReport[]> {
  const { data, error } = await supabase.rpc(BUG_REPLY_RPC.list);
  if (error) throw new Error(error.message || "The reports didn't load.");
  const parsed = ListSchema.safeParse(data ?? []);
  if (!parsed.success) throw new Error("The reports came back in a shape this page doesn't know.");
  return parsed.data;
}

/** Every reply they have now seen is marked read (the header's dot goes out). False when it could not be. */
export async function markRepliesSeen(): Promise<boolean> {
  try {
    const { error } = await supabase.rpc(BUG_REPLY_RPC.markSeen, { p_report_id: null });
    return !error;
  } catch {
    return false;
  }
}

/** Their reply, saved: the stored message. Throws ApiError (its message is the server's words). */
export async function sendReply(reportId: string, body: string): Promise<BugMessage> {
  const res = await apiJson<unknown>(bugReplyApi(reportId), { body });
  return BugReplyResultSchema.parse(res).message;
}
