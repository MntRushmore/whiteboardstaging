/**
 * The grown-up's PIN, as the server keeps it (`families.pin_hash`). A PIN is only 4 digits, so the
 * hash is no wall against someone holding the table: what protects it is that nobody but the server
 * can read `families` (no client grant at all) and that guesses are limited per family, in the
 * database (`PIN_ATTEMPTS` and `PIN_DAILY_LIMIT`, family_pin_attempt in
 * supabase/migrations/20261009040000_family_hardening.sql). The hash still matters: the PIN is often
 * a grown-up's bank or phone PIN too, and it must never sit in the database, a log or a backup as the
 * digits themselves.
 *
 * Format: `scrypt$<salt>$<hash>`, both base64url; a random 16-byte salt per PIN, Node's scrypt with
 * N=16384, r=8, p=1 and a 32-byte key. Compared with timingSafeEqual. Server only (node:crypto).
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { PIN_PATTERN } from "@/lib/family/contracts";

const PREFIX = "scrypt";
const SALT_BYTES = 16;
const KEY_BYTES = 32;
const PARAMS: ScryptOptions = { N: 16384, r: 8, p: 1 };

/** PIN tries a family gets in 15 minutes before it waits (a right PIN is given back). */
export const PIN_ATTEMPTS = { limit: 5, windowMs: 15 * 60_000 } as const;

/**
 * Wrong PINs a family gets in 24 hours. The last one locks switching to the grown-up until they
 * sign in with their own password (or 24 hours pass), so guessing all 10,000 PINs would take years,
 * not the three weeks 5 tries per 15 minutes allowed (about 480 guesses a day).
 */
export const PIN_DAILY_LIMIT = 10;

/** True for exactly 4 digits (`PIN_PATTERN`). */
export function isPin(value: unknown): value is string {
  return typeof value === "string" && PIN_PATTERN.test(value);
}

function scrypt(pin: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(pin, salt, KEY_BYTES, PARAMS, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** The stored form of a PIN. Throws for anything but 4 digits: the routes validate first. */
export async function hashPin(pin: string): Promise<string> {
  if (!isPin(pin)) throw new Error("A PIN is exactly 4 digits.");
  const salt = randomBytes(SALT_BYTES);
  const key = await scrypt(pin, salt);
  return `${PREFIX}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

/**
 * Whether `pin` is the one `stored` was made from. False (never a throw) for a malformed PIN or a
 * stored value in any other format: a damaged row locks the grown-up's profile rather than opening it.
 */
export async function verifyPin(pin: string, stored: string | null | undefined): Promise<boolean> {
  if (!isPin(pin) || typeof stored !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== PREFIX) return false;
  const salt = Buffer.from(parts[1], "base64url");
  const expected = Buffer.from(parts[2], "base64url");
  if (salt.length !== SALT_BYTES || expected.length !== KEY_BYTES) return false;
  try {
    const key = await scrypt(pin, salt);
    return timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}
