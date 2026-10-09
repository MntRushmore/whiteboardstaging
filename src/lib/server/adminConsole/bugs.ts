/**
 * The bug inbox: reports students sent (`AdminBugList`, newest first), their triage (status, note:
 * PATCH, logged as `bug.update`) and their screenshots (the image's bytes, logged as
 * `bug.screenshot` before they are served).
 *
 * The list reads the admin_bug_rows view (bug_reports without the screenshot, a data URL of up to a
 * few MB, plus whether there is one); only the screenshot route reads the screenshot itself.
 * A report's log keeps its last MAX_LOGS lines, browser and extension noise removed (isNoise over
 * the line's words).
 *
 * Each report comes with its thread (bug_report_messages, 20261009160000_bug_replies.sql): the listed
 * reports' messages are read together, THREAD_BATCH report ids per request (a page of
 * ADMIN_LIMITS.bugs reports is two requests however many messages), never one read per report.
 * Replying is src/lib/server/adminConsole/bugReplies.ts.
 */
import { ADMIN_LIMITS, BUG_STATUSES, type AdminBug, type AdminBugList, type BugStatus } from "@/lib/admin/contracts";
import { BUG_MESSAGE_AUTHORS, BUG_MESSAGE_MAX, type BugMessage, type BugMessageAuthor } from "@/lib/bugReports/contracts";
import { reportPath } from "@/lib/server/adminOverview";
import { auditChange, auditLook } from "./audit";
import { logLineIsNoise } from "./noise";
import { restClient, type ConsoleDeps, type Rest } from "./rest";

export const BUG_SELECT = "id,created_at,user_id,user_email,board_id,message,diagnostics,logs,status,admin_note,resolved_at,reporter_seen_at,has_screenshot";
/** Report ids per read of their messages (about 4 KB of URL). */
export const THREAD_BATCH = 100;
/** Messages per report at most, the oldest (a thread is a few messages; this only guards the page). */
export const MAX_THREAD = 200;
/** Log lines per report, the newest. */
export const MAX_LOGS = 200;
/** One log line's words at most. */
export const MAX_LOG_TEXT = 2_000;
/** A report's message at most (the client caps it; this only guards the page). */
export const MAX_MESSAGE = 5_000;

/** One admin_bug_rows row. */
export interface BugViewRow {
  id: string;
  created_at: string;
  user_id: string | null;
  user_email: string | null;
  board_id: string | null;
  message: string | null;
  diagnostics: unknown;
  logs: unknown;
  status: string | null;
  admin_note: string | null;
  resolved_at: string | null;
  has_screenshot: boolean | null;
  reporter_seen_at?: string | null;
}

/** One bug_report_messages row. */
export interface BugMessageRow {
  id: string;
  report_id: string;
  author: string;
  body: string | null;
  created_at: string;
}

const asObject = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** One logged argument as words (the client stores strings; anything else is shown as JSON). */
function argText(a: unknown): string {
  if (typeof a === "string") return a;
  try {
    return JSON.stringify(a) ?? String(a);
  } catch {
    return String(a);
  }
}

/** A stored log line (`{level, time, args: string[]}`) as `{level, time, text}`; null when unreadable. */
export function logLine(raw: unknown): AdminBug["logs"][number] | null {
  const o = asObject(raw);
  if (!o) return null;
  const args = Array.isArray(o.args) ? o.args : o.message !== undefined ? [o.message] : [];
  const text = args.map(argText).join(" ").slice(0, MAX_LOG_TEXT);
  const time = typeof o.time === "string" ? o.time : typeof o.time === "number" && Number.isFinite(o.time) ? new Date(o.time).toISOString() : "";
  return { level: typeof o.level === "string" ? o.level : "log", time, text };
}

/** The log as the inbox shows it: noise removed, the last MAX_LOGS lines (stored oldest first). */
export function bugLogs(raw: unknown): AdminBug["logs"] {
  if (!Array.isArray(raw)) return [];
  const lines: AdminBug["logs"] = [];
  for (const entry of raw) {
    const line = logLine(entry);
    if (line && !logLineIsNoise(line.text)) lines.push(line);
  }
  return lines.slice(-MAX_LOGS);
}

/** A stored message as the inbox shows it; null for an author the contract does not know. */
export function toBugMessage(row: BugMessageRow): BugMessage | null {
  if (!(BUG_MESSAGE_AUTHORS as readonly string[]).includes(row.author)) return null;
  return { id: row.id, author: row.author as BugMessageAuthor, body: (row.body ?? "").slice(0, BUG_MESSAGE_MAX), at: row.created_at };
}

/** A thread oldest first (ties by id, as my_bug_reports() orders them), at most MAX_THREAD. */
export function sortThread(thread: readonly BugMessage[]): BugMessage[] {
  return [...thread].sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, MAX_THREAD);
}

/** One report for the inbox, with its thread (`waiting` when the reporter wrote last). */
export function toAdminBug(row: BugViewRow, thread: readonly BugMessage[] = []): AdminBug {
  const diagnostics = asObject(row.diagnostics);
  const status = (BUG_STATUSES as readonly string[]).includes(row.status ?? "") ? (row.status as BugStatus) : "new";
  const messages = sortThread(thread);
  return {
    id: row.id,
    at: row.created_at,
    userId: row.user_id ?? null,
    email: row.user_email ?? null,
    boardId: row.board_id ?? null,
    message: (row.message ?? "").slice(0, MAX_MESSAGE),
    path: reportPath(typeof diagnostics?.url === "string" ? diagnostics.url : null),
    status,
    note: row.admin_note ?? null,
    resolvedAt: row.resolved_at ?? null,
    hasScreenshot: row.has_screenshot === true,
    diagnostics,
    logs: bugLogs(row.logs),
    thread: messages,
    waiting: messages.at(-1)?.author === "reporter",
    reporterSeenAt: row.reporter_seen_at ?? null,
  };
}

