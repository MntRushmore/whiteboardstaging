import { json } from "@/lib/server/auth";
import { requireAdmin } from "@/lib/server/admin";
import { healthDeps, healthLogger, runHealth, type HealthEnv, type HealthTrigger } from "@/lib/server/health/run";
import { checkRateLimit, clientIp, rateLimitedResponse } from "@/lib/server/rate-limit";
import { bearerMatches } from "@/lib/server/storageGc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * Six checks in parallel (8 s each at most), then the writes, the alert emails and, once a day, the
 * prune, each with its own deadline: under 45 s even when every one of them runs out of time.
 */
export const maxDuration = 60;

/**
 * GET /api/admin/health — is every service Agathon depends on up? Runs the checks in
 * src/lib/server/health/checks.ts (app, database, OpenRouter, Mathpix, Resend, Stripe webhooks) in
 * parallel, writes one health_checks row each, records a `health.<service>` event for each failure,
 * judges the alerts (emails to ALERT_EMAIL) and, once a day, prunes old admin rows
 * (src/lib/server/health/run.ts). Answers `HealthResult[]` (src/lib/admin/contracts.ts).
 *
 * Two callers, two ways in:
 *  - pg_cron, every 5 minutes (scripts/schedule-health.mjs): `Authorization: Bearer <CRON_SECRET>`,
 *    the secret read from Supabase Vault at call time, compared in constant time (`bearerMatches`).
 *    Vercel's plan allows only daily crons, so the schedule lives in the database.
 *  - an admin's "check now" on /admin: their own bearer token (`requireAdmin`). Runs the checks and
 *    writes the rows, but decides no alert (run.ts says why).
 *
 * PUBLIC BY DESIGN (allow-listed in scripts/lib/routes.mjs): the cron has no user JWT. Anything that
 * is not the cron secret must be an admin's token: 401 signed out, 404 for anyone else (the route
 * does not exist for them). Without SUPABASE_SERVICE_ROLE_KEY an authenticated caller gets 503
 * feature_unavailable. Rate limited per IP before anything else, so a leaked URL cannot make it
 * hammer the providers.
 */

/** Per-IP budget: pg_cron calls 12 times an hour; 20/min leaves room for "check now" and stops a loop. */
const HEALTH_LIMIT = { limit: 20, windowMs: 60_000 } as const;

const log = healthLogger.child({ route: "admin/health" });

export async function GET(req: Request) {
  const requestId = crypto.randomUUID();
  const rl = checkRateLimit(`ip:${clientIp(req)}:adminHealth`, HEALTH_LIMIT);
  if (!rl.ok) return rateLimitedResponse(rl.retryAfterMs);

  let env: HealthEnv;
  try {
    env = healthDeps.getEnv();
  } catch (err) {
    log.error({ requestId, error: err instanceof Error ? err.message : String(err) }, "server env invalid");
    return json(500, "internal_error", "Server is not configured.");
  }

  // pg_cron's CRON_SECRET first (constant time); anything else has to be an admin's token.
  let trigger: HealthTrigger;
  if (env.cronSecret && bearerMatches(req.headers.get("authorization"), env.cronSecret)) {
    trigger = "cron";
  } else {
    const admin = await requireAdmin(req);
    if ("response" in admin) {
      log.warn({ requestId, ip: clientIp(req), status: admin.response.status }, "health called without the cron secret or an admin's token");
      return admin.response;
    }
    trigger = "admin";
  }

  const serviceKey = env.serviceKey;
  if (!serviceKey) {
    log.warn({ requestId, trigger }, "health called but SUPABASE_SERVICE_ROLE_KEY is not set");
    return json(503, "feature_unavailable", "Health checks are not configured on this deployment (SUPABASE_SERVICE_ROLE_KEY).");
  }

  try {
    const results = await runHealth(healthDeps, { ...env, serviceKey }, { trigger, origin: new URL(req.url).origin, log: log.child({ requestId }) });
    return Response.json(results, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    log.error({ requestId, trigger, error: err instanceof Error ? err.message : String(err) }, "health checks failed");
    return json(500, "internal_error", "Health checks could not run.");
  }
}
