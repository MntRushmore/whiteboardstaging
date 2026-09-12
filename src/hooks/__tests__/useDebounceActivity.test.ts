import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  createShapeId,
  createTLStore,
  defaultBindingUtils,
  defaultShapeUtils,
  loadSnapshot,
  type HistoryEntry,
  type IndexKey,
  type TLDrawShape,
  type TLImageShape,
  type TLPageId,
  type TLRecord,
  type TLShape,
  type TLStore,
} from "tldraw";
import { isLiveManagedShape, isStudentActivity, startActivityDebouncer } from "../useDebounceActivity";

/**
 * B1: the legacy image pipeline's idle timer must only restart on student ink/content
 * edits, never on Live echoes/graphs or on AI overlay images.
 */

function headlessStore(): { store: TLStore; pageId: TLPageId } {
  const store = createTLStore({ shapeUtils: defaultShapeUtils, bindingUtils: defaultBindingUtils });
  loadSnapshot(store, { store: {}, schema: store.schema.serialize() });
  const page = store.allRecords().find((r) => r.typeName === "page");
  if (!page) throw new Error("store has no page");
  return { store, pageId: page.id as TLPageId };
}

let nextIndex = 0;
function index(): IndexKey {
  nextIndex += 1;
  return `a${nextIndex.toString(36).padStart(3, "0")}` as IndexKey;
}

function drawShape(pageId: TLPageId, over: Partial<TLDrawShape> = {}): TLDrawShape {
  return {
    id: createShapeId(),
    typeName: "shape",
    type: "draw",
    x: 10,
    y: 10,
    rotation: 0,
    index: index(),
    parentId: pageId,
    isLocked: false,
    opacity: 1,
    meta: {},
    props: {
      color: "black",
      fill: "none",
      dash: "draw",
      size: "m",
      segments: [{ type: "free", points: [{ x: 0, y: 0, z: 0.5 }, { x: 10, y: 10, z: 0.5 }] }],
      isComplete: false,
      isClosed: false,
      isPen: false,
      scale: 1,
    },
    ...over,
  };
}

function imageShape(pageId: TLPageId, meta: TLShape["meta"]): TLImageShape {
  return {
    id: createShapeId(),
    typeName: "shape",
    type: "image",
    x: 0,
    y: 0,
    rotation: 0,
    index: index(),
    parentId: pageId,
    isLocked: false,
    opacity: 1,
    meta,
    props: { w: 100, h: 80, playing: true, url: "", assetId: null, crop: null, flipX: false, flipY: false, altText: "" },
  };
}

const liveMeta = { live: true, source: "echo", lineId: "ln_1", createdAt: 1 } as const;

/** a math shape record as the store would hand it to a listener (no util needed for the pure predicate) */
function mathRecord(): TLShape {
  return {
    ...imageShape("page:p" as TLPageId, { ...liveMeta }),
    type: "math",
    props: {},
  } as unknown as TLShape;
}

function entry(changes: Partial<HistoryEntry<TLRecord>["changes"]>): HistoryEntry<TLRecord> {
  return {
    source: "user",
    changes: { added: {}, updated: {}, removed: {}, ...changes },
  };
}

describe("isLiveManagedShape", () => {
  it("covers math/graph types, live meta and AI overlays", () => {
    expect(isLiveManagedShape({ type: "math", meta: {} })).toBe(true);
    expect(isLiveManagedShape({ type: "graph", meta: {} })).toBe(true);
    expect(isLiveManagedShape({ type: "geo", meta: { ...liveMeta } })).toBe(true);
    expect(isLiveManagedShape({ type: "image", meta: { aiOverlay: true, mode: "feedback" } })).toBe(true);
    expect(isLiveManagedShape({ type: "draw", meta: {} })).toBe(false);
    expect(isLiveManagedShape({ type: "image", meta: { isProtected: true } })).toBe(false);
  });
});

