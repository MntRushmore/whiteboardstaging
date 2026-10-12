import { describe, expect, it, vi } from "vitest";
import { Box, type TLPage, type TLShape, type TLShapeId } from "tldraw";
import { createFakeEditor, type FakeEditor } from "../../__fixtures__/fakeEditor";
import { drawShapeFromPoints, nextShapeId } from "../../__fixtures__/strokes";
import { DEFAULT_SCREEN } from "@/lib/screens/screens";
import {
  ASK_IMAGE,
  ASK_IMAGE_LADDER,
  askImage,
  askImageSize,
  askImageWanted,
  askScene,
  askShapeRole,
  captureAskImage,
  dataUrlChars,
  fitAskImage,
  type AskCanvas,
  type AskContext,
  type AskFitStep,
  type AskImageDeps,
  type AskImageEditor,
  type AskShapeInfo,
} from "../boardImage";
import { AskImageSchema } from "../contracts";

/**
 * Ask's picture of the screen (docs/ASK-V2.md, "vision"): sent only when the screen holds something
 * the LaTeX cannot say, made from tldraw's SVG on a white canvas (the strokes drawn by hand when the
 * export fails or hangs, as on iPads), stepped down until it fits the request, and never thrown.
 */

const live = (extra: Record<string, unknown> = {}) => ({ live: true, source: "ai", lineId: "chat", createdAt: 1, ...extra });

describe("askShapeRole / askImageWanted: a picture only when the LaTeX cannot say it all", () => {
  const studentInk: AskShapeInfo = { type: "draw", meta: {}, opacity: 1 };
  const tutorProblem: AskShapeInfo = { type: "draw", meta: live({ chatProblem: { n: 1, lines: ["2x+3=7"], cell: { x: 0, y: 0, w: 10, h: 10 } }, handLine: "2x+3=7" }) };
  const tutorLine: AskShapeInfo = { type: "draw", meta: live({ handLine: "x = 2" }) };
  const tutorTyped: AskShapeInfo = { type: "math", meta: live() };
  const echo: AskShapeInfo = { type: "math", meta: { ...live(), source: "echo" } };
  const mark: AskShapeInfo = { type: "draw", meta: live({ mark: "line-1:check" }) };

  it("an empty screen, or one with only the tutor's own problems and lines, sends none", () => {
    expect(askImageWanted([])).toBe(false);
    expect(askImageWanted([tutorProblem])).toBe(false);
    expect(askImageWanted([tutorProblem, tutorLine, tutorTyped])).toBe(false);
    expect(askShapeRole(echo)).toBe("said");
    expect(askShapeRole(mark)).toBe("said");
  });

  it("any of the student's ink sends one (the reader may have got it wrong)", () => {
    expect(askImageWanted([tutorProblem, studentInk])).toBe(true);
    expect(askShapeRole(studentInk)).toBe("unsaid");
  });

  it("a photo, a PDF page or a shape of the student's sends one", () => {
    expect(askImageWanted([{ type: "image", meta: {} }])).toBe(true);
    expect(askImageWanted([{ type: "image", meta: { isProtected: true, kind: "pdf", fileName: "sheet.pdf", page: 1 } }])).toBe(true);
    expect(askImageWanted([{ type: "geo", meta: {} }])).toBe(true);
    // a line the student typed is no ink line: it is not in the LaTeX
    expect(askImageWanted([{ type: "math", meta: {} }])).toBe(true);
  });

  it("the tutor's graphs, figures and lecture sketches send one (the LaTeX leaves them out)", () => {
    expect(askImageWanted([{ type: "draw", meta: live({ handLine: "", graphFor: "y=2x" }) }])).toBe(true);
    expect(askImageWanted([{ type: "draw", meta: live({ handLine: "A", chatBlock: "figure" }) }])).toBe(true);
    expect(askImageWanted([{ type: "draw", meta: live({ handLine: "", chatBlock: "graph" }) }])).toBe(true);
    expect(askImageWanted([{ type: "draw", meta: live({ handLine: "cell", lectureBlock: "diagram" }) }])).toBe(true);
    expect(askImageWanted([{ type: "draw", meta: live({ proofFigure: "f1" }) }])).toBe(true);
    expect(askImageWanted([{ type: "graph", meta: live() }])).toBe(true);
  });

  it("a shape of the tutor's it does not know sends one: the safe side of the doubt", () => {
    expect(askShapeRole({ type: "draw", meta: live() })).toBe("unsaid");
  });

  it("stickers and shapes hidden on the board are not in the picture, and send none", () => {
    const sticker: AskShapeInfo = { type: "image", meta: { isProtected: true, kind: "sticker", stickerId: "star" } };
    expect(askShapeRole(sticker)).toBe("hidden");
    expect(askImageWanted([sticker, tutorProblem])).toBe(false);
    expect(askImageWanted([{ ...studentInk, opacity: 0 }])).toBe(false);
  });
});

