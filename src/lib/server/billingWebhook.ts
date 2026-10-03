import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { getServerEnv, type InkPriceMap } from "@/lib/env";

/**
 * The billing webhook's event schema, its pure mapping of a Stripe event to an ink change, and the
 * service-role store it writes through. The handler itself, with its rate limit, signature check
 * and body validation, is src/app/api/billing/webhook/route.ts (whose header explains the flow);
 * these live here because a route file may export only its handlers and segment config (`next
 * dev` type-checks a route's exports under .next/dev/types).
 */

/** `metadata.app` on every Stripe object Agathon creates (APP_TAG in scripts/stripe-setup.mjs). */
export const APP_TAG = "agathon-classroom";

/* ------------------------------------------------------------------------- */
/* Event schema + pure mapping                                                */
/* ------------------------------------------------------------------------- */

export const EventSchema = z.object({
  id: z.string().min(1).max(200),
  type: z.string().min(1).max(200),
  livemode: z.boolean().optional(),
  data: z.object({ object: z.record(z.string(), z.unknown()) }),
});

export type BillingEvent = z.infer<typeof EventSchema>;

/** A paid checkout, ready for grant_ink_purchase(). */
export type InkPurchase = {
  userId: string;
  packId: string;
  checkoutSessionId: string;
  paymentIntentId: string | null;
  customerId: string | null;
  /**
   * What was paid, in the smallest unit of `currency`: the session's `amount_total`, or under
   * Adaptive Pricing `currency_conversion.amount_total` in its `source_currency` (the merchant's
   * own currency, which the packs are priced in). Null when the event does not say: then the
   * database grants nothing and records the session for review.
   */
  amountCents: number | null;
  currency: string | null;
  customerEmail: string | null;
};

/** An Agathon checkout that cannot become ink automatically, for ink_checkout_reviews. */
export type InkReview = {
  checkoutSessionId: string;
  reason: string;
  clientReferenceId: string | null;
  packId: string | null;
  paymentIntentId: string | null;
  customerId: string | null;
  amountCents: number | null;
  currency: string | null;
  customerEmail: string | null;
};

/** A refund on a charge, ready for reverse_ink_purchase(). */
export type InkRefund = {
  paymentIntentId: string;
  chargeId: string | null;
  /** The charge's amount. */
  amountCents: number | null;
  /** Stripe's CUMULATIVE refunded amount for the charge. */
  refundedCents: number;
  /** `charge.refunded`: true once the whole amount is refunded. */
  fullyRefunded: boolean;
  /**
   * The charge carries `metadata.app = agathon-classroom` (Stripe copies the payment intent's
   * metadata onto its charge). Without it the refund is ours only if its payment intent is a
   * recorded purchase or review, which the handler asks the store (a read).
   */
  tagged: boolean;
};

export type MappedEvent =
  /** Not Agathon's (Fuime's, or nobody's): nothing is written, not even the event id. */
  | { kind: "foreign"; reason: string }
  /** Agathon's, but nothing to do yet (not paid yet, not a one-time checkout): nothing is written. */
  | { kind: "ignored"; reason: string }
  | { kind: "grant"; purchase: InkPurchase }
  /** Agathon's and paid (or claimed paid), but not grantable: recorded for the owner, no ink. */
  | { kind: "review"; review: InkReview }
  | { kind: "reverse"; refund: InkRefund };

/** The event types the handler acts on (scripts/stripe-setup.mjs WEBHOOK_EVENTS must match). */
export const HANDLED_EVENTS = ["checkout.session.completed", "checkout.session.async_payment_succeeded", "charge.refunded"] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Pack ids as `ink_packs` allows them (ink_packs_id_format). */
const PACK_ID_RE = /^[a-z][a-z0-9_-]{0,31}$/;

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function int(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
}

/** Stripe fields that are either an id string or an expanded `{ id }` object. */
function idOf(v: unknown): string | null {
  if (typeof v === "string") return str(v);
  if (v && typeof v === "object") return str((v as { id?: unknown }).id);
  return null;
}