describe("isStudentActivity", () => {
  const pageId = "page:p" as TLPageId;

  it("counts added, updated and removed ink", () => {
    const ink = drawShape(pageId);
    expect(isStudentActivity(entry({ added: { [ink.id]: ink } }))).toBe(true);
    expect(isStudentActivity(entry({ updated: { [ink.id]: [ink, { ...ink, x: 20 }] } }))).toBe(true);
    expect(isStudentActivity(entry({ removed: { [ink.id]: ink } }))).toBe(true);
  });

  it("ignores entries whose shapes are all math/graph/live-meta", () => {
    const math = mathRecord();
    const echoImage = imageShape(pageId, { ...liveMeta });
    expect(isStudentActivity(entry({ added: { [math.id]: math } }))).toBe(false);
    expect(isStudentActivity(entry({ updated: { [math.id]: [math, { ...math, x: 5 }] } }))).toBe(false);
    expect(isStudentActivity(entry({ removed: { [echoImage.id]: echoImage } }))).toBe(false);
  });

  it("ignores entries that touch no shape (assets, pages)", () => {
    const asset = { id: "asset:a1", typeName: "asset", type: "image", props: {}, meta: {} } as unknown as TLRecord;
    expect(isStudentActivity(entry({ added: { [asset.id]: asset } }))).toBe(false);
    expect(isStudentActivity(entry({}))).toBe(false);
  });

  it("is activity when a live edit and an ink edit land in the same entry", () => {
    const math = mathRecord();
    const ink = drawShape(pageId);
    expect(isStudentActivity(entry({ added: { [math.id]: math, [ink.id]: ink } }))).toBe(true);
  });
});

describe("startActivityDebouncer (headless store + fake timers)", () => {
  let store: TLStore;
  let pageId: TLPageId;
  let callback: Mock<() => void>;
  let dispose: (() => void) | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    ({ store, pageId } = headlessStore());
    callback = vi.fn<() => void>();
  });

  afterEach(() => {
    dispose?.();
    dispose = null;
    vi.useRealTimers();
  });

  it("fires once after the delay following a pen-up", () => {
    dispose = startActivityDebouncer(store, callback, { delay: 2000 });
    const ink = drawShape(pageId);
    store.put([ink]);
    vi.advanceTimersByTime(1500);
    store.put([{ ...ink, props: { ...ink.props, isComplete: true } }]);
    vi.advanceTimersByTime(1999);
    expect(callback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("does not start a timer for Live-owned or AI overlay writes", () => {
    dispose = startActivityDebouncer(store, callback, { delay: 2000 });
    const echo = imageShape(pageId, { ...liveMeta });
    const overlay = imageShape(pageId, { aiOverlay: true, mode: "feedback" });
    store.put([echo, overlay]);
    store.put([{ ...echo, x: 40 }]);
    store.remove([overlay.id]);
    vi.advanceTimersByTime(10_000);
    expect(callback).not.toHaveBeenCalled();
  });

  it("does not restart a pending timer on a later Live-owned edit", () => {
    dispose = startActivityDebouncer(store, callback, { delay: 2000 });
    const ink = drawShape(pageId, { props: { ...drawShape(pageId).props, isComplete: true } });
    const echo = imageShape(pageId, { ...liveMeta });
    store.put([ink]);
    vi.advanceTimersByTime(1500);
    // the echo lands (and is later re-placed) after the student stopped writing
    store.put([echo]);
    store.put([{ ...echo, x: 99, y: 12 }]);
    vi.advanceTimersByTime(500);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("ignores remote (non-user) writes", () => {
    dispose = startActivityDebouncer(store, callback, { delay: 1000 });
    store.mergeRemoteChanges(() => {
      store.put([drawShape(pageId)]);
    });
    vi.advanceTimersByTime(5000);
    expect(callback).not.toHaveBeenCalled();
  });

  it("honours shouldIgnoreRef / isProcessingRef and clears the timer on dispose", () => {
    const shouldIgnoreRef = { current: true };
    const isProcessingRef = { current: false };
    dispose = startActivityDebouncer(store, callback, { delay: 1000, shouldIgnoreRef, isProcessingRef });
    store.put([drawShape(pageId)]);
    vi.advanceTimersByTime(2000);
    expect(callback).not.toHaveBeenCalled();

    shouldIgnoreRef.current = false;
    isProcessingRef.current = true;
    store.put([drawShape(pageId)]);
    vi.advanceTimersByTime(2000);
    expect(callback).not.toHaveBeenCalled();

    isProcessingRef.current = false;
    store.put([drawShape(pageId)]);
    dispose();
    dispose = null;
    vi.advanceTimersByTime(2000);
    expect(callback).not.toHaveBeenCalled();
  });
});
