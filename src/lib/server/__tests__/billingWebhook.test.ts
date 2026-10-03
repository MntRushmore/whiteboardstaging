import { beforeEach, describe, expect, it, vi } from "vitest";

// The handler logs every rejected signature at warn; keep the 120-request rate-limit test quiet.
vi.hoisted(() => {
  process.env.LOG_LEVEL = "silent";
});

// The route takes its env, store and clock from `webhookDeps`; each handler below brings its own.
const deps = vi.hoisted(() => ({ current: null as WebhookDeps | null }));
vi.mock("@/lib/server/billingWebhook", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/server/billingWebhook")>();
  const pick = () => deps.current ?? real.webhookDeps;
  return {
    ...real,
    webhookDeps: {
      getEnv: () => pick().getEnv(),
      createStore: (url: string, key: string) => pick().createStore(url, key),
      now: () => pick().now(),
      confirmStarted: (subscriptionId: string, log: import("pino").Logger) => pick().confirmStarted(subscriptionId, log),
      defer: (work: () => Promise<unknown>) => pick().defer(work),
    },
  };
});

import { POST } from "@/app/api/billing/webhook/route";
import {
  HANDLED_EVENTS,
  deferAfterResponse,
  linkOutcomeOf,
  livemodeAccepted,
  mapBillingEvent,
  packIdOf,
  paidAmountOf,
  periodEndOf,
  subscriptionEventAt,
  subscriptionPlanOf,
  type ApplyOutcome,
  type BillingEvent,
  type BillingStore,
  type GrantOutcome,
  type InkPurchase,
  type InkRefund,
  type InkReview,
  type LinkOutcome,
  type ReverseOutcome,
  type UnlimitedLink,
  type UnlimitedSubscription,
  type WebhookDeps,
  type WebhookEnv,
} from "@/lib/server/billingWebhook";

/** The route's POST with `handlerDeps` standing in for its env, store and clock. */
function createWebhookHandler(handlerDeps: WebhookDeps): (req: Request) => Promise<Response> {
  return (req) => {
    deps.current = handlerDeps;
    return POST(req);
  };
}
import { resetRateLimits } from "@/lib/server/rate-limit";
import { sendUnlimitedStarted } from "@/lib/email/unlimitedStarted";
import { fakeDeps as fakeEmailDeps } from "@/lib/email/__tests__/fakes";
import { signStripePayload } from "@/lib/server/webhookSignature";
import realEvents from "./fixtures/stripe-unlimited-subscription-events.json";

const USER_ID = "8d2a3f1e-4b6c-4d7e-9f01-23456789abcd";
/** That account's checkout reference (profiles.checkout_ref): what the Unlimited link carries instead of the user id. */
const CHECKOUT_REF = "0b7e9c1a-5d2f-4e3a-8b6c-9d0e1f2a3b4c";
const SECRET = "whsec_unit";
const NOW = 1_760_000_000;
const PRICE_MAP = { price_small: "small", price_medium: "medium", price_large: "large" };

function event(type: string, object: Record<string, unknown>, id = "evt_1"): BillingEvent {
  return { id, type, data: { object } };
}

/** A Payment Link's Checkout Session as Stripe sends it in checkout.session.completed. */
function session(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "cs_test_1",
    object: "checkout.session",
    mode: "payment",
    payment_status: "paid",
    status: "complete",
    client_reference_id: USER_ID,
    customer: "cus_1",
    payment_intent: "pi_1",
    amount_total: 2000,
    currency: "usd",
    metadata: { app: "agathon-classroom", pack_id: "medium", price_id: "price_medium" },
    ...overrides,
  };
}

/** The charge in charge.refunded (the Payment Link tags its payment intent, so the charge carries the tag). */
function charge(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "ch_1",
    object: "charge",
    payment_intent: "pi_1",
    amount: 2000,
    amount_refunded: 2000,
    refunded: true,
    metadata: { app: "agathon-classroom", pack_id: "medium" },
    ...overrides,
  };
}

/** What Fuime's own traffic on the shared account looks like (its handlers key on fuime_event_id). */
const FUIME_SESSION = {
  id: "cs_live_fuime",
  object: "checkout.session",
  mode: "payment",
  payment_status: "paid",
  client_reference_id: "venture-42",
  customer: "cus_fuime",
  payment_intent: "pi_fuime",
  amount_total: 15000,
  currency: "usd",
  customer_details: { email: "buyer@fuime.example", name: "A Buyer", address: { line1: "1 Main St", city: "Austin" } },
  metadata: { fuime_event_id: "evt_founders_weekend" },
};
const FUIME_CHARGE = {
  id: "ch_fuime",
  object: "charge",
  payment_intent: "pi_fuime",
  amount: 15000,
  amount_refunded: 15000,
  refunded: true,
  billing_details: { email: "buyer@fuime.example", name: "A Buyer" },
  metadata: { fuime_event_id: "evt_founders_weekend" },
};

/* Agathon Unlimited fixtures: what the subscription Payment Link (scripts/stripe-setup.mjs) produces. */
const WEEK = 7 * 86_400;
const UNLIMITED_TAG = { app: "agathon-classroom", plan_id: "unlimited" };

/** The Unlimited link's Checkout Session: a free week, so nothing is paid at checkout. */
function unlimitedSession(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "cs_sub_1",
    object: "checkout.session",
    mode: "subscription",
    payment_status: "no_payment_required",
    status: "complete",
    client_reference_id: CHECKOUT_REF,
    customer: "cus_u",
    subscription: "sub_1",
    amount_total: 0,
    currency: "usd",
    livemode: false,
    customer_details: { email: "parent@example.com" },
    metadata: { ...UNLIMITED_TAG, price_id: "price_unlimited" },
    ...overrides,
  };
}

/** A subscription as customer.subscription.* carries it (the API shape before 2025-03-31: period end on the subscription). */
function subscription(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "sub_1",
    object: "subscription",
    customer: "cus_u",
    status: "trialing",
    cancel_at_period_end: false,
    cancel_at: null,
    canceled_at: null,
    ended_at: null,
    trial_start: NOW,
    trial_end: NOW + WEEK,
    current_period_start: NOW,
    current_period_end: NOW + WEEK,
    livemode: false,
    metadata: UNLIMITED_TAG,
    items: {
      object: "list",
      data: [{ id: "si_1", price: { id: "price_unlimited", unit_amount: 2500, recurring: { interval: "month" }, metadata: UNLIMITED_TAG } }],
    },
    ...overrides,
  };
}

/** Fuime sells subscriptions on the shared account too (its handlers key on fuime_subscription_kind). */
const FUIME_SUBSCRIPTION = subscription({
  id: "sub_fuime",
  customer: "cus_fuime",
  status: "active",
  metadata: { fuime_subscription_kind: "membership" },
  items: { object: "list", data: [{ id: "si_f", price: { id: "price_fuime", metadata: {} } }] },
});

function subEvent(type: string, object: Record<string, unknown>, id: string, created: number): BillingEvent {
  return { id, type, created, data: { object } };
}

/**
 * Real events from Stripe test mode (2026-10-03, this account's API version 2026-07-29.dahlia): an
 * Unlimited subscription with the free week, cancelled in the same second, then deleted. Made with
 * the API (customer + subscription with the plan's price and metadata), not through Checkout.
 */
const REAL = realEvents as unknown as Record<"customer.subscription.created" | "customer.subscription.updated" | "customer.subscription.deleted", BillingEvent>;

