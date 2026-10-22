import { describe, expect, it } from "vitest";
import type { InkStroke } from "../contracts";
import { splitInk } from "../diagrams";
import { clusterLines } from "../strokeClusters";
import { struckRows } from "../struckRows";
import { handRow, toInkStrokes } from "../__fixtures__/strokes";

/**
 * A row the kid struck out (`struckRows.ts`), re-drawn in the synthetic hand from the real-ink bench:
 * three rows written tight, the middle one scribbled out, were one line — `5x - 4 = 21 x = 5`, ringed.
 */

const R = 520;
const row = (latex: string, top: number, seed: number) => toInkStrokes(handRow(latex, R, top, 40, seed));
const bottomOf = (ink: InkStroke[]) => Math.max(...ink.map((s) => s.bounds.y + s.bounds.h));
const boxOf = (ink: InkStroke[]) => {
  const xs = ink.flatMap((s) => [s.bounds.x, s.bounds.x + s.bounds.w]);
  const ys = ink.flatMap((s) => [s.bounds.y, s.bounds.y + s.bounds.h]);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
};
const stroke = (id: string, pts: Array<{ x: number; y: number }>): InkStroke => ({ id, segments: [pts], bounds: boxOf([{ bounds: { x: Math.min(...pts.map((p) => p.x)), y: Math.min(...pts.map((p) => p.y)), w: Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x)), h: Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y)) } } as InkStroke]) }) as unknown as InkStroke;
const along = (x0: number, x1: number, y0: number, y1: number, n = 24) => Array.from({ length: n }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / (n - 1), y: y0 + ((y1 - y0) * i) / (n - 1) }));
const holds = (lines: ReturnType<typeof clusterLines>, ink: InkStroke[]) => lines.some((l) => ink.every((s) => l.strokeIds.includes(s.id)) && l.strokeIds.length === ink.length);

/** Three rows written tight (each touching the next), the middle one struck out by `strike`. */
function tight(strike: (b: ReturnType<typeof boxOf>) => InkStroke) {
  const a = row("5x - 4 = 21", 100, 3);
  const mid = row("x = 25 \\div 3", bottomOf(a) - 2, 4);
  const c = row("x = 5", bottomOf(mid) - 2, 5);
  const s = strike(boxOf(mid));
  return { a, mid, c, s, ink: [...a, ...mid, s, ...c] };
}

describe("struck-out rows", () => {
  it("a row scribbled out between two steps: set aside, the steps are lines of their own", () => {
    const { a, mid, c, s, ink } = tight((b) => {
      const y = b.y + b.h / 2;
      return stroke("shape:scribble", [...along(b.x, b.x + b.w, y - 4, y + 3), ...along(b.x + b.w, b.x + 0.2 * b.w, y + 3, y + 8)]);
    });
    const split = splitInk(ink, []);
    expect(split.roles.get("shape:scribble")?.role).toBe("struck");
    for (const m of mid) expect(split.roles.get(m.id as string)?.role).toBe("struck");
    const lines = clusterLines(split.writing);
    expect(holds(lines, a)).toBe(true);
    expect(holds(lines, c)).toBe(true);
    expect(split.writing).not.toContain(s);
  });

  it("…and struck through with one straight line, the same", () => {
    const { a, c, ink } = tight((b) => stroke("shape:strike", along(b.x - 4, b.x + b.w + 4, b.y + 0.55 * b.h, b.y + 0.45 * b.h)));
    const split = splitInk(ink, []);
    expect(split.roles.get("shape:strike")?.role).toBe("struck");
    const lines = clusterLines(split.writing);
    expect(holds(lines, a)).toBe(true);
    expect(holds(lines, c)).toBe(true);
  });

  it("a long square root (its hook and overline one stroke) strikes nothing", () => {
    const a = row("A = \\sqrt{9(9 - 5)(9 - 6)(9 - 7)}", 100, 6);
    expect(struckRows(a, 24).size).toBe(0);
  });

  it("an underline and a fraction bar strike nothing", () => {
    const a = row("x = 5", 100, 7);
    const b = boxOf(a);
    const under = stroke("shape:under", along(b.x - 4, b.x + b.w + 4, b.y + b.h + 6, b.y + b.h + 7));
    expect(struckRows([...a, under], 24).size).toBe(0);
    expect(struckRows(row("\\frac{125}{250} = \\frac{1}{2}", 100, 8), 24).size).toBe(0);
  });
});
