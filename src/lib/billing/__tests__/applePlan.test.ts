/**
 * An Agathon Unlimited plan bought in the iPad app (provider 'apple'), everywhere the web and the
 * server read plans: the plan summary keeps its provider; deleting the account is never blocked by an
 * Apple plan (we cannot cancel it) but the dialog says to cancel it in Settings; the trial reminder
 * says Apple charges it and how to cancel on the iPad, with Apple's page and never Stripe's; Apple
 * confirms its own subscriptions (no "has started" email from us); the nudges link Apple's page; the
 * admin's money counts Apple plans and leaves App Review's and TestFlight's Sandbox plans out.
 */
import { describe, expect, it } from "vitest";
import { APPLE_MANAGE_SUBSCRIPTIONS_URL, APPLE_PLAN, AppleTransactionBodySchema } from "@/lib/billing/apple";
import { assertNoChargingPlan, planBlocksDeletion, PlanStillActiveError, type DeleteAccountClient } from "@/lib/billing/deleteAccount";
import { appleCancelFirst, mustCancelBeforeDeleting, parseUnlimitedState, UNLIMITED_PLAN } from "@/lib/billing/unlimited";
import { renderNudge, type NudgeTrialRow } from "@/lib/email/nudges";
import { formatApplePrice, trialReminderEmail } from "@/lib/email/templates";
import { manageUrlFor, runTrialReminders, toTrialRow } from "@/lib/email/trialReminders";
import { runStartedSweep, startedSkipReason, type StartedRow } from "@/lib/email/unlimitedStarted";
import { moneyOverview, type SubscriptionRow } from "@/lib/server/adminOverview";
import { fakeDeps, PORTAL, quietFamily, silentLog, testEnv } from "@/lib/email/__tests__/fakes";

const NOW = new Date("2026-10-17T12:00:00Z");
const DAY = 86_400_000;
const USER = "11111111-2222-4333-8444-555555555555";

describe("the plan summary keeps where the plan is billed", () => {
  it("reads provider apple / stripe, and nothing for an older database", () => {
    const base = { status: "trialing", unlimited: true, trial_end: "2026-10-24T12:00:00Z", current_period_end: "2026-10-24T12:00:00Z", cancel_at_period_end: false };
    expect(parseUnlimitedState({ ...base, provider: "apple" }).provider).toBe("apple");
    expect(parseUnlimitedState({ ...base, provider: "stripe" }).provider).toBe("stripe");
    expect(parseUnlimitedState(base)).not.toHaveProperty("provider");
    expect(parseUnlimitedState({ ...base, provider: "paypal" })).not.toHaveProperty("provider");
  });
});

describe("deleting an account with an Apple plan", () => {
  const apple = { status: "active" as const, cancelAtPeriodEnd: false, provider: "apple" as const };

  it("is not blocked (only the person can cancel it, in Settings), but they are told to cancel it first", () => {
    expect(mustCancelBeforeDeleting(apple)).toBe(false);
    expect(appleCancelFirst(apple)).toBe(true);
    expect(appleCancelFirst({ ...apple, status: "trialing" })).toBe(true);
    expect(appleCancelFirst({ ...apple, cancelAtPeriodEnd: true })).toBe(false);
    expect(appleCancelFirst({ ...apple, status: "canceled" })).toBe(false);
    // a Stripe plan still blocks, as before
    expect(mustCancelBeforeDeleting({ ...apple, provider: "stripe" })).toBe(true);
    expect(mustCancelBeforeDeleting({ status: "active", cancelAtPeriodEnd: false })).toBe(true);
  });

  it("the client-side check skips Apple rows and still refuses a charging Stripe row", () => {
    expect(planBlocksDeletion([{ status: "active", cancel_at_period_end: false, cancel_at: null, provider: "apple" }])).toBe(false);
    expect(planBlocksDeletion([{ status: "trialing", cancel_at_period_end: false, cancel_at: null, provider: "stripe" }])).toBe(true);
    expect(planBlocksDeletion([{ status: "trialing", cancel_at_period_end: false, cancel_at: null }])).toBe(true);
  });

  it("reads `provider`, and falls back without it on a database before the Apple migration", async () => {
    const selects: string[] = [];
    const client = (answers: Array<{ data: Array<Record<string, unknown>> | null; error: { message: string } | null }>) =>
      ({
        from: () => ({
          select: (columns: string) => {
            selects.push(columns);
            return Promise.resolve(answers.shift()!);
          },
        }),
      }) as unknown as DeleteAccountClient;
    await expect(assertNoChargingPlan(client([{ data: [{ status: "active", cancel_at_period_end: false, cancel_at: null, provider: "apple" }], error: null }]))).resolves.toBeUndefined();
    expect(selects).toEqual(["status,cancel_at_period_end,cancel_at,provider"]);
    selects.length = 0;
    await expect(
      assertNoChargingPlan(
        client([
          { data: null, error: { message: "column unlimited_subscriptions.provider does not exist" } },
          { data: [{ status: "active", cancel_at_period_end: false, cancel_at: null }], error: null },
        ]),
      ),
    ).rejects.toBeInstanceOf(PlanStillActiveError);
    expect(selects).toEqual(["status,cancel_at_period_end,cancel_at,provider", "status,cancel_at_period_end,cancel_at"]);
  });
});

