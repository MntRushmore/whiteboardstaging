import { describe, expect, it } from "vitest";
import { AssetRecordType, type TLAsset, type TLAssetId } from "tldraw";
import { createClient } from "@supabase/supabase-js";
import {
  BOARD_ASSETS_BUCKET,
  createBoardAssetStore,
  isAlreadyExistsError,
  objectPathFromPublicUrl,
  sourceOf,
  type BoardAssetStoreEventName,
  type BoardAssetSupabase,
} from "../boardAssetStore";

const USER = "11111111-2222-3333-4444-555555555555";
const BOARD = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const PUBLIC_BASE = "https://proj.supabase.co/storage/v1/object/public";

// Compile-time: the real client must satisfy the structural slice the store uses.
const realClient = createClient("https://example.supabase.co", "anon-key");
const _assignable: BoardAssetSupabase = realClient;
void _assignable;

interface FakeOptions {
  uploadError?: { message: string; statusCode?: string | number; error?: string } | null;
  uploadNeverResolves?: boolean;
  insertError?: { message: string } | null;
  insertThrows?: boolean;
  removeError?: { message: string } | null;
  removeThrows?: boolean;
  deleteError?: { message: string } | null;
}

function fakeSupabase(opts: FakeOptions = {}) {
  const calls = {
    uploads: [] as Array<{ bucket: string; path: string; size: number; type: string; options: unknown }>,
    inserts: [] as Array<{ table: string; values: Record<string, unknown> }>,
    removes: [] as Array<{ bucket: string; paths: string[] }>,
    deletes: [] as Array<{ table: string; column: string; values: string[] }>,
  };
  const client: BoardAssetSupabase = {
    storage: {
      from(bucket: string) {
        return {
          async upload(path: string, file: File | Blob, options?: unknown) {
            calls.uploads.push({ bucket, path, size: file.size, type: file.type, options });
            if (opts.uploadNeverResolves) return new Promise<never>(() => {});
            return { error: opts.uploadError ?? null };
          },
          getPublicUrl(path: string) {
            return { data: { publicUrl: `${PUBLIC_BASE}/${bucket}/${path}` } };
          },
          async remove(paths: string[]) {
            calls.removes.push({ bucket, paths });
            if (opts.removeThrows) throw new Error("network down");
            return { error: opts.removeError ?? null };
          },
        };
      },
    },
    from(table: string) {
      return {
        async insert(values: Record<string, unknown>) {
          calls.inserts.push({ table, values });
          if (opts.insertThrows) throw new Error("insert exploded");
          return { error: opts.insertError ?? null };
        },
        delete() {
          return {
            async in(column: string, values: string[]) {
              calls.deletes.push({ table, column, values });
              return { error: opts.deleteError ?? null };
            },
          };
        },
      };
    },
  };
  return { client, calls };
}

function imageAsset(
  unique = "abc123",
  props: Partial<{ mimeType: string | null; w: number; h: number; src: string }> = {},
  meta: Record<string, string> = { source: "ai" },
): TLAsset {
  return AssetRecordType.create({
    id: AssetRecordType.createId(unique),
    type: "image",
    props: { name: "pic.png", src: "", w: 640.4, h: 480, mimeType: "image/png", isAnimated: false, ...props },
    meta,
  });
}

function pngFile(bytes = 3, type = "image/png") {
  return new File([new Uint8Array(bytes)], "pic.png", { type });
}

function collectEvents() {
  const events: Array<{ name: BoardAssetStoreEventName; detail: Record<string, unknown> }> = [];
  return { events, onEvent: (name: BoardAssetStoreEventName, detail: Record<string, unknown>) => events.push({ name, detail }) };
}