function recordOf(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function metadataOf(obj: Record<string, unknown>): Record<string, unknown> {
  return recordOf(obj.metadata);
}

/** First `price.id` under `line_items.data[]` (only present when the session was expanded). */
function firstPriceId(obj: Record<string, unknown>): string | null {
  const data = recordOf(obj.line_items).data;
  if (!Array.isArray(data)) return null;
  for (const item of data) {
    const id = idOf(recordOf(item).price);
    if (id) return id;
  }
  return null;
}

/**
 * Pack id for a Checkout Session: `metadata.pack_id` (a Payment Link copies its metadata onto
 * every session it creates; the session's line items are not in the event), else INK_PRICE_MAP
 * of the first line item's price (or of `metadata.price_id`). Null when neither names a pack.
 */
export function packIdOf(obj: Record<string, unknown>, priceMap: InkPriceMap): string | null {
  const fromMeta = str(metadataOf(obj).pack_id)?.trim().toLowerCase() ?? null;
  if (fromMeta && PACK_ID_RE.test(fromMeta)) return fromMeta;
  const priceId = firstPriceId(obj) ?? str(metadataOf(obj).price_id);
  const mapped = priceId ? priceMap[priceId] : undefined;
  return mapped && PACK_ID_RE.test(mapped) ? mapped : null;
}

/**
 * What the customer paid, in the merchant's currency: under Adaptive Pricing the session's
 * `currency_conversion` holds the amount in `source_currency` (what the packs are priced in);
 * otherwise `amount_total` in `currency`.
 */
export function paidAmountOf(obj: Record<string, unknown>): { amountCents: number | null; currency: string | null } {
  const conv = recordOf(obj.currency_conversion);
  const convAmount = int(conv.amount_total);
  const convCurrency = str(conv.source_currency);
  if (convAmount !== null && convCurrency) return { amountCents: convAmount, currency: convCurrency.toLowerCase() };
  return { amountCents: int(obj.amount_total), currency: str(obj.currency)?.toLowerCase() ?? null };
}

/** True when the Stripe object carries Agathon's tag. */
export function isAgathonObject(obj: Record<string, unknown>): boolean {
  return metadataOf(obj).app === APP_TAG;
}

const ignored = (reason: string): MappedEvent => ({ kind: "ignored", reason });
const foreign = (reason: string): MappedEvent => ({ kind: "foreign", reason });

/**
 * Pure: provider event -> what to do. No I/O.
 *
 *  - checkout.session.completed, checkout.session.async_payment_succeeded
 *        Without `metadata.app = agathon-classroom` the session is someone else's (foreign).
 *        Ours, one-time (`mode: "payment"`) and `payment_status: "paid"` with a user id
 *        (`client_reference_id`) and a pack (`metadata.pack_id`, else INK_PRICE_MAP) -> grant;
 *        the database checks the amount covers the pack. Ours and `unpaid` (a delayed method;
 *        async_payment_succeeded follows) -> ignored. Ours and `no_payment_required` (nothing was
 *        paid: a 100 % promotion code), or paid without a usable user id or pack -> review.
 *  - charge.refunded -> reverse by the charge's payment intent; `tagged` says whether the charge
 *        itself proves it is ours (else the handler checks for a recorded purchase first).
 *  - anything else -> foreign: the endpoint subscribes to nothing else.
 */
export function mapBillingEvent(event: BillingEvent, priceMap: InkPriceMap): MappedEvent {
  const obj = event.data.object;

  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      if (!isAgathonObject(obj)) return foreign("checkout session is not tagged app=agathon-classroom");
      const mode = str(obj.mode);
      if (mode !== "payment") return ignored(`not a one-time payment (mode ${mode ?? "missing"})`);
      const paymentStatus = str(obj.payment_status);
      if (paymentStatus === "unpaid") return ignored("not paid yet (payment_status unpaid)");
      const sessionId = str(obj.id);
      if (!sessionId) return ignored("checkout session has no id");

      const rawRef = str(obj.client_reference_id) ?? str(metadataOf(obj).user_id);
      const packId = packIdOf(obj, priceMap);
      const paid = paidAmountOf(obj);
      const common = {
        checkoutSessionId: sessionId,
        paymentIntentId: idOf(obj.payment_intent),
        customerId: idOf(obj.customer),
        amountCents: paid.amountCents,
        currency: paid.currency,
        customerEmail: str(recordOf(obj.customer_details).email) ?? str(obj.customer_email),
      };
      const review = (reason: string): MappedEvent => ({
        kind: "review",
        review: { ...common, reason, clientReferenceId: rawRef, packId: packId ?? str(metadataOf(obj).pack_id) },
      });
      if (paymentStatus !== "paid") return review(`not paid (payment_status ${paymentStatus ?? "missing"})`);
      if (!rawRef) return review("no client_reference_id (the Payment Link was opened outside the app)");
      if (!UUID_RE.test(rawRef)) return review("client_reference_id is not a user id");
      if (!packId) return review("no pack_id in metadata and price not in INK_PRICE_MAP");
      return { kind: "grant", purchase: { ...common, userId: rawRef.toLowerCase(), packId } };
    }

    case "charge.refunded": {
      const tagged = isAgathonObject(obj);
      const paymentIntentId = idOf(obj.payment_intent);
      // Every Agathon sale is a Payment Link checkout, so it has a payment intent.
      if (!paymentIntentId) return tagged ? ignored("charge has no payment_intent") : foreign("charge has no payment_intent");
      const refundedCents = int(obj.amount_refunded);
      const fullyRefunded = obj.refunded === true;
      if (!fullyRefunded && !refundedCents) return tagged ? ignored("nothing refunded") : foreign("nothing refunded");
      return {
        kind: "reverse",
        refund: {
          paymentIntentId,
          chargeId: str(obj.id),
          amountCents: int(obj.amount),
          refundedCents: refundedCents ?? 0,
          fullyRefunded,
          tagged,
        },
      };
    }

    default:
      return foreign(`unhandled event type ${event.type}`);
  }
}

