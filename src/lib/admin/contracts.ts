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
 * Runtime dependency: zod only (shared by server routes and the /admin page), and the bug replies'
 * contract (src/lib/bugReports/contracts.ts), which is zod only too.
 */
import { z } from "zod";
import { BUG_MESSAGE_MAX, BugMessageSchema } from "@/lib/bugReports/contracts";

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

// ------------------------------------------------------------------ the admin console (2026-10-08)
//
// /admin grows from one overview page into a console: who uses Agathon (users, one page per user),
// their boards (a read-only viewer and a replay), what they reported (a bug inbox with screenshots)
// and what broke (issues: error groups you can mute or mark fixed). Every route below is admin-only
// (`requireAdmin`), reads with the service role, and is listed in scripts/lib/routes.mjs.
//
// Privacy. An admin opening a student's board, replay or bug screenshot is written to `admin_audit`
// (who, what, when), and the privacy policy says staff may look at a board to support and improve
// the service. Nothing here leaves the server except to the admin's own browser.
//
// Later (not built here): student accounts under a parent, and live study rooms. Keep a board view
// a function of (snapshot, who may see it), so a parent's view of a child's board and a room's
// shared board reuse the same viewer and replay (src/components/replay).

/** Where an account stands with Agathon Unlimited, from `unlimited_subscriptions` (the newest row). */
export const PLAN_STATES = [
  /** never started a subscription */
  "none",
  /** in the free trial, first charge coming */
  "trialing",
  /** in the free trial but set to cancel: no charge is coming */
  "trial_cancelling",
  /** paying */
  "active",
  /** paying but set to cancel at the period's end */
  "cancelling",
  /** a charge is failing (past_due, unpaid) */
  "failing",
  /** over (canceled, incomplete_expired) */
  "ended",
] as const;
export type PlanState = (typeof PLAN_STATES)[number];

export const AdminUserRowSchema = z.object({
  id: z.string().uuid(),
  email: z.string().nullable(),
  /** profiles.display_name */
  name: z.string().nullable(),
  /** profiles.course */
  course: z.string().nullable(),
  createdAt: z.string(),
  onboardedAt: z.string().nullable(),
  /** the latest of: a board saved, an AI call, a learning attempt updated, a sign-in (auth last_sign_in_at) */
  lastActiveAt: z.string().nullable(),
  plan: z.enum(PLAN_STATES),
  /** ISO, while trialing */
  trialEndsAt: z.string().nullable(),
  /** boards not deleted */
  boards: z.number().int(),
  /** learning attempts in the last 7 days, and how many of those the student solved alone (INDEPENDENT_OUTCOMES) */
  attempts7d: z.number().int(),
  solvedAlone7d: z.number().int(),
  /** metered AI calls in the last 7 days (usage_events + unlimited_usage) */
  aiCalls7d: z.number().int(),
  /** app_events at level error in the last 7 days, noise left out */
  errors7d: z.number().int(),
  bugReports: z.number().int(),
  isAdmin: z.boolean(),
});
export type AdminUserRow = z.infer<typeof AdminUserRowSchema>;

/** GET ADMIN_ROUTES.users: every account (at most ADMIN_LIMITS.users), most recently active first. The page filters and sorts in the browser. */
export const AdminUserListSchema = z.object({
  generatedAt: z.string(),
  total: z.number().int(),
  users: z.array(AdminUserRowSchema),
});
export type AdminUserList = z.infer<typeof AdminUserListSchema>;

export const AdminBoardRowSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  ownerEmail: z.string().nullable(),
  ownerName: z.string().nullable(),
  title: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** whiteboards.preview: an inline image data URL of the student's current screen, null when empty */
  preview: z.string().nullable(),
  version: z.number().int(),
  /** pg_column_size(data) / 1024, rounded */
  sizeKb: z.number().int(),
  /** learning attempts on this board */
  attempts: z.number().int(),
  /** app_events at level error on this board in the last 7 days, noise left out */
  errors7d: z.number().int(),
});
export type AdminBoardRow = z.infer<typeof AdminBoardRowSchema>;

