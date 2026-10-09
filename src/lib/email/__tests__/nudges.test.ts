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
  type NudgeKind,
  type NudgeTrialRow,
} from "@/lib/email/nudges";
import { UNLIMITED_PLAN } from "@/lib/billing/unlimited";
import { TRIAL_REMINDER_WINDOW, runTrialReminders } from "@/lib/email/trialReminders";
import { fakeDeps, quietFamily, silentLog, testEnv } from "./fakes";

const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-10-09T15:00:00Z");
const USER = "11111111-2222-4333-8444-555555555555";
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * HOUR).toISOString();
const inHours = (h: number) => new Date(NOW.getTime() + h * HOUR).toISOString();

/** The trial is 7 days: the row is made at the checkout, and the trial ends 168 hours later. */
const TRIAL_HOURS = 7 * 24;

function trial(over: Partial<NudgeTrialRow> = {}): NudgeTrialRow {
  return {
    subscriptionId: "sub_1",
    userId: USER,
    status: "trialing",
    trialEnd: inHours(TRIAL_HOURS - 30),
    cancelAtPeriodEnd: false,
    cancelAt: null,
    payerEmail: "parent@example.com",
    createdAt: hoursAgo(30),
    ...over,
  };
}

/** A real 7-day trial `age` hours old (its row made at the checkout, its end 168 hours after). */
function trialAged(age: number, over: Partial<NudgeTrialRow> = {}): NudgeTrialRow {
  return trial({ createdAt: hoursAgo(age), trialEnd: inHours(TRIAL_HOURS - age), ...over });
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
  it("on a 7-day trial: first practice from 18 to 44 hours in, progress from 44 until 72 hours are left", () => {
    expect(UNLIMITED_PLAN.trialDays).toBe(7);
    expect(nudgeDue(trialAged(17.9), NOW)).toEqual({ skip: "outside_window" });
    expect(nudgeDue(trialAged(18), NOW)).toEqual({ kind: "first_practice" });
    expect(nudgeDue(trialAged(43.9), NOW)).toEqual({ kind: "first_practice" });
    expect(nudgeDue(trialAged(44), NOW)).toEqual({ kind: "trial_progress" });
    expect(nudgeDue(trialAged(95), NOW)).toEqual({ kind: "trial_progress" });
    // 72 hours left: the "trial ends" reminder's turn, with the same summary
    expect(nudgeDue(trialAged(96.1), NOW)).toEqual({ skip: "ending_soon" });
    expect(nudgeDue(trialAged(97), NOW)).toEqual({ skip: "ending_soon" });
    // the row made a few minutes after Stripe started the trial: the window still ends at 72 hours left
    expect(nudgeDue(trial({ createdAt: hoursAgo(95.9), trialEnd: inHours(72.05) }), NOW)).toEqual({ kind: "trial_progress" });
    expect(nudgeDue(trialAged(120), NOW)).toEqual({ skip: "outside_window" });
  });

  it("puts every 7-day trial in the progress window on two daily runs, and in first practice on one, whatever the cron's jitter", () => {
    // Vercel Hobby fires a daily cron anywhere in its hour: runs at 15:00 + up to 59 minutes, 23 to 25 hours apart.
    const MIN = 60_000;
    const jitters: Array<(day: number) => number> = [
      () => 0,
      () => 59,
      (d) => (d % 2 ? 59 : 0),
      (d) => (d % 2 ? 0 : 59),
      (d) => (d * 37) % 60,
    ];
    const firstRun = Date.parse("2026-10-01T15:00:00Z");
    for (const jitter of jitters) {
      for (const delayMin of [0, 5, 60]) {
        // a trial started at every 10 minutes of a day
        for (let offset = 0; offset < 24 * 60; offset += 10) {
          const stripeStart = firstRun + offset * MIN;
          const row = trial({ createdAt: new Date(stripeStart + delayMin * MIN).toISOString(), trialEnd: new Date(stripeStart + TRIAL_HOURS * HOUR).toISOString() });
          const seen: Record<NudgeKind, number> = { first_practice: 0, trial_progress: 0 };
          for (let day = 0; day <= 8; day++) {
            const run = new Date(firstRun + day * 24 * HOUR + jitter(day) * MIN);
            const due = nudgeDue(row, run);
            if (!("kind" in due)) continue;
            seen[due.kind]++;
            // never on the same run as the "trial ends" reminder
            const left = Date.parse(row.trialEnd!) - run.getTime();
            expect(left >= TRIAL_REMINDER_WINDOW.fromMs && left < TRIAL_REMINDER_WINDOW.toMs).toBe(false);
          }
          expect(seen.first_practice, `start +${offset} min, delay ${delayMin} min`).toBeGreaterThanOrEqual(1);
          expect(seen.trial_progress, `start +${offset} min, delay ${delayMin} min`).toBeGreaterThanOrEqual(2);
        }
      }
    }
  });

  it("sends nothing to a trial set to cancel, ended, unlinked, undated, or ending within 72 hours", () => {
    expect(nudgeDue(trial({ cancelAtPeriodEnd: true }), NOW)).toEqual({ skip: "cancelling" });
    expect(nudgeDue(trial({ cancelAt: inHours(500) }), NOW)).toEqual({ skip: "cancelling" });
    expect(nudgeDue(trial({ status: "canceled" }), NOW)).toEqual({ skip: "not_trialing" });
    expect(nudgeDue(trial({ status: "active" }), NOW)).toEqual({ skip: "not_trialing" });
    expect(nudgeDue(trial({ userId: null }), NOW)).toEqual({ skip: "no_user" });
    expect(nudgeDue(trial({ createdAt: null }), NOW)).toEqual({ skip: "no_start" });
    // a 3-day trial on day 3: the reminder covers it
    expect(nudgeDue(trial({ createdAt: hoursAgo(50), trialEnd: inHours(22) }), NOW)).toEqual({ skip: "ending_soon" });
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

  it("sends the progress email on day 2 to 4 with what the kid did, and skips a quiet family", async () => {
    const row = trialAged(80);
    const deps = fakeDeps({ now: NOW, nudgeTrials: [row], activity: { [USER]: busyFamily() } });
    expect(await runTrialNudges(deps, testEnv(), { dryRun: false }, silentLog())).toMatchObject({ due: { trialProgress: 1 }, sent: 1 });
    expect(deps.sent[0].subject).toBe("Leo's first days on Agathon");
    expect(deps.sent[0].text).toContain("- Leo: 2 problems solved, 1 without help. Practiced: Times tables. Today's practice: done on 1 day.");
    expect(deps.sent[0].tags).toEqual({ kind: "trial_progress" });

    const quiet = fakeDeps({ now: NOW, nudgeTrials: [row] });
    expect(await runTrialNudges(quiet, testEnv(), { dryRun: false }, silentLog())).toMatchObject({ sent: 0, skipped: { quiet: 1 } });
  });

  it("tells a family whose student practises on the grown-up's login what she did, though a kid profile has not started", async () => {
    // Priya uses the account itself; Leo was added as a kid profile and has done nothing yet
    const fam = busyFamily();
    fam.learners[0].attempts = fam.learners[1].attempts;
    fam.learners[0].practice = fam.learners[1].practice;
    fam.learners[1].attempts = [];
    fam.learners[1].practice = [];
    // first practice: someone has practiced, so no nudge
    const early = fakeDeps({ now: NOW, nudgeTrials: [trialAged(30)], activity: { [USER]: fam } });
    expect(await runTrialNudges(early, testEnv(), { dryRun: false }, silentLog())).toMatchObject({ sent: 0, skipped: { practicing: 1 } });
    // progress: what Priya did, rather than "quiet"
    const later = fakeDeps({ now: NOW, nudgeTrials: [trialAged(80)], activity: { [USER]: fam } });
    expect(await runTrialNudges(later, testEnv(), { dryRun: false }, silentLog())).toMatchObject({ sent: 1, skipped: { quiet: 0 } });
    expect(later.sent[0].text).toContain("- Priya: 2 problems solved, 1 without help. Practiced: Times tables. Today's practice: done on 1 day.");
    // and the "trial ends" reminder carries it too
    const reminder = fakeDeps({
      now: NOW,
      trials: [{ subscriptionId: "sub_r", userId: USER, status: "trialing", trialEnd: inHours(60), cancelAtPeriodEnd: false, cancelAt: null, payerEmail: "parent@example.com" }],
      activity: { [USER]: fam },
    });
    expect(await runTrialReminders(reminder, testEnv(), { dryRun: false }, silentLog())).toMatchObject({ sent: 1 });
    expect(reminder.sent[0].text).toContain("Here's what Priya has done so far:");
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
    const deps = fakeDeps({ now: NOW, nudgeTrials: [trial(), trialAged(80, { subscriptionId: "sub_2" })], activity: { [USER]: quietFamily(USER) } });
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

  it("retries a failed or deferred progress email on the next day's run of a 7-day trial", async () => {
    const DAY = 24 * HOUR;
    const failed = trialAged(50, { subscriptionId: "sub_fail" });
    const deferred = trialAged(51, { subscriptionId: "sub_cap", userId: "b" });
    const deps = fakeDeps({ now: NOW, nudgeTrials: [failed, deferred], activity: { [USER]: busyFamily(), b: busyFamily("b") } });
    deps.sendReplies.push({ ok: false, error: "upstream", status: 500 });
    expect(await runTrialNudges(deps, testEnv(), { dryRun: false, maxSends: 1 }, silentLog())).toMatchObject({ due: { trialProgress: 2 }, failed: 1, deferred: 1, sent: 0 });
    expect(deps.log.rows).toEqual([]);

    // the next day (25 hours later: the cron's latest): both still inside the window, both sent once
    deps.now = () => new Date(NOW.getTime() + DAY + HOUR);
    expect(await runTrialNudges(deps, testEnv(), { dryRun: false }, silentLog())).toMatchObject({ due: { trialProgress: 2 }, sent: 2, failed: 0 });
    expect(deps.sent.map((m) => m.idempotencyKey)).toEqual(["trial-progress/sub_fail", "trial-progress/sub_cap"]);

    // the day after: past 72 hours left, the reminder's turn, and nothing is sent twice
    deps.now = () => new Date(NOW.getTime() + 2 * DAY);
    expect(await runTrialNudges(deps, testEnv(), { dryRun: false }, silentLog())).toMatchObject({ due: { trialProgress: 0 }, skipped: { endingSoon: 2 }, sent: 0 });
    expect(deps.send).toHaveBeenCalledTimes(3);
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
