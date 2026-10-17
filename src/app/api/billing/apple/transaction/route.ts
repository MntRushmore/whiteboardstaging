import { APPLE_PLAN, APPLE_REFUSALS, AppleTransactionBodySchema } from "@/lib/billing/apple";
import { json, requireUser } from "@/lib/server/auth";
import { appleDeps, appleLogger, appleSetup, type AppleRouteEnv } from "@/lib/server/apple/deps";
import { appleStateOf } from "@/lib/server/apple/state";
import { AppleVerifyError } from "@/lib/server/apple/verify";
import { checkRateLimitDistributed, rateLimitedResponse } from "@/lib/server/rate-limit";
import { parseJsonBody, recordRouteEvent } from "@/lib/server/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** One verification (OCSP to Apple when the chain is not cached yet) and one RPC. */
export const maxDuration = 20;

/**
 * POST /api/billing/apple/transaction `{ transaction, renewalInfo? }` (AppleTransactionBody,
 * src/lib/billing/apple.ts): the iPad app hands over a StoreKit 2 transaction it was given (a
 * purchase, a renewal from `Transaction.updates`, a restore) so the plan is recorded at once, without
 * waiting for Apple's server notification. The app finishes the transaction after a 2xx or a 409.
 *
 * Who: the signed-in user (Bearer). The transaction must be signed by the App Store (Apple's library:
 * chain to Apple's root, OCSP, bundle id, environment; src/lib/server/apple/verify.ts) and be this
 * app's plan (`app.agathon.unlimited.monthly`). Its `appAccountToken` must be the checkout reference
 * of the caller's own family (a kid's session on the family iPad may forward the grown-up's
 * purchase); another account's purchase is refused with 409 `apple_account_mismatch` and nothing is
 * written. A purchase with no token (an offer code redeemed in the App Store) goes to the caller's
 * family if nobody has it yet (409 `apple_other_family` otherwise). The row always lands on the
 * family's grown-up (plan_owner_of): the plan is the family's.
 *
 * requireUser (401) -> the `appleTransaction` bucket (429) -> zod (400) -> 503 without Apple's setup
 * or the service role -> verification (400; 503 when Apple's revocation check cannot be reached) ->
 * apply_apple_subscription() (409 / 500) -> 200 `{ recorded, applied, status, unlimited }`, or
 * `{ recorded: false, ignored }` for a payload that is not this plan (another product).
 *
 * Every answer carries X-Request-Id; the signed payloads are never logged.
 */
const log = appleLogger.child({ route: "billing/apple/transaction" });

function respond(status: number, body: Record<string, unknown>, requestId: string): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Request-Id": requestId } });
}

function withId(res: Response, requestId: string): Response {
  res.headers.set("X-Request-Id", requestId);
  return res;
}

export async function POST(req: Request): Promise<Response> {
  const deps = appleDeps;
  const requestId = crypto.randomUUID();
  const auth = await requireUser(req);
  if ("response" in auth) return withId(auth.response, requestId);
  const { user, token } = auth;

  const rl = await checkRateLimitDistributed({ token, userId: user.id, bucket: "appleTransaction" });
  if (!rl.ok) return withId(rateLimitedResponse(rl.retryAfterMs, rl.backend), requestId);

  const body = await parseJsonBody(req, AppleTransactionBodySchema);
  if ("response" in body) return withId(body.response, requestId);

  const reqLog = log.child({ requestId, userId: user.id });
  let env: AppleRouteEnv;
  try {
    env = deps.getEnv();
  } catch (err) {
    reqLog.error({ error: err instanceof Error ? err.message : String(err) }, "server env invalid");
    return withId(json(500, "internal_error", "Server is not configured."), requestId);
  }
  const setup = appleSetup(env);
  if ("error" in setup) {
    const level = setup.error.kind === "refused" || setup.error.kind === "invalid" ? "error" : "warn";
    reqLog[level]({ kind: setup.error.kind, error: setup.error.error }, "Apple purchase posted but Apple billing is not set up here");
    return withId(json(503, "feature_unavailable", "In-app purchases are not set up on this server yet."), requestId);
  }

  const verifier = deps.createVerifier(setup.config);
  let transaction;
  try {
    transaction = await verifier.transaction(body.data.transaction);
  } catch (err) {
    const e = err instanceof AppleVerifyError ? err : new AppleVerifyError("invalid", String(err));
    if (e.kind === "retryable") {
      reqLog.warn({ error: e.message }, "Apple's revocation check could not be reached; the app retries");
      return withId(json(503, "upstream_error", "Couldn't confirm the purchase with Apple yet. It will be retried."), requestId);
    }
    reqLog.warn({ kind: e.kind, error: e.message, accepted: verifier.environments }, "Apple transaction refused: not verified");
    recordRouteEvent(reqLog, { level: "warn", code: `apple_${e.kind}`, message: "an Apple transaction failed verification", meta: { kind: e.kind } });
    return withId(json(400, "invalid_request", "That purchase could not be verified.", { reason: `apple_${e.kind}` }), requestId);
  }

  let renewalInfo = null;
  if (body.data.renewalInfo) {
    try {
      renewalInfo = await verifier.renewalInfo(body.data.renewalInfo);
    } catch (err) {
      // The transaction alone still records the plan; the renewal state comes with Apple's notification.
      reqLog.warn({ error: err instanceof Error ? err.message : String(err) }, "Apple renewal info not verified; recorded without it");
    }
  }

  const state = appleStateOf({
    transaction,
    renewalInfo,
    productId: APPLE_PLAN.productId,
    signedDate: transaction.signedDate ?? null,
    now: deps.now(),
  });
  if ("ignore" in state) {
    reqLog.info({ reason: state.ignore, product: transaction.productId ?? null }, "Apple transaction is not Agathon Unlimited; nothing recorded");
    return respond(200, { recorded: false, ignored: state.ignore }, requestId);
  }

  const where = { originalTransactionId: state.originalTransactionId, environment: state.environment, status: state.status };
  const store = deps.createStore(env.NEXT_PUBLIC_SUPABASE_URL, setup.serviceRoleKey);
  const outcome = await store.apply(state, user.id);
  switch (outcome.status) {
    case "applied":
    case "stale":
      reqLog.info(
        { ...where, applied: outcome.status === "applied", planUser: outcome.userId, unlimited: outcome.unlimited, linked: outcome.linked },
        outcome.status === "applied" ? "Apple subscription recorded from the app" : "older Apple transaction from the app; the newer state stands",
      );
      return respond(200, { recorded: true, applied: outcome.status === "applied", status: outcome.subscriptionStatus, unlimited: outcome.unlimited }, requestId);
    case "refused": {
      const reason = outcome.reason === "account_mismatch" ? APPLE_REFUSALS.accountMismatch : APPLE_REFUSALS.accountUnknown;
      reqLog.warn({ ...where, reason }, "Apple transaction belongs to another Agathon account; nothing written");
      return withId(json(409, "invalid_request", "This purchase was made from another Agathon account.", { reason }), requestId);
    }
    case "conflict":
      reqLog.warn(where, "Apple subscription is already another family's; nothing written");
      return withId(json(409, "invalid_request", "This subscription belongs to another Agathon family.", { reason: APPLE_REFUSALS.otherFamily }), requestId);
    default:
      reqLog.error({ ...where, error: outcome.message }, "could not record the Apple subscription; the app retries");
      recordRouteEvent(reqLog, { level: "error", code: "apple_apply_failed", message: "could not record an Apple subscription" });
      return withId(json(500, "internal_error", "Couldn't record the purchase. It will be retried."), requestId);
  }
}
