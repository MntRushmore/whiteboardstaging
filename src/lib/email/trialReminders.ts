/**
 * "Your free week ends on <date>": one email per Agathon Unlimited subscription, about two days
 * before its trial ends and the card is first charged (GET /api/cron/trial-reminders, daily).
 * This is the email that stops a surprise charge, and so a chargeback.
 *
 * The window. A daily run looks for trials ending between now + 24 h and now + 72 h. A trial
 * enters that 48-hour window on exactly one run (the one before saw it more than 72 h out), so the
 * reminder goes out 2 to 3 days ahead; if that send fails, the next day's run is still inside the
 * window (24 to 48 h ahead) and tries again. Vercel's Hobby crons fire anywhere in their hour,
 * which moves this by under an hour. Inside the window, email_log (kind 'trial_reminder',
 * ref = the Stripe subscription id) keeps it to once per subscription.
 *
 * Who is NOT reminded, because no charge is coming or nobody can be told:
 *  - a subscription set to cancel at the end of the trial (`cancel_at_period_end`), or with a
 *    `cancel_at` at or before the trial end: it will not charge;
 *  - a row with no user (a Payment Link opened outside the app, or a deleted account);
 *  - an account with no email address.
 *
 * The subscriptions table belongs to the Unlimited plan (migration
 * 20261003020000_unlimited.sql, branch feat/unlimited-plan). Everything this module assumes about
 * it is in SUBSCRIPTIONS below and in `trialsEndingBetween`, the only function that queries it.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type pino from "pino";
import { UNLIMITED_PLAN } from "@/lib/billing/unlimited";
import { sendOnce, type EmailLogKey } from "@/lib/email/log";
import { isSendableAddress, type SendEmailInput, type SendEmailResult } from "@/lib/email/resend";
import type { EmailDeps, EmailEnv } from "@/lib/email/server";
import { trialReminderEmail } from "@/lib/email/templates";

const HOUR_MS = 60 * 60 * 1000;

/** Trials ending in [now + fromMs, now + toMs) are reminded. */
export const TRIAL_REMINDER_WINDOW = { fromMs: 24 * HOUR_MS, toMs: 72 * HOUR_MS } as const;

/** At most this many sends per run (60 s function budget at SEND_SPACING_MS); the rest wait a day, still in the window. */
export const MAX_SENDS_PER_RUN = 50;

/** Pause between sends: Resend's default limit is 2 requests a second per team. */
export const SEND_SPACING_MS = 600;

/** A 429 from Resend is retried once after its Retry-After, if that is at most this long. */
export const MAX_RETRY_WAIT_MS = 5_000;

/** Rows read per run; far more trials than can end in two days at launch. */
export const TRIAL_QUERY_LIMIT = 500;

/**
 * What the reminder reads from the subscriptions table. Written against the Unlimited migration as
 * it stood on feat/unlimited-plan (20261003020000_unlimited.sql, uncommitted when this was
 * written): one row per Stripe subscription, `status` as Stripe names it, timestamps as
 * timestamptz, `user_id` null until the checkout links it. If that migration names anything
 * differently, change it here and nowhere else.
 */
export const SUBSCRIPTIONS = {
  table: "unlimited_subscriptions",
  columns: {
    subscriptionId: "stripe_subscription_id", // text, unique: the email_log ref
    userId: "user_id", // uuid, nullable
    status: "status", // text: 'trialing' while in the free week
    trialEnd: "trial_end", // timestamptz: when the free week ends and the first charge is made
    cancelAtPeriodEnd: "cancel_at_period_end", // boolean
    cancelAt: "cancel_at", // timestamptz, nullable
  },
  trialingStatus: "trialing",
} as const;

export type TrialRow = {
  subscriptionId: string;
  userId: string | null;
  status: string | null;
  trialEnd: string | null;
  cancelAtPeriodEnd: boolean;
  cancelAt: string | null;
};

export type ReminderWindow = { from: Date; to: Date };

/** Pure: the window a run at `now` reminds. */
export function reminderWindow(now: Date): ReminderWindow {
  return { from: new Date(now.getTime() + TRIAL_REMINDER_WINDOW.fromMs), to: new Date(now.getTime() + TRIAL_REMINDER_WINDOW.toMs) };
}

