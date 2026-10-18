/**
 * Which App Store payloads this deployment accepts (the APPLE_* variables; .env.example says each).
 *
 *   APPLE_ENVIRONMENT  Production    Production AND Sandbox. App Review and TestFlight buy in the
 *                                    Sandbox against the production server, and a reviewer whose
 *                                    purchase unlocks nothing rejects the app. Sandbox rows are
 *                                    recorded with livemode=false and left out of revenue.
 *                      Sandbox       Sandbox only (a staging deployment).
 *                      Xcode         StoreKit Testing in Xcode (ios/Agathon/Agathon.storekit): payloads
 *                      LocalTesting  signed by Xcode's local certificate, NOT by Apple, so anyone could
 *                                    forge one. Accepted only off production (NODE_ENV is not
 *                                    `production` and VERCEL_ENV is not `production`): a deployment
 *                                    configured so is refused outright. APPLE_XCODE_CERT, when set,
 *                                    pins Xcode's certificate (its signature is then checked).
 *                      unset         Apple billing is off: both routes answer 503.
 *   APPLE_BUNDLE_ID    the app's bundle id (default app.agathon.Agathon)
 *   APPLE_APP_APPLE_ID the app's numeric Apple ID (App Store Connect > App Information); required
 *                      with Production, where Apple's library checks notifications carry it.
 */
import { X509Certificate } from "node:crypto";
import { Environment } from "@apple/app-store-server-library";
import { APPLE_PLAN } from "@/lib/billing/apple";

export type AppleEnvName = `${Environment}`;

export type AppleConfig = {
  /** The configured environment (APPLE_ENVIRONMENT). */
  primary: AppleEnvName;
  /** Accepted, in the order they are tried. */
  environments: AppleEnvName[];
  bundleId: string;
  appAppleId?: number;
  /** Xcode's StoreKit test certificate (APPLE_XCODE_CERT), when pinned. */
  xcodeCert?: X509Certificate;
};

export type AppleConfigInput = {
  APPLE_ENVIRONMENT?: string;
  APPLE_BUNDLE_ID?: string;
  APPLE_APP_APPLE_ID?: string;
  APPLE_XCODE_CERT?: string;
  NODE_ENV?: string;
  VERCEL_ENV?: string;
};

export type AppleConfigError = {
  error: string;
  /** unset: Apple billing is simply off here; refused: an unsafe setting on a production deployment; invalid: a typo */
  kind: "unset" | "refused" | "invalid";
};

/** True on a deployment that serves real people: Xcode-signed payloads are refused there. */
export function isProductionDeployment(env: Pick<AppleConfigInput, "NODE_ENV" | "VERCEL_ENV">): boolean {
  return env.NODE_ENV === "production" || env.VERCEL_ENV === "production";
}

const LOCAL_ONLY: readonly AppleEnvName[] = [Environment.XCODE, Environment.LOCAL_TESTING];

/** A certificate given as PEM or as base64 DER. */
function parseCertificate(value: string): X509Certificate {
  const text = value.trim();
  if (text.includes("BEGIN CERTIFICATE")) return new X509Certificate(text);
  return new X509Certificate(Buffer.from(text.replace(/\s+/g, ""), "base64"));
}

/** Pure: the APPLE_* variables as a config, or why there is none. */
export function appleConfigFrom(input: AppleConfigInput): AppleConfig | AppleConfigError {
  const raw = input.APPLE_ENVIRONMENT?.trim();
  if (!raw) return { kind: "unset", error: "APPLE_ENVIRONMENT is not set: Apple in-app purchases are off on this deployment." };
  const known = (Object.values(Environment) as string[]).find((e) => e.toLowerCase() === raw.toLowerCase()) as AppleEnvName | undefined;
  if (!known) return { kind: "invalid", error: `APPLE_ENVIRONMENT must be Production, Sandbox, Xcode or LocalTesting (got "${raw.slice(0, 40)}").` };

  if (LOCAL_ONLY.includes(known) && isProductionDeployment(input)) {
    return {
      kind: "refused",
      error: `APPLE_ENVIRONMENT=${known} accepts purchases Apple never signed; it is refused on a production deployment (NODE_ENV/VERCEL_ENV production).`,
    };
  }

  const bundleId = input.APPLE_BUNDLE_ID?.trim() || APPLE_PLAN.bundleId;
  if (!/^[A-Za-z0-9.-]{3,155}$/.test(bundleId)) return { kind: "invalid", error: "APPLE_BUNDLE_ID is not a bundle identifier." };

  let appAppleId: number | undefined;
  const rawId = input.APPLE_APP_APPLE_ID?.trim();
  if (rawId) {
    if (!/^\d{1,15}$/.test(rawId)) return { kind: "invalid", error: "APPLE_APP_APPLE_ID must be the app's numeric Apple ID." };
    appAppleId = Number(rawId);
  }
  if (known === Environment.PRODUCTION && appAppleId === undefined) {
    return { kind: "invalid", error: "APPLE_ENVIRONMENT=Production needs APPLE_APP_APPLE_ID (App Store Connect > App Information > Apple ID)." };
  }

  let xcodeCert: X509Certificate | undefined;
  if (input.APPLE_XCODE_CERT?.trim() && LOCAL_ONLY.includes(known)) {
    try {
      xcodeCert = parseCertificate(input.APPLE_XCODE_CERT);
    } catch {
      return { kind: "invalid", error: "APPLE_XCODE_CERT is not a certificate (PEM, or base64 DER)." };
    }
  }

  const environments: AppleEnvName[] = known === Environment.PRODUCTION ? [Environment.PRODUCTION, Environment.SANDBOX] : [known];
  return { primary: known, environments, bundleId, appAppleId, xcodeCert };
}

export function isAppleConfigError(c: AppleConfig | AppleConfigError): c is AppleConfigError {
  return "error" in c;
}
