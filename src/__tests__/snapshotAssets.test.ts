/**
 * Unit tests for scripts/lib/snapshotAssets.mjs - the pure helpers shared by
 * the client asset store and the admin offload script.
 */
import { describe, expect, it } from "vitest";
import {
  SNAPSHOT_LIMITS,
  assetObjectPath,
  extForMime,
  findInlineAssets,
  parseDataUrl,
  rewriteAssetSrcs,
  snapshotJsonBytes,
} from "../../scripts/lib/snapshotAssets.mjs";
import type { InlineAsset } from "../../scripts/lib/snapshotAssets.mjs";

// 1x1 transparent PNG (70 bytes decoded).
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const PNG_URL = `data:image/png;base64,${PNG_B64}`;
const SVG_URL = `data:image/svg+xml;base64,${Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>").toString("base64")}`;

function assetRecord(id: string, src: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    typeName: "asset",
    type: "image",
    props: { src, name: `${id.replace("asset:", "")}.png`, mimeType: "image/png", w: 1, h: 1, isAnimated: false },
    meta: {},
    ...extra,
  };
}

const shape = { id: "shape:1", typeName: "shape", type: "geo", props: { src: PNG_URL }, x: 0, y: 0 };

function storeSnapshot() {
  return {
    store: {
      "asset:inline": assetRecord("asset:inline", PNG_URL),
      "asset:remote": assetRecord("asset:remote", "https://cdn.example.com/x.png"),
      "asset:svg": assetRecord("asset:svg", SVG_URL, { props: { src: SVG_URL, name: "logo.svg", mimeType: "image/svg+xml" } }),
      "shape:1": shape,
      "document:document": { id: "document:document", typeName: "document", name: "" },
    },
    schema: { schemaVersion: 2, sequences: {} },
  };
}

function editorSnapshot() {
  return { document: storeSnapshot(), session: { version: 0, currentPageId: "page:page" } };
}

