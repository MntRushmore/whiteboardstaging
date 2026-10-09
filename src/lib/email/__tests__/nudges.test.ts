/**
 * The free trial's nudges (src/lib/email/nudges.ts) and the progress in the "trial ends" reminder
 * (src/lib/email/trialReminders.ts), with fake deps: when each is due, who is skipped, that each
 * goes once to the payer and never to a kid address, and that a run survives one family's failure.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { FamilyActivity } from "@/lib/email/activity";
import {
  NUDGE_QUERY_LIMIT,
  nudgeDue,
  nudgeIdempotencyKey,
  runTrialNudges,
  trialsStartedSince,
  type NudgeTrialRow,
} from "@/lib/email/nudges";
import { runTrialReminders } from "@/lib/email/trialReminders";
import { fakeDeps, quietFamily, silentLog, testEnv } from "./fakes";

const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-10-09T15:00:00Z");
const USER = "11111111-2222-4333-8444-555555555555";
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * HOUR).toISOString();
const inHours = (h: number) => new Date(NOW.getTime() + h * HOUR).toISOString();

function trial(over: Partial<NudgeTrialRow> = {}): NudgeTrialRow {
  return {
    subscriptionId: "sub_1",
    userId: USER,
    status: "trialing",
    trialEnd: inHours(7 * 24 - 30),
    cancelAtPeriodEnd: false,
    cancelAt: null,
    payerEmail: "parent@example.com",
    createdAt: hoursAgo(30),
    ...over,
  };
}

/** A grown-up with one kid, Leo, who did some practice. */
function busyFamily(userId = USER): FamilyActivity {
  return {
    learners: [
      { userId, displayName: "Priya", isKid: false, onboardedAt: hoursAgo(80), attempts: [], practice: [] },
      {
        userId: "kid-1",
        displayName: "Leo",
        isKid: true,
        onboardedAt: hoursAgo(80),
        attempts: [
          { skill: "times_tables", outcome: "first_try", startedAt: hoursAgo(40) },
          { skill: "times_tables", outcome: "with_help", startedAt: hoursAgo(20) },
        ],
        practice: [{ day: "2026-10-08", done: 5, goal: 5, completedAt: hoursAgo(20) }],
      },
    ],
  };
}

describe("nudgeDue", () => {
  it("first practice from 20 to 72 hours in, progress from 72 to 120", () => {
    expect(nudgeDue(trial({ createdAt: hoursAgo(19) }), NOW)).toEqual({ skip: "outside_window" });
    expect(nudgeDue(trial({ createdAt: hoursAgo(20) }), NOW)).toEqual({ kind: "first_practice" });
    expect(nudgeDue(trial({ createdAt: hoursAgo(71) }), NOW)).toEqual({ kind: "first_practice" });
    expect(nudgeDue(trial({ createdAt: hoursAgo(72), trialEnd: inHours(96) }), NOW)).toEqual({ kind: "trial_progress" });
    expect(nudgeDue(trial({ createdAt: hoursAgo(119), trialEnd: inHours(73) }), NOW)).toEqual({ kind: "trial_progress" });
    expect(nudgeDue(trial({ createdAt: hoursAgo(120) }), NOW)).toEqual({ skip: "outside_window" });
  });

  it("sends nothing to a trial set to cancel, ended, unlinked, undated, or ending within 72 hours", () => {
    expect(nudgeDue(trial({ cancelAtPeriodEnd: true }), NOW)).toEqual({ skip: "cancelling" });
    expect(nudgeDue(trial({ cancelAt: inHours(500) }), NOW)).toEqual({ skip: "cancelling" });
    expect(nudgeDue(trial({ status: "canceled" }), NOW)).toEqual({ skip: "not_trialing" });
    expect(nudgeDue(trial({ status: "active" }), NOW)).toEqual({ skip: "not_trialing" });
    expect(nudgeDue(trial({ userId: null }), NOW)).toEqual({ skip: "no_user" });
    expect(nudgeDue(trial({ createdAt: null }), NOW)).toEqual({ skip: "no_start" });
    // a 3-day trial on day 4: the reminder covers it
    expect(nudgeDue(trial({ createdAt: hoursAgo(80), trialEnd: inHours(40) }), NOW)).toEqual({ skip: "ending_soon" });
  });

  it("keys Resend's idempotency on the nudge and the subscription", () => {
    expect(nudgeIdempotencyKey("first_practice", trial())).toBe("first-practice/sub_1");
    expect(nudgeIdempotencyKey("trial_progress", trial())).toBe("trial-progress/sub_1");
  });
});

