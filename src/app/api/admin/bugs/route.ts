import { logger } from "@/lib/logger";
import { requireAdmin } from "@/lib/server/admin";
import { buildBugList } from "@/lib/server/adminConsole/bugs";
import { consoleEnv, consoleFailure, NO_STORE } from "@/lib/server/adminConsole/http";
import { checkRateLimit, LIMITS, rateLimitKey, rateLimitedResponse } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

const log = logger.child({ module: "admin-console", route: "admin/bugs" });

/**
 * GET /api/admin/bugs: the bug inbox, newest first (`AdminBugList`, src/lib/admin/contracts.ts;
 * src/lib/server/adminConsole/bugs.ts). Screenshots are not in it: `hasScreenshot` says whether
 * GET /api/admin/bugs/<id>/screenshot has one.
 *
 * `requireAdmin` first: requireUser(req) (401 signed out), then the admins table (404 for everyone
 * else), then the console's bucket (`adminConsole`). 503 without SUPABASE_SERVICE_ROLE_KEY, 502
 * naming the table when a read fails.
 */
export async function GET(req: Request) {
  const requestId = crypto.randomUUID();
  const gate = await requireAdmin(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  const limited = checkRateLimit(rateLimitKey(user.id, "adminConsole"), LIMITS.adminConsole);
  if (!limited.ok) return rateLimitedResponse(limited.retryAfterMs, "memory");

  const env = consoleEnv(log, requestId);
  if ("response" in env) return env.response;

  try {
    const list = await buildBugList(env.deps);
    log.info({ requestId, userId: user.id, bugs: list.bugs.length }, "admin bugs");
    return Response.json(list, { headers: { ...NO_STORE, "X-Request-Id": requestId } });
  } catch (err) {
    return consoleFailure(err, { log, requestId, userId: user.id, what: "bug list" });
  }
}
