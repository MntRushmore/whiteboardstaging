import { logger } from "@/lib/logger";
import { requireAdmin } from "@/lib/server/admin";
import { consoleEnv, consoleFailure, NO_STORE } from "@/lib/server/adminConsole/http";
import { buildUserList } from "@/lib/server/adminConsole/users";
import { checkRateLimit, LIMITS, rateLimitKey, rateLimitedResponse } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

const log = logger.child({ module: "admin-console", route: "admin/users" });

/**
 * GET /api/admin/users: every account, most recently active first (`AdminUserList`,
 * src/lib/admin/contracts.ts; src/lib/server/adminConsole/users.ts).
 *
 * `requireAdmin` first: requireUser(req) (401 signed out), then the admins table (404 for everyone
 * else: the route does not exist for them), before anything is read or limited. Then the console's
 * bucket (`adminConsole`, per instance). 503 without SUPABASE_SERVICE_ROLE_KEY; 502 naming the table
 * (or "auth") when a read fails.
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

  const startedAt = Date.now();
  try {
    const list = await buildUserList(env.deps);
    log.info({ requestId, userId: user.id, users: list.users.length, ms: Date.now() - startedAt }, "admin users");
    return Response.json(list, { headers: { ...NO_STORE, "X-Request-Id": requestId } });
  } catch (err) {
    return consoleFailure(err, { log, requestId, userId: user.id, what: "users list" });
  }
}
