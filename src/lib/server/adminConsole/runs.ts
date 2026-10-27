/**
 * The picture tutor's runs for the console (GET /api/admin/runs): its app_events, newest first. An
 * outcome (accepted, rejected…) carries no board, so a board's filter shows its runs only.
 */
import type { AdminRunList } from "@/lib/admin/contracts";
import { latestEvents, toAdminEvent } from "./events";
import type { Rest } from "./rest";

export const RUN_KINDS = ["board_draw", "board_draw_outcome"] as const;
export const RUNS_MAX = 300;

export async function pictureRuns(rest: Rest, opts: { boardId?: string; limit?: number } = {}): Promise<AdminRunList> {
  const limit = Math.min(Math.max(1, opts.limit ?? 150), RUNS_MAX);
  const rows = await latestEvents(rest, { kind: `in.(${RUN_KINDS.join(",")})`, ...(opts.boardId ? { board_id: `eq.${opts.boardId}` } : {}) }, limit);
  const emails = await rest.emails(rows.map((r) => r.user_id));
  return { generatedAt: new Date(rest.now).toISOString(), runs: rows.map((r) => toAdminEvent(r, emails)) };
}
