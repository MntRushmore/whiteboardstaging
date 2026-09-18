/**
 * TLAssetStore backed by the Supabase `board-assets` bucket.
 *
 * Pass the result to `<Tldraw assets={store}>` so every image tldraw ingests
 * (paste, drop, `editor.uploadAsset`) lands in Storage and the snapshot in
 * `whiteboards.data` only holds an https URL.
 *
 * Object path convention (enforced by the storage RLS policies):
 *   '<auth.uid()>/<boardId>/<assetId>.<ext>'
 */
import type { TLAsset, TLAssetId, TLAssetStore } from "tldraw";
import { assetObjectPath } from "../../../scripts/lib/snapshotAssets.mjs";

export const BOARD_ASSETS_BUCKET = "board-assets";
export const BOARD_ASSETS_TABLE = "board_assets";
export const BOARD_ASSET_SOURCES = ["user", "ai", "sticker", "pdf", "worksheet"] as const;
export type BoardAssetSource = (typeof BOARD_ASSET_SOURCES)[number];

/** One year: objects are content-addressed by asset id and never rewritten. */
const CACHE_CONTROL_SECONDS = "31536000";

interface StorageError {
  message: string;
  statusCode?: string | number;
  error?: string;
}

interface StorageResult {
  error: StorageError | null;
}

interface StorageUploadOptions {
  contentType?: string;
  upsert?: boolean;
  cacheControl?: string;
}

/**
 * The slice of `SupabaseClient` this store uses. Structural so tests can pass a
 * fake and so the real client (any `Database` generic) is assignable.
 */
export interface BoardAssetSupabase {
  storage: {
    from(bucket: string): {
      upload(path: string, file: File | Blob, options?: StorageUploadOptions): Promise<StorageResult>;
      getPublicUrl(path: string): { data: { publicUrl: string } };
      remove(paths: string[]): Promise<StorageResult>;
    };
  };
  from(table: string): {
    insert(values: Record<string, unknown>): PromiseLike<{ error: { message: string } | null }>;
    delete(): {
      in(column: string, values: string[]): PromiseLike<{ error: { message: string } | null }>;
    };
  };
}

export type BoardAssetStoreEventName =
  | "uploaded"
  | "upload-exists"
  | "upload-failed"
  | "registry-failed"
  | "remove-failed";

export interface BoardAssetStoreOptions {
  supabase: BoardAssetSupabase;
  /** `auth.uid()` of the signed-in owner; first path segment. */
  userId: string;
  /** `whiteboards.id`; second path segment and `board_assets.whiteboard_id`. */
  boardId: string;
  bucket?: string;
  /** Diagnostics hook. Never awaited; exceptions inside it are swallowed. */
  onEvent?: (name: BoardAssetStoreEventName, detail: Record<string, unknown>) => void;
  /**
   * Optional lookup used by `remove()` to derive object paths for assets that
   * were not uploaded in this session (e.g. `(id) => editor.getAsset(id)`).
   * tldraw calls `remove()` before the records leave the store.
   */
  getAsset?: (id: TLAssetId) => TLAsset | undefined;
}

export interface BoardAssetStore extends TLAssetStore {
  upload(asset: TLAsset, file: File, abortSignal?: AbortSignal): Promise<{ src: string; meta: { path: string } }>;
  resolve(asset: TLAsset): string | null;
  remove(assetIds: TLAssetId[]): Promise<void>;
  /** Object path for an asset id if this store uploaded it (or was told about it). */
  pathFor(assetId: TLAssetId): string | undefined;
}

export function createAbortError(message = "Upload aborted"): Error {
  const err = new Error(message);
  err.name = "AbortError";
  return err;
}

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) return String((err as { message: unknown }).message);
  return String(err);
}

/** Supabase Storage answers an `upsert: false` collision with 409 "The resource already exists". */
export function isAlreadyExistsError(error: StorageError | null | undefined): boolean {
  if (!error) return false;
  if (String(error.statusCode ?? "") === "409") return true;
  if (/duplicate/i.test(error.error ?? "")) return true;
  return /already exists/i.test(error.message ?? "");
}

/** Best-effort dimensions from image/video asset props (integers for the DB columns). */
function dimensionsOf(asset: TLAsset): { width: number | null; height: number | null } {
  if (asset.type !== "image" && asset.type !== "video") return { width: null, height: null };
  const { w, h } = asset.props;
  const toInt = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.round(n) : null);
  return { width: toInt(w), height: toInt(h) };
}

export function sourceOf(asset: TLAsset): BoardAssetSource {
  const candidate = asset.meta?.source;
  return typeof candidate === "string" && (BOARD_ASSET_SOURCES as readonly string[]).includes(candidate)
    ? (candidate as BoardAssetSource)
    : "user";
}

