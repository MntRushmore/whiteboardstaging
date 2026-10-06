/**
 * The admin page's money (src/lib/server/adminOverview.ts moneyOverview / funnelCounts, and the page's
 * words for it in src/lib/admin/view.ts): Stripe's statuses counted the way the owner reads them,
 * admins' own subscriptions left out.
 */
import { describe, expect, it } from "vitest";
import { AdminOverviewSchema } from "@/lib/admin/contracts";
import { formatDollars, funnelLine, moneyTiles, upcomingDays } from "@/lib/admin/view";
import { buildAdminOverview, funnelCounts, moneyOverview, resetOverviewCaches, UPCOMING_DAYS, type SubscriptionRow } from "@/lib/server/adminOverview";
import { adminTables, EMAILS, NOW } from "./fixtures/adminTables";
import { fakeSupabase } from "./fixtures/fakeSupabase";

const DAY = 24 * 60 * 60_000;
const at = (days: number) => new Date(NOW + days * DAY).toISOString();
const ADMIN = "00000000-0000-4000-8000-00000000a0a0";

function sub(over: Partial<SubscriptionRow> = {}): SubscriptionRow {
  return { user_id: "u1", status: "trialing", trial_end: at(5), current_period_end: at(5), cancel_at_period_end: false, cancel_at: null, created_at: at(-2), ...over };
}

const SUBS: SubscriptionRow[] = [
  sub({ user_id: "u1" }), // trial, first charge in 5 days
  sub({ user_id: "u2", trial_end: at(1), current_period_end: at(1) }), // trial, first charge tomorrow
  sub({ user_id: "u3", cancel_at_period_end: true }), // trial set to cancel: no charge coming
  sub({ user_id: "u4", status: "active", trial_end: at(-20), current_period_end: at(10), created_at: at(-27) }), // paying, renews in 10
  sub({ user_id: "u5", status: "active", trial_end: at(-9), current_period_end: at(21), cancel_at: at(21), created_at: at(-16) }), // paying, set to cancel
  sub({ user_id: "u6", status: "past_due", trial_end: at(-1), current_period_end: at(29), created_at: at(-8) }), // first charge failing
  sub({ user_id: "u7", status: "canceled", trial_end: at(-3), current_period_end: at(-3), created_at: at(-10) }), // cancelled in trial
  sub({ user_id: ADMIN, status: "active", trial_end: at(-1), current_period_end: at(2), created_at: at(-8) }), // the owner's own: left out
];

describe("moneyOverview", () => {
  const money = moneyOverview(SUBS, new Set([ADMIN]), NOW, 25);

  it("counts paying plans, trials and what each is worth a month, leaving admins out", () => {
    expect(money).toMatchObject({
      priceUsd: 25,
      paying: 2,
      payingCancelling: 1,
      mrrUsd: 25, // u4 only: u5 is set to cancel
      trialing: 3,
      trialsCancelling: 1,
      pipelineUsd: 50, // u1 and u2
      failing: 1,
      ended: 1,
    });
  });

  it("trials that ended, and how many went on to pay", () => {
    // u4, u5 (paying), u6 (failing) and u7 (cancelled) are past their trial; u4 and u5 pay
    expect(money.trialsOver).toBe(4);
    expect(money.trialsConverted).toBe(2);
  });

  it("subscriptions started this week", () => {
    expect(money.started7d).toBe(3); // u1, u2, u3 (two days ago); the rest are older or the admin's
  });

  it("charges coming in the next 14 days, soonest first: first charges and renewals, never one set to cancel", () => {
    expect(money.upcoming).toEqual([
      { at: at(1), kind: "first", usd: 25 },
      { at: at(5), kind: "first", usd: 25 },
      { at: at(10), kind: "renewal", usd: 25 },
    ]);
    expect(UPCOMING_DAYS).toBe(14);
    const far = moneyOverview([sub({ trial_end: at(15) }), sub({ trial_end: at(-0.1) })], new Set(), NOW, 25);
    expect(far.upcoming).toEqual([]);
  });

  it("nothing at all: zeros, no charges", () => {
    expect(moneyOverview([], new Set(), NOW, 25)).toEqual({
      priceUsd: 25,
      paying: 0,
      payingCancelling: 0,
      mrrUsd: 0,
      trialing: 0,
      trialsCancelling: 0,
      pipelineUsd: 0,
      failing: 0,
      ended: 0,
      trialsOver: 0,
      trialsConverted: 0,
      started7d: 0,
      upcoming: [],
    });
  });
});

