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

/**
 * Release QA 2026-10-03: whatever ink a student makes, the request the client builds either passes
 * the route's schema or is not sent at all (null: "Too much ink for one line"). A seeded random
 * walk stands in for real handwriting at its extremes: long dense strokes, many of them, a big
 * screen far from the origin, a flat line, a single dot.
 */
describe("every payload the client sends passes the recognize route's schema", () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const walk = (x0: number, y0: number, n: number, step: number, amp: number) => {
    const pts = [{ x: x0, y: y0 }];
    for (let i = 1; i < n; i++) {
      const p = pts[i - 1];
      pts.push({ x: p.x + step * rand(), y: y0 + amp * Math.sin(i / 7) + (rand() - 0.5) * amp * 0.3 });
    }
    return pts;
  };
  const lineOf = (segments: Array<Array<{ x: number; y: number }>>, id = "s"): { line: InkLine; strokes: InkStroke[] } => {
    const strokes: InkStroke[] = segments.map((seg, i) => {
      const xs = seg.map((p) => p.x);
      const ys = seg.map((p) => p.y);
      const b = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
      return { id: `shape:${id}${i}` as never, bounds: b, segments: [seg] };
    });
    const bx = Math.min(...strokes.map((s) => s.bounds.x));
    const by = Math.min(...strokes.map((s) => s.bounds.y));
    const bw = Math.max(...strokes.map((s) => s.bounds.x + s.bounds.w)) - bx;
    const bh = Math.max(...strokes.map((s) => s.bounds.y + s.bounds.h)) - by;
    return { line: { id: "ln_fuzz", strokeIds: strokes.map((s) => s.id), bounds: { x: bx, y: by, w: bw, h: bh }, column: 0, row: 0, hash: "" }, strokes };
  };
  // [what, the ink, sent?] -- not sent means over the caps: the line reads "Too much ink for one line"
  const cases: Array<[string, Array<Array<{ x: number; y: number }>>, boolean]> = [
    ["two dense 4,000-point strokes (1,970 points each once simplified)", [walk(100, 100, 4000, 0.4, 30), walk(1800, 100, 4000, 0.4, 30)], true],
    ["80 strokes of 300 points", Array.from({ length: 80 }, (_, i) => walk(i * 40, 500, 300, 0.2, 25)), true],
    ["a flat line, 1 px tall, on a wide screen", [walk(0, 0, 500, 2, 0.5)], true],
    ["one dot", [[{ x: 3.25, y: -7.5 }]], true],
    ["a 12,000 px scribble far from the origin (over the point cap)", [walk(250_000, -90_000, 3000, 4, 60)], false],
  ];
  it.each(cases)("%s", (_name, segments, sent) => {
    const { line, strokes } = lineOf(segments);
    const p = buildPayload(line, strokes);
    expect(Boolean(p)).toBe(sent);
    if (!p) return;
    const parsed = RecognizeRequestSchema.safeParse({
      boardId: "9a69089c-e108-4db2-bd76-cec1c2909f6b",
      lineId: line.id,
      strokes: { x: p.x, y: p.y },
      bounds: { w: p.w, h: p.h },
    });
    expect(parsed.success, JSON.stringify(parsed.error?.issues.slice(0, 2))).toBe(true);
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
