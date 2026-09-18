import { describe, expect, it } from "vitest";
import { fixtureSingleLine, toInkStrokes, translateShapes } from "../__fixtures__/strokes";
import { LIVE_LIMITS, RecognizeRequestSchema, type InkLine, type InkStroke } from "../contracts";
import { clusterLines } from "../strokeClusters";
import { buildPayload, hashPayload, normalizationScale, payloadPointCount, rdp } from "../strokePayload";

function lineFor(strokes: InkStroke[]): InkLine {
  return clusterLines(strokes)[0];
}

describe("buildPayload", () => {
  it("normalizes to ~180 px height with integer coordinates", () => {
    const strokes = toInkStrokes(fixtureSingleLine());
    const payload = buildPayload(lineFor(strokes), strokes);
    expect(payload).not.toBeNull();
    const p = payload!;
    expect(Math.abs(p.h - 180)).toBeLessThanOrEqual(1);
    expect(p.x.length).toBe(p.y.length);
    for (let i = 0; i < p.x.length; i++) {
      expect(p.x[i].length).toBe(p.y[i].length);
      for (const v of [...p.x[i], ...p.y[i]]) expect(Number.isInteger(v)).toBe(true);
    }
    expect(RecognizeRequestSchema.safeParse({
      boardId: "b",
      lineId: "ln_1",
      strokes: { x: p.x, y: p.y },
      bounds: { w: p.w, h: p.h },
    }).success).toBe(true);
  });

  it("RDP reduces the point count by at least 40 %", () => {
    const strokes = toInkStrokes(fixtureSingleLine());
    const raw = strokes.reduce((n, s) => n + s.segments.reduce((m, seg) => m + seg.length, 0), 0);
    const payload = buildPayload(lineFor(strokes), strokes)!;
    const kept = payloadPointCount(payload);
    expect(kept).toBeLessThanOrEqual(raw * 0.6);
    expect(kept).toBeGreaterThan(payload.x.length * 2);
  });

  it("hash is stable under translation and changes with content", async () => {
    const shapes = fixtureSingleLine();
    const a = toInkStrokes(shapes);
    const b = toInkStrokes(translateShapes(shapes, 333, -120));
    const ha = await hashPayload(buildPayload(lineFor(a), a)!);
    const hb = await hashPayload(buildPayload(lineFor(b), b)!);
    expect(ha).toBe(hb);
    expect(ha).toMatch(/^[0-9a-f]{40}$/);
    const c = a.slice(0, -1);
    const hc = await hashPayload(buildPayload(lineFor(c), c)!);
    expect(hc).not.toBe(ha);
  });

  it("clamps the scale for tiny and huge ink", () => {
    expect(normalizationScale(10)).toBe(8);
    expect(normalizationScale(1000)).toBe(0.5);
    expect(normalizationScale(180)).toBe(1);
  });

  it("returns null when the line exceeds the stroke cap", () => {
    const strokes: InkStroke[] = Array.from({ length: LIVE_LIMITS.maxStrokesPerLine + 1 }, (_, i) => ({
      id: `shape:s${i}` as never,
      bounds: { x: i * 5, y: 0, w: 4, h: 20 },
      segments: [[{ x: i * 5, y: 0 }, { x: i * 5 + 4, y: 20 }]],
    }));
    const line: InkLine = {
      id: "ln_x",
      strokeIds: strokes.map((s) => s.id),
      bounds: { x: 0, y: 0, w: 500, h: 20 },
      column: 0,
      row: 0,
      hash: "",
    };
    expect(buildPayload(line, strokes)).toBeNull();
  });

  it("gives a dot two points", () => {
    const strokes: InkStroke[] = [{ id: "shape:d" as never, bounds: { x: 10, y: 10, w: 0, h: 0 }, segments: [[{ x: 10, y: 10 }]] }];
    const line: InkLine = { id: "ln_d", strokeIds: [strokes[0].id], bounds: strokes[0].bounds, column: 0, row: 0, hash: "" };
    const p = buildPayload(line, strokes)!;
    expect(p.x[0]).toHaveLength(2);
  });
});

describe("rdp", () => {
  it("collapses a straight line to its endpoints and keeps corners", () => {
    const straight = Array.from({ length: 50 }, (_, i) => ({ x: i, y: i * 0.5 }));
    expect(rdp(straight, 0.75)).toHaveLength(2);
    const corner = [...Array.from({ length: 20 }, (_, i) => ({ x: i, y: 0 })), ...Array.from({ length: 20 }, (_, i) => ({ x: 19, y: i }))];
    const out = rdp(corner, 0.75);
    expect(out.length).toBeLessThanOrEqual(4);
    expect(out).toContainEqual({ x: 19, y: 0 });
  });
});
