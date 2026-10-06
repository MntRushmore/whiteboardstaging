/**
 * The free-trial reminder (src/lib/email/trialReminders.ts): the date window, who is skipped, the
 * one query against the subscriptions table, and a whole run with fake deps.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { UNLIMITED_PLAN } from "@/lib/billing/unlimited";
import {
  MAX_RETRY_WAIT_MS,
  SEND_SPACING_MS,
  SUBSCRIPTIONS,
  TRIAL_QUERY_LIMIT,
  reminderSkipReason,
  reminderWindow,
  runTrialReminders,
  toTrialRow,
  trialReminderIdempotencyKey,
  trialsEndingBetween,
  type TrialRow,
} from "@/lib/email/trialReminders";
import { PORTAL, fakeDeps, silentLog, testEnv } from "./fakes";

const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-10-08T15:00:00Z");
const at = (hoursFromNow: number) => new Date(NOW.getTime() + hoursFromNow * HOUR).toISOString();

function trial(over: Partial<TrialRow> = {}): TrialRow {
  return {
    subscriptionId: "sub_1",
    userId: "11111111-2222-4333-8444-555555555555",
    status: "trialing",
    trialEnd: at(30),
    cancelAtPeriodEnd: false,
    cancelAt: null,
    payerEmail: null,
    ...over,
  };
}

describe("reminderWindow / reminderSkipReason", () => {
  it("covers trials ending 12 to 48 hours from now (sized for the 3-day trial)", () => {
    expect(reminderWindow(NOW)).toEqual({ from: new Date(at(12)), to: new Date(at(48)) });
  });

  it("reminds a trialing subscription with a user, ending inside the window", () => {
    const w = reminderWindow(NOW);
    expect(reminderSkipReason(trial(), w)).toBeNull();
    expect(reminderSkipReason(trial({ trialEnd: at(12) }), w)).toBeNull(); // from is inclusive
    expect(reminderSkipReason(trial({ trialEnd: at(47.99) }), w)).toBeNull();
  });

  it("skips what will not be charged, or cannot be told", () => {
    const w = reminderWindow(NOW);
    expect(reminderSkipReason(trial({ userId: null }), w)).toBe("no_user");
    expect(reminderSkipReason(trial({ status: "active" }), w)).toBe("not_trialing");
    expect(reminderSkipReason(trial({ status: null }), w)).toBe("not_trialing");
    expect(reminderSkipReason(trial({ trialEnd: at(48) }), w)).toBe("outside_window"); // to is exclusive
    expect(reminderSkipReason(trial({ trialEnd: at(11) }), w)).toBe("outside_window");
    expect(reminderSkipReason(trial({ trialEnd: null }), w)).toBe("outside_window");
    expect(reminderSkipReason(trial({ cancelAtPeriodEnd: true }), w)).toBe("cancelling");
    expect(reminderSkipReason(trial({ cancelAt: at(30) }), w)).toBe("cancelling"); // at the trial end
    expect(reminderSkipReason(trial({ cancelAt: at(20) }), w)).toBe("cancelling"); // before it
    expect(reminderSkipReason(trial({ cancelAt: at(24 * 40) }), w)).toBeNull(); // after the first charge: it still charges
  });

  it("with one run a day, every trial is first reminded 24-48 h ahead, and a retry run follows when 36 h or more were left", () => {
    const runs = Array.from({ length: 20 }, (_, d) => new Date(Date.UTC(2026, 9, 1, 15, 0) + d * 24 * HOUR));
    for (let minutes = 0; minutes < 7 * 24 * 60; minutes += 37) {
      const end = new Date(Date.UTC(2026, 9, 8, 0, 0) + minutes * 60_000).toISOString();
      const inWindow = runs.filter((now) => reminderSkipReason(trial({ trialEnd: end }), reminderWindow(now)) === null);
      const lead = (Date.parse(end) - inWindow[0].getTime()) / HOUR;
      expect(lead, end).toBeGreaterThanOrEqual(24);
      expect(lead, end).toBeLessThan(48);
      // a 3-day trial is never reminded on the day it starts: the first lead is under 72 h
      expect(inWindow, end).toHaveLength(lead >= 36 ? 2 : 1);
    }
  });

  it("keys Resend's idempotency on the subscription and its trial end", () => {
    expect(trialReminderIdempotencyKey(trial({ trialEnd: "2026-10-10T03:04:00.000Z" }))).toBe("trial-reminder/sub_1/1791601440");
  });
});

/** A supabase-js builder that records each call and resolves to `result`. */
function recordingAdmin(result: { data?: unknown; error?: { message: string } | null }) {
  const calls: Array<[string, ...unknown[]]> = [];
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "not", "gte", "lt", "order", "limit"]) {
    builder[m] = (...args: unknown[]) => {
      calls.push([m, ...args]);
      return builder;
    };
  }
  builder.then = (resolve: (v: unknown) => unknown) => resolve({ data: result.data ?? null, error: result.error ?? null });
  const admin = {
    from: (table: string) => {
      calls.push(["from", table]);
      return builder;
    },
  };
  return { admin: admin as unknown as Pick<SupabaseClient, "from">, calls };
}

