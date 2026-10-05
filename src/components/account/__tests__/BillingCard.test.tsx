import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NO_UNLIMITED, type UnlimitedState } from "@/lib/billing/unlimited";
import { PLAN_COPY } from "@/lib/billing/unlimitedPlan";

const plan = vi.hoisted(() => ({ state: null as UnlimitedState | null }));
vi.mock("@/lib/billing/useUnlimited", () => ({
  useUnlimited: () => ({ state: plan.state, loading: false, known: true, refresh: () => undefined }),
}));

const { BillingCard } = await import("../BillingCard");

const REF = "0f8fad5b-d9cb-469f-a165-70867728950e";
/** the markup with its entities read back (apostrophes are escaped) */
const render = (state: Partial<UnlimitedState>) => {
  plan.state = { ...NO_UNLIMITED, checkoutRef: REF, ...state };
  return renderToStaticMarkup(<BillingCard email="parent@example.com" />).replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the account page's Billing section", () => {
  it("is the #billing section the header's menu links to, with the plan's facts", () => {
    const html = render({});
    expect(html).toContain('id="billing"');
    expect(html).toContain(`>${PLAN_COPY.billingTitle}<`);
    expect(html).toMatch(/<dt[^>]*>Plan<\/dt><dd[^>]*>Agathon Unlimited<\/dd>/);
    expect(html).toMatch(/<dt[^>]*>Price<\/dt><dd[^>]*>\$25 a month<\/dd>/);
    expect(html).toMatch(/<dt[^>]*>Status<\/dt><dd[^>]*>Not started<\/dd>/);
  });

  it("without a plan: starts the free week at the plan's checkout, for this account's checkout reference", () => {
    vi.stubEnv("NEXT_PUBLIC_UNLIMITED_LINK", "https://buy.stripe.com/test_unlimited");
    const html = render({});
    expect(html).toContain('data-plan="offer"');
    expect(html).toMatch(new RegExp(`href="https://buy.stripe.com/test_unlimited\\?client_reference_id=${REF}"[^>]*data-testid="plan-start"`));
    expect(html).toContain(PLAN_COPY.start);
  });

  it("on the plan: the next charge, and the billing portal to change the card, see invoices or cancel", () => {
    vi.stubEnv("NEXT_PUBLIC_BILLING_PORTAL_URL", "https://billing.stripe.com/p/login/test_portal");
    const html = render({ status: "active", currentPeriodEnd: "2026-11-10T15:00:00Z" });
    expect(html).toContain('data-plan="active"');
    expect(html).toMatch(/<dt[^>]*>Next charge<\/dt><dd[^>]*>\$25 on [A-Za-z]+, November 1[01]<\/dd>/);
    expect(html).toContain("https://billing.stripe.com/p/login/test_portal?prefilled_email=parent%40example.com");
    expect(html).toContain(PLAN_COPY.manage);
    expect(html).toContain(PLAN_COPY.portalHint);
    expect(html).not.toContain('data-testid="plan-start"');
  });

  it("a payment to fix: Update your card, first", () => {
    vi.stubEnv("NEXT_PUBLIC_BILLING_PORTAL_URL", "https://billing.stripe.com/p/login/test_portal");
    const html = render({ status: "past_due" });
    expect(html).toContain("Payment needed");
    expect(html).toContain(PLAN_COPY.fixPayment);
  });
});
