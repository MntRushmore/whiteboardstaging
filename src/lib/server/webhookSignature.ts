/**
 * Stripe-compatible webhook signature verification using Web Crypto only (no SDK).
 *
 * Header format: `Stripe-Signature: t=<unix seconds>,v1=<hex hmac>[,v1=<hex hmac>...]`
 * Signed payload:  `${t}.${rawBody}`  with HMAC-SHA256 over the webhook secret.
 * A signature is valid when any `v1` matches and `|now - t| <= toleranceSec`.
 */

export type ParsedSignature = { t: number; v1: string[] };

const HEX_RE = /^[0-9a-f]+$/i;

/** Parse the header into `{ t, v1[] }`. Returns null when `t` or every `v1` is missing/malformed. */
export function parseStripeSignature(header: string | null | undefined): ParsedSignature | null {
  if (!header) return null;
  let t: number | null = null;
  const v1: string[] = [];
  for (const part of header.split(",")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key === "t") {
      if (!/^\d+$/.test(value)) return null;
      t = Number(value);
    } else if (key === "v1") {
      if (value.length > 0 && HEX_RE.test(value)) v1.push(value.toLowerCase());
    }
    // v0 (legacy) and unknown schemes are ignored on purpose.
  }
  if (t === null || v1.length === 0) return null;
  return { t, v1 };
}

const encoder = new TextEncoder();

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** HMAC-SHA256(secret, message) as lowercase hex. */
export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return toHex(sig);
}

/** Constant-time comparison of two equal-length ASCII strings (length mismatch is an early false). */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Build a header for `rawBody` (used by tests and local tooling to sign fixtures). */
export async function signStripePayload(rawBody: string, secret: string, t: number): Promise<string> {
  return `t=${t},v1=${await hmacSha256Hex(secret, `${t}.${rawBody}`)}`;
}

export type VerifyOptions = {
  header: string | null | undefined;
  rawBody: string;
  secret: string;
  /** Current time in unix SECONDS (defaults to now). */
  now?: number;
  /** Max |now - t| in seconds (Stripe's default is 300). */
  toleranceSec?: number;
};

/** True only when a `v1` matches HMAC-SHA256(secret, `${t}.${rawBody}`) and `t` is within tolerance. */
export async function verifyStripeSignature({ header, rawBody, secret, now, toleranceSec = 300 }: VerifyOptions): Promise<boolean> {
  if (!secret) return false;
  const parsed = parseStripeSignature(header);
  if (!parsed) return false;
  const nowSec = now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - parsed.t) > toleranceSec) return false;
  const expected = await hmacSha256Hex(secret, `${parsed.t}.${rawBody}`);
  let ok = false;
  for (const candidate of parsed.v1) {
    // Evaluate every candidate so the loop's timing does not reveal which one matched.
    if (timingSafeEqualHex(candidate, expected)) ok = true;
  }
  return ok;
}