/** These reports' messages, by report, each oldest first: THREAD_BATCH ids per request, the batches in parallel. */
export async function threadsFor(rest: Rest, reportIds: readonly string[]): Promise<Map<string, BugMessage[]>> {
  const ids = [...new Set(reportIds)];
  const out = new Map<string, BugMessage[]>();
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += THREAD_BATCH) batches.push(ids.slice(i, i + THREAD_BATCH));
  const pages = await Promise.all(
    batches.map((batch) =>
      rest.paged<BugMessageRow>({
        table: "bug_report_messages",
        params: { select: "id,report_id,author,body,created_at", report_id: `in.(${batch.join(",")})`, order: "created_at.asc,id.asc" },
      }),
    ),
  );
  for (const { rows } of pages) {
    for (const row of rows) {
      const message = toBugMessage(row);
      if (!message) continue;
      const list = out.get(row.report_id) ?? [];
      list.push(message);
      out.set(row.report_id, list);
    }
  }
  return out;
}

/** Reports newest first, at most `limit`, narrowed by `filter` (`user_id=eq.…`), each with its thread. */
export async function bugsWhere(rest: Rest, filter: Record<string, string>, limit: number = ADMIN_LIMITS.bugs): Promise<AdminBug[]> {
  const rows = await rest.rows<BugViewRow>({ table: "admin_bug_rows", params: { select: BUG_SELECT, ...filter, order: "created_at.desc", limit: String(limit) } });
  const threads = await threadsFor(
    rest,
    rows.map((r) => r.id),
  );
  return rows.map((row) => toAdminBug(row, threads.get(row.id)));
}

export async function buildBugList(deps: ConsoleDeps): Promise<AdminBugList> {
  const rest = restClient(deps);
  return { generatedAt: new Date(rest.now).toISOString(), bugs: await bugsWhere(rest, {}) };
}

export interface BugPatch {
  status?: BugStatus;
  /** null clears it; absent leaves it */
  note?: string | null;
}

/**
 * Triage one report: its status (resolved_at follows it, by the table's trigger) and/or its note.
 * The report as it now stands, or null when there is no such report. Logged as `bug.update`.
 */
export async function patchBug(deps: ConsoleDeps, id: string, patch: BugPatch, adminId: string): Promise<AdminBug | null> {
  const rest = restClient(deps);
  const update: Record<string, unknown> = {};
  if (patch.status !== undefined) update.status = patch.status;
  if (patch.note !== undefined) update.admin_note = patch.note === null || patch.note.trim() === "" ? null : patch.note;
  const changed = await rest.patch<{ id: string }>({ table: "bug_reports", params: { id: `eq.${id}`, select: "id" } }, update);
  if (!changed.length) return null;
  const [bug] = await bugsWhere(rest, { id: `eq.${id}` }, 1);
  await auditChange(rest, {
    adminId,
    action: "bug.update",
    targetKind: "bug",
    targetId: id,
    meta: { ...(patch.status !== undefined ? { status: patch.status } : {}), ...(patch.note !== undefined ? { note: update.admin_note === null ? "cleared" : "set" } : {}) },
  });
  return bug ?? null;
}

/** The image types a screenshot may be served as (never SVG: it can carry script). */
export const SCREENSHOT_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

/** A `data:image/…;base64,…` URL's bytes and type; null for anything else. */
export function decodeImageDataUrl(dataUrl: string): { contentType: string; bytes: Uint8Array } | null {
  const comma = dataUrl.indexOf(",");
  if (comma < 0 || comma > 64) return null;
  const header = /^data:([a-z]+\/[a-z0-9.+-]+);base64$/i.exec(dataUrl.slice(0, comma).trim());
  if (!header) return null;
  const contentType = header[1].toLowerCase();
  if (!(SCREENSHOT_TYPES as readonly string[]).includes(contentType)) return null;
  const payload = dataUrl.slice(comma + 1);
  if (!/^[A-Za-z0-9+/=\s]*$/.test(payload.slice(0, 256))) return null;
  const bytes = Buffer.from(payload, "base64");
  if (!bytes.length) return null;
  return { contentType, bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) };
}

export type ScreenshotResult =
  | { kind: "missing" }
  | { kind: "none" }
  | { kind: "invalid" }
  | { kind: "image"; contentType: string; bytes: Uint8Array };

/** One report's screenshot, decoded, once the look is logged (`bug.screenshot`). */
export async function bugScreenshot(deps: ConsoleDeps, id: string, adminId: string): Promise<ScreenshotResult> {
  const rest = restClient(deps);
  const row = await rest.one<{ screenshot: string | null; user_id: string | null }>({ table: "bug_reports", params: { select: "screenshot,user_id", id: `eq.${id}` } });
  if (!row) return { kind: "missing" };
  if (!row.screenshot) return { kind: "none" };
  const image = decodeImageDataUrl(row.screenshot);
  if (!image) return { kind: "invalid" };
  await auditLook(rest, { adminId, action: "bug.screenshot", targetKind: "bug", targetId: id, meta: { bytes: image.bytes.byteLength, ...(row.user_id ? { ownerId: row.user_id } : {}) } });
  return { kind: "image", ...image };
}
