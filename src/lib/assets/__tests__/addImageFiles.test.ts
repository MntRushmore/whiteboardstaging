import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AssetRecordType,
  createTLStore,
  defaultBindingUtils,
  defaultShapeUtils,
  Editor,
  loadSnapshot,
  type TLAsset,
  type TLAssetStore,
  type TLImageAsset,
  type TLImageShape,
} from "tldraw";
import { ADD_IMAGE_COPY, addImageFiles } from "../addImageFiles";

/**
 * A real tldraw Editor, headless in node: the DOM it touches while constructing (text measurement,
 * container bounds) is an anything-goes stub. The asset store is the part under test: one that
 * fails (N8: a failed upload used to leave a broken image shape that was then saved).
 */
function stub(values: Record<string | symbol, unknown> = {}): unknown {
  const fn = () => proxy;
  const proxy: unknown = new Proxy(fn, {
    get: (_t, key) => {
      if (key in values) return values[key];
      if (key === Symbol.toPrimitive) return () => 0;
      if (key === "getBoundingClientRect") return () => ({ x: 0, y: 0, top: 0, left: 0, width: 1080, height: 720, bottom: 720, right: 1080 });
      if (key === "then") return undefined;
      return proxy;
    },
    apply: () => proxy,
    set: () => true,
  });
  return proxy;
}

function makeEditor(assets: TLAssetStore): Editor {
  const store = createTLStore({ shapeUtils: defaultShapeUtils, bindingUtils: defaultBindingUtils, assets });
  loadSnapshot(store, { store: {}, schema: store.schema.serialize() });
  const editor = new Editor({ store, shapeUtils: defaultShapeUtils, bindingUtils: defaultBindingUtils, tools: [], getContainer: () => stub() as HTMLElement });
  // tldraw's default `file` asset handler, minus the image decoding: the store uploads the file.
  editor.registerExternalAssetHandler("file", async ({ file, assetId }) => {
    const asset = placeholder(file, assetId);
    const { src } = await editor.uploadAsset(asset, file);
    return { ...asset, props: { ...asset.props, src } } as TLAsset;
  });
  return editor;
}

/** What getAssetInfo makes of a file: an image asset with no src, its id from the bytes. */
function placeholder(file: File, id = AssetRecordType.createId(file.name)): TLImageAsset {
  return {
    id,
    typeName: "asset",
    type: "image",
    props: { name: file.name, src: null, w: 40, h: 30, fileSize: file.size, mimeType: file.type, isAnimated: false },
    meta: {},
  } as TLImageAsset;
}

const png = (name: string) => new File([new Uint8Array([137, 80, 78, 71, name.length])], name, { type: "image/png" });

const images = (editor: Editor) => editor.getCurrentPageShapes().filter((s): s is TLImageShape => s.type === "image");

describe("addImageFiles (pasted / dropped pictures)", () => {
  let editor: Editor | null = null;
  beforeEach(() => {
    vi.stubGlobal("document", stub());
    vi.stubGlobal(
      "window",
      stub({ devicePixelRatio: 1, innerWidth: 1080, innerHeight: 720, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), navigator: { userAgent: "node", maxTouchPoints: 0 } }),
    );
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => setTimeout(cb, 16));
    vi.stubGlobal("cancelAnimationFrame", (h: ReturnType<typeof setTimeout>) => clearTimeout(h));
  });
  afterEach(() => {
    editor?.dispose();
    editor = null;
    vi.unstubAllGlobals();
  });

  it("a failed upload leaves no image shape and no asset behind, and the student is told", async () => {
    const upload = vi.fn(async () => {
      throw new Error("Asset upload failed: 500");
    });
    editor = makeEditor({ upload, resolve: (a) => a.props.src, remove: vi.fn(async () => {}) });
    const notify = vi.fn();
    let shownWhileUploading = 0;
    upload.mockImplementationOnce(async () => {
      shownWhileUploading = images(editor!).length; // the picture shows while it uploads
      throw new Error("Asset upload failed: 500");
    });

    await addImageFiles(editor, { files: [png("photo.png")] }, { notify, assetInfo: async (f) => placeholder(f) });

    expect(upload).toHaveBeenCalledTimes(1);
    expect(shownWhileUploading).toBe(1);
    expect(images(editor)).toEqual([]);
    expect(editor.getAssets()).toEqual([]);
    expect(notify).toHaveBeenCalledWith(ADD_IMAGE_COPY.failed);
    // and undo does not bring the broken picture back (redo right after that undo would: see dropFailed)
    editor.undo();
    expect(images(editor)).toEqual([]);
  });

  it("a successful upload keeps the shape with the uploaded URL", async () => {
    editor = makeEditor({ upload: async () => ({ src: "https://x.supabase.co/storage/v1/object/public/board-assets/u/b/a.png" }), resolve: (a) => a.props.src });
    const notify = vi.fn();
    await addImageFiles(editor, { files: [png("ok.png")] }, { notify, assetInfo: async (f) => placeholder(f) });
    const [shape] = images(editor);
    expect(shape).toBeTruthy();
    expect(editor.getAsset(shape.props.assetId!)?.props.src).toMatch(/^https:/);
    expect(notify).not.toHaveBeenCalled();
  });

  it("of two pictures, only the one that failed is removed (one message)", async () => {
    editor = makeEditor({
      upload: async (asset) => {
        if ((asset as TLImageAsset).props.name === "bad.png") throw new Error("Asset upload failed: 413");
        return { src: "https://x/good.png" };
      },
      resolve: (a) => a.props.src,
    });
    const notify = vi.fn();
    await addImageFiles(editor, { files: [png("good.png"), png("bad.png")] }, { notify, assetInfo: async (f) => placeholder(f) });
    expect(images(editor).map((s) => (editor!.getAsset(s.props.assetId!) as TLImageAsset | undefined)?.props.name)).toEqual(["good.png"]);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("refuses what the bucket would refuse before creating anything", async () => {
    const upload = vi.fn(async () => ({ src: "https://x/never" }));
    editor = makeEditor({ upload, resolve: (a) => a.props.src });
    const notify = vi.fn();
    const pdf = new File([new Uint8Array([1])], "notes.pdf", { type: "application/pdf" });
    const huge = new File([new Uint8Array(11 * 1024 * 1024)], "huge.png", { type: "image/png" });
    await addImageFiles(editor, { files: [pdf, huge] }, { notify, assetInfo: async (f) => placeholder(f) });
    expect(notify.mock.calls.map((c) => c[0])).toEqual([ADD_IMAGE_COPY.notAnImage, ADD_IMAGE_COPY.tooBig]);
    expect(upload).not.toHaveBeenCalled();
    expect(images(editor)).toEqual([]);
  });

  it("keeps a picture whose failed paste reused an asset another paste uploaded", async () => {
    let calls = 0;
    editor = makeEditor({
      upload: async () => {
        if (++calls === 2) throw new Error("Asset upload failed: network");
        return { src: "https://x/same.png" };
      },
      resolve: (a) => a.props.src,
    });
    const notify = vi.fn();
    const same = png("same.png");
    await addImageFiles(editor, { files: [same] }, { notify, assetInfo: async (f) => placeholder(f) });
    await addImageFiles(editor, { files: [same] }, { notify, assetInfo: async (f) => placeholder(f) }); // same bytes, same asset id
    expect(images(editor)).toHaveLength(2); // both show the uploaded picture
    expect(editor.getAssets()).toHaveLength(1);
    expect(notify).not.toHaveBeenCalled(); // nothing was lost
  });
});
