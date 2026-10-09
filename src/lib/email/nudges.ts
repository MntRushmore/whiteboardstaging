/**
 * The free trial's nudges (2026-10-09, "kids come back"): two emails to the grown-up who started an
 * Agathon Unlimited trial, each at most once per trial, from the daily cron
 * (GET /api/cron/trial-reminders; Vercel Hobby allows few crons, so this rides on that one).
 *
 *   first_practice   about a day in, when nobody in the family has practiced since the welcome:
 *                    "<Name>'s first practice is ready: 5 problems, about 10 minutes".
 *   trial_progress   around day 4, when the family has done something: what each child did
 *                    (problems solved, skills, Today's practice), before the card is charged.
 *
 * Why. Trials end Oct 9 to 15 with $0 MRR so far, and only 5 of 14 trial users came back a second
 * day. A family that never started needs a reason to open the app; a family that did needs to see
 * what they are paying for before the charge, not after.
 *
 * When. The trial's start is when its subscription row was made (the checkout). A daily run sends
 * `first_practice` to trials 20 to 72 hours old and `trial_progress` to trials 72 to 120 hours old:
 * each trial is in a window on one or two runs, so a failed send is retried the next day. A
 * progress email is not sent to a trial ending within 72 hours: the "your trial ends" reminder
 * (trialReminders.ts) goes out then, with the same summary, and one email a day is enough.
 *
 * Who. The payer, else the account's address (`billingRecipient`; never a kid profile's). Nothing
 * goes to a trial set to cancel (`cancel_at_period_end`, or any `cancel_at`) or no longer trialing.
 * email_log (kind 'first_practice' / 'trial_progress', ref = the Stripe subscription id) keeps each
 * to once per trial.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type pino from "pino";
import { UNLIMITED_PLAN } from "@/lib/billing/unlimited";
import { DAILY_GOAL } from "@/lib/daily/contracts";
import { familyProgress, learnerNames, practicedSinceOnboarding, type FamilyActivity } from "@/lib/email/activity";
import { sendOnce, type EmailLogKey } from "@/lib/email/log";
import { billingRecipient } from "@/lib/email/payer";
import type { EmailDeps, EmailEnv } from "@/lib/email/server";
import { firstPracticeEmail, trialProgressEmail, type RenderedEmail } from "@/lib/email/templates";
import { SEND_SPACING_MS, SUBSCRIPTIONS, sendWithOneRetry, toTrialRow, type TrialRow } from "@/lib/email/trialReminders";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const NUDGE_KINDS = ["first_practice", "trial_progress"] as const;
export type NudgeKind = (typeof NUDGE_KINDS)[number];

/** How old a trial is when each nudge is due: [fromMs, toMs) after the trial started. */
export const NUDGE_WINDOWS: Record<NudgeKind, { fromMs: number; toMs: number }> = {
  first_practice: { fromMs: 20 * HOUR_MS, toMs: 72 * HOUR_MS },
  trial_progress: { fromMs: 72 * HOUR_MS, toMs: 120 * HOUR_MS },
};

/** No progress email to a trial ending sooner than this: the trial reminder (with the same summary) is due. */
export const PROGRESS_MIN_LEFT_MS = 72 * HOUR_MS;

/** Trials started at most this long ago are read (the last window ends at 5 days). */
export const NUDGE_LOOKBACK_MS = 6 * DAY_MS;

/** "Nothing since the welcome" looks this far back before the trial started. */
export const FIRST_PRACTICE_LOOKBACK_MS = 30 * DAY_MS;

/** At most this many nudges per run (after the reminders, inside the cron's 60 s); the rest wait a day. */
export const NUDGE_MAX_SENDS_PER_RUN = 25;

/** Rows read per run. */
export const NUDGE_QUERY_LIMIT = 500;

/** A Today's practice set takes about this long per problem. */
const MINUTES_PER_PROBLEM = 2;

/** A trialing subscription and when it started (its row's created_at). */
export type NudgeTrialRow = TrialRow & { createdAt: string | null };

export type NudgeSkip = "no_user" | "not_trialing" | "cancelling" | "no_start" | "outside_window" | "ending_soon";