describe("trialsEndingBetween (the one query against the subscriptions table)", () => {
  const from = new Date(at(12));
  const to = new Date(at(48));

  it("asks for trialing rows with a user, ending in [from, to), soonest first", async () => {
    const { admin, calls } = recordingAdmin({ data: [] });
    expect(await trialsEndingBetween(admin, from, to)).toEqual([]);
    expect(calls).toEqual([
      ["from", "unlimited_subscriptions"],
      ["select", "stripe_subscription_id,user_id,status,trial_end,cancel_at_period_end,cancel_at,payer_email"],
      ["eq", "status", "trialing"],
      ["not", "user_id", "is", null],
      ["gte", "trial_end", from.toISOString()],
      ["lt", "trial_end", to.toISOString()],
      ["order", "trial_end", { ascending: true }],
      ["limit", TRIAL_QUERY_LIMIT],
    ]);
  });

  it("maps rows by the column names in SUBSCRIPTIONS and drops a row without an id", async () => {
    const { admin } = recordingAdmin({
      data: [
        { stripe_subscription_id: "sub_a", user_id: "u1", status: "trialing", trial_end: "2026-10-10T03:04:00+00:00", cancel_at_period_end: false, cancel_at: null, payer_email: "payer@example.com" },
        { stripe_subscription_id: "sub_b", user_id: "u2", status: "trialing", trial_end: "2026-10-10T05:00:00+00:00", cancel_at_period_end: true, cancel_at: "2026-10-10T05:00:00+00:00" },
        { stripe_subscription_id: null, user_id: "u3" },
      ],
    });
    expect(await trialsEndingBetween(admin, from, to)).toEqual([
      { subscriptionId: "sub_a", userId: "u1", status: "trialing", trialEnd: "2026-10-10T03:04:00+00:00", cancelAtPeriodEnd: false, cancelAt: null, payerEmail: "payer@example.com" },
      { subscriptionId: "sub_b", userId: "u2", status: "trialing", trialEnd: "2026-10-10T05:00:00+00:00", cancelAtPeriodEnd: true, cancelAt: "2026-10-10T05:00:00+00:00", payerEmail: null },
    ]);
    expect(toTrialRow({ [SUBSCRIPTIONS.columns.subscriptionId]: "sub_c" })).toEqual({
      subscriptionId: "sub_c",
      userId: null,
      status: null,
      trialEnd: null,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      payerEmail: null,
    });
  });

  it("passes a database error on", async () => {
    const { admin } = recordingAdmin({ error: { message: 'relation "public.unlimited_subscriptions" does not exist' } });
    expect(await trialsEndingBetween(admin, from, to)).toEqual({ error: 'relation "public.unlimited_subscriptions" does not exist' });
  });
});