describe("mapBillingEvent: checkout", () => {
  it("a paid one-time checkout grants the pack in metadata.pack_id to client_reference_id", () => {
    expect(mapBillingEvent(event("checkout.session.completed", session()), {})).toEqual({
      kind: "grant",
      purchase: {
        userId: USER_ID,
        packId: "medium",
        checkoutSessionId: "cs_test_1",
        paymentIntentId: "pi_1",
        customerId: "cus_1",
        amountCents: 2000,
        currency: "usd",
        customerEmail: null,
      },
    });
  });

  it("checkout.session.async_payment_succeeded grants the same way (a delayed method that has now paid)", () => {
    const mapped = mapBillingEvent(event("checkout.session.async_payment_succeeded", session({ payment_status: "paid" })), {});
    expect(mapped).toMatchObject({ kind: "grant", purchase: { checkoutSessionId: "cs_test_1", packId: "medium" } });
  });

  it("a delayed method's completed-but-unpaid session waits for async_payment_succeeded", () => {
    expect(mapBillingEvent(event("checkout.session.completed", session({ payment_status: "unpaid" })), {})).toEqual({
      kind: "ignored",
      reason: "not paid yet (payment_status unpaid)",
    });
  });

  it("a checkout where nothing was paid (no_payment_required, e.g. a 100 % code) is recorded for review, never granted", () => {
    const mapped = mapBillingEvent(event("checkout.session.completed", session({ payment_status: "no_payment_required", amount_total: 0, payment_intent: null })), {});
    expect(mapped).toMatchObject({ kind: "review", review: { reason: "not paid (payment_status no_payment_required)", amountCents: 0, packId: "medium", clientReferenceId: USER_ID } });
  });

  it("under Adaptive Pricing the amount checked is the one in the merchant's currency", () => {
    const local = session({ amount_total: 1890, currency: "eur", currency_conversion: { amount_total: 2000, source_currency: "usd", fx_rate: "0.945" } });
    expect(paidAmountOf(local)).toEqual({ amountCents: 2000, currency: "usd" });
    expect(mapBillingEvent(event("checkout.session.completed", local), {})).toMatchObject({ kind: "grant", purchase: { amountCents: 2000, currency: "usd" } });
    expect(paidAmountOf(session({ amount_total: 2000, currency: "USD" }))).toEqual({ amountCents: 2000, currency: "usd" });
  });

  it("ignores a subscription checkout that is not Agathon Unlimited (the retired Plus/Pro links) and a session without a mode", () => {
    expect(mapBillingEvent(event("checkout.session.completed", session({ mode: "subscription" })), {})).toMatchObject({ kind: "ignored", reason: /mode subscription/ });
    const plus = session({ mode: "subscription", subscription: "sub_plus", metadata: { app: "agathon-classroom", plan_id: "plus" } });
    expect(mapBillingEvent(event("checkout.session.completed", plus), {})).toMatchObject({ kind: "ignored", reason: /plan plus/ });
    expect(mapBillingEvent(event("checkout.session.completed", session({ mode: undefined })), {})).toMatchObject({ kind: "ignored", reason: /mode missing/ });
  });

  it("a session without metadata.app = agathon-classroom is foreign, whatever else it carries", () => {
    for (const metadata of [{}, { pack_id: "medium" }, { app: "fuime", pack_id: "medium" }, { fuime_event_id: "evt_123" }]) {
      expect(mapBillingEvent(event("checkout.session.completed", session({ metadata })), PRICE_MAP), JSON.stringify(metadata)).toEqual({
        kind: "foreign",
        reason: "checkout session is not tagged app=agathon-classroom",
      });
    }
    // even with a price that INK_PRICE_MAP knows: the tag decides, the map only names the pack
    expect(mapBillingEvent(event("checkout.session.completed", session({ metadata: { price_id: "price_small" } })), PRICE_MAP)).toMatchObject({ kind: "foreign" });
  });

  it("a paid Agathon session without a user id, with a non-uuid one, or without a resolvable pack is recorded for review", () => {
    expect(mapBillingEvent(event("checkout.session.completed", session({ client_reference_id: null, customer_details: { email: "kid@example.com" } })), {})).toMatchObject({
      kind: "review",
      review: { reason: /client_reference_id/, customerEmail: "kid@example.com", checkoutSessionId: "cs_test_1", paymentIntentId: "pi_1" },
    });
    expect(mapBillingEvent(event("checkout.session.completed", session({ client_reference_id: "not-a-uuid" })), {})).toMatchObject({
      kind: "review",
      review: { reason: /not a user id/, clientReferenceId: "not-a-uuid" },
    });
    expect(mapBillingEvent(event("checkout.session.completed", session({ metadata: { app: "agathon-classroom" } })), PRICE_MAP)).toMatchObject({
      kind: "review",
      review: { reason: /INK_PRICE_MAP/, packId: null },
    });
    // without a session id there is nothing to key a review on
    expect(mapBillingEvent(event("checkout.session.completed", session({ id: undefined })), {})).toMatchObject({ kind: "ignored", reason: /no id/ });
  });

  it("falls back to metadata.user_id when client_reference_id is missing, and lower-cases the id", () => {
    const mapped = mapBillingEvent(
      event("checkout.session.completed", session({ client_reference_id: null, metadata: { app: "agathon-classroom", pack_id: "small", user_id: USER_ID.toUpperCase() } })),
      {},
    );
    expect(mapped).toMatchObject({ kind: "grant", purchase: { userId: USER_ID, packId: "small" } });
  });

  it("missing amount / currency / ids map to null, not to wrong values", () => {
    const mapped = mapBillingEvent(event("checkout.session.completed", session({ amount_total: "2000", currency: undefined, customer: null, payment_intent: { id: "pi_x" } })), {});
    expect(mapped).toMatchObject({ kind: "grant", purchase: { amountCents: null, currency: null, customerId: null, paymentIntentId: "pi_x" } });
    // (the database then grants nothing and records the session: no amount, no ink)
  });
});

describe("packIdOf", () => {
  it("prefers metadata.pack_id, normalised", () => {
    expect(packIdOf({ metadata: { pack_id: " Large " } }, PRICE_MAP)).toBe("large");
  });
  it("falls back to INK_PRICE_MAP for the line item price (string or expanded) or metadata.price_id", () => {
    expect(packIdOf({ line_items: { data: [{ price: "price_small" }] } }, PRICE_MAP)).toBe("small");
    expect(packIdOf({ line_items: { data: [{ price: { id: "price_large" } }] } }, PRICE_MAP)).toBe("large");
    expect(packIdOf({ metadata: { price_id: "price_medium" } }, PRICE_MAP)).toBe("medium");
  });
  it("refuses a malformed pack id from metadata or from the map", () => {
    expect(packIdOf({ metadata: { pack_id: "Robert'); drop table" } }, {})).toBeNull();
    expect(packIdOf({ metadata: { price_id: "price_x" } }, { price_x: "NOT OK" })).toBeNull();
    expect(packIdOf({}, PRICE_MAP)).toBeNull();
  });
});

describe("livemodeAccepted", () => {
  it("STRIPE_LIVEMODE pins the mode; unset, deployments take live only and a localhost dev server either", () => {
    expect(livemodeAccepted(true, "true", "whiteboard.rushilchopra.com")).toBe(true);
    expect(livemodeAccepted(false, "true", "whiteboard.rushilchopra.com")).toBe(false);
    expect(livemodeAccepted(false, "false", "preview.example.vercel.app")).toBe(true);
    expect(livemodeAccepted(true, " FALSE ", "localhost")).toBe(false);
    expect(livemodeAccepted(true, undefined, "whiteboard.rushilchopra.com")).toBe(true);
    expect(livemodeAccepted(false, undefined, "whiteboard.rushilchopra.com")).toBe(false);
    expect(livemodeAccepted(undefined, undefined, "whiteboard.rushilchopra.com")).toBe(false);
    expect(livemodeAccepted(false, undefined, "localhost")).toBe(true);
    expect(livemodeAccepted(undefined, undefined, "127.0.0.1")).toBe(true);
  });
});

describe("mapBillingEvent: refunds and the rest", () => {
  it("charge.refunded reverses by payment intent with the cumulative refunded amount, saying whether the charge is tagged", () => {
    expect(mapBillingEvent(event("charge.refunded", charge()), {})).toEqual({
      kind: "reverse",
      refund: { paymentIntentId: "pi_1", chargeId: "ch_1", amountCents: 2000, refundedCents: 2000, fullyRefunded: true, tagged: true },
    });
    const partial = mapBillingEvent(event("charge.refunded", charge({ amount_refunded: 500, refunded: false, payment_intent: { id: "pi_2" }, metadata: {} })), {});
    expect(partial).toMatchObject({ kind: "reverse", refund: { paymentIntentId: "pi_2", refundedCents: 500, fullyRefunded: false, tagged: false } });
  });

  it("a charge without a payment intent or with nothing refunded is ignored if ours, foreign otherwise", () => {
    expect(mapBillingEvent(event("charge.refunded", charge({ payment_intent: null })), {})).toMatchObject({ kind: "ignored", reason: /payment_intent/ });
    expect(mapBillingEvent(event("charge.refunded", charge({ amount_refunded: 0, refunded: false })), {})).toMatchObject({ kind: "ignored", reason: /nothing refunded/ });
    expect(mapBillingEvent(event("charge.refunded", charge({ payment_intent: null, metadata: { fuime_event_id: "e" } })), {})).toMatchObject({ kind: "foreign" });
  });

  it("event types the endpoint does not subscribe to are foreign", () => {
    for (const type of ["invoice.paid", "invoice.payment_failed", "checkout.session.async_payment_failed", "customer.subscription.trial_will_end"]) {
      expect(mapBillingEvent(event(type, { id: "x", metadata: { app: "agathon-classroom", plan_id: "unlimited" } }), {})).toMatchObject({
        kind: "foreign",
        reason: new RegExp(type.replace(/\./g, "\\.")),
      });
    }
  });

  it("the retired Plus/Pro subscriptions (tagged, no Unlimited plan) are ignored, writing nothing", () => {
    for (const type of ["customer.subscription.updated", "customer.subscription.deleted"]) {
      expect(mapBillingEvent(event(type, { id: "sub_old", status: "active", metadata: { app: "agathon-classroom" } }), {})).toMatchObject({
        kind: "ignored",
        reason: /not an Agathon Unlimited subscription \(plan missing\)/,
      });
    }
  });

  it("HANDLED_EVENTS are exactly the types that can do something", () => {
    expect([...HANDLED_EVENTS]).toEqual([
      "checkout.session.completed",
      "checkout.session.async_payment_succeeded",
      "charge.refunded",
      "customer.subscription.created",
      "customer.subscription.updated",
      "customer.subscription.deleted",
    ]);
    for (const type of HANDLED_EVENTS) {
      const mapped = mapBillingEvent(event(type, { metadata: { app: "agathon-classroom" } }), {});
      if (mapped.kind === "ignored" || mapped.kind === "foreign") expect(mapped.reason).not.toMatch(/unhandled event type/);
    }
  });
});

