/**
 * The account page's offer for a family a friend invited (src/lib/billing/unlimitedPlan.ts
 * `friendMonth`): it says the first month is free and dates the first charge 30 days out; nothing
 * else in the plan's words changes, and without it the offer is word for word what it was.
 */
import { describe, expect, it } from "vitest";
import { NO_UNLIMITED, UNLIMITED_PLAN, type UnlimitedState } from "@/lib/billing/unlimited";
import { PLAN_COPY, unlimitedPlanView } from "@/lib/billing/unlimitedPlan";

const NOW = new Date("2026-10-03T15:00:00Z");
const TZ = "America/Chicago";
const view = (state: Partial<UnlimitedState>, friendMonth?: boolean) => unlimitedPlanView({ ...NO_UNLIMITED, ...state }, { now: NOW, timeZone: TZ, friendMonth });

describe("unlimitedPlanView with a friend's free month", () => {
  it("the offer: the first month free, then the plan's price, and nothing charged for 30 days", () => {
    expect(view({}, true)).toEqual({
      kind: "offer",
      badge: null,
      headline: `Your first month is free, then $${UNLIMITED_PLAN.monthlyUsd} a month. Cancel any time.`,
      detail: "A grown-up's card is needed at checkout. Nothing is charged until Monday, November 2.",
      action: "start",
      actionLabel: PLAN_COPY.start,
    });
  });

  it("without it, or for any plan that exists, nothing changes", () => {
    expect(view({}, false)).toEqual(view({}));
    expect(view({}).headline).toBe(PLAN_COPY.offer);
    const states: Array<Partial<UnlimitedState>> = [
      { status: "trialing", trialEnd: "2026-10-10T15:00:00Z" },
      { status: "active", currentPeriodEnd: "2026-11-10T15:00:00Z" },
      { status: "past_due" },
      { status: "canceled", currentPeriodEnd: "2026-10-10T15:00:00Z" },
    ];
    for (const s of states) expect(view(s, true)).toEqual(view(s));
  });
});
