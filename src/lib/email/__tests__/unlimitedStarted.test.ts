/**
 * "Your free trial of Agathon Unlimited has started" (src/lib/email/unlimitedStarted.ts): when it is
 * due, the one query for the subscription, who it goes to (the payer, else the account), once per
 * subscription, the second-plan wording, and the daily catch-up. The webhook's side (after the
 * answer, never failing it) is in src/lib/server/__tests__/billingWebhook.test.ts.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { billingRecipient } from "@/lib/email/payer";
import { SEND_SPACING_MS } from "@/lib/email/trialReminders";
import {
  STARTED_SWEEP_WINDOW,
  runStartedSweep,
  sendUnlimitedStarted,
  startedIdempotencyKey,
  startedSkipReason,
  startedSubscription,
  type StartedRow,
} from "@/lib/email/unlimitedStarted";
import { PORTAL, SITE, fakeDeps, silentLog, testEnv } from "./fakes";

const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-10-03T15:00:00Z");
const at = (hours: number) => new Date(NOW.getTime() + hours * HOUR).toISOString();
const USER = "11111111-2222-4333-8444-555555555555";

function row(over: Partial<StartedRow> = {}): StartedRow {
  return {
    subscriptionId: "sub_1",
    userId: USER,
    status: "trialing",
    trialEnd: at(7 * 24),
    cancelAtPeriodEnd: false,
    cancelAt: null,
    payerEmail: "parent@example.com",
    repeat: false,
    ...over,
  };
}

describe("startedSkipReason", () => {
  it("is due for a linked plan in its free trial, set to renew", () => {
    expect(startedSkipReason(row(), NOW)).toBeNull();
    expect(startedSkipReason(row({ cancelAt: at(40 * 24) }), NOW)).toBeNull(); // cancels after the first charge: still charges
  });

  it("is not due when nobody is charged or nobody can be told", () => {
    expect(startedSkipReason(null, NOW)).toBe("no_subscription");
    expect(startedSkipReason(row({ userId: null }), NOW)).toBe("no_user");
    for (const status of [null, "active", "canceled", "incomplete"]) expect(startedSkipReason(row({ status }), NOW), String(status)).toBe("not_trialing");
    expect(startedSkipReason(row({ trialEnd: null }), NOW)).toBe("no_trial_end");
    expect(startedSkipReason(row({ trialEnd: at(0.5) }), NOW)).toBe("trial_over");
    expect(startedSkipReason(row({ trialEnd: at(-1) }), NOW)).toBe("trial_over");
    expect(startedSkipReason(row({ cancelAtPeriodEnd: true }), NOW)).toBe("cancelling");
    expect(startedSkipReason(row({ cancelAt: at(24) }), NOW)).toBe("cancelling");
  });

  it("keys Resend's idempotency on the subscription", () => {
    expect(startedIdempotencyKey("sub_1")).toBe("unlimited-started/sub_1");
  });
});

/** A supabase-js builder that records each call and resolves to the next of `results`. */
function recordingAdmin(results: Array<{ data?: unknown; error?: { message: string } | null }>) {
  const calls: Array<[string, ...unknown[]]> = [];
  const make = () => {
    const builder: Record<string, unknown> = {};
    for (const m of ["select", "eq", "lt", "or", "limit"]) {
      builder[m] = (...args: unknown[]) => {
        calls.push([m, ...args]);
        return builder;
      };
    }
    const settle = () => {
      const r = results.shift() ?? {};
      return { data: r.data ?? null, error: r.error ?? null };
    };
    builder.maybeSingle = () => {
      calls.push(["maybeSingle"]);
      return Promise.resolve(settle());
    };
    builder.then = (resolve: (v: unknown) => unknown) => resolve(settle());
    return builder;
  };
  const admin = {
    from: (table: string) => {
      calls.push(["from", table]);
      return make();
    },
  };
  return { admin: admin as unknown as Pick<SupabaseClient, "from">, calls };
}

