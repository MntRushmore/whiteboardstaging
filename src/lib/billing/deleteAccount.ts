/**
 * Account deletion, client side.
 *
 * `delete_own_account()` (SECURITY DEFINER) deletes the auth.users row and the
 * database cascades take every table row with it — but NOT the files in Storage:
 * storage-api forbids direct deletes from `storage.objects` because a deleted row
 * would leave the bytes behind. The `board-assets` bucket is public, so a deleted
 * user's images would stay reachable by URL. The client therefore removes its own
 * objects through the Storage API (the "owner delete own folder" policy allows it)
 * BEFORE calling the RPC, while the `board_assets` registry still exists.
 *
 * Removal is best effort: a Storage failure is reported to the caller but must not
 * block deletion (the runbook's GC query catches leftovers).
 *
 * After the RPC succeeds the auth user no longer exists, so `auth.signOut()` —
 * even with `scope: 'local'` (auth-js 2.84 still POSTs /auth/v1/logout first and
 * only ignores the resulting 403 afterwards) — would make a doomed network call
 * that the browser reports as a console error. Instead the persisted session is
 * removed from storage directly (the keys auth-js itself uses) and `getSession()`
 * is called once so the client reloads the now-empty state without any request.
 *
 * Agathon Unlimited: an account whose plan would charge the card again (in its free
 * week, paid up or retrying a payment, and not set to cancel) is NOT deleted. With no
 * server key nothing here can cancel a Stripe subscription, so the grown-up cancels it
 * in the customer portal first. The plan is checked FIRST, before any image is removed
 * (a refused deletion must not have deleted anything), with a fresh read of the
 * caller's own unlimited_subscriptions rows; delete_own_account() refuses too
 * (supabase/migrations/20261003020000_unlimited.sql), as the backstop.
 *
 * Families (2026-10-09): a grown-up's kid profiles are accounts of their own, so deleting the
 * grown-up deletes the kids first: `removeFamily` (DELETE /api/family, src/lib/family/client.ts)
 * removes each kid's saved images and account on the server, right after the plan check and before
 * the RPC. Best effort, like the images: delete_own_account() deletes any kid still there in the
 * same transaction as the grown-up (supabase/migrations/20261009010000_family_plan.sql), so no kid
 * account outlives its grown-up. A kid profile cannot delete itself (the RPC refuses, hint
 * `family_kid`); their grown-up removes them from the Family page.
 */

export const BOARD_ASSETS_BUCKET = "board-assets";

/** Storage API limit per remove() call is generous; stay well under it. */
export const REMOVE_BATCH_SIZE = 100;

type QueryResult<T> = PromiseLike<{ data: T | null; error: { message: string } | null }>;

/** The slice of a Supabase client this module uses (lets tests pass a fake). */
export type DeleteAccountClient = {
  from: (table: "board_assets" | "unlimited_subscriptions") => {
    select: (columns: string) => QueryResult<Array<Record<string, unknown>>>;
  };
  storage: {
    from: (bucket: string) => {
      remove: (paths: string[]) => QueryResult<unknown>;
    };
  };
  rpc: (fn: "delete_own_account") => QueryResult<unknown>;
  auth: {
    /**
     * Drops the session locally. Called only AFTER the persisted keys are gone, so auth-js
     * finds no access token, skips the `/auth/v1/logout` round-trip (which would 403 for a
     * deleted user) and still emits `SIGNED_OUT` so `AuthProvider` stops holding the user.
     */
    signOut: (opts: { scope: "local" }) => PromiseLike<unknown>;
    /** Fallback used only if `signOut` is unavailable or throws: re-reads storage (no network). */
    getSession: () => PromiseLike<unknown>;
  };
};

/** The slice of Web Storage this module needs (lets tests pass a fake). */
export type KeyValueStorage = {
  readonly length: number;
  key: (index: number) => string | null;
  removeItem: (key: string) => void;
};

