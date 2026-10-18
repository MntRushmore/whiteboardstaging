/**
 * How the app's values arrive and how the server keys them. DCAppAttestService hands the app its
 * key id as STANDARD base64 (with padding) of 32 bytes, and the app sends the attestation and each
 * assertion as standard base64 of the CBOR object; the challenge is base64url of 32 random bytes,
 * made here.
 */
import { randomBytes } from "node:crypto";

const STANDARD = /^[A-Za-z0-9+/]+={0,2}$/;
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Standard base64 (padding optional, nothing else allowed) decoded; null when it is not that or decodes to nothing. */
export function decodeStandardBase64(text: string | null | undefined, maxChars: number): Buffer | null {
  if (typeof text !== "string") return null;
  const s = text.trim();
  if (s.length === 0 || s.length > maxChars || !STANDARD.test(s)) return null;
  const unpadded = s.replace(/=+$/, "");
  if (unpadded.length % 4 === 1) return null;
  const out = Buffer.from(s, "base64");
  return out.length > 0 ? out : null;
}

/** A key id the way the server keys it: the 32 bytes, and their padded standard base64. Null when it is not 32 bytes of standard base64. */
export function parseKeyId(text: string | null | undefined): { bytes: Buffer; id: string } | null {
  const bytes = decodeStandardBase64(text, 64);
  return bytes && bytes.length === 32 ? { bytes, id: bytes.toString("base64") } : null;
}

/** A fresh challenge: base64url of 32 random bytes (43 characters). */
export function newChallenge(): string {
  return randomBytes(32).toString("base64url");
}

/** The shape newChallenge makes (anything else was never ours). */
export function isChallenge(text: unknown): text is string {
  return typeof text === "string" && CHALLENGE.test(text);
}

/** A device's debug id: a uuid, lower case. Null for anything else. */
export function parseDeviceId(text: string | null | undefined): string | null {
  const s = text?.trim() ?? "";
  return UUID.test(s) ? s.toLowerCase() : null;
}
