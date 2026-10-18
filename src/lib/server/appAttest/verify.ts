/**
 * App Attest, checked the way Apple says ("Validating apps that connect to your server",
 * developer.apple.com/documentation/devicecheck/validating-apps-that-connect-to-your-server, and the
 * worked example in its "Attestation object validation guide"). Pure: no I/O, no clock of its own
 * (`now` is passed in), no database (the stored key and its counter are passed in and handed back).
 *
 * An ATTESTATION (once per key, POST /api/app/attest/register) is
 * `{ fmt: "apple-appattest", attStmt: { x5c: [credCert, intermediate], receipt }, authData }` in CBOR.
 * It is good when, in this order (the failure each step answers):
 *   1. it decodes to that shape                                                        `format`
 *   2. x5c's certificates chain to a pinned root (Apple App Attestation Root CA), each one valid at
 *      `now`, each issuer a CA                                                          `chain`
 *   3. nonce = SHA256(authData ‖ clientDataHash) equals the single OCTET STRING in credCert's
 *      extension 1.2.840.113635.100.8.2 (clientDataHash: SHA256 of the challenge's UTF-8 bytes) `nonce`
 *   4. SHA256 of credCert's public key (P-256, X9.62 uncompressed point) equals the key id `key_id`
 *   5. authData's RP ID hash equals SHA256(App ID)                                       `rp_id`
 *   6. authData's counter is 0                                                           `counter`
 *   7. authData's aaguid is "appattestdevelop" (development) or "appattest" + seven 0x00
 *      (production); which one is kept as the key's environment. Both are accepted: only our team
 *      can sign an app with our App ID, whichever environment it was built for.           `aaguid`
 *   8. authData's credentialId equals the key id                                         `credential_id`
 * and then the key's public key (SPKI PEM), its environment and the receipt are kept.
 *
 * An ASSERTION (every app call before the account) is `{ signature, authenticatorData }` in CBOR,
 * over clientDataHash = SHA256 of the request's exact body bytes. It is good when:
 *   1. it decodes to that shape                                                         `format`
 *   2. authenticatorData's RP ID hash equals SHA256(App ID)                              `rp_id`
 *   3. the ECDSA P-256 signature (DER) verifies with the stored public key over
 *      nonce = SHA256(authenticatorData ‖ clientDataHash), hashed with SHA-256 — i.e.
 *      `createVerify("sha256").update(nonce).verify(key, signature)`: DCAppAttestService signs the
 *      nonce as a message with ECDSA-SHA256 (the open-source verifiers do exactly this; the tests
 *      sign with node:crypto's `sign("sha256", nonce, key)`, the same algorithm)       `signature`
 *   4. its counter is strictly greater than the stored one (the caller then stores it with a
 *      conditional update, so a replayed assertion fails even when two race)             `counter`
 */
import { createHash, createVerify, timingSafeEqual, X509Certificate, type KeyObject } from "node:crypto";
import { cborBytes, decodeCbor, isCborMap, type CborValue } from "./cbor";
import { certificateExtension, singleOctetString } from "./der";

export const APP_ATTEST_FMT = "apple-appattest";
/** The credential certificate's extension holding the attestation's nonce. */
export const NONCE_OID = "1.2.840.113635.100.8.2";
export const AAGUID_DEVELOPMENT = Buffer.from("appattestdevelop", "ascii");
export const AAGUID_PRODUCTION = Buffer.concat([Buffer.from("appattest", "ascii"), Buffer.alloc(7)]);

export type AttestEnvironment = "development" | "production";

export const sha256 = (...parts: Buffer[]): Buffer => {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return h.digest();
};

const same = (a: Buffer, b: Buffer): boolean => a.length === b.length && timingSafeEqual(a, b);

// ------------------------------------------------------------------ authenticator data

/** WebAuthn's authenticator data as App Attest fills it. */
export interface AuthData {
  rpIdHash: Buffer;
  flags: number;
  signCount: number;
  /** present when the attested-credential flag (0x40) is set: the attestation's, not an assertion's */
  attested: { aaguid: Buffer; credentialId: Buffer } | null;
}

