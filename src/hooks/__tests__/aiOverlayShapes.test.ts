import { describe, expect, it } from "vitest";
import { createShapeId, type IndexKey, type TLPageId, type TLShape, type TLShapeId } from "tldraw";
import {
  aiOverlayMeta,
  dropPendingAiOverlays,
  isAiOverlayShape,
  overlayIndexBelowLive,
  partitionAiOverlays,
  sameOverlayIds,
  type OverlayWriter,
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

/**
 * BUG-5: a suggest/answer overlay the student never accepted used to come back on reload and
 * cover the canvas. Accept is what makes an overlay durable (`meta.accepted`); an undecided
 * proposal is dropped on load, which is the same outcome as Reject.
 */
describe("dropPendingAiOverlays", () => {
  function store(shapes: TLShape[]): OverlayWriter & { shapes: TLShape[]; unlocked: TLShapeId[] } {
    const state = {
      shapes: [...shapes],
      unlocked: [] as TLShapeId[],
      getCurrentPageShapeIds: () => state.shapes.map((s) => s.id),
      getShape: (id: TLShapeId) => state.shapes.find((s) => s.id === id),
      updateShapes: (partials: Array<{ id: TLShapeId; isLocked?: boolean }>) => {
        for (const p of partials) {
          if (p.isLocked === false) state.unlocked.push(p.id);
          state.shapes = state.shapes.map((s) => (s.id === p.id ? { ...s, isLocked: false } : s));
        }
      },
      deleteShapes: (ids: TLShapeId[]) => {
        state.shapes = state.shapes.filter((s) => !ids.includes(s.id));
      },
    };
    return state;
  }

  it("removes pending overlays (unlocking them first) and keeps everything else", () => {
    const ink = shape("draw", "a1");
    const worksheet = shape("image", "a2", { isProtected: true, kind: "worksheet" });
    const feedback = { ...shape("image", "a3", aiOverlayMeta("feedback")), isLocked: true };
    const accepted = { ...shape("image", "a4", { ...aiOverlayMeta("answer"), accepted: true }), isLocked: true };
    const pending = { ...shape("image", "a5", aiOverlayMeta("suggest")), isLocked: true };
    const s = store([ink, worksheet, feedback, accepted, pending]);

    expect(dropPendingAiOverlays(s)).toEqual([pending.id]);
    // locked shapes are not deletable: unlock first, exactly like Reject
    expect(s.unlocked).toEqual([pending.id]);
    expect(s.shapes.map((x) => x.id)).toEqual([ink.id, worksheet.id, feedback.id, accepted.id]);
  });

  it("removes every pending overlay when several piled up", () => {
    const first = shape("image", "a1", aiOverlayMeta("suggest"));
    const second = shape("image", "a2", aiOverlayMeta("answer"));
    const s = store([first, second]);
    expect(dropPendingAiOverlays(s)).toEqual([first.id, second.id]);
    expect(s.shapes).toEqual([]);
  });

  it("is a no-op (no writes) when nothing is pending", () => {
    const s = store([shape("draw", "a1"), shape("image", "a2", aiOverlayMeta("feedback"))]);
    expect(dropPendingAiOverlays(s)).toEqual([]);
    expect(s.unlocked).toEqual([]);
    expect(s.shapes).toHaveLength(2);
  });

  it("leaves nothing pending, so the Accept/Reject bar stays hidden after a reload", () => {
    const pending = shape("image", "a1", aiOverlayMeta("suggest"));
    const s = store([pending, shape("image", "a2", aiOverlayMeta("feedback"))]);
    dropPendingAiOverlays(s);
    const after = partitionAiOverlays(s.shapes);
    expect(after.pending).toEqual([]);
    expect(after.feedback).toHaveLength(1);
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