/** GET ADMIN_ROUTES.boards (?userId= one user's; ?live=1 updated in the last ADMIN_LIMITS.liveWindowMin; ?before=<updatedAt ISO> next page). Newest first. */
export const AdminBoardListSchema = z.object({
  generatedAt: z.string(),
  boards: z.array(AdminBoardRowSchema),
  /** pass as ?before= for the next page; null at the end */
  nextBefore: z.string().nullable(),
});
export type AdminBoardList = z.infer<typeof AdminBoardListSchema>;

export const AdminEventSchema = z.object({
  id: z.number().int(),
  at: z.string(),
  source: z.enum(EVENT_SOURCES),
  level: z.enum(EVENT_LEVELS),
  kind: z.string(),
  code: z.string().nullable(),
  message: z.string(),
  route: z.string().nullable(),
  userId: z.string().nullable(),
  userEmail: z.string().nullable(),
  boardId: z.string().nullable(),
  requestId: z.string().nullable(),
  meta: z.record(z.string(), z.unknown()).nullable(),
  release: z.string().nullable(),
  /** isNoise (src/lib/clientErrors.ts): a browser's or extension's own script, not ours */
  noise: z.boolean(),
});
export type AdminEvent = z.infer<typeof AdminEventSchema>;

export const ATTEMPT_OUTCOMES = ["in_progress", "first_try", "self_corrected", "with_help", "tutor_solved", "unfinished"] as const;

export const AdminAttemptSchema = z.object({
  id: z.string(),
  boardId: z.string().nullable(),
  problemLatex: z.string(),
  skill: z.string(),
  outcome: z.enum(ATTEMPT_OUTCOMES),
  hints: z.number().int(),
  solves: z.number().int(),
  linesRinged: z.number().int(),
  activeMs: z.number().int(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
});
export type AdminAttempt = z.infer<typeof AdminAttemptSchema>;

export const BUG_STATUSES = ["new", "seen", "fixed", "wontfix"] as const;
export type BugStatus = (typeof BUG_STATUSES)[number];

export const AdminBugSchema = z.object({
  id: z.string(),
  at: z.string(),
  userId: z.string().nullable(),
  email: z.string().nullable(),
  boardId: z.string().nullable(),
  message: z.string(),
  /** diagnostics.url's path */
  path: z.string().nullable(),
  status: z.enum(BUG_STATUSES),
  note: z.string().nullable(),
  resolvedAt: z.string().nullable(),
  /** GET ADMIN_ROUTES.bugScreenshot(id) serves it (image bytes); false when the report has none */
  hasScreenshot: z.boolean(),
  /** bug_reports.diagnostics as stored (device, viewport, browser) */
  diagnostics: z.record(z.string(), z.unknown()).nullable(),
  /** bug_reports.logs, noise entries removed, newest last, at most 200 */
  logs: z.array(z.object({ level: z.string(), time: z.string(), text: z.string() })),
  /** bug_report_messages: the admins' replies and the reporter's, oldest first (2026-10-09) */
  thread: z.array(BugMessageSchema),
  /** the last message is the reporter's: they are waiting on an answer */
  waiting: z.boolean(),
  /** bug_reports.reporter_seen_at: when the reporter last opened their replies; null: never */
  reporterSeenAt: z.string().nullable(),
});
export type AdminBug = z.infer<typeof AdminBugSchema>;

/** GET ADMIN_ROUTES.bugs: newest first (at most ADMIN_LIMITS.bugs). */
export const AdminBugListSchema = z.object({ generatedAt: z.string(), bugs: z.array(AdminBugSchema) });
export type AdminBugList = z.infer<typeof AdminBugListSchema>;

/** PATCH ADMIN_ROUTES.bug(id) */
export const AdminBugPatchSchema = z.object({ status: z.enum(BUG_STATUSES).optional(), note: z.string().max(2000).nullable().optional() });

/** POST ADMIN_API.bugMessages(id): an admin's reply, trimmed (src/lib/bugReports/contracts.ts has the shared rules). */
export const AdminBugReplyInputSchema = z.object({ body: z.string().trim().min(1, "Write a reply first.").max(BUG_MESSAGE_MAX) });

/**
 * Whether the reply's email went out: to the reporter, or to a kid profile's grown-up. `skipped`
 * with why (no account on the report, no address, email not set up here); `failed` when Resend
 * refused or could not be reached. The reply is saved either way.
 */
export const BUG_REPLY_EMAIL_SKIPS = ["no_reporter", "no_email", "no_grown_up", "not_configured"] as const;
export const AdminBugReplyEmailSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("sent"), to: z.enum(["reporter", "grown_up"]) }),
  z.object({ status: z.literal("skipped"), reason: z.enum(BUG_REPLY_EMAIL_SKIPS) }),
  // `to` null: it failed before the recipient was known (the account could not be read)
  z.object({ status: z.literal("failed"), to: z.enum(["reporter", "grown_up"]).nullable() }),
]);
export type AdminBugReplyEmail = z.infer<typeof AdminBugReplyEmailSchema>;

