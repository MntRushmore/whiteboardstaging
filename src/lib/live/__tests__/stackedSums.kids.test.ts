import { describe, expect, it } from "vitest";
import type { InkStroke } from "../contracts";
import { splitInk } from "../diagrams";
import { stackGroups } from "../stackedSums";
import { clusterLines } from "../strokeClusters";
import { handRow, handRule, toInkStrokes, writeStack } from "../__fixtures__/strokes";

/**
 * Stacked sums as children really write them (the real-ink bench, docs/REAL-INK-BENCH.md): no
 * ruler, a `+` hung low, a `7` with its bar, rows that touch, the answer big, a circle or box round
 * it. Each was a sum the board did not see — its rule a fraction bar (`\frac{+47}{175}` under a `128`
 * of its own), the right answer never ticked. Re-drawn here in the synthetic hand: never real ink.
 */

function board(ink: InkStroke[]) {
  const split = splitInk(ink, []);
  const lines = clusterLines(split.writing, [], stackGroups(split.stacks, ink));
  return { split, lines, stacks: split.stacks };
}

const boxOf = (pts: Array<{ x: number; y: number }>) => {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
};
const stroke = (id: string, pts: Array<{ x: number; y: number }>): InkStroke => ({ id, segments: [pts], bounds: boxOf(pts) }) as unknown as InkStroke;
const moved = (s: InkStroke, f: (p: { x: number; y: number }) => { x: number; y: number }): InkStroke => {
  const segments = s.segments.map((seg) => seg.map(f));
  return { ...s, segments, bounds: boxOf(segments.flat()) };
};
/** Turned by `deg` about (cx, cy): a whole sum written on a slant. */
const turned = (ink: InkStroke[], deg: number, cx = 300, cy = 300) => {
  const a = (deg * Math.PI) / 180;
  return ink.map((s) => moved(s, (p) => ({ x: cx + (p.x - cx) * Math.cos(a) - (p.y - cy) * Math.sin(a), y: cy + (p.x - cx) * Math.sin(a) + (p.y - cy) * Math.cos(a) })));
};
const ids = (ink: readonly InkStroke[]) => ink.map((s) => s.id as string).sort();

describe("children's stacked sums", () => {
  it("a sum written on a slant, its rule drawn without a ruler (~9°), is one sum", () => {
    const sum = writeStack(["128", "+47"], "175");
    const ink = turned(toInkStrokes(sum.all), -9);
    const { stacks, lines } = board(ink);
    expect(stacks).toHaveLength(1);
    expect(lines).toHaveLength(1);
    expect(stacks[0].answer?.glyphs).toHaveLength(3);
  });

  it("a steep stroke (25°) under two rows is no rule", () => {
    const sum = writeStack(["128", "+47"], null);
    const rule = toInkStrokes([sum.rule])[0];
    const steep = moved(rule, (p) => ({ x: p.x, y: p.y + (p.x - rule.bounds.x) * Math.tan((25 * Math.PI) / 180) }));
    const { stacks } = board([...toInkStrokes(sum.rows.flat()), steep]);
    expect(stacks).toEqual([]);
  });

  it("the answer written much bigger than the sum is still its answer row", () => {
    const sum = writeStack(["286", "+680"], null);
    const rows = toInkStrokes(sum.rows.flat());
    const rule = toInkStrokes([sum.rule])[0];
    const answer = toInkStrokes(handRow("966", 400, rule.bounds.y + 12, 80, 12));
    const { stacks, lines } = board([...rows, rule, ...answer]);
    expect(stacks).toHaveLength(1);
    expect(lines).toHaveLength(1);
    expect(ids(lines[0].strokeIds.map((id) => ({ id }) as InkStroke))).toEqual(ids([...rows, rule, ...answer]));
  });

  it("her circle round the answer is set aside, read with nothing", () => {
    const sum = writeStack(["13", "\\times 4"], "52");
    const ink = toInkStrokes(sum.all);
    const answer = toInkStrokes(sum.answer);
    const a = boxOf(answer.flatMap((s) => s.segments.flat()));
    const cx = a.x + a.w / 2;
    const cy = a.y + a.h / 2;
    const circle = stroke(
      "shape:circle",
      Array.from({ length: 48 }, (_, i) => ({ x: cx + Math.cos((i / 44) * 2 * Math.PI) * (a.w * 0.9 + 20), y: cy + Math.sin((i / 44) * 2 * Math.PI) * (a.h * 0.9 + 14) })),
    );
    const { stacks, lines } = board([...ink, circle]);
    expect(stacks).toHaveLength(1);
    expect(stacks[0].marks).toContain("shape:circle");
    expect(lines).toHaveLength(1);
    expect(lines[0].strokeIds).not.toContain("shape:circle");
    expect(stacks[0].answer?.glyphs).toHaveLength(2);
  });

  it("a `+` hung low (its upright under the row) and a `7`'s level bar stay in their row", () => {
    const sum = writeStack(["348", "+276"], "624");
    const ink = toInkStrokes(sum.all);
    const row = toInkStrokes(sum.rows[1]);
    const r = boxOf(row.flatMap((s) => s.segments.flat()));
    const plus = row.filter((s) => s.bounds.x + s.bounds.w < r.x + 0.2 * r.w).map((s) => s.id);
    expect(plus.length).toBeGreaterThan(0);
    const drop = 0.35 * r.h;
    const low = ink.map((s) => (plus.includes(s.id) ? moved(s, (p) => ({ x: p.x, y: p.y + drop })) : s));
    const bar = stroke("shape:bar", [
      { x: r.x + 0.45 * r.w, y: r.y + 0.5 * r.h },
      { x: r.x + 0.62 * r.w, y: r.y + 0.5 * r.h },
    ]);
    const { stacks, lines } = board([...low, bar]);
    expect(stacks).toHaveLength(1);
    expect(stacks[0].rows).toHaveLength(2);
    expect(lines).toHaveLength(1);
  });

  it("rows of full-size digits that touch (a tall `9` under a `7`) are two rows", () => {
    const size = 40;
    const top = 200;
    const upper = toInkStrokes(handRow("27", 400, top, size, 3));
    const ub = boxOf(upper.flatMap((s) => s.segments.flat()));
    const lowerRaw = toInkStrokes(handRow("+19", 400, top, size, 4));
    const lb = boxOf(lowerRaw.flatMap((s) => s.segments.flat()));
    const lower = lowerRaw.map((s) => moved(s, (p) => ({ x: p.x, y: p.y + (ub.y + ub.h) - lb.y })));
    const lowBottom = Math.max(...lower.map((s) => s.bounds.y + s.bounds.h));
    const rule = toInkStrokes([handRule(lb.x - 6, 406, lowBottom + 8)])[0];
    const answer = toInkStrokes(handRow("46", 400, lowBottom + 18, size, 9));
    const { stacks, lines } = board([...upper, ...lower, rule, ...answer]);
    expect(stacks).toHaveLength(1);
    expect(stacks[0].rows).toHaveLength(2);
    expect(lines).toHaveLength(1);
  });
});
