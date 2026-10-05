import { describe, expect, it } from "vitest";
import { NO_UNLIMITED, type UnlimitedState } from "@/lib/billing/unlimited";
import { PLAN_COPY, billingFacts, planDate, unlimitedPlanView } from "@/lib/billing/unlimitedPlan";

const NOW = new Date("2026-10-03T15:00:00Z");
const TZ = "America/Chicago";
const view = (state: Partial<UnlimitedState>) => unlimitedPlanView({ ...NO_UNLIMITED, ...state }, { now: NOW, timeZone: TZ });

describe("planDate", () => {
  it("is a long date in the reader's time zone, or null", () => {
    expect(planDate("2026-10-10T15:00:00Z", TZ)).toBe("Saturday, October 10");
    // just after midnight UTC is still the evening before in Chicago
    expect(planDate("2026-10-11T02:00:00Z", TZ)).toBe("Saturday, October 10");
    expect(planDate(null)).toBeNull();
    expect(planDate("nope")).toBeNull();
  });
});

describe("unlimitedPlanView", () => {
  it("offers the free week to someone without the plan, saying when the first charge would be", () => {
    expect(view({})).toEqual({
      kind: "offer",
      badge: null,
      headline: "Agathon is Agathon Unlimited: $25 a month, and your first 7 days are free. Cancel any time.",
      detail: "A grown-up's card is needed at checkout. Nothing is charged until Saturday, October 10.",
      action: "start",
      actionLabel: "Start the free week",
    });
  });

  it("the free week: when it ends and what happens then", () => {
    expect(view({ status: "trialing", trialEnd: "2026-10-10T15:00:00Z", currentPeriodEnd: "2026-10-10T15:00:00Z" })).toMatchObject({
      kind: "trialing",
      badge: "Free week",
      headline: "Your free week ends on Saturday, October 10.",
      detail: "Then $25 a month, starting that day, until you cancel. Help uses no ink meanwhile.",
      action: "manage",
      actionLabel: "Manage or cancel",
    });
  });

  it("a free week set to cancel: no charge", () => {
    expect(view({ status: "trialing", trialEnd: "2026-10-10T15:00:00Z", currentPeriodEnd: "2026-10-10T15:00:00Z", cancelAtPeriodEnd: true })).toMatchObject({
      kind: "ending",
      headline: "Your free week ends on Saturday, October 10, and your plan ends with it.",
      detail: "You won't be charged. Until then, help uses no ink.",
      action: "manage",
    });
  });

  it("a second plan's free week: it starts with the first charge, and help uses ink until then", () => {
    expect(view({ status: "repeat_trial", trialEnd: "2026-10-10T15:00:00Z", currentPeriodEnd: "2026-10-10T15:00:00Z" })).toEqual({
      kind: "repeat_trial",
      badge: "Starting",
      headline: "Your plan starts on Saturday, October 10, with the first $25 charge.",
      detail: "The free week is for a first plan only, so help uses ink until then. Cancel before that day and you won't be charged.",
      action: "manage",
      actionLabel: "Manage or cancel",
    });
    expect(view({ status: "repeat_trial", trialEnd: "2026-10-10T15:00:00Z", cancelAtPeriodEnd: true })).toMatchObject({
      kind: "ending",
      detail: "You won't be charged. Help uses ink meanwhile.",
      action: "manage",
    });
    expect(view({ status: "repeat_trial" }).headline).toBe("Your plan starts with the first $25 charge.");
  });

  it("a paid month: the next charge; set to cancel: the day it ends", () => {
    expect(view({ status: "active", currentPeriodEnd: "2026-11-10T15:00:00Z" })).toMatchObject({
      kind: "active",
      badge: "Active",
      headline: "Next charge: $25 on Tuesday, November 10.",
      action: "manage",
    });
    expect(view({ status: "active", currentPeriodEnd: "2026-11-10T15:00:00Z", cancelAtPeriodEnd: true })).toMatchObject({
      kind: "ending",
      headline: "Your plan ends on Tuesday, November 10.",
      detail: "You won't be charged again. Until then, help uses no ink.",
    });
  });

  it("a failed payment: fix the card; help spends ink until then", () => {
    expect(view({ status: "past_due" })).toMatchObject({
      kind: "past_due",
      headline: "Your last payment didn't go through.",
      detail: "Update your card to keep Unlimited. Until then, help uses your ink.",
      action: "fix-payment",
      actionLabel: "Update your card",
    });
  });

  it("being set up: check again", () => {
    expect(view({ status: "incomplete" })).toMatchObject({ kind: "pending", action: "refresh", actionLabel: PLAN_COPY.refresh });
  });

  it("an ended plan says so and offers it again: without it the app is closed", () => {
    expect(view({ status: "canceled", currentPeriodEnd: "2026-10-10T15:00:00Z" })).toMatchObject({
      kind: "ended",
      headline: "Your plan ended on Saturday, October 10.",
      action: "start",
      actionLabel: "Start Unlimited again",
    });
    expect(view({ status: "canceled" }).detail).toMatch(/^Start it again to keep using Agathon\./);
    expect(view({ status: "canceled" }).headline).toBe("Your plan has ended.");
  });

  it("dates that are missing still read as sentences", () => {
    expect(view({ status: "trialing" }).headline).toBe("Your free week is on.");
    expect(view({ status: "active" }).headline).toBe("$25 a month until you cancel.");
  });

  it("never shouts and never says wrong", () => {
    const states: Array<Partial<UnlimitedState>> = [{}, { status: "trialing" }, { status: "repeat_trial" }, { status: "active" }, { status: "past_due" }, { status: "incomplete" }, { status: "canceled" }];
    for (const s of states) {
      const v = view(s);
      const text = [v.headline, v.detail, v.actionLabel, v.badge].join(" ");
      expect(text).not.toMatch(/!/);
      expect(text.toLowerCase()).not.toMatch(/\bwrong\b/);
    }
  });
});