/** POST ADMIN_API.bugMessages(id) answers the report as it now stands (the reply in its thread) and the email's fate. */
export const AdminBugReplySchema = z.object({ bug: AdminBugSchema, email: AdminBugReplyEmailSchema });
export type AdminBugReply = z.infer<typeof AdminBugReplySchema>;

export const ISSUE_STATUSES = ["open", "muted", "fixed"] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

/**
 * An issue: the app_events that are the same problem, by fingerprint = issueFingerprint(kind, code,
 * message) (digits in the message already read "#"). Muting hides it from the inbox and the alert
 * spike count; "fixed" hides it until an event arrives after `fixedAt` (then `regressed`).
 */
export const AdminIssueSchema = z.object({
  fingerprint: z.string(),
  kind: z.string(),
  code: z.string().nullable(),
  source: z.enum(EVENT_SOURCES),
  level: z.enum(EVENT_LEVELS),
  message: z.string(),
  count: z.number().int(),
  users: z.number().int(),
  boards: z.number().int(),
  firstAt: z.string(),
  lastAt: z.string(),
  /** events per day for the window, oldest first, every day present */
  perDay: z.array(z.number().int()),
  status: z.enum(ISSUE_STATUSES),
  note: z.string().nullable(),
  fixedAt: z.string().nullable(),
  /** marked fixed, then seen again after fixedAt */
  regressed: z.boolean(),
  /** every event of it is noise (isNoise) */
  noise: z.boolean(),
  /** the latest few, with the board and user to open */
  samples: z.array(AdminEventSchema),
});
export type AdminIssue = z.infer<typeof AdminIssueSchema>;

/** GET ADMIN_ROUTES.issues (?days=1|7|30, default 7): most recent first. */
export const AdminIssueListSchema = z.object({ generatedAt: z.string(), days: z.number().int(), issues: z.array(AdminIssueSchema) });
export type AdminIssueList = z.infer<typeof AdminIssueListSchema>;

/** PATCH ADMIN_ROUTES.issues */
export const AdminIssuePatchSchema = z.object({ fingerprint: z.string().min(1).max(400), status: z.enum(ISSUE_STATUSES), note: z.string().max(2000).nullable().optional() });

/** The key an issue is grouped by. Pure: the server groups with it, the page links with it. */
export function issueFingerprint(kind: string, code: string | null | undefined, message: string): string {
  const msg = message.replace(/\d+/g, "#").replace(/\s+/g, " ").trim().slice(0, 200);
  return `${kind}|${code ?? ""}|${msg}`;
}

