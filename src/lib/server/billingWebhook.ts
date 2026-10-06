import { after } from "next/server";
import type pino from "pino";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { getServerEnv, type InkPriceMap } from "@/lib/env";
import { UNLIMITED_PLAN } from "@/lib/billing/unlimited";
import { emailDeps } from "@/lib/email/server";
import { sendUnlimitedStarted } from "@/lib/email/unlimitedStarted";

/**
 * The billing webhook's event schema, its pure mapping of a Stripe event to an ink change or an
 * Agathon Unlimited subscription change, and the service-role store it writes through. The
 * handler itself, with its rate limit, signature check and body validation, is
 * src/app/api/billing/webhook/route.ts (whose header explains the flow); these live here because a
 * route file may export only its handlers and segment config (`next dev` type-checks a route's
 * exports under .next/dev/types).
 */

/** `metadata.app` on every Stripe object Agathon creates (APP_TAG in scripts/stripe-setup.mjs). */
export const APP_TAG = "agathon-classroom";

/**
 * `metadata.plan_id` on the Unlimited product, price, Payment Link (so on its Checkout Sessions) and,
 * through the link's `subscription_data.metadata`, on every subscription it starts. The Plus/Pro
 * subscriptions of the September plans carried the app tag without this, so they stay ignored.
 */
export const UNLIMITED_PLAN_ID = UNLIMITED_PLAN.id;

/* ------------------------------------------------------------------------- */
/* Event schema + pure mapping                                                */
/* ------------------------------------------------------------------------- */

export const EventSchema = z.object({
  id: z.string().min(1).max(200),
  type: z.string().min(1).max(200),
  livemode: z.boolean().optional(),
  /** Unix seconds: orders subscription events that arrive out of order. */
  created: z.number().int().nonnegative().optional(),
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

/**
 * An Agathon Unlimited checkout, ready for link_unlimited_checkout(): whose subscription it is.
 * The only event that names our user; it may arrive before or after the subscription's own events.
 *
 * The user is named by a CHECKOUT REFERENCE, not a user id: `client_reference_id` carries the
 * account's `profiles.checkout_ref` (a random uuid only its owner can read, sent by
 * unlimitedCheckoutUrl), and the database resolves it to the user. A user id is not a secret, and
 * linking by one let anyone start a plan, on their own card, on someone else's account (which then
 * could not be deleted, and whose plan only the payer could cancel). A user id sent as the ref
 * matches no profile and links nobody. Ink packs still name the user id: a pack is a gift.
 */
export type UnlimitedLink = {
  subscriptionId: string;
  /** `client_reference_id` when it is a uuid, lower-cased: the checkout ref; null when there is no usable one. */
  checkoutRef: string | null;
  clientReferenceId: string | null;
  customerId: string | null;
  checkoutSessionId: string;
  livemode: boolean | null;
  /**
   * The payer's email as Stripe has it for the checkout (`customer_details.email`, else
   * `customer_email`): where the plan's emails go (the account may be a child's). Null when absent
   * or not an address.
   */
  payerEmail: string | null;
  /** Why the subscription cannot be linked to anyone, when `checkoutRef` is null. */
  problem: string | null;
};

/** Stripe's subscription statuses (the CHECK on unlimited_subscriptions.status). */
export const SUBSCRIPTION_STATUSES = ["incomplete", "incomplete_expired", "trialing", "active", "past_due", "canceled", "unpaid", "paused"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** A customer.subscription.* event, ready for apply_unlimited_subscription(). Times are ISO strings. */
export type UnlimitedSubscription = {
  subscriptionId: string;
  customerId: string | null;
  status: SubscriptionStatus;
  priceId: string | null;
  trialEnd: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  cancelAt: string | null;
  canceledAt: string | null;
  endedAt: string | null;
  livemode: boolean | null;
  /** The event's `created`: a late delivery of an older event never overwrites a newer state. */
  eventAt: string | null;
};

export type MappedEvent =
  /** Not Agathon's (Fuime's, or nobody's): nothing is written, not even the event id. */
  | { kind: "foreign"; reason: string }
  /** Agathon's, but nothing to do yet (not paid yet, a retired plan): nothing is written. */
  | { kind: "ignored"; reason: string }
  | { kind: "grant"; purchase: InkPurchase }
  /** Agathon's and paid (or claimed paid), but not grantable: recorded for the owner, no ink. */
  | { kind: "review"; review: InkReview }
  | { kind: "reverse"; refund: InkRefund }
  /** An Agathon Unlimited checkout: link the subscription to its user. */
  | { kind: "link"; link: UnlimitedLink }
  /** An Agathon Unlimited subscription's new state. */
  | { kind: "subscription"; subscription: UnlimitedSubscription };

/** The event types the handler acts on (scripts/stripe-setup.mjs WEBHOOK_EVENTS must match). */
export const HANDLED_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "charge.refunded",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
] as const;

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

/** The subscription's items (`items.data[]`), each a record. */
function itemsOf(obj: Record<string, unknown>): Array<Record<string, unknown>> {
  const data = recordOf(obj.items).data;
  return Array.isArray(data) ? data.map(recordOf) : [];
}

/**
 * Whose subscription this is: `tagged` when the subscription (its `metadata`, set by the Payment
 * Link's `subscription_data.metadata`) or one of its prices carries Agathon's tag, and its `plan`
 * (`metadata.plan_id`, from the same places). A subscription Fuime sells carries neither.
 */
export function subscriptionPlanOf(obj: Record<string, unknown>): { tagged: boolean; plan: string | null } {
  const sources = [metadataOf(obj), ...itemsOf(obj).map((item) => metadataOf(recordOf(item.price)))];
  const ours = sources.filter((m) => m.app === APP_TAG);
  const plan = ours.map((m) => str(m.plan_id)).find((p): p is string => p !== null) ?? null;
  return { tagged: ours.length > 0, plan };
}

/** A Unix-seconds Stripe timestamp as ISO, or null. */
function isoOf(v: unknown): string | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? new Date(v * 1000).toISOString() : null;
}

/**
 * When the subscription's current period ends: the subscription's own `current_period_end` (API
 * versions before 2025-03-31), else the latest of its items' (newer versions moved it there; the
 * endpoint's API version is the account's default, which this code does not choose).
 */
export function periodEndOf(obj: Record<string, unknown>): string | null {
  const own = isoOf(obj.current_period_end);
  if (own) return own;
  const ends = itemsOf(obj)
    .map((item) => item.current_period_end)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0);
  return ends.length ? isoOf(Math.max(...ends)) : null;
}