export type SkipReason = "no_user" | "not_trialing" | "outside_window" | "cancelling";

/**
 * Pure: why this row gets no reminder, or null when it should get one. The query already filters
 * most of this; checking again here keeps the rule in one testable place.
 */
export function reminderSkipReason(row: TrialRow, window: ReminderWindow): SkipReason | null {
  if (!row.userId) return "no_user";
  if (row.status !== SUBSCRIPTIONS.trialingStatus) return "not_trialing";
  const end = row.trialEnd ? Date.parse(row.trialEnd) : NaN;
  if (Number.isNaN(end) || end < window.from.getTime() || end >= window.to.getTime()) return "outside_window";
  if (row.cancelAtPeriodEnd) return "cancelling";
  if (row.cancelAt) {
    const cancelAt = Date.parse(row.cancelAt);
    if (!Number.isNaN(cancelAt) && cancelAt <= end) return "cancelling";
  }
  return null;
}

export function trialReminderLogKey(row: TrialRow & { userId: string }): EmailLogKey {
  return { userId: row.userId, kind: "trial_reminder", ref: row.subscriptionId };
}

/** Resend's Idempotency-Key: the subscription and the trial end it is about. */
export function trialReminderIdempotencyKey(row: TrialRow): string {
  const end = row.trialEnd ? Math.floor(Date.parse(row.trialEnd) / 1000) : 0;
  return `trial-reminder/${row.subscriptionId}/${end}`.slice(0, 256);
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

/** One row of the query, by the column names in SUBSCRIPTIONS; null when it has no subscription id. */
export function toTrialRow(raw: Record<string, unknown>): TrialRow | null {
  const c = SUBSCRIPTIONS.columns;
  const subscriptionId = asString(raw[c.subscriptionId]);
  if (!subscriptionId) return null;
  return {
    subscriptionId,
    userId: asString(raw[c.userId]),
    status: asString(raw[c.status]),
    trialEnd: asString(raw[c.trialEnd]),
    cancelAtPeriodEnd: raw[c.cancelAtPeriodEnd] === true,
    cancelAt: asString(raw[c.cancelAt]),
  };
}

/**
 * Trialing subscriptions with a user whose free week ends in [from, to), soonest first. The only
 * query against the subscriptions table (service role: the table has no policy for anyone else's
 * rows).
 */
export async function trialsEndingBetween(admin: Pick<SupabaseClient, "from">, from: Date, to: Date): Promise<TrialRow[] | { error: string }> {
  const c = SUBSCRIPTIONS.columns;
  const { data, error } = await admin
    .from(SUBSCRIPTIONS.table)
    .select(Object.values(c).join(","))
    .eq(c.status, SUBSCRIPTIONS.trialingStatus)
    .not(c.userId, "is", null)
    .gte(c.trialEnd, from.toISOString())
    .lt(c.trialEnd, to.toISOString())
    .order(c.trialEnd, { ascending: true })
    .limit(TRIAL_QUERY_LIMIT);
  if (error) return { error: error.message };
  const rows = Array.isArray(data) ? (data as unknown as Record<string, unknown>[]) : [];
  return rows.map(toTrialRow).filter((r): r is TrialRow => r !== null);
}

export type TrialReminderSummary = {
  dryRun: boolean;
  window: { from: string; to: string };
  /** rows the query returned */
  found: number;
  /** rows that should have a reminder (not cancelling, with a user) */
  due: number;
  alreadySent: number;
  sent: number;
  failed: number;
  skipped: { noUser: number; cancelling: number; noEmail: number };
  /** due but left for the next run (over MAX_SENDS_PER_RUN) */
  deferred: number;
  /** dry run only: the subscriptions that would be reminded now */
  wouldSend?: string[];
};

export type TrialReminderOptions = { dryRun: boolean; maxSends?: number };

/**
 * One cron run: find, filter, and send each due reminder once. Never throws for a single
 * subscription's failure (it is counted and logged, and retried by the next run); throws only
 * when the subscriptions cannot be read at all, which the route answers with a 500.
 */
export async function runTrialReminders(deps: EmailDeps, env: EmailEnv, opts: TrialReminderOptions, log: pino.Logger): Promise<TrialReminderSummary> {
  const window = reminderWindow(deps.now());
  const summary: TrialReminderSummary = {
    dryRun: opts.dryRun,
    window: { from: window.from.toISOString(), to: window.to.toISOString() },
    found: 0,
    due: 0,
    alreadySent: 0,
    sent: 0,
    failed: 0,
    skipped: { noUser: 0, cancelling: 0, noEmail: 0 },
    deferred: 0,
  };
  if (opts.dryRun) summary.wouldSend = [];

  const found = await deps.findTrials(window.from, window.to);
  if ("error" in found) throw new Error(`could not read subscriptions: ${found.error}`);
  summary.found = found.length;

  const due: Array<TrialRow & { userId: string }> = [];
  for (const row of found) {
    const reason = reminderSkipReason(row, window);
    if (reason === "no_user") summary.skipped.noUser++;
    else if (reason === "cancelling") summary.skipped.cancelling++;
    else if (reason === null) due.push(row as TrialRow & { userId: string });
    // not_trialing / outside_window: the query should not return these; nothing to count
  }
  summary.due = due.length;
  if (due.length === 0) return summary;

  // First pass: what is already in the log (one query), so a run does not look up addresses for
  // reminders that went out yesterday. The claim in sendOnce is still the real guard.
  const store = deps.logStore();
  const logged = await store.loggedRefs("trial_reminder", due.map((r) => r.subscriptionId));
  if ("error" in logged) throw new Error(`could not read the email log: ${logged.error}`);

  const maxSends = opts.maxSends ?? MAX_SENDS_PER_RUN;
  let attempts = 0;
  for (const row of due) {
    if (logged.has(row.subscriptionId)) {
      summary.alreadySent++;
      continue;
    }
    if (opts.dryRun) {
      summary.wouldSend!.push(row.subscriptionId);
      continue;
    }
    if (attempts >= maxSends) {
      summary.deferred++;
      continue;
    }

    const who = await deps.emailOf(row.userId);
    if ("error" in who) {
      summary.failed++;
      log.error({ subscription: row.subscriptionId, error: who.error }, "trial reminder: could not look up the account's email");
      continue;
    }
    const email = who.email?.trim() ?? "";
    if (!email || !isSendableAddress(email)) {
      summary.skipped.noEmail++;
      log.warn({ subscription: row.subscriptionId, userId: row.userId }, "trial reminder: the account has no email address");
      continue;
    }

    if (attempts > 0) await deps.sleep(SEND_SPACING_MS);
    else if (!env.manageIsPortal) log.warn("NEXT_PUBLIC_BILLING_PORTAL_URL is not set: the reminder's cancel link opens the account page");
    attempts++;
    const rendered = trialReminderEmail({
      trialEnd: new Date(row.trialEnd!),
      manageUrl: env.manageUrl,
      siteUrl: env.siteUrl,
      planName: UNLIMITED_PLAN.name,
      monthlyUsd: UNLIMITED_PLAN.monthlyUsd,
    });
    const outcome = await sendOnce({
      store,
      key: trialReminderLogKey(row),
      message: { to: email, ...rendered, idempotencyKey: trialReminderIdempotencyKey(row), tags: { kind: "trial_reminder" } },
      send: (message) => sendWithOneRetry(deps, env, message),
      log,
    });
    const where = { subscription: row.subscriptionId, userId: row.userId, trialEnd: row.trialEnd };
    if (outcome.status === "sent") {
      summary.sent++;
      log.info({ ...where, resendId: outcome.id }, "trial reminder sent");
    } else if (outcome.status === "already_sent") {
      summary.alreadySent++;
    } else {
      summary.failed++;
      log.error({ ...where, status: outcome.status, error: outcome.error }, "trial reminder not sent; the next run retries while the trial is 24 h or more away");
    }
  }
  return summary;
}

/** A 429 waits out Resend's Retry-After (when short) and tries once more; anything else is final. */
async function sendWithOneRetry(deps: EmailDeps, env: EmailEnv, message: SendEmailInput): Promise<SendEmailResult> {
  const first = await deps.send(message, env.resend);
  if (first.ok || first.status !== 429) return first;
  const wait = first.retryAfterMs ?? 1_000;
  if (wait > MAX_RETRY_WAIT_MS) return first; // a daily or monthly quota: the next run retries
  await deps.sleep(Math.max(wait, SEND_SPACING_MS));
  return deps.send(message, env.resend);
}
