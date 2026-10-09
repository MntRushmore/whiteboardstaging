/**
 * Everything the /api/family routes read and write, with the service role. `families` has no client
 * access at all and a kid's profile is not readable by their grown-up through RLS, so these are
 * server-only; every function takes ids the route has already checked (`decideSwitch`, `ownsKid`),
 * never anything from a request body unverified.
 *
 * Kid accounts are real Supabase auth users (src/lib/family/contracts.ts): made with
 * auth.admin.createUser on a `kid-<uuid>@kids.agathon.app` address that has no mailbox, a random
 * password nobody stores or sees, and `user_metadata.terms_version` (sign-up requires it,
 * 20261003010000_signup_consent.sql). Nothing here calls email code: no welcome, no confirmation.
 *
 * Switching mints a session without any password or email: auth.admin.generateLink({type:
 * 'magiclink'}) gives the link's hashed token (GoTrue sends nothing for an admin-generated link), and
 * verifyOtp({type: 'magiclink', token_hash}) on a fresh anon client turns it into the member's
 * session, exactly as following the link would. The token is single use.
 *
 * The family's counters live in the database (supabase/migrations/20261009040000_family_hardening.sql):
 * the PIN's budgets and lock (`family_pin_attempt`), which fail CLOSED when the database cannot be
 * asked (no per-instance fallback: every instance would be a fresh budget), and the budget for adding
 * kids (`family_kid_add_attempt`, KID_ADDS).
 *
 * `familyDeps` is the seam the route tests replace (like emailDeps in src/lib/email/server.ts).
 */
import { randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getServerEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { TERMS_VERSION } from "@/lib/legal";
import { LEARNING_LIMITS } from "@/lib/learning/contracts";
import { BOARD_ASSETS_BUCKET, REMOVE_BATCH_SIZE } from "@/lib/billing/deleteAccount";
import { serviceClient } from "@/lib/server/billing";
import { KID_EMAIL_DOMAIN, type AddKidInput, type SwitchResult } from "@/lib/family/contracts";
import type { FamilyLinks, KidStats, MemberProfile } from "@/lib/family/members";
import type { EditKidInput } from "@/lib/family/schemas";
import { kidStats, type AttemptStatRow, type DailyStatRow } from "@/lib/family/stats";
import { PIN_ATTEMPTS, PIN_DAILY_LIMIT } from "./pin";

const log = logger.child({ module: "family" });

/** A profile row with what adding a kid copies from their grown-up. */
export interface ProfileRow extends MemberProfile {
  termsVersion: string | null;
}

/** Kids a family may add per day (removing one gives nothing back), so accounts cannot be churned. */
export const KID_ADDS = { limit: 6, windowMs: 24 * 60 * 60_000 } as const;

/** One PIN try counted against the family (`family_pin_attempt`), before the PIN is checked. */
export type PinAttempt =
  | {
      ok: true;
      /** tries left after this one: the smaller of the 15-minute budget and the day's */
      remaining: number;
      /** the 15-minute window the try was counted in (family_pin_forgive takes it back) */
      windowStart: string;
      /** this try spent the day's last one: if the PIN is wrong, switching to the grown-up is now locked */
      last: boolean;
    }
  /** `too_many`: the 15-minute budget; `locked`: the day's, until the grown-up signs in or 24 hours pass */
  | { ok: false; reason: "too_many" | "locked"; retryAfterMs: number }
  /** the counter could not be asked: the try is refused (fail closed), never let through uncounted */
  | { ok: false; reason: "unavailable" };

export interface FamilyStore {
  /** The family `userId` is in (as grown-up or kid), or null for a solo account. */
  links(userId: string): Promise<FamilyLinks | null>;
  /** The family's row: whether a PIN is set and its hash. Null when the grown-up has none yet. */
  family(parentId: string): Promise<{ pinHash: string | null } | null>;
  profiles(ids: readonly string[]): Promise<Map<string, ProfileRow>>;
  /** Creates the family's row on the first PIN. */
  setPin(parentId: string, pinHash: string): Promise<void>;
  /** A new kid account under `parentId`; its user id. Undone (the account deleted) if any step fails. */
  createKid(parentId: string, input: AddKidInput, termsVersion: string | null): Promise<string>;
  editKid(kidId: string, patch: EditKidInput): Promise<void>;
  /** The kid's saved images, then their account (everything else cascades). */
  deleteKid(kidId: string): Promise<{ assetsRemoved: number; assetsError: string | null }>;
  /** Only the kid's saved images (the account stays): before the grown-up's account is deleted. */
  removeKidAssets(kidId: string): Promise<{ assetsRemoved: number; assetsError: string | null }>;
  /** Whether `parentId`'s plan gives Unlimited now (`has_unlimited`): kids are added only then. Throws when unread. */
  hasPlan(parentId: string): Promise<boolean>;
  /** One kid added, counted against the family's KID_ADDS. Throws when the counter cannot be asked. */
  kidAddAttempt(parentId: string): Promise<{ ok: boolean; retryAfterMs: number }>;
  stats(kidIds: readonly string[], now: number, tzOffsetMinutes: number): Promise<Map<string, KidStats>>;
  /** One PIN try counted against the family. Never throws: a counter it cannot ask is `unavailable`. */
  pinAttempt(parentId: string): Promise<PinAttempt>;
  /** The PIN was right: give that try back (and lift the lock it may have set). Never throws. */
  pinForgive(parentId: string, windowStart: string): Promise<void>;
  emailOf(userId: string): Promise<string | null>;
  mintSession(email: string): Promise<SwitchResult>;
  /** Ends the session `accessToken` belongs to (its refresh token stops working). Never throws. */
  revokeSession(accessToken: string): Promise<void>;
}

function fail(what: string, error: { message?: string } | null | undefined): never {
  throw new Error(`${what}: ${error?.message ?? "no answer"}`);
}

/**
 * family_pin_attempt's answer as a PinAttempt, or null for anything unexpected (the caller then
 * refuses the try: an answer it cannot read is no permission). Exported for tests.
 */
export function parsePinAttempt(data: unknown): PinAttempt | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  if (r.allowed === true) {
    if (typeof r.window_start !== "string" || !r.window_start) return null;
    const remaining = typeof r.remaining === "number" && Number.isFinite(r.remaining) ? Math.max(0, Math.floor(r.remaining)) : 0;
    return { ok: true, remaining, windowStart: r.window_start, last: r.last === true };
  }
  if (r.allowed === false) {
    const locked = r.locked === true;
    const retry = Number(r.retry_after_ms);
    const fallback = locked ? 24 * 60 * 60_000 : PIN_ATTEMPTS.windowMs;
    return { ok: false, reason: locked ? "locked" : "too_many", retryAfterMs: Number.isFinite(retry) && retry > 0 ? Math.round(retry) : fallback };
  }
  return null;
}

