import { describe, expect, it } from "vitest";
import type { InkStroke } from "../contracts";
import { clusterLines } from "../strokeClusters";
import { handRow, toInkStrokes } from "../__fixtures__/strokes";

/**
 * Steps written close under each other, as children write them (the real-ink bench): a bar reaches
 * only its own numerator and denominator, a minus is no fraction bar, a `+`'s bar is no fraction bar.
 * Each merge read two steps as one and ringed right work. Re-drawn in the synthetic hand.
 */

const R = 520;
const row = (latex: string, top: number, seed: number) => toInkStrokes(handRow(latex, R, top, 40, seed));
const bottomOf = (ink: InkStroke[]) => Math.max(...ink.map((s) => s.bounds.y + s.bounds.h));
const ids = (ink: InkStroke[]) => ink.map((s) => s.id as string).sort();
const line = (id: string, p: { x: number; y: number }, q: { x: number; y: number }): InkStroke => {
  const pts = Array.from({ length: 12 }, (_, i) => ({ x: p.x + ((q.x - p.x) * i) / 11, y: p.y + ((q.y - p.y) * i) / 11 }));
  const xs = pts.map((t) => t.x);
  const ys = pts.map((t) => t.y);
  return { id, segments: [pts], bounds: { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) } } as unknown as InkStroke;
};
const holds = (lines: ReturnType<typeof clusterLines>, ink: InkStroke[]) => lines.some((l) => [...l.strokeIds].sort().join() === ids(ink).join());

describe("steps written close under each other", () => {
  it("the next step just under a fraction's denominator is a line of its own", () => {
    const a = row("\\frac{13x}{13} = \\frac{166}{13}", 100, 3);
    const b = row("x = \\frac{166}{13}", bottomOf(a) + 8, 4);
    const lines = clusterLines([...a, ...b]);
    expect(holds(lines, a)).toBe(true);
    expect(holds(lines, b)).toBe(true);
  });

  it("notes written close under an equation (a kid's wide `+` under its `=`) are a line of their own", () => {
    const a = row("x - 2 = 5", 100, 5);
    const top = bottomOf(a) + 14;
    const eq = a.filter((s) => s.bounds.w > 3 * s.bounds.h).sort((p, q) => p.bounds.x - q.bounds.x).at(-1)!;
    const cx = eq.bounds.x + eq.bounds.w / 2;
    // her `+`: a bar wider than a digit, its upright through the middle — then a `2`
    const bar = line("shape:plusbar", { x: cx - 34, y: top + 22 }, { x: cx + 34, y: top + 23 });
    const up = line("shape:plusup", { x: cx + 1, y: top }, { x: cx, y: top + 44 });
    const two = toInkStrokes(handRow("2", cx + 80, top + 2, 40, 9));
    const b = [bar, up, ...two];
    const lines = clusterLines([...a, ...b]);
    expect(holds(lines, a)).toBe(true);
    expect(lines.some((l) => l.strokeIds.includes(bar.id) && l.strokeIds.some((id) => a.some((s) => s.id === id)))).toBe(false);
  });

  it("a fraction is still one line: numerator, bar and denominator", () => {
    const a = row("x = \\frac{25}{5}", 100, 7);
    expect(clusterLines(a)).toHaveLength(1);
  });

  it("a fraction minus a fraction is still one line", () => {
    const a = row("\\frac{3}{4} - \\frac{1}{8}", 100, 8);
    expect(clusterLines(a)).toHaveLength(1);
  });
});
