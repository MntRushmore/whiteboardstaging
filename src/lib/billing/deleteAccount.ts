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
 */

export const BOARD_ASSETS_BUCKET = "board-assets";

/** Storage API limit per remove() call is generous; stay well under it. */
export const REMOVE_BATCH_SIZE = 100;

type QueryResult<T> = PromiseLike<{ data: T | null; error: { message: string } | null }>;

/** The slice of a Supabase client this module uses (lets tests pass a fake). */
export type DeleteAccountClient = {
  from: (table: "board_assets") => {
    select: (columns: "object_path") => QueryResult<Array<{ object_path: string | null }>>;
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

/**
 * Remove own Storage objects (best effort), delete the account via the RPC, then
 * forget the session locally (no network — the user no longer exists).
 * Throws the RPC error so the caller can show it; on that path the session is kept
 * so the user can retry. Asset problems come back in `assets`.
 */
export async function deleteOwnAccount(
  client: DeleteAccountClient,
  options: { storage?: KeyValueStorage | null } = {},
): Promise<{ assets: RemoveAssetsResult; clearedKeys: string[] }> {
  const assets = await removeOwnBoardAssets(client);
  const { error } = await client.rpc("delete_own_account");
  if (error) throw error;
  const clearedKeys = await clearLocalSession(client, options.storage === undefined ? defaultStorage() : options.storage);
  return { assets, clearedKeys };
}
