/**
 * A reporter writing back on their own bug report, on the server (POST /api/bug-reports/<id>/messages;
 * src/lib/bugReports/contracts.ts). The write is bug_report_reply() called AS THE USER (their token,
 * so auth.uid() is theirs: 20261009160000_bug_replies.sql decides whose report it is, how long a
 * reply may be and how many a day); the route adds the per-minute budget and the operator's email.
 *
 * The function's refusals, as the route answers them:
 *   P0002 (hint bug_report_missing)  404 not_found: no report of theirs has that id (another
 *                                    person's report reads the same, so nobody learns it exists)
 *   22023                            400 invalid_request: empty, or over BUG_MESSAGE_MAX characters
 *   P0001 (hint bug_reply_limit)     429 rate_limited: 20 replies on one report in a day
 *   42501                            401 unauthorized
 *   the function missing             503 feature_unavailable (the migration is not applied)
 *   anything else                    502 upstream_error
 * Server-only (the route's user client); never throws.
 */
import type { ApiErrorCode } from "@/lib/server/auth";
import type { RpcClient, RpcError } from "@/lib/server/billing";
import { BUG_REPLY_RPC, BugMessageSchema, type BugMessage } from "./contracts";

export type ReporterReplyResult =
  | { ok: true; message: BugMessage }
  | { ok: false; status: 400 | 401 | 404 | 429 | 502 | 503; error: ApiErrorCode; message: string };

/** PostgREST's "no such function" (schema cache) and Postgres's undefined_function. */
const MISSING = new Set(["PGRST202", "42883"]);

export const REPLY_COPY = {
  missing: "No bug report of yours has that id.",
  invalid: "A reply is 1 to 4,000 characters.",
  tooMany: "That's a lot of replies on one report today. Try again tomorrow.",
  unavailable: "Replies aren't set up on this server yet.",
  failed: "Your reply didn't save. Try again in a moment.",
  signedOut: "You need to be signed in to use this feature.",
} as const;

/** One refusal of bug_report_reply(), as the route answers it (see the module comment). */
export function replyFailure(error: RpcError): Extract<ReporterReplyResult, { ok: false }> {
  const code = error.code ?? "";
  if (code === "P0002") return { ok: false, status: 404, error: "not_found", message: REPLY_COPY.missing };
  if (code === "22023") return { ok: false, status: 400, error: "invalid_request", message: REPLY_COPY.invalid };
  if (code === "P0001" && error.hint === "bug_reply_limit") return { ok: false, status: 429, error: "rate_limited", message: REPLY_COPY.tooMany };
  if (code === "42501") return { ok: false, status: 401, error: "unauthorized", message: REPLY_COPY.signedOut };
  if (MISSING.has(code)) return { ok: false, status: 503, error: "feature_unavailable", message: REPLY_COPY.unavailable };
  return { ok: false, status: 502, error: "upstream_error", message: REPLY_COPY.failed };
}

/** bug_report_reply() as the user (`client` carries their token). */
export async function replyAsReporter(client: RpcClient, reportId: string, body: string): Promise<ReporterReplyResult> {
  try {
    const { data, error } = await client.rpc(BUG_REPLY_RPC.reply, { p_report_id: reportId, p_body: body });
    if (error) return replyFailure(error);
    const parsed = BugMessageSchema.safeParse(data);
    if (!parsed.success) return { ok: false, status: 502, error: "upstream_error", message: REPLY_COPY.failed };
    return { ok: true, message: parsed.data };
  } catch {
    return { ok: false, status: 502, error: "upstream_error", message: REPLY_COPY.failed };
  }
}
