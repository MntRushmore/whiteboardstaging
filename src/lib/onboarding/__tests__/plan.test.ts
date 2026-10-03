import { describe, expect, it } from "vitest";
import { NO_UNLIMITED, UNLIMITED_PLAN, trialEndsOn } from "@/lib/billing/unlimited";
import { chargeDateText, dollars, HOME_PATH, PLAN_COPY, PLAN_PATH, planDue, planView, withoutUnlimitedReturn } from "../plan";

const URL = "https://buy.stripe.com/test_123?client_reference_id=u1";

describe("what the plan screen shows", () => {
  it("waits while the session or the subscription is read: a subscriber is never pitched", () => {
    expect(planView({ loading: true, unlimited: NO_UNLIMITED, checkoutUrl: URL })).toBe("checking");
    expect(planView({ loading: true, unlimited: { status: "active" }, checkoutUrl: URL })).toBe("checking");
  });

  it("skips straight to the home for a plan in its free week or paid up", () => {
    expect(planView({ loading: false, unlimited: { status: "trialing" }, checkoutUrl: URL })).toBe("skip");
    expect(planView({ loading: false, unlimited: { status: "active" }, checkoutUrl: null })).toBe("skip");
  });

  it("offers the free week with a checkout, and says Coming soon without one", () => {
    expect(planView({ loading: false, unlimited: NO_UNLIMITED, checkoutUrl: URL })).toBe("offer");
    expect(planView({ loading: false, unlimited: null, checkoutUrl: null })).toBe("soon");
    // a lapsed plan is offered again
    for (const status of ["past_due", "canceled", "incomplete"] as const) {
      expect(planView({ loading: false, unlimited: { status }, checkoutUrl: URL })).toBe("offer");
    }
  });

  it("is due from the home only while pending", () => {
    expect(planDue("pending")).toBe(true);
    expect(planDue("seen")).toBe(false);
    expect(planDue(null)).toBe(false);
  });

  it("lives on its own route, apart from the home", () => {
    expect(PLAN_PATH).toBe("/welcome/plan");
    expect(HOME_PATH).toBe("/");
  });
});

describe("the plan screen's words", () => {
  it("crosses out the plan's own price and says the beta week is free", () => {
    expect(dollars(UNLIMITED_PLAN.monthlyUsd)).toBe("$25");
    expect(PLAN_COPY.title).toBe("Agathon Unlimited");
    expect(PLAN_COPY.price).toBe("$25/month");
    expect(PLAN_COPY.free).toBe("Free for your beta week");
    expect(PLAN_COPY.then).toBe("Then $25/month. Cancel anytime.");
  });

  it("says plainly, under the button, that nothing is charged today and when the grown-up's card is", () => {
    expect(PLAN_COPY.disclosure("Saturday, October 10")).toBe(
      "You won't be charged today. Your grown-up's card is charged $25 on Saturday, October 10 unless you cancel before then.",
    );
    expect(PLAN_COPY.grownUp).toBe("Ask a grown-up to start your free week");
    expect(PLAN_COPY.start).toBe("Start my free week");
    expect(PLAN_COPY.later).toBe("Maybe later");
  });

  it("lists four perks, short enough for one line on a phone", () => {
    expect(PLAN_COPY.perks).toHaveLength(4);
    for (const p of PLAN_COPY.perks) expect(p.text.length).toBeLessThanOrEqual(40);
    expect(PLAN_COPY.perks.map((p) => p.text).join(" ")).toMatch(/Help me and Solve/);
  });

  it("never says wrong", () => {
    const words = Object.values(PLAN_COPY).flatMap((v) => (typeof v === "string" ? [v] : typeof v === "function" ? [v("today")] : v.map((p) => p.text)));
    for (const w of words) expect(w).not.toMatch(/\bwrong\b/i);
  });
});

describe("the day the card is charged", () => {
  it("is the end of the free week, in the reader's own words", () => {
    const now = new Date(2026, 9, 3, 15, 0); // Saturday 3 October 2026, local time
    const end = trialEndsOn(now);
    expect(chargeDateText(end, "en-US")).toBe("Saturday, October 10");
    expect(chargeDateText(end, "en-GB")).toBe("Saturday 10 October");
  });

  it("falls back to the default format for a locale tag it cannot use", () => {
    expect(chargeDateText(new Date(2026, 9, 10), "not a locale!!")).toMatch(/10/);
  });
});

describe("back from checkout", () => {
  it("takes ?unlimited=… out of the URL and keeps the rest", () => {
    expect(withoutUnlimitedReturn("?unlimited=started")).toBe("");
    expect(withoutUnlimitedReturn("?unlimited=started&tab=boards")).toBe("?tab=boards");
    expect(withoutUnlimitedReturn("?tab=boards")).toBe("?tab=boards");
    expect(withoutUnlimitedReturn("")).toBe("");
  });
});