describe("startedSubscription", () => {
  const raw = {
    id: 7,
    stripe_subscription_id: "sub_1",
    user_id: USER,
    status: "trialing",
    trial_end: "2026-10-10T15:00:00+00:00",
    cancel_at_period_end: false,
    cancel_at: null,
    payer_email: "parent@example.com",
  };

  it("reads the row and whether the account had a plan before it (has_unlimited's rule)", async () => {
    const { admin, calls } = recordingAdmin([{ data: raw }, { data: [{ id: 3 }] }]);
    expect(await startedSubscription(admin, "sub_1")).toEqual({
      subscriptionId: "sub_1",
      userId: USER,
      status: "trialing",
      trialEnd: "2026-10-10T15:00:00+00:00",
      cancelAtPeriodEnd: false,
      cancelAt: null,
      payerEmail: "parent@example.com",
      repeat: true,
    });
    expect(calls).toEqual([
      ["from", "unlimited_subscriptions"],
      ["select", "id,stripe_subscription_id,user_id,status,trial_end,cancel_at_period_end,cancel_at,payer_email"],
      ["eq", "stripe_subscription_id", "sub_1"],
      ["maybeSingle"],
      ["from", "unlimited_subscriptions"],
      ["select", "id"],
      ["eq", "user_id", USER],
      ["lt", "id", 7],
      ["or", "status.is.null,status.neq.incomplete_expired"],
      ["limit", 1],
    ]);
  });

  it("a first plan is not a repeat; no row is null; an unlinked row asks nothing more; errors pass on", async () => {
    expect(await startedSubscription(recordingAdmin([{ data: raw }, { data: [] }]).admin, "sub_1")).toMatchObject({ repeat: false });
    expect(await startedSubscription(recordingAdmin([{ data: null }]).admin, "sub_1")).toBeNull();
    const unlinked = recordingAdmin([{ data: { ...raw, user_id: null } }]);
    expect(await startedSubscription(unlinked.admin, "sub_1")).toMatchObject({ userId: null, repeat: false });
    expect(unlinked.calls.filter(([m]) => m === "from")).toHaveLength(1);
    expect(await startedSubscription(recordingAdmin([{ error: { message: "no column payer_email" } }]).admin, "sub_1")).toEqual({ error: "no column payer_email" });
  });
});

describe("billingRecipient", () => {
  const emailOf = async (id: string) => (id === "u_err" ? { error: "down" } : { email: id === "u_none" ? null : `${id}@example.com` });

  it("the payer's address from the checkout first, the account's without a usable one", async () => {
    expect(await billingRecipient({ payerEmail: " parent@example.com ", userId: "u1" }, emailOf)).toEqual({ email: "parent@example.com", source: "payer" });
    expect(await billingRecipient({ payerEmail: null, userId: "u1" }, emailOf)).toEqual({ email: "u1@example.com", source: "account" });
    expect(await billingRecipient({ payerEmail: "two@a.com, b@c.com", userId: "u1" }, emailOf)).toEqual({ email: "u1@example.com", source: "account" });
    expect(await billingRecipient({ payerEmail: null, userId: "u_none" }, emailOf)).toEqual({ email: null });
    expect(await billingRecipient({ payerEmail: null, userId: "u_err" }, emailOf)).toEqual({ error: "down" });
  });
});

