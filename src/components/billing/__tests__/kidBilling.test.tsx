import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NO_UNLIMITED, type UnlimitedState, type UnlimitedStatus } from "@/lib/billing/unlimited";
import { OUT_OF_INK_COPY } from "@/lib/billing/outOfInk";
import { FAMILY_COPY } from "@/lib/family/copy";

/**
 * Kids never see billing (docs/KIDS-COME-BACK.md). A kid profile shares the grown-up's plan, so when
 * the grown-up's payment fails (past_due), a second plan waits for its first charge (repeat_trial)
 * or the plan ended, the kid's board must not show the price, the plan screen or the billing
 * portal (prefilled with the kid's address, which has no mailbox).
 */

const KID = "kid-3f2a9c1e-0000-4000-8000-000000000001@kids.agathon.app";
const PARENT = "parent@example.com";

const fixture = vi.hoisted(() => ({
  email: "" as string,
  plan: null as UnlimitedState | null,
  balance: 0,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/lib/supabase", () => ({ supabase: { auth: {} } }));
vi.mock("@/components/AuthProvider", () => ({
  useAuth: () => ({ user: fixture.email ? { id: "u1", email: fixture.email, user_metadata: { display_name: "Ben" } } : null, loading: false, authError: null }),
}));
vi.mock("@/lib/billing/useUnlimited", () => ({
  useUnlimited: () => ({ state: fixture.plan, loading: false, known: true, refresh: () => undefined }),
}));
vi.mock("@/lib/billing/useInkSummary", () => ({
  useInkSummary: () => ({ summary: { balance: fixture.balance }, loading: false, error: null, reload: () => undefined }),
}));
vi.mock("@/components/admin/useIsAdmin", () => ({ useIsAdmin: () => false }));
vi.mock("@/components/FeatureLabsPanel", () => ({ FeatureLabsPanel: () => null }));
vi.mock("@/components/BugReportButton", () => ({ BugReportButton: () => null }));

const { OutOfInkPanel } = await import("../OutOfInkPanel");
const { InkMeter } = await import("../InkMeter");
const { AppHeader } = await import("@/components/app/AppHeader");

/** the markup with its entities read back (apostrophes are escaped) */
const html = (el: React.ReactElement) => renderToStaticMarkup(el).replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

function as(email: string, status: UnlimitedStatus, balance = 0) {
  fixture.email = email;
  fixture.plan = { ...NO_UNLIMITED, status, checkoutRef: "0f8fad5b-d9cb-469f-a165-70867728950e", currentPeriodEnd: "2026-11-10T15:00:00Z" };
  fixture.balance = balance;
}

/** everything a grown-up's billing would show: a price, a plan screen, Stripe, the account's Billing */
function expectNoBilling(out: string) {
  expect(out).not.toMatch(/\$\d/);
  expect(out).not.toContain("billing.stripe.com");
  expect(out).not.toContain("buy.stripe.com");
  expect(out).not.toContain("prefilled_email");
  expect(out).not.toContain("kids.agathon.app");
  expect(out).not.toContain("#billing");
  expect(out).not.toContain('data-testid="plan-offer-start"');
  expect(out).not.toContain(OUT_OF_INK_COPY.seePlan);
  expect(out).not.toMatch(/Fix payment|Manage|Update your card|Start the free trial/);
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_BILLING_PORTAL_URL", "https://billing.stripe.com/p/login/test_portal");
  vi.stubEnv("NEXT_PUBLIC_UNLIMITED_LINK", "https://buy.stripe.com/test_unlimited");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the out-of-ink panel, for a kid", () => {
  const moods: UnlimitedStatus[] = ["past_due", "repeat_trial", "incomplete", "none", "canceled"];

  for (const status of moods) {
    it(`the grown-up's plan is ${status}: "Ask your grown-up" and nothing about billing, in the dialog and inline`, () => {
      as(KID, status);
      for (const variant of ["dialog", "inline"] as const) {
        const out = html(<OutOfInkPanel variant={variant} outOfInk footer={<button type="button">{OUT_OF_INK_COPY.notNow}</button>} />);
        expect(out).toContain('data-state="kid"');
        expect(out).toContain(FAMILY_COPY.kidHelpPausedTitle);
        expect(out).toContain(FAMILY_COPY.kidHelpPaused);
        expectNoBilling(out);
        // the dialog's own way out stays
        expect(out).toContain(OUT_OF_INK_COPY.notNow);
      }
    });
  }

  it("the inline panels (Ask, lecture) pass no footer: just the words, no buttons", () => {
    as(KID, "past_due");
    const out = html(<OutOfInkPanel variant="inline" titleAs="p" outOfInk />);
    expect(out).toContain('data-state="kid"');
    expect(out).not.toContain("<button");
    expect(out).not.toContain("<a ");
  });

  it("the plan came on while it was open: all set, as for anyone", () => {
    as(KID, "active");
    const out = html(<OutOfInkPanel variant="dialog" />);
    expect(out).toContain('data-state="unlimited"');
    expectNoBilling(out);
  });

  it("a grown-up still gets the fix: Fix payment to the portal, prefilled with their own address", () => {
    as(PARENT, "past_due");
    const out = html(<OutOfInkPanel variant="dialog" outOfInk />);
    expect(out).toContain('data-state="plan"');
    expect(out).toContain("https://billing.stripe.com/p/login/test_portal?prefilled_email=parent%40example.com");
  });

  it("a grown-up without a plan is offered the free trial", () => {
    as(PARENT, "none");
    const out = html(<OutOfInkPanel variant="dialog" outOfInk />);
    expect(out).toContain('data-state="offer"');
    expect(out).toContain("$25 a month");
    expect(out).toContain('data-testid="plan-offer-start"');
  });
});

describe("the board's ink meter, for a kid", () => {
  it("no meter, whatever the grown-up's plan is doing", () => {
    for (const status of ["past_due", "repeat_trial", "incomplete", "trialing", "active"] as const) {
      as(KID, status, 40);
      expect(html(<InkMeter />)).toBe("");
    }
  });

  it("a grown-up's plan with a payment to fix: the meter is a button to the ink dialog", () => {
    as(PARENT, "past_due", 40);
    const out = html(<InkMeter />);
    expect(out).toMatch(/<button[^>]*data-testid="ink-meter"/);
  });
});

describe("the app bar, for a kid", () => {
  it("no Unlimited pill and no ink meter, so nothing links to Billing", () => {
    for (const status of ["active", "trialing", "past_due", "repeat_trial"] as const) {
      as(KID, status, 40);
      const out = html(<AppHeader />);
      expect(out).not.toContain('data-testid="ink-meter"');
      expect(out).not.toContain("/account#billing");
      expect(out).not.toContain(KID);
      expect(out).toContain(">Ben<");
    }
  });

  it("a grown-up's Unlimited pill links to Billing", () => {
    as(PARENT, "active", 40);
    const out = html(<AppHeader />);
    const pill = out.match(/<a[^>]*data-testid="ink-meter"[^>]*>/)?.[0] ?? "";
    expect(pill).toContain('data-tone="unlimited"');
    expect(pill).toContain('href="/account#billing"');
  });
});
