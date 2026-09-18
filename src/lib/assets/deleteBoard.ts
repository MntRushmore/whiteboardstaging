/**
 * Delete a whiteboard together with its Storage objects.
 *
 * `whiteboards` -> `board_assets` cascades in the database, but Storage objects
 * have no FK, so without this step every deleted board leaves its images behind
 * until the nightly GC (scripts/gc-storage.mjs, /api/admin/gc) finds them.
 *
 * Order: read the board's registry rows (the cascade would erase them), delete
 * the row, then remove the objects in batches. Object removal is best effort: a
 * failure is reported in the result, never thrown, and the GC picks the objects
 * up later. Removing objects *after* the row means a failed row delete never
 * leaves a live board pointing at images that are gone.
 * Runs as the signed-in user: the storage "owner delete own folder" policy (first
 * path segment = auth.uid(), no board check) and the board_assets select policy
 * are what authorise it.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { BOARD_ASSETS_BUCKET, BOARD_ASSETS_TABLE } from "./boardAssetStore";

/** Storage API accepts up to ~1000 paths per remove; 100 keeps one failure small. */
export const DELETE_BATCH_SIZE = 100;

type ErrorLike = { message: string } | null;

/** The registry column this helper reads, the one it filters on, and the board key it deletes by. */
export const OBJECT_PATH_COLUMN = "object_path";
export const BOARD_ID_COLUMN = "whiteboard_id";
export const ROW_ID_COLUMN = "id";

/**
 * The slice of `SupabaseClient` this helper uses. Structural so tests pass a fake.
 *
 * Production code must go through {@link asDeleteBoardClient}: relating the real
 * `SupabaseClient<any>` to any slice that contains a `select(...).eq(...)` chain makes
 * TypeScript expand supabase-js's column-parsing generics past its instantiation limit
 * (TS2589, measured with supabase-js 2.84 - literal column names and module-scope
 * narrowing do not help). The runtime fit is covered by
 * `__tests__/deleteBoard.integration.test.ts` (RUN_DB_TESTS=1) against a real client.
 */
export interface DeleteBoardSupabase {
  storage: {
    from(bucket: string): {
      remove(paths: string[]): Promise<{ error: ErrorLike }>;
    };
  };
  from(table: string): {
    select(columns: typeof OBJECT_PATH_COLUMN): {
      eq(column: typeof BOARD_ID_COLUMN, value: string): PromiseLike<{ data: unknown; error: ErrorLike }>;
    };
    delete(): {
      eq(column: typeof ROW_ID_COLUMN, value: string): PromiseLike<{ error: ErrorLike }>;
    };
  };
}

/**
 * Accept the real supabase-js client (any `Database` generic) without the deep
 * structural check described on {@link DeleteBoardSupabase}. The only cast in this
 * module; the methods it relies on are exactly those the interface lists.
 */
export function asDeleteBoardClient(client: Pick<SupabaseClient, "from" | "storage">): DeleteBoardSupabase {
  return client as unknown as DeleteBoardSupabase;
}

export interface DeleteBoardResult {
  /** Object paths registered for the board. */
  assetsFound: number;
  /** Objects whose remove call succeeded. */
  assetsRemoved: number;
  /** Human-readable reasons for anything that failed on the asset side (the row is gone regardless). */
  assetErrors: string[];
}

export interface DeleteBoardOptions {
  bucket?: string;
  batchSize?: number;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) return String((err as { message: unknown }).message);
  return String(err);
}

/** Registered object paths for a board (empty on any error, which is reported). */
async function registeredPaths(supabase: DeleteBoardSupabase, boardId: string): Promise<{ paths: string[]; error?: string }> {
  try {
    const { data, error } = await supabase.from(BOARD_ASSETS_TABLE).select(OBJECT_PATH_COLUMN).eq(BOARD_ID_COLUMN, boardId);
    if (error) return { paths: [], error: `could not list images: ${error.message}` };
    const paths: string[] = [];
    for (const row of Array.isArray(data) ? data : []) {
      const p = row && typeof row === "object" ? (row as { object_path?: unknown }).object_path : undefined;
      if (typeof p === "string" && p.length > 0 && !paths.includes(p)) paths.push(p);
    }
    return { paths };
  } catch (err) {
    return { paths: [], error: `could not list images: ${errorMessage(err)}` };
  }
}

/**
 * Delete the row, then remove the board's Storage objects (best effort).
 * Throws only when the row delete itself fails (nothing has been removed at that
 * point); the returned `assetErrors` says whether some images could not be removed.
 */
export async function deleteBoardWithAssets(
  supabase: DeleteBoardSupabase,
  boardId: string,
  options: DeleteBoardOptions = {},
): Promise<DeleteBoardResult> {
  if (!boardId) throw new Error("deleteBoardWithAssets: boardId is required");
  const bucket = options.bucket ?? BOARD_ASSETS_BUCKET;
  const batchSize = options.batchSize ?? DELETE_BATCH_SIZE;
  const result: DeleteBoardResult = { assetsFound: 0, assetsRemoved: 0, assetErrors: [] };

  const listed = await registeredPaths(supabase, boardId);
  if (listed.error) result.assetErrors.push(listed.error);
  result.assetsFound = listed.paths.length;

  const { error } = await supabase.from("whiteboards").delete().eq(ROW_ID_COLUMN, boardId);
  if (error) throw error;

  for (let i = 0; i < listed.paths.length; i += batchSize) {
    const batch = listed.paths.slice(i, i + batchSize);
    try {
      const { error } = await supabase.storage.from(bucket).remove(batch);
      if (error) result.assetErrors.push(`could not remove ${batch.length} image(s): ${error.message}`);
      else result.assetsRemoved += batch.length;
    } catch (err) {
      result.assetErrors.push(`could not remove ${batch.length} image(s): ${errorMessage(err)}`);
    }
  }
  return result;
}
