import { toast } from "sonner";
import {
  createShapesForAssets,
  getAssetInfo,
  type Editor,
  type TLAsset,
  type TLAssetId,
  type TLDefaultExternalContentHandlerOpts,
  type TLShapeId,
  type VecLike,
} from "tldraw";

/**
 * The board's handler for files pasted, dropped or inserted (tldraw's `files` external content).
 * tldraw's default shows the picture at once and uploads it in the background, but when the upload
 * fails it deletes the asset and keeps the image shape: a broken picture that is then saved with
 * the board. This one does the same until the upload fails, then removes the shape again (and the
 * placeholder asset, unless another shape uses it) and says so. Loaded on the first paste or drop
 * (src/app/board/[id]/page.tsx registers it).
 */

/** What the `board-assets` bucket accepts (supabase/migrations/20260911000000_init.sql, B4). */
export const BOARD_IMAGE_TYPES: readonly string[] = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"];
/** tldraw's default limit for a pasted file. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export const ADD_IMAGE_COPY = {
  failed: "Couldn't add that image. Try again.",
  notAnImage: "Only pictures can go on a board (PNG, JPEG, GIF, WebP or SVG).",
  tooBig: "That picture is too big (10 MB at most).",
  tooMany: "Too many files at once.",
} as const;

/** `getAssetInfo` reads only the accepted types and the size cap from tldraw's handler options. */
const INFO_OPTS = { acceptedImageMimeTypes: BOARD_IMAGE_TYPES } as unknown as TLDefaultExternalContentHandlerOpts;

/**
 * Remove the shape a failed upload left, history-free (an undo must not bring the broken picture
 * back; the paste's own undo entry stays, so an undo followed by a redo would, which is left as
 * is: rewinding history could take strokes drawn during the upload with it). The shape stays when
 * the same picture (same asset id: same bytes) was uploaded by another paste meanwhile, since then
 * it shows that one. True when something was removed.
 */
function dropFailed(editor: Editor, assetId: TLAssetId, shapeId: TLShapeId | undefined): boolean {
  if (editor.getAsset(assetId)?.props.src) return false;
  editor.run(
    () => {
      if (shapeId) editor.deleteShapes([shapeId]);
      const used = editor.store
        .allRecords()
        .some((r) => r.typeName === "shape" && (r as { props?: { assetId?: unknown } }).props?.assetId === assetId);
      if (!used) editor.deleteAssets([assetId]);
    },
    { history: "ignore" },
  );
  return true;
}

export interface AddImageFilesDeps {
  notify?: (message: string) => void;
  /** the placeholder asset for a file (tldraw's getAssetInfo; injectable because it decodes the image) */
  assetInfo?: (file: File) => Promise<TLAsset>;
}

export async function addImageFiles(
  editor: Editor,
  { point, files }: { point?: VecLike; files: File[] },
  {
    notify = (message) => void toast.error(message),
    assetInfo = async (file) => (await getAssetInfo(file, INFO_OPTS)) as TLAsset,
  }: AddImageFilesDeps = {},
): Promise<void> {
  if (files.length > editor.options.maxFilesAtOnce) return notify(ADD_IMAGE_COPY.tooMany);
  const position = point ?? (editor.inputs.shiftKey ? editor.inputs.currentPagePoint : editor.getViewportPageBounds().center);

  const placed: Array<{ file: File; asset: TLAsset }> = [];
  for (const file of files) {
    if (!BOARD_IMAGE_TYPES.includes(file.type)) {
      notify(ADD_IMAGE_COPY.notAnImage);
      continue;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      notify(ADD_IMAGE_COPY.tooBig);
      continue;
    }
    let asset: TLAsset;
    try {
      // A placeholder (id from the bytes' hash, no src yet) the picture shows through while it uploads.
      asset = await assetInfo(file);
    } catch {
      notify(ADD_IMAGE_COPY.failed); // not a readable image
      continue;
    }
    editor.createTemporaryAssetPreview(asset.id, file);
    placed.push({ file, asset });
  }
  if (placed.length === 0) return;

  // One image shape per asset, in order.
  const shapeIds = await createShapesForAssets(
    editor,
    placed.map((p) => p.asset),
    position,
  );

  let failed = 0;
  await Promise.all(
    placed.map(async ({ file, asset }, i) => {
      try {
        // tldraw's file asset handler: checks the file, then the board's asset store uploads it.
        const uploaded = await editor.getAssetForExternalContent({ type: "file", file, assetId: asset.id });
        if (!uploaded) throw new Error("no asset");
        editor.updateAssets([{ ...uploaded, id: asset.id }]);
      } catch {
        if (dropFailed(editor, asset.id, shapeIds[i])) failed++;
      }
    }),
  );
  if (failed > 0) notify(ADD_IMAGE_COPY.failed);
}