const ignored = (reason: string): MappedEvent => ({ kind: "ignored", reason });
const foreign = (reason: string): MappedEvent => ({ kind: "foreign", reason });

/** The checkout's payer email (`customer_details.email`, else `customer_email`), trimmed, when it looks like one address. */
export function payerEmailOf(obj: Record<string, unknown>): string | null {
  const email = (str(recordOf(obj.customer_details).email) ?? str(obj.customer_email))?.trim() ?? "";
  return email.length >= 3 && email.length <= 320 && /^[^\s@,;<>]+@[^\s@,;<>]+$/.test(email) ? email : null;
}

/** checkout.session.completed with `mode: subscription` and our tag: the Unlimited link, or a retired plan. */
function mapSubscriptionCheckout(event: BillingEvent, obj: Record<string, unknown>): MappedEvent {
  const plan = str(metadataOf(obj).plan_id);
  // The Plus/Pro links of September also made subscription checkouts; they carried no plan_id.
  if (plan !== UNLIMITED_PLAN_ID) return ignored(`not a one-time payment (mode subscription, plan ${plan ?? "missing"})`);
  const sessionId = str(obj.id);
  if (!sessionId) return ignored("checkout session has no id");
  const subscriptionId = idOf(obj.subscription);
  if (!subscriptionId) return ignored("Agathon Unlimited checkout without a subscription id");
  // client_reference_id alone, never `metadata.user_id`: a plan is linked by checkout ref only.
  const rawRef = str(obj.client_reference_id);
  const checkoutRef = rawRef && UUID_RE.test(rawRef) ? rawRef.toLowerCase() : null;
  return {
    kind: "link",
    link: {
      subscriptionId,
      checkoutRef,
      clientReferenceId: rawRef,
      customerId: idOf(obj.customer),
      checkoutSessionId: sessionId,
      livemode: typeof obj.livemode === "boolean" ? obj.livemode : (event.livemode ?? null),
      payerEmail: payerEmailOf(obj),
      problem: checkoutRef
        ? null
        : rawRef
          ? "client_reference_id is not a checkout reference"
          : "no client_reference_id (the Payment Link was opened outside the app)",
    },
  };
}