describe("runTrialNudges", () => {
  it("sends the first-practice nudge once, to the payer, when nobody has practiced", async () => {
    const deps = fakeDeps({ now: NOW, nudgeTrials: [trial()], activity: { [USER]: quietFamily(USER, { displayName: "Maya", onboardedAt: hoursAgo(31) }) } });
    const first = await runTrialNudges(deps, testEnv(), { dryRun: false }, silentLog());
    expect(first).toMatchObject({ found: 1, due: { firstPractice: 1, trialProgress: 0 }, sent: 1, failed: 0 });
    expect(deps.sent).toHaveLength(1);
    expect(deps.sent[0]).toMatchObject({ to: "parent@example.com", subject: "Maya's first practice is ready: 5 problems, about 10 minutes", idempotencyKey: "first-practice/sub_1", tags: { kind: "first_practice" } });
    expect(deps.log.rows).toMatchObject([{ user_id: USER, kind: "first_practice", ref: "sub_1" }]);
    // asked for the family's activity from well before the trial
    expect(deps.readFamilyActivity).toHaveBeenCalledWith(USER, new Date(Date.parse(hoursAgo(30)) - 30 * 24 * HOUR));

    const again = await runTrialNudges(deps, testEnv(), { dryRun: false }, silentLog());
    expect(again).toMatchObject({ sent: 0, alreadySent: 1 });
    expect(deps.send).toHaveBeenCalledTimes(1);
  });

  it("does not nudge a family that already practiced, and names the kid when there is one", async () => {
    const practiced = fakeDeps({ now: NOW, nudgeTrials: [trial()], activity: { [USER]: busyFamily() } });
    expect(await runTrialNudges(practiced, testEnv(), { dryRun: false }, silentLog())).toMatchObject({ sent: 0, skipped: { practicing: 1 } });
    const fam = busyFamily();
    fam.learners[1].attempts = [];
    fam.learners[1].practice = [];
    const quietKid = fakeDeps({ now: NOW, nudgeTrials: [trial()], activity: { [USER]: fam } });
    await runTrialNudges(quietKid, testEnv(), { dryRun: false }, silentLog());
    expect(quietKid.sent[0].subject).toBe("Leo's first practice is ready: 5 problems, about 10 minutes");
  });

  it("sends the progress email around day 4 with what the kid did, and skips a quiet family", async () => {
    const row = trial({ createdAt: hoursAgo(80), trialEnd: inHours(88) });
    const deps = fakeDeps({ now: NOW, nudgeTrials: [row], activity: { [USER]: busyFamily() } });
    expect(await runTrialNudges(deps, testEnv(), { dryRun: false }, silentLog())).toMatchObject({ due: { trialProgress: 1 }, sent: 1 });
    expect(deps.sent[0].subject).toBe("Leo's first days on Agathon");
    expect(deps.sent[0].text).toContain("- Leo: 2 problems solved, 1 without help. Practiced: Times tables. Today's practice: done on 1 day.");
    expect(deps.sent[0].tags).toEqual({ kind: "trial_progress" });

    const quiet = fakeDeps({ now: NOW, nudgeTrials: [row] });
    expect(await runTrialNudges(quiet, testEnv(), { dryRun: false }, silentLog())).toMatchObject({ sent: 0, skipped: { quiet: 1 } });
  });

  it("never reaches a kid address, a trial set to cancel, or one ending soon", async () => {
    const deps = fakeDeps({
      now: NOW,
      nudgeTrials: [
        trial({ subscriptionId: "sub_kid", payerEmail: "kid-1@kids.agathon.app" }),
        trial({ subscriptionId: "sub_cancel", cancelAtPeriodEnd: true }),
        trial({ subscriptionId: "sub_soon", createdAt: hoursAgo(80), trialEnd: inHours(30) }),
      ],
      emails: { [USER]: "kid-2@kids.agathon.app" },
    });
    const summary = await runTrialNudges(deps, testEnv(), { dryRun: false }, silentLog());
    expect(summary).toMatchObject({ found: 3, sent: 0, skipped: { noEmail: 1, cancelling: 1, endingSoon: 1 } });
    expect(deps.send).not.toHaveBeenCalled();
    expect(deps.log.rows).toEqual([]);
  });

  it("lists what it would send on a dry run, and sends nothing", async () => {
    const deps = fakeDeps({ now: NOW, nudgeTrials: [trial(), trial({ subscriptionId: "sub_2", createdAt: hoursAgo(80), trialEnd: inHours(88) })], activity: { [USER]: quietFamily(USER) } });
    const summary = await runTrialNudges(deps, testEnv(), { dryRun: true }, silentLog());
    expect(summary.wouldSend).toEqual(["first_practice:sub_1"]);
    expect(summary.skipped.quiet).toBe(1);
    expect(deps.send).not.toHaveBeenCalled();
  });

  it("counts one family's failure and carries on; releases a failed send so the next run retries", async () => {
    const deps = fakeDeps({
      now: NOW,
      nudgeTrials: [trial({ subscriptionId: "sub_a", userId: "a" }), trial({ subscriptionId: "sub_b", userId: "b" })],
      activity: { a: { error: "timeout" }, b: quietFamily("b") },
    });
    deps.sendReplies.push({ ok: false, error: "upstream", status: 500 });
    expect(await runTrialNudges(deps, testEnv(), { dryRun: false }, silentLog())).toMatchObject({ failed: 2, sent: 0 });
    expect(deps.log.rows).toEqual([]);
    expect(await runTrialNudges(deps, testEnv(), { dryRun: false }, silentLog())).toMatchObject({ failed: 1, sent: 1 });
  });

  it("stops at the per-run cap and throws only when the subscriptions or the log cannot be read", async () => {
    const many = Array.from({ length: 3 }, (_, i) => trial({ subscriptionId: `sub_${i}` }));
    const deps = fakeDeps({ now: NOW, nudgeTrials: many });
    expect(await runTrialNudges(deps, testEnv(), { dryRun: false, maxSends: 2 }, silentLog())).toMatchObject({ sent: 2, deferred: 1 });
    await expect(runTrialNudges(fakeDeps({ now: NOW, nudgeTrials: { error: "down" } }), testEnv(), { dryRun: false }, silentLog())).rejects.toThrow(/subscriptions/);
  });
});

