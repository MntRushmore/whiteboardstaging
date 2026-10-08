import { z } from "zod";
import { logger } from "@/lib/logger";
import { requireAdmin } from "@/lib/server/admin";
import { openBoardDoc } from "@/lib/server/adminConsole/boards";
import { consoleEnv, consoleFailure, NO_STORE, notFound, parseId, parseQuery } from "@/lib/server/adminConsole/http";
import { checkRateLimit, LIMITS, rateLimitKey, rateLimitedResponse } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";
/** A board's data can be 8 MB: it streams for as long as the admin's connection needs. */
export const maxDuration = 60;

const log = logger.child({ module: "admin-console", route: "admin/boards/[id]" });

const QuerySchema = z.object({
  /** the version the viewer has: the same version answers `{ unchanged: true, version }` */
  since: z
    .string()
    .regex(/^\d{1,15}$/, "a whole number")
    .transform(Number)
    .optional(),
});

/**
 * GET /api/admin/boards/<id>?since=<version>: one board for the viewer and the replay
 * (`AdminBoardDoc`, src/lib/admin/contracts.ts; src/lib/server/adminConsole/boards.ts). With `since`
 * equal to the board's version, `{ unchanged: true, version }` and nothing else (the viewer's
 * follow-live poll: nothing read but the version, nothing logged). Otherwise the document, its
 * `snapshot` the stored whiteboards.data streamed as it is (never parsed here), once admin_audit has
 * the look ('board.view').
 *
 * `requireAdmin` first: requireUser(req) (401 signed out), then the admins table (404 for everyone
 * else), then the console's bucket (`adminConsole`: room for the poll every ADMIN_LIMITS.followPollMs).
 * 400 for a bad id or since, 404 for no such board, 503 without SUPABASE_SERVICE_ROLE_KEY or when the
 * look cannot be logged, 502 naming the table when a read fails. Always no-store.
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
  const query = parseQuery(req, QuerySchema, requestId);
  if ("response" in query) return query.response;

  const env = consoleEnv(log, requestId);
  if ("response" in env) return env.response;

  try {
    const doc = await openBoardDoc(env.deps, id.id, { since: query.data.since, adminId: user.id });
    const headers = { ...NO_STORE, "X-Request-Id": requestId };
    if (doc.kind === "missing") return notFound("No board has that id.", requestId);
    if (doc.kind === "unchanged") return Response.json({ unchanged: true, version: doc.version }, { headers });
    log.info({ requestId, userId: user.id, boardId: id.id, version: doc.version }, "admin board view");
    return new Response(doc.body, { headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });
  } catch (err) {
    return consoleFailure(err, { log, requestId, userId: user.id, what: "board" });
  }
}
