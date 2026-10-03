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
 * validated with zod. Ink changes go through service-role-only RPCs because adding ink must
 * bypass the user's own grants (the service role is otherwise used only for refunds of failed
 * calls, src/lib/server/billing.ts, and storage GC).
 *
 * What it acts on (scripts/stripe-setup.mjs subscribes the endpoint to exactly these):
 *   checkout.session.completed / checkout.session.async_payment_succeeded
 *       a paid one-time checkout -> grant_ink_purchase(): the pack's ink for the user in
 *       client_reference_id, once per Checkout Session id, and only when the amount paid (USD)
 *       covers the pack. What cannot be granted (no user, no pack, underpaid, nothing paid) is
 *       recorded in ink_checkout_reviews with no ink, for the owner.
 *   charge.refunded
 *       reverse_ink_purchase(): takes the refunded share of that purchase's ink back, at most
 *       what is still unspent (supabase/migrations/20261002000000_ink.sql)
 *
 * SHARED STRIPE ACCOUNT. The account also runs Fuime, so this endpoint receives Fuime's
 * checkouts and refunds too. Whether an event is Agathon's is decided BEFORE anything is
 * written: a Checkout Session is ours only with `metadata.app = "agathon-classroom"` (the
 * Payment Link's metadata, copied onto the session); a refund only when its charge carries that
 * tag or its payment intent is an ink purchase or review we recorded (a read, nothing written).
 * A foreign event answers `200 { received: true, ignored: true }` and leaves NO row anywhere, not
 * even in billing_events: its payload holds another business's buyers' names, emails and addresses.
 *
 * MODE. STRIPE_LIVEMODE ("true" / "false") says which mode's events count; an event from the
 * other mode answers 400. Unset, a deployment accepts live events only, and a localhost dev
 * server accepts either (`stripe listen` forwards test events there).
 *
 * Idempotency: grant_ink_purchase is keyed on the Checkout Session id and reverse_ink_purchase on
 * the growth of the cumulative refunded amount, so a redelivered event is simply applied again
 * (and answers duplicate). `billing_events` is the log of the Agathon events received; a failure a
 * retry could fix answers 500 so Stripe redelivers. Nothing depends on that log for correctness,
 * so a redelivery whose first attempt failed half-way still gets its ink.
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
/* Handler                                                                    */
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

function requestHost(req: Request): string {
  try {
    return new URL(req.url).hostname;
  } catch {
    return "";
  }
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

    if (!livemodeAccepted(event.livemode, env.STRIPE_LIVEMODE, requestHost(req))) {
      eventLog.error({ livemode: event.livemode ?? null, expected: env.STRIPE_LIVEMODE ?? "live (unset)" }, "event from the wrong Stripe mode; check STRIPE_LIVEMODE and the endpoint");
      return json(400, "invalid_request", "livemode mismatch");
    }

    // Ours or not is decided before anything is written or logged in full (see the header).
    const mapped = mapBillingEvent(event, priceMap.map);
    if (mapped.kind === "foreign") {
      eventLog.info({ reason: mapped.reason }, "not an Agathon event; ignored, nothing stored");
      return Response.json({ received: true, ignored: true });
    }
    if (mapped.kind === "ignored") {
      eventLog.info({ reason: mapped.reason }, "Agathon event with nothing to do yet");
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
    if (recorded.status === "error") {
      eventLog.error({ error: recorded.message }, "billing_events insert failed; is the billing migration applied?");
      return json(503, "feature_unavailable", "Billing is not set up on this deployment — run the migrations.");
    }
    // A redelivery is applied again: the RPCs below are idempotent, so a first attempt that failed
    // half-way (and could not even forget its event id) still ends with the ink granted.
    const redelivered = recorded.status === "duplicate";
    if (redelivered) eventLog.info("redelivered event; applying it again (idempotent)");

    // Retryable failures: answer 500 so Stripe redelivers (and drop the log row, loudly if that fails).
    const failed = async (message: string, logged: Record<string, unknown>) => {
      eventLog.error(logged, message);
      if (!redelivered) {
        const forgot = await store.forgetEvent(event.id).catch((err: unknown) => ({ error: err instanceof Error ? err.message : String(err) }));
        if ("error" in forgot) eventLog.error({ error: forgot.error }, "could not delete the billing_events row of a failed event (harmless: the retry is applied again)");
      }
      return json(500, "internal_error", "Could not apply the billing update.");
    };
    const done = (duplicate: boolean) => Response.json(duplicate ? { received: true, duplicate: true } : { received: true });

    if (mapped.kind === "review") {
      const r = mapped.review;
      const outcome = await store.recordReview(r, event.id);
      if ("error" in outcome) return failed("could not record the checkout for review", { error: outcome.error });
      eventLog.warn(
        { session: r.checkoutSessionId, reason: r.reason, recorded: outcome.recorded },
        "Agathon checkout NOT granted: recorded in ink_checkout_reviews for the owner",
      );
      return done(!outcome.recorded);
    }

    if (mapped.kind === "grant") {
      const p = mapped.purchase;
      const outcome = await store.grantPurchase(p, event.id);
      switch (outcome.status) {
        case "granted":
          eventLog.info({ userId: p.userId, packId: p.packId, granted: outcome.granted, balance: outcome.balance }, "ink purchase granted");
          return done(false);
        case "duplicate":
          eventLog.info({ packId: p.packId }, "checkout session already handled");
          return done(true);
        case "review":
          // Paid (or claimed paid) but not grantable: no ink, and loud, so the owner looks at it.
          eventLog.warn(
            { userId: p.userId, packId: p.packId, session: p.checkoutSessionId, amountCents: p.amountCents, currency: p.currency, reason: outcome.reason },
            "Agathon checkout NOT granted: recorded in ink_checkout_reviews for the owner",
          );
          return done(false);
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
        return done(false);
      case "duplicate":
        eventLog.info({ paymentIntent: r.paymentIntentId }, "refund already applied");
        return done(true);
      case "review":
        eventLog.info({ paymentIntent: r.paymentIntentId }, "refund of a checkout that was waiting for review (no ink to take back)");
        return done(false);
      case "not_found":
        // Ours (tagged, or found a moment ago), but its purchase is not recorded yet: the refund
        // arrived before the checkout's grant. Stripe retries until the grant has landed, so the
        // refund is never lost and the later grant can never keep the refunded ink.
        return failed("refund arrived before its ink purchase was recorded; asking Stripe to retry", { paymentIntent: r.paymentIntentId });
      default:
        return failed("ink refund reversal failed", { error: outcome.message });
    }
  };
}

export const POST = createWebhookHandler();