/** supabase-js persists sessions under `sb-<project-ref>-auth-token` by default. */
export const AUTH_TOKEN_KEY_PREFIX = "sb-";
export const AUTH_TOKEN_KEY_MARKER = "-auth-token";
/** auth-js writes the session itself plus these two companions next to it. */
export const SESSION_KEY_SUFFIXES = ["", "-code-verifier", "-user"] as const;

/**
 * Pick the storage keys that hold the local auth session (pure).
 *
 * With the client's `storageKey` known, only that key and its auth-js companions
 * are selected. Without it, fall back to supabase-js's default naming: every key
 * starting with `sb-` and containing `-auth-token` (which also matches the
 * companions). Order follows `keys`.
 */
export function selectAuthStorageKeys(keys: readonly string[], storageKey?: string | null): string[] {
  if (storageKey) {
    const wanted = new Set(SESSION_KEY_SUFFIXES.map((suffix) => `${storageKey}${suffix}`));
    return keys.filter((key) => wanted.has(key));
  }
  return keys.filter((key) => key.startsWith(AUTH_TOKEN_KEY_PREFIX) && key.includes(AUTH_TOKEN_KEY_MARKER));
}

/** `SupabaseClient.storageKey` is protected in the typings but present at runtime. */
export function readStorageKey(client: object): string | null {
  const value = (client as { storageKey?: unknown }).storageKey;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function listKeys(storage: KeyValueStorage): string[] {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key !== null) keys.push(key);
  }
  return keys;
}

function defaultStorage(): KeyValueStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Forget the session locally without talking to the auth server: remove the persisted keys
 * first, then ask auth-js for a local sign-out. Because the keys are already gone it finds no
 * access token, so it issues no `/auth/v1/logout` request (that 403s once the user is deleted)
 * and still notifies subscribers with `SIGNED_OUT` — which is what makes `AuthProvider` drop
 * the deleted user instead of leaving `/login` bouncing back to the dashboard. Never throws.
 * Returns the keys that were removed.
 */
export async function clearLocalSession(
  client: Pick<DeleteAccountClient, "auth">,
  storage: KeyValueStorage | null = defaultStorage(),
): Promise<string[]> {
  let cleared: string[] = [];
  if (storage) {
    try {
      cleared = selectAuthStorageKeys(listKeys(storage), readStorageKey(client));
      for (const key of cleared) storage.removeItem(key);
    } catch {
      // Storage may be blocked (private mode); the token is dead server-side regardless.
    }
  }
  try {
    await client.auth.signOut({ scope: "local" });
  } catch {
    // Older auth-js or a client without signOut: re-reading storage still settles state.
    try {
      await client.auth.getSession();
    } catch {
      // Nothing left to do: state is best-effort settled.
    }
  }
  return cleared;
}

export type RemoveAssetsResult = {
  /** Object paths the registry listed for this user. */
  found: number;
  /** Paths the Storage API accepted for removal. */
  removed: number;
  /** First failure message, when anything went wrong (registry read or a batch). */
  error: string | null;
};

/** Read the user's `board_assets.object_path` rows (RLS: own rows only) and remove them from Storage. */
export async function removeOwnBoardAssets(client: DeleteAccountClient): Promise<RemoveAssetsResult> {
  const { data, error } = await client.from("board_assets").select("object_path");
  if (error) return { found: 0, removed: 0, error: error.message };

  const paths = (data ?? []).map((row) => row.object_path).filter((p): p is string => typeof p === "string" && p.length > 0);
  if (paths.length === 0) return { found: 0, removed: 0, error: null };

  let removed = 0;
  let firstError: string | null = null;
  for (let i = 0; i < paths.length; i += REMOVE_BATCH_SIZE) {
    const batch = paths.slice(i, i + REMOVE_BATCH_SIZE);
    const { error: removeError } = await client.storage.from(BOARD_ASSETS_BUCKET).remove(batch);
    if (removeError) {
      firstError ??= removeError.message;
      continue;
    }
    removed += batch.length;
  }
  return { found: paths.length, removed, error: firstError };
}

