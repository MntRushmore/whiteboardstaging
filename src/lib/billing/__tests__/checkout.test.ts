import { describe, expect, it } from "vitest";
import {
  UPGRADE_TIMEOUT_MS,
  checkoutUrl,
  parseUpgradeReturn,
  payerLinks,
  portalUrl,
  subscriptionView,
  upgradeReturnState,
} from "../checkout";
import { hasSubscription, type CreditSummary } from "../viewModel";

const USER = "8d2a3f1e-4b6c-4d7e-9f01-23456789abcd";
const NOW = new Date("2026-09-28T12:00:00Z");

const summary: CreditSummary = {
  plan_id: "plus",
  plan_name: "Plus",
  monthly_credits: 3000,
  used: 10,
  granted: 0,
  remaining: 2990,
  period_start: "2026-09-01T00:00:00Z",
  period_end: "2026-10-01T00:00:00Z",
  billing_status: "active",
  current_period_end: "2026-10-28T09:30:00Z",
};

describe("checkoutUrl / portalUrl", () => {
  it("adds the user's id as client_reference_id and prefills the email", () => {
    const url = new URL(checkoutUrl("https://buy.stripe.com/test_abc", { userId: USER, email: "kid+1@example.com" })!);
    expect(url.origin + url.pathname).toBe("https://buy.stripe.com/test_abc");
    expect(url.searchParams.get("client_reference_id")).toBe(USER);
    expect(url.searchParams.get("prefilled_email")).toBe("kid+1@example.com");
  });
  it("keeps other query parameters, overwrites a stale reference, and skips an empty email", () => {
    const url = new URL(checkoutUrl("https://buy.stripe.com/x?locale=en&client_reference_id=someone", { userId: USER, email: "  " })!);
    expect(url.searchParams.get("locale")).toBe("en");
    expect(url.searchParams.get("client_reference_id")).toBe(USER);
    expect(url.searchParams.has("prefilled_email")).toBe(false);
  });
  it("refuses to build a checkout nobody could be matched to, or from a bad link", () => {
    expect(checkoutUrl("https://buy.stripe.com/x", null)).toBeNull();
    expect(checkoutUrl("https://buy.stripe.com/x", { userId: "" })).toBeNull();
    expect(checkoutUrl(undefined, { userId: USER })).toBeNull();
    expect(checkoutUrl("not a url", { userId: USER })).toBeNull();
    expect(checkoutUrl("javascript:alert(1)", { userId: USER })).toBeNull();
  });
  it("prefills the portal login's email and nothing else", () => {
    const url = new URL(portalUrl("https://billing.stripe.com/p/login/test_x", "a@example.com")!);
    expect([...url.searchParams.keys()]).toEqual(["prefilled_email"]);
    expect(portalUrl("https://billing.stripe.com/p/login/test_x", null)).toBe("https://billing.stripe.com/p/login/test_x");
    expect(portalUrl(undefined, "a@example.com")).toBeNull();
  });
  it("payerLinks decorates every plan link and the portal, dropping what cannot be used", () => {
    const links = payerLinks(
      { plus: "https://buy.stripe.com/p", pro: "https://buy.stripe.com/q", portal: "https://billing.stripe.com/p/login/r" },
      { userId: USER, email: "a@example.com" },
    );
    expect(new URL(links.plus).searchParams.get("client_reference_id")).toBe(USER);
    expect(new URL(links.pro).searchParams.get("client_reference_id")).toBe(USER);
    expect(new URL(links.portal).searchParams.get("prefilled_email")).toBe("a@example.com");
    expect(new URL(links.portal).searchParams.has("client_reference_id")).toBe(false);
    // signed out (no id yet): no checkout links, the portal still works
    expect(Object.keys(payerLinks({ plus: "https://buy.stripe.com/p", portal: "https://billing.stripe.com/x" }, null))).toEqual(["portal"]);
  });
});

describe("parseUpgradeReturn", () => {
  it("reads ?upgraded=<plan id> from a string or URLSearchParams", () => {
    expect(parseUpgradeReturn("?upgraded=plus")).toBe("plus");
    expect(parseUpgradeReturn(new URLSearchParams("upgraded=Pro"))).toBe("pro");
    expect(parseUpgradeReturn("?x=1")).toBeNull();
    expect(parseUpgradeReturn("?upgraded=<script>")).toBeNull();
    expect(parseUpgradeReturn("?upgraded=")).toBeNull();
    expect(parseUpgradeReturn(null)).toBeNull();
  });
});

describe("hasSubscription / subscriptionView", () => {
  it("only a paid plan with a live Stripe status has a subscription", () => {
    expect(hasSubscription(summary)).toBe(true);
    expect(hasSubscription({ ...summary, billing_status: "canceling" })).toBe(true);
    expect(hasSubscription({ ...summary, billing_status: "comped" })).toBe(false);
    expect(hasSubscription({ ...summary, billing_status: null })).toBe(false);
    expect(hasSubscription({ ...summary, plan_id: "free", billing_status: "canceled" })).toBe(false);
    expect(hasSubscription(null)).toBe(false);
  });
  it("says when the plan renews", () => {
    expect(subscriptionView(summary, NOW)).toEqual({ kind: "active", line: "Plus renews on Oct 28." });
    expect(subscriptionView({ ...summary, current_period_end: null }, NOW)).toEqual({ kind: "active", line: "Plus renews every month." });
  });
  it("shows a cancelled-but-still-active plan with the day it ends", () => {
    expect(subscriptionView({ ...summary, billing_status: "canceling" }, NOW)).toEqual({
      kind: "canceling",
      line: "Cancelled: you keep Plus until Oct 28, then move to Free.",
    });
  });
  it("asks for a new card after a failed payment, and shows nothing without a subscription", () => {
    expect(subscriptionView({ ...summary, billing_status: "past_due" }, NOW)).toMatchObject({ kind: "past_due" });
    expect(subscriptionView({ ...summary, plan_id: "free", plan_name: "Free", billing_status: null }, NOW)).toEqual({ kind: "none" });
  });
});

describe("upgradeReturnState (back from checkout, waiting for the webhook)", () => {
  const base = { target: "plus", startedAt: 1_000 };
  it("waits while credit_summary still shows the old plan (or has not loaded)", () => {
    expect(upgradeReturnState({ ...base, summary: null, now: 1_000 })).toBe("waiting");
    expect(upgradeReturnState({ ...base, summary: { plan_id: "free" }, now: 1_000 + 30_000 })).toBe("waiting");
  });
  it("is done as soon as the plan paid for arrives", () => {
    expect(upgradeReturnState({ ...base, summary: { plan_id: "plus" }, now: 1_500 })).toBe("done");
    // even after the timeout: a late webhook still turns the notice green
    expect(upgradeReturnState({ ...base, summary: { plan_id: "plus" }, now: 1_000 + UPGRADE_TIMEOUT_MS * 3 })).toBe("done");
  });
  it("gives up waiting after the timeout", () => {
    expect(upgradeReturnState({ ...base, summary: { plan_id: "free" }, now: 1_000 + UPGRADE_TIMEOUT_MS })).toBe("timeout");
    expect(upgradeReturnState({ ...base, summary: { plan_id: "free" }, now: 1_000 + 5_000, timeoutMs: 5_000 })).toBe("timeout");
  });
});
