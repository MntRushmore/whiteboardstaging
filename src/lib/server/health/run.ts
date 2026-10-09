/**
 * One run of GET /api/admin/health, everything but the request: the env it reads, the checks, the
 * rows it writes, the events it records, the alerts and the daily prune. The route only
 * authenticates and answers; route files may not read process.env or export helpers
 * (routeProtection.test.ts), so all of this lives here, and tests replace `healthDeps`.
 *
 *   checks (in parallel, 8 s each) ──► health_checks rows ──► health.<service> events for failures
 *        └─► alerts (pg_cron runs only) ──► alert_state + emails to ALERT_EMAIL
 *        └─► prune_admin_rows() (the pg_cron run in PRUNE_HOUR_UTC's first five minutes)
 *
 * Who triggers what. pg_cron (CRON_SECRET) runs everything. An admin's "check now" runs the checks,
 * writes the rows and records the events, so the page shows the truth at once, but decides no
 * alert: the down rule counts failed checks "5 minutes apart", and two clicks a few seconds apart
 * must not page anyone. The next scheduled run (at most 5 minutes later) judges the alerts.
 *
 * Server-only: it reads the server env and holds the service role.
 */
import type pino from "pino";
import type { AppEventInput, HealthResult } from "@/lib/admin/contracts";
import { getServerEnv, isPlaceholderValue } from "@/lib/env";
import { DEFAULT_EMAIL_FROM, isSendableAddress, sendEmail, type ResendConfig, type SendEmailInput, type SendEmailResult } from "@/lib/email/resend";
import { logger } from "@/lib/logger";
import { recordEventNow } from "@/lib/server/events";
import { evaluateAlerts, type AlertRunSummary } from "@/lib/server/health/alerts";
import { runChecks, toHealthResult, type CheckEnv, type CheckResult } from "@/lib/server/health/checks";
import { insertHealthChecks, pruneAdminRows, type Rest } from "@/lib/server/health/store";
import { readCronSecret } from "@/lib/server/storageGc";

export const healthLogger = logger.child({ module: "admin-health" });

/** Where links point when NEXT_PUBLIC_SITE_URL is unset or unusable: production. */
export const PRODUCTION_SITE_URL = "https://www.agathon.app";

/** The daily prune runs in the first five minutes of this UTC hour (08:00 UTC: 4 AM Eastern, the quietest hour). */
export const PRUNE_HOUR_UTC = 8;

export type HealthEnv = {
  supabaseUrl: string;
  /** SUPABASE_SERVICE_ROLE_KEY; the route answers 503 without it. */
  serviceKey: string | undefined;
  /** CRON_SECRET (trimmed; placeholders are unset): pg_cron's bearer. */
  cronSecret: string | undefined;
  /** NEXT_PUBLIC_SITE_URL when it is an absolute http(s) URL (no trailing slash), else null. */
  siteUrl: string | null;
  openrouterKey: string | undefined;
  mathpix: { appId: string; appKey: string } | null;
  resend: ResendConfig;
  stripeWebhookConfigured: boolean;
  /** ALERT_EMAIL when it is one plain address, else null (alerts are then logged, not sent). */
  alertEmail: string | null;
};

