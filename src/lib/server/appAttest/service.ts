/**
 * The two App Attest routes' work, between their limits and their answers (route files may export
 * only handlers):
 *
 *   POST /api/app/attest/challenge  -> `issueChallenge`: 32 random bytes (base64url), kept for
 *                                      CHALLENGE_TTL_MS and good for one registration.
 *   POST /api/app/attest/register   -> `registerKey`: the attestation checked (`verifyAttestation`,
 *                                      clientDataHash = SHA256 of the challenge string's UTF-8 bytes),
 *                                      then the challenge used up, then the key stored with counter 0.
 *
 * Registering a key that is already stored is IDEMPOTENT (201 again, nothing changes, the counter
 * is kept): the app may resend the same attestation after losing the first answer, and by then its
 * challenge is used up; the attestation still has to verify in full, and since the key id is the
 * hash of the certificate's key, the same key id is always the same key. A NEW key on a challenge
 * that is used up, expired or never issued is refused.
 */
import { logger } from "@/lib/logger";
import { CHALLENGE_TTL_MS } from "./config";
import { isChallenge, newChallenge, parseKeyId, decodeStandardBase64 } from "./encoding";
import type { AppAttestDeps } from "./store";
import { sha256, verifyAttestation, type AttestationFailure } from "./verify";

export const attestLogger = logger.child({ module: "appAttest" });

/** The attestation object at most, as base64 (a receipt makes it ~6 KB). */
const ATTESTATION_MAX_CHARS = 60_000;

export type ChallengeOutcome = { ok: true; challenge: string; expiresAt: string } | { ok: false; status: 503 };

/** A new one-time challenge. 503 without a store or when it cannot be saved. */
export async function issueChallenge(deps: AppAttestDeps): Promise<ChallengeOutcome> {
  const store = deps.store();
  if (!store) return { ok: false, status: 503 };
  const now = deps.now();
  const challenge = newChallenge();
  const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS);
  try {
    await store.saveChallenge(challenge, expiresAt, now);
  } catch (err) {
    attestLogger.warn({ error: err instanceof Error ? err.message : String(err) }, "app attest: challenge not saved");
    return { ok: false, status: 503 };
  }
  return { ok: true, challenge, expiresAt: expiresAt.toISOString() };
}

export interface RegisterInput {
  keyId: string;
  attestation: string;
  challenge: string;
}

export type RegisterOutcome =
  | { ok: true; created: boolean; environment: "development" | "production" }
  | { ok: false; status: 403; reason: "attest_invalid"; why: AttestationFailure | "key_id_format" | "challenge" }
  | { ok: false; status: 503 };

/** Checks and stores one attested key (see the file comment). */
export async function registerKey(input: RegisterInput, deps: AppAttestDeps): Promise<RegisterOutcome> {
  const refuse = (why: AttestationFailure | "key_id_format" | "challenge"): RegisterOutcome => ({ ok: false, status: 403, reason: "attest_invalid", why });
  const key = parseKeyId(input.keyId);
  if (!key) return refuse("key_id_format");
  if (!isChallenge(input.challenge)) return refuse("challenge");
  const attestation = decodeStandardBase64(input.attestation, ATTESTATION_MAX_CHARS);
  if (!attestation) return refuse("format");
  const store = deps.store();
  if (!store) return { ok: false, status: 503 };

  const now = deps.now();
  const verdict = verifyAttestation({
    keyId: key.bytes,
    attestation,
    clientDataHash: sha256(Buffer.from(input.challenge, "utf8")),
    appId: deps.appId(),
    now,
    roots: deps.roots(),
  });
  if (!verdict.ok) return refuse(verdict.why);

  try {
    if (!(await store.consumeChallenge(input.challenge, now))) {
      // a resend after a lost answer: the key is stored already, so nothing to do
      const stored = await store.getKey(key.id);
      return stored ? { ok: true, created: false, environment: stored.environment } : refuse("challenge");
    }
    const saved = await store.saveKey({ keyId: key.id, publicKeyPem: verdict.publicKeyPem, environment: verdict.environment, receipt: verdict.receipt ? verdict.receipt.toString("base64") : null }, now);
    return { ok: true, created: saved === "created", environment: verdict.environment };
  } catch (err) {
    attestLogger.warn({ error: err instanceof Error ? err.message : String(err) }, "app attest: key not stored");
    return { ok: false, status: 503 };
  }
}