describe("mapBillingEvent: Agathon Unlimited", () => {
  it("the Unlimited checkout links its subscription to the account whose checkout ref is client_reference_id, with the payer's email", () => {
    expect(mapBillingEvent(event("checkout.session.completed", unlimitedSession()), {})).toEqual({
      kind: "link",
      link: {
        subscriptionId: "sub_1",
        checkoutRef: CHECKOUT_REF,
        clientReferenceId: CHECKOUT_REF,
        customerId: "cus_u",
        checkoutSessionId: "cs_sub_1",
        livemode: false,
        payerEmail: "parent@example.com",
        problem: null,
      },
    });
    const expanded = unlimitedSession({ subscription: { id: "sub_2" }, customer: { id: "cus_2" }, payment_status: "paid", client_reference_id: CHECKOUT_REF.toUpperCase() });
    expect(mapBillingEvent(event("checkout.session.completed", expanded), {})).toMatchObject({ kind: "link", link: { subscriptionId: "sub_2", customerId: "cus_2", checkoutRef: CHECKOUT_REF } });
  });

  it("the payer's email: the checkout's customer_details, else customer_email, only when it is one address", () => {
    const payer = (overrides: Record<string, unknown>) => {
      const mapped = mapBillingEvent(event("checkout.session.completed", unlimitedSession(overrides)), {});
      return mapped.kind === "link" ? mapped.link.payerEmail : "not a link";
    };
    expect(payer({ customer_details: { email: " grown.up@example.com " } })).toBe("grown.up@example.com");
    expect(payer({ customer_details: null, customer_email: "prefilled@example.com" })).toBe("prefilled@example.com");
    for (const email of [null, "", "nobody", "a@b, c@d", "<a@b>", `${"x".repeat(320)}@example.com`]) {
      expect(payer({ customer_details: { email }, customer_email: null }), String(email)).toBeNull();
    }
  });

  it("an Unlimited checkout without a usable ref is still a link, to nobody, saying why; metadata.user_id is never read", () => {
    expect(mapBillingEvent(event("checkout.session.completed", unlimitedSession({ client_reference_id: null })), {})).toMatchObject({
      kind: "link",
      link: { checkoutRef: null, problem: /opened outside the app/ },
    });
    expect(mapBillingEvent(event("checkout.session.completed", unlimitedSession({ client_reference_id: "kid-42" })), {})).toMatchObject({
      kind: "link",
      link: { checkoutRef: null, clientReferenceId: "kid-42", problem: /not a checkout reference/ },
    });
    // the packs' fallback to metadata.user_id does not apply to the plan
    const viaMetadata = unlimitedSession({ client_reference_id: null, metadata: { ...UNLIMITED_TAG, user_id: USER_ID } });
    expect(mapBillingEvent(event("checkout.session.completed", viaMetadata), {})).toMatchObject({ kind: "link", link: { checkoutRef: null } });
    expect(mapBillingEvent(event("checkout.session.completed", unlimitedSession({ subscription: null })), {})).toMatchObject({ kind: "ignored", reason: /without a subscription id/ });
  });

  it("an untagged subscription checkout is foreign, like any other session", () => {
    expect(mapBillingEvent(event("checkout.session.completed", unlimitedSession({ metadata: { plan_id: "unlimited" } })), {})).toMatchObject({ kind: "foreign" });
  });

  it("a subscription event carries the plan's state, with Stripe's Unix times as ISO and the event's time for ordering", () => {
    expect(mapBillingEvent(subEvent("customer.subscription.created", subscription(), "evt_sub", NOW + 5), {})).toEqual({
      kind: "subscription",
      subscription: {
        subscriptionId: "sub_1",
        customerId: "cus_u",
        status: "trialing",
        priceId: "price_unlimited",
        trialEnd: new Date((NOW + WEEK) * 1000).toISOString(),
        currentPeriodEnd: new Date((NOW + WEEK) * 1000).toISOString(),
        cancelAtPeriodEnd: false,
        cancelAt: null,
        canceledAt: null,
        endedAt: null,
        livemode: false,
        eventAt: new Date((NOW + 5) * 1000).toISOString(),
      },
    });
    const cancelling = subscription({ status: "active", cancel_at_period_end: true, cancel_at: NOW + 30 * 86_400, canceled_at: NOW + 60 });
    expect(mapBillingEvent(subEvent("customer.subscription.updated", cancelling, "evt_c", NOW + 60), {})).toMatchObject({
      kind: "subscription",
      subscription: { status: "active", cancelAtPeriodEnd: true, cancelAt: new Date((NOW + 30 * 86_400) * 1000).toISOString() },
    });
  });

  it("reads the period end from the items when the API version moved it there (2025-03-31 and later)", () => {
    const basil = subscription({
      current_period_end: undefined,
      items: { data: [{ id: "si_1", current_period_end: NOW + 100, price: { id: "price_unlimited", metadata: UNLIMITED_TAG } }, { id: "si_2", current_period_end: NOW + 200, price: "price_x" }] },
    });
    expect(periodEndOf(basil)).toBe(new Date((NOW + 200) * 1000).toISOString());
    expect(periodEndOf({})).toBeNull();
    expect(mapBillingEvent(subEvent("customer.subscription.updated", basil, "evt_b", NOW), {})).toMatchObject({
      kind: "subscription",
      subscription: { currentPeriodEnd: new Date((NOW + 200) * 1000).toISOString(), priceId: "price_unlimited" },
    });
  });

  it("knows the plan by the subscription's metadata, or by its price's when the subscription has none", () => {
    expect(subscriptionPlanOf(subscription())).toEqual({ tagged: true, plan: "unlimited" });
    const priceOnly = subscription({ metadata: {} });
    expect(subscriptionPlanOf(priceOnly)).toEqual({ tagged: true, plan: "unlimited" });
    expect(mapBillingEvent(subEvent("customer.subscription.created", priceOnly, "evt_p", NOW), {})).toMatchObject({ kind: "subscription" });
    expect(subscriptionPlanOf(FUIME_SUBSCRIPTION)).toEqual({ tagged: false, plan: null });
  });

  it("Fuime's subscriptions are foreign; ours of another plan are ignored", () => {
    for (const type of ["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"]) {
      expect(mapBillingEvent(subEvent(type, FUIME_SUBSCRIPTION, "evt_f", NOW), {})).toEqual({ kind: "foreign", reason: "subscription is not tagged app=agathon-classroom" });
    }
    const pro = subscription({ metadata: { app: "agathon-classroom", plan_id: "pro" }, items: { data: [] } });
    expect(mapBillingEvent(subEvent("customer.subscription.updated", pro, "evt_pro", NOW), {})).toMatchObject({ kind: "ignored", reason: /plan pro/ });
  });

  it("a deleted subscription has ended, whatever its object says; an unknown status is ignored", () => {
    expect(mapBillingEvent(subEvent("customer.subscription.deleted", subscription({ status: "canceled", ended_at: NOW + 9 }), "evt_d", NOW + 9), {})).toMatchObject({
      kind: "subscription",
      subscription: { status: "canceled", endedAt: new Date((NOW + 9) * 1000).toISOString() },
    });
    expect(mapBillingEvent(subEvent("customer.subscription.deleted", subscription({ status: "active" }), "evt_d2", NOW), {})).toMatchObject({ subscription: { status: "canceled" } });
    expect(mapBillingEvent(subEvent("customer.subscription.deleted", subscription({ status: "incomplete_expired" }), "evt_d3", NOW), {})).toMatchObject({ subscription: { status: "incomplete_expired" } });
    expect(mapBillingEvent(subEvent("customer.subscription.updated", subscription({ status: "frozen" }), "evt_u", NOW), {})).toEqual({ kind: "ignored", reason: "unknown subscription status frozen" });
    expect(mapBillingEvent(subEvent("customer.subscription.updated", subscription({ id: undefined }), "evt_u2", NOW), {})).toMatchObject({ kind: "ignored", reason: /no id/ });
  });

  it("reads Stripe's real events (test mode, API 2026-07-29.dahlia: the period end lives on the items)", () => {
    const created = mapBillingEvent(REAL["customer.subscription.created"], {});
    const end = new Date(1791663937 * 1000).toISOString();
    expect(created).toEqual({
      kind: "subscription",
      subscription: {
        subscriptionId: "sub_1UMZUz2Uz4P3wrXOxRDhRuaN",
        customerId: "cus_VNK9o1nLWvGYkL",
        status: "trialing",
        priceId: "price_1UMZTx2Uz4P3wrXOCCQT6Bl1",
        trialEnd: end,
        currentPeriodEnd: end,
        cancelAtPeriodEnd: false,
        cancelAt: null,
        canceledAt: null,
        endedAt: null,
        livemode: false,
        eventAt: new Date(1791059139 * 1000).toISOString(),
      },
    });
    // cancelled in the free week: Stripe sets cancel_at to the trial's end as well
    expect(mapBillingEvent(REAL["customer.subscription.updated"], {})).toMatchObject({
      subscription: { status: "trialing", cancelAtPeriodEnd: true, cancelAt: end, eventAt: new Date(1791059139 * 1000 + 1).toISOString() },
    });
    expect(mapBillingEvent(REAL["customer.subscription.deleted"], {})).toMatchObject({
      subscription: { status: "canceled", endedAt: new Date(1791059154 * 1000).toISOString() },
    });
  });

  it("orders same-second events by type: created, then updated, then deleted", () => {
    expect(subscriptionEventAt({ type: "customer.subscription.created", created: 100 })).toBe(new Date(100_000).toISOString());
    expect(subscriptionEventAt({ type: "customer.subscription.updated", created: 100 })).toBe(new Date(100_001).toISOString());
    expect(subscriptionEventAt({ type: "customer.subscription.deleted", created: 100 })).toBe(new Date(100_002).toISOString());
    expect(subscriptionEventAt({ type: "customer.subscription.updated", created: undefined })).toBeNull();
  });

  it("linkOutcomeOf reads the RPC's answer", () => {
    expect(linkOutcomeOf({ linked: true, user_id: USER_ID, status: "trialing" }, { problem: null })).toEqual({ status: "linked", userId: USER_ID, subscriptionStatus: "trialing" });
    expect(linkOutcomeOf({ linked: false, conflict: true, user_id: "someone" }, { problem: null })).toEqual({ status: "conflict", userId: "someone" });
    expect(linkOutcomeOf({ linked: false, no_account: true, user_id: null }, { problem: null })).toMatchObject({ status: "unlinked", reason: /no account/ });
    expect(linkOutcomeOf({ linked: false, user_id: null }, { problem: "no client_reference_id" })).toEqual({ status: "unlinked", reason: "no client_reference_id" });
  });
});

