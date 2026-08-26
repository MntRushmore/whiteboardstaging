import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { studentInkIdsFromDiff, strokeSamplesFromSegments } from "./cluster";
import { expandClusterOrLatest } from "./geometry";
import { readStrokePoint } from "./strokes";

describe("readStrokePoint", () => {
  it("reads tldraw VecModel, arrays, and X/Y keys", () => {
    assert.deepEqual(readStrokePoint({ x: 3, y: 9, z: 0.5 }), { x: 3, y: 9 });
    assert.deepEqual(readStrokePoint([3, 9, 0.5]), { x: 3, y: 9 });
    assert.deepEqual(readStrokePoint({ X: 3, Y: 9 }), { x: 3, y: 9 });
    assert.equal(readStrokePoint(null), null);
    assert.equal(readStrokePoint({ x: "nope", y: 1 }), null);
  });
});

describe("strokeSamplesFromSegments", () => {
  it("keeps a last-cluster stroke from object points", () => {
    const samples = strokeSamplesFromSegments([
      {
        type: "free",
        points: [
          { x: 10, y: 20, z: 0.4 },
          { x: 18, y: 20, z: 0.4 },
          { x: 26, y: 21, z: 0.4 },
        ],
      },
    ]);
    assert.equal(samples.length, 1);
    assert.equal(samples[0]?.points.length, 3);
    assert.deepEqual(samples[0]?.points[0], { x: 10, y: 20 });
  });

  it("reads array points so a real pencil write still POSTs", () => {
    const samples = strokeSamplesFromSegments([{ points: [[0, 0], [12, 1], [24, 0]] }]);
    assert.equal(samples.length, 1);
    assert.deepEqual(samples[0]?.points[1], { x: 12, y: 1 });
  });

  it("keeps a one-point tap so Mathpix sees the stroke", () => {
    const samples = strokeSamplesFromSegments([{ points: [{ x: 4, y: 8 }] }]);
    assert.equal(samples.length, 1);
    assert.equal(samples[0]?.points.length, 2);
  });

  it("uses local coords if the page transform throws", () => {
    const samples = strokeSamplesFromSegments([{ points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] }], () => {
      throw new Error("no transform");
    });
    assert.deepEqual(samples[0]?.points, [
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ]);
  });
});

describe("studentInkIdsFromDiff", () => {
  it("treats a draw record without typeName as student ink", () => {
    const { addedOrUpdated } = studentInkIdsFromDiff({
      added: {
        "shape:ink": { id: "shape:ink", type: "draw", props: {} },
      },
      updated: {},
      removed: {},
    });
    assert.deepEqual(addedOrUpdated, ["shape:ink"]);
  });
});

describe("expandClusterOrLatest", () => {
  it("falls back to the newest ink when listen seeds are gone", () => {
    const items = [
      { id: "shape:old", bounds: { x: 0, y: 0, w: 10, h: 10 } },
      { id: "shape:new", bounds: { x: 12, y: 0, w: 10, h: 10 } },
    ];
    const clustered = expandClusterOrLatest(items, ["shape:stale"]);
    assert.deepEqual(clustered, ["shape:new", "shape:old"]);
  });
});