describe("sendUnlimitedStarted", () => {
  it("sends once, to the payer, saying nothing was charged, when and how much, how to cancel, and the terms", async () => {
    const deps = fakeDeps({ now: NOW, subscriptions: { sub_1: row({ trialEnd: "2026-10-10T19:30:00.000Z" }) } });
    const log = silentLog();
    expect(await sendUnlimitedStarted(deps, "sub_1", log)).toEqual({ status: "sent", id: "re_1", to: "payer" });
    const [message] = deps.sent;
    expect(message.to).toBe("parent@example.com");
    expect(message.subject).toBe("Your free trial of Agathon Unlimited has started");
    expect(message.text).toContain("Your free trial of Agathon Unlimited has started. Nothing was charged today.");
    expect(message.text).toContain("On Saturday, October 10 at 3:30 PM EDT, your card will be charged $25, then $25 every month until you cancel.");
    expect(message.text).toContain(`To cancel, use Manage or cancel: ${PORTAL}`);
    expect(message.text).toContain("Cancel before Saturday, October 10 at 3:30 PM EDT and you won't be charged.");
    expect(message.text).toContain(`How the plan works: ${SITE}/terms#unlimited`);
    expect(message.text).toContain(`Refund policy: ${SITE}/refunds#subscriptions`);
    expect(message.idempotencyKey).toBe("unlimited-started/sub_1");
    expect(message.tags).toEqual({ kind: "unlimited_started" });
    expect(deps.emailOf).not.toHaveBeenCalled();
    expect(deps.log.rows).toEqual([expect.objectContaining({ user_id: USER, kind: "unlimited_started", ref: "sub_1", resend_id: "re_1" })]);
    // again (a redelivery, the cron): nothing more
    expect(await sendUnlimitedStarted(deps, "sub_1", log)).toEqual({ status: "already_sent" });
    expect(deps.send).toHaveBeenCalledTimes(1);
  });

  it("falls back to the account's address when the checkout gave none", async () => {
    const deps = fakeDeps({ now: NOW, subscriptions: { sub_1: row({ payerEmail: null }) }, emails: { [USER]: "account@example.com" } });
    expect(await sendUnlimitedStarted(deps, "sub_1", silentLog())).toMatchObject({ status: "sent", to: "account" });
    expect(deps.sent[0].to).toBe("account@example.com");
  });

  it("a second plan's email says the plan starts with the first charge (its free trial grants nothing)", async () => {
    const deps = fakeDeps({ now: NOW, subscriptions: { sub_1: row({ repeat: true, trialEnd: "2026-10-10T19:30:00.000Z" }) } });
    await sendUnlimitedStarted(deps, "sub_1", silentLog());
    expect(deps.sent[0].subject).toBe("Your Agathon Unlimited plan starts on Saturday, October 10");
    expect(deps.sent[0].text).toContain("The free trial is for a first plan only, so until then help uses ink.");
    expect(deps.sent[0].text).not.toContain("Your free trial of");
  });

  it("sends nothing that is not due, and says why", async () => {
    const deps = fakeDeps({
      now: NOW,
      subscriptions: { cancelling: row({ cancelAtPeriodEnd: true }), nobody: row({ userId: null }), noemail: row({ payerEmail: null, userId: "u_none" }) },
      emails: { u_none: null },
    });
    expect(await sendUnlimitedStarted(deps, "cancelling", silentLog())).toEqual({ status: "skipped", reason: "cancelling" });
    expect(await sendUnlimitedStarted(deps, "nobody", silentLog())).toEqual({ status: "skipped", reason: "no_user" });
    expect(await sendUnlimitedStarted(deps, "missing", silentLog())).toEqual({ status: "skipped", reason: "no_subscription" });
    expect(await sendUnlimitedStarted(deps, "noemail", silentLog())).toEqual({ status: "skipped", reason: "no_email" });
    const unset = fakeDeps({ now: NOW, env: testEnv({ resend: { apiKey: null } }), subscriptions: { sub_1: row() } });
    expect(await sendUnlimitedStarted(unset, "sub_1", silentLog())).toEqual({ status: "skipped", reason: "not_configured" });
    expect([...deps.sent, ...unset.sent]).toEqual([]);
    expect(deps.log.rows).toEqual([]);
  });

  it("never throws: a failed send releases its claim; a failed read or a throwing dependency is a failure", async () => {
    const deps = fakeDeps({ now: NOW, subscriptions: { sub_1: row(), broken: { error: "connection reset" } } });
    deps.sendReplies.push({ ok: false, error: "timed out" });
    expect(await sendUnlimitedStarted(deps, "sub_1", silentLog())).toEqual({ status: "failed", error: "timed out" });
    expect(deps.log.rows).toEqual([]);
    expect(await sendUnlimitedStarted(deps, "broken", silentLog())).toEqual({ status: "failed", error: "connection reset" });
    deps.getEnv = () => {
      throw new Error("Missing required environment variables: OPENROUTER_API_KEY");
    };
    expect(await sendUnlimitedStarted(deps, "sub_1", silentLog())).toMatchObject({ status: "failed", error: /Missing required/ });
  });
});

describe("runStartedSweep (the daily catch-up)", () => {
  const trial = (id: string) => ({ subscriptionId: id, userId: USER, status: "trialing", trialEnd: at(5 * 24), cancelAtPeriodEnd: false, cancelAt: null, payerEmail: "parent@example.com" });

  it("confirms the trials of the last week that have no such email yet, spaced for Resend", async () => {
    const deps = fakeDeps({ now: NOW, trials: [trial("sub_a"), trial("sub_b"), trial("sub_c")], subscriptions: { sub_a: row({ subscriptionId: "sub_a" }), sub_b: row({ subscriptionId: "sub_b" }), sub_c: row({ subscriptionId: "sub_c" }) } });
    deps.log.rows.push({ user_id: USER, kind: "unlimited_started", ref: "sub_b", resend_id: "re_old", sent_at: NOW.toISOString() });
    expect(await runStartedSweep(deps, { dryRun: false }, silentLog())).toEqual({ found: 3, alreadySent: 1, sent: 2, failed: 0, skipped: 0 });
    expect(deps.findTrials).toHaveBeenCalledWith(new Date(NOW.getTime() + STARTED_SWEEP_WINDOW.fromMs), new Date(NOW.getTime() + STARTED_SWEEP_WINDOW.toMs));
    expect(deps.slept).toEqual([SEND_SPACING_MS]);
    expect(await runStartedSweep(deps, { dryRun: false }, silentLog())).toMatchObject({ alreadySent: 3, sent: 0 });
  });

  it("a dry run lists and sends nothing; an unreadable table throws", async () => {
    const deps = fakeDeps({ now: NOW, trials: [trial("sub_a")] });
    expect(await runStartedSweep(deps, { dryRun: true }, silentLog())).toEqual({ found: 1, alreadySent: 0, sent: 0, failed: 0, skipped: 0, wouldSend: ["sub_a"] });
    expect(deps.send).not.toHaveBeenCalled();
    await expect(runStartedSweep(fakeDeps({ now: NOW, trials: { error: "no table" } }), { dryRun: false }, silentLog())).rejects.toThrow(/no table/);
  });
});