/* ------------------------------------------------------------------------- */
/* Handler with fakes                                                         */
/* ------------------------------------------------------------------------- */

type StoreLog = {
  recorded: string[];
  /** Every payload that would land in billing_events.payload. */
  payloads: unknown[];
  forgotten: string[];
  grants: InkPurchase[];
  reviews: InkReview[];
  reversals: InkRefund[];
  lookups: string[];
  links: UnlimitedLink[];
  applies: UnlimitedSubscription[];
};

/** An unlimited_subscriptions row as the fake keeps it. */
type PlanRow = {
  userId: string | null;
  payerEmail: string | null;
  status: string | null;
  eventAt: number | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  trialEnd: string | null;
  customerId: string | null;
};

const PRICE: Record<string, number> = { small: 500, medium: 2000, large: 5000 };

/**
 * An in-memory store with the database's semantics: one grant per session id, refunds act on the
 * growth of the cumulative refunded amount and take back at most the balance.
 */
function fakeStore(
  opts: {
    recordError?: string;
    lookupError?: string;
    grant?: (p: InkPurchase) => GrantOutcome | null;
    reverse?: (r: InkRefund) => ReverseOutcome | null;
    forgetError?: string;
    balance?: number;
    link?: (l: UnlimitedLink) => LinkOutcome | null;
    apply?: (s: UnlimitedSubscription) => ApplyOutcome | null;
  } = {},
): BillingStore & { log: StoreLog; balance: () => number; spend: (ink: number) => void; plan: (subscriptionId: string) => PlanRow | undefined } {
  const log: StoreLog = { recorded: [], payloads: [], forgotten: [], grants: [], reviews: [], reversals: [], lookups: [], links: [], applies: [] };
  // unlimited_subscriptions, with the semantics of link_unlimited_checkout / apply_unlimited_subscription
  const plans = new Map<string, PlanRow>();
  // profiles.checkout_ref -> user (link_unlimited_checkout resolves the ref; a user id matches nothing)
  const refs = new Map([[CHECKOUT_REF, USER_ID]]);
  const planRow = (id: string): PlanRow => {
    let row = plans.get(id);
    if (!row) {
      row = { userId: null, payerEmail: null, status: null, eventAt: null, cancelAtPeriodEnd: false, currentPeriodEnd: null, trialEnd: null, customerId: null };
      plans.set(id, row);
    }
    return row;
  };
  const sessions = new Map<string, { ink: number; paymentIntent: string | null; refundedCents: number; asked: number; amount: number }>();
  let balance = opts.balance ?? 300;
  const INK: Record<string, number> = { small: 1000, medium: 5000, large: 14000 };
  return {
    log,
    balance: () => balance,
    spend: (ink) => {
      balance = Math.max(0, balance - ink);
    },
    plan: (id) => plans.get(id),
    async linkSubscription(l) {
      const forced = opts.link?.(l);
      if (forced) return forced;
      log.links.push(l);
      const user = (l.checkoutRef && refs.get(l.checkoutRef)) ?? null;
      const row = planRow(l.subscriptionId);
      row.userId ??= user;
      row.customerId ??= l.customerId;
      row.payerEmail ??= l.payerEmail;
      if (user && row.userId === user) return { status: "linked", userId: user, subscriptionStatus: row.status };
      if (user) return { status: "conflict", userId: row.userId };
      return { status: "unlinked", reason: l.checkoutRef ? "no account has this checkout reference" : (l.problem ?? "no user") };
    },
    async applySubscription(s) {
      const forced = opts.apply?.(s);
      if (forced) return forced;
      log.applies.push(s);
      const row = planRow(s.subscriptionId);
      const at = s.eventAt ? Date.parse(s.eventAt) : Date.now();
      const final = (status: string | null) => status === "canceled" || status === "incomplete_expired";
      if ((final(row.status) && !final(s.status)) || (row.eventAt !== null && at < row.eventAt)) return { status: "stale", current: row.status };
      Object.assign(row, { status: s.status, eventAt: at, cancelAtPeriodEnd: s.cancelAtPeriodEnd, currentPeriodEnd: s.currentPeriodEnd, trialEnd: s.trialEnd });
      row.customerId ??= s.customerId;
      return { status: "applied", userId: row.userId, unlimited: (s.status === "trialing" || s.status === "active") && row.userId !== null };
    },
    async isInkPayment(pi) {
      log.lookups.push(pi);
      if (opts.lookupError) return { error: opts.lookupError };
      return [...sessions.values()].some((s) => s.paymentIntent === pi) || log.reviews.some((r) => r.paymentIntentId === pi);
    },
    async recordEvent(ev) {
      if (opts.recordError) return { status: "error", message: opts.recordError };
      if (log.recorded.includes(ev.id)) return { status: "duplicate" };
      log.recorded.push(ev.id);
      log.payloads.push(ev);
      return { status: "inserted" };
    },
    async forgetEvent(id) {
      if (opts.forgetError) return { error: opts.forgetError };
      log.forgotten.push(id);
      log.recorded = log.recorded.filter((r) => r !== id);
      return { ok: true };
    },
    async recordReview(r) {
      if (log.reviews.some((x) => x.checkoutSessionId === r.checkoutSessionId)) return { recorded: false };
      log.reviews.push(r);
      return { recorded: true };
    },
    async grantPurchase(p) {
      const forced = opts.grant?.(p);
      if (forced) return forced;
      log.grants.push(p);
      if (sessions.has(p.checkoutSessionId)) return { status: "duplicate" };
      if (log.reviews.some((x) => x.checkoutSessionId === p.checkoutSessionId)) return { status: "duplicate" };
      // grant_ink_purchase's checks: a known pack, paid in USD, at least the pack's price
      const reason = !(p.packId in INK)
        ? `unknown pack ${p.packId}`
        : p.amountCents === null || p.currency !== "usd"
          ? "no amount on the session"
          : p.amountCents < PRICE[p.packId]
            ? `paid ${p.amountCents} cents for the ${p.packId} pack`
            : null;
      if (reason) {
        log.reviews.push({ ...p, reason, clientReferenceId: p.userId });
        return { status: "review", reason };
      }
      sessions.set(p.checkoutSessionId, { ink: INK[p.packId], paymentIntent: p.paymentIntentId, refundedCents: 0, asked: 0, amount: p.amountCents ?? 0 });
      balance += INK[p.packId];
      return { status: "granted", granted: INK[p.packId], balance };
    },
    async reversePurchase(r) {
      const forced = opts.reverse?.(r);
      if (forced) return forced;
      log.reversals.push(r);
      const s = [...sessions.values()].find((x) => x.paymentIntent === r.paymentIntentId);
      if (!s) return log.reviews.some((x) => x.paymentIntentId === r.paymentIntentId) ? { status: "review" } : { status: "not_found" };
      const cum = r.fullyRefunded ? s.amount : Math.min(r.refundedCents, s.amount);
      if (cum <= s.refundedCents) return { status: "duplicate" };
      const target = cum >= s.amount ? s.ink : Math.round((s.ink * cum) / s.amount);
      const owed = target - s.asked;
      const reversed = Math.min(owed, balance);
      s.refundedCents = cum;
      s.asked = target;
      balance -= reversed;
      return { status: "reversed", reversed, requested: owed, balance };
    },
  };
}

