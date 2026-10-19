import { APPLE_PLAN, AppleNotificationBodySchema } from "@/lib/billing/apple";
import { json } from "@/lib/server/auth";
import { appleDeps, appleLogger, appleSetup, type AppleRouteEnv } from "@/lib/server/apple/deps";
import { appleStateOf } from "@/lib/server/apple/state";
import { AppleVerifyError } from "@/lib/server/apple/verify";
import { checkRateLimit, clientIp, rateLimitedResponse } from "@/lib/server/rate-limit";
import { recordRouteEvent } from "@/lib/server/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

/**
 * POST /api/billing/apple/notifications — App Store Server Notifications V2 for Agathon Unlimited
 * bought in the iPad app (docs/RUNBOOK-billing.md section 16: the URL to give App Store Connect for
 * Production and for Sandbox).
 *
 * PUBLIC BY DESIGN (allow-listed in scripts/lib/routes.mjs, reason "signature-verified provider
 * webhook"): Apple has no user JWT. The authentication is the payload itself: `signedPayload` is a
 * JWS whose x5c chain must reach Apple's root (src/lib/server/apple/roots.ts) with Apple's OIDs, pass
 * OCSP, and name this app's bundle id, App Store environment and (Production) Apple ID; the
 * transaction and renewal info inside are JWS of their own and verified the same way
 * (src/lib/server/apple/verify.ts, Apple's official library). Anything else answers 400.
 *
 * What it does: the notification's subscription state (src/lib/server/apple/state.ts maps Apple's
 * `data.status`, the transaction and the renewal info onto unlimited_subscriptions' statuses) goes
 * through apply_apple_subscription(), linked to the account whose checkout_ref is the purchase's
 * appAccountToken (through plan_owner_of: the family's grown-up), ordered by the notification's
 * signedDate so an older notification that arrives late never overwrites a newer state. Handled:
 * SUBSCRIBED, DID_RENEW, DID_FAIL_TO_RENEW, GRACE_PERIOD_EXPIRED, EXPIRED, REFUND, REVOKE,
 * DID_CHANGE_RENEWAL_STATUS, OFFER_REDEEMED, and any other type that carries the subscription's
 * transaction (REFUND_REVERSED, RENEWAL_EXTENDED, DID_CHANGE_RENEWAL_PREF, PRICE_INCREASE, ...), whose
 * state is applied the same way. TEST is recorded and answered 200 (App Store Connect's "Send test
 * notification"). CONSUMPTION_REQUEST and summaries change nothing.
 *
 * Idempotency: each notification is logged once in billing_events as `apple:<notificationUUID>`; a
 * redelivery is applied again (every write is idempotent) and answers `duplicate`. A failure a retry
 * could fix answers 500 (or 503 for Apple's revocation check) so Apple redelivers (up to five times
 * over three days in Production).
 */
const NOTIFICATION_LIMIT = { limit: 120, windowMs: 60_000 } as const;
/** Real notifications are a few KB (three JWS with their chains); refuse anything absurd before parsing. */
const MAX_BODY_BYTES = 256_000;

const log = appleLogger.child({ route: "billing/apple/notifications" });

/** What billing_events keeps: the decoded notification, without the signed blobs (no personal data either way). */
function eventPayload(n: Record<string, unknown>, transaction: unknown, renewalInfo: unknown): Record<string, unknown> {
  const data = (n.data ?? {}) as Record<string, unknown>;
  return {
    notificationType: n.notificationType ?? null,
    subtype: n.subtype ?? null,
    notificationUUID: n.notificationUUID ?? null,
    signedDate: n.signedDate ?? null,
    version: n.version ?? null,
    environment: data.environment ?? null,
    status: data.status ?? null,
    transaction: transaction ?? null,
    renewalInfo: renewalInfo ?? null,
  };
}