/** An absolute http(s) URL without a trailing slash, or null. */
export function absoluteHttpUrl(raw: string | undefined | null): string | null {
  if (!raw?.trim()) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/**
 * ALERT_EMAIL, if it is one sendable address. Read from process.env directly: it is not in the
 * zod schema of src/lib/env.ts (which drops unknown keys); the same placeholder rule applies.
 */
export function readAlertEmail(raw: string | undefined = process.env.ALERT_EMAIL): string | null {
  if (raw === undefined || isPlaceholderValue(raw)) return null;
  const value = raw.trim();
  return isSendableAddress(value) ? value : null;
}

export function getHealthEnv(): HealthEnv {
  const env = getServerEnv();
  return {
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
    cronSecret: readCronSecret(env.CRON_SECRET),
    siteUrl: absoluteHttpUrl(env.NEXT_PUBLIC_SITE_URL),
    openrouterKey: env.OPENROUTER_API_KEY,
    mathpix: env.MATHPIX_APP_ID && env.MATHPIX_APP_KEY ? { appId: env.MATHPIX_APP_ID, appKey: env.MATHPIX_APP_KEY } : null,
    resend: { apiKey: env.RESEND_API_KEY ?? null, from: env.EMAIL_FROM?.trim() || DEFAULT_EMAIL_FROM },
    stripeWebhookConfigured: Boolean(env.STRIPE_WEBHOOK_SECRET),
    alertEmail: readAlertEmail(),
  };
}

export type HealthDeps = {
  getEnv: () => HealthEnv;
  fetch: typeof fetch;
  now: () => Date;
  /** recordEventNow (src/lib/server/events.ts): awaited, never rejects. */
  recordEvent: (event: AppEventInput) => Promise<void>;
  send: (message: SendEmailInput, config: ResendConfig) => Promise<SendEmailResult>;
};

export const healthDeps: HealthDeps = {
  getEnv: getHealthEnv,
  // Looked up at call time, so a test's stubbed global fetch is the one used.
  fetch: (input, init) => fetch(input, init),
  now: () => new Date(),
  recordEvent: (event) => recordEventNow(event),
  send: (message, config) => sendEmail(message, config),
};

export type HealthTrigger = "cron" | "admin";

export type RunHealthOptions = {
  trigger: HealthTrigger;
  /** The request's own origin: the app check's fallback when NEXT_PUBLIC_SITE_URL is unset. */
  origin: string;
  log: pino.Logger;
};

/** Is `now` in the daily prune slot (the one pg_cron run every day lands in)? */
export function isPruneSlot(now: Date): boolean {
  return now.getUTCHours() === PRUNE_HOUR_UTC && now.getUTCMinutes() < 5;
}

/** The `health.<service>` event for a failed check (no secrets: `detail` never carries one). */
export function failureEvent(result: CheckResult, trigger: HealthTrigger): AppEventInput {
  return {
    source: "health",
    level: "error",
    kind: `health.${result.service}`,
    code: result.code ?? "unknown",
    message: (result.detail ?? "check failed").slice(0, 500),
    route: "/api/admin/health",
    meta: { latencyMs: result.latencyMs, trigger },
  };
}

/**
 * Runs the checks and everything after them (see the module comment). Needs the service role
 * (the caller answers 503 without it). Never throws for a failed write, alert or prune: those are
 * logged, and the results are answered regardless.
 */
export async function runHealth(deps: HealthDeps, env: HealthEnv & { serviceKey: string }, opts: RunHealthOptions): Promise<HealthResult[]> {
  const { log } = opts;
  const now = deps.now();
  const startedAt = Date.now();
  const siteUrl = env.siteUrl ?? absoluteHttpUrl(opts.origin) ?? PRODUCTION_SITE_URL;
  const checkEnv: CheckEnv = {
    supabaseUrl: env.supabaseUrl,
    serviceKey: env.serviceKey,
    siteUrl,
    openrouterKey: env.openrouterKey,
    mathpix: env.mathpix,
    resendKey: env.resend.apiKey?.trim() || undefined,
    emailFrom: env.resend.from?.trim() || DEFAULT_EMAIL_FROM,
    stripeWebhookConfigured: env.stripeWebhookConfigured,
  };
  const rest: Rest = { url: env.supabaseUrl, serviceKey: env.serviceKey, fetch: deps.fetch };

  const results = await runChecks(checkEnv, { fetch: deps.fetch, now: deps.now });
  const failing = results.filter((r) => !r.ok);

  await Promise.all([
    insertHealthChecks(rest, results.map(toHealthResult)).catch((err: unknown) => {
      log.error({ error: err instanceof Error ? err.message : String(err) }, "health_checks rows could not be written");
    }),
    ...failing.map((r) =>
      deps.recordEvent(failureEvent(r, opts.trigger)).catch((err: unknown) => {
        log.warn({ service: r.service, error: err instanceof Error ? err.message : String(err) }, "health event could not be recorded");
      }),
    ),
  ]);

  let alerts: AlertRunSummary | null = null;
  if (opts.trigger === "cron") {
    alerts = await evaluateAlerts(
      { rest, send: deps.send, resend: env.resend, alertEmail: env.alertEmail, siteUrl, now, log },
      results,
    );
  }

  let pruned: unknown = undefined;
  if (opts.trigger === "cron" && isPruneSlot(now)) {
    try {
      pruned = await pruneAdminRows(rest);
      log.info({ pruned }, "admin rows past their retention pruned");
    } catch (err) {
      log.error({ error: err instanceof Error ? err.message : String(err) }, "prune_admin_rows failed (is the admin migration applied?)");
    }
  }

  log.info(
    {
      trigger: opts.trigger,
      durationMs: Date.now() - startedAt,
      failing: failing.map((r) => `${r.service}: ${r.detail ?? ""}`),
      alerts: alerts && { firing: alerts.firing, sent: alerts.sent, skipped: alerts.skipped, failed: alerts.failed, stateless: alerts.stateless },
      pruned,
    },
    "health checks summary",
  );
  return results.map(toHealthResult);
}