const fullEnv: WebhookEnv = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  STRIPE_WEBHOOK_SECRET: SECRET,
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
  INK_PRICE_MAP: JSON.stringify(PRICE_MAP),
};

/** No email by default: the plan's confirmation has its own tests below (`emailWorld`). */
const NO_EMAIL: Pick<WebhookDeps, "confirmStarted" | "defer"> = { confirmStarted: async () => undefined, defer: () => undefined };

function handlerWith(store: BillingStore, env: Partial<WebhookEnv> = {}, email: Pick<WebhookDeps, "confirmStarted" | "defer"> = NO_EMAIL): (req: Request) => Promise<Response> {
  const deps: WebhookDeps = { getEnv: () => ({ ...fullEnv, ...env }), createStore: () => store, now: () => NOW, ...email };
  return createWebhookHandler(deps);
}

async function signedRequest(body: string, opts: { secret?: string; t?: number; header?: string | null; ip?: string; url?: string } = {}): Promise<Request> {
  const header = opts.header === undefined ? await signStripePayload(body, opts.secret ?? SECRET, opts.t ?? NOW) : opts.header;
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": opts.ip ?? "203.0.113.9" };
  if (header) headers["stripe-signature"] = header;
  return new Request(opts.url ?? "http://localhost/api/billing/webhook", { method: "POST", headers, body });
}

const checkoutBody = JSON.stringify(event("checkout.session.completed", session(), "evt_checkout"));