describe("the free trial's reminder for an Apple plan", () => {
  const input = { trialEnd: new Date(NOW.getTime() + 2 * DAY), manageUrl: APPLE_MANAGE_SUBSCRIPTIONS_URL, siteUrl: "https://agathon.app", planName: UNLIMITED_PLAN.name, monthlyUsd: UNLIMITED_PLAN.monthlyUsd, timeZone: "America/New_York" };

  it("says Apple charges the Apple Account, in Apple's price, and how to cancel on the iPad; no Stripe link, no card", () => {
    const email = trialReminderEmail({ ...input, apple: { price: "$24.99" } });
    expect(email.subject).toBe("Your free trial of Agathon Unlimited ends on Monday, October 19");
    expect(email.text).toContain("Apple will charge $24.99 for Agathon Unlimited to the payment method on your Apple Account");
    expect(email.text).toContain("open Settings on your iPad, tap your name, then Subscriptions, and choose Agathon");
    expect(email.text).toContain(`Manage subscriptions: ${APPLE_MANAGE_SUBSCRIPTIONS_URL}`);
    expect(email.html).toContain(APPLE_MANAGE_SUBSCRIPTIONS_URL);
    for (const out of [email.text, email.html]) {
      expect(out).not.toMatch(/stripe|your card will be charged|\$25\b/i);
    }
  });

  it("names no amount when Apple has not said one, rather than guess", () => {
    const email = trialReminderEmail({ ...input, apple: { price: null } });
    expect(email.text).toContain("Apple will charge the monthly price you agreed to in the App Store");
    expect(email.text).not.toMatch(/\$\d/);
  });

  it("formats Apple's price in the buyer's currency, from milliunits", () => {
    expect(formatApplePrice(24990, "USD")).toBe("$24.99");
    expect(formatApplePrice(29990, "EUR")).toBe("€29.99");
    expect(formatApplePrice(0, "USD")).toBeNull();
    expect(formatApplePrice(24990, null)).toBeNull();
    expect(formatApplePrice(24990, "usd")).toBeNull();
  });

  it("reads an Apple row's price, and leaves a Stripe row's shape as it was", () => {
    const raw = { stripe_subscription_id: "apple:2000000001", user_id: USER, status: "trialing", trial_end: "2026-10-19T12:00:00Z", cancel_at_period_end: false, cancel_at: null, payer_email: null };
    expect(toTrialRow({ ...raw, provider: "apple", apple_price_milliunits: 24990, apple_currency: "USD" })).toMatchObject({ provider: "apple", applePrice: "$24.99" });
    expect(toTrialRow({ ...raw, provider: "apple", apple_price_milliunits: "24990", apple_currency: "USD" })).toMatchObject({ applePrice: "$24.99" });
    const stripe = toTrialRow({ ...raw, stripe_subscription_id: "sub_1", provider: "stripe" });
    expect(stripe).not.toHaveProperty("provider");
    expect(manageUrlFor({ provider: "apple" }, testEnv())).toBe(APPLE_MANAGE_SUBSCRIPTIONS_URL);
    expect(manageUrlFor({}, testEnv())).toBe(PORTAL);
  });

  it("goes to the family's grown-up (the account; Apple gives no payer email), worded for Apple", async () => {
    const deps = fakeDeps({
      now: NOW,
      trials: [{ subscriptionId: "apple:2000000001", userId: USER, status: "trialing", trialEnd: new Date(NOW.getTime() + 2 * DAY).toISOString(), cancelAtPeriodEnd: false, cancelAt: null, payerEmail: null, provider: "apple", applePrice: "$24.99" }],
      emails: { [USER]: "parent@example.com" },
    });
    const summary = await runTrialReminders(deps, testEnv(), { dryRun: false }, silentLog());
    expect(summary.sent).toBe(1);
    expect(deps.sent[0].to).toBe("parent@example.com");
    expect(deps.sent[0].text).toContain("Apple will charge $24.99");
    expect(deps.sent[0].text).not.toContain(PORTAL);
  });
});

