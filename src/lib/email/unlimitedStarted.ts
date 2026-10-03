/**
 * "Your free week of Agathon Unlimited has started": the acknowledgment auto-renewal laws ask for
 * when a plan that renews by itself begins. Sent once per subscription, to the person who paid
 * (src/lib/email/payer.ts), saying nothing was charged today, when the card will be charged $25 and
 * then every month, how to cancel and that cancelling before then costs nothing, with the plan's
 * terms and the refund policy linked.
 *
 * When. The billing webhook (src/app/api/billing/webhook) calls `sendUnlimitedStarted` once a
 * subscription is both LINKED to an account and TRIALING, whichever of its two events (the checkout,
 * or customer.subscription.*) completes that, and only AFTER it has answered Stripe (next/server's
 * `after`): the email can neither fail the webhook (Stripe would redeliver) nor slow it down. Every
 * redelivery calls it again, and email_log (kind 'unlimited_started', ref = the Stripe subscription
 * id; claim, send, record: src/lib/email/log.ts) keeps it to one email. If Resend is down, the claim
 * is released and the daily cron (GET /api/cron/trial-reminders) sends it on its next run
 * (`runStartedSweep`), while the trial still has more than a day to go.
 *
 * Who gets none: a subscription linked to nobody, not trialing, already set to cancel by the end of
 * the free week (no charge is coming), with its trial end passed or less than an hour away, or
 * where neither the payer nor the account has an address.
 *
 * Never throws: `sendUnlimitedStarted` answers what happened, for the caller's log.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type pino from "pino";
import { UNLIMITED_PLAN } from "@/lib/billing/unlimited";
import { sendOnce, type EmailLogKey } from "@/lib/email/log";
import { billingRecipient } from "@/lib/email/payer";
import type { EmailDeps, EmailEnv } from "@/lib/email/server";
import { unlimitedStartedEmail } from "@/lib/email/templates";
import { SEND_SPACING_MS } from "@/lib/email/trialReminders";

const HOUR_MS = 60 * 60 * 1000;

/** No "has started" email for a free week that ends sooner than this: the reminder has gone already. */
export const STARTED_MIN_LEAD_MS = HOUR_MS;

/** The daily sweep confirms trials ending in [now + 24 h, now + 8 days): started within the week, not ending tomorrow. */
export const STARTED_SWEEP_WINDOW = { fromMs: 24 * HOUR_MS, toMs: 8 * 24 * HOUR_MS } as const;

/** One subscription as the email needs it (unlimited_subscriptions, service role). */
export type StartedRow = {
  subscriptionId: string;
  userId: string | null;
  status: string | null;
  trialEnd: string | null;
  cancelAtPeriodEnd: boolean;
  cancelAt: string | null;
  payerEmail: string | null;
  /** The account had an Unlimited plan before this one: its free week grants nothing (has_unlimited()). */
  repeat: boolean;
};

export type StartedSkip = "no_subscription" | "no_user" | "not_trialing" | "no_trial_end" | "trial_over" | "cancelling";

/** Pure: why this subscription gets no "has started" email now, or null when it should. */
export function startedSkipReason(row: StartedRow | null, now: Date): StartedSkip | null {
  if (!row) return "no_subscription";
  if (!row.userId) return "no_user";
  if (row.status !== "trialing") return "not_trialing";
  const end = row.trialEnd ? Date.parse(row.trialEnd) : NaN;
  if (Number.isNaN(end)) return "no_trial_end";
  if (end - now.getTime() < STARTED_MIN_LEAD_MS) return "trial_over";
  if (row.cancelAtPeriodEnd) return "cancelling";
  if (row.cancelAt) {
    const cancelAt = Date.parse(row.cancelAt);
    if (!Number.isNaN(cancelAt) && cancelAt <= end) return "cancelling";
  }
  return null;
}

export function startedLogKey(row: { subscriptionId: string; userId: string }): EmailLogKey {
  return { userId: row.userId, kind: "unlimited_started", ref: row.subscriptionId };
}

/** Resend's Idempotency-Key: one per subscription. */
export function startedIdempotencyKey(subscriptionId: string): string {
  return `unlimited-started/${subscriptionId}`.slice(0, 256);
}

const SELECT = "id,stripe_subscription_id,user_id,status,trial_end,cancel_at_period_end,cancel_at,payer_email";