describe("billingFacts", () => {
  const facts = (state: Partial<UnlimitedState>) =>
    Object.fromEntries(billingFacts({ ...NO_UNLIMITED, ...state }, { timeZone: TZ }).map((f) => [f.label, f.value]));

  it("says what the plan is and costs, whatever its state", () => {
    expect(facts({})).toEqual({ Plan: "Agathon Unlimited", Price: "$25 a month", Status: "Not started" });
  });

  it("the free week: when the first charge is", () => {
    expect(facts({ status: "trialing", trialEnd: "2026-10-10T15:00:00Z" })).toMatchObject({ Status: "Free week", "First charge": "$25 on Saturday, October 10" });
    expect(facts({ status: "repeat_trial", trialEnd: "2026-10-10T15:00:00Z" })).toMatchObject({ Status: "Starting", "First charge": "$25 on Saturday, October 10" });
  });

  it("a paid plan: the next charge; set to cancel: the day it ends, and no charge", () => {
    expect(facts({ status: "active", currentPeriodEnd: "2026-11-10T15:00:00Z" })).toMatchObject({ Status: "Active", "Next charge": "$25 on Tuesday, November 10" });
    const ending = facts({ status: "active", currentPeriodEnd: "2026-11-10T15:00:00Z", cancelAtPeriodEnd: true });
    expect(ending).toMatchObject({ Status: "Set to cancel", "Ends on": "Tuesday, November 10" });
    expect(ending).not.toHaveProperty("Next charge");
  });

  it("a payment problem, a plan being set up, an ended plan", () => {
    expect(facts({ status: "past_due" })).toMatchObject({ Status: "Payment needed" });
    expect(facts({ status: "incomplete" })).toMatchObject({ Status: "Setting up" });
    expect(facts({ status: "canceled", currentPeriodEnd: "2026-10-10T15:00:00Z" })).toMatchObject({ Status: "Ended", "Ended on": "Saturday, October 10" });
  });

  it("leaves the date out when there is none", () => {
    expect(billingFacts({ ...NO_UNLIMITED, status: "active" }).map((f) => f.id)).toEqual(["plan", "price", "status"]);
  });
});
