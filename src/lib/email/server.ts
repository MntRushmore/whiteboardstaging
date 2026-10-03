/**
 * What the email routes read from outside the request: the env, the service-role email log, the
 * caller's profile, the subscriptions, an account's address, Resend, the clock. The routes
 * (src/app/api/email/welcome, src/app/api/cron/trial-reminders) call `emailDeps`; tests replace it.
 * Route files may not read process.env or export helpers (routeProtection.test.ts), so all of this
 * lives here.
 *
 * Server-only: it reads the server env and holds the service role.
 */
import { getServerEnv } from "@/lib/env";
import { LEGAL } from "@/lib/legal";
import { supabaseEmailLog, type EmailLogStore } from "@/lib/email/log";
import { DEFAULT_EMAIL_FROM, sendEmail, type ResendConfig, type SendEmailInput, type SendEmailResult } from "@/lib/email/resend";
import { trialsEndingBetween, type TrialRow } from "@/lib/email/trialReminders";
import { serviceClient, userClient } from "@/lib/server/billing";

/** Where links point when NEXT_PUBLIC_SITE_URL is unset: production (an email never links to localhost by accident). */
export const PRODUCTION_SITE_URL = `https://${LEGAL.siteHost}`;

export type EmailEnv = {
  /** CRON_SECRET (trimmed; placeholders are unset); the cron answers 503 without it. */
  cronSecret: string | undefined;
  /** Whether SUPABASE_SERVICE_ROLE_KEY is set: the email log needs it (503 without). */
  hasServiceRole: boolean;
  /** RESEND_API_KEY and EMAIL_FROM. */
  resend: ResendConfig;
  /** The site's origin for links: NEXT_PUBLIC_SITE_URL when it is an absolute http(s) URL, else production. */
  siteUrl: string;
  /** "Manage or cancel": NEXT_PUBLIC_BILLING_PORTAL_URL, else the account page. */
  manageUrl: string;
  /** False when manageUrl fell back to the account page (logged by the cron). */
  manageIsPortal: boolean;
};

/** An absolute http(s) URL without a trailing slash, or null. */
function absoluteHttpUrl(raw: string | undefined | null): string | null {
  if (!raw?.trim()) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export function resolveSiteUrl(raw: string | undefined | null): string {
  return absoluteHttpUrl(raw) ?? PRODUCTION_SITE_URL;
}

/** The portal when it is a usable URL; otherwise `<site>/account`, where the plan is managed. */
export function resolveManageUrl(raw: string | undefined | null, siteUrl: string): { url: string; portal: boolean } {
  const portal = absoluteHttpUrl(raw);
  return portal ? { url: portal, portal: true } : { url: `${siteUrl}/account`, portal: false };
}

export function getEmailEnv(): EmailEnv {
  const env = getServerEnv();
  const siteUrl = resolveSiteUrl(env.NEXT_PUBLIC_SITE_URL);
  const manage = resolveManageUrl(env.NEXT_PUBLIC_BILLING_PORTAL_URL, siteUrl);
  return {
    cronSecret: env.CRON_SECRET?.trim() || undefined,
    hasServiceRole: Boolean(env.SUPABASE_SERVICE_ROLE_KEY),
    resend: { apiKey: env.RESEND_API_KEY ?? null, from: env.EMAIL_FROM?.trim() || DEFAULT_EMAIL_FROM },
    siteUrl,
    manageUrl: manage.url,
    manageIsPortal: manage.portal,
  };
}

export type EmailDeps = {
  getEnv: () => EmailEnv;
  /** public.email_log through the service role. */
  logStore: () => EmailLogStore;
  /** The caller's profiles.onboarded_at, read AS the caller (RLS: a user reads only their own profile). */
  readOnboardedAt: (token: string, userId: string) => Promise<{ onboardedAt: string | null } | { error: string }>;
  /** Trialing subscriptions whose free week ends in [from, to), through the service role. */
  findTrials: (from: Date, to: Date) => Promise<TrialRow[] | { error: string }>;
  /** An account's email address (auth.users), through the service role; null when it has none. */
  emailOf: (userId: string) => Promise<{ email: string | null } | { error: string }>;
  send: (message: SendEmailInput, config: ResendConfig) => Promise<SendEmailResult>;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
};

function admin() {
  const client = serviceClient();
  if (!client) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return client;
}

export const emailDeps: EmailDeps = {
  getEnv: getEmailEnv,
  logStore: () => supabaseEmailLog(admin()),
  async readOnboardedAt(token, userId) {
    const { data, error } = await userClient(token).from("profiles").select("onboarded_at").eq("user_id", userId).maybeSingle();
    if (error) return { error: error.message };
    const value = (data as { onboarded_at?: unknown } | null)?.onboarded_at;
    return { onboardedAt: typeof value === "string" ? value : null };
  },
  findTrials: (from, to) => trialsEndingBetween(admin(), from, to),
  async emailOf(userId) {
    const { data, error } = await admin().auth.admin.getUserById(userId);
    if (error) return { error: error.message };
    return { email: data.user?.email ?? null };
  },
  send: (message, config) => sendEmail(message, config),
  now: () => new Date(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};
