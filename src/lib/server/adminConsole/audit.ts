/**
 * admin_audit (20261008000000_admin_console.sql): one row each time an admin looks at a student's
 * content or changes the console's state. The privacy policy says each look is logged, so a route
 * that answers with content (a board's snapshot, a screenshot, a page of board thumbnails, a user's
 * page) writes the row FIRST and answers 503 when it cannot (`AuditError`): no look goes unlogged.
 * A change (a bug triaged or answered, an issue muted) is logged after it is made; a failed log line there is
 * an error in the server log, not a failed change.
 *
 * A look kept open is one look (`auditRepeatLook`): the board viewer following a board live writes
 * again only after REPEAT_LOOK_MS; an open always writes.
 */
import { logger } from "@/lib/logger";
import type { Rest } from "./rest";

const log = logger.child({ module: "admin-audit" });

/** How long the log is kept (prune_admin_rows(), the health run's daily prune). */
export const ADMIN_AUDIT_RETENTION_DAYS = 180;

export type AuditAction =
  /** a board's snapshot read (the viewer, the replay; every read that returns one) */
  | "board.view"
  /** a page of board rows read (their thumbnails are the students' screens) */
  | "boards.list"
  /** a user's page read (their boards' thumbnails, their learning record, their errors) */
  | "user.view"
  /** a bug report's screenshot read */
  | "bug.screenshot"
  /** a bug report's status or note changed */
  | "bug.update"
  /** a reply sent to a bug report's reporter (its length; never its words) */
  | "bug.reply"
  /** an issue opened, muted or marked fixed, or its note changed */
  | "issue.update";

export type AuditTarget = "board" | "user" | "bug" | "issue";

export interface AuditEntry {
  adminId: string;
  action: AuditAction;
  targetKind: AuditTarget | null;
  targetId: string | null;
  /** small detail (a version, a status, a count); never student content */
  meta?: Record<string, unknown>;
}

/** The look could not be logged: the content is not shown (503). */
export class AuditError extends Error {
  constructor(cause: unknown) {
    super(`The admin audit log could not be written: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "AuditError";
  }
}

function row(entry: AuditEntry): Record<string, unknown> {
  return {
    admin_id: entry.adminId,
    action: entry.action,
    target_kind: entry.targetKind,
    target_id: entry.targetId === null ? null : entry.targetId.slice(0, 400),
    meta: entry.meta ?? null,
  };
}

/** Log a look before showing it. Throws AuditError when the row cannot be written. */
export async function auditLook(rest: Rest, entry: AuditEntry): Promise<void> {
  try {
    await rest.insert("admin_audit", row(entry));
  } catch (err) {
    log.error({ action: entry.action, targetId: entry.targetId, error: err instanceof Error ? err.message : String(err) }, "admin audit row not written: the content is not shown");
    throw new AuditError(err);
  }
}

/**
 * A look kept open is one look: the viewer's follow-live poll (a board read with `?since=`) logs at
 * most one row per admin and board this often. Opening a board always logs.
 */
export const REPEAT_LOOK_MS = 10 * 60_000;

/**
 * Log a look again only when this admin's same look (action and target) has no row in the last
 * `windowMs`: true when a row was written. Throws AuditError when it cannot tell, or when the row
 * is needed and cannot be written: no look goes unlogged.
 */
export async function auditRepeatLook(rest: Rest, entry: AuditEntry, windowMs = REPEAT_LOOK_MS): Promise<boolean> {
  let covered: unknown;
  try {
    covered = await rest.one({
      table: "admin_audit",
      params: {
        select: "id",
        admin_id: `eq.${entry.adminId}`,
        action: `eq.${entry.action}`,
        target_kind: entry.targetKind === null ? "is.null" : `eq.${entry.targetKind}`,
        target_id: entry.targetId === null ? "is.null" : `eq.${entry.targetId.slice(0, 400)}`,
        at: `gte.${new Date(rest.now - windowMs).toISOString()}`,
      },
    });
  } catch (err) {
    log.error({ action: entry.action, targetId: entry.targetId, error: err instanceof Error ? err.message : String(err) }, "admin audit not read: the content is not shown");
    throw new AuditError(err);
  }
  if (covered) return false;
  await auditLook(rest, entry);
  return true;
}

/** Log a change after making it. Never throws. */
export async function auditChange(rest: Rest, entry: AuditEntry): Promise<void> {
  try {
    await rest.insert("admin_audit", row(entry));
  } catch (err) {
    log.error({ action: entry.action, targetId: entry.targetId, error: err instanceof Error ? err.message : String(err) }, "admin audit row not written for a change that was made");
  }
}