describe("trialsStartedSince (the nudges' one query)", () => {
  it("asks for trialing rows with a user, started since, oldest first", async () => {
    const calls: unknown[][] = [];
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "not", "gte", "order", "limit"]) {
      b[m] = (...args: unknown[]) => {
        calls.push([m, ...args]);
        return b;
      };
    }
    b.then = (resolve: (v: unknown) => unknown) =>
      resolve({ data: [{ stripe_subscription_id: "sub_1", user_id: USER, status: "trialing", trial_end: inHours(100), cancel_at_period_end: false, cancel_at: null, payer_email: null, created_at: hoursAgo(30) }], error: null });
    const admin = { from: (t: string) => (calls.push(["from", t]), b) } as unknown as Pick<SupabaseClient, "from">;
    const since = new Date(hoursAgo(144));
    expect(await trialsStartedSince(admin, since)).toEqual([trial({ payerEmail: null, trialEnd: inHours(100) })]);
    expect(calls).toEqual([
      ["from", "unlimited_subscriptions"],
      ["select", "stripe_subscription_id,user_id,status,trial_end,cancel_at_period_end,cancel_at,payer_email,created_at"],
      ["eq", "status", "trialing"],
      ["not", "user_id", "is", null],
      ["gte", "created_at", since.toISOString()],
      ["order", "created_at", { ascending: true }],
      ["limit", NUDGE_QUERY_LIMIT],
    ]);
  });
});

describe("the trial reminder's progress", () => {
  const due = { subscriptionId: "sub_r", userId: USER, status: "trialing", trialEnd: inHours(60), cancelAtPeriodEnd: false, cancelAt: null, payerEmail: "parent@example.com" };

  it("says what the kids did, read since the trial started", async () => {
    const deps = fakeDeps({ now: NOW, trials: [due], activity: { [USER]: busyFamily() } });
    expect(await runTrialReminders(deps, testEnv(), { dryRun: false }, silentLog())).toMatchObject({ sent: 1 });
    expect(deps.sent[0].text).toContain("Here's what Leo has done so far:");
    expect(deps.readFamilyActivity).toHaveBeenCalledWith(USER, new Date(Date.parse(inHours(60)) - 7 * 24 * HOUR));
  });

  it("still goes, without it, when nothing was done or it cannot be read", async () => {
    const quiet = fakeDeps({ now: NOW, trials: [due] });
    await runTrialReminders(quiet, testEnv(), { dryRun: false }, silentLog());
    expect(quiet.sent[0].text).not.toContain("so far");
    const broken = fakeDeps({ now: NOW, trials: [due], activity: { [USER]: { error: "down" } } });
    expect(await runTrialReminders(broken, testEnv(), { dryRun: false }, silentLog())).toMatchObject({ sent: 1, failed: 0 });
  });
});
