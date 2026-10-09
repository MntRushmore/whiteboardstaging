/**
 * Which checkout a grown-up is sent to (src/lib/billing/planChoice.ts): the monthly plan, or the
 * referral link's free first month for an account a friend invited (its own attribution's `ref`),
 * always with the account's checkout reference; and what the friend's month changes (the trial).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PLAN_REFERRAL_COPY,
  REFERRAL_TRIAL_DAYS,
  isReferredAttribution,
  planCheckoutUrl,
  planLink,
  referralApplies,
  referralLink,
  trialDaysOf,
} from "@/lib/billing/planChoice";
import { UNLIMITED_PLAN } from "@/lib/billing/unlimited";

const MONTHLY = "https://buy.stripe.com/test_monthly";
const REFERRAL = "https://buy.stripe.com/test_referral";
const REF = "0f8fad5b-d9cb-469f-a165-70867728950e";

function links({ monthly = MONTHLY, referral = REFERRAL }: { monthly?: string; referral?: string } = {}) {
  vi.stubEnv("NEXT_PUBLIC_UNLIMITED_LINK", monthly);
  vi.stubEnv("NEXT_PUBLIC_UNLIMITED_REFERRAL_LINK", referral);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("planLink", () => {
  it("a referred account gets the referral link; everyone else the monthly one", () => {
    links();
    expect(planLink({ referred: true })).toBe(REFERRAL);
    expect(planLink({ referred: false })).toBe(MONTHLY);
  });

  it("without the referral link a referred account gets the monthly link, and without either nothing", () => {
    links({ referral: "" });
    expect(referralLink()).toBeNull();
    expect(planLink({ referred: true })).toBe(MONTHLY);
    links({ monthly: "", referral: "" });
    expect(planLink({ referred: true })).toBeNull();
    expect(planLink({ referred: false })).toBeNull();
  });

  it("only an absolute http(s) link counts", () => {
    links({ referral: "javascript:alert(1)" });
    expect(referralLink()).toBeNull();
    expect(planLink({ referred: true })).toBe(MONTHLY);
  });
});

describe("planCheckoutUrl", () => {
  it("carries the account's checkout reference (never the user id or an email), and waits for it", () => {
    links();
    const payer = { checkoutRef: REF, email: "kid@example.com" };
    expect(planCheckoutUrl(payer, { referred: true })).toBe(`${REFERRAL}?client_reference_id=${REF}`);
    expect(planCheckoutUrl(payer, { referred: false })).toBe(`${MONTHLY}?client_reference_id=${REF}`);
    expect(planCheckoutUrl(payer, { referred: true })).not.toContain("prefilled_email");
    expect(planCheckoutUrl({ checkoutRef: null }, { referred: true })).toBeNull();
    expect(planCheckoutUrl({ checkoutRef: "not-a-ref" }, { referred: false })).toBeNull();
    links({ monthly: "", referral: "" });
    expect(planCheckoutUrl(payer, { referred: true })).toBeNull();
  });
});

describe("a friend's free first month", () => {
  it("a referral code in the account's own attribution is a referral; anything else is not", () => {
    expect(isReferredAttribution({ ref: "ABCD2345", firstSeenAt: "2026-10-09T00:00:00Z" })).toBe(true);
    expect(isReferredAttribution({ ref: "abcd2345" })).toBe(false); // codes are upper case
    expect(isReferredAttribution({ ref: "ABC" })).toBe(false);
    expect(isReferredAttribution({ ref: "ABCDO0I1" })).toBe(false); // look-alikes are never in a code
    expect(isReferredAttribution({ utmSource: "tiktok" })).toBe(false);
    expect(isReferredAttribution(null)).toBe(false);
    expect(isReferredAttribution("ABCD2345")).toBe(false);
    expect(isReferredAttribution(["ABCD2345"])).toBe(false);
  });

  it("applies only where the referral link is set: 30 days, else the plan's own trial", () => {
    links();
    expect(REFERRAL_TRIAL_DAYS).toBe(30);
    expect(referralApplies({ referred: true })).toBe(true);
    expect(trialDaysOf({ referred: true })).toBe(30);
    expect(referralApplies({ referred: false })).toBe(false);
    expect(trialDaysOf({ referred: false })).toBe(UNLIMITED_PLAN.trialDays);
    links({ referral: "" });
    expect(referralApplies({ referred: true })).toBe(false);
    expect(trialDaysOf({ referred: true })).toBe(UNLIMITED_PLAN.trialDays);
  });

  it("is said plainly, with no price in it (the price is UNLIMITED_PLAN's, wherever it is said)", () => {
    expect(PLAN_REFERRAL_COPY).toEqual({ friend: "Your first month is free (a friend invited you)", friendFree: "First month free" });
    expect(JSON.stringify(PLAN_REFERRAL_COPY)).not.toMatch(/\$|!/);
  });
});
