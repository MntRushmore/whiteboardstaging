import { describe, expect, it } from "vitest";
import { createDirtyTracker } from "../dirtyTracker";
import { makeStore, putShape, shapeIds } from "../__fixtures__/store";
import type { TLShapeId } from "tldraw";

describe("createDirtyTracker", () => {
  it("records adds and updates as changed, removes as removed", () => {
    const store = makeStore();
    const tracker = createDirtyTracker(store);
    putShape(store, "shape:a");
    putShape(store, "shape:b");
    putShape(store, "shape:a", 50); // update
    store.remove(["shape:b" as TLShapeId]);
    expect(tracker.hasPending()).toBe(true);
    const token = tracker.begin();
    expect([...token.changed]).toEqual(["shape:a"]);
    expect([...token.removed]).toEqual(["shape:b"]);
    expect(tracker.hasPending()).toBe(false);
    tracker.dispose();
  });

  it("add then remove ends up only in removed; remove then re-add ends up only in changed", () => {
    const store = makeStore();
    putShape(store, "shape:keep");
    const tracker = createDirtyTracker(store);
    putShape(store, "shape:tmp");
    store.remove(["shape:tmp" as TLShapeId]);
    store.remove(["shape:keep" as TLShapeId]);
    putShape(store, "shape:keep");
    const token = tracker.begin();
    expect(token.changed.has("shape:tmp")).toBe(false);
    expect(token.removed.has("shape:tmp")).toBe(true);
    expect(token.changed.has("shape:keep")).toBe(true);
    expect(token.removed.has("shape:keep")).toBe(false);
    tracker.dispose();
  });

  it("changes during an in-flight save stay pending; restore merges a failed token back", () => {
    const store = makeStore();
    const tracker = createDirtyTracker(store);
    putShape(store, "shape:a");
    const token = tracker.begin();
    putShape(store, "shape:b");
    expect(tracker.hasPending()).toBe(true);
    expect([...tracker.peek().changed]).toEqual(["shape:b"]);
    tracker.restore(token);
    expect([...tracker.peek().changed].sort()).toEqual(["shape:a", "shape:b"]);
    tracker.dispose();
  });

  it("restore does not resurrect an id that was removed after the failed save started", () => {
    const store = makeStore();
    const tracker = createDirtyTracker(store);
    putShape(store, "shape:a");
    const token = tracker.begin();
    store.remove(["shape:a" as TLShapeId]);
    tracker.restore(token);
    const pending = tracker.peek();
    expect(pending.changed.has("shape:a")).toBe(false);
    expect(pending.removed.has("shape:a")).toBe(true);
    tracker.dispose();
  });

  it("ignores session-scoped records and remote-sourced document changes are still recorded", () => {
    const store = makeStore();
    const tracker = createDirtyTracker(store);
    const pageState = store.allRecords().find((r) => r.typeName === "instance_page_state");
    if (pageState) store.put([{ ...pageState, selectedShapeIds: [] } as typeof pageState]);
    expect(tracker.hasPending()).toBe(false);
    store.mergeRemoteChanges(() => {
      putShape(store, "shape:remote");
    });
    expect([...tracker.peek().changed]).toEqual(["shape:remote"]);
    expect(shapeIds(store)).toEqual(["shape:remote"]);
    tracker.dispose();
  });

  it("stops recording after dispose", () => {
    const store = makeStore();
    const tracker = createDirtyTracker(store);
    tracker.dispose();
    putShape(store, "shape:a");
    expect(tracker.hasPending()).toBe(false);
  });
});
