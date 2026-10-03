import { parseInkPriceMap } from "@/lib/env";
import { billingLogger } from "@/lib/server/billing";
import { json } from "@/lib/server/auth";
import { EventSchema, livemodeAccepted, mapBillingEvent, webhookDeps, type WebhookEnv } from "@/lib/server/billingWebhook";
import { checkRateLimit, rateLimitedResponse } from "@/lib/server/rate-limit";
import { verifyStripeSignature } from "@/lib/server/webhookSignature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/billing/webhook — Stripe-compatible billing webhook for ink packs and Agathon Unlimited.
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
 *   checkout.session.completed with mode subscription (the Agathon Unlimited Payment Link)
 *       link_unlimited_checkout(): the subscription belongs to the account whose checkout ref
 *       (profiles.checkout_ref, never a user id) is client_reference_id, with the payer's email.
 *       Without a usable one it is recorded linked to nobody, logged at warn for the owner.
 *   customer.subscription.created / updated / deleted (Agathon Unlimited)
 *       apply_unlimited_subscription(): status, trial end, period end, cancellation
 *       (supabase/migrations/20261003020000_unlimited.sql). Stripe does not order deliveries: the
 *       subscription's events may land before the checkout that names its user, so either can
 *       create the row, and an older event that arrives late never overwrites a newer state.
 *
 * SHARED STRIPE ACCOUNT. The account also runs Fuime, so this endpoint receives Fuime's
 * checkouts and refunds too. Whether an event is Agathon's is decided BEFORE anything is
 * written: a Checkout Session is ours only with `metadata.app = "agathon-classroom"` (the
 * Payment Link's metadata, copied onto the session); a refund only when its charge carries that
 * tag or its payment intent is an ink purchase or review we recorded (a read, nothing written); a
 * subscription only when it (or its price) carries the tag, and only Unlimited's (`plan_id`).
 * A foreign event answers `200 { received: true, ignored: true }` and leaves NO row anywhere, not
 * even in billing_events: its payload holds another business's buyers' names, emails and addresses.
 *
 * MODE. STRIPE_LIVEMODE ("true" / "false") says which mode's events count; an event from the
 * other mode answers 400. Unset, a deployment accepts live events only, and a localhost dev
 * server accepts either (`stripe listen` forwards test events there).
 *
 * Idempotency: grant_ink_purchase is keyed on the Checkout Session id, reverse_ink_purchase on
 * the growth of the cumulative refunded amount, and the Unlimited writers on the subscription id
 * (with the event's time deciding between states), so a redelivered event is simply applied again
 * (and answers duplicate). `billing_events` is the log of the Agathon events received; a failure a
 * retry could fix answers 500 so Stripe redelivers. Nothing depends on that log for correctness,
 * so a redelivery whose first attempt failed half-way still gets its ink.
 */

/** Per-IP budget: Stripe retries are sparse; 120/min is far above any legitimate burst. */
const WEBHOOK_LIMIT = { limit: 120, windowMs: 60_000 } as const;
/** Real events are a few KB; refuse anything absurd before hashing it. */
const MAX_BODY_BYTES = 1_000_000;
const SIGNATURE_HEADER = "stripe-signature";

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

/** POST: the env, store and clock come from `webhookDeps` (src/lib/server/billingWebhook.ts; tests replace them). */
export async function POST(req: Request): Promise<Response> {
  const deps = webhookDeps;
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

  if (mapped.kind === "link") {
    const l = mapped.link;
    const outcome = await store.linkSubscription(l);
    switch (outcome.status) {
      case "linked":
        eventLog.info({ userId: outcome.userId, subscription: l.subscriptionId, status: outcome.subscriptionStatus }, "Agathon Unlimited linked to its account");
        return done(false);
      case "conflict":
        eventLog.warn({ subscription: l.subscriptionId, linkedTo: outcome.userId }, "Agathon Unlimited already linked to another account; the first link stands");
        return done(false);
      case "unlinked":
        // Paid for (or in its free week) but nobody gets the plan: loud, so the owner links it by hand.
        eventLog.warn(
          { subscription: l.subscriptionId, session: l.checkoutSessionId, customer: l.customerId, reason: outcome.reason },
          "Agathon Unlimited checkout NOT linked to an account: link it by hand (docs/RUNBOOK-billing.md)",
        );
        return done(false);
      default:
        return failed("could not link the Agathon Unlimited subscription", { error: outcome.message });
    }
  }

  if (mapped.kind === "subscription") {
    const s = mapped.subscription;
    const outcome = await store.applySubscription(s);
    switch (outcome.status) {
      case "applied":
        eventLog.info(
          { subscription: s.subscriptionId, status: s.status, userId: outcome.userId, unlimited: outcome.unlimited, cancelAtPeriodEnd: s.cancelAtPeriodEnd },
          outcome.userId ? "Agathon Unlimited subscription updated" : "Agathon Unlimited subscription recorded; its checkout has not linked an account yet",
        );
        return done(false);
      case "stale":
        eventLog.info({ subscription: s.subscriptionId, status: s.status, current: outcome.current }, "older Agathon Unlimited event arrived late; the newer state stands");
        return done(true);
      default:
        return failed("could not apply the Agathon Unlimited subscription", { error: outcome.message });
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
}
