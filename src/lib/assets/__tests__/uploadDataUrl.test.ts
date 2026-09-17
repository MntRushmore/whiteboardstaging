import { describe, expect, it, vi } from "vitest";
import {
  AssetRecordType,
  createTLStore,
  defaultBindingUtils,
  defaultShapeUtils,
  type Editor,
  type TLImageAsset,
} from "tldraw";
import { dataUrlToFile, uploadDataUrlAsset, type AssetUploadEditor } from "../uploadDataUrl";

// Compile-time: the real tldraw Editor must satisfy the structural slice.
const _editorAssignable: (e: Editor) => AssetUploadEditor = (e) => e;
void _editorAssignable;

// 1x1 transparent PNG
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const PNG_DATA_URL = `data:image/png;base64,${PNG_B64}`;
const HTTPS = "https://proj.supabase.co/storage/v1/object/public/board-assets/u/b/x.png";

function fakeEditor(upload: AssetUploadEditor["uploadAsset"]) {
  const store = createTLStore({ shapeUtils: defaultShapeUtils, bindingUtils: defaultBindingUtils });
  const uploadAsset = vi.fn(upload);
  const createAssets = vi.fn((assets: TLImageAsset[]) => {
    store.put(assets); // runs tldraw's record validation
  });
  const editor: AssetUploadEditor = { uploadAsset, createAssets };
  return { editor, store, uploadAsset, createAssets };
}

describe("dataUrlToFile", () => {
  it("decodes bytes, mime and name", async () => {
    const file = dataUrlToFile(PNG_DATA_URL, "tiny.png");
    expect(file.name).toBe("tiny.png");
    expect(file.type).toBe("image/png");
    expect(file.size).toBe(Buffer.from(PNG_B64, "base64").length);
    const head = new Uint8Array(await file.arrayBuffer()).slice(0, 4);
    expect(Array.from(head)).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it("throws on anything that is not a base64 data URL", () => {
    expect(() => dataUrlToFile("https://example.com/a.png", "a.png")).toThrow(/data: URL/);
    expect(() => dataUrlToFile("data:text/plain,hello", "a.txt")).toThrow();
    expect(() => dataUrlToFile("", "a.png")).toThrow();
  });
});

describe("uploadDataUrlAsset", () => {
  it("uploads the file through editor.uploadAsset and creates the asset with the https src and merged meta", async () => {
    const { editor, store, uploadAsset, createAssets } = fakeEditor(async (asset, file) => {
      expect(asset.props.src).toBe("");
      expect(asset.props.mimeType).toBe("image/png");
      expect(asset.meta).toEqual({ source: "ai" });
      expect(file.type).toBe("image/png");
      expect(file.name).toBe("solution.png");
      return { src: HTTPS, meta: { path: "u/b/x.png" } };
    });

    const result = await uploadDataUrlAsset(editor, {
      dataUrl: PNG_DATA_URL,
      name: "solution.png",
      width: 300,
      height: 200,
      source: "ai",
    });

    expect(result).toEqual({ assetId: expect.stringMatching(/^asset:/), src: HTTPS, inline: false });
    expect(uploadAsset).toHaveBeenCalledTimes(1);
    expect(createAssets).toHaveBeenCalledTimes(1);
    const record = store.get(result.assetId) as TLImageAsset;
    expect(record.type).toBe("image");
    expect(record.props).toMatchObject({
      name: "solution.png",
      src: HTTPS,
      w: 300,
      h: 200,
      mimeType: "image/png",
      isAnimated: false,
      fileSize: Buffer.from(PNG_B64, "base64").length,
    });
    expect(record.meta).toEqual({ source: "ai", path: "u/b/x.png" });
  });

  it("reuses a caller-supplied id", async () => {
    const id = AssetRecordType.createId("fixed");
    const { editor, store } = fakeEditor(async () => ({ src: HTTPS }));
    const result = await uploadDataUrlAsset(editor, { id, dataUrl: PNG_DATA_URL, name: "a.png", width: 1, height: 1, source: "user" });
    expect(result.assetId).toBe(id);
    expect(store.get(id)).toBeDefined();
  });

  it("falls back to an inline asset (and never throws) when uploadAsset rejects", async () => {
    const { editor, store, createAssets } = fakeEditor(async () => {
      throw new Error("storage 500");
    });

    const result = await uploadDataUrlAsset(editor, { dataUrl: PNG_DATA_URL, name: "p.png", width: 10, height: 10, source: "pdf" });

    expect(result.inline).toBe(true);
    expect(result.src).toBe(PNG_DATA_URL);
    expect(result.error).toBe("storage 500");
    expect(createAssets).toHaveBeenCalledTimes(1);
    const record = store.get(result.assetId) as TLImageAsset;
    expect(record.props.src).toBe(PNG_DATA_URL);
    expect(record.meta).toEqual({ source: "pdf" });
  });

  it("falls back when the store returns an empty src", async () => {
    const { editor } = fakeEditor(async () => ({ src: "" }));
    const result = await uploadDataUrlAsset(editor, { dataUrl: PNG_DATA_URL, name: "p.png", width: 1, height: 1, source: "sticker" });
    expect(result.inline).toBe(true);
    expect(result.error).toMatch(/no src/);
  });

  it("falls back without calling uploadAsset when the input is not a valid data URL", async () => {
    const { editor, store, uploadAsset } = fakeEditor(async () => ({ src: HTTPS }));
    const bogus = "data:image/png;base64,***not-base64***";

    const result = await uploadDataUrlAsset(editor, { dataUrl: bogus, name: "p.png", width: 1, height: 1, source: "worksheet" });

    expect(uploadAsset).not.toHaveBeenCalled();
    expect(result.inline).toBe(true);
    expect(result.error).toMatch(/data: URL/);
    expect((store.get(result.assetId) as TLImageAsset).props.src).toBe(bogus);
  });

  it("rejects with AbortError and creates nothing when the signal is aborted", async () => {
    const controller = new AbortController();
    const { editor, createAssets } = fakeEditor(async (_asset, _file, signal) => {
      controller.abort();
      const err = new Error("aborted");
      err.name = "AbortError";
      expect(signal?.aborted).toBe(true);
      throw err;
    });

    await expect(
      uploadDataUrlAsset(editor, { dataUrl: PNG_DATA_URL, name: "p.png", width: 1, height: 1, source: "ai", signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(createAssets).not.toHaveBeenCalled();
  });

  it("rejects immediately when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const { editor, uploadAsset, createAssets } = fakeEditor(async () => ({ src: HTTPS }));
    await expect(
      uploadDataUrlAsset(editor, { dataUrl: PNG_DATA_URL, name: "p.png", width: 1, height: 1, source: "ai", signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(uploadAsset).not.toHaveBeenCalled();
    expect(createAssets).not.toHaveBeenCalled();
  });
});
