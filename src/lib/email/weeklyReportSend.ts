/**
 * Sends the Sunday email (src/lib/email/weeklyReport.ts) from the daily cron
 * (GET /api/cron/trial-reminders, which also runs the trial's reminders and nudges: Vercel Hobby
 * allows few crons). OFF unless WEEKLY_REPORT_EMAILS=on: the owner declined a parent email on
 * 2026-10-04, so it ships built and waiting; without the flag a run reads nothing and sends nothing.
 *
 * When. On Sunday in the family's zone the email tells the week ending that day; on Monday and
 * Tuesday, the week that just ended (the families a run had no time for, or a run that failed,
 * catch up). The cron runs daily at 15:00 UTC, late Sunday morning on the US east coast, so a week's
 * email has three runs. The server has no stored zone for an account, so this is DEFAULT_REPORT_TZ
 * (America/New_York), the zone every Agathon email already uses.
 *
 * Who. Each account holding a plan (an Agathon Unlimited subscription trialing or active: the
 * grown-up, whose kids share it), never a kid profile, never an account with
 * profiles.weekly_report_opt_out, and only when someone in the family did something that week. To
 * the payer's address, else the account's (`billingRecipient`: never a kid address, and the send
 * layer refuses one anyway). Each email carries a signed unsubscribe link and the RFC 8058
 * one-click headers (src/lib/report/unsubscribe.ts, under REPORT_LINK_SECRET, else CRON_SECRET).
 *
 * How many. A run works through every due family until its time is up (`deadline`, the cron's
 * WEEKLY_RUN_BUDGET_MS), not up to a fixed count; the rest wait for the next run while the week is
 * due. The families whose last weekly email is oldest go first (never sent first), so a run that
 * runs out of time never leaves the same families behind week after week.
 *
 * Once per week per account: email_log (kind 'weekly_report', ref = the week's Monday), claimed
 * before the send (`sendOnce`).
 */
import type pino from "pino";
import { isKidEmail } from "@/lib/family/contracts";
import { sendOnce, type EmailLogKey } from "@/lib/email/log";
import { billingRecipient } from "@/lib/email/payer";
import type { EmailDeps, EmailEnv } from "@/lib/email/server";
import { SEND_SPACING_MS, sendWithOneRetry } from "@/lib/email/trialReminders";
import { emailChildren, weeklyReportEmail } from "@/lib/email/weeklyReport";
import { reportScope } from "@/lib/report/access";
import type { WeeklyReport } from "@/lib/report/contracts";
import { weeklyReportEmailsOn } from "@/lib/report/flag";
import { createReportStore, readFamilyWeek } from "@/lib/report/server";
import { unsubscribeUrl } from "@/lib/report/unsubscribe";
import { addDays, DEFAULT_REPORT_TZ, localDayIn, weekStartAt } from "@/lib/report/week";
import { serviceClient } from "@/lib/server/billing";

export const WEEKLY_REPORT_KIND = "weekly_report" as const;

/**
 * How long after the cron run began the weekly emails stop starting a new family. The function has
 * 60 s (the route's maxDuration); one family's read and send take about a second, a slow send up to
 * about 20 s (a 10 s timeout, a short 429 wait, one retry), so the last one started still finishes.
 */
export const WEEKLY_RUN_BUDGET_MS = 40_000;

/** Subscriptions that count as holding a plan. */
export const PLAN_STATUSES = ["trialing", "active"] as const;

/** Plan rows read per run. */
export const PLAN_QUERY_LIMIT = 1000;

/** The catch-up for last week runs through this weekday (Monday 0 … Sunday 6): Monday and Tuesday. */
export const LAST_CATCH_UP_WEEKDAY = 1;

/** How far back `lastSent` looks for a family's last weekly email; older than this counts as never. */
export const LAST_SENT_LOOKBACK_WEEKS = 8;

