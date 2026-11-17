/**
 * Structural equality for tldraw's JSON-like records (src/lib/sync/deepEqual.ts): the board's merge
 * (`mergeDocumentRecords`) and replay decide what to write by it, so a false "equal" loses an edit
 * and a false "different" costs a redundant write.
 */
import { describe, expect, it } from "vitest";
import { deepEqual } from "@/lib/sync/deepEqual";

const shape = (over: Record<string, unknown> = {}) => ({
  id: "shape:abc",
  typeName: "shape",
  type: "draw",
  x: 10,
  y: 20,
  rotation: 0,
  props: { segments: [{ type: "free", points: [{ x: 0, y: 0, z: 0.5 }, { x: 1, y: 2, z: 0.5 }] }], color: "black", isComplete: true },
  meta: {},
  ...over,
});

describe("deepEqual", () => {
  it("primitives", () => {
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual("a", "a")).toBe(true);
    expect(deepEqual(null, null)).toBe(true);
    expect(deepEqual(undefined, undefined)).toBe(true);
    expect(deepEqual(1, "1")).toBe(false);
    expect(deepEqual(0, false)).toBe(false);
    expect(deepEqual(null, undefined)).toBe(false);
    expect(deepEqual(null, {})).toBe(false);
    expect(deepEqual({}, null)).toBe(false);
    expect(deepEqual(NaN, NaN)).toBe(true);
    expect(deepEqual(NaN, 0)).toBe(false);
  });

  it("the same record, built separately, is equal; key order does not matter", () => {
    expect(deepEqual(shape(), shape())).toBe(true);
    const reordered = Object.fromEntries(Object.entries(shape()).reverse());
    expect(deepEqual(shape(), reordered)).toBe(true);
    expect(deepEqual(shape(), JSON.parse(JSON.stringify(shape())))).toBe(true);
  });

  it("one moved point deep in a stroke is a difference", () => {
    const moved = shape();
    (moved.props as { segments: Array<{ points: Array<{ x: number }> }> }).segments[0].points[1].x = 1.0001;
    expect(deepEqual(shape(), moved)).toBe(false);
  });

  it("arrays: order and length matter; an array is not an object with the same keys", () => {
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
    expect(deepEqual([1, 2], [1, 2, undefined])).toBe(false);
    expect(deepEqual([], {})).toBe(false);
    expect(deepEqual({ 0: "a", 1: "b" }, ["a", "b"])).toBe(false);
    expect(deepEqual([[]], [[]])).toBe(true);
  });

  it("a key with another name, or a key missing on one side, is a difference (same count of keys)", () => {
    expect(deepEqual({ a: 1 }, { b: 1 })).toBe(false);
    expect(deepEqual({ a: undefined }, { b: undefined })).toBe(false);
    expect(deepEqual({ a: 1, b: 2 }, { a: 1 })).toBe(false);
  });

  it("an inherited key is not an own key: { toString } vs {} with a prototype is different", () => {
    expect(deepEqual({ toString: 1 }, Object.create({ toString: 1 }))).toBe(false);
  });

  it("unicode text in a text shape compares exactly (no normalization: é composed ≠ e + combining accent)", () => {
    expect(deepEqual({ text: "x² + π ≈ 😀" }, { text: "x² + π ≈ 😀" })).toBe(true);
    expect(deepEqual({ text: "é" }, { text: "é" })).toBe(false);
  });

  it("a huge stroke (100k points) compares quickly and correctly", () => {
    const pts = (n: number) => Array.from({ length: n }, (_, i) => ({ x: i, y: i * 2, z: 0.5 }));
    const a = shape({ props: { segments: [{ type: "free", points: pts(100_000) }] } });
    const b = shape({ props: { segments: [{ type: "free", points: pts(100_000) }] } });
    const t = performance.now();
    expect(deepEqual(a, b)).toBe(true);
    expect(performance.now() - t).toBeLessThan(2_000);
    (b.props as { segments: Array<{ points: Array<{ z: number }> }> }).segments[0].points[99_999].z = 0.6;
    expect(deepEqual(a, b)).toBe(false);
  });
});