function asString(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

/**
 * The subscription and whether its account had a plan before it (the rule of has_unlimited():
 * an earlier row of the same account that ever started, i.e. not 'incomplete_expired'). Null when
 * there is no such subscription. Service role: the row may be anyone's.
 */
export async function startedSubscription(admin: Pick<SupabaseClient, "from">, subscriptionId: string): Promise<StartedRow | null | { error: string }> {
  const { data, error } = await admin.from("unlimited_subscriptions").select(SELECT).eq("stripe_subscription_id", subscriptionId).maybeSingle();
  if (error) return { error: error.message };
  if (!data) return null;
  const raw = data as Record<string, unknown>;
  const userId = asString(raw.user_id);
  let repeat = false;
  if (userId) {
    const earlier = await admin
      .from("unlimited_subscriptions")
      .select("id")
      .eq("user_id", userId)
      .lt("id", raw.id as number)
      .or("status.is.null,status.neq.incomplete_expired")
      .limit(1);
    if (earlier.error) return { error: earlier.error.message };
    repeat = Array.isArray(earlier.data) && earlier.data.length > 0;
  }
  return {
    subscriptionId: asString(raw.stripe_subscription_id) ?? subscriptionId,
    userId,
    status: asString(raw.status),
    trialEnd: asString(raw.trial_end),
    cancelAtPeriodEnd: raw.cancel_at_period_end === true,
    cancelAt: asString(raw.cancel_at),
    payerEmail: asString(raw.payer_email),
    repeat,
  };
}

export type StartedOutcome =
  | { status: "sent"; id: string; to: "payer" | "account" }
  | { status: "already_sent" }
  | { status: "skipped"; reason: StartedSkip | "not_configured" | "no_email" }
  | { status: "failed"; error: string };

/**
 * Send the "has started" email for this subscription if it is due and not sent yet. Never throws
 * (see the module comment); logs what it did at info, a failure at error.
 */
export async function sendUnlimitedStarted(deps: EmailDeps, subscriptionId: string, log: pino.Logger): Promise<StartedOutcome> {
  const where = { subscription: subscriptionId, email: "unlimited_started" };
  try {
    const env: EmailEnv = deps.getEnv();
    if (!env.hasServiceRole || !env.resend.apiKey) {
      log.warn(where, "free week started email not sent: RESEND_API_KEY or SUPABASE_SERVICE_ROLE_KEY is not set");
      return { status: "skipped", reason: "not_configured" };
    }
    const row = await deps.findSubscription(subscriptionId);
    if (row && "error" in row) {
      log.error({ ...where, error: row.error }, "free week started email: could not read the subscription; the daily cron retries");
      return { status: "failed", error: row.error };
    }
    const skip = startedSkipReason(row, deps.now());
    if (skip || !row || !row.userId) {
      log.info({ ...where, reason: skip }, "free week started email not due");
      return { status: "skipped", reason: skip ?? "no_user" };
    }
    const store = deps.logStore();
    const logged = await store.loggedRefs("unlimited_started", [subscriptionId]);
    if (!("error" in logged) && logged.has(subscriptionId)) return { status: "already_sent" };

    const to = await billingRecipient({ payerEmail: row.payerEmail, userId: row.userId }, deps.emailOf);
    if ("error" in to) {
      log.error({ ...where, error: to.error }, "free week started email: could not look up the account's email; the daily cron retries");
      return { status: "failed", error: to.error };
    }
    if (!to.email) {
      log.warn({ ...where, userId: row.userId }, "free week started email not sent: neither the payer nor the account has an email address");
      return { status: "skipped", reason: "no_email" };
    }
    if (!env.manageIsPortal) log.warn(where, "NEXT_PUBLIC_BILLING_PORTAL_URL is not set: the email's cancel link opens the account page");
    const rendered = unlimitedStartedEmail({
      trialEnd: new Date(row.trialEnd!),
      manageUrl: env.manageUrl,
      siteUrl: env.siteUrl,
      planName: UNLIMITED_PLAN.name,
      monthlyUsd: UNLIMITED_PLAN.monthlyUsd,
      repeat: row.repeat,
    });
    const outcome = await sendOnce({
      store,
      key: startedLogKey({ subscriptionId, userId: row.userId }),
      message: { to: to.email, ...rendered, idempotencyKey: startedIdempotencyKey(subscriptionId), tags: { kind: "unlimited_started" } },
      send: (message) => deps.send(message, env.resend),
      log,
    });
    switch (outcome.status) {
      case "sent":
        log.info({ ...where, userId: row.userId, to: to.source, repeat: row.repeat, resendId: outcome.id }, "free week started email sent");
        return { status: "sent", id: outcome.id, to: to.source };
      case "already_sent":
        return { status: "already_sent" };
      default:
        log.error({ ...where, status: outcome.status, error: outcome.error }, "free week started email not sent; the daily cron retries");
        return { status: "failed", error: outcome.error };
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.error({ ...where, error }, "free week started email failed; the daily cron retries");
    return { status: "failed", error };
  }
}

export type StartedSweepSummary = {
  /** trialing subscriptions with an account whose free week ends 1 to 8 days from now */
  found: number;
  alreadySent: number;
  sent: number;
  failed: number;
  skipped: number;
  /** dry run only: the subscriptions that would be confirmed now */
  wouldSend?: string[];
};

/**
 * The daily catch-up (GET /api/cron/trial-reminders): a "has started" email the webhook could not
 * send (Resend down, a deploy in between) goes out on the next run, while the trial has more than a
 * day left. Throws only when the subscriptions or the log cannot be read at all.
 */
export async function runStartedSweep(deps: EmailDeps, opts: { dryRun: boolean; maxSends?: number }, log: pino.Logger): Promise<StartedSweepSummary> {
  const now = deps.now();
  const found = await deps.findTrials(new Date(now.getTime() + STARTED_SWEEP_WINDOW.fromMs), new Date(now.getTime() + STARTED_SWEEP_WINDOW.toMs));
  if ("error" in found) throw new Error(`could not read subscriptions: ${found.error}`);
  const summary: StartedSweepSummary = { found: found.length, alreadySent: 0, sent: 0, failed: 0, skipped: 0 };
  if (opts.dryRun) summary.wouldSend = [];
  if (found.length === 0) return summary;

  const logged = await deps.logStore().loggedRefs("unlimited_started", found.map((r) => r.subscriptionId));
  if ("error" in logged) throw new Error(`could not read the email log: ${logged.error}`);
  let attempts = 0;
  for (const row of found) {
    if (logged.has(row.subscriptionId)) {
      summary.alreadySent++;
      continue;
    }
    if (opts.dryRun) {
      summary.wouldSend!.push(row.subscriptionId);
      continue;
    }
    if (attempts >= (opts.maxSends ?? 20)) break;
    if (attempts > 0) await deps.sleep(SEND_SPACING_MS);
    attempts++;
    const outcome = await sendUnlimitedStarted(deps, row.subscriptionId, log);
    if (outcome.status === "sent") summary.sent++;
    else if (outcome.status === "already_sent") summary.alreadySent++;
    else if (outcome.status === "failed") summary.failed++;
    else summary.skipped++;
  }
  return summary;
}