/** Pure: the week whose email is due at `now` in `timeZone`, and whether today is its last day; null when none is. */
export function weeklyEmailDue(now: Date, timeZone: string = DEFAULT_REPORT_TZ): { weekStart: string; lastDay: boolean } | null {
  const ms = now.getTime();
  const today = localDayIn(ms, timeZone);
  const weekday = (new Date(Date.parse(`${today}T00:00:00Z`)).getUTCDay() + 6) % 7; // Monday 0 … Sunday 6
  if (weekday === 6) return { weekStart: weekStartAt(ms, timeZone), lastDay: false };
  if (weekday <= LAST_CATCH_UP_WEEKDAY) return { weekStart: addDays(weekStartAt(ms, timeZone), -7), lastDay: weekday === LAST_CATCH_UP_WEEKDAY };
  return null;
}

/**
 * Pure: the Monday of the week whose email is due at `now` in `timeZone`, or null when none is
 * (Wednesday to Saturday).
 */
export function weeklyEmailWeek(now: Date, timeZone: string = DEFAULT_REPORT_TZ): string | null {
  return weeklyEmailDue(now, timeZone)?.weekStart ?? null;
}

/** An account holding a plan, and the checkout's payer address when there is one. */
export type PlanHolder = { userId: string; payerEmail: string | null };

/**
 * Pure: the order a run works through the holders. The family whose last weekly email is oldest
 * first (`lastSent`: account -> that email's week; none at all goes first of everything), then by
 * account id, so the order is the same on every run of a week.
 */
export function fairOrder(holders: readonly PlanHolder[], lastSent: ReadonlyMap<string, string>): PlanHolder[] {
  const last = (h: PlanHolder) => lastSent.get(h.userId) ?? "";
  return [...holders].sort((a, b) => {
    const x = last(a);
    const y = last(b);
    if (x !== y) return x < y ? -1 : 1;
    return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
  });
}

/** What the sender reads besides EmailDeps: tests replace it. */
export type WeeklyReportDeps = {
  enabled: () => boolean;
  /** Accounts with a trialing or active plan, one row each. */
  planHolders: () => Promise<PlanHolder[] | { error: string }>;
  /** Accounts this week's email is already logged for. */
  sentTo: (weekStart: string) => Promise<Set<string> | { error: string }>;
  /** Each account's latest weekly email before `weekStart` (account -> that week's Monday), LAST_SENT_LOOKBACK_WEEKS back. */
  lastSent: (weekStart: string) => Promise<Map<string, string> | { error: string }>;
  /** Of `userIds`, those with profiles.weekly_report_opt_out. */
  optedOut: (userIds: readonly string[]) => Promise<Set<string> | { error: string }>;
  /** The holder's family week (their kids, and their own when active); `kid` when the holder is a kid profile. */
  familyWeek: (userId: string, weekStart: string, timeZone: string, now: number) => Promise<{ report: WeeklyReport; kid: boolean } | { error: string }>;
};

const errorOf = (err: unknown) => ({ error: err instanceof Error ? err.message : String(err) });

