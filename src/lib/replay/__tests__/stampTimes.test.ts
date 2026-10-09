import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createShapeId,
  createTLStore,
  defaultBindingUtils,
  defaultShapeTools,
  defaultShapeUtils,
  defaultTools,
  Editor,
  getSnapshot,
  loadSnapshot,
  type TLDrawShape,
  type TLEventInfo,
  type TLShape,
  type TLShapeId,
} from "tldraw";
import { isLiveMeta } from "@/lib/live/contracts";
import { createDirtyTracker } from "@/lib/sync/dirtyTracker";
import { liveShapeUtils } from "@/shapes";
import { registerStrokeTimes, stampCompleted, stampCreated } from "../stampTimes";
import { STROKE_TIME } from "../timeline";

/**
 * The stamps on a real tldraw Editor, headless in node (the DOM it touches while constructing is an
 * anything-goes stub, as in src/lib/assets/__tests__/addImageFiles.test.ts), driven through the draw
 * tool's own pointer events where it matters.
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

const shapeUtils = [...defaultShapeUtils, ...liveShapeUtils];

function makeEditor(): Editor {
  const store = createTLStore({ shapeUtils, bindingUtils: defaultBindingUtils });
  loadSnapshot(store, { store: {}, schema: store.schema.serialize() });
  return new Editor({ store, shapeUtils, bindingUtils: defaultBindingUtils, tools: [...defaultTools, ...defaultShapeTools], getContainer: () => stub() as HTMLElement });
}

let clock = 1_791_306_000_000;
const now = () => clock;

function pointer(name: "pointer_down" | "pointer_move" | "pointer_up", x: number, y: number): TLEventInfo {
  return { type: "pointer", target: "canvas", name, point: { x, y, z: 0.5 }, pointerId: 1, button: 0, isPen: false, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, accelKey: false } as TLEventInfo;
}

/** A stroke with the draw tool: pen down at t, a few moves, pen up `ms` later. */
function drawStroke(editor: Editor, x: number, y: number, ms = 400): TLDrawShape {
  editor.setCurrentTool("draw");
  const before = new Set(editor.getCurrentPageShapeIds());
  editor.dispatch(pointer("pointer_down", x, y));
  for (let i = 1; i <= 4; i++) {
    clock += ms / 4;
    editor.dispatch(pointer("pointer_move", x + i * 12, y + i * 6));
    // the tool works on ticks; a tick flushes the moves
    editor.emit("tick", 16);
  }
  editor.dispatch(pointer("pointer_up", x + 48, y + 24));
  const created = [...editor.getCurrentPageShapeIds()].filter((id) => !before.has(id));
  expect(created).toHaveLength(1);
  return editor.getShape(created[0]) as TLDrawShape;
}

const metaOf = (s: TLShape | undefined) => (s?.meta ?? {}) as Record<string, unknown>;
/** the undo stack's depth (`Editor.history` is internal) */
const undos = (e: Editor) => (e as unknown as { history: { getNumUndos(): number } }).history.getNumUndos();

describe("stampCreated / stampCompleted (the transforms)", () => {
  const base = { id: "shape:a" as TLShapeId, type: "draw", meta: {}, props: { isComplete: false } } as unknown as TLShape;

  it("stamps a time on a new shape, never adds `live`", () => {
    const s = stampCreated(base, 5);
    expect(s.meta).toEqual({ [STROKE_TIME.start]: 5 });
    expect(isLiveMeta(s.meta)).toBe(false);
  });

  it("a shape coming back (undo, redo) is left as it was; a copy of a stamped one gets its own time", () => {
    const drawn = { ...base, meta: { [STROKE_TIME.start]: 1, [STROKE_TIME.end]: 2, other: "kept" } } as unknown as TLShape;
    expect(stampCreated(drawn, 9, true)).toBe(drawn);
    expect(stampCreated(base, 9, true)).toBe(base);
    expect(stampCreated(drawn, 9).meta).toEqual({ [STROKE_TIME.start]: 9, other: "kept" });
  });

  it("stamps pen up when a stroke completes, and only then", () => {
    const done = { ...base, props: { isComplete: true } } as unknown as TLShape;
    expect(stampCompleted(base, done, 7).meta).toEqual({ [STROKE_TIME.end]: 7 });
    expect(stampCompleted(done, done, 7)).toBe(done);
    expect(stampCompleted(base, base, 7)).toBe(base);
    const geo = { ...done, type: "geo" } as unknown as TLShape;
    expect(stampCompleted({ ...base, type: "geo" } as unknown as TLShape, geo, 7)).toBe(geo);
    // a redo brings its own t1: kept
    const redone = { ...done, meta: { [STROKE_TIME.end]: 3 } } as unknown as TLShape;
    expect(stampCompleted(base, redone, 7)).toBe(redone);
  });
});