describe("fitAskImage: quality first, then size, until the data URL fits", () => {
  const blob = (bytes: number, type = "image/jpeg") => new Blob([new Uint8Array(bytes)], { type });

  it("counts a data URL's characters as the contract does", () => {
    expect(dataUrlChars("image/jpeg", 3)).toBe("data:image/jpeg;base64,".length + 4);
    expect(dataUrlChars("image/jpeg", 4)).toBe("data:image/jpeg;base64,".length + 8);
  });

  it("the first step when it fits: full size, quality 0.82, JPEG", async () => {
    const encode = vi.fn(async () => blob(50_000));
    expect((await fitAskImage(encode))?.size).toBe(50_000);
    expect(encode.mock.calls).toEqual([[{ scale: 1, quality: 0.82 }, "image/jpeg"]]);
  });

  it("steps the quality down, then the size, and stops at the first that fits", async () => {
    const sizes = [900_000, 700_000, 600_000, 400_000];
    const encode = vi.fn<(step: AskFitStep) => Promise<Blob>>(async () => blob(sizes.shift()!));
    const out = await fitAskImage(encode, { maxChars: 700_000 });
    expect(out?.size).toBe(400_000);
    expect(encode.mock.calls.map(([s]) => s)).toEqual(ASK_IMAGE_LADDER.slice(0, 4));
  });

  it("null when nothing fits, or when the canvas answers nothing (iOS)", async () => {
    const big = vi.fn(async () => blob(2_000_000));
    expect(await fitAskImage(big)).toBeNull();
    expect(big).toHaveBeenCalledTimes(ASK_IMAGE_LADDER.length);
    const none = vi.fn(async () => null);
    expect(await fitAskImage(none)).toBeNull();
    expect(none).toHaveBeenCalledTimes(1);
  });

  it("WebP when the browser really makes it and it is smaller; Safari's PNG answer is not WebP", async () => {
    const real = vi.fn(async (_s: unknown, type: string) => (type === "image/webp" ? blob(30_000, "image/webp") : blob(50_000)));
    expect((await fitAskImage(real, { webp: true }))?.type).toBe("image/webp");
    const safari = vi.fn(async (_s: unknown, type: string) => (type === "image/webp" ? blob(20_000, "image/png") : blob(50_000)));
    expect((await fitAskImage(safari, { webp: true }))?.type).toBe("image/jpeg");
    const bigger = vi.fn(async (_s: unknown, type: string) => (type === "image/webp" ? blob(60_000, "image/webp") : blob(50_000)));
    expect((await fitAskImage(bigger, { webp: true }))?.type).toBe("image/jpeg");
  });
});

// ------------------------------------------------------------------ the capture, with a fake browser

