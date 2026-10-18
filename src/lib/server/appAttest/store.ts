/**
 * Where App Attest keeps its state, behind a small seam (`AttestStore`) so the tests drive the
 * routes with a fake: the one-time challenges and the attested keys
 * (supabase/migrations/20261017210000_ipad_onboarding.sql: `app_attest_challenges`,
 * `app_attest_keys`; RLS on, no policies, the service role only).
 *
 * Every write that must be exactly-once is one statement:
 *  - a challenge is consumed by `delete … where challenge = $1 and expires_at > now returning`, so
 *    two registrations racing on one challenge cannot both have it;
 *  - a key's counter moves by `update … set sign_count = $n where key_id = $k and sign_count < $n
 *    returning`, so a replayed (or raced) assertion with a counter already used changes nothing
 *    and is refused.
 *
 * The Supabase store throws on a database error; the callers answer 503 `unavailable` (fail closed:
 * no key that cannot be read is trusted).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "@/lib/server/billing";
import { appAttestAppId, debugBypassAllowed, pinnedRoots } from "./config";
import type { AttestEnvironment } from "./verify";

export interface StoredKey {
  /** standard base64 of the 32-byte key id, padded */
  keyId: string;
  /** SPKI PEM */
  publicKeyPem: string;
  signCount: number;
  environment: AttestEnvironment;
}

export interface NewKey {
  keyId: string;
  publicKeyPem: string;
  environment: AttestEnvironment;
  /** the attestation's receipt, standard base64; null when it had none */
  receipt: string | null;
}

export interface AttestStore {
  /** Keeps a new challenge until `expiresAt` (and clears the ones already expired at `now`). */
  saveChallenge(challenge: string, expiresAt: Date, now: Date): Promise<void>;
  /** Uses up the challenge if it exists and is unexpired at `now`: true exactly once. */
  consumeChallenge(challenge: string, now: Date): Promise<boolean>;
  /** Stores a newly attested key with counter 0; "exists" (and nothing changes) when it is stored already. */
  saveKey(key: NewKey, now: Date): Promise<"created" | "exists">;
  getKey(keyId: string): Promise<StoredKey | null>;
  /** Moves the key's counter to `signCount` only if it is below it: true when it moved. */
  advanceCounter(keyId: string, signCount: number, now: Date): Promise<boolean>;
}

export const CHALLENGES_TABLE = "app_attest_challenges";
export const KEYS_TABLE = "app_attest_keys";

function fail(what: string, error: { message?: string; code?: string } | null): never {
  throw new Error(`app attest: ${what}: ${error?.code ? `${error.code} ` : ""}${error?.message ?? "no answer"}`);
}

/** The store over a service-role client. */
export function supabaseAttestStore(svc: SupabaseClient): AttestStore {
  return {
    async saveChallenge(challenge, expiresAt, now) {
      // Expired challenges go first (cheap: indexed, and the per-IP limit bounds how many exist).
      const cleared = await svc.from(CHALLENGES_TABLE).delete().lt("expires_at", now.toISOString());
      if (cleared.error) fail("expired challenges not cleared", cleared.error);
      const { error } = await svc.from(CHALLENGES_TABLE).insert({ challenge, expires_at: expiresAt.toISOString() });
      if (error) fail("challenge not saved", error);
    },

    async consumeChallenge(challenge, now) {
      const { data, error } = await svc.from(CHALLENGES_TABLE).delete().eq("challenge", challenge).gt("expires_at", now.toISOString()).select("challenge");
      if (error) fail("challenge not read", error);
      return Array.isArray(data) && data.length === 1;
    },

    async saveKey(key, now) {
      const row = {
        key_id: key.keyId,
        public_key: key.publicKeyPem,
        sign_count: 0,
        environment: key.environment,
        receipt: key.receipt,
        created_at: now.toISOString(),
      };
      const { data, error } = await svc.from(KEYS_TABLE).upsert(row, { onConflict: "key_id", ignoreDuplicates: true }).select("key_id");
      if (error) fail("key not saved", error);
      return Array.isArray(data) && data.length === 1 ? "created" : "exists";
    },

    async getKey(keyId) {
      const { data, error } = await svc.from(KEYS_TABLE).select("key_id, public_key, sign_count, environment").eq("key_id", keyId).maybeSingle();
      if (error) fail("key not read", error);
      if (!data) return null;
      const row = data as { key_id: string; public_key: string; sign_count: number | string; environment: AttestEnvironment };
      const signCount = Number(row.sign_count);
      if (!Number.isSafeInteger(signCount)) fail("key's counter unreadable", null);
      return { keyId: row.key_id, publicKeyPem: row.public_key, signCount, environment: row.environment };
    },

    async advanceCounter(keyId, signCount, now) {
      const { data, error } = await svc
        .from(KEYS_TABLE)
        .update({ sign_count: signCount, last_used_at: now.toISOString() })
        .eq("key_id", keyId)
        .lt("sign_count", signCount)
        .select("key_id");
      if (error) fail("counter not moved", error);
      return Array.isArray(data) && data.length === 1;
    },
  };
}

/** The seam the routes use and the tests replace. */
export const appAttestDeps = {
  /** null without SUPABASE_SERVICE_ROLE_KEY (the routes answer 503) */
  store: (): AttestStore | null => {
    const svc = serviceClient();
    return svc ? supabaseAttestStore(svc) : null;
  },
  now: (): Date => new Date(),
  appId: (): string => appAttestAppId(),
  roots: pinnedRoots,
  debugAllowed: (): boolean => debugBypassAllowed(),
};
export type AppAttestDeps = typeof appAttestDeps;
