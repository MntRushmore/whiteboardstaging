/**
 * The admin system's shared contract (2026-10-05): what goes wrong (app events), whether each
 * service is up (health checks), when the owner is emailed (alert rules), and what the /admin page
 * reads (the overview). The single source of truth for every admin module; change it only with
 * every owner's consent.
 *
 *   board / pages ──client report──► /api/client-errors ─┐
 *   API routes, model + Mathpix calls ──recordEvent──────┼──► app_events (service role only)
 *   pg_cron every 5 min ──► /api/admin/health ──checks──► health_checks ──► alert email (ALERT_EMAIL)
 *   /admin (admins only) ◄── /api/admin/overview ◄── app_events, health_checks, usage_events, profiles…
 *
 * Runtime dependency: zod only (shared by server routes and the /admin page).
 */
import { z } from "zod";

// ------------------------------------------------------------------ app events

/** Where an event was seen. */
export const EVENT_SOURCES = [
  /** a crash in the browser: a window error, a rejection, an error boundary */
  "client",
  /** an error card or note a student saw on the board or in Ask (`setLiveError`, the chat's failures, a save that failed) */
  "live",
  /** a server route failed: a 5xx, a provider (model, Mathpix) failure or timeout, a fallback model used */
  "server",
  /** a health check failed (also kept in health_checks) */
  "health",
] as const;
export type EventSource = (typeof EVENT_SOURCES)[number];

export const EVENT_LEVELS = ["error", "warn", "info"] as const;
export type EventLevel = (typeof EVENT_LEVELS)[number];

/**
 * An event's `kind`: dotted, lower case, at most 64 chars. Conventions (the overview groups by it):
 *  - `client.<source>`            a browser crash (`client.boundary`, `client.error`, `client.rejection`)
 *  - `live.<what>`                an error a student saw (`live.recognize`, `live.check`, `live.solve`,
 *                                 `live.capabilities`, `live.chat`, `live.save`, `live.ink`)
 *  - `route.<name>`               a server route answered 5xx (`route.live.solve`)
 *  - `model.<route>`              a model call failed (`code`: timeout | upstream | invalid) or fell back (`code`: fallback, level warn)
 *  - `mathpix`                    a Mathpix call failed
 *  - `health.<service>`           a health check failed
 */
export const EVENT_KIND = /^[a-z0-9][a-z0-9_.:-]{0,63}$/;

export const AppEventInputSchema = z.object({
  source: z.enum(EVENT_SOURCES),
  level: z.enum(EVENT_LEVELS).default("error"),
  kind: z.string().regex(EVENT_KIND),
  /** a short machine code: network, timeout, upstream, rate_limited, ink, unauthorized, invalid, fallback, unknown… */
  code: z.string().max(40).optional(),
  /** what happened, in words (no student content: never what they wrote or typed) */
  message: z.string().max(500).default(""),
  /** the API route or page path */
  route: z.string().max(200).optional(),
  userId: z.string().uuid().optional(),
  boardId: z.string().uuid().optional(),
  requestId: z.string().max(64).optional(),
  /** small structured detail (model id, latency, status); at most ~2 KB serialized */
  meta: z.record(z.string(), z.unknown()).optional(),
  release: z.string().max(64).optional(),
});
export type AppEventInput = z.input<typeof AppEventInputSchema>;
export type AppEvent = z.output<typeof AppEventInputSchema>;

// ------------------------------------------------------------------ health

/** What the health checks watch, in the order the page lists them. */
export const SERVICES = [
  /** the site answers (its own /api/health) */
  "app",
  /** Supabase Postgres answers a query */
  "database",
  /** OpenRouter answers, the key works and credits remain (every model call goes through it) */
  "openrouter",
  /** Mathpix answers and the keys work (handwriting → maths) */
  "mathpix",
  /** Resend answers and the key works (welcome and reminder emails, these alerts) */
  "email",
  /** Stripe webhooks are arriving and none failed lately (ink and Unlimited) */
  "stripe",
] as const;
export type Service = (typeof SERVICES)[number];

export interface HealthResult {
  service: Service;
  ok: boolean;
  /** how long the check took */
  latencyMs: number;
  /** why it failed, or a short note when it passed (e.g. "$12.40 credit left") */
  detail?: string;
  /** ISO */
  at: string;
}

// ------------------------------------------------------------------ alerts

/** When the owner is emailed (ALERT_EMAIL). Throttled: never more than one email per rule per `repeatAfterMin`, and one on recovery. */
export const ALERT_RULES = {
  /** a service is down after this many failed checks in a row (5 min apart) */
  downAfterFailures: 2,
  /** errors students saw: at least `minErrors` events from at least `minUsers` users in the last `windowMin` minutes */
  errorSpike: { windowMin: 15, minErrors: 10, minUsers: 3 },
  /** the same alert again at most this often while it lasts */
  repeatAfterMin: 60,
  /** OpenRouter credit below this many dollars is an alert (the owner tops it up by hand) */
  lowCreditsUsd: 5,
} as const;

/** How long rows are kept. */
export const RETENTION_DAYS = { appEvents: 30, healthChecks: 14 } as const;