/** Pure: the nudge due for this trial at `now`, or why none is. */
export function nudgeDue(row: NudgeTrialRow, now: Date): { kind: NudgeKind } | { skip: NudgeSkip } {
  if (!row.userId) return { skip: "no_user" };
  if (row.status !== SUBSCRIPTIONS.trialingStatus) return { skip: "not_trialing" };
  if (row.cancelAtPeriodEnd || row.cancelAt) return { skip: "cancelling" };
  const started = row.createdAt ? Date.parse(row.createdAt) : NaN;
  if (!Number.isFinite(started)) return { skip: "no_start" };
  const age = now.getTime() - started;
  const inside = (k: NudgeKind) => age >= NUDGE_WINDOWS[k].fromMs && age < NUDGE_WINDOWS[k].toMs;
  if (inside("first_practice")) return { kind: "first_practice" };
  if (inside("trial_progress")) {
    const end = row.trialEnd ? Date.parse(row.trialEnd) : NaN;
    if (Number.isFinite(end) && end - now.getTime() < PROGRESS_MIN_LEFT_MS) return { skip: "ending_soon" };
    return { kind: "trial_progress" };
  }
  return { skip: "outside_window" };
}

export function nudgeLogKey(kind: NudgeKind, row: NudgeTrialRow & { userId: string }): EmailLogKey {
  return { userId: row.userId, kind, ref: row.subscriptionId };
}

/** Resend's Idempotency-Key: the nudge and the subscription. */
export function nudgeIdempotencyKey(kind: NudgeKind, row: TrialRow): string {
  return `${kind.replace(/_/g, "-")}/${row.subscriptionId}`.slice(0, 256);
}

/**
 * Trialing subscriptions with a user, started at or after `since`, oldest first, through the service
 * role. The only query this module makes against the subscriptions table.
 */
export async function trialsStartedSince(admin: Pick<SupabaseClient, "from">, since: Date): Promise<NudgeTrialRow[] | { error: string }> {
  const c = SUBSCRIPTIONS.columns;
  const { data, error } = await admin
    .from(SUBSCRIPTIONS.table)
    .select([...Object.values(c), "created_at"].join(","))
    .eq(c.status, SUBSCRIPTIONS.trialingStatus)
    .not(c.userId, "is", null)
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: true })
    .limit(NUDGE_QUERY_LIMIT);
  if (error) return { error: error.message };
  const rows = Array.isArray(data) ? (data as unknown as Record<string, unknown>[]) : [];
  const out: NudgeTrialRow[] = [];
  for (const raw of rows) {
    const row = toTrialRow(raw);
    if (row) out.push({ ...row, createdAt: typeof raw.created_at === "string" ? raw.created_at : null });
  }
  return out;
}

export type NudgeSummary = {
  dryRun: boolean;
  /** trials the query returned */
  found: number;
  /** in a window, not cancelling */
  due: { firstPractice: number; trialProgress: number };
  sent: number;
  alreadySent: number;
  failed: number;
  /** due but left for the next run (over the per-run cap) */
  deferred: number;
  skipped: {
    cancelling: number;
    /** first_practice: someone already practiced */
    practicing: number;
    /** trial_progress: nothing done yet to tell */
    quiet: number;
    /** trial_progress: the trial ends within 72 h; the reminder carries the summary */
    endingSoon: number;
    noEmail: number;
  };
  /** dry run only: "<kind>:<subscription>" that would be sent now */
  wouldSend?: string[];
};

export type NudgeOptions = { dryRun: boolean; maxSends?: number };

/** The email for one due nudge, or why there is none (the family's activity decides). */
export function renderNudge(
  kind: NudgeKind,
  row: NudgeTrialRow,
  activity: FamilyActivity,
  env: EmailEnv,
  now: Date,
): { email: RenderedEmail } | { skip: "practicing" | "quiet" } {
  if (kind === "first_practice") {
    if (practicedSinceOnboarding(activity)) return { skip: "practicing" };
    return {
      email: firstPracticeEmail({
        names: learnerNames(activity),
        problems: DAILY_GOAL,
        minutes: DAILY_GOAL * MINUTES_PER_PROBLEM,
        siteUrl: env.siteUrl,
        manageUrl: env.manageUrl,
        planName: UNLIMITED_PLAN.name,
      }),
    };
  }
  // since the trial started (nudgeDue only lets through a row that says when)
  const progress = familyProgress(activity, new Date(row.createdAt ?? now.toISOString()), now);
  if (progress.length === 0 || !row.trialEnd) return { skip: "quiet" };
  return {
    email: trialProgressEmail({ progress, trialEnd: new Date(row.trialEnd), siteUrl: env.siteUrl, manageUrl: env.manageUrl, planName: UNLIMITED_PLAN.name }),
  };
}

