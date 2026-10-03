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
    },
  };
});

import { POST } from "@/app/api/billing/webhook/route";
import {
  HANDLED_EVENTS,
  livemodeAccepted,
  mapBillingEvent,
  packIdOf,
  paidAmountOf,
  type BillingEvent,
  type BillingStore,
  type GrantOutcome,
  type InkPurchase,
  type InkRefund,
  type InkReview,
  type ReverseOutcome,
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
import { signStripePayload } from "@/lib/server/webhookSignature";

const USER_ID = "8d2a3f1e-4b6c-4d7e-9f01-23456789abcd";
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

  it("ignores a subscription checkout (the retired Plus/Pro links) and a session without a mode", () => {
    expect(mapBillingEvent(event("checkout.session.completed", session({ mode: "subscription" })), {})).toMatchObject({ kind: "ignored", reason: /mode subscription/ });
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

  it("the retired subscription events and anything else are foreign", () => {
    for (const type of ["customer.subscription.updated", "customer.subscription.deleted", "invoice.paid", "checkout.session.async_payment_failed"]) {
      expect(mapBillingEvent(event(type, { id: "x", metadata: { app: "agathon-classroom" } }), {})).toMatchObject({
        kind: "foreign",
        reason: new RegExp(type.replace(/\./g, "\\.")),
      });
    }
  });

  it("HANDLED_EVENTS are exactly the types that can do something", () => {
    expect([...HANDLED_EVENTS]).toEqual(["checkout.session.completed", "checkout.session.async_payment_succeeded", "charge.refunded"]);
    for (const type of HANDLED_EVENTS) {
      const mapped = mapBillingEvent(event(type, { metadata: { app: "agathon-classroom" } }), {});
      if (mapped.kind === "ignored" || mapped.kind === "foreign") expect(mapped.reason).not.toMatch(/unhandled event type/);
    }
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
  } = {},
): BillingStore & { log: StoreLog; balance: () => number; spend: (ink: number) => void } {
  const log: StoreLog = { recorded: [], payloads: [], forgotten: [], grants: [], reviews: [], reversals: [], lookups: [] };
  const sessions = new Map<string, { ink: number; paymentIntent: string | null; refundedCents: number; asked: number; amount: number }>();
  let balance = opts.balance ?? 300;
  const INK: Record<string, number> = { small: 1000, medium: 5000, large: 14000 };
  return {
    log,
    balance: () => balance,
    spend: (ink) => {
      balance = Math.max(0, balance - ink);
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

function handlerWith(store: BillingStore, env: Partial<WebhookEnv> = {}): (req: Request) => Promise<Response> {
  const deps: WebhookDeps = { getEnv: () => ({ ...fullEnv, ...env }), createStore: () => store, now: () => NOW };
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
    const prod = createWebhookHandler({ getEnv: () => ({ ...fullEnv }), createStore: () => store, now: () => NOW });
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
