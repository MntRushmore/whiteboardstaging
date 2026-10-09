/**
 * Sends the Sunday email (src/lib/email/weeklyReport.ts) from the daily cron
 * (GET /api/cron/trial-reminders, which also runs the trial's reminders and nudges: Vercel Hobby
 * allows few crons). OFF unless WEEKLY_REPORT_EMAILS=on: the owner declined a parent email on
 * 2026-10-04, so it ships built and waiting; without the flag a run reads nothing and sends nothing.
 *
 * When. On Sunday in the family's zone the email tells the week ending that day; on Monday before
 * noon, the week that just ended (a run that missed Sunday catches up). The cron runs at 15:00 UTC,
 * late Sunday morning on the US east coast. The server has no stored zone for an account, so this
 * is DEFAULT_REPORT_TZ (America/New_York), the zone every Agathon email already uses.
 *
 * Who. Each account holding a plan (an Agathon Unlimited subscription trialing or active: the
 * grown-up, whose kids share it), never a kid profile, never an account with
 * profiles.weekly_report_opt_out, and only when someone in the family did something that week. To
 * the payer's address, else the account's (`billingRecipient`: never a kid address, and the send
 * layer refuses one anyway). Each email carries a signed one-tap unsubscribe link
 * (src/lib/report/unsubscribe.ts, under CRON_SECRET).
 *
 * Once per week per account: email_log (kind 'weekly_report', ref = the week's Monday), claimed
 * before the send (`sendOnce`). At most WEEKLY_MAX_SENDS_PER_RUN a run; the rest wait for Monday's.
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

/** Sends per run at most (after the reminders and the nudges, inside the cron's 60 s). */
export const WEEKLY_MAX_SENDS_PER_RUN = 25;

/** Subscriptions that count as holding a plan. */
export const PLAN_STATUSES = ["trialing", "active"] as const;

/** Plan rows read per run. */
export const PLAN_QUERY_LIMIT = 1000;

/** On Monday the catch-up for last week runs until this local hour. */
export const MONDAY_CUTOFF_HOUR = 12;

/**
 * Pure: the Monday of the week whose email is due at `now` in `timeZone`, or null when none is
 * (Tuesday to Saturday, and Monday afternoon).
 */
export function weeklyEmailWeek(now: Date, timeZone: string = DEFAULT_REPORT_TZ): string | null {
  const ms = now.getTime();
  const today = localDayIn(ms, timeZone);
  const weekday = (new Date(Date.parse(`${today}T00:00:00Z`)).getUTCDay() + 6) % 7; // Monday 0 … Sunday 6
  if (weekday === 6) return weekStartAt(ms, timeZone);
  if (weekday === 0) {
    const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).format(now));
    if (hour < MONDAY_CUTOFF_HOUR) return addDays(today, -7);
  }
  return null;
}

/** An account holding a plan, and the checkout's payer address when there is one. */
export type PlanHolder = { userId: string; payerEmail: string | null };

/** What the sender reads besides EmailDeps: tests replace it. */
export type WeeklyReportDeps = {
  enabled: () => boolean;
  /** Accounts with a trialing or active plan, one row each. */
  planHolders: () => Promise<PlanHolder[] | { error: string }>;
  /** Accounts this week's email is already logged for. */
  sentTo: (weekStart: string) => Promise<Set<string> | { error: string }>;
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
      /** due but left for the next run (over the per-run cap) */
      deferred: number;
      skipped: { optedOut: number; quiet: number; kid: number; noEmail: number };
      /** dry run only: the accounts that would get it now */
      wouldSend?: string[];
    };

export type WeeklyReportOptions = { dryRun: boolean; maxSends?: number; timeZone?: string };

/**
 * One cron run's weekly emails. Never throws for one family's failure (counted, logged, retried on
 * the next run while the week is due); throws only when the plan holders or the log cannot be read.
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
  const weekStart = weeklyEmailWeek(now, timeZone);
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
  if (!weekStart) return summary;
  if (!env.cronSecret) throw new Error("CRON_SECRET is not set: the unsubscribe link cannot be signed");

  const holders = await report.planHolders();
  if ("error" in holders) throw new Error(`could not read the plans: ${holders.error}`);
  summary.found = holders.length;
  if (holders.length === 0) return summary;
  const sent = await report.sentTo(weekStart);
  if ("error" in sent) throw new Error(`could not read the email log: ${sent.error}`);
  const optedOut = await report.optedOut(holders.map((h) => h.userId));
  if ("error" in optedOut) throw new Error(`could not read the email settings: ${optedOut.error}`);

  const store = deps.logStore();
  const maxSends = opts.maxSends ?? WEEKLY_MAX_SENDS_PER_RUN;
  let attempts = 0;
  for (const holder of holders) {
    const where = { kind: WEEKLY_REPORT_KIND, weekStart, userId: holder.userId };
    if (sent.has(holder.userId)) {
      summary.alreadySent++;
      continue;
    }
    if (optedOut.has(holder.userId)) {
      summary.skipped.optedOut++;
      continue;
    }
    if (!opts.dryRun && attempts >= maxSends) {
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

    const rendered = weeklyReportEmail({ report: week.report, siteUrl: env.siteUrl, unsubscribeUrl: unsubscribeUrl(env.siteUrl, holder.userId, env.cronSecret) });
    if (attempts > 0) await deps.sleep(SEND_SPACING_MS);
    attempts++;
    const key: EmailLogKey = { userId: holder.userId, kind: WEEKLY_REPORT_KIND, ref: weekStart };
    const outcome = await sendOnce({
      store,
      key,
      message: { to: who.email, ...rendered, idempotencyKey: `weekly-report/${holder.userId}/${weekStart}`, tags: { kind: WEEKLY_REPORT_KIND } },
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
  return summary;
}