/**
 * Stripe stamps events to the second, and a subscription's `created` and first `updated` often share
 * one (a change made right after checkout). Within a second a subscription is created before it is
 * updated, and updated before it is deleted, so the type breaks the tie: the event's time plus 0, 1
 * or 2 milliseconds. Two updates in the same second stay in arrival order.
 */
const SAME_SECOND_ORDER: Record<string, number> = {
  "customer.subscription.created": 0,
  "customer.subscription.updated": 1,
  "customer.subscription.deleted": 2,
};

/** The event's time as ISO, with SAME_SECOND_ORDER's tie-break; null when the event has none. */
export function subscriptionEventAt(event: Pick<BillingEvent, "type" | "created">): string | null {
  if (typeof event.created !== "number" || event.created <= 0) return null;
  return new Date(event.created * 1000 + (SAME_SECOND_ORDER[event.type] ?? 0)).toISOString();
}

/** customer.subscription.created / updated / deleted. */
function mapSubscription(event: BillingEvent, obj: Record<string, unknown>): MappedEvent {
  const { tagged, plan } = subscriptionPlanOf(obj);
  if (!tagged) return foreign("subscription is not tagged app=agathon-classroom");
  if (plan !== UNLIMITED_PLAN_ID) return ignored(`not an Agathon Unlimited subscription (plan ${plan ?? "missing"})`);
  const subscriptionId = str(obj.id);
  if (!subscriptionId) return ignored("subscription has no id");
  const raw = str(obj.status);
  const known = (SUBSCRIPTION_STATUSES as readonly string[]).includes(raw ?? "") ? (raw as SubscriptionStatus) : null;
  // A deleted subscription has ended, whatever its object still says.
  const status: SubscriptionStatus | null =
    event.type === "customer.subscription.deleted" ? (known === "incomplete_expired" ? known : "canceled") : known;
  if (!status) return ignored(`unknown subscription status ${raw ?? "(missing)"}`);
  return {
    kind: "subscription",
    subscription: {
      subscriptionId,
      customerId: idOf(obj.customer),
      status,
      priceId: itemsOf(obj).map((item) => idOf(item.price)).find((id): id is string => id !== null) ?? null,
      trialEnd: isoOf(obj.trial_end),
      currentPeriodEnd: periodEndOf(obj),
      cancelAtPeriodEnd: obj.cancel_at_period_end === true,
      cancelAt: isoOf(obj.cancel_at),
      canceledAt: isoOf(obj.canceled_at),
      endedAt: isoOf(obj.ended_at),
      livemode: typeof obj.livemode === "boolean" ? obj.livemode : (event.livemode ?? null),
      eventAt: subscriptionEventAt(event),
    },
  };
}

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
 *        Ours with `mode: "subscription"` and `metadata.plan_id = unlimited` -> link the
 *        subscription to the account whose checkout ref is `client_reference_id` (whatever
 *        `payment_status` says: a free trial's checkout pays nothing, and the subscription's own
 *        status decides the plan), with the payer's email; without a usable ref it is still
 *        recorded, linked to nobody, for the owner. Any other subscription checkout
 *        (the retired Plus/Pro links) -> ignored.
 *  - charge.refunded -> reverse by the charge's payment intent; `tagged` says whether the charge
 *        itself proves it is ours (else the handler checks for a recorded purchase first).
 *  - customer.subscription.created / updated / deleted -> the subscription's state when it, or
 *        one of its prices, carries our tag and `plan_id = unlimited`; untagged -> foreign (Fuime
 *        sells subscriptions too); tagged with another plan -> ignored.
 *  - anything else -> foreign: the endpoint subscribes to nothing else.
 */