// ------------------------------------------------------------------ the /admin page

export const ServiceStatusSchema = z.object({
  service: z.enum(SERVICES),
  /** null: never checked */
  ok: z.boolean().nullable(),
  lastCheckAt: z.string().nullable(),
  latencyMs: z.number().nullable(),
  detail: z.string().nullable(),
  /** share of checks that passed in the last 24 h (0..1); null with none */
  uptime24h: z.number().min(0).max(1).nullable(),
  /** ISO: failing since (null when up) */
  downSince: z.string().nullable(),
});
export type ServiceStatus = z.infer<typeof ServiceStatusSchema>;

export const ErrorGroupSchema = z.object({
  kind: z.string(),
  code: z.string().nullable(),
  source: z.enum(EVENT_SOURCES),
  level: z.enum(EVENT_LEVELS),
  message: z.string(),
  count: z.number().int(),
  /** distinct users who hit it */
  users: z.number().int(),
  firstAt: z.string(),
  lastAt: z.string(),
  /** the latest few, for a closer look */
  samples: z.array(
    z.object({
      at: z.string(),
      userEmail: z.string().nullable(),
      boardId: z.string().nullable(),
      route: z.string().nullable(),
      requestId: z.string().nullable(),
    }),
  ),
});
export type ErrorGroup = z.infer<typeof ErrorGroupSchema>;

export const AdminOverviewSchema = z.object({
  generatedAt: z.string(),
  services: z.array(ServiceStatusSchema),
  openrouter: z.object({ creditsLeftUsd: z.number().nullable(), usedUsd: z.number().nullable() }).nullable(),
  errors: z.object({
    /** errors (level error) in the last 24 h, and how many users they touched */
    total24h: z.number().int(),
    users24h: z.number().int(),
    /** the last 48 hours, oldest first, every hour present */
    perHour: z.array(z.object({ hour: z.string(), errors: z.number().int(), warnings: z.number().int() })),
    /** the last 24 h grouped by kind + code + message, most frequent first (at most 30) */
    groups: z.array(ErrorGroupSchema),
  }),
  ai: z.object({
    /** per metered route, the last 24 h: calls (usage_events) and failures (app_events) */
    routes: z.array(z.object({ route: z.string(), calls24h: z.number().int(), failures24h: z.number().int(), fallbacks24h: z.number().int() })),
  }),
  users: z.object({ total: z.number().int(), signups24h: z.number().int(), signups7d: z.number().int(), active24h: z.number().int(), active7d: z.number().int() }),
  /**
   * Agathon Unlimited, from `unlimited_subscriptions` (what Stripe's webhooks wrote), admins' own
   * subscriptions left out. Statuses are Stripe's: trialing, active, past_due / unpaid (a charge
   * failing), canceled / incomplete_expired (over). "Set to cancel" is `cancel_at_period_end` or a
   * `cancel_at`: no further charge is coming.
   */
  money: z.object({
    /** the plan's monthly price (UNLIMITED_PLAN.monthlyUsd) */
    priceUsd: z.number(),
    /** subscriptions in `active`, set to cancel or not */
    paying: z.number().int(),
    /** of those, set to cancel */
    payingCancelling: z.number().int(),
    /** active and not set to cancel, times the price */
    mrrUsd: z.number(),
    /** subscriptions in their free trial */
    trialing: z.number().int(),
    /** of those, set to cancel (no first charge is coming) */
    trialsCancelling: z.number().int(),
    /** in trial and not set to cancel, times the price: the monthly revenue if every trial converts */
    pipelineUsd: z.number(),
    /** a charge failing (past_due, unpaid) */
    failing: z.number().int(),
    /** over (canceled, incomplete_expired) */
    ended: z.number().int(),
    /** subscriptions whose trial has ended, and how many of those went on to pay (active) */
    trialsOver: z.number().int(),
    trialsConverted: z.number().int(),
    /** subscriptions started in the last 7 days */
    started7d: z.number().int(),
    /** charges coming in the next 14 days, soonest first: a trial's first charge or a renewal (not set to cancel) */
    upcoming: z.array(z.object({ at: z.string(), kind: z.enum(["first", "renewal"]), usd: z.number() })),
  }),
  /** how far accounts get: signed up, finished the welcome, started a trial (ever), paying now (admins left out of the last two) */
  funnel: z.object({ accounts: z.number().int(), onboarded: z.number().int(), trials: z.number().int(), paying: z.number().int() }),
  learning: z.object({ attempts24h: z.number().int(), solvedAlone24h: z.number().int() }),
  bugReports: z.array(z.object({ at: z.string(), email: z.string().nullable(), message: z.string(), path: z.string().nullable() })),
});
export type AdminOverview = z.infer<typeof AdminOverviewSchema>;

/** The routes the admin system adds. */
export const ADMIN_ROUTES = {
  /** GET: the overview (an admin's bearer token) */
  overview: "/api/admin/overview",
  /** GET: run the checks (Authorization: Bearer CRON_SECRET from pg_cron; or an admin's token, "check now") */
  health: "/api/admin/health",
} as const;