describe("funnelCounts", () => {
  it("distinct accounts that ever started a trial, and that pay now, admins left out", () => {
    const again = sub({ user_id: "u7", status: "trialing", created_at: at(-1) }); // u7 came back for a second plan
    expect(funnelCounts([...SUBS, again], new Set([ADMIN]))).toEqual({ trials: 7, paying: 2 });
  });
});

describe("the page's words for the money", () => {
  const clock = { now: NOW, timeZone: "America/New_York" };
  const money = moneyOverview(SUBS, new Set([ADMIN]), NOW, 25);

  it("six tiles: revenue, trials, what is due, trial → paid, sign-up → trial, losses", () => {
    expect(moneyTiles(money, 10, clock)).toEqual([
      { key: "mrr", value: "$25", label: "Monthly revenue", hint: "2 paying plans × $25, 1 set to cancel" },
      { key: "trials", value: "3", label: "In free trial", hint: "$50/month if they all pay; 1 set to cancel" },
      { key: "due", value: "$50", label: "Due in 7 days", hint: "2 charges, 2 of them first charges" },
      { key: "converted", value: "50%", label: "Trial → paid", hint: "2 of 4 ended trials" },
      { key: "signupToTrial", value: "30%", label: "Sign-up → trial", hint: "3 trials from 10 sign-ups this week" },
      { key: "lost", value: "2", label: "Cancelled or failing", hint: "1 cancelled, 1 with a failing charge" },
    ]);
  });

  it("before any money: says so plainly", () => {
    const tiles = moneyTiles(moneyOverview([], new Set(), NOW, 25), 0, clock);
    expect(tiles.map((t) => [t.value, t.hint])).toEqual([
      ["$0", "Nobody paying yet"],
      ["0", "No trials right now"],
      ["$0", "No charges due"],
      ["—", "No trial has ended yet"],
      ["—", "0 trials from 0 sign-ups this week"],
      ["0", "0 cancelled, 0 with a failing charge"],
    ]);
  });

  it("the next 14 days, a row per day in the reader's zone", () => {
    expect(upcomingDays(money, clock)).toEqual([
      { key: "2026-10-06", day: "Tomorrow", what: "1 first charge", amount: "$25" },
      { key: "2026-10-10", day: "Sat, Oct 10", what: "1 first charge", amount: "$25" },
      { key: "2026-10-15", day: "Thu, Oct 15", what: "1 renewal", amount: "$25" },
    ]);
  });

  it("whole dollars without cents", () => {
    expect(formatDollars(25)).toBe("$25");
    expect(formatDollars(1250)).toBe("$1,250");
    expect(formatDollars(12.5)).toBe("$12.50");
  });

  it("the funnel in one line", () => {
    expect(funnelLine({ accounts: 80, onboarded: 59, trials: 8, paying: 0 })).toBe("80 accounts → 59 finished the welcome → 8 started a trial → 0 paying");
  });
});

describe("buildAdminOverview reads the subscriptions and admins", () => {
  it("money and the funnel, in the contract's shape", async () => {
    resetOverviewCaches();
    const tables = adminTables();
    tables.unlimited_subscriptions = SUBS.map((s, i) => ({ id: i + 1, ...s }));
    tables.admins = [{ user_id: ADMIN }];
    const db = fakeSupabase(tables, { users: EMAILS });
    const overview = await buildAdminOverview({ url: "https://proj.supabase.co", serviceKey: "service-key", fetch: db.fetch, now: NOW });
    expect(AdminOverviewSchema.safeParse(overview).success).toBe(true);
    expect(overview.money).toEqual(moneyOverview(SUBS, new Set([ADMIN]), NOW));
    expect(overview.funnel).toMatchObject({ accounts: 20, trials: 7, paying: 2 });
    expect(overview.funnel.onboarded).toBeGreaterThanOrEqual(0);
  });
});
