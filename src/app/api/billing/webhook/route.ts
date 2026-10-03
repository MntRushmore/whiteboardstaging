import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { getServerEnv, parseInkPriceMap, type InkPriceMap } from "@/lib/env";
import { billingLogger } from "@/lib/server/billing";
import { json } from "@/lib/server/auth";
import { checkRateLimit, rateLimitedResponse } from "@/lib/server/rate-limit";
import { verifyStripeSignature } from "@/lib/server/webhookSignature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/billing/webhook — Stripe-compatible billing webhook for ink packs.
 *
 * PUBLIC BY DESIGN (allow-listed in scripts/lib/routes.mjs, reason "signature-verified
 * provider webhook"): the provider has no user JWT. Authentication is the
 * `Stripe-Signature` header (HMAC-SHA256 over `${t}.${rawBody}` with STRIPE_WEBHOOK_SECRET,
 * 5-minute tolerance) verified in src/lib/server/webhookSignature.ts. The body is read
 * as RAW TEXT because the signature covers the exact bytes; the parsed event is then
 * validated with zod. Ink changes go through service-role-only RPCs (the only request path
 * that uses the service role) because adding ink must bypass the user's own grants.
 *
 * What it acts on (scripts/stripe-setup.mjs subscribes the endpoint to exactly these):
 *   checkout.session.completed / checkout.session.async_payment_succeeded
 *       a paid one-time checkout -> grant_ink_purchase(): the pack's ink for the user in
 *       client_reference_id, recorded once per Checkout Session id
 *   charge.refunded
 *       reverse_ink_purchase(): takes the refunded share of that purchase's ink back, at most
 *       what is still unspent (supabase/migrations/20261002000000_ink.sql)
 *
 * SHARED STRIPE ACCOUNT. The account also runs Fuime, so this endpoint receives Fuime's
 * checkouts and refunds too. Whether an event is Agathon's is decided BEFORE anything is
 * written: a Checkout Session is ours only with `metadata.app = "agathon-classroom"` (the
 * Payment Link's metadata, copied onto the session); a refund only when its charge carries that
 * tag or its payment intent is an ink purchase we recorded (a read, nothing written). A foreign
 * event answers `200 { received: true, ignored: true }` and leaves NO row anywhere, not even in
 * billing_events: its payload holds another business's buyers' names, emails and addresses.
 *
 * Idempotency, three layers: every event we act on is inserted into `billing_events` first (a
 * duplicate answers `200 { received: true, duplicate: true }`); a Checkout Session can grant once
 * (unique key); a refund only acts on the growth of the cumulative refunded amount. A failure
 * that a retry could fix deletes the event id again and answers 500, so Stripe redelivers it.
 */

/** `metadata.app` on every Stripe object Agathon creates (APP_TAG in scripts/stripe-setup.mjs). */
export const APP_TAG = "agathon-classroom";

/** Per-IP budget: Stripe retries are sparse; 120/min is far above any legitimate burst. */
const WEBHOOK_LIMIT = { limit: 120, windowMs: 60_000 } as const;
/** Real events are a few KB; refuse anything absurd before hashing it. */
const MAX_BODY_BYTES = 1_000_000;
const SIGNATURE_HEADER = "stripe-signature";

/* ------------------------------------------------------------------------- */
/* Event schema + pure mapping                                                */
/* ------------------------------------------------------------------------- */

const EventSchema = z.object({
  id: z.string().min(1).max(200),
  type: z.string().min(1).max(200),
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
  /** `amount_total` in the smallest unit; null when the event does not say (the pack's price is used). */
  amountCents: number | null;
  currency: string | null;
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
   * The charge carries `metadata.app = agathon-classroom`. Without it the refund is ours only if
   * its payment intent is a recorded ink purchase, which the handler asks the store (a read).
   */
  tagged: boolean;
};

export type MappedEvent =
  /** Not Agathon's (Fuime's, or nobody's): nothing is written, not even the event id. */
  | { kind: "foreign"; reason: string }
  /** Agathon's, but nothing to do (unpaid, unmatched user, unknown pack): nothing is written. */
  | { kind: "ignored"; reason: string }
  | { kind: "grant"; purchase: InkPurchase }
  | { kind: "reverse"; refund: InkRefund };

/** The event types the handler acts on (scripts/stripe-setup.mjs WEBHOOK_EVENTS must match). */
export const HANDLED_EVENTS = ["checkout.session.completed", "checkout.session.async_payment_succeeded", "charge.refunded"] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Pack ids as `ink_packs` allows them (ink_packs_id_format). */
const PACK_ID_RE = /^[a-z][a-z0-9_-]{0,31}$/;
/**
 * `payment_status` values that mean the money is in. `no_payment_required` is a checkout the
 * owner made free (a 100 % promotion code); it still bought the pack.
 */
const PAID_STATUSES = new Set(["paid", "no_payment_required"]);

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

function metadataOf(obj: Record<string, unknown>): Record<string, unknown> {
  const m = obj.metadata;
  return m && typeof m === "object" && !Array.isArray(m) ? (m as Record<string, unknown>) : {};
}

/** First `price.id` under `line_items.data[]` (only present when the session was expanded). */
function firstPriceId(obj: Record<string, unknown>): string | null {
  const list = obj.line_items;
  const data = list && typeof list === "object" ? (list as { data?: unknown }).data : undefined;
  if (!Array.isArray(data)) return null;
  for (const item of data) {
    const price = item && typeof item === "object" ? (item as { price?: unknown }).price : undefined;
    const id = idOf(price);
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

const ignored = (reason: string): MappedEvent => ({ kind: "ignored", reason });
const foreign = (reason: string): MappedEvent => ({ kind: "foreign", reason });

/** True when the Stripe object carries Agathon's tag. */
export function isAgathonObject(obj: Record<string, unknown>): boolean {
  return metadataOf(obj).app === APP_TAG;
}

/**
 * Pure: provider event -> what to do. No I/O.
 *
 *  - checkout.session.completed, checkout.session.async_payment_succeeded
 *        Without `metadata.app = agathon-classroom` the session is someone else's (foreign).
 *        Ours with `mode: "payment"` and `payment_status: "paid"` (a delayed method's session
 *        completes unpaid and succeeds later; the grant is keyed on the session id, so both
 *        events together still grant once) -> grant the pack (`metadata.pack_id`, else
 *        INK_PRICE_MAP) to `client_reference_id` (our user id). Ours but unpaid, without a user
 *        id (the Payment Link opened outside the app) or without a known pack -> ignored.
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
      if (!paymentStatus || !PAID_STATUSES.has(paymentStatus)) {
        return ignored(`not paid (payment_status ${paymentStatus ?? "missing"})`);
      }
      const userId = str(obj.client_reference_id) ?? str(metadataOf(obj).user_id);
      if (!userId) return ignored("no client_reference_id");
      if (!UUID_RE.test(userId)) return ignored("client_reference_id is not a user id");
      const sessionId = str(obj.id);
      if (!sessionId) return ignored("checkout session has no id");
      const packId = packIdOf(obj, priceMap);
      if (!packId) return ignored("no pack_id in metadata and price not in INK_PRICE_MAP");
      return {
        kind: "grant",
        purchase: {
          userId: userId.toLowerCase(),
          packId,
          checkoutSessionId: sessionId,
          paymentIntentId: idOf(obj.payment_intent),
          customerId: idOf(obj.customer),
          amountCents: int(obj.amount_total),
          currency: str(obj.currency)?.toLowerCase() ?? null,
        },
      };
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

/* ------------------------------------------------------------------------- */
/* Persistence (service role) behind a small interface so tests can fake it   */
/* ------------------------------------------------------------------------- */

export type GrantOutcome =
  | { status: "granted"; granted: number; balance: number }
  | { status: "duplicate" }
  /** The user was deleted between paying and the webhook: nobody to give the ink to. */
  | { status: "no_account" }
  /** The pack is not in `ink_packs` (migration missing, or a link for a pack that was removed). */
  | { status: "unknown_pack" }
  | { status: "error"; message: string };

export type ReverseOutcome =
  | { status: "reversed"; reversed: number; requested: number; balance: number }
  | { status: "duplicate" }
  | { status: "not_found" }
  | { status: "error"; message: string };

export type BillingStore = {
  /** Read-only: is this payment intent an ink purchase we recorded? (An untagged refund's test.) */
  isInkPayment(paymentIntentId: string): Promise<boolean | { error: string }>;
  /** Insert the event id (and payload: only ever an Agathon event); "duplicate" when it was already recorded. */
  recordEvent(event: BillingEvent): Promise<{ status: "inserted" | "duplicate" } | { status: "error"; message: string }>;
  /** Undo `recordEvent` so a failed grant can be retried by the provider. */
  forgetEvent(eventId: string): Promise<void>;
  grantPurchase(purchase: InkPurchase): Promise<GrantOutcome>;
  reversePurchase(refund: InkRefund): Promise<ReverseOutcome>;
};

const UNIQUE_VIOLATION = "23505";
/** Postgres codes grant_ink_purchase() raises: bad input (an unknown pack) and a missing account. */
const INVALID_PARAMETER = "22023";
const NO_DATA_FOUND = "P0002";

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
      const { data, error } = await client.from("ink_purchases").select("id").eq("payment_intent_id", paymentIntentId).limit(1);
      if (error) return { error: error.message };
      return Array.isArray(data) && data.length > 0;
    },
    async recordEvent(event) {
      const { error } = await client.from("billing_events").insert({ id: event.id, type: event.type, payload: event });
      if (!error) return { status: "inserted" };
      if (error.code === UNIQUE_VIOLATION) return { status: "duplicate" };
      return { status: "error", message: error.message };
    },
    async forgetEvent(eventId) {
      await client.from("billing_events").delete().eq("id", eventId);
    },
    async grantPurchase(p) {
      const { data, error } = await client.rpc("grant_ink_purchase", {
        p_user_id: p.userId,
        p_pack_id: p.packId,
        p_checkout_session_id: p.checkoutSessionId,
        p_payment_intent_id: p.paymentIntentId,
        p_customer_id: p.customerId,
        p_amount_cents: p.amountCents,
        p_currency: p.currency,
      });
      if (error) {
        if (error.code === NO_DATA_FOUND) return { status: "no_account" };
        if (error.code === INVALID_PARAMETER && /unknown ink pack/i.test(error.message)) return { status: "unknown_pack" };
        return { status: "error", message: error.message };
      }
      const row = rowOf(data);
      if (!row) return { status: "error", message: "grant_ink_purchase returned no row" };
      if (row.duplicate === true) return { status: "duplicate" };
      return { status: "granted", granted: num(row.granted), balance: num(row.balance) };
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
      if (row.duplicate === true) return { status: "duplicate" };
      return { status: "reversed", reversed: num(row.reversed), requested: num(row.requested), balance: num(row.balance) };
    },
  };
}

/* ------------------------------------------------------------------------- */
/* Handler                                                                    */
/* ------------------------------------------------------------------------- */

export type WebhookEnv = {
  NEXT_PUBLIC_SUPABASE_URL: string;
  STRIPE_WEBHOOK_SECRET?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  INK_PRICE_MAP?: string;
};

export type WebhookDeps = {
  getEnv: () => WebhookEnv;
  createStore: (url: string, serviceRoleKey: string) => BillingStore;
  /** Unix seconds (signature tolerance). */
  now: () => number;
};

const defaultDeps: WebhookDeps = {
  getEnv: () => getServerEnv(),
  createStore: supabaseBillingStore,
  now: () => Math.floor(Date.now() / 1000),
};

/** First hop of `x-forwarded-for` (Vercel sets it), else `x-real-ip`, else "unknown". */
function clientIp(req: Request): string {
  const first = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return first || req.headers.get("x-real-ip")?.trim() || "unknown";
}

const log = billingLogger.child({ route: "billing/webhook" });

/** Build the POST handler; `deps` are only overridden by tests. */
export function createWebhookHandler(deps: WebhookDeps = defaultDeps): (req: Request) => Promise<Response> {
  return async function handleWebhook(req: Request): Promise<Response> {
    const requestId = crypto.randomUUID();
    const rl = checkRateLimit(`ip:${clientIp(req)}:billingWebhook`, WEBHOOK_LIMIT);
    if (!rl.ok) return rateLimitedResponse(rl.retryAfterMs);

    let env: WebhookEnv;
    try {
      env = deps.getEnv();
    } catch (err) {
      log.error({ requestId, error: err instanceof Error ? err.message : String(err) }, "server env invalid");
      return json(500, "internal_error", "Server is not configured.");
    }
    if (!env.STRIPE_WEBHOOK_SECRET || !env.SUPABASE_SERVICE_ROLE_KEY) {
      log.warn({ requestId }, "webhook called but STRIPE_WEBHOOK_SECRET / SUPABASE_SERVICE_ROLE_KEY are not set");
      return json(503, "feature_unavailable", "Billing webhooks are not configured on this deployment.");
    }
    const priceMap = parseInkPriceMap(env.INK_PRICE_MAP);
    if ("error" in priceMap) {
      log.error({ requestId, error: priceMap.error }, "INK_PRICE_MAP invalid");
      return json(503, "feature_unavailable", priceMap.error);
    }

    const rawBody = await req.text();
    if (rawBody.length > MAX_BODY_BYTES) return json(400, "invalid_request", "Payload too large.");

    const verified = await verifyStripeSignature({
      header: req.headers.get(SIGNATURE_HEADER),
      rawBody,
      secret: env.STRIPE_WEBHOOK_SECRET,
      now: deps.now(),
    });
    if (!verified) {
      log.warn({ requestId, ip: clientIp(req) }, "bad webhook signature");
      return json(400, "invalid_request", "bad signature");
    }

    let raw: unknown;
    try {
      raw = JSON.parse(rawBody);
    } catch {
      return json(400, "invalid_request", "Request body must be valid JSON.");
    }
    const parsed = EventSchema.safeParse(raw);
    if (!parsed.success) return json(400, "invalid_request", "Unrecognised event shape.");
    const event = parsed.data;
    const eventLog = log.child({ requestId, eventId: event.id, eventType: event.type });

    // Ours or not is decided before anything is written or logged in full (see the header).
    const mapped = mapBillingEvent(event, priceMap.map);
    if (mapped.kind === "foreign") {
      eventLog.info({ reason: mapped.reason }, "not an Agathon event; ignored, nothing stored");
      return Response.json({ received: true, ignored: true });
    }
    if (mapped.kind === "ignored") {
      // Ours, so worth a line: an unmatched paid checkout means someone paid outside the app.
      eventLog.warn({ reason: mapped.reason }, "Agathon event ignored");
      return Response.json({ received: true, ignored: true });
    }

    const store = deps.createStore(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

    if (mapped.kind === "reverse" && !mapped.refund.tagged) {
      const ours = await store.isInkPayment(mapped.refund.paymentIntentId);
      if (typeof ours === "object") {
        eventLog.error({ error: ours.error }, "could not look up the refunded payment; Stripe will retry");
        return json(503, "feature_unavailable", "Billing is not set up on this deployment — run the migrations.");
      }
      if (!ours) {
        eventLog.info("refund of a payment that is not an ink purchase; ignored, nothing stored");
        return Response.json({ received: true, ignored: true });
      }
    }

    // The full payload only at debug: it carries the customer's email and address.
    eventLog.debug({ payload: rawBody.slice(0, 4000) }, "webhook payload");
    const recorded = await store.recordEvent(event);
    if (recorded.status === "duplicate") {
      eventLog.info("duplicate event");
      return Response.json({ received: true, duplicate: true });
    }
    if (recorded.status === "error") {
      eventLog.error({ error: recorded.message }, "billing_events insert failed; is the billing migration applied?");
      return json(503, "feature_unavailable", "Billing is not set up on this deployment — run the migrations.");
    }

    // Retryable failures: forget the event id so Stripe's redelivery is processed again.
    const failed = async (message: string, logged: Record<string, unknown>) => {
      eventLog.error(logged, message);
      await store.forgetEvent(event.id).catch(() => undefined);
      return json(500, "internal_error", "Could not apply the billing update.");
    };

    if (mapped.kind === "grant") {
      const p = mapped.purchase;
      const outcome = await store.grantPurchase(p);
      switch (outcome.status) {
        case "granted":
          eventLog.info({ userId: p.userId, packId: p.packId, granted: outcome.granted, balance: outcome.balance }, "ink purchase granted");
          return Response.json({ received: true });
        case "duplicate":
          eventLog.info({ packId: p.packId }, "checkout session already granted");
          return Response.json({ received: true, duplicate: true });
        case "no_account":
          // Paid, but the account is gone: nothing a retry can fix. Loud, so the payment is refunded by hand.
          eventLog.error({ userId: p.userId, packId: p.packId, session: p.checkoutSessionId }, "ink purchase for a deleted account; refund it in Stripe");
          return Response.json({ received: true, ignored: true });
        case "unknown_pack":
          return failed("ink purchase names a pack that is not in ink_packs", { packId: p.packId });
        default:
          return failed("ink purchase grant failed", { error: outcome.message });
      }
    }

    const r = mapped.refund;
    const outcome = await store.reversePurchase(r);
    switch (outcome.status) {
      case "reversed":
        eventLog.info(
          { paymentIntent: r.paymentIntentId, reversed: outcome.reversed, requested: outcome.requested, balance: outcome.balance },
          outcome.reversed < outcome.requested ? "refund reversed the unspent ink only" : "refund reversed ink",
        );
        return Response.json({ received: true });
      case "duplicate":
        eventLog.info({ paymentIntent: r.paymentIntentId }, "refund already applied");
        return Response.json({ received: true, duplicate: true });
      case "not_found":
        // A tagged charge with no recorded purchase (its checkout was never matched to a user).
        eventLog.warn({ paymentIntent: r.paymentIntentId }, "refund of an Agathon payment that granted no ink");
        return Response.json({ received: true, ignored: true });
      default:
        return failed("ink refund reversal failed", { error: outcome.message });
    }
  };
}

export const POST = createWebhookHandler();
