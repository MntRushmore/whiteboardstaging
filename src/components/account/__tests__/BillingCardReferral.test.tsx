/**
 * The account page's Billing card for a family a friend invited (src/components/account/BillingCard.tsx):
 * starting the plan opens the referral Payment Link (its first month free) with the account's
 * checkout reference and says why, only where that link is set, never for a plan started again and
 * never for a kid. BillingCard.test.tsx keeps the card for everyone else.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NO_UNLIMITED, UNLIMITED_PLAN, type UnlimitedState } from "@/lib/billing/unlimited";
import { PLAN_REFERRAL_COPY } from "@/lib/billing/planChoice";

const plan = vi.hoisted(() => ({ state: null as UnlimitedState | null, referred: false, readFor: [] as Array<string | null | undefined> }));
vi.mock("@/lib/billing/useUnlimited", () => ({
  useUnlimited: () => ({ state: plan.state, loading: false, known: true, refresh: () => undefined }),
}));
vi.mock("@/lib/billing/useReferred", () => ({
  useReferred: (userId: string | null | undefined) => {
    plan.readFor.push(userId);
    return { referred: Boolean(userId) && plan.referred, known: true };
  },
}));
vi.mock("@/components/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u-parent" }, session: null, loading: false, authError: null, retryAuth: () => undefined }),
}));

const { BillingCard } = await import("../BillingCard");

const REF = "0f8fad5b-d9cb-469f-a165-70867728950e";
const MONTHLY = "https://buy.stripe.com/test_monthly";
const REFERRAL = "https://buy.stripe.com/test_referral";
const PRICE = `$${UNLIMITED_PLAN.monthlyUsd}`;

const render = (state: Partial<UnlimitedState>, email = "parent@example.com") => {
  plan.state = { ...NO_UNLIMITED, checkoutRef: REF, ...state };
  return renderToStaticMarkup(<BillingCard email={email} />).replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
};
const startHref = (html: string) => html.match(/href="([^"]+)"[^>]*data-testid="plan-start"/)?.[1] ?? null;

afterEach(() => {
  vi.unstubAllEnvs();
  plan.referred = false;
  plan.readFor = [];
});

describe("the Billing card for a family a friend invited", () => {
  it("starts at the referral link with the checkout reference, and says the first month is free and why", () => {
    vi.stubEnv("NEXT_PUBLIC_UNLIMITED_LINK", MONTHLY);
    vi.stubEnv("NEXT_PUBLIC_UNLIMITED_REFERRAL_LINK", REFERRAL);
    plan.referred = true;
    const html = render({});
    expect(startHref(html)).toBe(`${REFERRAL}?client_reference_id=${REF}`);
    expect(html).toMatch(/data-testid="billing-friend"[^>]*>[\s\S]*?Your first month is free \(a friend invited you\)/);
    expect(html).toContain(`Your first month is free, then ${PRICE} a month. Cancel any time.`);
    // the facts are the plan's as always
    expect(html).toMatch(new RegExp(`<dt[^>]*>Price</dt><dd[^>]*>\\${PRICE} a month</dd>`));
  });

  it("not referred, or no referral link: the monthly link and the usual words", () => {
    vi.stubEnv("NEXT_PUBLIC_UNLIMITED_LINK", MONTHLY);
    vi.stubEnv("NEXT_PUBLIC_UNLIMITED_REFERRAL_LINK", REFERRAL);
    const usual = render({});
    expect(startHref(usual)).toBe(`${MONTHLY}?client_reference_id=${REF}`);
    expect(usual).not.toContain("billing-friend");
    vi.stubEnv("NEXT_PUBLIC_UNLIMITED_REFERRAL_LINK", "");
    plan.referred = true;
    const noLink = render({});
    expect(startHref(noLink)).toBe(`${MONTHLY}?client_reference_id=${REF}`);
    expect(noLink).not.toContain(PLAN_REFERRAL_COPY.friend);
  });

  it("a plan started again gets no free month", () => {
    vi.stubEnv("NEXT_PUBLIC_UNLIMITED_LINK", MONTHLY);
    vi.stubEnv("NEXT_PUBLIC_UNLIMITED_REFERRAL_LINK", REFERRAL);
    plan.referred = true;
    const html = render({ status: "canceled", currentPeriodEnd: "2026-10-10T15:00:00Z" });
    expect(html).toContain('data-plan="ended"');
    expect(startHref(html)).toBe(`${MONTHLY}?client_reference_id=${REF}`);
    expect(html).not.toContain(PLAN_REFERRAL_COPY.friend);
  });

  it("a kid sees only that their grown-up looks after it, and nothing is read for them", () => {
    vi.stubEnv("NEXT_PUBLIC_UNLIMITED_LINK", MONTHLY);
    vi.stubEnv("NEXT_PUBLIC_UNLIMITED_REFERRAL_LINK", REFERRAL);
    plan.referred = true;
    const html = render({}, "kid-3f2a@kids.agathon.app");
    expect(html).toContain('data-plan="kid"');
    expect(html).not.toContain(PLAN_REFERRAL_COPY.friend);
    expect(plan.readFor).toEqual([null]);
  });
});
