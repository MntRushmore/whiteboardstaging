import { describe, expect, it } from "vitest";
import { NO_UNLIMITED, UNLIMITED_PLAN, trialEndsOn } from "@/lib/billing/unlimited";
import { ARRIVAL_COPY, withoutUnlimitedReturn } from "../arrival";
import { MAX_KIDS } from "@/lib/family/contracts";
import { chargeDateText, dollars, PLAN_COPY, planView } from "../plan";
import { HOME_PATH, PLAN_PATH, planDue } from "../planMarker";

const URL = "https://buy.stripe.com/test_123?client_reference_id=u1";

describe("what the plan screen shows", () => {
  it("waits while the session or the subscription is read: a subscriber is never pitched", () => {
    expect(planView({ loading: true, unlimited: NO_UNLIMITED, checkoutUrl: URL })).toBe("checking");
    expect(planView({ loading: true, unlimited: { status: "active" }, checkoutUrl: URL })).toBe("checking");
  });

  it("skips straight to the home for a plan in its free trial or paid up", () => {
    expect(planView({ loading: false, unlimited: { status: "trialing" }, checkoutUrl: URL })).toBe("skip");
    expect(planView({ loading: false, unlimited: { status: "active" }, checkoutUrl: null })).toBe("skip");
    // a second plan waiting for its first charge is a plan too: never pitched a third
    expect(planView({ loading: false, unlimited: { status: "repeat_trial" }, checkoutUrl: URL })).toBe("skip");
  });

  it("offers the free trial with a checkout, and says Coming soon without one", () => {
    expect(planView({ loading: false, unlimited: NO_UNLIMITED, checkoutUrl: URL })).toBe("offer");
    expect(planView({ loading: false, unlimited: null, checkoutUrl: null })).toBe("soon");
    // an ended plan is offered again, without a free trial (a first plan's only)
    expect(planView({ loading: false, unlimited: { status: "canceled" }, checkoutUrl: URL })).toBe("restart");
    expect(planView({ loading: false, unlimited: { status: "canceled" }, checkoutUrl: null })).toBe("soon");
    // a plan that exists (being set up, a payment to fix) is never offered a second checkout
    for (const status of ["past_due", "incomplete"] as const) {
      expect(planView({ loading: false, unlimited: { status }, checkoutUrl: URL })).toBe("skip");
    }
  });

  it("is due from the home only while pending", () => {
    expect(planDue("pending")).toBe(true);
    expect(planDue("seen")).toBe(false);
    expect(planDue(null)).toBe(false);
    // shown as "Coming soon": due once more when the plan can be started
    expect(planDue("soon")).toBe(false);
    expect(planDue("soon", true)).toBe(true);
  });

  it("lives on its own route, apart from the home", () => {
    expect(PLAN_PATH).toBe("/welcome/plan");
    expect(HOME_PATH).toBe("/");
  });
});

describe("the plan screen's words", () => {
  it("crosses out the plan's own price and says the first 7 days are free", () => {
    expect(dollars(UNLIMITED_PLAN.monthlyUsd)).toBe("$25");
    expect(PLAN_COPY.title).toBe("Agathon Unlimited");
    expect(PLAN_COPY.price).toBe("$25/month");
    expect(PLAN_COPY.free).toBe("Free for 7 days");
    expect(PLAN_COPY.then).toBe("Then $25/month. Cancel anytime.");
  });

  it("says plainly, under the button, that nothing is charged today and when the grown-up's card is", () => {
    expect(PLAN_COPY.disclosure("Saturday, October 10")).toBe(
      "Nothing is charged today. The card is charged $25 on Saturday, October 10, then every month, unless you cancel before then.",
    );
    expect(PLAN_COPY.grownUp).toBe("This part is for a grown-up");
    expect(PLAN_COPY.start).toBe("Start the free trial");
  });

  it("has no way to skip the plan: there is no free plan", () => {
    expect(PLAN_COPY).not.toHaveProperty("later");
    expect(Object.values(PLAN_COPY).filter((v) => typeof v === "string").join(" ")).not.toMatch(/maybe later|not now|skip/i);
  });

  it("lists five perks for a K–8 family, short enough for one line on a phone", () => {
    expect(PLAN_COPY.perks.map((p) => p.id)).toEqual(["daily", "path", "check", "kids", "report"]);
    for (const p of PLAN_COPY.perks) expect(p.text.length).toBeLessThanOrEqual(40);
    const all = PLAN_COPY.perks.map((p) => p.text).join(" ");
    expect(all).toMatch(/Today's practice/);
    expect(all).toContain(`Up to ${MAX_KIDS} kid profiles`);
    // nothing left over from the high-school product
    expect(all).not.toMatch(/Algebra|Calculus|course/i);
  });

  it("never promises starter ink when checkout is not open (there is no free plan)", () => {
    expect(`${PLAN_COPY.soonTitle} ${PLAN_COPY.soonNote}`).not.toMatch(/ink|free/i);
  });

  it("links the plan's terms and its fair-use limit beside the disclosure", () => {
    expect(PLAN_COPY.termsLink.href).toBe("/terms#unlimited");
    expect(PLAN_COPY.fairUseLink.href).toBe("/terms#fair-use");
    expect(PLAN_COPY.disclosure("Saturday, October 10")).toMatch(/then every month/);
  });

  it("never says wrong", () => {
    const words = Object.values(PLAN_COPY).flatMap((v): string[] =>
      typeof v === "string" ? [v] : typeof v === "function" ? [v("today")] : Array.isArray(v) ? v.map((p) => p.text) : [(v as { text: string }).text],
    );
    for (const w of words) expect(w).not.toMatch(/\bwrong\b/i);
  });
});

describe("the day the card is charged", () => {
  it("is the end of the free trial, in the reader's own words", () => {
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
  it("says welcome to the free trial, warmly and briefly", () => {
    expect(ARRIVAL_COPY.started).toBe("Your free trial has started!");
    expect(ARRIVAL_COPY.startedHint.length).toBeLessThanOrEqual(60);
  });

  it("takes ?unlimited=… out of the URL and keeps the rest", () => {
    expect(withoutUnlimitedReturn("?unlimited=started")).toBe("");
    expect(withoutUnlimitedReturn("?unlimited=started&tab=boards")).toBe("?tab=boards");
    expect(withoutUnlimitedReturn("?tab=boards")).toBe("?tab=boards");
    expect(withoutUnlimitedReturn("")).toBe("");
  });
});