/**
 * One cron run: find the trials in a nudge's window, read each family's activity, and send each
 * due nudge once. Never throws for one trial's failure (counted, logged, retried next run while in
 * the window); throws only when the subscriptions or the email log cannot be read at all.
 */
export async function runTrialNudges(deps: EmailDeps, env: EmailEnv, opts: NudgeOptions, log: pino.Logger): Promise<NudgeSummary> {
  const now = deps.now();
  const summary: NudgeSummary = {
    dryRun: opts.dryRun,
    found: 0,
    due: { firstPractice: 0, trialProgress: 0 },
    sent: 0,
    alreadySent: 0,
    failed: 0,
    deferred: 0,
    skipped: { cancelling: 0, practicing: 0, quiet: 0, endingSoon: 0, noEmail: 0 },
  };
  if (opts.dryRun) summary.wouldSend = [];

  const found = await deps.findNudgeTrials(new Date(now.getTime() - NUDGE_LOOKBACK_MS));
  if ("error" in found) throw new Error(`could not read subscriptions: ${found.error}`);
  summary.found = found.length;

  const due: Array<{ kind: NudgeKind; row: NudgeTrialRow & { userId: string } }> = [];
  for (const row of found) {
    const d = nudgeDue(row, now);
    if ("kind" in d) {
      due.push({ kind: d.kind, row: row as NudgeTrialRow & { userId: string } });
      if (d.kind === "first_practice") summary.due.firstPractice++;
      else summary.due.trialProgress++;
    } else if (d.skip === "cancelling") summary.skipped.cancelling++;
    else if (d.skip === "ending_soon") summary.skipped.endingSoon++;
  }
  if (due.length === 0) return summary;

  // What is already in the log (one query per kind); the claim in sendOnce is still the real guard.
  const store = deps.logStore();
  const logged = new Map<NudgeKind, Set<string>>();
  for (const kind of NUDGE_KINDS) {
    const refs = due.filter((d) => d.kind === kind).map((d) => d.row.subscriptionId);
    if (!refs.length) continue;
    const got = await store.loggedRefs(kind, refs);
    if ("error" in got) throw new Error(`could not read the email log: ${got.error}`);
    logged.set(kind, got);
  }

  const maxSends = opts.maxSends ?? NUDGE_MAX_SENDS_PER_RUN;
  let attempts = 0;
  for (const { kind, row } of due) {
    const where = { kind, subscription: row.subscriptionId, userId: row.userId };
    if (logged.get(kind)?.has(row.subscriptionId)) {
      summary.alreadySent++;
      continue;
    }
    const started = Date.parse(row.createdAt ?? "");
    const activity = await deps.readFamilyActivity(row.userId, new Date(started - FIRST_PRACTICE_LOOKBACK_MS));
    if ("error" in activity) {
      summary.failed++;
      log.error({ ...where, error: activity.error }, "trial nudge: could not read the family's activity");
      continue;
    }
    const rendered = renderNudge(kind, row, activity, env, now);
    if ("skip" in rendered) {
      summary.skipped[rendered.skip]++;
      continue;
    }
    if (opts.dryRun) {
      summary.wouldSend!.push(`${kind}:${row.subscriptionId}`);
      continue;
    }
    if (attempts >= maxSends) {
      summary.deferred++;
      continue;
    }

    const who = await billingRecipient(row, deps.emailOf);
    if ("error" in who) {
      summary.failed++;
      log.error({ ...where, error: who.error }, "trial nudge: could not look up the account's email");
      continue;
    }
    if (!who.email) {
      summary.skipped.noEmail++;
      log.warn(where, "trial nudge: neither the payer nor the account has an email address");
      continue;
    }

    if (attempts > 0) await deps.sleep(SEND_SPACING_MS);
    attempts++;
    const outcome = await sendOnce({
      store,
      key: nudgeLogKey(kind, row),
      message: { to: who.email, ...rendered.email, idempotencyKey: nudgeIdempotencyKey(kind, row), tags: { kind } },
      send: (message) => sendWithOneRetry(deps, env, message),
      log,
    });
    if (outcome.status === "sent") {
      summary.sent++;
      log.info({ ...where, to: who.source, resendId: outcome.id }, "trial nudge sent");
    } else if (outcome.status === "already_sent") {
      summary.alreadySent++;
    } else {
      summary.failed++;
      log.error({ ...where, status: outcome.status, error: outcome.error }, "trial nudge not sent; the next run retries while the trial is in the window");
    }
  }
  return summary;
}