export const weeklyReportDeps: WeeklyReportDeps = {
  enabled: weeklyReportEmailsOn,
  async planHolders() {
    const svc = serviceClient();
    if (!svc) return { error: "SUPABASE_SERVICE_ROLE_KEY is not set" };
    const { data, error } = await svc
      .from("unlimited_subscriptions")
      .select("user_id, payer_email, updated_at")
      .in("status", [...PLAN_STATUSES])
      .not("user_id", "is", null)
      .order("updated_at", { ascending: false })
      .limit(PLAN_QUERY_LIMIT);
    if (error) return { error: error.message };
    const seen = new Map<string, PlanHolder>();
    for (const row of (data ?? []) as Array<{ user_id: string; payer_email: string | null }>) {
      if (!seen.has(row.user_id)) seen.set(row.user_id, { userId: row.user_id, payerEmail: row.payer_email ?? null });
    }
    return [...seen.values()];
  },
  async sentTo(weekStart) {
    const svc = serviceClient();
    if (!svc) return { error: "SUPABASE_SERVICE_ROLE_KEY is not set" };
    const { data, error } = await svc.from("email_log").select("user_id").eq("kind", WEEKLY_REPORT_KIND).eq("ref", weekStart).limit(10_000);
    if (error) return { error: error.message };
    return new Set(((data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id));
  },
  async lastSent(weekStart) {
    const svc = serviceClient();
    if (!svc) return { error: "SUPABASE_SERVICE_ROLE_KEY is not set" };
    // ref is the week's Monday (YYYY-MM-DD), so text order is date order; newest first, so a cut-off
    // read loses only the older rows (and an account seen only there counts as never sent: first)
    const { data, error } = await svc
      .from("email_log")
      .select("user_id, ref")
      .eq("kind", WEEKLY_REPORT_KIND)
      .gte("ref", addDays(weekStart, -7 * LAST_SENT_LOOKBACK_WEEKS))
      .lt("ref", weekStart)
      .order("ref", { ascending: false })
      .limit(10_000);
    if (error) return { error: error.message };
    const latest = new Map<string, string>();
    for (const row of (data ?? []) as Array<{ user_id: string; ref: string }>) {
      if (!latest.has(row.user_id)) latest.set(row.user_id, row.ref);
    }
    return latest;
  },
  async optedOut(userIds) {
    const svc = serviceClient();
    if (!svc) return { error: "SUPABASE_SERVICE_ROLE_KEY is not set" };
    if (userIds.length === 0) return new Set();
    const { data, error } = await svc.from("profiles").select("user_id").in("user_id", [...userIds]).eq("weekly_report_opt_out", true);
    if (error) return { error: error.message };
    return new Set(((data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id));
  },
  async familyWeek(userId, weekStart, timeZone, now) {
    try {
      const store = createReportStore();
      if (!store) return { error: "SUPABASE_SERVICE_ROLE_KEY is not set" };
      const scope = reportScope(await store.links(userId), { id: userId, email: null });
      if (scope.role === "kid") return { report: { weekStart, timeZone, ownerId: userId, children: [], generatedAt: new Date(now).toISOString() }, kid: true };
      const report = await readFamilyWeek(store, { ownerId: userId, callerId: userId, members: scope.members, weekStart, timeZone, now });
      return { report, kid: false };
    } catch (err) {
      return errorOf(err);
    }
  },
};

export type WeeklyReportSummary =
  | { enabled: false }
  | {
      enabled: true;
      dryRun: boolean;
      /** the week due now, or null on a day with nothing due */
      weekStart: string | null;
      /** plan holders read */
      found: number;
      sent: number;
      alreadySent: number;
      failed: number;
      /** due but left for the next run (the run's time was up, or over `maxSends`) */
      deferred: number;
      skipped: { optedOut: number; quiet: number; kid: number; noEmail: number };
      /** dry run only: the accounts that would get it now, in the order a run would send */
      wouldSend?: string[];
    };

export type WeeklyReportOptions = {
  dryRun: boolean;
  /**
   * When to stop starting a family (epoch ms, on `deps.now()`): the cron passes its start plus
   * WEEKLY_RUN_BUDGET_MS. Unset: no limit. Dry runs keep to it too (each family is still a read).
   */
  deadline?: number;
  /** At most this many sends (a manual run's choice); unset: no limit but the deadline. */
  maxSends?: number;
  timeZone?: string;
};

/**
 * One cron run's weekly emails: every due family, oldest last email first, until `deadline`. Never
 * throws for one family's failure (counted, logged, retried on the next run while the week is due);
 * throws only when the plan holders or the log cannot be read, or nothing can sign the link.
 */
export async function runWeeklyReports(
  deps: EmailDeps,
  env: EmailEnv,
  opts: WeeklyReportOptions,
  log: pino.Logger,
  report: WeeklyReportDeps = weeklyReportDeps,
): Promise<WeeklyReportSummary> {
  if (!report.enabled()) return { enabled: false };
  const now = deps.now();
  const timeZone = opts.timeZone ?? DEFAULT_REPORT_TZ;
  const due = weeklyEmailDue(now, timeZone);
  const weekStart = due?.weekStart ?? null;
  const summary: Extract<WeeklyReportSummary, { enabled: true }> = {
    enabled: true,
    dryRun: opts.dryRun,
    weekStart,
    found: 0,
    sent: 0,
    alreadySent: 0,
    failed: 0,
    deferred: 0,
    skipped: { optedOut: 0, quiet: 0, kid: 0, noEmail: 0 },
  };
  if (opts.dryRun) summary.wouldSend = [];
  if (!due || !weekStart) return summary;
  const linkSecret = env.reportLinkSecret;
  if (!linkSecret) throw new Error("REPORT_LINK_SECRET and CRON_SECRET are not set: the unsubscribe link cannot be signed");

  const holders = await report.planHolders();
  if ("error" in holders) throw new Error(`could not read the plans: ${holders.error}`);
  summary.found = holders.length;
  if (holders.length === 0) return summary;
  const sent = await report.sentTo(weekStart);
  if ("error" in sent) throw new Error(`could not read the email log: ${sent.error}`);
  const lastSent = await report.lastSent(weekStart);
  if ("error" in lastSent) throw new Error(`could not read the email log: ${lastSent.error}`);
  const optedOut = await report.optedOut(holders.map((h) => h.userId));
  if ("error" in optedOut) throw new Error(`could not read the email settings: ${optedOut.error}`);

  const store = deps.logStore();
  const maxSends = opts.maxSends ?? Infinity;
  let attempts = 0;
  let outOfTime = false;
  for (const holder of fairOrder(holders, lastSent)) {
    const where = { kind: WEEKLY_REPORT_KIND, weekStart, userId: holder.userId };
    if (sent.has(holder.userId)) {
      summary.alreadySent++;
      continue;
    }
    if (optedOut.has(holder.userId)) {
      summary.skipped.optedOut++;
      continue;
    }
    if (!outOfTime && opts.deadline !== undefined && deps.now().getTime() >= opts.deadline) outOfTime = true;
    if (outOfTime || (!opts.dryRun && attempts >= maxSends)) {
      summary.deferred++;
      continue;
    }
    const week = await report.familyWeek(holder.userId, weekStart, timeZone, now.getTime());
    if ("error" in week) {
      summary.failed++;
      log.error({ ...where, error: week.error }, "weekly report: could not read the family's week");
      continue;
    }
    if (week.kid) {
      summary.skipped.kid++;
      continue;
    }
    if (emailChildren(week.report).length === 0) {
      summary.skipped.quiet++;
      continue;
    }
    if (opts.dryRun) {
      summary.wouldSend!.push(holder.userId);
      continue;
    }

    const who = await billingRecipient(holder, deps.emailOf);
    if ("error" in who) {
      summary.failed++;
      log.error({ ...where, error: who.error }, "weekly report: could not look up the account's email");
      continue;
    }
    if (!who.email || isKidEmail(who.email)) {
      summary.skipped.noEmail++;
      continue;
    }

    const stop = unsubscribeUrl(env.siteUrl, holder.userId, linkSecret);
    const rendered = weeklyReportEmail({ report: week.report, siteUrl: env.siteUrl, unsubscribeUrl: stop });
    if (attempts > 0) await deps.sleep(SEND_SPACING_MS);
    attempts++;
    const key: EmailLogKey = { userId: holder.userId, kind: WEEKLY_REPORT_KIND, ref: weekStart };
    const outcome = await sendOnce({
      store,
      key,
      message: {
        to: who.email,
        ...rendered,
        idempotencyKey: `weekly-report/${holder.userId}/${weekStart}`,
        tags: { kind: WEEKLY_REPORT_KIND },
        // RFC 8058 one-click: the mail app's own "Unsubscribe" POSTs to the same signed link
        headers: unsubscribeHeaders(stop),
      },
      send: (message) => sendWithOneRetry(deps, env, message),
      log,
    });
    if (outcome.status === "sent") {
      summary.sent++;
      log.info({ ...where, to: who.source, resendId: outcome.id }, "weekly report sent");
    } else if (outcome.status === "already_sent") {
      summary.alreadySent++;
    } else {
      summary.failed++;
      log.error({ ...where, status: outcome.status, error: outcome.error }, "weekly report not sent; the next run retries while the week is due");
    }
  }
  if (summary.deferred > 0) {
    const counts = { weekStart, deferred: summary.deferred, sent: summary.sent, dryRun: opts.dryRun };
    if (due.lastDay) log.warn(counts, "weekly report: families left without this week's email (the run ran out of time on the week's last day)");
    else log.info(counts, "weekly report: families left for the next run (this one ran out of time)");
  }
  return summary;
}

/** The headers that give the email a one-click unsubscribe in the mail app (RFC 2369 and RFC 8058). */
export function unsubscribeHeaders(url: string): Record<string, string> {
  return { "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
}