export async function POST(req: Request): Promise<Response> {
  const deps = appleDeps;
  const requestId = crypto.randomUUID();
  const rl = checkRateLimit(`ip:${clientIp(req)}:appleNotifications`, NOTIFICATION_LIMIT);
  if (!rl.ok) return rateLimitedResponse(rl.retryAfterMs);

  let env: AppleRouteEnv;
  try {
    env = deps.getEnv();
  } catch (err) {
    log.error({ requestId, error: err instanceof Error ? err.message : String(err) }, "server env invalid");
    return json(500, "internal_error", "Server is not configured.");
  }
  const setup = appleSetup(env);
  if ("error" in setup) {
    log.error({ requestId, kind: setup.error.kind, error: setup.error.error }, "App Store notification received but Apple billing is not set up here; Apple retries");
    return json(503, "feature_unavailable", "In-app purchases are not set up on this deployment.");
  }

  const rawBody = await req.text();
  if (rawBody.length > MAX_BODY_BYTES) return json(400, "invalid_request", "Payload too large.");
  let raw: unknown;
  try {
    raw = JSON.parse(rawBody);
  } catch {
    return json(400, "invalid_request", "Request body must be valid JSON.");
  }
  const parsed = AppleNotificationBodySchema.safeParse(raw);
  if (!parsed.success) return json(400, "invalid_request", "Expected { signedPayload }.");

  const verifier = deps.createVerifier(setup.config);
  const refused = (err: unknown, what: string) => {
    const e = err instanceof AppleVerifyError ? err : new AppleVerifyError("invalid", String(err));
    if (e.kind === "retryable") {
      log.warn({ requestId, error: e.message }, `${what}: Apple's revocation check could not be reached; Apple retries`);
      return json(503, "upstream_error", "Verification is temporarily unavailable.");
    }
    log.warn({ requestId, kind: e.kind, error: e.message, ip: clientIp(req) }, `${what} refused: not verified`);
    return json(400, "invalid_request", "bad signature");
  };

  let notification;
  try {
    notification = await verifier.notification(parsed.data.signedPayload);
  } catch (err) {
    return refused(err, "App Store notification");
  }
  const type = String(notification.notificationType ?? "");
  const subtype = notification.subtype ? String(notification.subtype) : null;
  const uuid = typeof notification.notificationUUID === "string" ? notification.notificationUUID : "";
  if (!type || !/^[0-9A-Za-z-]{8,64}$/.test(uuid)) return json(400, "invalid_request", "Notification without a type or id.");
  const noteLog = log.child({ requestId, notification: uuid, type, subtype });

  const data = notification.data;
  let transaction = null;
  let renewalInfo = null;
  try {
    if (data?.signedTransactionInfo) transaction = await verifier.transaction(data.signedTransactionInfo);
    if (data?.signedRenewalInfo) renewalInfo = await verifier.renewalInfo(data.signedRenewalInfo);
  } catch (err) {
    return refused(err, "App Store notification's transaction");
  }

  const store = deps.createStore(env.NEXT_PUBLIC_SUPABASE_URL, setup.serviceRoleKey);
  const eventId = `apple:${uuid}`;
  const recorded = await store.recordEvent({
    id: eventId,
    type: `apple.${type}${subtype ? `.${subtype}` : ""}`.slice(0, 200),
    payload: eventPayload(notification as unknown as Record<string, unknown>, transaction, renewalInfo),
  });
  if (recorded.status === "error") {
    noteLog.error({ error: recorded.message }, "billing_events insert failed; is the billing migration applied? Apple retries");
    return json(503, "feature_unavailable", "Billing is not set up on this deployment — run the migrations.");
  }
  const redelivered = recorded.status === "duplicate";
  if (redelivered) noteLog.info("redelivered notification; applying it again (idempotent)");
  const done = (extra: Record<string, unknown> = {}) => Response.json({ received: true, ...(redelivered ? { duplicate: true } : {}), ...extra });

  if (type === "TEST") {
    noteLog.info({ environment: data?.environment ?? null }, "App Store test notification received");
    return done({ test: true });
  }
  if (!transaction || type === "CONSUMPTION_REQUEST") {
    noteLog.info("App Store notification with no subscription state to apply");
    return done({ ignored: true });
  }

  const state = appleStateOf({
    transaction,
    renewalInfo,
    status: typeof data?.status === "number" ? data.status : null,
    notificationType: type,
    subtype,
    signedDate: typeof notification.signedDate === "number" ? notification.signedDate : null,
    productId: APPLE_PLAN.productId,
    now: deps.now(),
  });
  if ("ignore" in state) {
    noteLog.info({ reason: state.ignore }, "App Store notification is not Agathon Unlimited's; nothing applied");
    return done({ ignored: true });
  }

  const where = { originalTransactionId: state.originalTransactionId, environment: state.environment, status: state.status, cancelAtPeriodEnd: state.cancelAtPeriodEnd };
  const outcome = await store.apply(state, null);
  if (outcome.status === "applied" || outcome.status === "stale") {
    if (outcome.status === "stale") noteLog.info(where, "older App Store notification arrived late; the newer state stands");
    else if (!outcome.userId) {
      noteLog.warn(where, "Apple subscription NOT linked to an account (no account has its appAccountToken); recorded for the owner");
    } else noteLog.info({ ...where, planUser: outcome.userId, unlimited: outcome.unlimited, linked: outcome.linked }, "Apple subscription updated");
    return done(outcome.status === "stale" ? { stale: true } : {});
  }

  const message = outcome.status === "error" ? outcome.message : outcome.status;
  noteLog.error({ ...where, error: message }, "could not apply the App Store notification; Apple retries");
  recordRouteEvent(noteLog, { level: "error", code: "apple_apply_failed", message: "could not apply an App Store notification" });
  if (!redelivered) {
    const forgot = await store.forgetEvent(eventId).catch((err: unknown) => ({ error: err instanceof Error ? err.message : String(err) }));
    if ("error" in forgot) noteLog.error({ error: forgot.error }, "could not delete the billing_events row of a failed notification (harmless: the retry is applied again)");
  }
  return json(500, "internal_error", "Could not apply the billing update.");
}