/** The hint delete_own_account() raises with while a plan would charge again. */
export const PLAN_STILL_ACTIVE_HINT = "unlimited_active";

/** Deletion refused: the Agathon Unlimited plan must be cancelled in the customer portal first. */
export class PlanStillActiveError extends Error {
  readonly code = PLAN_STILL_ACTIVE_HINT;
  constructor() {
    super("Cancel Agathon Unlimited before deleting your account, so you're not charged again.");
    this.name = "PlanStillActiveError";
  }
}

/** Stripe statuses in which a subscription charges again unless it is set to cancel. */
const CHARGING = new Set(["trialing", "active", "past_due", "unpaid"]);

/**
 * True when one of these unlimited_subscriptions rows would charge again: the rule of
 * delete_own_account() in SQL (and of mustCancelBeforeDeleting for the hook's state).
 */
export function planBlocksDeletion(rows: ReadonlyArray<Record<string, unknown>> | null | undefined): boolean {
  return (rows ?? []).some((r) => CHARGING.has(String(r.status)) && r.cancel_at_period_end !== true && (r.cancel_at === null || r.cancel_at === undefined));
}

/** True for a PlanStillActiveError or the database's own refusal (PostgREST passes the hint through). */
export function isPlanStillActiveError(error: unknown): boolean {
  if (error instanceof PlanStillActiveError) return true;
  return !!error && typeof error === "object" && (error as { hint?: unknown }).hint === PLAN_STILL_ACTIVE_HINT;
}

/** A database without the plan's table (the Unlimited migration not applied): nothing to cancel. */
const MISSING_TABLE_RE = /could not find the table|relation .* does not exist/i;

/**
 * Throws PlanStillActiveError while the caller's plan would charge again. Reads the caller's own
 * rows (RLS) fresh, not a cached summary: the plan may have changed in another tab. A read that
 * fails for any other reason throws too: deletion never goes ahead unchecked.
 */
export async function assertNoChargingPlan(client: DeleteAccountClient): Promise<void> {
  const { data, error } = await client.from("unlimited_subscriptions").select("status,cancel_at_period_end,cancel_at");
  if (error) {
    if (MISSING_TABLE_RE.test(error.message)) return;
    throw error;
  }
  if (planBlocksDeletion(data)) throw new PlanStillActiveError();
}

/** What happened to the grown-up's kid profiles (`removeFamily`), when there was a family step. */
export type RemoveFamilyResult = { removed: number; error: string | null };

/**
 * Check the plan (nothing is touched while it would charge again), delete the kid profiles
 * (`removeFamily`, best effort), remove own Storage objects (best effort), delete the account via
 * the RPC, then forget the session locally (no network — the user no longer exists).
 * Throws PlanStillActiveError, or the RPC error, so the caller can show it; on that
 * path the session is kept so the user can retry. Asset problems come back in `assets`, the
 * family step's in `family` (absent without one).
 */
export async function deleteOwnAccount(
  client: DeleteAccountClient,
  options: { storage?: KeyValueStorage | null; removeFamily?: () => PromiseLike<{ removed: number }> } = {},
): Promise<{ assets: RemoveAssetsResult; family?: RemoveFamilyResult; clearedKeys: string[] }> {
  await assertNoChargingPlan(client);
  let family: RemoveFamilyResult | null = null;
  if (options.removeFamily) {
    try {
      family = { removed: (await options.removeFamily()).removed, error: null };
    } catch (err) {
      family = { removed: 0, error: err instanceof Error ? err.message : String(err) };
    }
  }
  const assets = await removeOwnBoardAssets(client);
  const { error } = await client.rpc("delete_own_account");
  if (error) throw isPlanStillActiveError(error) ? new PlanStillActiveError() : error;
  const clearedKeys = await clearLocalSession(client, options.storage === undefined ? defaultStorage() : options.storage);
  return { assets, clearedKeys, ...(family ? { family } : {}) };
}
