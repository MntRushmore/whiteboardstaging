/**
 * The reveal's strokes (src/lib/server/boardDraw/strokes.ts): the overlay's added pixels traced into
 * pen strokes in the overlay's own pixels, in the order a person writes (lines top to bottom, left to
 * right in a line, a block beside another finished before it), each open stroke left to right or top
 * down, with its own width.
 */
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { FINE_TRACE_SCALE, readingOrder, revealStrokes, revealStrokesFine } from "../strokes";

const W = 640;
const H = 400;

/** An SVG's ink as the overlay's mask (1 = drawn). */
async function maskOf(body: string, w = W, h = H): Promise<Uint8Array> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#fff"/>${body}</svg>`;
  const { data } = await sharp(Buffer.from(svg)).greyscale().raw().toBuffer({ resolveWithObject: true });
  const m = new Uint8Array(w * h);
  for (let i = 0; i < m.length; i++) m[i] = data[i] < 128 ? 1 : 0;
  return m;
}

const pen = (d: string, width = 5, colour = "#d02020") => `<path d="${d}" stroke="${colour}" stroke-width="${width}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;

/** A stroke's first point and its box. */
function info(s: { points: number[] }) {
  const xs = s.points.filter((_, i) => i % 2 === 0);
  const ys = s.points.filter((_, i) => i % 2 === 1);
  return { x: s.points[0], y: s.points[1], ex: s.points[s.points.length - 2], ey: s.points[s.points.length - 1], x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

describe("revealStrokes", () => {
  it("two lines of marks come back in reading order: line 1 left to right, then line 2", async () => {
    // drawn in a scrambled order on purpose: line 2's right mark first, line 1's middle one last
    const marks = [
      pen("M470 250 L520 300"), // line 2, right: a slash
      pen("M90 110 L150 110"), // line 1, left: a dash
      pen("M120 230 L120 300"), // line 2, left: a bar
      pen("M450 80 L450 140"), // line 1, right: a bar
      pen("M260 270 L330 270"), // line 2, middle: a dash
      pen("M280 80 L330 140"), // line 1, middle: a slash
    ];
    const mask = await maskOf(marks.join(""));
    const { strokes, dropped } = revealStrokes(mask, W, H);
    expect(dropped).toBeUndefined();
    expect(strokes).toHaveLength(6);
    const centres = strokes.map((s) => {
      const b = info(s);
      return [Math.round((b.x0 + b.x1) / 2), Math.round((b.y0 + b.y1) / 2)];
    });
    // line 1 (y ≈ 110) left → right, then line 2 (y ≈ 265) left → right
    expect(centres.map(([, y]) => (y < 190 ? 1 : 2))).toEqual([1, 1, 1, 2, 2, 2]);
    const xs = centres.map(([x]) => x);
    expect(xs[0]).toBeLessThan(xs[1]);
    expect(xs[1]).toBeLessThan(xs[2]);
    expect(xs[3]).toBeLessThan(xs[4]);
    expect(xs[4]).toBeLessThan(xs[5]);
    // in the overlay's own pixels (the dash on line 1 spans 90..150 at y 110)
    const dash = info(strokes[0]);
    expect(dash.x0).toBeGreaterThan(80);
    expect(dash.x1).toBeLessThan(160);
    expect(Math.abs(dash.y - 110)).toBeLessThan(3);
  });

  it("each open stroke runs left to right, or top down when it is taller than wide; width is its thickness", async () => {
    const mask = await maskOf(pen("M500 100 L100 110", 6) + pen("M320 360 L330 180", 10));
    const { strokes } = revealStrokes(mask, W, H);
    expect(strokes).toHaveLength(2);
    const [across, down] = strokes.map(info);
    expect(across.ex).toBeGreaterThan(across.x);
    expect(down.ey).toBeGreaterThan(down.y);
    expect(strokes[0].width).toBeGreaterThanOrEqual(4.5);
    expect(strokes[0].width).toBeLessThanOrEqual(7.5);
    expect(strokes[1].width).toBeGreaterThanOrEqual(8);
    expect(strokes[1].width).toBeLessThanOrEqual(12);
  });

  it("points are flat [x, y, …] numbers rounded to 0.1 px, inside the overlay", async () => {
    const mask = await maskOf(`<circle cx="300" cy="200" r="80" stroke="#000" stroke-width="5" fill="none"/>` + pen("M100 50 Q200 0 300 60"));
    const { strokes } = revealStrokes(mask, W, H);
    expect(strokes.length).toBeGreaterThanOrEqual(2);
    for (const s of strokes) {
      expect(s.points.length % 2).toBe(0);
      expect(s.points.length).toBeGreaterThanOrEqual(4);
      for (let i = 0; i < s.points.length; i++) {
        const v = s.points[i];
        expect(Math.round(v * 10) / 10).toBe(v);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(i % 2 === 0 ? W : H);
      }
    }
  });

  it("an empty overlay has no strokes", () => {
    expect(revealStrokes(new Uint8Array(W * H), W, H).strokes).toEqual([]);
  });
});

describe("revealStrokesFine", () => {
  it("traces at FINE_TRACE_SCALE and gives the strokes back in the overlay's own pixels and widths", async () => {
    const mask = await maskOf(pen("M100 100 L300 100", 6) + pen("M200 150 L200 300", 6));
    const plain = revealStrokes(mask, W, H);
    const fine = await revealStrokesFine(mask, W, H);
    expect(FINE_TRACE_SCALE).toBe(3);
    expect(fine.strokes.length).toBe(plain.strokes.length);
    for (const s of fine.strokes) {
      const b = info(s);
      expect(b.x0).toBeGreaterThanOrEqual(90);
      expect(b.x1).toBeLessThanOrEqual(310);
      expect(b.y0).toBeGreaterThanOrEqual(90);
      expect(b.y1).toBeLessThanOrEqual(310);
      expect(s.width).toBeGreaterThan(3);
      expect(s.width).toBeLessThan(10);
    }
  });

  it("an empty mask is no strokes", async () => {
    expect((await revealStrokesFine(new Uint8Array(W * H), W, H)).strokes).toEqual([]);
  });
});

describe("readingOrder", () => {
  const box = (x0: number, y0: number, x1: number, y1: number) => ({ x0, y0, x1, y1 });

  it("finishes a block before the block beside it (a margin note beside two lines of working)", () => {
    // working: two lines at the left; a note two lines tall far to the right
    const items = [
      { item: "note-1", box: box(500, 100, 560, 130) },
      { item: "work-2b", box: box(140, 160, 180, 190) },
      { item: "work-1a", box: box(100, 100, 130, 130) },
      { item: "note-2", box: box(500, 160, 560, 190) },
      { item: "work-1b", box: box(140, 100, 180, 130) },
      { item: "work-2a", box: box(100, 160, 130, 190) },
    ];
    expect(readingOrder(items)).toEqual(["work-1a", "work-1b", "work-2a", "work-2b", "note-1", "note-2"]);
  });

  it("blocks far apart vertically are read top to bottom", () => {
    const items = [
      { item: "low", box: box(0, 300, 30, 330) },
      { item: "high", box: box(400, 0, 430, 30) },
    ];
    expect(readingOrder(items)).toEqual(["high", "low"]);
  });
});
