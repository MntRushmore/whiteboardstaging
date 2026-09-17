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
};

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
 * Remove own Storage objects (best effort), then delete the account via the RPC.
 * Throws the RPC error so the caller can show it; asset problems come back in `assets`.
 */
export async function deleteOwnAccount(client: DeleteAccountClient): Promise<{ assets: RemoveAssetsResult }> {
  const assets = await removeOwnBoardAssets(client);
  const { error } = await client.rpc("delete_own_account");
  if (error) throw error;
  return { assets };
}
