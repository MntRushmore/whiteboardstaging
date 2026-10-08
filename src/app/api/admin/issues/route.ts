import { z } from "zod";
import { AdminIssuePatchSchema } from "@/lib/admin/contracts";
import { logger } from "@/lib/logger";
import { requireAdmin } from "@/lib/server/admin";
import { consoleEnv, consoleFailure, NO_STORE, parseQuery } from "@/lib/server/adminConsole/http";
import { buildIssueList, patchIssue, type IssueDays } from "@/lib/server/adminConsole/issues";
import { checkRateLimit, LIMITS, rateLimitKey, rateLimitedResponse } from "@/lib/server/rate-limit";
import { parseJsonBody } from "@/lib/server/request";

export const dynamic = "force-dynamic";

const log = logger.child({ module: "admin-console", route: "admin/issues" });

const QuerySchema = z.object({
  days: z
    .enum(["1", "7", "30"])
    .default("7")
    .transform((d) => Number(d) as IssueDays),
});

/**
 * GET /api/admin/issues?days=1|7|30 (default 7): app_events grouped into issues, most recent first
 * (`AdminIssueList`, src/lib/admin/contracts.ts; src/lib/server/adminConsole/issues.ts).
 * PATCH /api/admin/issues `{ fingerprint, status, note? }` (AdminIssuePatchSchema): open, mute or
 * mark fixed; answers the stored state `{ fingerprint, status, note, fixedAt, updatedAt }`, written
 * to admin_audit ('issue.update').
 *
 * `requireAdmin` first: requireUser(req) (401 signed out), then the admins table (404 for everyone
 * else), then the console's bucket (`adminConsole`). 400 for a bad query or body, 503 without
 * SUPABASE_SERVICE_ROLE_KEY, 502 naming the table when a read or write fails.
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

  const startedAt = Date.now();
  try {
    const list = await buildIssueList(env.deps, query.data.days);
    log.info({ requestId, userId: user.id, days: list.days, issues: list.issues.length, ms: Date.now() - startedAt }, "admin issues");
    return Response.json(list, { headers: { ...NO_STORE, "X-Request-Id": requestId } });
  } catch (err) {
    return consoleFailure(err, { log, requestId, userId: user.id, what: "issue list" });
  }
}

export async function PATCH(req: Request) {
  const requestId = crypto.randomUUID();
  const gate = await requireAdmin(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  const limited = checkRateLimit(rateLimitKey(user.id, "adminConsole"), LIMITS.adminConsole);
  if (!limited.ok) return rateLimitedResponse(limited.retryAfterMs, "memory");

  const body = await parseJsonBody(req, AdminIssuePatchSchema);
  if ("response" in body) return body.response;

  const env = consoleEnv(log, requestId);
  if ("response" in env) return env.response;

  try {
    const state = await patchIssue(env.deps, body.data, user.id);
    log.info({ requestId, userId: user.id, fingerprint: state.fingerprint, status: state.status }, "admin issue updated");
    return Response.json(state, { headers: { ...NO_STORE, "X-Request-Id": requestId } });
  } catch (err) {
    return consoleFailure(err, { log, requestId, userId: user.id, what: "issue update" });
  }
}
