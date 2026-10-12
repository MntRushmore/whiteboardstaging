/**
 * A board's Ask chat for the console (`AdminAskChat`): the viewer's Ask tab. The owner wants to see
 * what kids ask the tutor and how it answers, to make it better.
 *
 * Read with the service role, like everything in the console (ask_messages' own policy shows a
 * student only their own rows), and only once admin_audit has the look ('board.ask', with the
 * board's owner): no look goes unlogged, and a look that cannot be logged is not shown (503, as the
 * board itself). A deleted board, or none, is "missing" (404).
 */
import { ADMIN_LIMITS, type AdminAskChat } from "@/lib/admin/contracts";
import { toStoredTurn } from "@/lib/server/ask/store";
import { auditLook } from "./audit";
import { ConsoleQueryError, restClient, type ConsoleDeps } from "./rest";

export const ASK_TURN_SELECT = "id,role,body,notes,wrote,created_at";

interface AskRow {
  id: string;
  role: string;
  body: string;
  notes: unknown;
  wrote: unknown;
  created_at: string;
}

/** The board's chat, oldest first, once the look is logged; null for no such board. */
export async function readBoardAsk(deps: ConsoleDeps, boardId: string, adminId: string): Promise<AdminAskChat | null> {
  const rest = restClient(deps);
  const board = await rest.one<{ id: string; user_id: string }>({ table: "whiteboards", params: { select: "id,user_id", id: `eq.${boardId}`, deleted_at: "is.null" } });
  if (!board) return null;
  await auditLook(rest, { adminId, action: "board.ask", targetKind: "board", targetId: boardId, meta: { ownerId: board.user_id } });
  let rows: AskRow[];
  try {
    rows = await rest.rows<AskRow>({
      table: "ask_messages",
      params: { select: ASK_TURN_SELECT, board_id: `eq.${boardId}`, order: "seq.asc", limit: String(ADMIN_LIMITS.askTurns) },
    });
  } catch (err) {
    // the console's message names its own migration; this table comes from Ask's
    if (err instanceof ConsoleQueryError && /does not exist/.test(err.message)) {
      throw new ConsoleQueryError("ask_messages", err.status, "it does not exist (is migration 20261011000000_ask_v2.sql applied?)");
    }
    throw err;
  }
  return { generatedAt: new Date(rest.now).toISOString(), boardId, turns: rows.map(toStoredTurn) };
}