describe("Apple confirms its own subscriptions", () => {
  const row: StartedRow = { subscriptionId: "apple:2000000001", userId: USER, status: "trialing", trialEnd: new Date(NOW.getTime() + 6 * DAY).toISOString(), cancelAtPeriodEnd: false, cancelAt: null, payerEmail: null, repeat: false, provider: "apple" };

  it("no 'has started' email for an Apple plan (Apple's subscription confirmation is it)", async () => {
    expect(startedSkipReason(row, NOW)).toBe("apple");
    const { provider: _drop, ...stripe } = row;
    void _drop;
    expect(startedSkipReason({ ...stripe, subscriptionId: "sub_1" }, NOW)).toBeNull();
    const deps = fakeDeps({ now: NOW, trials: [{ ...row, provider: "apple", applePrice: null }] });
    const sweep = await runStartedSweep(deps, { dryRun: true }, silentLog());
    expect(sweep).toMatchObject({ found: 1, skipped: 1, wouldSend: [] });
  });
});

describe("the trial's nudges for an Apple plan", () => {
  it("link Apple's page to stop, never Stripe's", () => {
    const row: NudgeTrialRow = { subscriptionId: "apple:1", userId: USER, status: "trialing", trialEnd: new Date(NOW.getTime() + 6 * DAY).toISOString(), cancelAtPeriodEnd: false, cancelAt: null, payerEmail: null, provider: "apple", createdAt: new Date(NOW.getTime() - DAY).toISOString() };
    const out = renderNudge("first_practice", row, quietFamily(USER), testEnv(), NOW);
    expect("email" in out && out.email.html).toContain(APPLE_MANAGE_SUBSCRIPTIONS_URL);
    expect("email" in out && out.email.html).not.toContain(PORTAL);
  });
});

describe("the admin's money", () => {
  const sub = (over: Partial<SubscriptionRow>): SubscriptionRow => ({
    user_id: crypto.randomUUID(),
    status: "active",
    trial_end: null,
    current_period_end: new Date(NOW.getTime() + 20 * DAY).toISOString(),
    cancel_at_period_end: false,
    cancel_at: null,
    created_at: new Date(NOW.getTime() - 40 * DAY).toISOString(),
    ...over,
  });

  it("counts Apple plans as revenue, says how many, and leaves App Review's and TestFlight's Sandbox plans out", () => {
    const money = moneyOverview(
      [
        sub({ provider: "stripe", livemode: true }),
        sub({ provider: "apple", livemode: true }),
        sub({ provider: "apple", livemode: true, status: "trialing", trial_end: new Date(NOW.getTime() + 3 * DAY).toISOString() }),
        sub({ provider: "apple", livemode: false }), // a reviewer's Sandbox purchase
        sub({ provider: "apple", livemode: false, status: "trialing" }), // TestFlight
      ],
      new Set(),
      NOW.getTime(),
    );
    expect(money).toMatchObject({ paying: 2, mrrUsd: 2 * UNLIMITED_PLAN.monthlyUsd, trialing: 1, apple: { paying: 1, trialing: 1 } });
  });

  it("says nothing of Apple when there are no Apple plans (the overview's shape is unchanged)", () => {
    expect(moneyOverview([sub({})], new Set(), NOW.getTime())).not.toHaveProperty("apple");
  });
});

describe("the contract", () => {
  it("the app posts a transaction JWS, and optionally its renewal info, nothing else", () => {
    const jws = "eyJhbGciOiJFUzI1NiJ9.eyJhIjoxfQ.c2ln";
    expect(AppleTransactionBodySchema.safeParse({ transaction: jws }).success).toBe(true);
    expect(AppleTransactionBodySchema.safeParse({ transaction: jws, renewalInfo: jws }).success).toBe(true);
    expect(AppleTransactionBodySchema.safeParse({ transaction: jws, userId: USER }).success).toBe(false);
    expect(AppleTransactionBodySchema.safeParse({ transaction: "x" }).success).toBe(false);
    expect(APPLE_PLAN.productId).toBe("app.agathon.unlimited.monthly");
    expect(APPLE_PLAN.trialDays).toBe(7);
  });
});
