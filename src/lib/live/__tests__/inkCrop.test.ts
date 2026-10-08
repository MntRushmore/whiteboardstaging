import { describe, expect, it, vi } from "vitest";
import { captureInkCrop, drawInk, type InkCanvas, type InkContext, type ToImage } from "../inkCrop";

/**
 * The crop the vision readers get, on every browser: tldraw's export first, a smaller export when
 * it is only too big, and the strokes drawn on a canvas of our own when the export fails (iPads:
 * the board asked for a crop and had none, so a line Mathpix could not read became "The tutor
 * service had a hiccup").
 */

const BOUNDS = { x: 100, y: 200, w: 300, h: 60 };
const STROKES = [
  [
    { x: 100, y: 200 },
    { x: 140, y: 260 },
  ],
  [{ x: 300, y: 230 }],
];

const blob = (bytes: number) => new Blob([new Uint8Array(bytes)], { type: "image/jpeg" });

/** A canvas that records what was drawn and answers toBlob with `bytes` per call (in order). */
function fakeCanvas(sizes: number[]) {
  const ops: string[] = [];
  const made: Array<{ w: number; h: number; quality: number; releasedTo: number }> = [];
  const ctx: InkContext = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    lineCap: "butt",
    lineJoin: "miter",
    fillRect: (x, y, w, h) => void ops.push(`fillRect ${x},${y},${w},${h}`),
    beginPath: () => void ops.push("begin"),
    moveTo: (x, y) => void ops.push(`move ${x.toFixed(1)},${y.toFixed(1)}`),
    lineTo: (x, y) => void ops.push(`line ${x.toFixed(1)},${y.toFixed(1)}`),
    arc: (x, y) => void ops.push(`dot ${x.toFixed(1)},${y.toFixed(1)}`),
    fill: () => void ops.push("fill"),
    stroke: () => void ops.push("stroke"),
  };
  const createCanvas = (): InkCanvas => {
    const entry = { w: 0, h: 0, quality: 0, releasedTo: -1 };
    made.push(entry);
    let width = 0;
    let height = 0;
    return {
      get width() {
        return width;
      },
      set width(v: number) {
        width = v;
        if (v > 0) entry.w = v;
        else entry.releasedTo = v;
      },
      get height() {
        return height;
      },
      set height(v: number) {
        height = v;
        if (v > 0) entry.h = v;
      },
      getContext: () => ctx,
      toBlob: (cb, _type, quality) => {
        entry.quality = quality;
        const size = sizes.length > 1 ? sizes.shift()! : sizes[0];
        queueMicrotask(() => cb(size < 0 ? null : blob(size)));
      },
    };
  };
  return { ops, made, createCanvas };
}