describe("POST /api/billing/webhook", () => {
  beforeEach(() => resetRateLimits());

  it("grants a signed paid checkout's pack (Medium: +5,000 ink)", async () => {
    const store = fakeStore();
    const res = await handlerWith(store)(await signedRequest(checkoutBody));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(store.log.recorded).toEqual(["evt_checkout"]);
    expect(store.log.grants).toEqual([expect.objectContaining({ userId: USER_ID, packId: "medium", checkoutSessionId: "cs_test_1" })]);
    expect(store.balance()).toBe(5300);
  });

  it("a replayed event is a duplicate and grants nothing", async () => {
    const store = fakeStore();
    const handler = handlerWith(store);
    expect((await handler(await signedRequest(checkoutBody))).status).toBe(200);
    const again = await handler(await signedRequest(checkoutBody));
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ received: true, duplicate: true });
    // the redelivery is applied again (idempotent in the database), so it still grants nothing more
    expect(store.log.grants).toHaveLength(2);
    expect(store.balance()).toBe(5300);
  });

  it("completed + async_payment_succeeded for one session (two event ids) still grant once", async () => {
    const store = fakeStore();
    const handler = handlerWith(store);
    await handler(await signedRequest(checkoutBody));
    const asyncBody = JSON.stringify(event("checkout.session.async_payment_succeeded", session(), "evt_async"));
    const res = await handler(await signedRequest(asyncBody));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, duplicate: true });
    expect(store.balance()).toBe(5300);
  });

  it("a refund reverses the pack's ink; a replay or an echo of the same amount reverses nothing more", async () => {
    const store = fakeStore();
    const handler = handlerWith(store);
    await handler(await signedRequest(checkoutBody));
    const refund = await handler(await signedRequest(JSON.stringify(event("charge.refunded", charge(), "evt_refund"))));
    expect(refund.status).toBe(200);
    expect(await refund.json()).toEqual({ received: true });
    expect(store.balance()).toBe(300);
    const echo = await handler(await signedRequest(JSON.stringify(event("charge.refunded", charge(), "evt_refund_2"))));
    expect(await echo.json()).toEqual({ received: true, duplicate: true });
    expect(store.balance()).toBe(300);
  });

  it("partial refunds act on the growth of the refunded amount and never take the balance below zero", async () => {
    const store = fakeStore({ balance: 0 });
    const handler = handlerWith(store);
    await handler(await signedRequest(checkoutBody)); // +5,000
    const half = await handler(await signedRequest(JSON.stringify(event("charge.refunded", charge({ amount_refunded: 1000, refunded: false }), "evt_half"))));
    expect(half.status).toBe(200);
    expect(store.balance()).toBe(2500); // half the pack taken back
    store.spend(2000); // the student uses most of the rest
    const rest = await handler(await signedRequest(JSON.stringify(event("charge.refunded", charge(), "evt_rest"))));
    expect(rest.status).toBe(200);
    expect(store.balance()).toBe(0); // owed 2,500 more, only 500 left to take
    expect(store.log.reversals.map((r) => r.refundedCents)).toEqual([1000, 2000]);
  });

  it("an untagged refund counts only when its payment intent is a recorded ink purchase (a read first)", async () => {
    const store = fakeStore();
    const handler = handlerWith(store);
    await handler(await signedRequest(checkoutBody));
    const res = await handler(await signedRequest(JSON.stringify(event("charge.refunded", charge({ metadata: {} }), "evt_untagged"))));
    expect(await res.json()).toEqual({ received: true });
    expect(store.log.lookups).toEqual(["pi_1"]);
    expect(store.balance()).toBe(300);
  });

  it("a refund for a payment that is not an ink purchase is ignored and stores nothing", async () => {
    const store = fakeStore();
    const res = await handlerWith(store)(await signedRequest(JSON.stringify(event("charge.refunded", charge({ payment_intent: "pi_other", metadata: {} }), "evt_other"))));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, ignored: true });
    expect(store.log.recorded).toEqual([]);
    expect(store.log.reversals).toEqual([]);
  });

  it("a failed lookup for an untagged refund answers 503 with nothing stored, so Stripe retries", async () => {
    const store = fakeStore({ lookupError: "connection reset" });
    const res = await handlerWith(store)(await signedRequest(JSON.stringify(event("charge.refunded", charge({ metadata: {} }), "evt_lookup"))));
    expect(res.status).toBe(503);
    expect(store.log.recorded).toEqual([]);
  });

  describe("the shared Stripe account: Fuime's traffic", () => {
    it("Fuime's checkout.session.completed is ignored: no grant, no lookup, no billing_events row, no payload", async () => {
      const store = fakeStore();
      const handler = handlerWith(store);
      for (const [id, obj] of [
        ["evt_fuime_1", FUIME_SESSION],
        ["evt_fuime_2", { ...FUIME_SESSION, client_reference_id: null }],
        // even a UUID-looking reference and a pack-looking key do not make it ours without the tag
        ["evt_fuime_3", { ...FUIME_SESSION, client_reference_id: USER_ID, metadata: { fuime_event_id: "evt_x", pack_id: "large" } }],
      ] as const) {
        const res = await handler(await signedRequest(JSON.stringify(event("checkout.session.completed", obj, id))));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ received: true, ignored: true });
      }
      expect(store.log.grants).toEqual([]);
      expect(store.log.recorded).toEqual([]);
      expect(store.log.payloads).toEqual([]);
      expect(store.log.lookups).toEqual([]);
      expect(store.balance()).toBe(300);
    });

    it("Fuime's charge.refunded is ignored after a read-only lookup: no reversal, no row, no payload", async () => {
      const store = fakeStore();
      const handler = handlerWith(store);
      await handler(await signedRequest(checkoutBody)); // an Agathon purchase exists alongside
      const res = await handler(await signedRequest(JSON.stringify(event("charge.refunded", FUIME_CHARGE, "evt_fuime_refund"))));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ received: true, ignored: true });
      expect(store.log.lookups).toEqual(["pi_fuime"]);
      expect(store.log.reversals).toEqual([]);
      expect(store.log.recorded).toEqual(["evt_checkout"]);
      expect(JSON.stringify(store.log.payloads)).not.toMatch(/fuime/i);
      expect(store.balance()).toBe(5300);
    });
  });

  it("answers 400 invalid_request 'bad signature' for a missing, wrong-secret, tampered or stale signature", async () => {
    const store = fakeStore();
    const handler = handlerWith(store);
    for (const req of [
      await signedRequest(checkoutBody, { header: null }),
      await signedRequest(checkoutBody, { secret: "whsec_other" }),
      await signedRequest(checkoutBody, { t: NOW - 3600 }),
      await signedRequest(checkoutBody + " ", { header: await signStripePayload(checkoutBody, SECRET, NOW) }),
    ]) {
      const res = await handler(req);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_request", message: "bad signature" });
    }
    expect(store.log.recorded).toEqual([]);
    expect(store.log.grants).toEqual([]);
  });

  it("answers 503 feature_unavailable when the webhook secret or the service role key is missing", async () => {
    const store = fakeStore();
    for (const env of [{ STRIPE_WEBHOOK_SECRET: undefined }, { SUPABASE_SERVICE_ROLE_KEY: undefined }]) {
      const res = await handlerWith(store, env)(await signedRequest(checkoutBody));
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ error: "feature_unavailable" });
    }
    expect(store.log.recorded).toEqual([]);
  });

  it("answers 503 when INK_PRICE_MAP is malformed", async () => {
    for (const bad of ["{not json", '{"price_x": 3}', '["small"]']) {
      const res = await handlerWith(fakeStore(), { INK_PRICE_MAP: bad })(await signedRequest(checkoutBody));
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ error: "feature_unavailable", message: /INK_PRICE_MAP/ });
    }
  });

  it("uses INK_PRICE_MAP when the session has no pack in its metadata", async () => {
    const store = fakeStore();
    const body = JSON.stringify(event("checkout.session.completed", session({ id: "cs_map", amount_total: 5000, metadata: { app: "agathon-classroom", price_id: "price_large" } }), "evt_map"));
    expect((await handlerWith(store)(await signedRequest(body))).status).toBe(200);
    expect(store.balance()).toBe(14300);
  });

  it("answers 200 ignored for unknown event types and our not-yet-paid sessions, writing nothing", async () => {
    const store = fakeStore();
    const handler = handlerWith(store);
    for (const body of [event("invoice.paid", { id: "in_1" }, "evt_inv"), event("checkout.session.completed", session({ payment_status: "unpaid" }), "evt_unpaid")]) {
      const res = await handler(await signedRequest(JSON.stringify(body)));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ received: true, ignored: true });
    }
    expect(store.log.recorded).toEqual([]);
    expect(store.log.grants).toEqual([]);
  });

  it("a paid Agathon checkout without a user is recorded for review (our own data), with no ink", async () => {
    const store = fakeStore();
    const res = await handlerWith(store)(
      await signedRequest(JSON.stringify(event("checkout.session.completed", session({ client_reference_id: null, customer_details: { email: "kid@example.com" } }), "evt_no_user"))),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(store.log.recorded).toEqual(["evt_no_user"]);
    expect(store.log.reviews).toEqual([expect.objectContaining({ checkoutSessionId: "cs_test_1", customerEmail: "kid@example.com", reason: expect.stringMatching(/client_reference_id/) })]);
    expect(store.log.grants).toEqual([]);
    expect(store.balance()).toBe(300);
  });

  it("an underpaid or unpriced session (a promotion code, another currency) gets no ink, only a review", async () => {
    const store = fakeStore();
    const handler = handlerWith(store);
    for (const [id, overrides] of [
      ["evt_cheap", { id: "cs_cheap", amount_total: 100 }],
      ["evt_eur", { id: "cs_eur", currency: "eur" }],
      ["evt_free", { id: "cs_free", payment_status: "no_payment_required", amount_total: 0 }],
    ] as const) {
      const res = await handler(await signedRequest(JSON.stringify(event("checkout.session.completed", session(overrides), id))));
      expect(res.status, id).toBe(200);
    }
    expect(store.log.reviews.map((r) => r.checkoutSessionId)).toEqual(["cs_cheap", "cs_eur", "cs_free"]);
    expect(store.balance()).toBe(300);
    // the same session again is still only a review
    const again = await handler(await signedRequest(JSON.stringify(event("checkout.session.completed", session({ id: "cs_cheap", amount_total: 100 }), "evt_cheap_2"))));
    expect(await again.json()).toEqual({ received: true, duplicate: true });
    expect(store.balance()).toBe(300);
  });

  it("a refund of a reviewed (ungranted) checkout is acknowledged with nothing to take back", async () => {
    const store = fakeStore();
    const handler = handlerWith(store);
    await handler(await signedRequest(JSON.stringify(event("checkout.session.completed", session({ amount_total: 100 }), "evt_cheap"))));
    const res = await handler(await signedRequest(JSON.stringify(event("charge.refunded", charge({ amount: 100, amount_refunded: 100 }), "evt_cheap_refund"))));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(store.balance()).toBe(300);
  });

  it("a redelivered event is applied again: a grant that failed and could not forget its event still lands on the retry", async () => {
    let failOnce = true;
    const store = fakeStore({
      forgetError: "connection reset",
      grant: () => {
        if (!failOnce) return null;
        failOnce = false;
        return { status: "error", message: "deadlock" };
      },
    });
    const handler = handlerWith(store);
    const first = await handler(await signedRequest(checkoutBody));
    expect(first.status).toBe(500);
    expect(store.log.recorded).toEqual(["evt_checkout"]); // the forget failed: the id stays logged
    const retry = await handler(await signedRequest(checkoutBody));
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ received: true });
    expect(store.balance()).toBe(5300);
    // and a third delivery is a true duplicate
    expect(await (await handler(await signedRequest(checkoutBody))).json()).toEqual({ received: true, duplicate: true });
    expect(store.balance()).toBe(5300);
  });

  it("a tagged refund that arrives before its grant answers 500 (Stripe retries), then reverses once the grant landed", async () => {
    const store = fakeStore();
    const handler = handlerWith(store);
    const refundBody = JSON.stringify(event("charge.refunded", charge(), "evt_early_refund"));
    const early = await handler(await signedRequest(refundBody));
    expect(early.status).toBe(500);
    await handler(await signedRequest(checkoutBody));
    expect(store.balance()).toBe(5300);
    const retried = await handler(await signedRequest(refundBody));
    expect(retried.status).toBe(200);
    expect(store.balance()).toBe(300);
  });

  it("STRIPE_LIVEMODE: an event from the other mode is refused (400) before anything is stored", async () => {
    const store = fakeStore();
    const live = JSON.stringify({ ...event("checkout.session.completed", session(), "evt_live"), livemode: true });
    const test = JSON.stringify({ ...event("checkout.session.completed", session({ id: "cs_t" }), "evt_test"), livemode: false });
    const strict = handlerWith(store, { STRIPE_LIVEMODE: "true" });
    const refused = await strict(await signedRequest(test));
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: "invalid_request", message: "livemode mismatch" });
    expect(store.log.recorded).toEqual([]);
    expect((await strict(await signedRequest(live))).status).toBe(200);
    // unset on a deployment: live only
    const prod = createWebhookHandler({ getEnv: () => ({ ...fullEnv }), createStore: () => store, now: () => NOW, ...NO_EMAIL });
    const onProd = (body: string) => signedRequest(body, { url: "https://whiteboard.rushilchopra.com/api/billing/webhook" });
    expect((await prod(await onProd(test))).status).toBe(400);
    expect((await prod(await onProd(JSON.stringify({ ...event("checkout.session.completed", session({ id: "cs_l2" }), "evt_live_2"), livemode: true })))).status).toBe(200);
  });

  it("answers 400 for a signed body that is not JSON or not an event", async () => {
    const handler = handlerWith(fakeStore());
    const notJson = await handler(await signedRequest("hello"));
    expect(notJson.status).toBe(400);
    expect(await notJson.json()).toMatchObject({ error: "invalid_request" });
    const notEvent = await handler(await signedRequest(JSON.stringify({ id: "evt_x" })));
    expect(notEvent.status).toBe(400);
  });

  it("answers 503 when billing_events cannot be written (migration missing)", async () => {
    const res = await handlerWith(fakeStore({ recordError: 'relation "billing_events" does not exist' }))(await signedRequest(checkoutBody));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "feature_unavailable" });
  });

  it("answers 500 and forgets the event id when the grant fails, so Stripe's retry reprocesses it", async () => {
    const store = fakeStore({ grant: () => ({ status: "error", message: "connection reset" }) as GrantOutcome });
    const res = await handlerWith(store)(await signedRequest(checkoutBody));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "internal_error" });
    expect(store.log.forgotten).toEqual(["evt_checkout"]);
  });

  it("an unknown pack is recorded for review (no 500 loop, no ink)", async () => {
    const store = fakeStore();
    const body = JSON.stringify(event("checkout.session.completed", session({ metadata: { app: "agathon-classroom", pack_id: "huge" } }), "evt_huge"));
    const res = await handlerWith(store)(await signedRequest(body));
    expect(res.status).toBe(200);
    expect(store.log.reviews).toEqual([expect.objectContaining({ reason: "unknown pack huge" })]);
    expect(store.balance()).toBe(300);
  });

  it("answers 500 and forgets the event when a refund reversal fails", async () => {
    const store = fakeStore({ reverse: () => ({ status: "error", message: "timeout" }) });
    const res = await handlerWith(store)(await signedRequest(JSON.stringify(event("charge.refunded", charge(), "evt_r"))));
    expect(res.status).toBe(500);
    expect(store.log.forgotten).toEqual(["evt_r"]);
  });

  it("a purchase the database sends to review (e.g. a deleted account) is acknowledged and not forgotten", async () => {
    const store = fakeStore({ grant: () => ({ status: "review", reason: "no account for this user" }) });
    const res = await handlerWith(store)(await signedRequest(checkoutBody));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(store.log.forgotten).toEqual([]);
  });

  it("rate limits per IP at 120/min with a Retry-After header", async () => {
    const handler = handlerWith(fakeStore());
    for (let i = 0; i < 120; i++) {
      const res = await handler(await signedRequest(checkoutBody, { header: null, ip: "198.51.100.44" }));
      expect(res.status).toBe(400);
    }
    const limited = await handler(await signedRequest(checkoutBody, { header: null, ip: "198.51.100.44" }));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toMatch(/^\d+$/);
    expect((await handler(await signedRequest(checkoutBody, { header: null, ip: "198.51.100.45" }))).status).toBe(400);
  });
});