/** The service-role store, or null without SUPABASE_SERVICE_ROLE_KEY (the routes answer 503). */
export function createFamilyStore(): FamilyStore | null {
  const svc = serviceClient();
  if (!svc) return null;
  const env = getServerEnv();
  return storeOver(svc, () =>
    createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    }),
  );
}

/** The store over a service-role client; `anon` makes a fresh anon client per session minted. */
export function storeOver(svc: SupabaseClient, anon: () => SupabaseClient): FamilyStore {
  // A kid's saved images: the database cascade cannot remove files (src/lib/billing/deleteAccount.ts).
  async function removeKidAssets(kidId: string): Promise<{ assetsRemoved: number; assetsError: string | null }> {
    let assetsRemoved = 0;
    let assetsError: string | null = null;
    const assets = await svc.from("board_assets").select("object_path").eq("user_id", kidId);
    if (assets.error) assetsError = assets.error.message;
    const paths = ((assets.data ?? []) as Array<{ object_path: unknown }>).map((r) => r.object_path).filter((p): p is string => typeof p === "string" && p.length > 0);
    for (let i = 0; i < paths.length; i += REMOVE_BATCH_SIZE) {
      const batch = paths.slice(i, i + REMOVE_BATCH_SIZE);
      const removed = await svc.storage.from(BOARD_ASSETS_BUCKET).remove(batch);
      if (removed.error) assetsError ??= removed.error.message;
      else assetsRemoved += batch.length;
    }
    if (assetsError) log.warn({ kidId, error: assetsError }, "some of a kid's images were left for the GC");
    return { assetsRemoved, assetsError };
  }

  return {
    async links(userId) {
      const asKid = await svc.from("family_members").select("parent_id").eq("child_id", userId).maybeSingle();
      if (asKid.error) fail("family_members read failed", asKid.error);
      let parentId = (asKid.data as { parent_id?: string } | null)?.parent_id ?? null;
      if (!parentId) {
        const fam = await svc.from("families").select("parent_id").eq("parent_id", userId).maybeSingle();
        if (fam.error) fail("families read failed", fam.error);
        if (!fam.data) return null;
        parentId = userId;
      }
      const kids = await svc.from("family_members").select("child_id").eq("parent_id", parentId).order("created_at", { ascending: true }).order("child_id");
      if (kids.error) fail("family_members read failed", kids.error);
      return { parentId, kids: ((kids.data ?? []) as Array<{ child_id: string }>).map((k) => k.child_id) };
    },

    async family(parentId) {
      const { data, error } = await svc.from("families").select("pin_hash").eq("parent_id", parentId).maybeSingle();
      if (error) fail("families read failed", error);
      return data ? { pinHash: (data as { pin_hash: string | null }).pin_hash } : null;
    },

    async profiles(ids) {
      const out = new Map<string, ProfileRow>();
      if (ids.length === 0) return out;
      const { data, error } = await svc.from("profiles").select("user_id, display_name, avatar, grade, terms_version").in("user_id", [...ids]);
      if (error) fail("profiles read failed", error);
      for (const row of (data ?? []) as Array<Record<string, unknown>>) {
        out.set(String(row.user_id), {
          displayName: typeof row.display_name === "string" ? row.display_name : null,
          avatar: typeof row.avatar === "string" ? row.avatar : null,
          grade: typeof row.grade === "number" ? row.grade : null,
          termsVersion: typeof row.terms_version === "string" ? row.terms_version : null,
        });
      }
      return out;
    },

    async setPin(parentId, pinHash) {
      const { error } = await svc.from("families").upsert({ parent_id: parentId, pin_hash: pinHash, pin_set_at: new Date().toISOString() }, { onConflict: "parent_id" });
      if (error) fail("families write failed", error);
    },

    async createKid(parentId, input, termsVersion) {
      const email = `kid-${randomUUID()}@${KID_EMAIL_DOMAIN}`;
      const created = await svc.auth.admin.createUser({
        email,
        // never stored, never shown: the kid signs in only by a switch
        password: randomBytes(32).toString("base64url"),
        email_confirm: true,
        user_metadata: { terms_version: termsVersion ?? TERMS_VERSION, kid: true, display_name: input.displayName },
      });
      if (created.error || !created.data.user) fail("kid account not created", created.error);
      const kidId = created.data.user.id;
      try {
        // The sign-up trigger made the profile; the kid skips the welcome (the grown-up chose for them).
        const profile = await svc
          .from("profiles")
          .upsert({ user_id: kidId, display_name: input.displayName, avatar: input.avatar, grade: input.grade, onboarded_at: new Date().toISOString() }, { onConflict: "user_id" });
        if (profile.error) fail("kid profile not written", profile.error);
        const link = await svc.from("family_members").insert({ child_id: kidId, parent_id: parentId });
        if (link.error) fail("kid not linked", link.error);
        return kidId;
      } catch (err) {
        const undo = await svc.auth.admin.deleteUser(kidId);
        if (undo.error) log.error({ kidId, error: undo.error.message }, "a half-made kid account could not be deleted");
        throw err;
      }
    },

    async editKid(kidId, patch) {
      const row: Record<string, unknown> = {};
      if (patch.displayName !== undefined) row.display_name = patch.displayName;
      if (patch.avatar !== undefined) row.avatar = patch.avatar;
      if (patch.grade !== undefined) row.grade = patch.grade;
      const { error } = await svc.from("profiles").update(row).eq("user_id", kidId);
      if (error) fail("kid profile not updated", error);
      if (patch.displayName !== undefined) {
        // the header shows the kid's name from their session's metadata (the address is no name)
        const meta = await svc.auth.admin.getUserById(kidId);
        const current = (meta.data.user?.user_metadata ?? {}) as Record<string, unknown>;
        const upd = await svc.auth.admin.updateUserById(kidId, { user_metadata: { ...current, display_name: patch.displayName } });
        if (upd.error) log.warn({ kidId, error: upd.error.message }, "kid's name not copied to their session metadata");
      }
    },

    async deleteKid(kidId) {
      // Saved images first, while the board_assets rows that list them still exist.
      const assets = await removeKidAssets(kidId);
      const { error } = await svc.auth.admin.deleteUser(kidId);
      if (error && !/not.?found/i.test(error.message)) fail("kid account not deleted", error);
      return assets;
    },

    removeKidAssets,

    async hasPlan(parentId) {
      const { data, error } = await svc.rpc("has_unlimited", { p_uid: parentId });
      if (error) fail("plan not read", error);
      return data === true;
    },

    async kidAddAttempt(parentId) {
      const { data, error } = await svc.rpc("family_kid_add_attempt", { p_parent: parentId, p_limit: KID_ADDS.limit, p_window_ms: KID_ADDS.windowMs });
      const r = (data ?? null) as Record<string, unknown> | null;
      if (error || !r || typeof r.allowed !== "boolean") fail("kid budget not read", error ?? { message: "unexpected shape" });
      return { ok: r.allowed === true, retryAfterMs: r.allowed === true ? 0 : Math.max(1, Number(r.retry_after_ms) || KID_ADDS.windowMs) };
    },

    async stats(kidIds, now, tzOffsetMinutes) {
      const out = new Map<string, KidStats>();
      const since = new Date(now - LEARNING_LIMITS.readDays * 86_400_000).toISOString();
      await Promise.all(
        kidIds.map(async (kidId) => {
          const [daily, attempts] = await Promise.all([
            svc.from("daily_practice").select("day, completed_at").eq("user_id", kidId).order("day", { ascending: false }).limit(400),
            svc
              .from("learning_attempts")
              .select("id, skill, origin, outcome, lines_written, started_at, updated_at")
              .eq("user_id", kidId)
              .gte("started_at", since)
              .order("started_at", { ascending: false })
              .limit(LEARNING_LIMITS.readLimit),
          ]);
          // one kid's numbers failing leaves that kid without numbers, not the page without kids
          if (daily.error || attempts.error) {
            log.warn({ kidId, error: (daily.error ?? attempts.error)?.message }, "a kid's numbers could not be read");
            return;
          }
          out.set(kidId, kidStats({ daily: (daily.data ?? []) as DailyStatRow[], attempts: (attempts.data ?? []) as AttemptStatRow[], now, tzOffsetMinutes }));
        }),
      );
      return out;
    },

    async pinAttempt(parentId) {
      try {
        const { data, error } = await svc.rpc("family_pin_attempt", {
          p_parent: parentId,
          p_limit: PIN_ATTEMPTS.limit,
          p_window_ms: PIN_ATTEMPTS.windowMs,
          p_day_limit: PIN_DAILY_LIMIT,
        });
        const attempt = error ? null : parsePinAttempt(data);
        if (attempt) return attempt;
        log.warn({ error: error?.message ?? "unexpected shape" }, "family_pin_attempt unavailable; PIN tries are refused until it answers");
      } catch (err) {
        log.warn({ error: err instanceof Error ? err.message : String(err) }, "family_pin_attempt unavailable; PIN tries are refused until it answers");
      }
      // Never an open gate, and no per-instance count either (each instance would be a fresh budget).
      return { ok: false, reason: "unavailable" };
    },

    async pinForgive(parentId, windowStart) {
      try {
        const { error } = await svc.rpc("family_pin_forgive", { p_parent: parentId, p_window_start: windowStart });
        if (error) log.warn({ error: error.message }, "a right PIN's try was not given back");
      } catch (err) {
        log.warn({ error: err instanceof Error ? err.message : String(err) }, "a right PIN's try was not given back");
      }
    },

    async emailOf(userId) {
      const { data, error } = await svc.auth.admin.getUserById(userId);
      if (error) fail("account not read", error);
      return data.user?.email ?? null;
    },

    async mintSession(email) {
      const link = await svc.auth.admin.generateLink({ type: "magiclink", email });
      const hashed = link.data?.properties?.hashed_token;
      if (link.error || !hashed) fail("sign-in link not made", link.error);
      const verified = await anon().auth.verifyOtp({ type: "magiclink", token_hash: hashed });
      const session = verified.data?.session;
      if (verified.error || !session?.access_token || !session.refresh_token) fail("sign-in link not verified", verified.error);
      return { access_token: session.access_token, refresh_token: session.refresh_token };
    },

    async revokeSession(accessToken) {
      try {
        const { error } = await svc.auth.admin.signOut(accessToken, "local");
        if (error) log.warn({ error: error.message }, "the previous profile's session was not ended");
      } catch (err) {
        log.warn({ error: err instanceof Error ? err.message : String(err) }, "the previous profile's session was not ended");
      }
    },
  };
}

/** The routes' seam: tests replace `store` with a fake. */
export const familyDeps = {
  store: (): FamilyStore | null => createFamilyStore(),
  now: (): number => Date.now(),
};
