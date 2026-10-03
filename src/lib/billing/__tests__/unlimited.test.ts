import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NO_UNLIMITED,
  UNLIMITED_METER_COPY,
  UNLIMITED_PLAN,
  billingPortalLink,
  billingPortalUrl,
  isUnlimited,
  isUnlimitedReturn,
  mustCancelBeforeDeleting,
  parseUnlimitedLink,
  parseUnlimitedState,
  trialEndsOn,
  unlimitedCheckoutUrl,
  unlimitedLink,
} from "@/lib/billing/unlimited";

const USER = { userId: "8d2a3f1e-4b6c-4d7e-9f01-23456789abcd", email: "kid@example.com" };
/** The account's checkout reference (profiles.checkout_ref): what the plan's checkout carries. */
const REF = "0b7e9c1a-5d2f-4e3a-8b6c-9d0e1f2a3b4c";
const WEEK = "2026-10-10T20:00:00.000Z";
const MONTH = "2026-11-10T20:00:00.000Z";

/** ink_summary().unlimited as the database answers it. */
function row(overrides: Record<string, unknown> = {}) {
  return {
    status: "trialing",
    unlimited: true,
    trial_end: WEEK,
    current_period_end: WEEK,
    cancel_at_period_end: false,
    cancel_at: null,
    repeat_trial: false,
    checkout_ref: REF,
    ...overrides,
  };
}

afterEach(() => vi.unstubAllEnvs());

describe("the contract", () => {
  it("the plan is $25 a month after a 7-day free trial", () => {
    expect(UNLIMITED_PLAN).toEqual({ id: "unlimited", name: "Agathon Unlimited", monthlyUsd: 25, trialDays: 7 });
  });

  it("only trialing and active spend no ink", () => {
    expect(isUnlimited({ status: "trialing" })).toBe(true);
    expect(isUnlimited({ status: "active" })).toBe(true);
    for (const status of ["none", "repeat_trial", "past_due", "canceled", "incomplete"] as const) expect(isUnlimited({ status })).toBe(false);
    expect(isUnlimited(null)).toBe(false);
  });

  it("the checkout carries the account's checkout reference, never the user id, and no prefilled email; nothing without a link or a ref", () => {
    const url = new URL(unlimitedCheckoutUrl({ checkoutRef: REF, email: USER.email }, "https://buy.stripe.com/test_u")!);
    expect(url.searchParams.get("client_reference_id")).toBe(REF);
    // the account's email is often the child's: the grown-up who pays types their own
    expect(url.searchParams.get("prefilled_email")).toBeNull();
    expect(url.toString()).not.toContain(USER.userId);
    expect(unlimitedCheckoutUrl({ checkoutRef: REF }, null)).toBeNull();
    expect(unlimitedCheckoutUrl(null, "https://buy.stripe.com/test_u")).toBeNull();
    // the ref not read yet: the button waits; it never falls back to anything else
    for (const checkoutRef of [null, undefined, "", "not-a-uuid"]) {
      expect(unlimitedCheckoutUrl({ checkoutRef, email: USER.email }, "https://buy.stripe.com/test_u"), String(checkoutRef)).toBeNull();
    }
  });

  it("reads NEXT_PUBLIC_UNLIMITED_LINK, refusing anything that is not an absolute http(s) URL", () => {
    vi.stubEnv("NEXT_PUBLIC_UNLIMITED_LINK", " https://buy.stripe.com/test_u ");
    expect(unlimitedLink()).toBe("https://buy.stripe.com/test_u");
    expect(parseUnlimitedLink("javascript:alert(1)")).toBeNull();
    expect(parseUnlimitedLink("")).toBeNull();
  });

  it("the free week ends seven days from now; the return is ?unlimited=started", () => {
    expect(trialEndsOn(new Date("2026-10-03T12:00:00Z")).toISOString()).toBe("2026-10-10T12:00:00.000Z");
    expect(isUnlimitedReturn("?unlimited=started")).toBe(true);
    expect(isUnlimitedReturn(new URLSearchParams("a=1&unlimited=started"))).toBe(true);
    expect(isUnlimitedReturn("?unlimited=maybe")).toBe(false);
    expect(isUnlimitedReturn(null)).toBe(false);
  });
});

