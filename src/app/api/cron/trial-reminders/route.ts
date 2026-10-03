import { json } from "@/lib/server/auth";
import { checkRateLimit, clientIp, rateLimitedResponse } from "@/lib/server/rate-limit";
import { bearerMatches } from "@/lib/server/storageGc";
import { emailLogger } from "@/lib/email/resend";
import { emailDeps, type EmailEnv } from "@/lib/email/server";
import { runTrialReminders, type TrialReminderSummary } from "@/lib/email/trialReminders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Up to MAX_SENDS_PER_RUN sends, spaced for Resend's rate limit. */
export const maxDuration = 60;

/**
 * GET /api/cron/trial-reminders — "Your free week ends on <date>" for every Agathon Unlimited
 * trial ending 24 to 72 hours from now, once per subscription (Vercel cron, daily; logic in
 * src/lib/email/trialReminders.ts).
 *
 * PUBLIC BY DESIGN, exactly like /api/admin/gc (allow-listed in scripts/lib/routes.mjs, reason
 * "Vercel cron; requires Authorization: Bearer CRON_SECRET"): the cron has no user JWT. Vercel
 * sends `Authorization: Bearer <CRON_SECRET>` when the CRON_SECRET env var is set; it is compared
 * in constant time (`bearerMatches`). Without a match: 401 unauthorized. Without CRON_SECRET, the
 * service role or RESEND_API_KEY: 503 feature_unavailable (the deployment sends no reminders).
 *
 * A manual run with the bearer sends too: every reminder goes at most once (email_log), so a
 * second run the same day finds nothing new. `?dryRun=1` lists what would be sent and sends nothing
 * (and needs no RESEND_API_KEY).
 *
 * Body: `{ dryRun, window, found, due, alreadySent, sent, failed, skipped, deferred, wouldSend? }`.
 */

/** Per-IP budget: the cron fires once a day; 10/min stops a leaked URL from being hammered. */
const REMINDER_LIMIT = { limit: 10, windowMs: 60_000 } as const;

const log = emailLogger.child({ route: "cron/trial-reminders" });

export async function GET(req: Request) {
  const requestId = crypto.randomUUID();
  const rl = checkRateLimit(`ip:${clientIp(req)}:trialReminders`, REMINDER_LIMIT);
  if (!rl.ok) return rateLimitedResponse(rl.retryAfterMs);

  let env: EmailEnv;
  try {
    env = emailDeps.getEnv();
  } catch (err) {
    log.error({ requestId, error: err instanceof Error ? err.message : String(err) }, "server env invalid");
    return json(500, "internal_error", "Server is not configured.");
  }
  if (!env.cronSecret) {
    log.warn({ requestId }, "trial reminders called but CRON_SECRET is not set");
    return json(503, "feature_unavailable", "Trial reminders are not configured on this deployment (CRON_SECRET).");
  }
  if (!bearerMatches(req.headers.get("authorization"), env.cronSecret)) {
    log.warn({ requestId, ip: clientIp(req) }, "trial reminders called with a missing or wrong cron secret");
    return json(401, "unauthorized", "This endpoint is for the scheduled job.", undefined, { "WWW-Authenticate": "Bearer" });
  }
  if (!env.hasServiceRole) {
    log.warn({ requestId }, "trial reminders called but SUPABASE_SERVICE_ROLE_KEY is not set");
    return json(503, "feature_unavailable", "Trial reminders are not configured on this deployment (SUPABASE_SERVICE_ROLE_KEY).");
  }
  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
  if (!dryRun && !env.resend.apiKey) {
    log.warn({ requestId }, "trial reminders called but RESEND_API_KEY is not set");
    return json(503, "feature_unavailable", "Trial reminders are not configured on this deployment (RESEND_API_KEY).");
  }

  const startedAt = Date.now();
  let summary: TrialReminderSummary;
  try {
    summary = await runTrialReminders(emailDeps, env, { dryRun }, log.child({ requestId }));
  } catch (err) {
    log.error({ requestId, dryRun, error: err instanceof Error ? err.message : String(err) }, "trial reminders failed");
    return json(500, "internal_error", "Trial reminders could not run.");
  }
  const { wouldSend, ...counts } = summary;
  log.info({ requestId, durationMs: Date.now() - startedAt, ...counts, wouldSend: wouldSend?.length }, "trial reminders summary");
  return Response.json(summary, { headers: { "Cache-Control": "no-store" } });
}
