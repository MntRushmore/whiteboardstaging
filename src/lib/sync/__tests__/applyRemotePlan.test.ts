import { describe, expect, it } from "vitest";
import type { TLShapeId } from "tldraw";
import { applyRemotePlan } from "../applyRemotePlan";
import { drawRecord, makeStore, pageIdOf, putShape, shapeIds } from "../__fixtures__/store";

describe("applyRemotePlan", () => {
  it("puts and removes inside one remote-sourced transaction", () => {
    const store = makeStore();
    putShape(store, "shape:old");
    const sources: string[] = [];
    const stop = store.listen((e) => sources.push(e.source), { scope: "document", source: "all" });
    const report = applyRemotePlan(store, { put: [drawRecord(pageIdOf(store), "shape:new")], remove: ["shape:old", "shape:missing"] });
    stop();
    expect(report).toEqual({ put: 1, removed: 1, skipped: 0 });
    expect(shapeIds(store)).toEqual(["shape:new"]);
    expect(sources).toEqual(["remote"]);
  });

  it("skips records that fail validation and applies the rest", () => {
    const store = makeStore();
    const good = drawRecord(pageIdOf(store), "shape:good");
    const bad = { ...drawRecord(pageIdOf(store), "shape:bad"), props: { nope: true } };
    const junk = { hello: "world" };
    const report = applyRemotePlan(store, { put: [good, bad, junk], remove: [] });
    expect(report).toEqual({ put: 1, removed: 0, skipped: 2 });
    expect(shapeIds(store)).toEqual(["shape:good"]);
  });

  it("is a no-op for an empty plan", () => {
    const store = makeStore();
    const before = store.getStoreSnapshot("document");
    expect(applyRemotePlan(store, { put: [], remove: [] })).toEqual({ put: 0, removed: 0, skipped: 0 });
    expect(store.getStoreSnapshot("document")).toEqual(before);
    expect(store.has("shape:none" as TLShapeId)).toBe(false);
  });
});
