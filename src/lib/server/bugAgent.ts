/**
 * The bug agent's door (the owner, 2026-10-27: "a AI ... that watches for bugs 24/7 and then fixes
 * them as they come in, or at least puts it in a batch"): an hourly cloud agent reads the new bug
 * reports here, writes its findings into the report's admin note, marks it seen, and replies to the
 * reporter in the app. Behind its own token (BUG_AGENT_TOKEN), never the reporter's email or id: the
 * agent's notes and branches end up in a PUBLIC repository.
 */
import { BUG_STATUSES, type BugStatus } from "@/lib/admin/contracts";
import { getServerEnv } from "@/lib/env";
import { replyToBug } from "@/lib/server/adminConsole/bugReplies";
import { consoleDeps, restClient, type ConsoleDeps, type Rest } from "@/lib/server/adminConsole/rest";
import { json } from "@/lib/server/auth";
import { bearerMatches } from "@/lib/server/storageGc";

/** A report as the agent sees it: what happened and where, never who. */
export interface AgentBug {
  id: string;
  createdAt: string;
  status: string;
  message: string | null;
  boardId: string | null;
  diagnostics: Record<string, unknown>;
  /** the last log lines the app sent (at most 60) */
  logs: unknown[];
  hasScreenshot: boolean;
  /** the agent's (and the team's) notes so far */
  note: string | null;
}

type Row = {
  id: string;
  created_at: string;
  status: string | null;
  message: string | null;
  board_id: string | null;
  diagnostics: Record<string, unknown> | null;
  logs: unknown[] | null;
  has_screenshot?: boolean;
  screenshot?: string | null;
  admin_note: string | null;
};

export const AGENT_LIST_LIMIT = 20;
export const AGENT_NOTE_MAX = 8000;

/** The agent's deps, or a ready response: 503 unconfigured, 401 a wrong token. */
export function agentGate(req: Request): { deps: ConsoleDeps; adminId: string | null } | { response: Response } {
  const env = getServerEnv();
  const token = env.BUG_AGENT_TOKEN;
  if (!token) return { response: json(503, "feature_unavailable", "The bug agent isn't set up.") };
  if (!bearerMatches(req.headers.get("authorization"), token)) return { response: json(401, "unauthorized", "Wrong token.") };
  const deps = consoleDeps();
  if (!deps) return { response: json(503, "feature_unavailable", "The database isn't reachable.") };
  return { deps, adminId: env.BUG_AGENT_ADMIN_ID ?? null };
}

function toBug(r: Row): AgentBug {
  return {
    id: r.id,
    createdAt: r.created_at,
    status: r.status ?? "new",
    message: r.message,
    boardId: r.board_id,
    diagnostics: r.diagnostics ?? {},
    logs: Array.isArray(r.logs) ? r.logs.slice(-60) : [],
    hasScreenshot: !!r.screenshot,
    note: r.admin_note,
  };
}

/** Reports in a status (default new), oldest first, so the queue is worked in order. */
export async function listBugs(rest: Rest, status: string, limit = AGENT_LIST_LIMIT): Promise<AgentBug[]> {
  const rows = await rest.rows<Row>({
    table: "bug_reports",
    params: {
      select: "id,created_at,status,message,board_id,diagnostics,logs,screenshot,admin_note",
      // a report from before statuses has none: it is new
      ...(status === "new" ? { or: "(status.is.null,status.eq.new)" } : { status: `eq.${status}` }),
      order: "created_at.asc",
      limit: String(Math.min(Math.max(1, limit), AGENT_LIST_LIMIT)),
    },
  });
  return rows.map(toBug);
}

/** A report's screenshot as bytes and type, or null. */
export async function bugScreenshot(rest: Rest, id: string): Promise<{ bytes: Buffer; type: string } | null> {
  const row = await rest.one<{ screenshot: string | null }>({ table: "bug_reports", params: { select: "screenshot", id: `eq.${id}` } });
  const m = row?.screenshot ? /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(row.screenshot) : null;
  return m ? { bytes: Buffer.from(m[2], "base64"), type: m[1] } : null;
}

/** The agent's update: a status and a note appended to the report's notes (dated). */
export async function updateBug(rest: Rest, id: string, change: { status?: string; note?: string }, at: Date): Promise<AgentBug | null> {
  const row = await rest.one<Row>({ table: "bug_reports", params: { select: "id,admin_note", id: `eq.${id}` } });
  if (!row) return null;
  const body: Record<string, unknown> = {};
  if (change.status !== undefined) {
    if (!(BUG_STATUSES as readonly string[]).includes(change.status)) throw new TypeError(`status is one of ${BUG_STATUSES.join(", ")}`);
    body.status = change.status as BugStatus;
    if (change.status === "fixed" || change.status === "wontfix") body.resolved_at = at.toISOString();
  }
  const note = change.note?.trim();
  if (note) {
    const stamped = `[agent ${at.toISOString().slice(0, 16).replace("T", " ")}] ${note}`;
    body.admin_note = `${row.admin_note ? `${row.admin_note}\n\n` : ""}${stamped}`.slice(-AGENT_NOTE_MAX);
  }
  if (Object.keys(body).length === 0) throw new TypeError("nothing to change: give status or note");
  const [updated] = await rest.patch<Row>(
    { table: "bug_reports", params: { id: `eq.${id}`, select: "id,created_at,status,message,board_id,diagnostics,logs,screenshot,admin_note" } },
    body,
  );
  return updated ? toBug(updated) : null;
}

/** A reply in the report's thread (the reporter sees it in the app), as the owner's admin account. */
export async function replyAsAgent(deps: ConsoleDeps, adminId: string, id: string, text: string): Promise<boolean> {
  const clean = text.trim();
  if (!clean || clean.length > 4000) throw new TypeError("a reply is 1–4000 characters");
  return (await replyToBug(deps, id, clean, adminId)) !== null;
}

export { restClient };
