/**
 * Migrate a live board's inline (data: URL) assets into Storage.
 *
 * Used when an existing snapshot loaded with base64 images (boards saved before
 * the asset store shipped) or when a fallback inline asset was created because
 * an upload failed earlier. Uploads go through `editor.uploadAsset`, so the
 * configured TLAssetStore decides where bytes land; the src rewrite is applied
 * inside `store.mergeRemoteChanges` so it is neither an undo step nor "user
 * activity" for the AI debounce.
 */
import type { TLAsset, TLAssetId, TLAssetPartial } from "tldraw";
import { extForMime, snapshotJsonBytes } from "../../../scripts/lib/snapshotAssets.mjs";
import { createAbortError, isAbortError } from "./boardAssetStore";
import { dataUrlToFile } from "./uploadDataUrl";

/** The slice of `Editor` this helper needs; the real editor is assignable. */
export interface OffloadEditor {
  store: {
    allRecords(): unknown[];
    getStoreSnapshot(scope?: "document" | "session" | "presence" | "all"): unknown;
    mergeRemoteChanges(fn: () => void): void;
  };
  uploadAsset(asset: TLAsset, file: File, abortSignal?: AbortSignal): Promise<{ src: string; meta?: object }>;
  updateAssets(assets: TLAssetPartial[]): unknown;
}

export interface OffloadOptions {
  /** Parallel uploads (default 2: image uploads are large and the browser caps connections). */
  concurrency?: number;
  signal?: AbortSignal;
}

export interface OffloadFailure {
  id: TLAssetId;
  name: string;
  error: string;
}

export interface OffloadResult {
  /** Assets whose src now points at Storage. */
  migrated: number;
  /** Assets left inline, with the reason. Empty on full success. */
  failed: OffloadFailure[];
  /** Serialized document size before/after (UTF-8 bytes of JSON.stringify). */
  bytesBefore: number;
  bytesAfter: number;
  /** True when the signal fired before every asset was attempted. */
  aborted: boolean;
}

type InlineImageAsset = Extract<TLAsset, { type: "image" | "video" }>;

function isInlineAsset(record: unknown): record is InlineImageAsset {
  if (!record || typeof record !== "object") return false;
  const r = record as { typeName?: unknown; type?: unknown; props?: { src?: unknown } };
  if (r.typeName !== "asset") return false;
  if (r.type !== "image" && r.type !== "video") return false;
  return typeof r.props?.src === "string" && r.props.src.startsWith("data:");
}

/** Asset records in the store whose src is still an inline data URL. */
export function findInlineEditorAssets(editor: Pick<OffloadEditor, "store">): InlineImageAsset[] {
  return editor.store.allRecords().filter(isInlineAsset);
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface Migrated {
  asset: InlineImageAsset;
  src: string;
  meta: Record<string, unknown>;
}

export async function offloadEditorAssets(editor: OffloadEditor, options: OffloadOptions = {}): Promise<OffloadResult> {
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? 2));
  const { signal } = options;

  const inline = findInlineEditorAssets(editor);
  if (inline.length === 0) {
    const bytes = snapshotJsonBytes(editor.store.getStoreSnapshot("document"));
    return { migrated: 0, failed: [], bytesBefore: bytes, bytesAfter: bytes, aborted: false };
  }

  const bytesBefore = snapshotJsonBytes(editor.store.getStoreSnapshot("document"));
  const migrated: Migrated[] = [];
  const failed: OffloadFailure[] = [];
  let aborted = false;

  const queue = inline.slice();
  const worker = async () => {
    for (;;) {
      const asset = queue.shift();
      if (!asset) return;
      if (signal?.aborted) {
        aborted = true;
        failed.push({ id: asset.id, name: asset.props.name, error: "aborted" });
        continue;
      }
      try {
        const mime = asset.props.mimeType || "";
        const fileName = asset.props.name || `${asset.id.replace(/^asset:/, "")}.${extForMime(mime)}`;
        const file = dataUrlToFile(asset.props.src as string, fileName);
        const uploaded = await editor.uploadAsset(asset, file, signal);
        if (!uploaded || typeof uploaded.src !== "string" || !uploaded.src) {
          throw new Error("asset store returned no src");
        }
        migrated.push({ asset, src: uploaded.src, meta: (uploaded.meta ?? {}) as Record<string, unknown> });
      } catch (err) {
        if (isAbortError(err) || signal?.aborted) aborted = true;
        failed.push({ id: asset.id, name: asset.props.name, error: describe(err) });
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, inline.length) }, worker));

  if (migrated.length > 0) {
    const partials: TLAssetPartial[] = migrated.map(({ asset, src, meta }) => ({
      id: asset.id,
      type: asset.type,
      // Editor.updateAssets merges shallowly (no props merge): send the FULL props or the record loses w/h/mimeType and fails validation.
      props: { ...asset.props, src },
      meta: { ...asset.meta, ...meta } as TLAsset["meta"],
    })) as TLAssetPartial[];
    editor.store.mergeRemoteChanges(() => {
      editor.updateAssets(partials);
    });
  }

  const bytesAfter = snapshotJsonBytes(editor.store.getStoreSnapshot("document"));
  return { migrated: migrated.length, failed, bytesBefore, bytesAfter, aborted };
}

/** Convenience for callers that want abort to surface as a rejection instead of a result flag. */
export async function offloadEditorAssetsOrThrow(editor: OffloadEditor, options: OffloadOptions = {}): Promise<OffloadResult> {
  const result = await offloadEditorAssets(editor, options);
  if (result.aborted) throw createAbortError("Asset offload aborted");
  return result;
}