/** A canvas whose 2D calls are recorded and whose toBlob answers `sizes` in turn (-1: null; "throw": a tainted canvas). */
function fakeBrowser(o: { sizes?: Array<number | "throw">; safari?: boolean; canvas?: boolean; loadImage?: AskImageDeps["loadImage"]; taintedBy?: object } = {}) {
  const ops: string[] = [];
  const canvases: Array<{ w: number; h: number; released: boolean }> = [];
  const sizes = [...(o.sizes ?? [40_000])];
  let drewTaint = false;
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get(target, key) {
      if (key in target) return target[key];
      return (...args: unknown[]) => {
        if (key === "drawImage" && o.taintedBy && args[0] === o.taintedBy) drewTaint = true;
        ops.push(`${String(key)} ${args.map((a) => (typeof a === "number" ? Math.round(a * 10) / 10 : typeof a === "object" ? "img" : String(a))).join(",")}`);
      };
    },
    set(target, key, v) {
      target[key] = v;
      return true;
    },
  }) as unknown as AskContext;
  const deps: AskImageDeps = {
    now: () => performance.now(),
    createCanvas: () => {
      if (o.canvas === false) return null;
      const entry = { w: 0, h: 0, released: false };
      canvases.push(entry);
      let width = 0;
      let height = 0;
      const canvas: AskCanvas = {
        get width() {
          return width;
        },
        set width(v: number) {
          width = v;
          if (v > 0) entry.w = v;
          else entry.released = true;
        },
        get height() {
          return height;
        },
        set height(v: number) {
          height = v;
          if (v > 0) entry.h = v;
        },
        getContext: () => ctx,
        toBlob: (cb, type) => {
          const size = sizes.length > 1 ? sizes.shift()! : sizes[0];
          if (size === "throw" || (o.taintedBy && drewTaint)) {
            drewTaint = false;
            throw new DOMException("The canvas has been tainted by cross-origin data.", "SecurityError");
          }
          queueMicrotask(() => cb(size < 0 ? null : new Blob([new Uint8Array(size)], { type })));
        },
      };
      return canvas;
    },
    loadImage: o.loadImage ?? (async () => ({}) as CanvasImageSource),
    isSafari: () => o.safari ?? false,
    webp: false,
  };
  return { ops, canvases, deps };
}

const STROKE_A = [
  { x: 200, y: 200 },
  { x: 260, y: 260 },
  { x: 320, y: 200 },
];

function boardWith(shapes: TLShape[], svg: AskImageEditor["getSvgString"] = vi.fn(async () => ({ svg: "<svg/>", width: 10, height: 10 }))) {
  const editor = createFakeEditor();
  const page = editor.getCurrentPage();
  editor.store.put([{ ...page, meta: { screen: { ...DEFAULT_SCREEN } } } as TLPage]);
  editor.putUser(shapes);
  return Object.assign(editor, { getSvgString: svg }) as FakeEditor & AskImageEditor & { getSvgString: ReturnType<typeof vi.fn> };
}

describe("askScene / askImageSize: what is on the screen, cropped", () => {
  it("nothing on the screen: no scene", () => {
    expect(askScene(boardWith([]))).toBeNull();
    // off the screen (a page from before screens can hold ink past the frame): not seen
    expect(askScene(boardWith([drawShapeFromPoints([{ x: 2000, y: 2000 }, { x: 2100, y: 2050 }])]))).toBeNull();
  });

  it("the content's bounds, padded and kept inside the screen", () => {
    const scene = askScene(boardWith([drawShapeFromPoints(STROKE_A), drawShapeFromPoints([{ x: 5, y: 880 }, { x: 40, y: 899 }])]))!;
    expect(scene.shapes).toHaveLength(2);
    // left and bottom pads are cut at the screen's edge
    expect(scene.bounds).toEqual({ x: 0, y: 200 - ASK_IMAGE.pad, w: 320 + ASK_IMAGE.pad, h: 900 - (200 - ASK_IMAGE.pad) });
  });

  it("at most 1024 px on the long side, blown up at most 2x", () => {
    expect(askImageSize({ x: 0, y: 0, w: 1600, h: 900 })).toEqual({ scale: 0.64, w: 1024, h: 576 });
    expect(askImageSize({ x: 0, y: 0, w: 200, h: 80 })).toEqual({ scale: 2, w: 400, h: 160 });
    expect(askImageSize({ x: 0, y: 0, w: 300, h: 1200 })).toEqual({ scale: 1024 / 1200, w: 256, h: 1024 });
  });
});