/** GET ADMIN_ROUTES.user(id): everything about one account. */
export const AdminUserDetailSchema = z.object({
  generatedAt: z.string(),
  user: AdminUserRowSchema,
  subscription: z
    .object({
      status: z.string(),
      trialEnd: z.string().nullable(),
      currentPeriodEnd: z.string().nullable(),
      cancelAtPeriodEnd: z.boolean(),
      cancelAt: z.string().nullable(),
      payerEmail: z.string().nullable(),
      createdAt: z.string(),
    })
    .nullable(),
  inkBalance: z.number().int().nullable(),
  /** the user's boards, newest first (no deleted ones) */
  boards: z.array(AdminBoardRowSchema),
  learning: z.object({
    attempts: z.number().int(),
    solvedAlone: z.number().int(),
    withHelp: z.number().int(),
    tutorSolved: z.number().int(),
    activeMinutes: z.number().int(),
    /** by skill, most attempts first */
    skills: z.array(z.object({ skill: z.string(), attempts: z.number().int(), solvedAlone: z.number().int() })),
    /** the latest 50 */
    recent: z.array(AdminAttemptSchema),
  }),
  /** the last 30 days, oldest first, every day present (the user's time zone is unknown: UTC days) */
  activity: z.array(z.object({ day: z.string(), attempts: z.number().int(), aiCalls: z.number().int(), boards: z.number().int() })),
  /** the latest 100 app_events of this user, noise included (flagged) */
  events: z.array(AdminEventSchema),
  bugs: z.array(AdminBugSchema),
  emails: z.array(z.object({ kind: z.string(), sentAt: z.string().nullable() })),
});
export type AdminUserDetail = z.infer<typeof AdminUserDetailSchema>;

/**
 * GET ADMIN_ROUTES.board(id): one board for the viewer and the replay. `snapshot` is
 * whiteboards.data as stored (a tldraw store snapshot `{document:{store,schema}, session}`, or an
 * older bare store snapshot). With ?since=<version> and the board unchanged, the answer is
 * `{ unchanged: true, version }` and nothing else (the viewer's "follow live" poll).
 * Each read that returns a snapshot writes admin_audit (action 'board.view'), but a follow-live poll
 * (`since` given) only when the admin has no row for the board in the last 10 minutes: a follow
 * session is one logged look (src/lib/server/adminConsole/audit.ts, REPEAT_LOOK_MS).
 */
export const AdminBoardDocSchema = z.object({
  generatedAt: z.string(),
  board: AdminBoardRowSchema,
  snapshot: z.unknown(),
  events: z.array(AdminEventSchema),
  attempts: z.array(AdminAttemptSchema),
  /** whiteboard_snapshots kept for it (the operator's undo), newest first; not their data */
  history: z.array(z.object({ id: z.number().int(), at: z.string(), version: z.number().int(), reason: z.string() })),
});
export type AdminBoardDoc = z.infer<typeof AdminBoardDocSchema>;
export const AdminBoardUnchangedSchema = z.object({ unchanged: z.literal(true), version: z.number().int() });

export const ADMIN_LIMITS = {
  users: 2000,
  boardsPage: 48,
  bugs: 200,
  /** a board saved this recently counts as "live now" */
  liveWindowMin: 5,
  /** the viewer's follow-live poll */
  followPollMs: 4000,
} as const;

/** The console's pages (all behind requireAdmin's answer: a non-admin gets the app's 404). */
export const ADMIN_PAGES = {
  overview: "/admin",
  users: "/admin/users",
  user: (id: string) => `/admin/users/${id}`,
  boards: "/admin/boards",
  /** the read-only viewer and replay (its own bundle: it loads tldraw) */
  board: (id: string) => `/admin/boards/${id}`,
  bugs: "/admin/bugs",
  issues: "/admin/issues",
} as const;

/** The console's API routes (bearer token of an admin; 401 signed out, 404 non-admin). */
export const ADMIN_API = {
  users: "/api/admin/users",
  user: (id: string) => `/api/admin/users/${id}`,
  boards: "/api/admin/boards",
  board: (id: string) => `/api/admin/boards/${id}`,
  bugs: "/api/admin/bugs",
  /** PATCH */
  bug: (id: string) => `/api/admin/bugs/${id}`,
  /** GET: the screenshot's bytes (image/png), Cache-Control private */
  bugScreenshot: (id: string) => `/api/admin/bugs/${id}/screenshot`,
  /** POST { body }: reply to the reporter (saved, then emailed) */
  bugMessages: (id: string) => `/api/admin/bugs/${id}/messages`,
  /** GET list, PATCH state */
  issues: "/api/admin/issues",
} as const;
