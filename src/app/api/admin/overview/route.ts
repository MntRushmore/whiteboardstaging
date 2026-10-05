import { logger } from "@/lib/logger";
import { requireAdmin } from "@/lib/server/admin";
import { buildAdminOverview, overviewDeps, OverviewQueryError } from "@/lib/server/adminOverview";
import { json } from "@/lib/server/auth";
import { checkRateLimit, LIMITS, rateLimitKey, rateLimitedResponse } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

const log = logger.child({ module: "admin-overview" });

/**
 * GET /api/admin/overview: everything the /admin page shows (`AdminOverview`,
 * src/lib/admin/contracts.ts), read with the service role (src/lib/server/adminOverview.ts).
 *
 * The caller must be an admin: `requireAdmin` is requireUser(req) (401 signed out) plus is_admin()
 * (404 for everyone else: the route does not exist for them), before anything is read or limited.
 * Then the operator bucket (`credits`, 30 a minute, per instance: one admin, a page that refreshes
 * every minute). 503 without SUPABASE_SERVICE_ROLE_KEY; 502 naming the table when a read fails.
 */
export async function GET(req: Request) {
  const requestId = crypto.randomUUID();
  const gate = await requireAdmin(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  const limited = checkRateLimit(rateLimitKey(user.id, "credits"), LIMITS.credits);
  if (!limited.ok) return rateLimitedResponse(limited.retryAfterMs, "memory");

  let deps: ReturnType<typeof overviewDeps>;
  try {
    deps = overviewDeps();
  } catch (err) {
    log.error({ requestId, err: err instanceof Error ? err.message : String(err) }, "admin overview: server env invalid");
    return json(500, "internal_error", "The server's environment is not set up.");
  }
  if (!deps) return json(503, "feature_unavailable", "SUPABASE_SERVICE_ROLE_KEY is not set, so the overview cannot read the tables.");

  const startedAt = Date.now();
  try {
    const overview = await buildAdminOverview(deps);
    log.info({ requestId, userId: user.id, ms: Date.now() - startedAt }, "admin overview");
    return Response.json(overview, { headers: { "Cache-Control": "no-store", "X-Request-Id": requestId } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ requestId, userId: user.id, what: err instanceof OverviewQueryError ? err.what : null, err: message }, "admin overview failed");
    return json(502, "upstream_error", err instanceof OverviewQueryError ? message : `The overview failed: ${message}`, { requestId }, { "Cache-Control": "no-store" });
  }
}
