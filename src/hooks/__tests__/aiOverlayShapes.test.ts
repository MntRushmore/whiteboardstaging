import { describe, expect, it } from "vitest";
import { createShapeId, type IndexKey, type TLPageId, type TLShape, type TLShapeId } from "tldraw";
import {
  aiOverlayMeta,
  isAiOverlayShape,
  overlayIndexBelowLive,
  partitionAiOverlays,
  sameOverlayIds,
  type ZOrderReader,
} from "../useAiOverlayShapes";

function shape(type: string, index: string, meta: TLShape["meta"] = {}): TLShape {
  return {
    id: createShapeId(),
    typeName: "shape",
    type,
    x: 0,
    y: 0,
    rotation: 0,
    index: index as IndexKey,
    parentId: "page:p",
    isLocked: false,
    opacity: 1,
    meta,
    props: {},
  } as unknown as TLShape;
}

const liveMeta = { live: true, source: "echo", lineId: "ln_1", createdAt: 1 } as const;

describe("aiOverlayMeta / isAiOverlayShape", () => {
  it("stamps and recognises overlays", () => {
    expect(aiOverlayMeta("suggest")).toEqual({ aiOverlay: true, mode: "suggest" });
    expect(isAiOverlayShape({ meta: aiOverlayMeta("feedback") })).toBe(true);
    expect(isAiOverlayShape({ meta: {} })).toBe(false);
    expect(isAiOverlayShape({ meta: { aiOverlay: "yes" } })).toBe(false);
  });
});

describe("partitionAiOverlays", () => {
  it("splits feedback overlays from pending suggest/answer overlays, oldest first", () => {
    const fb1 = shape("image", "a2", aiOverlayMeta("feedback"));
    const sg = shape("image", "a3", aiOverlayMeta("suggest"));
    const fb2 = shape("image", "a1", aiOverlayMeta("feedback"));
    const an = shape("image", "a4", aiOverlayMeta("answer"));
    const accepted = shape("image", "a5", { ...aiOverlayMeta("suggest"), accepted: true });
    const plain = shape("image", "a6");
    const echo = shape("math", "a7", { ...liveMeta });
    const notImage = shape("geo", "a8", aiOverlayMeta("feedback"));

    const out = partitionAiOverlays([fb1, sg, fb2, an, accepted, plain, echo, notImage]);
    expect(out.feedback).toEqual([fb2.id, fb1.id]);
    expect(out.pending).toEqual([sg.id, an.id]);
  });

  it("returns empty lists when there are no overlays", () => {
    expect(partitionAiOverlays([shape("draw", "a1")])).toEqual({ feedback: [], pending: [] });
  });
});

describe("sameOverlayIds", () => {
  it("compares id lists positionally", () => {
    const a = createShapeId();
    const b = createShapeId();
    expect(sameOverlayIds({ feedback: [a], pending: [b] }, { feedback: [a], pending: [b] })).toBe(true);
    expect(sameOverlayIds({ feedback: [a], pending: [] }, { feedback: [], pending: [a] })).toBe(false);
    expect(sameOverlayIds({ feedback: [a, b], pending: [] }, { feedback: [b, a], pending: [] })).toBe(false);
  });
});

describe("overlayIndexBelowLive", () => {
  function reader(shapes: TLShape[]): ZOrderReader {
    const sorted = [...shapes].sort((x, y) => (x.index < y.index ? -1 : 1));
    const byId = new Map<TLShapeId, TLShape>(shapes.map((s) => [s.id, s]));
    return {
      getCurrentPageId: () => "page:p" as TLPageId,
      getSortedChildIdsForParent: () => sorted.map((s) => s.id),
      getShape: (id) => byId.get(id),
    };
  }

  it("returns undefined when the page has no Live shapes", () => {
    expect(overlayIndexBelowLive(reader([shape("draw", "a1"), shape("image", "a2")]))).toBeUndefined();
  });

  it("returns an index strictly between the shape below and the lowest Live shape", () => {
    const ink = shape("draw", "a1");
    const echo = shape("math", "a3", { ...liveMeta });
    const graph = shape("graph", "a2", { ...liveMeta });
    const idx = overlayIndexBelowLive(reader([ink, echo, graph]));
    expect(idx).toBeDefined();
    expect(idx! > ink.index).toBe(true);
    expect(idx! < graph.index).toBe(true);
  });

  it("goes below everything when the lowest shape is a Live shape", () => {
    const echo = shape("math", "a1", { ...liveMeta });
    const ink = shape("draw", "a2");
    const idx = overlayIndexBelowLive(reader([echo, ink]));
    expect(idx).toBeDefined();
    expect(idx! < echo.index).toBe(true);
  });
});