describe("registerStrokeTimes on the board's editor", () => {
  let editor: Editor | null = null;
  let off: (() => void) | null = null;
  const ed = () => editor as Editor;

  beforeEach(() => {
    vi.stubGlobal("document", stub());
    vi.stubGlobal(
      "window",
      stub({ devicePixelRatio: 1, innerWidth: 1080, innerHeight: 720, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), navigator: { userAgent: "node", maxTouchPoints: 0 } }),
    );
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => setTimeout(cb, 16));
    vi.stubGlobal("cancelAnimationFrame", (h: ReturnType<typeof setTimeout>) => clearTimeout(h));
    editor = makeEditor();
    off = registerStrokeTimes(editor, now);
  });
  afterEach(() => {
    off?.();
    editor?.dispose();
    editor = null;
    vi.unstubAllGlobals();
  });

  it("a stroke drawn with the pen gets its pen-down and pen-up times, and nothing else", () => {
    const down = clock;
    const s = drawStroke(ed(), 100, 100, 400);
    expect(s.props.isComplete).toBe(true);
    expect(metaOf(s)).toEqual({ [STROKE_TIME.start]: down, [STROKE_TIME.end]: down + 400 });
    expect(isLiveMeta(s.meta)).toBe(false);
  });

  it("adds no undo step: one undo takes the stroke away, one redo brings it back with the same times", () => {
    const plain = makeEditor();
    try {
      drawStroke(plain, 10, 10);
      const s = drawStroke(ed(), 10, 10);
      expect(undos(ed())).toBe(undos(plain));
      expect(undos(ed())).toBeGreaterThan(0);
      const stamped = metaOf(s);
      clock += 60_000;
      ed().undo();
      expect(ed().getShape(s.id)).toBeUndefined();
      ed().redo();
      expect(metaOf(ed().getShape(s.id))).toEqual(stamped);
    } finally {
      plain.dispose();
    }
  });

  it("adds no store change: the autosave's dirty tracker sees one stroke", () => {
    const tracker = createDirtyTracker(ed().store);
    let changes = 0;
    const stop = ed().store.listen(() => changes++, { scope: "document", source: "all" });
    const s = drawStroke(ed(), 300, 300);
    const token = tracker.begin();
    expect([...token.changed]).toEqual([s.id]);
    // what the draw tool writes, and no more: the same number of change batches as without stamps
    const plain = makeEditor();
    let plainChanges = 0;
    const stopPlain = plain.store.listen(() => plainChanges++, { scope: "document", source: "all" });
    drawStroke(plain, 300, 300);
    (ed().store as unknown as { _flushHistory(): void })._flushHistory();
    (plain.store as unknown as { _flushHistory(): void })._flushHistory();
    expect(changes).toBe(plainChanges);
    stop();
    stopPlain();
    tracker.dispose();
    plain.dispose();
  });

  it("never stamps what arrives as a remote change: the tutor's writing, a merge, a backup", () => {
    const id = createShapeId("tutor");
    ed().store.mergeRemoteChanges(() => {
      ed().createShapes([{ id, type: "draw", props: { isComplete: false }, meta: { live: true, source: "ai", lineId: "ln_1", createdAt: 1 } }]);
    });
    ed().store.mergeRemoteChanges(() => {
      ed().updateShapes([{ id, type: "draw", props: { isComplete: true } }]);
    });
    expect(metaOf(ed().getShape(id))).toEqual({ live: true, source: "ai", lineId: "ln_1", createdAt: 1 });
  });

  it("a loaded board's strokes stay as they were saved", () => {
    const source = makeEditor();
    const id = createShapeId("old");
    source.createShapes([{ id, type: "draw", props: { isComplete: true } }]);
    const snapshot = getSnapshot(source.store);
    source.dispose();
    loadSnapshot(ed().store, snapshot);
    expect(metaOf(ed().getShape(id))).toEqual({});
  });

  it("an erased stroke brought back by undo keeps its times; an old unstamped one stays unstamped", () => {
    const s = drawStroke(ed(), 50, 50);
    const stamped = metaOf(s);
    const old = createShapeId("old");
    ed().store.mergeRemoteChanges(() => ed().createShapes([{ id: old, type: "draw", props: { isComplete: true } }]));
    clock += 30_000;
    ed().markHistoryStoppingPoint("erase");
    ed().deleteShapes([s.id, old]);
    ed().undo();
    expect(metaOf(ed().getShape(s.id))).toEqual(stamped);
    expect(metaOf(ed().getShape(old))).toEqual({});
  });

  it("a duplicate is a new shape with its own time (and no pen-up); a placed shape gets one too", () => {
    const s = drawStroke(ed(), 50, 50);
    clock += 5_000;
    ed().select(s.id);
    ed().duplicateShapes([s.id]);
    const copy = ed().getCurrentPageShapes().find((x) => x.id !== s.id);
    expect(metaOf(copy)).toEqual({ [STROKE_TIME.start]: clock });
    const geo = createShapeId("geo");
    ed().createShapes([{ id: geo, type: "geo" }]);
    expect(metaOf(ed().getShape(geo))).toEqual({ [STROKE_TIME.start]: clock });
  });

  it("keeps the tutor's meta whole when the student's own action touches a tutor shape", () => {
    const id = createShapeId("mark");
    ed().store.mergeRemoteChanges(() => ed().createShapes([{ id, type: "draw", props: { isComplete: true }, meta: { live: true, source: "ai", lineId: "ln_2", createdAt: 2, mark: "check:1,1,1,1" } }]));
    ed().updateShapes([{ id, type: "draw", x: 40 }]);
    expect(metaOf(ed().getShape(id))).toEqual({ live: true, source: "ai", lineId: "ln_2", createdAt: 2, mark: "check:1,1,1,1" });
  });

  it("stops when removed", () => {
    off?.();
    off = null;
    const s = drawStroke(ed(), 70, 70);
    expect(metaOf(s)).toEqual({});
  });
});
