import { describe, expect, it, vi } from "vitest";
import {
  AssetRecordType,
  createTLStore,
  defaultBindingUtils,
  defaultShapeUtils,
  type Editor,
  type TLAsset,
  type TLAssetPartial,
  type TLImageAsset,
  type TLStore,
} from "tldraw";
import { findInlineEditorAssets, offloadEditorAssets, offloadEditorAssetsOrThrow, type OffloadEditor } from "../offloadSnapshotAssets";

// Compile-time: the real tldraw Editor must satisfy the structural slice.
const _editorAssignable: (e: Editor) => OffloadEditor = (e) => e;
void _editorAssignable;

const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const PUBLIC = "https://proj.supabase.co/storage/v1/object/public/board-assets/u/b";

function inlinePng(unique: string, padKb = 4): TLImageAsset {
  // Prefix zero-byte padding (a multiple of 4 chars keeps the base64 valid, the
  // real payload's '==' stays last) so size differences show up in byte counts.
  const pad = "A".repeat(padKb * 1024);
  return AssetRecordType.create({
    id: AssetRecordType.createId(unique),
    type: "image",
    props: { name: `${unique}.png`, src: `data:image/png;base64,${pad}${PNG_B64}`, w: 10, h: 10, mimeType: "image/png", isAnimated: false },
    meta: { source: "ai" },
  }) as TLImageAsset;
}

function httpsPng(unique: string): TLImageAsset {
  return AssetRecordType.create({
    id: AssetRecordType.createId(unique),
    type: "image",
    props: { name: `${unique}.png`, src: `${PUBLIC}/${unique}.png`, w: 10, h: 10, mimeType: "image/png", isAnimated: false },
    meta: {},
  }) as TLImageAsset;
}

function bookmark(unique: string): TLAsset {
  return AssetRecordType.create({
    id: AssetRecordType.createId(unique),
    type: "bookmark",
    props: { title: "t", description: "d", image: "", favicon: "", src: "https://example.com" },
    meta: {},
  });
}

/** Minimal Editor stand-in over a real headless TLStore. */
function fakeEditor(store: TLStore, upload: OffloadEditor["uploadAsset"]) {
  const uploadAsset = vi.fn(upload);
  let updatesInsideMerge = 0;
  let updatesOutsideMerge = 0;
  const updateAssets = vi.fn((partials: TLAssetPartial[]) => {
    // Mirror the REAL Editor.updateAssets (tldraw 4.2): `{ ...store.get(id), ...partial }` — a shallow record
    // merge with NO props merge, so a partial that omits w/h/mimeType would fail store validation.
    if ((store as unknown as { isMergingRemoteChanges: boolean }).isMergingRemoteChanges) updatesInsideMerge++;
    else updatesOutsideMerge++;
    store.put(
      partials.map((p) => {
        const current = store.get(p.id) as TLAsset;
        return { ...current, ...p } as TLAsset;
      }),
    );
  });
  const editor: OffloadEditor = { store, uploadAsset, updateAssets };
  return { editor, uploadAsset, updateAssets, counts: () => ({ updatesInsideMerge, updatesOutsideMerge }) };
}

function newStore(records: TLAsset[]) {
  const store = createTLStore({ shapeUtils: defaultShapeUtils, bindingUtils: defaultBindingUtils });
  store.put(records);
  return store;
}

describe("findInlineEditorAssets", () => {
  it("returns only image/video assets whose src is a data: URL", () => {
    const store = newStore([inlinePng("a"), httpsPng("b"), bookmark("c")]);
    const found = findInlineEditorAssets({ store });
    expect(found.map((a) => a.id)).toEqual([AssetRecordType.createId("a")]);
  });
});

