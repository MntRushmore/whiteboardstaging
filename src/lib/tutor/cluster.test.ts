import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { studentInkIdsFromDiff, strokeSamplesFromSegments } from "./cluster";
import { expandClusterOrLatest, partitionWriteLines } from "./geometry";
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

describe("partitionWriteLines", () => {
  it("keeps a stray stroke off the 36+2= line", () => {
    const items = [
      { id: "shape:3", bounds: { x: 200, y: 220, w: 18, h: 28 } },
      { id: "shape:6", bounds: { x: 222, y: 222, w: 16, h: 26 } },
      { id: "shape:plus", bounds: { x: 244, y: 228, w: 14, h: 14 } },
      { id: "shape:2", bounds: { x: 264, y: 221, w: 16, h: 28 } },
      { id: "shape:eq", bounds: { x: 288, y: 230, w: 16, h: 10 } },
      { id: "shape:stray", bounds: { x: 80, y: 80, w: 12, h: 20 } },
    ];
    const lines = partitionWriteLines(items);
    const equation = lines.find((line) => line.includes("shape:eq"));
    const stray = lines.find((line) => line.includes("shape:stray"));
    assert.ok(equation);
    assert.ok(stray);
    assert.notEqual(equation, stray);
    assert.ok(equation!.includes("shape:3"));
    assert.ok(equation!.includes("shape:2"));
    assert.equal(equation!.includes("shape:stray"), false);
    assert.equal(lines[0]?.includes("shape:stray"), true);
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