/** Hosts a dev server answers on: there, an unset STRIPE_LIVEMODE accepts either mode. */
function isLocalHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1" || h.endsWith(".localhost");
}

/**
 * True when the event's mode is the one this deployment takes: STRIPE_LIVEMODE "true" or "false"
 * when set; unset, live only, except on a localhost dev server (either). An event that does not
 * say (`livemode` missing) passes only where either mode is accepted.
 */
export function livemodeAccepted(eventLivemode: boolean | undefined, setting: string | undefined, host: string): boolean {
  const want = setting?.trim().toLowerCase();
  if (want === "true") return eventLivemode === true;
  if (want === "false") return eventLivemode === false;
  if (isLocalHost(host)) return true;
  return eventLivemode === true;
}

/* ------------------------------------------------------------------------- */
/* Persistence (service role) behind a small interface so tests can fake it   */
/* ------------------------------------------------------------------------- */

export type GrantOutcome =
  | { status: "granted"; granted: number; balance: number }
  | { status: "duplicate" }
  /** Recorded in ink_checkout_reviews with no ink (underpaid, unknown pack, no account, …). */
  | { status: "review"; reason: string }
  | { status: "error"; message: string };

export type ReverseOutcome =
  | { status: "reversed"; reversed: number; requested: number; balance: number }
  | { status: "duplicate" }
  /** A refund of a checkout that was waiting for review (it granted no ink). */
  | { status: "review" }
  | { status: "not_found" }
  | { status: "error"; message: string };

export type BillingStore = {
  /** Read-only: is this payment intent an ink purchase or review we recorded? (An untagged refund's test.) */
  isInkPayment(paymentIntentId: string): Promise<boolean | { error: string }>;
  /** Insert the event id (and payload: only ever an Agathon event); "duplicate" when it was already recorded. */
  recordEvent(event: BillingEvent): Promise<{ status: "inserted" | "duplicate" } | { status: "error"; message: string }>;
  /** Undo `recordEvent` after a failure, so the log shows only what was applied. */
  forgetEvent(eventId: string): Promise<{ ok: true } | { error: string }>;
  grantPurchase(purchase: InkPurchase, eventId: string): Promise<GrantOutcome>;
  recordReview(review: InkReview, eventId: string): Promise<{ recorded: boolean } | { error: string }>;
  reversePurchase(refund: InkRefund): Promise<ReverseOutcome>;
};

const UNIQUE_VIOLATION = "23505";

function rowOf(data: unknown): Record<string, unknown> | null {
  const row = Array.isArray(data) ? data[0] : data;
  return row && typeof row === "object" ? (row as Record<string, unknown>) : null;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);

