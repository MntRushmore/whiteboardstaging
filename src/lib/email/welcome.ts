/**
 * The welcome email: once per account, after the student finishes onboarding (POST
 * /api/email/welcome, called by the app at the end of the guided first board).
 *
 * Who gets it, decided on the server only:
 *  - the address is the signed-in account's own, from Supabase Auth (`requireUser`); the request
 *    carries no body, so a client cannot name another recipient;
 *  - the profile must say onboarding is done (`profiles.onboarded_at`, written by save_onboarding),
 *    and recently (WELCOME_WINDOW_MS): accounts made before onboarding shipped were backfilled with
 *    onboarded_at = created_at (20260928100000_onboarding.sql), and a call from an old account (a
 *    replayed tour, a bug in the caller) must not greet someone who has used Agathon for months;
 *  - once: email_log (kind 'welcome', ref '') through `sendOnce`.
 */
import type pino from "pino";
import { sendOnce, type EmailLogKey } from "@/lib/email/log";
import { isSendableAddress } from "@/lib/email/resend";
import type { EmailDeps, EmailEnv } from "@/lib/email/server";
import { welcomeEmail } from "@/lib/email/templates";

const DAY_MS = 24 * 60 * 60 * 1000;

/** How long after finishing onboarding the welcome may still be sent. */
export const WELCOME_WINDOW_MS = 7 * DAY_MS;

export type WelcomeEligibility = "eligible" | "not_onboarded" | "not_new";

/** Pure: may an account that finished onboarding at `onboardedAt` be welcomed `now`? */
export function welcomeEligibility(onboardedAt: string | null | undefined, now: Date): WelcomeEligibility {
  if (!onboardedAt) return "not_onboarded";
  const at = Date.parse(onboardedAt);
  if (Number.isNaN(at)) return "not_onboarded";
  return now.getTime() - at > WELCOME_WINDOW_MS ? "not_new" : "eligible";
}

export function welcomeLogKey(userId: string): EmailLogKey {
  return { userId, kind: "welcome", ref: "" };
}

/** Resend's Idempotency-Key for this account's welcome (well under the 256-character limit). */
export function welcomeIdempotencyKey(userId: string): string {
  return `welcome/${userId}`;
}

export type WelcomeOutcome =
  | { status: "sent"; id: string }
  | { status: "already_sent" }
  | { status: "skipped"; reason: "no_email" | "not_onboarded" | "not_new" }
  /** Resend refused or could not be reached; a later call retries. */
  | { status: "failed"; error: string }
  /** The profile or the email log could not be read or written; nothing was sent. */
  | { status: "error"; error: string };

export type WelcomeUser = { id: string; email: string | null; token: string };

export async function runWelcome(deps: EmailDeps, env: EmailEnv, user: WelcomeUser, log: pino.Logger): Promise<WelcomeOutcome> {
  const email = user.email?.trim() ?? "";
  if (!email || !isSendableAddress(email)) return { status: "skipped", reason: "no_email" };

  const profile = await deps.readOnboardedAt(user.token, user.id);
  if ("error" in profile) {
    log.error({ error: profile.error }, "welcome: could not read the profile");
    return { status: "error", error: profile.error };
  }
  const eligibility = welcomeEligibility(profile.onboardedAt, deps.now());
  if (eligibility !== "eligible") return { status: "skipped", reason: eligibility };

  const rendered = welcomeEmail({ siteUrl: env.siteUrl });
  const outcome = await sendOnce({
    store: deps.logStore(),
    key: welcomeLogKey(user.id),
    message: { to: email, ...rendered, idempotencyKey: welcomeIdempotencyKey(user.id), tags: { kind: "welcome" } },
    send: (message) => deps.send(message, env.resend),
    log,
  });
  switch (outcome.status) {
    case "sent":
      log.info({ resendId: outcome.id }, "welcome email sent");
      return outcome;
    case "already_sent":
      return outcome;
    case "failed":
      log.warn({ error: outcome.error, httpStatus: outcome.httpStatus, released: outcome.released }, "welcome email not sent");
      return { status: "failed", error: outcome.error };
    case "log_error":
      return { status: "error", error: outcome.error };
  }
}