describe("captureAskImage", () => {
  it("an empty screen: null, and nothing exported", async () => {
    const editor = boardWith([]);
    const { deps } = fakeBrowser();
    expect(await captureAskImage(editor, {}, deps)).toBeNull();
    expect(editor.getSvgString).not.toHaveBeenCalled();
  });

  it("tldraw's SVG of the screen's shapes on a white canvas, as a JPEG data URL the contract takes", async () => {
    const ink = drawShapeFromPoints(STROKE_A);
    const editor = boardWith([ink]);
    const { deps, ops, canvases } = fakeBrowser();
    const url = await captureAskImage(editor, {}, deps);
    expect(url).toMatch(/^data:image\/jpeg;base64,/);
    expect(AskImageSchema.safeParse(url).success).toBe(true);
    const [ids, opts] = editor.getSvgString.mock.calls[0] as [TLShapeId[], Record<string, unknown>];
    expect(ids).toEqual([ink.id]);
    expect(opts).toMatchObject({ scale: 2, padding: 0, background: false, darkMode: false, pixelRatio: 1 });
    expect(opts.bounds).toBeInstanceOf(Box);
    expect(opts.bounds).toMatchObject({ x: 184, y: 184, w: 152, h: 92 });
    // white first, then the SVG over it, at the picture's size; the canvas is given back
    expect(ops.slice(0, 2)).toEqual(["fillRect 0,0,304,184", "drawImage img,0,0,304,184"]);
    expect(canvases).toEqual([{ w: 304, h: 184, released: true }]);
  });

  it("stickers and hidden shapes are left out of the export", async () => {
    const ink = drawShapeFromPoints(STROKE_A);
    const sticker = { ...drawShapeFromPoints([{ x: 900, y: 600 }, { x: 950, y: 650 }]), meta: { isProtected: true, kind: "sticker" } } as TLShape;
    const hidden = { ...drawShapeFromPoints([{ x: 50, y: 50 }, { x: 80, y: 80 }]), opacity: 0 } as TLShape;
    const editor = boardWith([ink, sticker, hidden]);
    await captureAskImage(editor, {}, fakeBrowser().deps);
    expect(editor.getSvgString.mock.calls[0][0]).toEqual([ink.id]);
  });

  it("an export that fails: the strokes drawn by hand", async () => {
    const editor = boardWith([drawShapeFromPoints(STROKE_A)], vi.fn(async () => Promise.reject(new Error("Could not create SVG"))));
    const { deps, ops } = fakeBrowser();
    const url = await captureAskImage(editor, {}, deps);
    expect(AskImageSchema.safeParse(url).success).toBe(true);
    expect(ops).toContain("fillRect 0,0,304,184");
    expect(ops.filter((op) => op.startsWith("lineTo"))).toHaveLength(2);
    expect(ops.at(-1)).toBe("setTransform 1,0,0,1,0,0");
  });

  it("an export that hangs (WebKit): the strokes drawn by hand before the deadline", async () => {
    const editor = boardWith([drawShapeFromPoints(STROKE_A)], vi.fn(() => new Promise<never>(() => {})));
    const { deps, ops } = fakeBrowser();
    const t0 = performance.now();
    const url = await captureAskImage(editor, { timeoutMs: 500 }, deps);
    expect(AskImageSchema.safeParse(url).success).toBe(true);
    expect(performance.now() - t0).toBeLessThan(500);
    expect(ops.some((op) => op.startsWith("lineTo"))).toBe(true);
  });

  it("never throws, and answers null in time when nothing works", async () => {
    const hang = boardWith([drawShapeFromPoints(STROKE_A)], vi.fn(() => new Promise<never>(() => {})));
    const t0 = performance.now();
    expect(await captureAskImage(hang, { timeoutMs: 400 }, fakeBrowser({ canvas: false }).deps)).toBeNull();
    expect(performance.now() - t0).toBeLessThan(600);
    // toBlob answers null (iOS), in the export and by hand
    expect(await captureAskImage(boardWith([drawShapeFromPoints(STROKE_A)]), {}, fakeBrowser({ sizes: [-1] }).deps)).toBeNull();
    // an editor that throws
    const broken = { ...boardWith([]), getCurrentPageShapes: () => { throw new Error("gone"); } } as unknown as AskImageEditor;
    expect(await captureAskImage(broken, {}, fakeBrowser().deps)).toBeNull();
  });

  it("a picture that taints the canvas: drawn again with the ink alone", async () => {
    const photo = { id: nextShapeId(), typeName: "shape", type: "image", x: 400, y: 100, rotation: 0, index: "a1", parentId: "page:page", isLocked: false, opacity: 1, meta: {}, props: { w: 200, h: 150, assetId: "asset:photo", playing: true, url: "", crop: null, flipX: false, flipY: false, altText: "" } } as unknown as TLShape;
    const img = { photo: true };
    const editor = Object.assign(boardWith([drawShapeFromPoints(STROKE_A), photo], vi.fn(async () => Promise.reject(new Error("no svg")))), {
      resolveAssetUrl: vi.fn(async () => "https://storage.example/photo.png"),
    });
    const { deps, ops } = fakeBrowser({ taintedBy: img, loadImage: async () => img as unknown as CanvasImageSource });
    const url = await captureAskImage(editor, {}, deps);
    expect(AskImageSchema.safeParse(url).success).toBe(true);
    expect(editor.resolveAssetUrl).toHaveBeenCalledWith("asset:photo", { shouldResolveToOriginal: true });
    // drawn twice: with the photo (refused), then the ink alone
    expect(ops.filter((op) => op.startsWith("drawImage img,0,0,200,150"))).toHaveLength(1);
    expect(ops.filter((op) => op.startsWith("fillRect")).length).toBe(2);
  });

  it("too big at every step: null", async () => {
    expect(await captureAskImage(boardWith([drawShapeFromPoints(STROKE_A)]), {}, fakeBrowser({ sizes: [2_000_000] }).deps)).toBeNull();
  });
});