/**
 * Extract '<uid>/<board>/<asset>.<ext>' from a public URL of the form
 * '<supabase>/storage/v1/object/public/<bucket>/<path>'. Returns null for any
 * other host/bucket so we never delete outside our own bucket.
 */
export function objectPathFromPublicUrl(src: string | null | undefined, bucket: string): string | null {
  if (!src || typeof src !== "string" || src.startsWith("data:")) return null;
  const m = /\/object\/public\/([^/?#]+)\/([^?#]+)/.exec(src);
  if (!m || m[1] !== bucket) return null;
  try {
    return decodeURIComponent(m[2]);
  } catch {
    return null;
  }
}

/** Run a promise but reject with AbortError as soon as the signal fires. */
function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(createAbortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(createAbortError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

export function createBoardAssetStore(options: BoardAssetStoreOptions): BoardAssetStore {
  const { supabase, userId, boardId, getAsset } = options;
  const bucket = options.bucket ?? BOARD_ASSETS_BUCKET;
  if (!userId) throw new Error("createBoardAssetStore: userId is required");
  if (!boardId) throw new Error("createBoardAssetStore: boardId is required");

  const pathById = new Map<string, string>();

  const emit = (name: BoardAssetStoreEventName, detail: Record<string, unknown>) => {
    try {
      options.onEvent?.(name, detail);
    } catch {
      /* diagnostics must never break uploads */
    }
  };

  const ownsPath = (path: string) => path.startsWith(`${userId}/`);

  async function registerAsset(asset: TLAsset, path: string, mimeType: string, bytes: number): Promise<void> {
    const { width, height } = dimensionsOf(asset);
    try {
      const { error } = await supabase.from(BOARD_ASSETS_TABLE).insert({
        whiteboard_id: boardId,
        user_id: userId,
        object_path: path,
        mime_type: mimeType,
        bytes,
        width,
        height,
        source: sourceOf(asset),
      });
      if (error) emit("registry-failed", { path, error: error.message });
    } catch (err) {
      emit("registry-failed", { path, error: errorMessage(err) });
    }
  }

  async function upload(asset: TLAsset, file: File, abortSignal?: AbortSignal) {
    if (abortSignal?.aborted) throw createAbortError();

    const propsMime = asset.type === "image" || asset.type === "video" ? asset.props.mimeType : null;
    const contentType = file.type || propsMime || "application/octet-stream";
    const path = assetObjectPath(userId, boardId, asset.id, contentType);
    const storage = supabase.storage.from(bucket);

    const { error } = await raceAbort(
      storage.upload(path, file, { contentType, upsert: false, cacheControl: CACHE_CONTROL_SECONDS }),
      abortSignal,
    );

    if (error && !isAlreadyExistsError(error)) {
      emit("upload-failed", { path, error: error.message });
      throw new Error(`Asset upload failed: ${error.message}`);
    }
    const src = storage.getPublicUrl(path).data.publicUrl;
    pathById.set(asset.id, path);

    if (error) {
      // Same asset id => same bytes; the first upload already registered it.
      emit("upload-exists", { path });
      return { src, meta: { path } };
    }
    emit("uploaded", { path, bytes: file.size, contentType });

    // Registry is an optimisation for garbage collection; the object is already
    // durable, so a failure here must never fail the upload.
    await registerAsset(asset, path, contentType, file.size);

    return { src, meta: { path } };
  }

  function resolve(asset: TLAsset): string | null {
    const src = asset.props.src;
    return typeof src === "string" && src.length > 0 ? src : null;
  }

  function derivePath(id: TLAssetId): string | null {
    const known = pathById.get(id);
    if (known) return known;
    const asset = getAsset?.(id);
    if (!asset) return null;
    const metaPath = asset.meta?.path;
    if (typeof metaPath === "string" && metaPath.length > 0) return metaPath;
    return objectPathFromPublicUrl(asset.props.src, bucket);
  }

  async function remove(assetIds: TLAssetId[]): Promise<void> {
    const paths: string[] = [];
    for (const id of assetIds) {
      const path = derivePath(id);
      if (path && ownsPath(path) && !paths.includes(path)) paths.push(path);
    }
    for (const id of assetIds) pathById.delete(id);
    if (paths.length === 0) return;

    try {
      const { error } = await supabase.storage.from(bucket).remove(paths);
      if (error) emit("remove-failed", { paths, stage: "storage", error: error.message });
    } catch (err) {
      emit("remove-failed", { paths, stage: "storage", error: errorMessage(err) });
    }
    try {
      const { error } = await supabase.from(BOARD_ASSETS_TABLE).delete().in("object_path", paths);
      if (error) emit("remove-failed", { paths, stage: "registry", error: error.message });
    } catch (err) {
      emit("remove-failed", { paths, stage: "registry", error: errorMessage(err) });
    }
  }

  return {
    upload,
    resolve,
    remove,
    pathFor: (assetId) => pathById.get(assetId),
  };
}
