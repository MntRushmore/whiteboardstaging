import { z } from "zod";
import { logger } from "@/lib/logger";
import { requireAdmin } from "@/lib/server/admin";
import { buildBoardList } from "@/lib/server/adminConsole/boards";
import { consoleEnv, consoleFailure, IdSchema, NO_STORE, parseQuery } from "@/lib/server/adminConsole/http";
import { checkRateLimit, LIMITS, rateLimitKey, rateLimitedResponse } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

const log = logger.child({ module: "admin-console", route: "admin/boards" });

const QuerySchema = z.object({
  /** one user's boards */
  userId: IdSchema.optional(),
  /** only boards saved in the last ADMIN_LIMITS.liveWindowMin */
  live: z
    .enum(["1", "0", "true", "false"])
    .optional()
    .transform((v) => v === "1" || v === "true"),
  /** the next page: the previous page's nextBefore */
  before: z.string().datetime({ offset: true }).optional(),
});

/**
 * GET /api/admin/boards?userId=&live=1&before=: a page of boards, newest first (`AdminBoardList`,
 * src/lib/admin/contracts.ts; src/lib/server/adminConsole/boards.ts). Written to admin_audit
 * ('boards.list') before it is answered: the rows carry the students' board thumbnails.
 *
 * `requireAdmin` first: requireUser(req) (401 signed out), then the admins table (404 for everyone
 * else), then the console's bucket (`adminConsole`). 400 for a bad query, 503 without
 * SUPABASE_SERVICE_ROLE_KEY or when the look cannot be logged, 502 naming the table when a read fails.
 */
export async function GET(req: Request) {
  const requestId = crypto.randomUUID();
  const gate = await requireAdmin(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  const limited = checkRateLimit(rateLimitKey(user.id, "adminConsole"), LIMITS.adminConsole);
  if (!limited.ok) return rateLimitedResponse(limited.retryAfterMs, "memory");

  const query = parseQuery(req, QuerySchema, requestId);
  if ("response" in query) return query.response;

  const env = consoleEnv(log, requestId);
  if ("response" in env) return env.response;

  try {
    const list = await buildBoardList(env.deps, query.data, user.id);
    log.info({ requestId, userId: user.id, boards: list.boards.length, live: query.data.live }, "admin boards");
    return Response.json(list, { headers: { ...NO_STORE, "X-Request-Id": requestId } });
  } catch (err) {
    return consoleFailure(err, { log, requestId, userId: user.id, what: "board list" });
  }
}
