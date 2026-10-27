import { z } from "zod";
import { logger } from "@/lib/logger";
import { requireAdmin } from "@/lib/server/admin";
import { consoleEnv, consoleFailure, NO_STORE, parseQuery } from "@/lib/server/adminConsole/http";
import { restClient } from "@/lib/server/adminConsole/rest";
import { pictureRuns, RUNS_MAX } from "@/lib/server/adminConsole/runs";
import { checkRateLimit, LIMITS, rateLimitKey, rateLimitedResponse } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

const log = logger.child({ module: "admin-console", route: "admin/runs" });

const QuerySchema = z.object({
  boardId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(RUNS_MAX).default(150),
});

/**
 * GET /api/admin/runs (?boardId=, ?limit=): the picture tutor's runs, newest first (`AdminRunList`,
 * src/lib/admin/contracts.ts). `requireAdmin` first: requireUser(req) (401 signed out), then the admins
 * table (404 for everyone else), then the console's bucket (`adminConsole`).
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
    const list = await pictureRuns(restClient(env.deps), { boardId: query.data.boardId, limit: query.data.limit });
    return Response.json(list, { headers: { ...NO_STORE, "X-Request-Id": requestId } });
  } catch (err) {
    return consoleFailure(err, { log, requestId, userId: user.id, what: "picture tutor runs" });
  }
}