describe("runTrialReminders", () => {
  const rows = [
    trial({ subscriptionId: "sub_due", userId: "u_due", trialEnd: "2026-10-10T03:04:00.000Z" }),
    trial({ subscriptionId: "sub_cancel", userId: "u_cancel", cancelAtPeriodEnd: true }),
    trial({ subscriptionId: "sub_cancel_at", userId: "u_cancel_at", cancelAt: at(20) }),
    trial({ subscriptionId: "sub_nobody", userId: null }),
  ];

  it("sends each due reminder once, to the account's address, saying when and how much", async () => {
    const deps = fakeDeps({ now: NOW, trials: rows, emails: { u_due: "parent@example.com" } });
    const summary = await runTrialReminders(deps, testEnv(), { dryRun: false }, silentLog());
    expect(summary).toEqual({
      dryRun: false,
      window: { from: at(12), to: at(48) },
      found: 4,
      due: 1,
      alreadySent: 0,
      sent: 1,
      failed: 0,
      skipped: { noUser: 1, cancelling: 2, noEmail: 0 },
      deferred: 0,
    });
    expect(deps.findTrials).toHaveBeenCalledWith(new Date(at(12)), new Date(at(48)));
    expect(deps.emailOf).toHaveBeenCalledTimes(1);
    const [message] = deps.sent;
    expect(message.to).toBe("parent@example.com");
    expect(message.subject).toBe(`Your free trial of ${UNLIMITED_PLAN.name} ends on Friday, October 9`);
    expect(message.text).toContain(`On Friday, October 9, your card will be charged $${UNLIMITED_PLAN.monthlyUsd} for ${UNLIMITED_PLAN.name}.`);
    expect(message.text).toContain(PORTAL);
    expect(message.idempotencyKey).toBe("trial-reminder/sub_due/1791601440");
    expect(message.tags).toEqual({ kind: "trial_reminder" });
    expect(deps.log.rows).toEqual([expect.objectContaining({ user_id: "u_due", kind: "trial_reminder", ref: "sub_due", resend_id: "re_1" })]);

    // the next day's run (still inside the window) sends nothing more, and looks up no address
    const again = await runTrialReminders(deps, testEnv(), { dryRun: false }, silentLog());
    expect(again).toMatchObject({ due: 1, alreadySent: 1, sent: 0 });
    expect(deps.send).toHaveBeenCalledTimes(1);
    expect(deps.emailOf).toHaveBeenCalledTimes(1);
  });

  it("goes to the payer's email from the checkout, not the account's (often the child's); the account's only without one", async () => {
    const deps = fakeDeps({
      now: NOW,
      trials: [
        trial({ subscriptionId: "sub_paid_by_parent", userId: "u_kid", payerEmail: "parent@example.com" }),
        trial({ subscriptionId: "sub_old_row", userId: "u_old", payerEmail: null }),
        trial({ subscriptionId: "sub_bad_payer", userId: "u_bad", payerEmail: "not an address" }),
      ],
      emails: { u_kid: "kid@school.example", u_old: "account@example.com", u_bad: "account2@example.com" },
    });
    expect(await runTrialReminders(deps, testEnv(), { dryRun: false }, silentLog())).toMatchObject({ due: 3, sent: 3 });
    expect(deps.sent.map((m) => m.to)).toEqual(["parent@example.com", "account@example.com", "account2@example.com"]);
    // the payer's address needs no account lookup
    expect(deps.emailOf).not.toHaveBeenCalledWith("u_kid");
    // the log is still per account and subscription
    expect(deps.log.rows.map((r) => [r.user_id, r.ref])).toEqual([
      ["u_kid", "sub_paid_by_parent"],
      ["u_old", "sub_old_row"],
      ["u_bad", "sub_bad_payer"],
    ]);
  });

  it("a dry run lists what it would send and touches nothing", async () => {
    const deps = fakeDeps({ now: NOW, trials: rows });
    const summary = await runTrialReminders(deps, testEnv(), { dryRun: true }, silentLog());
    expect(summary).toMatchObject({ dryRun: true, due: 1, sent: 0, wouldSend: ["sub_due"] });
    expect(deps.send).not.toHaveBeenCalled();
    expect(deps.emailOf).not.toHaveBeenCalled();
    expect(deps.log.store.claim).not.toHaveBeenCalled();
  });

  it("an account without an address is counted and skipped; a lookup failure is a failure", async () => {
    const deps = fakeDeps({
      now: NOW,
      trials: [trial({ subscriptionId: "sub_a", userId: "u_a" }), trial({ subscriptionId: "sub_b", userId: "u_b" })],
      emails: { u_a: null, u_b: { error: "User not found" } },
    });
    expect(await runTrialReminders(deps, testEnv(), { dryRun: false }, silentLog())).toMatchObject({ due: 2, sent: 0, failed: 1, skipped: { noEmail: 1 } });
    expect(deps.log.rows).toEqual([]);
  });

  it("a failed send is counted, its claim released for the next run", async () => {
    const deps = fakeDeps({ now: NOW, trials: [rows[0]] });
    deps.sendReplies.push({ ok: false, error: "validation_error: bad", status: 422 });
    expect(await runTrialReminders(deps, testEnv(), { dryRun: false }, silentLog())).toMatchObject({ sent: 0, failed: 1 });
    expect(deps.log.rows).toEqual([]);
    expect(await runTrialReminders(deps, testEnv(), { dryRun: false }, silentLog())).toMatchObject({ sent: 1, failed: 0 });
  });

  it("waits out a short 429 and tries once more; a long one waits for the next run", async () => {
    const deps = fakeDeps({ now: NOW, trials: [rows[0]] });
    deps.sendReplies.push({ ok: false, error: "rate_limit_exceeded: slow", status: 429, retryAfterMs: 1_000 });
    expect(await runTrialReminders(deps, testEnv(), { dryRun: false }, silentLog())).toMatchObject({ sent: 1 });
    expect(deps.slept).toEqual([1_000]);
    expect(deps.send).toHaveBeenCalledTimes(2);

    const quota = fakeDeps({ now: NOW, trials: [rows[0]] });
    quota.sendReplies.push({ ok: false, error: "daily_quota_exceeded: quota", status: 429, retryAfterMs: MAX_RETRY_WAIT_MS + 1 });
    expect(await runTrialReminders(quota, testEnv(), { dryRun: false }, silentLog())).toMatchObject({ sent: 0, failed: 1 });
    expect(quota.send).toHaveBeenCalledTimes(1);
  });

  it("spaces its sends for Resend's rate limit and leaves the rest past the cap for the next run", async () => {
    const many = Array.from({ length: 5 }, (_, i) => trial({ subscriptionId: `sub_${i}`, userId: `u_${i}` }));
    const deps = fakeDeps({ now: NOW, trials: many });
    expect(await runTrialReminders(deps, testEnv(), { dryRun: false, maxSends: 3 }, silentLog())).toMatchObject({ due: 5, sent: 3, deferred: 2 });
    expect(deps.slept).toEqual([SEND_SPACING_MS, SEND_SPACING_MS]);
    expect(await runTrialReminders(deps, testEnv(), { dryRun: false, maxSends: 3 }, silentLog())).toMatchObject({ alreadySent: 3, sent: 2, deferred: 0 });
  });

  it("links the account page when the billing portal is not configured", async () => {
    const env = testEnv({ manageUrl: "https://whiteboard.example.com/account", manageIsPortal: false });
    const deps = fakeDeps({ now: NOW, trials: [rows[0]] });
    const log = silentLog();
    await runTrialReminders(deps, env, { dryRun: false }, log);
    expect(deps.sent[0].text).toContain("Manage or cancel: https://whiteboard.example.com/account");
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(expect.stringMatching(/NEXT_PUBLIC_BILLING_PORTAL_URL/));
    // a run with nothing to send says nothing about it
    const quiet = silentLog();
    await runTrialReminders(deps, env, { dryRun: false }, quiet);
    await runTrialReminders(deps, env, { dryRun: true }, quiet);
    expect(quiet.warn).not.toHaveBeenCalled();
  });

  it("throws when the subscriptions or the log cannot be read (the route answers 500)", async () => {
    await expect(runTrialReminders(fakeDeps({ now: NOW, trials: { error: "no table" } }), testEnv(), { dryRun: false }, silentLog())).rejects.toThrow(/no table/);
    const deps = fakeDeps({ now: NOW, trials: [rows[0]] });
    deps.log.store.loggedRefs = async () => ({ error: "db down" });
    await expect(runTrialReminders(deps, testEnv(), { dryRun: false }, silentLog())).rejects.toThrow(/db down/);
  });

  it("with nothing due, it reads no log and sends nothing", async () => {
    const deps = fakeDeps({ now: NOW, trials: [] });
    expect(await runTrialReminders(deps, testEnv(), { dryRun: false }, silentLog())).toMatchObject({ found: 0, due: 0, sent: 0 });
    expect(deps.log.store.loggedRefs).not.toHaveBeenCalled();
  });
});
