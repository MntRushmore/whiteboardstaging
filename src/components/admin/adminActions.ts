"use client";

import {
  ADMIN_API,
  AdminBugReplySchema,
  AdminBugSchema,
  type AdminBug,
  type AdminBugList,
  type AdminBugReplyEmail,
  type AdminIssue,
  type AdminIssueList,
  type AdminUserDetail,
  type BugStatus,
  type IssueStatus,
} from "@/lib/admin/contracts";
import { applyBugPatch } from "@/lib/admin/bugsView";
import { applyIssuePatch } from "@/lib/admin/issuesView";
import { patchAdmin, postAdmin } from "./adminData";
import { mutateResources } from "./useAdminResource";

/** A loaded answer of the bug list (any query). */
const isBugList = (url: string) => url === ADMIN_API.bugs || url.startsWith(`${ADMIN_API.bugs}?`);
/** A loaded user page. */
const isUserDetail = (url: string) => url.startsWith(`${ADMIN_API.users}/`);
/** A loaded issue list (any window). */
const isIssueList = (url: string) => url === ADMIN_API.issues || url.startsWith(`${ADMIN_API.issues}?`);

/** Puts one report, as given, everywhere it is shown (the inbox, the nav's count, its user's page). */
function showBug(bug: AdminBug) {
  mutateResources<AdminBugList>(isBugList, (d) => ({ ...d, bugs: d.bugs.map((b) => (b.id === bug.id ? bug : b)) }));
  mutateResources<AdminUserDetail>(isUserDetail, (d) => (d.bugs.some((b) => b.id === bug.id) ? { ...d, bugs: d.bugs.map((b) => (b.id === bug.id ? bug : b)) } : d));
}

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Sets a report's status and/or note: shown at once everywhere, then PATCHed; on failure the
 * report goes back to how it was and the error comes back to say so.
 */
export async function updateBug(before: AdminBug, patch: { status?: BugStatus; note?: string | null }): Promise<ActionResult> {
  showBug(applyBugPatch(before, patch, new Date().toISOString()));
  const res = await patchAdmin(ADMIN_API.bug(before.id), patch);
  if (!res.ok) {
    showBug(before);
    return res;
  }
  // the server's own copy when it sends one ({ bug } or the report itself)
  const body = res.body && typeof res.body === "object" && "bug" in res.body ? (res.body as { bug: unknown }).bug : res.body;
  const parsed = AdminBugSchema.safeParse(body);
  if (parsed.success) showBug(parsed.data);
  return { ok: true };
}

/**
 * Replies to a report's reporter: POSTed (not shown first: the reply is only theirs once it is
 * saved), then the report as the server now has it is shown everywhere, its thread with the reply.
 * The answer says whether the email went; an answer of another shape still counts as sent.
 */
export async function replyToBug(bug: AdminBug, body: string): Promise<{ ok: true; email: AdminBugReplyEmail | null } | { ok: false; error: string }> {
  const res = await postAdmin(ADMIN_API.bugMessages(bug.id), { body });
  if (!res.ok) return res;
  const parsed = AdminBugReplySchema.safeParse(res.body);
  if (!parsed.success) return { ok: true, email: null };
  showBug(parsed.data.bug);
  return { ok: true, email: parsed.data.email };
}

function showIssue(fingerprint: string, change: (i: AdminIssue) => AdminIssue) {
  mutateResources<AdminIssueList>(isIssueList, (d) => ({ ...d, issues: d.issues.map((i) => (i.fingerprint === fingerprint ? change(i) : i)) }));
}

/** Mutes, fixes or reopens an issue (with an optional note): at once, then PATCHed; back on failure. */
export async function updateIssue(before: AdminIssue, status: IssueStatus, note?: string | null): Promise<ActionResult> {
  const now = new Date().toISOString();
  const patch = note === undefined ? { status } : { status, note };
  // every window's copy changes, each keeping its own counts
  const snapshot = { status: before.status, note: before.note, fixedAt: before.fixedAt, regressed: before.regressed };
  showIssue(before.fingerprint, (i) => applyIssuePatch(i, patch, now));
  const res = await patchAdmin(ADMIN_API.issues, { fingerprint: before.fingerprint, ...patch });
  if (!res.ok) {
    showIssue(before.fingerprint, (i) => ({ ...i, ...snapshot }));
    return res;
  }
  return { ok: true };
}
