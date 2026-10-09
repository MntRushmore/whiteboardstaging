/**
 * Test doubles for the email modules: an in-memory email_log with the table's unique key, and a
 * full EmailDeps whose every outside call is recorded. No network, no database.
 */
import { vi } from "vitest";
import type { FamilyActivity, LearnerActivity } from "@/lib/email/activity";
import type { EmailLogKey, EmailLogStore } from "@/lib/email/log";
import type { NudgeTrialRow } from "@/lib/email/nudges";
import type { SendEmailInput, SendEmailResult } from "@/lib/email/resend";
import type { EmailDeps, EmailEnv } from "@/lib/email/server";
import type { TrialRow } from "@/lib/email/trialReminders";
import type { StartedRow } from "@/lib/email/unlimitedStarted";

export type LogRow = { user_id: string; kind: string; ref: string; resend_id: string | null; sent_at: string | null };

/** public.email_log in memory: unique (user_id, kind, ref); release only removes unsent rows. */
export function memoryEmailLog() {
  const rows: LogRow[] = [];
  const find = (k: EmailLogKey) => rows.find((r) => r.user_id === k.userId && r.kind === k.kind && r.ref === k.ref);
  const store: EmailLogStore = {
    claim: vi.fn(async (k: EmailLogKey) => {
      if (find(k)) return { status: "taken" as const };
      rows.push({ user_id: k.userId, kind: k.kind, ref: k.ref, resend_id: null, sent_at: null });
      return { status: "claimed" as const };
    }),
    record: vi.fn(async (k: EmailLogKey, resendId: string) => {
      const row = find(k);
      if (!row) return { error: "no claim" };
      row.resend_id = resendId;
      row.sent_at = new Date().toISOString();
      return { ok: true as const };
    }),
    release: vi.fn(async (k: EmailLogKey) => {
      const row = find(k);
      if (row && row.resend_id === null) rows.splice(rows.indexOf(row), 1);
      return { ok: true as const };
    }),
    loggedRefs: vi.fn(async (kind: string, refs: string[]) => new Set(rows.filter((r) => r.kind === kind && refs.includes(r.ref)).map((r) => r.ref))),
  };
  return { rows, store };
}

export const SITE = "https://whiteboard.example.com";
export const PORTAL = "https://billing.stripe.com/p/login/test_123";

export function testEnv(over: Partial<EmailEnv> = {}): EmailEnv {
  return {
    cronSecret: "unit-cron-secret",
    reportLinkSecret: "unit-link-secret",
    hasServiceRole: true,
    resend: { apiKey: "re_unit_test", from: "Agathon <hello@mail.agathon.app>" },
    siteUrl: SITE,
    manageUrl: PORTAL,
    manageIsPortal: true,
    alertEmail: "owner@example.com",
    ...over,
  };
}

export type FakeDeps = EmailDeps & {
  log: ReturnType<typeof memoryEmailLog>;
  sent: SendEmailInput[];
  /** Replies for the next sends, in order; when empty, every send succeeds with a fresh id. */
  sendReplies: SendEmailResult[];
  slept: number[];
};

export function fakeDeps(opts: {
  env?: EmailEnv;
  now?: Date;
  onboardedAt?: string | null | { error: string };
  trials?: TrialRow[] | { error: string };
  emails?: Record<string, string | null | { error: string }>;
  /** unlimited_subscriptions by Stripe id, for the "free trial started" email */
  subscriptions?: Record<string, StartedRow | { error: string }>;
  /** trialing subscriptions for the nudges */
  nudgeTrials?: NudgeTrialRow[] | { error: string };
  /** each account's family activity; by default the account alone, with nothing done */
  activity?: Record<string, FamilyActivity | { error: string }>;
} = {}): FakeDeps {
  const log = memoryEmailLog();
  const sent: SendEmailInput[] = [];
  const sendReplies: SendEmailResult[] = [];
  const slept: number[] = [];
  let ids = 0;
  const deps: FakeDeps = {
    log,
    sent,
    sendReplies,
    slept,
    getEnv: () => opts.env ?? testEnv(),
    logStore: () => log.store,
    readOnboardedAt: vi.fn(async () => {
      const v = opts.onboardedAt === undefined ? new Date().toISOString() : opts.onboardedAt;
      return v !== null && typeof v === "object" ? v : { onboardedAt: v };
    }),
    findTrials: vi.fn(async () => opts.trials ?? []),
    findSubscription: vi.fn(async (id: string) => opts.subscriptions?.[id] ?? null),
    emailOf: vi.fn(async (userId: string) => {
      const v = opts.emails?.[userId];
      if (v !== null && typeof v === "object") return v;
      return { email: v === undefined ? `${userId}@example.com` : v };
    }),
    findNudgeTrials: vi.fn(async () => opts.nudgeTrials ?? []),
    readFamilyActivity: vi.fn(async (userId: string) => opts.activity?.[userId] ?? quietFamily(userId)),
    send: vi.fn(async (message: SendEmailInput) => {
      const reply = sendReplies.shift() ?? { ok: true as const, id: `re_${++ids}` };
      if (reply.ok) sent.push(message);
      return reply;
    }),
    now: () => opts.now ?? new Date(),
    sleep: vi.fn(async (ms: number) => {
      slept.push(ms);
    }),
  };
  return deps;
}

/** An account on its own that has done nothing yet. */
export function quietFamily(userId: string, over: Partial<LearnerActivity> = {}): FamilyActivity {
  return { learners: [{ userId, displayName: null, isKid: false, onboardedAt: null, attempts: [], practice: [], ...over }] };
}

/** A pino-shaped logger that swallows everything. */
export function silentLog() {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: () => log };
  return log as unknown as import("pino").Logger & { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
}
