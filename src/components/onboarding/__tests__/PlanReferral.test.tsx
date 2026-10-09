/**
 * The plan screen for a family a friend invited (src/components/onboarding/PlanOffer.tsx `friendMonth`,
 * PlanScreen.tsx with useReferred): "First month free" and why, the first charge 30 days out, only
 * where the referral link is set, never on a plan started again, never for a kid; and without it the
 * #27 card exactly. The session, the plan, the referral read and the router are fakes; the markup is
 * the server render (no effects run).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NO_UNLIMITED, UNLIMITED_PLAN, type UnlimitedState } from "@/lib/billing/unlimited";
import { PLAN_REFERRAL_COPY } from "@/lib/billing/planChoice";
import { PLAN_COPY } from "@/lib/onboarding/plan";

const world = vi.hoisted(() => ({
  email: "parent@example.com",
  state: null as unknown as UnlimitedState,
  referral: { referred: false, known: true },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => undefined, push: () => undefined }) }));
vi.mock("@/components/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u-parent", email: world.email }, session: null, loading: false, authError: null, retryAuth: () => undefined }),
  AuthErrorBanner: () => null,
}));
vi.mock("@/components/app/AppHeader", () => ({ AppHeader: () => null }));
vi.mock("@/lib/billing/useUnlimited", () => ({ useUnlimited: () => ({ state: world.state, loading: false, known: true, refresh: () => undefined }) }));
vi.mock("@/lib/billing/useReferred", () => ({ useReferred: () => world.referral }));

const { PlanScreen } = await import("../PlanScreen");
const { PlanOffer } = await import("../PlanOffer");

/** the markup with its entities read back (apostrophes are escaped) */
const clean = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const REF = "0f8fad5b-d9cb-469f-a165-70867728950e";
const DATE = "Saturday, October 10";
const PRICE = `$${UNLIMITED_PLAN.monthlyUsd}`;
const screen = (state: Partial<UnlimitedState> = {}) => {
  world.state = { ...NO_UNLIMITED, checkoutRef: REF, ...state };
  return clean(renderToStaticMarkup(<PlanScreen />));
};
const links = ({ referral = true } = {}) => {
  vi.stubEnv("NEXT_PUBLIC_UNLIMITED_LINK", "https://buy.stripe.com/test_monthly");
  vi.stubEnv("NEXT_PUBLIC_UNLIMITED_REFERRAL_LINK", referral ? "https://buy.stripe.com/test_referral" : "");
};

beforeEach(() => {
  vi.useFakeTimers();
  // Friday 9 October 2026, noon in New York
  vi.setSystemTime(new Date("2026-10-09T16:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  world.email = "parent@example.com";
  world.referral = { referred: false, known: true };
});

describe("the plan card with a friend's month", () => {
  it("says the first month is free, and why, under the price; the rest of the card is the same", () => {
    const html = clean(renderToStaticMarkup(<PlanOffer view="offer" chargeDate={DATE} friendMonth onStart={vi.fn()} onContinue={vi.fn()} />));
    expect(html).toContain(`<s>${PRICE}/month</s>`);
    expect(html).toContain(PLAN_REFERRAL_COPY.friendFree);
    expect(html).not.toContain(PLAN_COPY.free);
    const friendLine = html.match(/<p[^>]*data-testid="plan-friend"[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? "";
    expect(friendLine.replace(/<[^>]+>/g, "").trim()).toBe(PLAN_REFERRAL_COPY.friend);
    // two unbreakable halves: a phone breaks it before the reason, never inside it
    expect(friendLine.match(/<span[^>]*>[^<]*<\/span>/g)).toEqual([
      expect.stringContaining(">Your first month is free<"),
      expect.stringContaining(">(a friend invited you)<"),
    ]);
    expect(html).toContain(PLAN_COPY.then);
    for (const p of PLAN_COPY.perks) expect(html).toContain(p.text);
    expect(html).toContain(PLAN_COPY.disclosure(DATE));
    expect(html.match(/<button/g)).toHaveLength(1);
  });

  it("never on a plan started again, with no checkout, or for a kid", () => {
    for (const view of ["restart", "soon"] as const) {
      const html = clean(renderToStaticMarkup(<PlanOffer view={view} chargeDate={DATE} friendMonth onStart={vi.fn()} onContinue={vi.fn()} />));
      expect(html, view).not.toContain(PLAN_REFERRAL_COPY.friend);
      expect(html, view).not.toContain(PLAN_REFERRAL_COPY.friendFree);
    }
    const kid = clean(renderToStaticMarkup(<PlanOffer view="offer" kid chargeDate={DATE} friendMonth onStart={vi.fn()} onContinue={vi.fn()} />));
    expect(kid).toContain('data-view="kid"');
    expect(kid).not.toContain(PLAN_REFERRAL_COPY.friend);
    expect(kid).not.toMatch(/\$\d/);
  });

  it("without it: the #27 card", () => {
    const html = clean(renderToStaticMarkup(<PlanOffer view="offer" chargeDate={DATE} onStart={vi.fn()} onContinue={vi.fn()} />));
    expect(html).toContain(PLAN_COPY.free);
    expect(html).not.toContain("plan-friend");
  });
});

describe("the /welcome/plan route", () => {
  it("a referred family where the link is set: the friend's month, the first charge 30 days out", () => {
    links();
    world.referral = { referred: true, known: true };
    const html = screen();
    expect(html).toContain('data-testid="plan-friend"');
    expect(html).toContain(`The card is charged ${PRICE} on Sunday, November 8, then every month`);
  });

  it("not referred, or no referral link: the usual 7 days", () => {
    links();
    expect(screen()).not.toContain("plan-friend");
    expect(screen()).toContain(`The card is charged ${PRICE} on Friday, October 16`);
    links({ referral: false });
    world.referral = { referred: true, known: true };
    expect(screen()).not.toContain("plan-friend");
    expect(screen()).toContain(PLAN_COPY.disclosure("Friday, October 16"));
  });

  it("waits for the referral read before showing any offer", () => {
    links();
    world.referral = { referred: false, known: false };
    expect(screen()).not.toContain('data-onboarding="plan"');
  });

  it("a plan started again: no friend's month, the plan's own date", () => {
    links();
    world.referral = { referred: true, known: true };
    const html = screen({ status: "canceled" });
    expect(html).toContain('data-view="restart"');
    expect(html).not.toContain(PLAN_REFERRAL_COPY.friend);
    expect(html).toContain(`The card is charged ${PRICE} on Friday, October 16`);
  });

  it("a kid profile: their grown-up looks after it", () => {
    links();
    world.referral = { referred: true, known: true };
    world.email = "kid-0f8fad5b@kids.agathon.app";
    const html = screen();
    expect(html).toContain('data-view="kid"');
    expect(html).not.toMatch(/\$\d/);
  });
});