const FLAG_ATTESTED = 0x40;

/**
 * rpIdHash (32) | flags (1) | signCount (4, big-endian) | [aaguid (16) | credentialIdLength (2) |
 * credentialId | credentialPublicKey (COSE) | extensions]. Only what comes before the COSE key is
 * read (the key itself is taken from credCert, as Apple says). Null when too short.
 */
export function parseAuthData(data: Buffer): AuthData | null {
  if (data.length < 37) return null;
  const rpIdHash = data.subarray(0, 32);
  const flags = data[32];
  const signCount = data.readUInt32BE(33);
  if ((flags & FLAG_ATTESTED) === 0) return { rpIdHash, flags, signCount, attested: null };
  if (data.length < 37 + 18) return null;
  const aaguid = data.subarray(37, 53);
  const idLength = data.readUInt16BE(53);
  if (data.length < 55 + idLength) return null;
  return { rpIdHash, flags, signCount, attested: { aaguid, credentialId: data.subarray(55, 55 + idLength) } };
}

// ------------------------------------------------------------------ the chain

/** When a certificate says it is valid (node's strings are "Mar 18 18:32:53 2020 GMT"). */
function validAt(cert: X509Certificate, now: Date): boolean {
  const from = Date.parse(cert.validFrom);
  const to = Date.parse(cert.validTo);
  const t = now.getTime();
  return Number.isFinite(from) && Number.isFinite(to) && from <= t && t <= to;
}

/** `certs[0]` (the leaf) when every certificate is signed by the next and the last by one of `roots`, all valid at `now`. */
export function chainLeaf(certs: readonly X509Certificate[], roots: readonly X509Certificate[], now: Date): X509Certificate | null {
  if (certs.length < 2 || certs.length > 4) return null;
  for (let i = 0; i < certs.length; i += 1) {
    const cert = certs[i];
    if (!validAt(cert, now)) return null;
    const issuer = certs[i + 1];
    if (issuer) {
      if (!issuer.ca || !cert.checkIssued(issuer) || !cert.verify(issuer.publicKey)) return null;
      continue;
    }
    const root = roots.find((r) => r.ca && cert.checkIssued(r) && cert.verify(r.publicKey));
    if (!root || !validAt(root, now)) return null;
  }
  return certs[0];
}

/** A P-256 public key as an X9.62 uncompressed point (0x04 ‖ X ‖ Y), or null for any other key. */
export function uncompressedPoint(key: KeyObject): Buffer | null {
  if (key.asymmetricKeyType !== "ec") return null;
  const jwk = key.export({ format: "jwk" });
  if (jwk.crv !== "P-256" || !jwk.x || !jwk.y) return null;
  const x = Buffer.from(jwk.x, "base64url");
  const y = Buffer.from(jwk.y, "base64url");
  if (x.length !== 32 || y.length !== 32) return null;
  return Buffer.concat([Buffer.from([0x04]), x, y]);
}

// ------------------------------------------------------------------ attestation

export type AttestationFailure = "format" | "chain" | "nonce" | "key_id" | "rp_id" | "counter" | "aaguid" | "credential_id";

export type AttestationResult =
  | { ok: true; publicKeyPem: string; environment: AttestEnvironment; receipt: Buffer | null }
  | { ok: false; why: AttestationFailure };

export interface AttestationInput {
  /** the key id, decoded (32 bytes) */
  keyId: Buffer;
  /** the attestation object, decoded from base64 */
  attestation: Buffer;
  /** SHA256 of the challenge's UTF-8 bytes */
  clientDataHash: Buffer;
  appId: string;
  now: Date;
  roots: readonly X509Certificate[];
}

function decodeMap(bytes: Buffer): Map<string | number | bigint, CborValue> | null {
  try {
    const value = decodeCbor(bytes);
    return isCborMap(value) ? value : null;
  } catch {
    return null;
  }
}