describe("parseDataUrl", () => {
  it("decodes a png data URL", () => {
    const parsed = parseDataUrl(PNG_URL);
    expect(parsed).not.toBeNull();
    expect(parsed!.mime).toBe("image/png");
    expect(parsed!.base64).toBe(PNG_B64);
    expect(parsed!.bytes.byteLength).toBe(70);
    // PNG signature
    expect(Array.from(parsed!.bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it("decodes jpeg and svg+xml", () => {
    const jpeg = parseDataUrl(`data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff]).toString("base64")}`);
    expect(jpeg?.mime).toBe("image/jpeg");
    expect(Array.from(jpeg!.bytes)).toEqual([0xff, 0xd8, 0xff]);
    const svg = parseDataUrl(SVG_URL);
    expect(svg?.mime).toBe("image/svg+xml");
    expect(Buffer.from(svg!.bytes).toString("utf8")).toContain("<svg");
  });

  it("accepts extra parameters such as charset and normalises case / whitespace", () => {
    const parsed = parseDataUrl(`data:Image/SVG+XML;charset=utf-8;base64,${Buffer.from("<svg/>").toString("base64")}`);
    expect(parsed?.mime).toBe("image/svg+xml");
    expect(Buffer.from(parsed!.bytes).toString()).toBe("<svg/>");
    expect(parseDataUrl(`  data:image/png;base64,${PNG_B64.slice(0, 8)}\n${PNG_B64.slice(8)} `)?.bytes.byteLength).toBe(70);
  });

  it("returns null for anything that is not a base64 data URL", () => {
    expect(parseDataUrl("https://example.com/a.png")).toBeNull();
    expect(parseDataUrl("data:text/plain,hello")).toBeNull(); // not base64
    expect(parseDataUrl("data:;base64,AAAA")).toBeNull(); // no mime
    expect(parseDataUrl("data:image/png;base64,")).toBeNull(); // empty payload
    expect(parseDataUrl("data:image/png;base64,***!")).toBeNull(); // bad alphabet
    expect(parseDataUrl("data:image/png;base64,A")).toBeNull(); // impossible length
    expect(parseDataUrl(null)).toBeNull();
    expect(parseDataUrl(42)).toBeNull();
    expect(parseDataUrl("")).toBeNull();
  });
});

describe("extForMime", () => {
  it("maps the bucket's allowed mimes and falls back to bin", () => {
    expect(extForMime("image/png")).toBe("png");
    expect(extForMime("image/jpeg")).toBe("jpg");
    expect(extForMime("image/jpg")).toBe("jpg");
    expect(extForMime("IMAGE/WEBP")).toBe("webp");
    expect(extForMime("image/gif")).toBe("gif");
    expect(extForMime("image/svg+xml; charset=utf-8")).toBe("svg");
    expect(extForMime("application/pdf")).toBe("bin");
    expect(extForMime("")).toBe("bin");
  });
});

describe("assetObjectPath", () => {
  const uid = "6f1c2a7e-0f7a-4b1e-9c0e-1234567890ab";
  const board = "0b6a4c58-1d1e-4f0a-8a1b-abcdefabcdef";

  it("follows '<uid>/<boardId>/<assetId>.<ext>' and strips the asset: prefix", () => {
    expect(assetObjectPath(uid, board, "asset:abc123XYZ", "image/png")).toBe(`${uid}/${board}/abc123XYZ.png`);
    expect(assetObjectPath(uid, board, "abc", "image/jpeg")).toBe(`${uid}/${board}/abc.jpg`);
  });

  it("neutralises path traversal and separator characters in every segment", () => {
    const p = assetObjectPath("../etc", "b/../..", "asset:../../x?y=1", "image/png");
    expect(p).not.toContain("..");
    expect(p.split("/")).toHaveLength(3);
    for (const seg of p.split("/").slice(0, 2)) expect(seg).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(p.endsWith(".png")).toBe(true);
    expect(assetObjectPath(uid, board, "asset:has space%", "image/gif")).toBe(`${uid}/${board}/has_space.gif`);
  });

  it("refuses missing ids", () => {
    expect(() => assetObjectPath("", board, "asset:a", "image/png")).toThrow();
    expect(() => assetObjectPath(uid, "", "asset:a", "image/png")).toThrow();
    expect(() => assetObjectPath(uid, board, "", "image/png")).toThrow();
  });
});

describe("findInlineAssets", () => {
  it("finds only data: asset records in a TLStoreSnapshot", () => {
    const found = findInlineAssets(storeSnapshot());
    const ids = found.map((a) => a.id).sort();
    expect(ids).toEqual(["asset:inline", "asset:svg"]);
    const inline = found.find((a) => a.id === "asset:inline") as InlineAsset;
    expect(inline.src).toBe(PNG_URL);
    expect(inline.mimeType).toBe("image/png");
    expect(inline.name).toBe("inline.png");
    expect(inline.bytes).toBe(70);
    const svg = found.find((a) => a.id === "asset:svg") as InlineAsset;
    expect(svg.mimeType).toBe("image/svg+xml");
    expect(svg.name).toBe("logo.svg");
  });

  it("finds the same assets inside a TLEditorSnapshot", () => {
    expect(findInlineAssets(editorSnapshot()).map((a) => a.id).sort()).toEqual(["asset:inline", "asset:svg"]);
  });

  it("ignores https srcs, non-asset records and junk input", () => {
    const snap = storeSnapshot();
    expect(findInlineAssets(snap).some((a) => a.id === "asset:remote")).toBe(false);
    expect(findInlineAssets(snap).some((a) => a.id === "shape:1")).toBe(false);
    expect(findInlineAssets({})).toEqual([]);
    expect(findInlineAssets(null)).toEqual([]);
    expect(findInlineAssets("nope")).toEqual([]);
    expect(findInlineAssets({ store: { "asset:x": { typeName: "asset", props: {} } } })).toEqual([]);
    expect(findInlineAssets({ store: { "asset:x": null } })).toEqual([]);
  });

  it("falls back to props.mimeType and bytes 0 when the payload cannot be decoded", () => {
    const snap = { store: { "asset:bad": assetRecord("asset:bad", "data:image/png;base64,!!!") }, schema: {} };
    expect(findInlineAssets(snap)).toEqual([
      { id: "asset:bad", src: "data:image/png;base64,!!!", mimeType: "image/png", name: "bad.png", bytes: 0 },
    ]);
  });
});

describe("rewriteAssetSrcs", () => {
  it("is pure and preserves the identity of untouched records (store shape)", () => {
    const snap = storeSnapshot();
    const before = JSON.stringify(snap);
    const next = rewriteAssetSrcs(snap, { "asset:inline": "https://x/u/b/inline.png" });
    expect(JSON.stringify(snap)).toBe(before);
    expect(next).not.toBe(snap);
    expect(next.store).not.toBe(snap.store);
    expect(next.store["asset:inline"].props.src).toBe("https://x/u/b/inline.png");
    expect(next.store["asset:inline"]).not.toBe(snap.store["asset:inline"]);
    expect(next.store["asset:inline"].meta).toBe(snap.store["asset:inline"].meta);
    expect(next.store["asset:remote"]).toBe(snap.store["asset:remote"]);
    expect(next.store["asset:svg"]).toBe(snap.store["asset:svg"]);
    expect(next.store["shape:1"]).toBe(snap.store["shape:1"]);
    expect(next.schema).toBe(snap.schema);
    expect(findInlineAssets(next).map((a) => a.id)).toEqual(["asset:svg"]);
  });

  it("handles the editor shape and keeps session by identity", () => {
    const snap = editorSnapshot();
    const next = rewriteAssetSrcs(snap, { "asset:inline": "https://x/1.png", "asset:svg": "https://x/2.svg" });
    expect(next.session).toBe(snap.session);
    expect(next.document.schema).toBe(snap.document.schema);
    expect(next.document.store["asset:inline"].props.src).toBe("https://x/1.png");
    expect(next.document.store["asset:svg"].props.src).toBe("https://x/2.svg");
    expect(next.document.store["shape:1"]).toBe(snap.document.store["shape:1"]);
    expect(findInlineAssets(next)).toEqual([]);
    expect(findInlineAssets(snap)).toHaveLength(2);
  });

  it("returns the same object when nothing changes and ignores unknown ids and non-assets", () => {
    const snap = storeSnapshot();
    expect(rewriteAssetSrcs(snap, {})).toBe(snap);
    expect(rewriteAssetSrcs(snap, { "asset:nope": "https://x" })).toBe(snap);
    expect(rewriteAssetSrcs(snap, { "shape:1": "https://x" })).toBe(snap);
    expect(rewriteAssetSrcs(snap, { "asset:remote": "https://cdn.example.com/x.png" })).toBe(snap);
    expect(rewriteAssetSrcs(null, { a: "b" })).toBeNull();
  });
});

describe("snapshotJsonBytes", () => {
  it("counts UTF-8 bytes, not characters", () => {
    expect(snapshotJsonBytes({ a: "x" })).toBe(JSON.stringify({ a: "x" }).length);
    expect(snapshotJsonBytes({ a: "é" })).toBe(JSON.stringify({ a: "é" }).length + 1);
    expect(snapshotJsonBytes({ a: "😀" })).toBe(JSON.stringify({ a: "😀" }).length + 2);
    expect(snapshotJsonBytes(undefined)).toBe(0);
  });

  it("shrinks after rewriting an inline asset", () => {
    const snap = storeSnapshot();
    const next = rewriteAssetSrcs(snap, { "asset:inline": "https://x/i.png", "asset:svg": "https://x/s.svg" });
    expect(snapshotJsonBytes(next)).toBeLessThan(snapshotJsonBytes(snap));
  });
});

describe("SNAPSHOT_LIMITS", () => {
  it("is ordered soft < hard < db and db is under the 8 MiB constraint", () => {
    expect(SNAPSHOT_LIMITS.softBytes).toBeLessThan(SNAPSHOT_LIMITS.hardBytes);
    expect(SNAPSHOT_LIMITS.hardBytes).toBeLessThan(SNAPSHOT_LIMITS.dbBytes);
    expect(SNAPSHOT_LIMITS.dbBytes).toBeLessThanOrEqual(8388608);
    expect(Object.isFrozen(SNAPSHOT_LIMITS)).toBe(true);
  });
});
