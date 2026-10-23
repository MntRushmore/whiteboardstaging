import { describe, expect, it } from "vitest";
import type { InkStroke } from "../contracts";
import { splitInk } from "../diagrams";
import { separatorRules } from "../separatorRules";
import { clusterLines } from "../strokeClusters";
import { handRow, handRule, toInkStrokes } from "../__fixtures__/strokes";

/**
 * A line drawn right across the work under a step (`separatorRules.ts`), re-drawn in the synthetic
 * hand from the real-ink bench's class: three right steps with a line under each were read as one
 * nested fraction (`\frac{\frac{-5}{3x-15}}{x=5}`) and got no tick.
 */

const right = 520;
const row = (latex: string, top: number, seed: number) => toInkStrokes(handRow(latex, right, top, 40, seed));
const rule = (y: number, x0 = 160, x1 = right + 20) => toInkStrokes([handRule(x0, x1, y)])[0];
const bottomOf = (ink: InkStroke[]) => Math.max(...ink.map((s) => s.bounds.y + s.bounds.h));

function board(ink: InkStroke[]) {
  const split = splitInk(ink, []);
  return { split, lines: clusterLines(split.writing, [], []) };
}

describe("separator rules", () => {
  it("a line under each step, the next step under it: set aside, each step a line of its own", () => {
    const a = row("-5 \\quad -5", 100, 3);
    const s1 = rule(bottomOf(a) + 14);
    const b = row("3x = 15", s1.bounds.y + 16, 4);
    const s2 = rule(bottomOf(b) + 14);
    const c = row("x = 5", s2.bounds.y + 16, 5);
    const ink = [...a, s1, ...b, s2, ...c];
    const { split, lines } = board(ink);
    expect(split.roles.get(s1.id as string)?.role).toBe("separator");
    expect(split.roles.get(s2.id as string)?.role).toBe("separator");
    expect(lines).toHaveLength(3);
    for (const step of [a, b, c]) expect(lines.some((l) => step.every((s) => l.strokeIds.includes(s.id)))).toBe(true);
  });

  it("before: the lines were fraction bars, the steps one line", () => {
    const a = row("3x = 15", 100, 4);
    const s1 = rule(bottomOf(a) + 14);
    const c = row("x = 5", s1.bounds.y + 16, 5);
    const lines = clusterLines([...a, s1, ...c]);
    expect(lines).toHaveLength(1);
  });

  it("a bar under a whole equation with the divisors under it (divide both sides) is no separator", () => {
    const a = row("3x = 15", 100, 4);
    const bar = rule(bottomOf(a) + 10);
    const d = row("3 \\qquad 3", bar.bounds.y + 14, 6);
    expect(separatorRules([...a, bar, ...d], 24).size).toBe(0);
  });

  it("a fraction beside an `=` (`x = \\frac{25}{5}`) keeps its bar", () => {
    const num = row("25", 100, 7);
    const bar = rule(bottomOf(num) + 6, Math.min(...num.map((s) => s.bounds.x)) - 8, right + 8);
    const den = row("5", bar.bounds.y + 10, 8);
    const lhs = toInkStrokes(handRow("x =", Math.min(...num.map((s) => s.bounds.x)) - 20, bar.bounds.y - 14, 40, 9));
    expect(separatorRules([...lhs, ...num, bar, ...den], 24).size).toBe(0);
  });

  it("a line under the last step with nothing under it yet is left as it was", () => {
    const a = row("x = 5", 100, 5);
    const under = rule(bottomOf(a) + 10);
    expect(separatorRules([...a, under], 24).size).toBe(0);
  });
});