describe("createBoardAssetStore.upload", () => {
  it("uploads to '<uid>/<board>/<assetId>.<ext>' with the file mime, returns the public URL, registers the asset", async () => {
    const { client, calls } = fakeSupabase();
    const { events, onEvent } = collectEvents();
    const store = createBoardAssetStore({ supabase: client, userId: USER, boardId: BOARD, onEvent });

    const result = await store.upload(imageAsset("abc123"), pngFile(5, "image/jpeg"));

    const path = `${USER}/${BOARD}/abc123.jpg`;
    expect(result).toEqual({ src: `${PUBLIC_BASE}/${BOARD_ASSETS_BUCKET}/${path}`, meta: { path } });
    expect(calls.uploads).toEqual([
      {
        bucket: BOARD_ASSETS_BUCKET,
        path,
        size: 5,
        type: "image/jpeg",
        options: { contentType: "image/jpeg", upsert: false, cacheControl: "31536000" },
      },
    ]);
    expect(calls.inserts).toEqual([
      {
        table: "board_assets",
        values: {
          whiteboard_id: BOARD,
          user_id: USER,
          object_path: path,
          mime_type: "image/jpeg",
          bytes: 5,
          width: 640,
          height: 480,
          source: "ai",
        },
      },
    ]);
    expect(events.map((e) => e.name)).toEqual(["uploaded"]);
    expect(store.pathFor(AssetRecordType.createId("abc123"))).toBe(path);
  });

  it("falls back to asset.props.mimeType when the File has no type, and honours a custom bucket", async () => {
    const { client, calls } = fakeSupabase();
    const store = createBoardAssetStore({ supabase: client, userId: USER, boardId: BOARD, bucket: "other-bucket" });

    const result = await store.upload(imageAsset("x", { mimeType: "image/webp" }), pngFile(2, ""));

    expect(calls.uploads[0].path).toBe(`${USER}/${BOARD}/x.webp`);
    expect(calls.uploads[0].bucket).toBe("other-bucket");
    expect((calls.uploads[0].options as { contentType: string }).contentType).toBe("image/webp");
    expect(result.src).toBe(`${PUBLIC_BASE}/other-bucket/${USER}/${BOARD}/x.webp`);
  });

  it("uses 'user' as the registry source when meta.source is missing or unknown", async () => {
    const { client, calls } = fakeSupabase();
    const store = createBoardAssetStore({ supabase: client, userId: USER, boardId: BOARD });
    await store.upload(imageAsset("a", {}, {}), pngFile());
    await store.upload(imageAsset("b", {}, { source: "bogus" }), pngFile());
    expect(calls.inserts.map((i) => i.values.source)).toEqual(["user", "user"]);
  });

  it("treats a 409 'already exists' upload as success and skips the duplicate registry insert", async () => {
    const { client, calls } = fakeSupabase({
      uploadError: { message: "The resource already exists", statusCode: "409", error: "Duplicate" },
    });
    const { events, onEvent } = collectEvents();
    const store = createBoardAssetStore({ supabase: client, userId: USER, boardId: BOARD, onEvent });

    const result = await store.upload(imageAsset("dup"), pngFile());

    expect(result.src).toBe(`${PUBLIC_BASE}/${BOARD_ASSETS_BUCKET}/${USER}/${BOARD}/dup.png`);
    expect(result.meta.path).toBe(`${USER}/${BOARD}/dup.png`);
    expect(calls.inserts).toHaveLength(0);
    expect(events.map((e) => e.name)).toEqual(["upload-exists"]);
  });

  it("rejects and emits 'upload-failed' on any other storage error", async () => {
    const { client, calls } = fakeSupabase({ uploadError: { message: "Payload too large", statusCode: "413" } });
    const { events, onEvent } = collectEvents();
    const store = createBoardAssetStore({ supabase: client, userId: USER, boardId: BOARD, onEvent });

    await expect(store.upload(imageAsset(), pngFile())).rejects.toThrow(/Payload too large/);
    expect(calls.inserts).toHaveLength(0);
    expect(events.map((e) => e.name)).toEqual(["upload-failed"]);
  });

  it("tolerates a registry insert error and reports it via onEvent", async () => {
    const { client } = fakeSupabase({ insertError: { message: "permission denied for table board_assets" } });
    const { events, onEvent } = collectEvents();
    const store = createBoardAssetStore({ supabase: client, userId: USER, boardId: BOARD, onEvent });

    const result = await store.upload(imageAsset(), pngFile());

    expect(result.src).toContain("/object/public/board-assets/");
    expect(events).toEqual([
      { name: "uploaded", detail: expect.any(Object) },
      { name: "registry-failed", detail: { path: `${USER}/${BOARD}/abc123.png`, error: "permission denied for table board_assets" } },
    ]);
  });

  it("tolerates a registry insert that throws, and an onEvent that throws", async () => {
    const { client } = fakeSupabase({ insertThrows: true });
    const store = createBoardAssetStore({
      supabase: client,
      userId: USER,
      boardId: BOARD,
      onEvent: () => {
        throw new Error("logger broke");
      },
    });
    await expect(store.upload(imageAsset(), pngFile())).resolves.toMatchObject({ src: expect.stringContaining("https://") });
  });

  it("rejects with AbortError before touching storage when the signal is already aborted", async () => {
    const { client, calls } = fakeSupabase();
    const store = createBoardAssetStore({ supabase: client, userId: USER, boardId: BOARD });
    const controller = new AbortController();
    controller.abort();

    await expect(store.upload(imageAsset(), pngFile(), controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(calls.uploads).toHaveLength(0);
  });

  it("rejects with AbortError when the signal fires mid-upload", async () => {
    const { client, calls } = fakeSupabase({ uploadNeverResolves: true });
    const store = createBoardAssetStore({ supabase: client, userId: USER, boardId: BOARD });
    const controller = new AbortController();

    const pending = store.upload(imageAsset(), pngFile(), controller.signal);
    const assertion = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await assertion;
    expect(calls.uploads).toHaveLength(1);
    expect(calls.inserts).toHaveLength(0);
  });

  it("requires userId and boardId", () => {
    const { client } = fakeSupabase();
    expect(() => createBoardAssetStore({ supabase: client, userId: "", boardId: BOARD })).toThrow(/userId/);
    expect(() => createBoardAssetStore({ supabase: client, userId: USER, boardId: "" })).toThrow(/boardId/);
  });
});

describe("createBoardAssetStore.resolve", () => {
  it("returns props.src, or null when empty", () => {
    const { client } = fakeSupabase();
    const store = createBoardAssetStore({ supabase: client, userId: USER, boardId: BOARD });
    expect(store.resolve(imageAsset("r", { src: "https://cdn/x.png" }))).toBe("https://cdn/x.png");
    expect(store.resolve(imageAsset("r", { src: "" }))).toBeNull();
  });
});

describe("createBoardAssetStore.remove", () => {
  it("removes objects uploaded in this session from storage and the registry", async () => {
    const { client, calls } = fakeSupabase();
    const store = createBoardAssetStore({ supabase: client, userId: USER, boardId: BOARD });
    const asset = imageAsset("gone");
    await store.upload(asset, pngFile());

    await store.remove([asset.id]);

    const path = `${USER}/${BOARD}/gone.png`;
    expect(calls.removes).toEqual([{ bucket: BOARD_ASSETS_BUCKET, paths: [path] }]);
    expect(calls.deletes).toEqual([{ table: "board_assets", column: "object_path", values: [path] }]);
    expect(store.pathFor(asset.id)).toBeUndefined();
  });

  it("derives paths via getAsset from meta.path or a public URL in our bucket, ignoring foreign objects", async () => {
    const { client, calls } = fakeSupabase();
    const byMeta = imageAsset("m", { src: "https://elsewhere/x.png" }, { path: `${USER}/${BOARD}/m.png` });
    const bySrc = imageAsset("s", { src: `${PUBLIC_BASE}/${BOARD_ASSETS_BUCKET}/${USER}/${BOARD}/s.png` });
    const otherBucket = imageAsset("o", { src: `${PUBLIC_BASE}/training-data/${USER}/${BOARD}/o.png` });
    const otherUser = imageAsset("u", { src: `${PUBLIC_BASE}/${BOARD_ASSETS_BUCKET}/someone-else/${BOARD}/u.png` });
    const inline = imageAsset("i", { src: "data:image/png;base64,AAAA" });
    const lookup = new Map<TLAssetId, TLAsset>([byMeta, bySrc, otherBucket, otherUser, inline].map((a) => [a.id, a]));
    const store = createBoardAssetStore({ supabase: client, userId: USER, boardId: BOARD, getAsset: (id) => lookup.get(id) });

    await store.remove([byMeta.id, bySrc.id, otherBucket.id, otherUser.id, inline.id, AssetRecordType.createId("unknown")]);

    expect(calls.removes).toEqual([{ bucket: BOARD_ASSETS_BUCKET, paths: [`${USER}/${BOARD}/m.png`, `${USER}/${BOARD}/s.png`] }]);
    expect(calls.deletes[0].values).toEqual([`${USER}/${BOARD}/m.png`, `${USER}/${BOARD}/s.png`]);
  });

  it("does nothing when no path can be derived", async () => {
    const { client, calls } = fakeSupabase();
    const store = createBoardAssetStore({ supabase: client, userId: USER, boardId: BOARD });
    await expect(store.remove([AssetRecordType.createId("nope")])).resolves.toBeUndefined();
    expect(calls.removes).toHaveLength(0);
    expect(calls.deletes).toHaveLength(0);
  });

  it("never throws: storage failure still attempts the registry delete and both are reported", async () => {
    const { client, calls } = fakeSupabase({ removeThrows: true, deleteError: { message: "rls" } });
    const { events, onEvent } = collectEvents();
    const store = createBoardAssetStore({ supabase: client, userId: USER, boardId: BOARD, onEvent });
    const asset = imageAsset("z");
    await store.upload(asset, pngFile());
    events.length = 0;

    await expect(store.remove([asset.id])).resolves.toBeUndefined();

    expect(calls.deletes).toHaveLength(1);
    expect(events.map((e) => [e.name, e.detail.stage])).toEqual([
      ["remove-failed", "storage"],
      ["remove-failed", "registry"],
    ]);
  });
});

describe("helpers", () => {
  it("isAlreadyExistsError recognises the Supabase 409 shapes only", () => {
    expect(isAlreadyExistsError({ message: "The resource already exists", statusCode: "409" })).toBe(true);
    expect(isAlreadyExistsError({ message: "x", statusCode: 409 })).toBe(true);
    expect(isAlreadyExistsError({ message: "x", error: "Duplicate" })).toBe(true);
    expect(isAlreadyExistsError({ message: "Object already exists" })).toBe(true);
    expect(isAlreadyExistsError({ message: "Payload too large", statusCode: "413" })).toBe(false);
    expect(isAlreadyExistsError(null)).toBe(false);
  });

  it("objectPathFromPublicUrl only matches our bucket and decodes the path", () => {
    expect(objectPathFromPublicUrl(`${PUBLIC_BASE}/board-assets/u/b/a%20b.png`, "board-assets")).toBe("u/b/a b.png");
    expect(objectPathFromPublicUrl(`${PUBLIC_BASE}/board-assets/u/b/a.png?download=1`, "board-assets")).toBe("u/b/a.png");
    expect(objectPathFromPublicUrl(`${PUBLIC_BASE}/training-data/u/b/a.png`, "board-assets")).toBeNull();
    expect(objectPathFromPublicUrl("data:image/png;base64,AAAA", "board-assets")).toBeNull();
    expect(objectPathFromPublicUrl("https://example.com/a.png", "board-assets")).toBeNull();
    expect(objectPathFromPublicUrl(null, "board-assets")).toBeNull();
  });

  it("sourceOf falls back to 'user'", () => {
    expect(sourceOf(imageAsset("a", {}, { source: "pdf" }))).toBe("pdf");
    expect(sourceOf(imageAsset("a", {}, { source: "nope" }))).toBe("user");
    expect(sourceOf(imageAsset("a", {}, {}))).toBe("user");
  });

  it("the store satisfies the TLAssetStore contract when passed to createTLStore", async () => {
    const { createTLStore, defaultBindingUtils, defaultShapeUtils } = await import("tldraw");
    const { client, calls } = fakeSupabase();
    const assets = createBoardAssetStore({ supabase: client, userId: USER, boardId: BOARD });
    // createTLStore wraps the store it is given; drive our upload through what tldraw kept.
    const tlStore = createTLStore({ shapeUtils: defaultShapeUtils, bindingUtils: defaultBindingUtils, assets });
    const result = await tlStore.props.assets.upload(imageAsset("via-tldraw"), pngFile());
    expect(calls.uploads.map((u) => u.path)).toEqual([`${USER}/${BOARD}/via-tldraw.png`]);
    expect(result.src).toBe(`${PUBLIC_BASE}/${BOARD_ASSETS_BUCKET}/${USER}/${BOARD}/via-tldraw.png`);
    expect(assets.pathFor(AssetRecordType.createId("via-tldraw"))).toBe(`${USER}/${BOARD}/via-tldraw.png`);
  });
});
