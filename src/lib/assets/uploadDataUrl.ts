/**
 * Turn a data: URL (AI output, PDF page render, sticker, worksheet) into a
 * tldraw image asset whose `src` is an https URL in Storage.
 *
 * The upload goes through `editor.uploadAsset`, i.e. whatever TLAssetStore the
 * <Tldraw assets={...}> prop configured. If that fails for any reason the asset
 * is still created with the inline data URL so the user never loses the image;
 * callers surface a non-blocking warning when `inline` is true.
 */
import { AssetRecordType, type TLAssetId, type TLImageAsset } from "tldraw";
import { parseDataUrl } from "../../../scripts/lib/snapshotAssets.mjs";
import { createAbortError, type BoardAssetSource } from "./boardAssetStore";

/** The subset of `Editor` this helper needs; the real editor is assignable. */
export interface AssetUploadEditor {
  uploadAsset(asset: TLImageAsset, file: File, abortSignal?: AbortSignal): Promise<{ src: string; meta?: object }>;
  createAssets(assets: TLImageAsset[]): unknown;
}

export interface UploadDataUrlAssetOptions {
  /** Reuse a pre-generated id (e.g. when the shape was created optimistically). */
  id?: TLAssetId;
  dataUrl: string;
  name: string;
  width: number;
  height: number;
  source: BoardAssetSource;
  signal?: AbortSignal;
}

export interface UploadDataUrlAssetResult {
  assetId: TLAssetId;
  /** https URL on success, the original data URL when `inline` is true. */
  src: string;
  /** True when the upload failed and the data URL was embedded instead. */
  inline: boolean;
  /** Why the fallback was taken (undefined on success). */
  error?: string;
}

/** Decode a base64 data: URL into a File. Throws if the string is not a valid data URL. */
export function dataUrlToFile(dataUrl: string, name: string): File {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) throw new Error("dataUrlToFile: not a base64 data: URL");
  // Copy into a fresh ArrayBuffer so the Blob never aliases a pooled Buffer slice.
  const bytes = new Uint8Array(parsed.bytes.byteLength);
  bytes.set(parsed.bytes);
  return new File([bytes], name, { type: parsed.mime });
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function buildImageAsset(input: {
  id: TLAssetId;
  name: string;
  src: string;
  width: number;
  height: number;
  mimeType: string;
  fileSize?: number;
  meta?: Record<string, string | number | boolean | null>;
}): TLImageAsset {
  return AssetRecordType.create({
    id: input.id,
    type: "image",
    props: {
      name: input.name,
      src: input.src,
      w: input.width,
      h: input.height,
      mimeType: input.mimeType,
      isAnimated: false,
      ...(input.fileSize !== undefined ? { fileSize: input.fileSize } : {}),
    },
    meta: input.meta ?? {},
  }) as TLImageAsset;
}

/**
 * Upload a data URL through the editor's asset store and create the asset.
 * Never rejects on upload failure (falls back to an inline asset); it only
 * rejects when `signal` was aborted, because then no asset should be created.
 */
export async function uploadDataUrlAsset(
  editor: AssetUploadEditor,
  options: UploadDataUrlAssetOptions,
): Promise<UploadDataUrlAssetResult> {
  const { dataUrl, name, width, height, source, signal } = options;
  const assetId = options.id ?? AssetRecordType.createId();

  let file: File | null = null;
  let failure: string | undefined;
  try {
    file = dataUrlToFile(dataUrl, name);
  } catch (err) {
    failure = describe(err);
  }

  const mimeType = file?.type || parseDataUrl(dataUrl)?.mime || "image/png";
  const pending = buildImageAsset({
    id: assetId,
    name,
    src: "",
    width,
    height,
    mimeType,
    fileSize: file?.size,
    meta: { source },
  });

  if (file) {
    try {
      if (signal?.aborted) throw createAbortError();
      const uploaded = await editor.uploadAsset(pending, file, signal);
      if (!uploaded || typeof uploaded.src !== "string" || uploaded.src.length === 0) {
        throw new Error("asset store returned no src");
      }
      const meta = { ...pending.meta, ...((uploaded.meta ?? {}) as Record<string, unknown>) } as TLImageAsset["meta"];
      editor.createAssets([{ ...pending, props: { ...pending.props, src: uploaded.src }, meta }]);
      return { assetId, src: uploaded.src, inline: false };
    } catch (err) {
      if (signal?.aborted) throw createAbortError();
      failure = describe(err);
    }
  }

  editor.createAssets([{ ...pending, props: { ...pending.props, src: dataUrl } }]);
  return { assetId, src: dataUrl, inline: true, error: failure };
}