/** The steps in the file comment, in order; the first that fails is the answer. */
export function verifyAttestation(input: AttestationInput): AttestationResult {
  const fail = (why: AttestationFailure): AttestationResult => ({ ok: false, why });

  // 1. the shape
  const top = decodeMap(input.attestation);
  if (!top || top.get("fmt") !== APP_ATTEST_FMT) return fail("format");
  const stmt = top.get("attStmt");
  const authBytes = cborBytes(top, "authData");
  if (!stmt || !isCborMap(stmt) || !authBytes) return fail("format");
  const x5c = stmt.get("x5c");
  if (!Array.isArray(x5c) || x5c.length < 2 || !x5c.every((c) => Buffer.isBuffer(c))) return fail("format");
  const receipt = cborBytes(stmt, "receipt");
  const auth = parseAuthData(authBytes);
  if (!auth?.attested) return fail("format");
  let certs: X509Certificate[];
  try {
    certs = (x5c as Buffer[]).map((der) => new X509Certificate(der));
  } catch {
    return fail("format");
  }

  // 2. the chain
  const leaf = chainLeaf(certs, input.roots, input.now);
  if (!leaf) return fail("chain");

  // 3. the nonce
  const nonce = sha256(authBytes, input.clientDataHash);
  let inCert: Buffer | null = null;
  try {
    const ext = certificateExtension(leaf.raw, NONCE_OID);
    inCert = ext ? singleOctetString(ext) : null;
  } catch {
    inCert = null;
  }
  if (!inCert || !same(inCert, nonce)) return fail("nonce");

  // 4. the key id is the hash of the certificate's key
  const point = uncompressedPoint(leaf.publicKey);
  if (!point || !same(sha256(point), input.keyId)) return fail("key_id");

  // 5. our app
  if (!same(auth.rpIdHash, sha256(Buffer.from(input.appId, "utf8")))) return fail("rp_id");

  // 6. a new key
  if (auth.signCount !== 0) return fail("counter");

  // 7. the environment
  const environment: AttestEnvironment | null = same(auth.attested.aaguid, AAGUID_DEVELOPMENT) ? "development" : same(auth.attested.aaguid, AAGUID_PRODUCTION) ? "production" : null;
  if (!environment) return fail("aaguid");

  // 8. the credential is the key
  if (!same(auth.attested.credentialId, input.keyId)) return fail("credential_id");

  return { ok: true, publicKeyPem: leaf.publicKey.export({ type: "spki", format: "pem" }).toString(), environment, receipt };
}

// ------------------------------------------------------------------ assertion

export type AssertionFailure = "format" | "rp_id" | "signature" | "counter";

export type AssertionResult = { ok: true; signCount: number } | { ok: false; why: AssertionFailure };

export interface AssertionInput {
  /** the assertion object, decoded from base64 */
  assertion: Buffer;
  /** the request's exact body bytes (the app hashed these into clientDataHash) */
  clientData: Buffer;
  appId: string;
  /** the key's public key as stored at registration (SPKI PEM) */
  publicKeyPem: string;
  /** the key's counter as stored */
  storedSignCount: number;
}

/** The steps in the file comment, in order; the first that fails is the answer. */
export function verifyAssertion(input: AssertionInput): AssertionResult {
  const fail = (why: AssertionFailure): AssertionResult => ({ ok: false, why });

  const top = decodeMap(input.assertion);
  if (!top) return fail("format");
  const signature = cborBytes(top, "signature");
  const authBytes = cborBytes(top, "authenticatorData");
  if (!signature || !authBytes) return fail("format");
  const auth = parseAuthData(authBytes);
  if (!auth) return fail("format");

  if (!same(auth.rpIdHash, sha256(Buffer.from(input.appId, "utf8")))) return fail("rp_id");

  const nonce = sha256(authBytes, sha256(input.clientData));
  let good = false;
  try {
    good = createVerify("sha256").update(nonce).verify(input.publicKeyPem, signature);
  } catch {
    good = false;
  }
  if (!good) return fail("signature");

  if (!(auth.signCount > input.storedSignCount)) return fail("counter");
  return { ok: true, signCount: auth.signCount };
}
