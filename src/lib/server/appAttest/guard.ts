/**
 * The app path of the routes used before the account: POST /api/try/check, POST /api/try/help and
 * POST /api/start/step. The web page still gets in as before (`isSameOrigin`); a request carrying
 * the app's headers takes this path instead, whatever else it says.
 *
 * The headers (APP_HEADERS):
 *   X-Agathon-App-Key:       the key id DCAppAttestService gave the app (standard base64, 32 bytes),
 *                            registered once through POST /api/app/attest/register
 *   X-Agathon-App-Assertion: standard base64 of the CBOR assertion `{ signature, authenticatorData }`
 *                            made with clientDataHash = SHA256(the exact request body bytes)
 *   X-Agathon-App-Debug:     a uuid the device keeps, INSTEAD of the two above, from a build that
 *                            cannot attest (the simulator). Accepted only off production
 *                            (`debugBypassAllowed`: NODE_ENV and VERCEL_ENV both not "production").
 *
 * Two steps, because the assertion covers the body:
 *  1. `appClaimOf(req)`, headers only, before the body is read. No app header: null, the web path.
 *     Otherwise a key and an assertion that decode, or (off production) a debug uuid alone; anything
 *     else is refused here: 403 `attest_required` (no assertion: the debug header in production, a
 *     key without an assertion, an assertion without a key) or `attest_invalid` (headers that do not
 *     decode, a debug id that is not a uuid).
 *  2. `verifyAppClaim(claim, body, ip)`, once the capped body is read: a coarse per-IP limit on
 *     verifications (APP_ATTEST_LIMITS.verify, 429), then for a key: the key known (else 403
 *     `attest_unknown_key`: the app attests a new key once and retries), the assertion good for this
 *     body (`verifyAssertion`) and its counter moved forward in one conditional update (a replay
 *     fails), else 403 `attest_invalid`. The key store unreachable: 503 `unavailable` (fail closed).
 *     A debug claim passes as is. The pass says who to limit: `appkey:<key id>` or
 *     `appdebug:<uuid>`; the routes then apply the web's own limits to that AND to the IP.
 *
 * Every refusal is `{ error: "invalid_request", reason }` with 403, never cached. One info line per
 * refusal (the reason and Apple's failed step), never a key id, a device id or an IP.
 */
import { checkRateLimit } from "@/lib/server/rate-limit";
import { APP_ATTEST_LIMITS, APP_HEADERS, ASSERTION_MAX_CHARS } from "./config";
import { decodeStandardBase64, parseDeviceId, parseKeyId } from "./encoding";
import { attestLogger } from "./service";
import { appAttestDeps, type AppAttestDeps } from "./store";
import { verifyAssertion } from "./verify";

export type AppRefusalReason = "attest_required" | "attest_invalid" | "attest_unknown_key";
export type AppError = "invalid_request" | "rate_limited" | "unavailable";

/** What the app's headers claim, read before the body. */
export type AppClaim =
  | { kind: "attest"; keyId: string; assertion: Buffer }
  | { kind: "debug"; deviceId: string }
  | { kind: "refused"; reason: Exclude<AppRefusalReason, "attest_unknown_key"> };

/** Through the app path: which one, and the identity its limits are keyed on. */
export interface AppPass {
  ok: true;
  path: "app" | "debug";
  who: string;
}
export type AppVerdict = AppPass | { ok: false; response: Response };

/** `{ error, reason?, retryAfterMs? }`, never cached; a 429 also says Retry-After. The try and start routes' error shape. */
export function appError(status: number, error: AppError, extra: { reason?: AppRefusalReason; retryAfterMs?: number } = {}): Response {
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  const body: Record<string, unknown> = { error };
  if (extra.reason) body.reason = extra.reason;
  if (extra.retryAfterMs !== undefined) {
    headers["Retry-After"] = String(Math.max(1, Math.ceil(extra.retryAfterMs / 1000)));
    body.retryAfterMs = Math.max(0, Math.round(extra.retryAfterMs));
  }
  return Response.json(body, { status, headers });
}

/** 403 `{ error: "invalid_request", reason }`. */
export function appRefusal(reason: AppRefusalReason): Response {
  return appError(403, "invalid_request", { reason });
}

/** Step 1 (see the file comment): null for a request without the app's headers. */
export function appClaimOf(req: Request, deps: Pick<AppAttestDeps, "debugAllowed"> = appAttestDeps): AppClaim | null {
  const key = req.headers.get(APP_HEADERS.key);
  const assertion = req.headers.get(APP_HEADERS.assertion);
  const debug = req.headers.get(APP_HEADERS.debug);
  if (key === null && assertion === null && debug === null) return null;

  if (key !== null && assertion !== null) {
    const id = parseKeyId(key);
    const bytes = decodeStandardBase64(assertion, ASSERTION_MAX_CHARS);
    return id && bytes ? { kind: "attest", keyId: id.id, assertion: bytes } : { kind: "refused", reason: "attest_invalid" };
  }
  if (debug !== null && assertion === null && deps.debugAllowed()) {
    const deviceId = parseDeviceId(debug);
    return deviceId ? { kind: "debug", deviceId } : { kind: "refused", reason: "attest_invalid" };
  }
  return { kind: "refused", reason: "attest_required" };
}

/** Step 2 (see the file comment). `ip`: the caller's `visitorIp`, only ever a key in this instance's memory. */
export async function verifyAppClaim(claim: Exclude<AppClaim, { kind: "refused" }>, body: Buffer, ip: string, deps: AppAttestDeps = appAttestDeps): Promise<AppVerdict> {
  const tries = checkRateLimit(`ip:${ip}:appAttestVerify`, APP_ATTEST_LIMITS.verify);
  if (!tries.ok) return { ok: false, response: appError(429, "rate_limited", { retryAfterMs: tries.retryAfterMs }) };
  if (claim.kind === "debug") return { ok: true, path: "debug", who: `appdebug:${claim.deviceId}` };

  const store = deps.store();
  if (!store) return { ok: false, response: appError(503, "unavailable") };
  try {
    const key = await store.getKey(claim.keyId);
    if (!key) {
      attestLogger.info({ reason: "attest_unknown_key" }, "app path refused");
      return { ok: false, response: appRefusal("attest_unknown_key") };
    }
    const checked = verifyAssertion({ assertion: claim.assertion, clientData: body, appId: deps.appId(), publicKeyPem: key.publicKeyPem, storedSignCount: key.signCount });
    if (!checked.ok) {
      attestLogger.info({ reason: "attest_invalid", step: checked.why }, "app path refused");
      return { ok: false, response: appRefusal("attest_invalid") };
    }
    if (!(await store.advanceCounter(claim.keyId, checked.signCount, deps.now()))) {
      attestLogger.info({ reason: "attest_invalid", step: "counter_raced" }, "app path refused");
      return { ok: false, response: appRefusal("attest_invalid") };
    }
    return { ok: true, path: "app", who: `appkey:${claim.keyId}` };
  } catch (err) {
    attestLogger.warn({ error: err instanceof Error ? err.message : String(err) }, "app path: the key store failed; refused");
    return { ok: false, response: appError(503, "unavailable") };
  }
}

/** For the logs: which path a request took, from its claim (null: the web page). */
export function pathOf(claim: AppClaim | null): "web" | "app" | "debug" {
  return claim === null ? "web" : claim.kind === "debug" ? "debug" : "app";
}