describe("parseUnlimitedState (ink_summary().unlimited)", () => {
  it("a free week, as it is", () => {
    expect(parseUnlimitedState(row())).toEqual({ status: "trialing", trialEnd: WEEK, currentPeriodEnd: WEEK, cancelAtPeriodEnd: false, checkoutRef: REF });
  });

  it("a paid month with its next charge", () => {
    expect(parseUnlimitedState(row({ status: "active", trial_end: null, current_period_end: MONTH }))).toEqual({
      status: "active",
      trialEnd: null,
      currentPeriodEnd: MONTH,
      cancelAtPeriodEnd: false,
      checkoutRef: REF,
    });
  });

  it("a second plan's free week (repeat_trial: the server grants nothing) is its own state, not a payment problem", () => {
    expect(parseUnlimitedState(row({ unlimited: false, repeat_trial: true }))).toMatchObject({ status: "repeat_trial", trialEnd: WEEK });
    expect(isUnlimited(parseUnlimitedState(row({ unlimited: false, repeat_trial: true })))).toBe(false);
    // once it is paid it is active like any other plan
    expect(parseUnlimitedState(row({ status: "active", repeat_trial: false })).status).toBe("active");
    // without the flag, trialing and not unlimited is still the overdue case
    expect(parseUnlimitedState(row({ unlimited: false })).status).toBe("past_due");
  });

  it("reads the checkout reference with or without a plan, and only a uuid", () => {
    expect(parseUnlimitedState({ status: "none", unlimited: false, checkout_ref: REF.toUpperCase() })).toEqual({ ...NO_UNLIMITED, checkoutRef: REF });
    expect(parseUnlimitedState(row({ checkout_ref: "8d2a3f1e" })).checkoutRef).toBeNull();
    expect(parseUnlimitedState(row({ checkout_ref: undefined })).checkoutRef).toBeNull();
  });

  it("set to cancel: by cancel_at_period_end, or by Stripe's cancel_at (then that is the day it ends)", () => {
    expect(parseUnlimitedState(row({ cancel_at_period_end: true }))).toMatchObject({ status: "trialing", cancelAtPeriodEnd: true, currentPeriodEnd: WEEK });
    expect(parseUnlimitedState(row({ status: "active", current_period_end: MONTH, cancel_at: "2026-11-01T00:00:00.000Z" }))).toMatchObject({
      cancelAtPeriodEnd: true,
      currentPeriodEnd: "2026-11-01T00:00:00.000Z",
    });
  });

  it("maps Stripe's other statuses onto the app's", () => {
    expect(parseUnlimitedState(row({ status: "past_due", unlimited: false })).status).toBe("past_due");
    expect(parseUnlimitedState(row({ status: "unpaid", unlimited: false })).status).toBe("past_due");
    expect(parseUnlimitedState(row({ status: "paused", unlimited: false })).status).toBe("past_due");
    expect(parseUnlimitedState(row({ status: "canceled", unlimited: false })).status).toBe("canceled");
    expect(parseUnlimitedState(row({ status: "incomplete_expired", unlimited: false })).status).toBe("canceled");
    expect(parseUnlimitedState(row({ status: "incomplete", unlimited: false })).status).toBe("incomplete");
    // the checkout is linked but the subscription's own event has not arrived yet
    expect(parseUnlimitedState(row({ status: null, unlimited: false })).status).toBe("incomplete");
    expect(parseUnlimitedState(row({ status: "none", unlimited: false }))).toEqual({ ...NO_UNLIMITED, checkoutRef: REF });
  });

  it("a renewal overdue past the grace (the server already spends ink) reads as a payment problem", () => {
    expect(parseUnlimitedState(row({ status: "active", unlimited: false })).status).toBe("past_due");
  });

  it("anything missing or malformed is none: nobody is told they have a plan they may not have", () => {
    for (const raw of [undefined, null, "trialing", 3, [], {}, { status: "frozen" }, { unlimited: true }]) {
      expect(parseUnlimitedState(raw), JSON.stringify(raw)).toEqual(NO_UNLIMITED);
    }
    expect(parseUnlimitedState(row({ trial_end: "not a date", current_period_end: 42 }))).toMatchObject({ trialEnd: null, currentPeriodEnd: null });
  });
});

describe("mustCancelBeforeDeleting", () => {
  it("while the plan would charge again and is not set to cancel", () => {
    expect(mustCancelBeforeDeleting({ status: "trialing", cancelAtPeriodEnd: false })).toBe(true);
    expect(mustCancelBeforeDeleting({ status: "active", cancelAtPeriodEnd: false })).toBe(true);
    expect(mustCancelBeforeDeleting({ status: "past_due", cancelAtPeriodEnd: false })).toBe(true);
    // a second plan's free week charges when it ends, like the first
    expect(mustCancelBeforeDeleting({ status: "repeat_trial", cancelAtPeriodEnd: false })).toBe(true);
    expect(mustCancelBeforeDeleting({ status: "active", cancelAtPeriodEnd: true })).toBe(false);
    for (const status of ["none", "canceled", "incomplete"] as const) expect(mustCancelBeforeDeleting({ status, cancelAtPeriodEnd: false })).toBe(false);
    expect(mustCancelBeforeDeleting(null)).toBe(false);
  });
});

describe("the customer portal", () => {
  it("reads NEXT_PUBLIC_BILLING_PORTAL_URL and prefills the email", () => {
    vi.stubEnv("NEXT_PUBLIC_BILLING_PORTAL_URL", "https://billing.stripe.com/p/login/test_p");
    expect(billingPortalLink()).toBe("https://billing.stripe.com/p/login/test_p");
    expect(billingPortalUrl(" parent@example.com ")).toBe("https://billing.stripe.com/p/login/test_p?prefilled_email=parent%40example.com");
    expect(billingPortalUrl(null)).toBe("https://billing.stripe.com/p/login/test_p");
  });

  it("is null without a usable link", () => {
    vi.stubEnv("NEXT_PUBLIC_BILLING_PORTAL_URL", "");
    expect(billingPortalLink()).toBeNull();
    expect(billingPortalUrl("a@example.com")).toBeNull();
    expect(billingPortalUrl("a@example.com", "javascript:alert(1)")).toBeNull();
  });

  it("the meter's words", () => {
    expect(UNLIMITED_METER_COPY).toEqual({ word: "Unlimited", label: "Agathon Unlimited: help uses no ink" });
  });
});