describe("askImage: the policy, then the capture", () => {
  it("no capture for an empty screen or the tutor's problems alone; the student's ink is captured", async () => {
    const capture = vi.fn(async () => "data:image/jpeg;base64,AAAA");
    expect(await askImage(boardWith([]), capture)).toBeNull();
    const problem = { ...drawShapeFromPoints(STROKE_A), meta: live({ chatProblem: { n: 1, lines: ["2x+3=7"], cell: { x: 0, y: 0, w: 10, h: 10 } }, handLine: "2x+3=7" }) } as TLShape;
    expect(await askImage(boardWith([problem]), capture)).toBeNull();
    expect(capture).not.toHaveBeenCalled();
    expect(await askImage(boardWith([problem, drawShapeFromPoints([{ x: 400, y: 400 }, { x: 460, y: 420 }])]), capture)).toBe("data:image/jpeg;base64,AAAA");
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it("never throws", async () => {
    const broken = { ...boardWith([]), getCurrentPageShapes: () => { throw new Error("gone"); } } as unknown as AskImageEditor;
    expect(await askImage(broken)).toBeNull();
    const failing = vi.fn(async () => Promise.reject(new Error("canvas gone")));
    expect(await askImage(boardWith([drawShapeFromPoints(STROKE_A)]), failing)).toBeNull();
  });
});
