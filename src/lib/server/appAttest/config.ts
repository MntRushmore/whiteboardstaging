/**
 * App Attest for the iPad app's calls before the account (docs/ONBOARDING.md, "Server work this
 * needs" 1): the constants, the pinned Apple root, and the two things read from the environment.
 *
 * Read here, not through src/lib/env.ts (another lane edits that file; route files may not read
 * process.env at all):
 *  - `APP_ATTEST_APP_ID`: the App ID whose SHA-256 every attestation and assertion must carry as its
 *    RP ID hash. Default `SG4YJW2K5Z.app.agathon.Agathon` (team SG4YJW2K5Z, bundle
 *    app.agathon.Agathon).
 *  - whether the debug bypass may be used (`debugBypassAllowed`): never on a production server.
 */
import { X509Certificate } from "node:crypto";

/** Team ID + "." + bundle ID, as Apple hashes it into authData's RP ID. */
export const DEFAULT_APP_ID = "SG4YJW2K5Z.app.agathon.Agathon";

/** The App ID attestations and assertions are checked against (env APP_ATTEST_APP_ID, else DEFAULT_APP_ID). */
export function appAttestAppId(): string {
  const raw = process.env.APP_ATTEST_APP_ID?.trim();
  return raw && /^[A-Z0-9]{10}\.[A-Za-z0-9.-]+$/.test(raw) ? raw : DEFAULT_APP_ID;
}

/**
 * The simulator cannot attest, so a build for it sends `X-Agathon-App-Debug: <a uuid it keeps>`
 * instead of an assertion. Accepted ONLY when this server is not production: NODE_ENV is not
 * "production" (so `next build` + `next start`, and every Vercel deployment, refuse it) and
 * VERCEL_ENV is not "production" either (belt and braces). In practice: `next dev` and the tests.
 */
export function debugBypassAllowed(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV !== "production" && env.VERCEL_ENV !== "production";
}

const HOUR = 60 * 60_000;

/** A challenge lives 5 minutes and is good for one registration. */
export const CHALLENGE_TTL_MS = 5 * 60_000;

/**
 * In-memory limits per IP (`visitorIp`) on the attest routes, and a coarse one on the app path's
 * verification itself (it reads the key from the database before anything else limits it). The
 * routes' own limits (per IP and per attested key) come after.
 */
export const APP_ATTEST_LIMITS = {
  challenge: { limit: 30, windowMs: HOUR },
  register: { limit: 20, windowMs: HOUR },
  verify: { limit: 600, windowMs: HOUR },
} as const;

/** The register body at most: a key id, a challenge and an attestation object (~6 KB of base64, a receipt inside). */
export const REGISTER_MAX_BYTES = 65_536;
/** The assertion header at most (base64 of `{ signature, authenticatorData }`, ~200 bytes in practice). */
export const ASSERTION_MAX_CHARS = 4_096;

/** The headers the app sends on /api/try/check, /api/try/help and /api/start/step (lower case, as Headers reads them). */
export const APP_HEADERS = {
  key: "x-agathon-app-key",
  assertion: "x-agathon-app-assertion",
  debug: "x-agathon-app-debug",
} as const;

/**
 * Apple App Attestation Root CA, pinned (fetched 2026-10-17 from
 * https://www.apple.com/certificateauthority/Apple_App_Attestation_Root_CA.pem).
 * P-384, valid 2020-03-18 to 2045-03-15.
 * SHA-256 fingerprint: 1C:B9:82:3B:A2:8B:A6:AD:2D:33:A0:06:94:1D:E2:AE:4F:51:3E:F1:D4:E8:31:B9:F7:E0:FA:7B:62:42:C9:32
 */
export const APPLE_APP_ATTESTATION_ROOT_CA_PEM = `-----BEGIN CERTIFICATE-----
MIICITCCAaegAwIBAgIQC/O+DvHN0uD7jG5yH2IXmDAKBggqhkjOPQQDAzBSMSYw
JAYDVQQDDB1BcHBsZSBBcHAgQXR0ZXN0YXRpb24gUm9vdCBDQTETMBEGA1UECgwK
QXBwbGUgSW5jLjETMBEGA1UECAwKQ2FsaWZvcm5pYTAeFw0yMDAzMTgxODMyNTNa
Fw00NTAzMTUwMDAwMDBaMFIxJjAkBgNVBAMMHUFwcGxlIEFwcCBBdHRlc3RhdGlv
biBSb290IENBMRMwEQYDVQQKDApBcHBsZSBJbmMuMRMwEQYDVQQIDApDYWxpZm9y
bmlhMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAERTHhmLW07ATaFQIEVwTtT4dyctdh
NbJhFs/Ii2FdCgAHGbpphY3+d8qjuDngIN3WVhQUBHAoMeQ/cLiP1sOUtgjqK9au
Yen1mMEvRq9Sk3Jm5X8U62H+xTD3FE9TgS41o0IwQDAPBgNVHRMBAf8EBTADAQH/
MB0GA1UdDgQWBBSskRBTM72+aEH/pwyp5frq5eWKoTAOBgNVHQ8BAf8EBAMCAQYw
CgYIKoZIzj0EAwMDaAAwZQIwQgFGnByvsiVbpTKwSga0kP0e8EeDS4+sQmTvb7vn
53O5+FRXgeLhpJ06ysC5PrOyAjEAp5U4xDgEgllF7En3VcE3iexZZtKeYnpqtijV
oyFraWVIyd/dganmrduC1bmTBGwD
-----END CERTIFICATE-----
`;

/** The pinned fingerprint (hex, no colons): `pinnedRoots` refuses to start with anything else. */
export const APPLE_APP_ATTESTATION_ROOT_SHA256 = "1CB9823BA28BA6AD2D33A006941DE2AE4F513EF1D4E831B9F7E0FA7B6242C932";

let roots: readonly X509Certificate[] | null = null;

/** The trusted roots: Apple's, parsed once, its fingerprint checked against the pin. */
export function pinnedRoots(): readonly X509Certificate[] {
  if (!roots) {
    const root = new X509Certificate(APPLE_APP_ATTESTATION_ROOT_CA_PEM);
    if (root.fingerprint256.replace(/:/g, "") !== APPLE_APP_ATTESTATION_ROOT_SHA256) throw new Error("App Attest: the pinned Apple root does not match its fingerprint");
    roots = [root];
  }
  return roots;
}