export function supabaseBillingStore(url: string, serviceRoleKey: string): BillingStore {
  const client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return {
    async isInkPayment(paymentIntentId) {
      for (const table of ["ink_purchases", "ink_checkout_reviews"]) {
        const { data, error } = await client.from(table).select("id").eq("payment_intent_id", paymentIntentId).limit(1);
        if (error) return { error: error.message };
        if (Array.isArray(data) && data.length > 0) return true;
      }
      return false;
    },
    async recordEvent(event) {
      const { error } = await client.from("billing_events").insert({ id: event.id, type: event.type, payload: event });
      if (!error) return { status: "inserted" };
      if (error.code === UNIQUE_VIOLATION) return { status: "duplicate" };
      return { status: "error", message: error.message };
    },
    async forgetEvent(eventId) {
      const { error } = await client.from("billing_events").delete().eq("id", eventId);
      return error ? { error: error.message } : { ok: true };
    },
    async grantPurchase(p, eventId) {
      const { data, error } = await client.rpc("grant_ink_purchase", {
        p_user_id: p.userId,
        p_pack_id: p.packId,
        p_checkout_session_id: p.checkoutSessionId,
        p_payment_intent_id: p.paymentIntentId,
        p_customer_id: p.customerId,
        p_amount_cents: p.amountCents,
        p_currency: p.currency,
        p_customer_email: p.customerEmail,
        p_event_id: eventId,
      });
      if (error) return { status: "error", message: error.message };
      const row = rowOf(data);
      if (!row) return { status: "error", message: "grant_ink_purchase returned no row" };
      if (row.duplicate === true) return { status: "duplicate" };
      if (row.review === true) return { status: "review", reason: String(row.reason ?? "needs review") };
      return { status: "granted", granted: num(row.granted), balance: num(row.balance) };
    },
    async recordReview(r, eventId) {
      const { data, error } = await client.rpc("record_ink_checkout_review", {
        p_checkout_session_id: r.checkoutSessionId,
        p_reason: r.reason,
        p_client_reference_id: r.clientReferenceId,
        p_pack_id: r.packId,
        p_payment_intent_id: r.paymentIntentId,
        p_customer_id: r.customerId,
        p_amount_cents: r.amountCents,
        p_currency: r.currency,
        p_customer_email: r.customerEmail,
        p_event_id: eventId,
      });
      if (error) return { error: error.message };
      return { recorded: rowOf(data)?.recorded === true };
    },
    async reversePurchase(r) {
      const { data, error } = await client.rpc("reverse_ink_purchase", {
        p_payment_intent_id: r.paymentIntentId,
        p_amount_refunded_cents: r.refundedCents,
        p_charge_amount_cents: r.amountCents,
        p_fully_refunded: r.fullyRefunded,
      });
      if (error) return { status: "error", message: error.message };
      const row = rowOf(data);
      if (!row) return { status: "error", message: "reverse_ink_purchase returned no row" };
      if (row.found === false) return { status: "not_found" };
      if (row.review === true) return { status: "review" };
      if (row.duplicate === true) return { status: "duplicate" };
      return { status: "reversed", reversed: num(row.reversed), requested: num(row.requested), balance: num(row.balance) };
    },
  };
}

/* ------------------------------------------------------------------------- */
/* Dependencies                                                               */
/* ------------------------------------------------------------------------- */

export type WebhookEnv = {
  NEXT_PUBLIC_SUPABASE_URL: string;
  STRIPE_WEBHOOK_SECRET?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  INK_PRICE_MAP?: string;
  STRIPE_LIVEMODE?: string;
};

export type WebhookDeps = {
  getEnv: () => WebhookEnv;
  createStore: (url: string, serviceRoleKey: string) => BillingStore;
  /** Unix seconds (signature tolerance). */
  now: () => number;
};

/**
 * What the webhook reads from outside the request: the env, the service-role store and the clock
 * (Unix seconds, for the signature tolerance). The route calls these; tests replace them.
 */
export const webhookDeps: WebhookDeps = {
  getEnv: () => getServerEnv(),
  createStore: supabaseBillingStore,
  now: () => Math.floor(Date.now() / 1000),
};
