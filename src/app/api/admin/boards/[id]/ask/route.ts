import { logger } from "@/lib/logger";
import { requireAdmin } from "@/lib/server/admin";
import { readBoardAsk } from "@/lib/server/adminConsole/askChat";
import { consoleEnv, consoleFailure, NO_STORE, notFound, parseId } from "@/lib/server/adminConsole/http";
import { checkRateLimit, LIMITS, rateLimitKey, rateLimitedResponse } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

const log = logger.child({ module: "admin-console", route: "admin/boards/[id]/ask" });

/**
 * GET /api/admin/boards/<id>/ask: the board's Ask chat for the viewer's Ask tab (`AdminAskChat`,
 * src/lib/admin/contracts.ts; src/lib/server/adminConsole/askChat.ts), once admin_audit has the look
 * ('board.ask').
 *
 * `requireAdmin` first (401 signed out, 404 for everyone else), then the console's bucket. 400 for a
 * bad id, 404 for no such board, 503 without SUPABASE_SERVICE_ROLE_KEY or when the look cannot be
 * logged, 502 naming the table when a read fails. Always no-store.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  const gate = await requireAdmin(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  const limited = checkRateLimit(rateLimitKey(user.id, "adminConsole"), LIMITS.adminConsole);
  if (!limited.ok) return rateLimitedResponse(limited.retryAfterMs, "memory");

  const id = await parseId(ctx.params, "board", requestId);
  if ("response" in id) return id.response;

  const env = consoleEnv(log, requestId);
  if ("response" in env) return env.response;

  try {
    const chat = await readBoardAsk(env.deps, id.id, user.id);
    if (!chat) return notFound("No board has that id.", requestId);
    log.info({ requestId, userId: user.id, boardId: id.id, turns: chat.turns.length }, "admin board ask view");
    return Response.json(chat, { headers: { ...NO_STORE, "X-Request-Id": requestId } });
  } catch (err) {
    return consoleFailure(err, { log, requestId, userId: user.id, what: "board's Ask chat" });
  }
}