describe("offloadEditorAssets", () => {
  it("migrates only data: assets, rewrites src via updateAssets inside mergeRemoteChanges, and shrinks the snapshot", async () => {
    const keep = httpsPng("keep");
    const store = newStore([inlinePng("a"), inlinePng("b"), keep, bookmark("bm")]);
    const remoteChanges: string[] = [];
    const userChanges: string[] = [];
    store.listen((entry) => remoteChanges.push(...Object.keys(entry.changes.updated)), { source: "remote", scope: "document" });
    store.listen((entry) => userChanges.push(...Object.keys(entry.changes.updated)), { source: "user", scope: "document" });

    const { editor, uploadAsset, updateAssets, counts } = fakeEditor(store, async (asset, file) => {
      expect(file.type).toBe("image/png");
      expect(file.name).toBe((asset as TLImageAsset).props.name);
      return { src: `${PUBLIC}/${asset.id.replace(/^asset:/, "")}.png`, meta: { path: `u/b/${asset.id.replace(/^asset:/, "")}.png` } };
    });

    const result = await offloadEditorAssets(editor);

    expect(result.migrated).toBe(2);
    expect(result.failed).toEqual([]);
    expect(result.aborted).toBe(false);
    expect(result.bytesAfter).toBeLessThan(result.bytesBefore);
    expect(result.bytesBefore).toBeGreaterThan(8 * 1024);
    expect(uploadAsset).toHaveBeenCalledTimes(2);
    expect(updateAssets).toHaveBeenCalledTimes(1);
    expect(counts()).toEqual({ updatesInsideMerge: 1, updatesOutsideMerge: 0 });

    const a = store.get(AssetRecordType.createId("a")) as TLImageAsset;
    expect(a.props.src).toBe(`${PUBLIC}/a.png`);
    expect(a.meta).toEqual({ source: "ai", path: "u/b/a.png" });
    expect(a.props.w).toBe(10); // other props untouched
    expect(store.get(keep.id)).toBe(keep); // untouched records keep identity
    expect(findInlineEditorAssets({ store })).toEqual([]);

    // Flush tldraw's history reactor so listeners observe the transaction.
    (store as unknown as { _flushHistory(): void })._flushHistory();
    expect(remoteChanges.sort()).toEqual([AssetRecordType.createId("a"), AssetRecordType.createId("b")]);
    expect(userChanges).toEqual([]);
  });

  it("collects per-asset failures instead of throwing and leaves those assets inline", async () => {
    const store = newStore([inlinePng("ok"), inlinePng("bad")]);
    const { editor } = fakeEditor(store, async (asset) => {
      if (asset.id.endsWith("bad")) throw new Error("bucket quota exceeded");
      return { src: `${PUBLIC}/ok.png` };
    });

    const result = await offloadEditorAssets(editor);

    expect(result.migrated).toBe(1);
    expect(result.failed).toEqual([{ id: AssetRecordType.createId("bad"), name: "bad.png", error: "bucket quota exceeded" }]);
    expect((store.get(AssetRecordType.createId("ok")) as TLImageAsset).props.src).toBe(`${PUBLIC}/ok.png`);
    expect((store.get(AssetRecordType.createId("bad")) as TLImageAsset).props.src).toMatch(/^data:/);
    expect(result.bytesAfter).toBeLessThan(result.bytesBefore);
  });

  it("treats an empty src from the store as a failure", async () => {
    const store = newStore([inlinePng("x")]);
    const { editor, updateAssets } = fakeEditor(store, async () => ({ src: "" }));
    const result = await offloadEditorAssets(editor);
    expect(result.migrated).toBe(0);
    expect(result.failed[0].error).toMatch(/no src/);
    expect(updateAssets).not.toHaveBeenCalled();
  });

  it("does nothing when there are no inline assets", async () => {
    const store = newStore([httpsPng("h"), bookmark("bm")]);
    const { editor, uploadAsset, updateAssets } = fakeEditor(store, async () => ({ src: "unused" }));
    const result = await offloadEditorAssets(editor);
    expect(result).toEqual({ migrated: 0, failed: [], bytesBefore: result.bytesAfter, bytesAfter: expect.any(Number), aborted: false });
    expect(uploadAsset).not.toHaveBeenCalled();
    expect(updateAssets).not.toHaveBeenCalled();
  });

  it("respects the concurrency limit", async () => {
    const store = newStore(["a", "b", "c", "d", "e"].map((u) => inlinePng(u, 1)));
    let inFlight = 0;
    let maxInFlight = 0;
    const { editor } = fakeEditor(store, async (asset) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
      return { src: `${PUBLIC}/${asset.id}.png` };
    });

    const result = await offloadEditorAssets(editor, { concurrency: 2 });

    expect(result.migrated).toBe(5);
    expect(maxInFlight).toBe(2);
  });

  it("with an already-aborted signal uploads nothing and reports every asset as failed/aborted", async () => {
    const store = newStore([inlinePng("a"), inlinePng("b")]);
    const controller = new AbortController();
    controller.abort();
    const { editor, uploadAsset, updateAssets } = fakeEditor(store, async () => ({ src: "unused" }));

    const result = await offloadEditorAssets(editor, { signal: controller.signal });

    expect(uploadAsset).not.toHaveBeenCalled();
    expect(updateAssets).not.toHaveBeenCalled();
    expect(result.aborted).toBe(true);
    expect(result.migrated).toBe(0);
    expect(result.failed.map((f) => f.error)).toEqual(["aborted", "aborted"]);
  });

  it("applies the uploads that finished before an abort mid-way", async () => {
    const store = newStore([inlinePng("first"), inlinePng("second")]);
    const controller = new AbortController();
    const { editor } = fakeEditor(store, async (asset, _file, signal) => {
      if (asset.id.endsWith("first")) {
        controller.abort();
        return { src: `${PUBLIC}/first.png` };
      }
      if (signal?.aborted) {
        const err = new Error("aborted");
        err.name = "AbortError";
        throw err;
      }
      return { src: `${PUBLIC}/second.png` };
    });

    const result = await offloadEditorAssets(editor, { concurrency: 1, signal: controller.signal });

    expect(result.aborted).toBe(true);
    expect(result.migrated).toBe(1);
    expect(result.failed).toEqual([{ id: AssetRecordType.createId("second"), name: "second.png", error: "aborted" }]);
    expect((store.get(AssetRecordType.createId("first")) as TLImageAsset).props.src).toBe(`${PUBLIC}/first.png`);
  });

  it("offloadEditorAssetsOrThrow rejects with AbortError on abort and passes the result through otherwise", async () => {
    const controller = new AbortController();
    controller.abort();
    const aborted = fakeEditor(newStore([inlinePng("a")]), async () => ({ src: "unused" }));
    await expect(offloadEditorAssetsOrThrow(aborted.editor, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });

    const fine = fakeEditor(newStore([inlinePng("a")]), async () => ({ src: `${PUBLIC}/a.png` }));
    await expect(offloadEditorAssetsOrThrow(fine.editor)).resolves.toMatchObject({ migrated: 1, aborted: false });
  });
});
