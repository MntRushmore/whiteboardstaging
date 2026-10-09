import { logger } from "@/lib/logger";
import { requireAdmin } from "@/lib/server/admin";
import { consoleEnv, consoleFailure, NO_STORE, notFound, parseId } from "@/lib/server/adminConsole/http";
import { buildUserDetail } from "@/lib/server/adminConsole/users";
import { checkRateLimit, LIMITS, rateLimitKey, rateLimitedResponse } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

const log = logger.child({ module: "admin-console", route: "admin/users/[id]" });

/**
 * GET /api/admin/users/<id>: everything about one account (`AdminUserDetail`,
 * src/lib/admin/contracts.ts; src/lib/server/adminConsole/users.ts). Written to admin_audit
 * ('user.view') before it is answered: it shows the student's boards and learning record.
 *
 * `requireAdmin` first: requireUser(req) (401 signed out), then the admins table (404 for everyone
 * else), then the console's bucket (`adminConsole`). 400 for an id that is not a uuid, 404 for no
 * such account, 503 without SUPABASE_SERVICE_ROLE_KEY or when the look cannot be logged, 502 naming
 * the table when a read fails.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  const gate = await requireAdmin(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  const limited = checkRateLimit(rateLimitKey(user.id, "adminConsole"), LIMITS.adminConsole);
  if (!limited.ok) return rateLimitedResponse(limited.retryAfterMs, "memory");

  const id = await parseId(ctx.params, "user", requestId);
  if ("response" in id) return id.response;

  const env = consoleEnv(log, requestId);
  if ("response" in env) return env.response;

  try {
    const detail = await buildUserDetail(env.deps, id.id, user.id);
    if (!detail) return notFound("No account has that id.", requestId);
    log.info({ requestId, userId: user.id, target: id.id }, "admin user");
    return Response.json(detail, { headers: { ...NO_STORE, "X-Request-Id": requestId } });
  } catch (err) {
    return consoleFailure(err, { log, requestId, userId: user.id, what: "user page" });
  }
}
