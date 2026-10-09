import { describe, expect, it } from "vitest";
import { UNLIMITED_PLAN } from "@/lib/billing/unlimited";
import { MAX_KIDS } from "@/lib/family/contracts";
import { dayCount, freeTrialName, planWords, priceText } from "../plan";

describe("freeTrialName", () => {
  it("says a week for 7 days, and weeks or days otherwise", () => {
    expect(freeTrialName(7)).toBe("week");
    expect(freeTrialName(14)).toBe("two weeks");
    expect(freeTrialName(28)).toBe("four weeks");
    expect(freeTrialName(3)).toBe("3 days");
    expect(freeTrialName(10)).toBe("10 days");
    expect(freeTrialName(35)).toBe("35 days");
    expect(freeTrialName(1)).toBe("1 day");
  });
});

describe("priceText", () => {
  it("drops cents from whole dollars and keeps them otherwise", () => {
    expect(priceText(25)).toBe("$25");
    expect(priceText(29.5)).toBe("$29.50");
  });
});

describe("dayCount", () => {
  it("counts days, one day singular", () => {
    expect(dayCount(30)).toBe("30 days");
    expect(dayCount(1)).toBe("1 day");
  });
});

describe("planWords", () => {
  it("takes every number from the plan, and the kid limit from MAX_KIDS", () => {
    const words = planWords({ name: "Agathon Unlimited", monthlyUsd: 35, trialDays: 14 });
    expect(words.price).toBe("$35");
    expect(words.start).toBe("Start your free two weeks");
    expect(words.then).toBe(`then $35 a month for up to ${MAX_KIDS} kids. Cancel anytime.`);
    expect(words.terms).toBe(`Free for 14 days, then $35 a month for up to ${MAX_KIDS} kids. Cancel anytime.`);
    // a family has at most MAX_KIDS kids (a 7th is refused): never "the whole family"
    expect(words.terms).not.toMatch(/whole family|every kid/i);
  });

  it("reads UNLIMITED_PLAN by default", () => {
    const words = planWords();
    expect(words.name).toBe(UNLIMITED_PLAN.name);
    expect(words.price).toBe(`$${UNLIMITED_PLAN.monthlyUsd}`);
    expect(words.days).toBe(`${UNLIMITED_PLAN.trialDays} days`);
  });
});