describe("captureInkCrop", () => {
  it("the board's own export, as before: jpeg at pixel ratio 2, quality 0.8, the bounds padded by 8", async () => {
    const toImage = vi.fn<ToImage>(async () => ({ blob: blob(5000) }));
    const res = await captureInkCrop({ toImage, strokes: () => STROKES, bounds: BOUNDS, maxWidth: 512, maxBytes: 200_000 });
    expect(res).toMatchObject({ ok: true, how: "export" });
    expect(toImage).toHaveBeenCalledTimes(1);
    expect(toImage.mock.calls[0][0]).toEqual({ format: "jpeg", quality: 0.8, background: true, padding: 8, bounds: { x: 92, y: 192, w: 316, h: 76 }, scale: 1, pixelRatio: 2 });
  });

  it("too big: a smaller export (pixel ratio 1, quality 0.6) before giving up on it", async () => {
    const toImage = vi.fn<ToImage>(async (o) => ({ blob: blob(o.pixelRatio === 2 ? 300_000 : 90_000) }));
    const res = await captureInkCrop({ toImage, strokes: () => STROKES, bounds: { ...BOUNDS, w: 1024 }, maxWidth: 512, maxBytes: 200_000 });
    expect(res).toMatchObject({ ok: true, how: "export-small", tried: ["export:big"] });
    expect(toImage.mock.calls[1][0]).toMatchObject({ pixelRatio: 1, quality: 0.6, scale: 0.5 });
  });

  it("the export failing (an iPad): the strokes drawn by hand, black on white, and the canvas given back", async () => {
    const toImage = vi.fn<ToImage>(async () => {
      throw new Error("Could not construct image.");
    });
    const canvas = fakeCanvas([4000]);
    const res = await captureInkCrop({ toImage, strokes: () => STROKES, bounds: BOUNDS, maxWidth: 512, maxBytes: 200_000, createCanvas: canvas.createCanvas });
    expect(res).toMatchObject({ ok: true, how: "drawn", tried: ["export:Could not construct image."] });
    // the export broke: not tried again smaller
    expect(toImage).toHaveBeenCalledTimes(1);
    expect(canvas.made).toEqual([{ w: 512, h: 123, quality: 0.8, releasedTo: 0 }]);
    // a white page, one stroke, and a dot for the one-point stroke
    expect(canvas.ops[0]).toBe("fillRect 0,0,512,123");
    expect(canvas.ops.filter((o) => o === "stroke")).toHaveLength(1);
    expect(canvas.ops.some((o) => o.startsWith("dot "))).toBe(true);
  });

  it("an export that never answers (WebKit can hang) fails after its deadline, and the strokes are drawn", async () => {
    vi.useFakeTimers();
    try {
      const toImage: ToImage = () => new Promise(() => {});
      const canvas = fakeCanvas([4000]);
      const pending = captureInkCrop({ toImage, strokes: () => STROKES, bounds: BOUNDS, maxWidth: 512, maxBytes: 200_000, createCanvas: canvas.createCanvas, attemptMs: 2000 });
      await vi.advanceTimersByTimeAsync(2001);
      expect(await pending).toMatchObject({ ok: true, how: "drawn", tried: ["export:no answer in 2000 ms"] });
    } finally {
      vi.useRealTimers();
    }
  });

  it("no export at all (no editor export): drawn; too big drawn: lower quality, then half the width", async () => {
    const canvas = fakeCanvas([300_000, 250_000, 9000]);
    const res = await captureInkCrop({ toImage: null, strokes: () => STROKES, bounds: BOUNDS, maxWidth: 512, maxBytes: 200_000, createCanvas: canvas.createCanvas });
    expect(res).toMatchObject({ ok: true, how: "drawn", tried: ["export:unavailable", "drawn:big", "drawn:big"] });
    expect(canvas.made.map((c) => [c.w, c.quality])).toEqual([
      [512, 0.8],
      [512, 0.5],
      [256, 0.5],
    ]);
  });

  it("nothing works (no DOM, a canvas that will not encode): not ok, with what was tried; never throws", async () => {
    const toImage = vi.fn<ToImage>(async () => null);
    expect(await captureInkCrop({ toImage, strokes: () => STROKES, bounds: BOUNDS, maxWidth: 512, maxBytes: 200_000, createCanvas: () => null })).toEqual({
      ok: false,
      tried: ["export:no image", "drawn:none"],
    });
    const refuses = fakeCanvas([-1]);
    expect(await captureInkCrop({ toImage: null, strokes: () => STROKES, bounds: BOUNDS, maxWidth: 512, maxBytes: 200_000, createCanvas: refuses.createCanvas })).toMatchObject({ ok: false });
    expect(await captureInkCrop({ toImage, strokes: () => STROKES, bounds: { ...BOUNDS, w: 0 }, maxWidth: 512, maxBytes: 200_000 })).toEqual({ ok: false, tried: ["no-bounds"] });
  });
});

describe("drawInk", () => {
  it("maps the padded bounds onto the canvas: the top-left of the ink lands 8 units in", () => {
    const canvas = fakeCanvas([1]);
    const ctx = canvas.createCanvas().getContext("2d")!;
    drawInk(ctx, [[{ x: 100, y: 200 }, { x: 400, y: 260 }]], BOUNDS, 316, 76);
    expect(canvas.ops).toEqual(["fillRect 0,0,316,76", "begin", "move 8.0,8.0", "line 308.0,68.0", "stroke"]);
  });
});
