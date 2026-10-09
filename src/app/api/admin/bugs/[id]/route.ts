import { AdminBugPatchSchema } from "@/lib/admin/contracts";
import { logger } from "@/lib/logger";
import { requireAdmin } from "@/lib/server/admin";
import { patchBug } from "@/lib/server/adminConsole/bugs";
import { badRequest, consoleEnv, consoleFailure, NO_STORE, notFound, parseId } from "@/lib/server/adminConsole/http";
import { checkRateLimit, LIMITS, rateLimitKey, rateLimitedResponse } from "@/lib/server/rate-limit";
import { parseJsonBody } from "@/lib/server/request";

export const dynamic = "force-dynamic";

const log = logger.child({ module: "admin-console", route: "admin/bugs/[id]" });

/**
 * PATCH /api/admin/bugs/<id> `{ status?, note? }` (AdminBugPatchSchema, src/lib/admin/contracts.ts):
 * triage one bug report. Answers the report as it now stands (`AdminBug`); resolvedAt follows the
 * status (the table's trigger). Written to admin_audit ('bug.update').
 *
 * `requireAdmin` first: requireUser(req) (401 signed out), then the admins table (404 for everyone
 * else), then the console's bucket (`adminConsole`). 400 for a bad id or body (or one that changes
 * nothing), 404 for no such report, 503 without SUPABASE_SERVICE_ROLE_KEY, 502 when the write fails.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  const gate = await requireAdmin(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  const limited = checkRateLimit(rateLimitKey(user.id, "adminConsole"), LIMITS.adminConsole);
  if (!limited.ok) return rateLimitedResponse(limited.retryAfterMs, "memory");

  const id = await parseId(ctx.params, "bug report", requestId);
  if ("response" in id) return id.response;
  const body = await parseJsonBody(req, AdminBugPatchSchema);
  if ("response" in body) return body.response;
  if (body.data.status === undefined && body.data.note === undefined) return badRequest("Nothing to change: send a status, a note, or both.", requestId);

  const env = consoleEnv(log, requestId);
  if ("response" in env) return env.response;

  try {
    const bug = await patchBug(env.deps, id.id, body.data, user.id);
    if (!bug) return notFound("No bug report has that id.", requestId);
    log.info({ requestId, userId: user.id, bugId: id.id, status: body.data.status ?? null }, "admin bug triaged");
    return Response.json(bug, { headers: { ...NO_STORE, "X-Request-Id": requestId } });
  } catch (err) {
    return consoleFailure(err, { log, requestId, userId: user.id, what: "bug update" });
  }
}