export function mapBillingEvent(event: BillingEvent, priceMap: InkPriceMap): MappedEvent {
  const obj = event.data.object;

  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      if (!isAgathonObject(obj)) return foreign("checkout session is not tagged app=agathon-classroom");
      const mode = str(obj.mode);
      if (mode === "subscription") return mapSubscriptionCheckout(event, obj);
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

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return mapSubscription(event, obj);

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

export type LinkOutcome =
  /** The subscription is this user's (now, or already: a redelivery). */
  | { status: "linked"; userId: string; subscriptionStatus: string | null }
  /** Recorded, but linked to nobody: no usable user id, or the account no longer exists. */
  | { status: "unlinked"; reason: string }
  /** Already linked to another account; that link stands. */
  | { status: "conflict"; userId: string | null }
  | { status: "error"; message: string };

export type ApplyOutcome =
  | { status: "applied"; userId: string | null; unlimited: boolean }
  /** An older event than the one the row holds, or one that would revive an ended plan: nothing changed. */
  | { status: "stale"; current: string | null }
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
  /** link_unlimited_checkout(): idempotent, first link wins. */
  linkSubscription(link: UnlimitedLink): Promise<LinkOutcome>;
  /** apply_unlimited_subscription(): idempotent, ordered by the event's time. */
  applySubscription(subscription: UnlimitedSubscription): Promise<ApplyOutcome>;
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
    async linkSubscription(l) {
      const { data, error } = await client.rpc("link_unlimited_checkout", {
        p_subscription_id: l.subscriptionId,
        p_checkout_ref: l.checkoutRef,
        p_customer_id: l.customerId,
        p_checkout_session_id: l.checkoutSessionId,
        p_livemode: l.livemode,
        p_payer_email: l.payerEmail,
      });
      if (error) return { status: "error", message: error.message };
      const row = rowOf(data);
      if (!row) return { status: "error", message: "link_unlimited_checkout returned no row" };
      return linkOutcomeOf(row, l);
    },
    async applySubscription(s) {
      const { data, error } = await client.rpc("apply_unlimited_subscription", {
        p_subscription_id: s.subscriptionId,
        p_customer_id: s.customerId,
        p_status: s.status,
        p_price_id: s.priceId,
        p_trial_end: s.trialEnd,
        p_current_period_end: s.currentPeriodEnd,
        p_cancel_at_period_end: s.cancelAtPeriodEnd,
        p_cancel_at: s.cancelAt,
        p_canceled_at: s.canceledAt,
        p_ended_at: s.endedAt,
        p_livemode: s.livemode,
        p_event_at: s.eventAt,
      });
      if (error) return { status: "error", message: error.message };
      const row = rowOf(data);
      if (!row) return { status: "error", message: "apply_unlimited_subscription returned no row" };
      if (row.stale === true) return { status: "stale", current: typeof row.status === "string" ? row.status : null };
      return { status: "applied", userId: typeof row.user_id === "string" ? row.user_id : null, unlimited: row.unlimited === true };
    },
  };
}

/** Read link_unlimited_checkout()'s answer. Exported for tests. */
export function linkOutcomeOf(row: Record<string, unknown>, l: Pick<UnlimitedLink, "problem">): LinkOutcome {
  const userId = typeof row.user_id === "string" ? row.user_id : null;
  if (row.linked === true && userId) return { status: "linked", userId, subscriptionStatus: typeof row.status === "string" ? row.status : null };
  if (row.conflict === true) return { status: "conflict", userId };
  if (row.no_account === true) return { status: "unlinked", reason: "no account has this checkout reference (a user id, or an account deleted before the webhook?)" };
  return { status: "unlinked", reason: l.problem ?? "no user to link" };
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
  /**
   * The "free trial started" email for a subscription that may just have become linked and trialing
   * (src/lib/email/unlimitedStarted.ts: it checks, and email_log sends it once). Never throws.
   */
  confirmStarted: (subscriptionId: string, log: pino.Logger) => Promise<unknown>;
  /**
   * Run work AFTER the response has gone to Stripe: next/server's `after` (Vercel keeps the function
   * alive for it, up to its maxDuration). So email can neither fail the webhook (a non-2xx makes
   * Stripe redeliver) nor slow its answer.
   */
  defer: (work: () => Promise<unknown>) => void;
};

/** `after(work)`, or (outside a request, where `after` throws) work started now and not awaited. Never throws. */
export function deferAfterResponse(work: () => Promise<unknown>): void {
  // async: a work that throws synchronously becomes a rejection, swallowed like any other (the
  // email step logs its own failures).
  const run = async () => {
    try {
      await work();
    } catch {
      /* never the webhook's problem */
    }
  };
  try {
    after(run);
  } catch {
    void run();
  }
}

/**
 * What the webhook reads from outside the request: the env, the service-role store, the clock
 * (Unix seconds, for the signature tolerance), and the plan's confirmation email with the way it
 * runs after the response. The route calls these; tests replace them.
 */
export const webhookDeps: WebhookDeps = {
  getEnv: () => getServerEnv(),
  createStore: supabaseBillingStore,
  now: () => Math.floor(Date.now() / 1000),
  confirmStarted: (subscriptionId, log) => sendUnlimitedStarted(emailDeps, subscriptionId, log),
  defer: deferAfterResponse,
};