describe("POST /api/billing/webhook: Agathon Unlimited", () => {
  beforeEach(() => resetRateLimits());

  const send = async (handler: (req: Request) => Promise<Response>, ev: BillingEvent) => {
    const res = await handler(await signedRequest(JSON.stringify(ev)));
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  const checkoutEv = (id = "evt_cs", overrides: Record<string, unknown> = {}) => subEvent("checkout.session.completed", unlimitedSession(overrides), id, NOW + 2);
  const createdEv = (id = "evt_created", overrides: Record<string, unknown> = {}) => subEvent("customer.subscription.created", subscription(overrides), id, NOW + 1);

  it("the free week starts whichever event lands first: subscription.created, then the checkout that names the user", async () => {
    const store = fakeStore();
    const handler = handlerWith(store);
    expect(await send(handler, createdEv())).toEqual({ status: 200, body: { received: true } });
    expect(store.plan("sub_1")).toMatchObject({ userId: null, status: "trialing" }); // nobody's yet: no plan for anyone
    expect(await send(handler, checkoutEv())).toEqual({ status: 200, body: { received: true } });
    expect(store.plan("sub_1")).toMatchObject({ userId: USER_ID, status: "trialing", customerId: "cus_u" });
    expect(store.log.recorded).toEqual(["evt_created", "evt_cs"]);
    // ink is not touched by any of it
    expect(store.log.grants).toEqual([]);
    expect(store.balance()).toBe(300);
  });

  it("…or the checkout first, then the subscription: the same end state", async () => {
    const store = fakeStore();
    const handler = handlerWith(store);
    await send(handler, checkoutEv());
    expect(store.plan("sub_1")).toMatchObject({ userId: USER_ID, status: null });
    await send(handler, createdEv());
    expect(store.plan("sub_1")).toMatchObject({ userId: USER_ID, status: "trialing", trialEnd: new Date((NOW + WEEK) * 1000).toISOString() });
  });

  it("redeliveries are applied again and change nothing", async () => {
    const store = fakeStore();
    const handler = handlerWith(store);
    await send(handler, checkoutEv());
    await send(handler, createdEv());
    const before = { ...store.plan("sub_1") };
    expect(await send(handler, checkoutEv())).toEqual({ status: 200, body: { received: true } });
    // the same event time again is applied again (equal is not older), to the same values
    expect(await send(handler, createdEv())).toEqual({ status: 200, body: { received: true } });
    expect(store.plan("sub_1")).toEqual(before);
    expect(store.log.links).toHaveLength(2);
    expect(store.log.recorded).toEqual(["evt_cs", "evt_created"]);
  });

  it("an older event that arrives late never overwrites a newer one; a deleted plan is never revived", async () => {
    const store = fakeStore();
    const handler = handlerWith(store);
    await send(handler, checkoutEv());
    // trial over, first $25 paid
    await send(handler, subEvent("customer.subscription.updated", subscription({ status: "active", current_period_end: NOW + WEEK + 30 * 86_400 }), "evt_active", NOW + WEEK));
    // the original created (trialing) shows up late: stale
    expect(await send(handler, createdEv())).toEqual({ status: 200, body: { received: true, duplicate: true } });
    expect(store.plan("sub_1")).toMatchObject({ status: "active" });
    // cancelled in the portal, then ended
    await send(handler, subEvent("customer.subscription.updated", subscription({ status: "active", cancel_at_period_end: true }), "evt_cancel", NOW + WEEK + 100));
    expect(store.plan("sub_1")).toMatchObject({ status: "active", cancelAtPeriodEnd: true });
    await send(handler, subEvent("customer.subscription.deleted", subscription({ status: "canceled", ended_at: NOW + 40 * 86_400 }), "evt_deleted", NOW + 40 * 86_400));
    // a stray update stamped after the deletion still cannot bring it back
    await send(handler, subEvent("customer.subscription.updated", subscription({ status: "active" }), "evt_stray", NOW + 41 * 86_400));
    expect(store.plan("sub_1")).toMatchObject({ status: "canceled" });
  });

  it("Stripe's real same-second created + updated, delivered backwards, still end cancelling (then deleted)", async () => {
    const store = fakeStore();
    const handler = handlerWith(store);
    const sub = "sub_1UMZUz2Uz4P3wrXOxRDhRuaN";
    // the cancellation (updated) overtakes the creation, both stamped 1791059139
    expect((await send(handler, REAL["customer.subscription.updated"])).status).toBe(200);
    expect(await send(handler, REAL["customer.subscription.created"])).toEqual({ status: 200, body: { received: true, duplicate: true } });
    expect(store.plan(sub)).toMatchObject({ status: "trialing", cancelAtPeriodEnd: true });
    await send(handler, REAL["customer.subscription.deleted"]);
    expect(store.plan(sub)).toMatchObject({ status: "canceled" });
  });

  it("past_due is recorded as it is (help spends ink until the card is fixed)", async () => {
    const store = fakeStore();
    const handler = handlerWith(store);
    await send(handler, checkoutEv());
    await send(handler, subEvent("customer.subscription.updated", subscription({ status: "past_due" }), "evt_pd", NOW + WEEK + 3600));
    expect(store.plan("sub_1")).toMatchObject({ userId: USER_ID, status: "past_due" });
    expect(store.log.applies.at(-1)).toMatchObject({ status: "past_due" });
  });

  it("SECURITY: a user id as client_reference_id no longer links the plan (anyone can learn one); the checkout ref does", async () => {
    const store = fakeStore();
    const handler = handlerWith(store);
    // an attacker opens the Unlimited link with the victim's USER ID and their own card
    expect(await send(handler, subEvent("checkout.session.completed", unlimitedSession({ client_reference_id: USER_ID, id: "cs_attack", subscription: "sub_attack" }), "evt_attack", NOW))).toEqual({
      status: 200,
      body: { received: true },
    });
    await send(handler, subEvent("customer.subscription.created", subscription({ id: "sub_attack" }), "evt_attack_sub", NOW + 1));
    expect(store.plan("sub_attack")).toMatchObject({ userId: null, status: "trialing" }); // nobody's: no plan on the victim's account
    expect(store.log.links.at(-1)).toMatchObject({ checkoutRef: USER_ID }); // sent as a ref, and no profile has it
    // the account's own checkout (its ref) links as before
    await send(handler, checkoutEv());
    expect(store.plan("sub_1")).toMatchObject({ userId: USER_ID, payerEmail: "parent@example.com" });
  });

  it("an Unlimited checkout without a usable user is recorded, linked to nobody (200, for the owner to link)", async () => {
    const store = fakeStore();
    const handler = handlerWith(store);
    for (const [id, ref] of [["evt_none", null], ["evt_bad", "kid-42"], ["evt_gone", "11111111-2222-4333-8444-555555555555"]] as const) {
      const res = await send(handler, subEvent("checkout.session.completed", unlimitedSession({ client_reference_id: ref, subscription: `sub_${id}`, id: `cs_${id}` }), id, NOW));
      expect(res, id).toEqual({ status: 200, body: { received: true } });
      expect(store.plan(`sub_${id}`), id).toMatchObject({ userId: null });
    }
    expect(store.log.recorded).toEqual(["evt_none", "evt_bad", "evt_gone"]);
  });

  it("the first link stands when another checkout names someone else", async () => {
    const store = fakeStore({ link: (l) => (l.checkoutSessionId === "cs_other" ? { status: "conflict", userId: USER_ID } : null) });
    const handler = handlerWith(store);
    await send(handler, checkoutEv());
    expect(await send(handler, checkoutEv("evt_other", { id: "cs_other" }))).toEqual({ status: 200, body: { received: true } });
    expect(store.plan("sub_1")).toMatchObject({ userId: USER_ID });
  });

  it("Fuime's subscription events are ignored: no row, no billing_events entry, no payload", async () => {
    const store = fakeStore();
    const handler = handlerWith(store);
    for (const type of ["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"]) {
      expect(await send(handler, subEvent(type, FUIME_SUBSCRIPTION, `evt_${type}`, NOW))).toEqual({ status: 200, body: { received: true, ignored: true } });
    }
    expect(store.log.recorded).toEqual([]);
    expect(store.log.payloads).toEqual([]);
    expect(store.log.applies).toEqual([]);
    expect(store.plan("sub_fuime")).toBeUndefined();
  });

  it("a database failure answers 500 and forgets the event, so Stripe redelivers it", async () => {
    const linkFails = fakeStore({ link: () => ({ status: "error", message: "connection reset" }) });
    expect((await send(handlerWith(linkFails), checkoutEv())).status).toBe(500);
    expect(linkFails.log.forgotten).toEqual(["evt_cs"]);
    const applyFails = fakeStore({ apply: () => ({ status: "error", message: "deadlock" }) });
    expect((await send(handlerWith(applyFails), createdEv())).status).toBe(500);
    expect(applyFails.log.forgotten).toEqual(["evt_created"]);
  });

  it("an ink pack checkout next to the plan is still granted the usual way", async () => {
    const store = fakeStore();
    const handler = handlerWith(store);
    await send(handler, checkoutEv());
    expect(await send(handler, event("checkout.session.completed", session(), "evt_pack"))).toEqual({ status: 200, body: { received: true } });
    expect(store.balance()).toBe(5300);
  });

  /**
   * The free week's confirmation through the real `sendUnlimitedStarted`, with fake email deps
   * (email_log in memory, Resend recorded) reading the fake store's subscription row. `defer`
   * collects the work instead of running it, so a test sees exactly what happens before the
   * answer to Stripe (nothing) and after it (`settle`).
   */
  function emailWorld(store: ReturnType<typeof fakeStore>) {
    const email = fakeEmailDeps({ now: new Date(NOW * 1000) });
    email.findSubscription = vi.fn(async (id: string) => {
      const row = store.plan(id);
      if (!row) return null;
      return { subscriptionId: id, userId: row.userId, status: row.status, trialEnd: row.trialEnd, cancelAtPeriodEnd: row.cancelAtPeriodEnd, cancelAt: null, payerEmail: row.payerEmail, repeat: false };
    });
    const queued: Array<() => Promise<unknown>> = [];
    const requested: string[] = [];
    const webhook: Pick<WebhookDeps, "confirmStarted" | "defer"> = {
      confirmStarted: (id, log) => {
        requested.push(id);
        return sendUnlimitedStarted(email, id, log);
      },
      defer: (work) => {
        queued.push(work);
      },
    };
    /** Run what the route deferred (after its answers), in order. */
    const settle = async () => {
      while (queued.length) await queued.shift()!();
    };
    return { email, webhook, settle, requested, queued };
  }

  it("the free week's confirmation goes to the PAYER, once, after the answer, whichever event completes the plan and however often Stripe redelivers", async () => {
    const store = fakeStore();
    const world = emailWorld(store);
    const handler = handlerWith(store, {}, world.webhook);

    // the subscription first: trialing but nobody's yet, so nothing is due
    expect(await send(handler, createdEv())).toEqual({ status: 200, body: { received: true } });
    await world.settle();
    expect(world.email.sent).toEqual([]);

    // the checkout links it: the email is asked for, but only after the answer
    expect(await send(handler, checkoutEv())).toEqual({ status: 200, body: { received: true } });
    expect(world.queued).toHaveLength(1);
    expect(world.requested).toEqual([]); // not even started before the answer
    expect(world.email.sent).toEqual([]);
    await world.settle();
    expect(world.requested).toEqual(["sub_1"]);
    expect(world.email.sent).toHaveLength(1);
    const [message] = world.email.sent;
    expect(message.to).toBe("parent@example.com"); // the payer from the checkout, not the account's address
    expect(world.email.emailOf).not.toHaveBeenCalled();
    expect(message.subject).toBe("Your free week of Agathon Unlimited has started");
    expect(message.text).toContain("Nothing was charged today.");
    expect(message.text).toContain("your card will be charged $25, then $25 every month until you cancel.");
    expect(message.text).toMatch(/\/terms#unlimited/);
    expect(message.idempotencyKey).toBe("unlimited-started/sub_1");
    expect(world.email.log.rows).toEqual([expect.objectContaining({ user_id: USER_ID, kind: "unlimited_started", ref: "sub_1", resend_id: "re_1" })]);

    // Stripe redelivers both, and an update arrives: asked again each time, sent never again
    await send(handler, checkoutEv());
    await send(handler, createdEv());
    await send(handler, subEvent("customer.subscription.updated", subscription(), "evt_upd", NOW + 5));
    await world.settle();
    expect(world.requested.length).toBeGreaterThanOrEqual(4);
    expect(world.email.sent).toHaveLength(1);
    expect(world.email.send).toHaveBeenCalledTimes(1);
  });

  it("…the checkout first, then the subscription event: the same single email", async () => {
    const store = fakeStore();
    const world = emailWorld(store);
    const handler = handlerWith(store, {}, world.webhook);
    await send(handler, checkoutEv()); // linked, no status yet: nothing asked
    expect(world.requested).toEqual([]);
    await send(handler, createdEv()); // now linked AND trialing
    await world.settle();
    expect(world.email.sent.map((m) => m.to)).toEqual(["parent@example.com"]);
  });

  it("email never fails or slows the webhook: Resend down, an email step that throws or hangs, all answer 200; a later delivery sends it", async () => {
    const store = fakeStore();
    const world = emailWorld(store);
    const handler = handlerWith(store, {}, world.webhook);
    world.email.sendReplies.push({ ok: false, error: "timed out" });
    expect((await send(handler, createdEv())).status).toBe(200);
    expect(await send(handler, checkoutEv())).toEqual({ status: 200, body: { received: true } });
    await world.settle();
    expect(world.email.sent).toEqual([]);
    expect(world.email.log.rows).toEqual([]); // the claim was released, so it can be sent later
    expect(store.log.forgotten).toEqual([]); // and the webhook did not undo anything
    // the next delivery for the subscription (or the daily cron) sends it
    await send(handler, subEvent("customer.subscription.updated", subscription(), "evt_upd", NOW + 5));
    await world.settle();
    expect(world.email.sent).toHaveLength(1);

    // an email step that throws, or never finishes, with the real `defer`: the answer is still 200, at once
    for (const confirmStarted of [
      async () => {
        throw new Error("boom");
      },
      () => new Promise<never>(() => undefined),
    ]) {
      const s = fakeStore();
      const h = handlerWith(s, {}, { confirmStarted, defer: deferAfterResponse });
      expect(await send(h, createdEv())).toEqual({ status: 200, body: { received: true } });
      expect(await send(h, checkoutEv())).toEqual({ status: 200, body: { received: true } });
      expect(s.log.forgotten).toEqual([]);
    }
  });

  it("deferAfterResponse never throws, even outside a request (where next/server's `after` refuses) or for work that fails", async () => {
    let ran = 0;
    expect(() => deferAfterResponse(async () => void ran++)).not.toThrow();
    expect(() => deferAfterResponse(() => Promise.reject(new Error("smtp down")))).not.toThrow();
    expect(() =>
      deferAfterResponse(() => {
        throw new Error("sync throw");
      }),
    ).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(ran).toBe(1);
  });

  it("no confirmation for a plan linked to nobody, a pack, or a plan already set to cancel", async () => {
    const store = fakeStore();
    const world = emailWorld(store);
    const handler = handlerWith(store, {}, world.webhook);
    await send(handler, subEvent("checkout.session.completed", unlimitedSession({ client_reference_id: USER_ID, subscription: "sub_x", id: "cs_x" }), "evt_x", NOW));
    await send(handler, subEvent("customer.subscription.created", subscription({ id: "sub_x" }), "evt_x_sub", NOW + 1));
    await send(handler, event("checkout.session.completed", session(), "evt_pack"));
    await send(handler, subEvent("customer.subscription.created", subscription({ id: "sub_c", cancel_at_period_end: true }), "evt_c_sub", NOW + 1));
    await send(handler, subEvent("checkout.session.completed", unlimitedSession({ subscription: "sub_c", id: "cs_c" }), "evt_c", NOW + 2));
    await world.settle();
    expect(world.requested).toEqual(["sub_c"]); // asked (linked and trialing), but it will not charge
    expect(world.email.sent).toEqual([]);
  });
});
