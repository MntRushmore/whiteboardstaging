import { z } from "zod";
import { appError, appRefusal } from "@/lib/server/appAttest/guard";
import { APP_ATTEST_LIMITS, REGISTER_MAX_BYTES } from "@/lib/server/appAttest/config";
import { attestLogger, registerKey } from "@/lib/server/appAttest/service";
import { appAttestDeps } from "@/lib/server/appAttest/store";
import { checkRateLimit } from "@/lib/server/rate-limit";
import { parseJson, readCapped, visitorIp } from "@/lib/server/try/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

const RegisterSchema = z
  .object({
    /** standard base64 of the 32-byte key id, as DCAppAttestService returns it */
    keyId: z.string().min(1).max(64),
    /** standard base64 of the CBOR attestation object */
    attestation: z.string().min(1).max(60_000),
    /** the challenge exactly as POST /api/app/attest/challenge gave it */
    challenge: z.string().min(1).max(64),
  })
  .strict();

/**
 * POST /api/app/attest/register `{ keyId, attestation, challenge }` — the second half of App Attest
 * for the iPad app before its account (src/lib/server/appAttest): the attestation is checked the
 * way Apple says (`verifyAttestation`: the certificate chain to the pinned Apple App Attestation
 * Root CA, the nonce over authData and SHA256 of the challenge's UTF-8 bytes, the key id, our App
 * ID, counter 0, the aaguid, the credential id), the challenge is used up, and the key is kept
 * (`app_attest_keys`: its public key, counter 0, development or production, the receipt). From then
 * on the app signs each call to /api/try/check, /api/try/help and /api/start/step with it.
 *
 * Answers 201 `{ ok: true }`, also for a key that is stored already (idempotent: a resend after a
 * lost answer; nothing changes). PUBLIC BY DESIGN (allow-listed in scripts/lib/routes.mjs). In
 * order: this IP's `APP_ATTEST_LIMITS.register` (in memory) -> 429 `rate_limited`; a body over 64 KB
 * -> 413, not the schema -> 400 `{ error: "invalid_request" }`; an attestation that fails any step,
 * or a new key on a challenge that is used up, expired or never issued -> 403
 * `{ error: "invalid_request", reason: "attest_invalid" }`; no service role or the database failing
 * -> 503 `unavailable`. One info line per answer (the step that failed; never the key id or an IP).
 */
export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  const log = attestLogger.child({ requestId, route: "attest/register" });
  const withId = (res: Response) => {
    res.headers.set("X-Request-Id", requestId);
    return res;
  };

  const mine = checkRateLimit(`ip:${visitorIp(req)}:appAttestRegister`, APP_ATTEST_LIMITS.register);
  if (!mine.ok) return withId(appError(429, "rate_limited", { retryAfterMs: mine.retryAfterMs }));

  const text = await readCapped(req, REGISTER_MAX_BYTES);
  if (text === null) return withId(appError(413, "invalid_request"));
  const parsed = RegisterSchema.safeParse(parseJson(text));
  if (!parsed.success) return withId(appError(400, "invalid_request"));

  const out = await registerKey(parsed.data, appAttestDeps);
  if (!out.ok) {
    if (out.status === 503) return withId(appError(503, "unavailable"));
    log.info({ step: out.why }, "app attest: attestation refused");
    return withId(appRefusal(out.reason));
  }
  log.info({ created: out.created, environment: out.environment }, "app attest: key registered");
  return withId(Response.json({ ok: true }, { status: 201, headers: { "Cache-Control": "no-store" } }));
}
