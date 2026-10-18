/**
 * Verifying what the App Store signed, with Apple's official library
 * (@apple/app-store-server-library's SignedDataVerifier): the x5c chain up to Apple's root
 * (roots.ts), the leaf's and intermediate's Apple OIDs, the certificates' dates, OCSP revocation
 * (`onlineChecks`), the JWS signature, then the bundle id, the environment and (Production) the app's
 * Apple ID. Nothing from a payload is used before this passes.
 *
 * A payload is verified by the verifier of the environment it names, when this deployment accepts that
 * environment (Production and Sandbox on production); any other is refused. Xcode and LocalTesting payloads are not
 * signed by Apple; Apple's library returns them decoded without a check (its own comment says the
 * caller must decide), which config.ts allows only off production. With APPLE_XCODE_CERT set, their
 * ES256 signature is checked against that certificate here.
 */
import { verify as verifySignature, type X509Certificate } from "node:crypto";
import {
  Environment,
  SignedDataVerifier,
  VerificationException,
  VerificationStatus,
  type JWSRenewalInfoDecodedPayload,
  type JWSTransactionDecodedPayload,
  type ResponseBodyV2DecodedPayload,
} from "@apple/app-store-server-library";
import type { AppleConfig, AppleEnvName } from "@/lib/server/apple/config";

/**
 * Why a payload was not accepted:
 *   invalid      not signed by Apple (or by the pinned Xcode certificate), malformed, expired chain
 *   environment  from an environment this deployment does not take (an Xcode purchase on production)
 *   app          another app's (bundle id, or Apple ID)
 *   retryable    Apple's revocation service could not be asked: try again later
 */
export type AppleVerifyKind = "invalid" | "environment" | "app" | "retryable";

export class AppleVerifyError extends Error {
  constructor(
    readonly kind: AppleVerifyKind,
    message: string,
  ) {
    super(message);
    this.name = "AppleVerifyError";
  }
}

export type AppleVerifier = {
  /** The environments tried, in order. */
  environments: readonly AppleEnvName[];
  transaction(jws: string): Promise<JWSTransactionDecodedPayload>;
  renewalInfo(jws: string): Promise<JWSRenewalInfoDecodedPayload>;
  notification(signedPayload: string): Promise<ResponseBodyV2DecodedPayload>;
};

export type VerifierOptions = {
  /** DER root certificates: Apple's (appleRootCertificates()), or a test root in tests. */
  roots: Buffer[];
  /** OCSP revocation checks and today's date for certificate validity (true in production). */
  onlineChecks: boolean;
};

function kindOf(status: VerificationStatus): AppleVerifyKind {
  switch (status) {
    case VerificationStatus.INVALID_ENVIRONMENT:
      return "environment";
    case VerificationStatus.INVALID_APP_IDENTIFIER:
      return "app";
    case VerificationStatus.RETRYABLE_VERIFICATION_FAILURE:
      return "retryable";
    default:
      return "invalid";
  }
}

function asVerifyError(err: unknown): AppleVerifyError {
  if (err instanceof AppleVerifyError) return err;
  if (err instanceof VerificationException) {
    return new AppleVerifyError(kindOf(err.status), `App Store verification failed: ${VerificationStatus[err.status] ?? err.status}`);
  }
  return new AppleVerifyError("invalid", `App Store verification failed: ${err instanceof Error ? err.message : String(err)}`);
}

/** Base64url to bytes. */
function b64url(part: string): Buffer {
  return Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/**
 * The pinned Xcode certificate's check: an ES256 compact JWS whose signature (raw r||s, as JWS
 * writes it) verifies under the certificate's public key. Throws AppleVerifyError("invalid").
 */
export function checkPinnedSignature(jws: string, cert: X509Certificate): void {
  const parts = jws.split(".");
  if (parts.length !== 3) throw new AppleVerifyError("invalid", "not a compact JWS");
  let alg: unknown;
  try {
    alg = (JSON.parse(b64url(parts[0]).toString("utf8")) as { alg?: unknown }).alg;
  } catch {
    throw new AppleVerifyError("invalid", "unreadable JWS header");
  }
  if (alg !== "ES256") throw new AppleVerifyError("invalid", "the JWS is not ES256");
  const ok = verifySignature("sha256", Buffer.from(`${parts[0]}.${parts[1]}`), { key: cert.publicKey, dsaEncoding: "ieee-p1363" }, b64url(parts[2]));
  if (!ok) throw new AppleVerifyError("invalid", "the JWS is not signed by the pinned Xcode certificate");
}

const LOCAL_ONLY: readonly AppleEnvName[] = [Environment.XCODE, Environment.LOCAL_TESTING];

export function createAppleVerifier(config: AppleConfig, opts: VerifierOptions): AppleVerifier {
  const verifiers = config.environments.map((env) => ({
    env,
    verifier: new SignedDataVerifier(opts.roots, opts.onlineChecks, env as Environment, config.bundleId, config.appAppleId),
  }));

  /**
   * The verifier for the environment the payload names (read before verifying, only to pick one: the
   * chosen verifier then checks everything, the environment included). Picking by name, not by trying
   * each in turn, matters: Production's verifier refuses a Sandbox notification for its missing app
   * Apple ID before it ever looks at the environment.
   */
  async function verifyAs<T>(jws: string, run: (v: SignedDataVerifier) => Promise<T>): Promise<T> {
    const named = claimedEnvironment(jws);
    const match = verifiers.find((v) => v.env === named);
    if (!match) {
      throw new AppleVerifyError("environment", `App Store environment ${named ? `"${String(named).slice(0, 20)}"` : "(none)"} is not accepted here (accepted: ${config.environments.join(", ")})`);
    }
    if (LOCAL_ONLY.includes(match.env) && config.xcodeCert) checkPinnedSignature(jws, config.xcodeCert);
    try {
      return await run(match.verifier);
    } catch (err) {
      throw asVerifyError(err);
    }
  }

  return {
    environments: config.environments,
    transaction: (jws) => verifyAs(jws, (v) => v.verifyAndDecodeTransaction(jws)),
    renewalInfo: (jws) => verifyAs(jws, (v) => v.verifyAndDecodeRenewalInfo(jws)),
    notification: (payload) => verifyAs(payload, (v) => v.verifyAndDecodeNotification(payload)),
  };
}

/**
 * The environment an (unverified) App Store payload names: a transaction's or renewal info's
 * `environment`, a notification's `data` / `summary` / `appData` environment. Null when unreadable.
 */
export function claimedEnvironment(jws: string): string | null {
  const parts = jws.split(".");
  if (parts.length !== 3) throw new AppleVerifyError("invalid", "not a compact JWS");
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(b64url(parts[1]).toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new AppleVerifyError("invalid", "unreadable JWS payload");
  }
  if (!body || typeof body !== "object") throw new AppleVerifyError("invalid", "unreadable JWS payload");
  const inner = (key: string) => {
    const v = body[key];
    return v && typeof v === "object" ? (v as Record<string, unknown>).environment : undefined;
  };
  const env = body.environment ?? inner("data") ?? inner("summary") ?? inner("appData");
  return typeof env === "string" ? env : null;
}
