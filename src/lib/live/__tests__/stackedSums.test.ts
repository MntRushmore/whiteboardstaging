import { describe, expect, it } from "vitest";
import type { TLDrawShape } from "tldraw";
import type { InkStroke } from "../contracts";
import { splitInk } from "../diagrams";
import { findStackedSums, stackGrid, stackGroups } from "../stackedSums";
import { clusterLines } from "../strokeClusters";
import { fixtureFraction, handRow, handRule, inkAtZoom, toInkStrokes, writeStack } from "../__fixtures__/strokes";

/**
 * Stacked sums in the ink (`stackedSums.ts`): found before lines are formed, the block one line, its
 * carry and borrow marks in none — and every fraction still a fraction.
 */

/** What the board makes of this ink: the split (drawings, stacks) and the lines. */
function board(shapes: TLDrawShape[] | InkStroke[], zoom?: number) {
  const ink = "segments" in shapes[0] ? (shapes as InkStroke[]) : toInkStrokes(shapes as TLDrawShape[]);
  const split = splitInk(ink, [], { zoom });
  const lines = clusterLines(split.writing, [], stackGroups(split.stacks, ink), { zoom });
  return { ink, split, lines, stacks: split.stacks };
}

const idsOf = (shapes: readonly TLDrawShape[]) => shapes.map((s) => s.id as string).sort();

describe("the owner's sum: 286 + 680 = 966 with a carry over the 2", () => {
  it("is one stacked sum, read as ONE line; the carry is in no line", () => {
    const sum = writeStack(["286", "+680"], "966", { carries: [{ place: 2, digit: "1" }] });
    const { stacks, lines, split } = board(sum.all);
    expect(stacks).toHaveLength(1);
    expect(lines).toHaveLength(1);
    expect([...lines[0].strokeIds].sort()).toEqual(idsOf([...sum.rows.flat(), sum.rule, ...sum.answer]));
    expect([...stacks[0].marks].sort()).toEqual(idsOf(sum.marks));
    for (const m of sum.marks) expect(split.roles.get(m.id)?.role).toBe("carry");
    expect(stacks[0]).toMatchObject({ rule: sum.rule.id, more: false });
    expect(stacks[0].rows).toHaveLength(2);
    expect(stacks[0].answer?.glyphs).toHaveLength(3);
  });

  it("before: the rule was a fraction bar — `+680` over `966` one line, `286` another", () => {
    // what the clusterer alone makes of it (the bug's first half)
    const sum = writeStack(["286", "+680"], "966", { rowPitch: 44 });
    const lines = clusterLines(toInkStrokes(sum.all));
    const withRule = lines.find((l) => l.strokeIds.includes(sum.rule.id))!;
    expect(withRule.strokeIds).toEqual(expect.arrayContaining(idsOf([...sum.rows[1], ...sum.answer])));
    expect(lines.length).toBeGreaterThan(1);
  });

  it("empty, partial and complete answers", () => {
    expect(board(writeStack(["286", "+680"], null).all).stacks[0].answer).toBeNull();
    expect(board(writeStack(["286", "+680"], "66").all).stacks[0].answer?.glyphs).toHaveLength(2);
    expect(board(writeStack(["286", "+680"], "966").all).stacks[0].answer?.glyphs).toHaveLength(3);
  });

  it("the rule drawn with nothing over it yet is no sum: the rows are lines as before", () => {
    const sum = writeStack(["286", "+680"], null);
    const { stacks, lines } = board(sum.rows.flat());
    expect(stacks).toEqual([]);
    expect(lines).toHaveLength(2);
  });

  it("on a phone (five times bigger in page px) and an iPad, the same", () => {
    for (const zoom of [0.52, 0.2]) {
      const ink = inkAtZoom(toInkStrokes(writeStack(["286", "+680"], "966", { carries: [{ place: 2, digit: "1" }] }).all), zoom);
      const { stacks, lines } = board(ink, zoom);
      expect(stacks).toHaveLength(1);
      expect(stacks[0].marks).toHaveLength(1);
      expect(lines).toHaveLength(1);
    }
  });
});

describe("the layouts of grade-school column arithmetic", () => {
  it.each([
    ["taking away", ["52", "-17"], "35"],
    ["multiplying by one digit", ["23", "\\times 4"], "92"],
    ["three numbers", ["125", "48", "+302"], "475"],
    ["decimals on the point", ["3.50", "+12.25"], "15.75"],
    ["a one-digit sum", ["7", "+5"], "12"],
  ])("%s", (_name, rows, answer) => {
    const sum = writeStack(rows, answer);
    const { stacks, lines } = board(sum.all);
    expect(stacks).toHaveLength(1);
    expect(stacks[0].rows).toHaveLength(rows.length);
    expect(stacks[0].marks).toEqual([]);
    expect(lines).toHaveLength(1);
  });

  it("a rule drawn in two goes is one rule", () => {
    const sum = writeStack(["286", "+680"], "966");
    const rule = toInkStrokes([sum.rule])[0].bounds;
    const y = rule.y + rule.h / 2;
    const halves = [handRule(rule.x, rule.x + rule.w * 0.55, y), handRule(rule.x + rule.w * 0.6, rule.x + rule.w, y + 1)];
    const { stacks, lines } = board([...sum.rows.flat(), ...halves, ...sum.answer]);
    expect(stacks).toHaveLength(1);
    expect(lines).toHaveLength(1);
    expect(lines[0].strokeIds).toEqual(expect.arrayContaining(idsOf(halves)));
  });

  it("carries over two columns, four digits", () => {
    const sum = writeStack(["4807", "+3295"], "8102", { carries: [{ place: 1, digit: "1" }, { place: 2, digit: "1" }] });
    const { stacks } = board(sum.all);
    expect([...stacks[0].marks].sort()).toEqual(idsOf(sum.marks));
    expect(stacks[0].answer?.glyphs).toHaveLength(4);
  });

  it("a borrow: the crossed-out digit's stroke and the small digit over it are marks; the digit itself is read", () => {
    const sum = writeStack(["52", "-17"], "35", { borrow: { place: 1, digit: "4" } });
    const { stacks, lines } = board(sum.all);
    expect([...stacks[0].marks].sort()).toEqual(idsOf(sum.marks));
    expect(lines[0].strokeIds).toEqual(expect.arrayContaining(idsOf(sum.rows[0])));
    expect(stacks[0].rows[0].glyphs).toHaveLength(2);
  });

  it("long multiplication: the rows under the answer are part of the block (the read will not be one sum)", () => {
    const sum = writeStack(["23", "\\times 45"], "115");
    const answerBottom = Math.max(...toInkStrokes(sum.answer).map((s) => s.bounds.y + s.bounds.h));
    const second = handRow("920", 400, answerBottom + 10, 40, 30);
    const secondBottom = Math.max(...toInkStrokes(second).map((s) => s.bounds.y + s.bounds.h));
    const rule2 = handRule(330, 406, secondBottom + 8);
    const total = handRow("1035", 400, secondBottom + 18, 40, 31);
    const { stacks, lines } = board([...sum.all, ...second, rule2, ...total]);
    expect(stacks).toHaveLength(1);
    expect(stacks[0].more).toBe(true);
    expect(lines).toHaveLength(1);
  });

  it("two sums side by side, and two one under the other, are two", () => {
    const a = writeStack(["286", "+680"], "966");
    const b = writeStack(["52", "-17"], "35", { right: 700 });
    expect(board([...a.all, ...b.all]).stacks).toHaveLength(2);
    const c = writeStack(["23", "\\times 4"], "92", { top: 420 });
    const { stacks, lines } = board([...a.all, ...c.all]);
    expect(stacks).toHaveLength(2);
    expect(lines).toHaveLength(2);
  });
});

describe("fractions are still fractions", () => {
  /** one line, no stacked sum */
  function oneFraction(shapes: TLDrawShape[]) {
    const { stacks, lines } = board(shapes);
    expect(stacks).toEqual([]);
    expect(lines).toHaveLength(1);
  }

  it("\\frac{3}{4}", () => oneFraction(handRow("\\frac{3}{4}", 400, 200)));
  it("x = \\frac{a+b}{2}", () => oneFraction(handRow("x = \\frac{a+b}{2}", 400, 200)));
  it("a fraction with a + in its numerator: \\frac{1+2}{3}", () => oneFraction(handRow("\\frac{1+2}{3}", 400, 200)));
  it("a fraction with + 680 over 966 written as one: \\frac{+680}{966}", () => oneFraction(handRow("\\frac{+680}{966}", 400, 200)));
  it("a mixed number: 2\\frac{3}{4}", () => oneFraction(handRow("2\\frac{3}{4}", 400, 200)));
  it("a sum of fractions: \\frac{1}{2} + \\frac{1}{3}", () => oneFraction(handRow("\\frac{1}{2} + \\frac{1}{3}", 400, 200)));
  it("the fixture's \\frac{1}{2} + x", () => oneFraction(fixtureFractionShapes()));
  // a superscript over its base is no row over a row; an `=` bar beside the fraction is no rule
  it.each(["\\frac{x^{5}}{x^{2}}", "\\frac{x^{3} - 8}{x - 2}", "\\frac{12x^{5}y^{2}}{4x^{2}y^{5}}", "\\frac{dy}{dx} =", "\\cos 60^{\\circ} = \\frac{8}{x}"])("%s", (latex) => {
    expect(board(handRow(latex, 400, 200)).stacks).toEqual([]);
  });

  it("a fraction written under another: its numerator and the denominator above are no stacked sum", () => {
    const { stacks, lines } = board([...handRow("\\frac{3}{4}", 400, 200), ...handRow("\\frac{1}{2}", 400, 300, 40, 5)]);
    expect(stacks).toEqual([]);
    expect(lines).toHaveLength(2);
  });

  it("a fraction under a line of working", () => {
    const { stacks } = board([...handRow("2x + 3 = 11", 400, 200), ...handRow("\\frac{x}{2}", 300, 250, 40, 5)]);
    expect(stacks).toEqual([]);
  });

  it("equations added for elimination (an = in the rows)", () => {
    const sum = writeStack(["x + y = 10", "x - y = 2"], "2x = 12");
    expect(board(sum.all).stacks).toEqual([]);
  });

  it("a bar under an equation with the divisor under it is still a division bar", () => {
    const eq = handRow("2x = 8", 400, 200);
    const eqInk = toInkStrokes(eq);
    const bottom = Math.max(...eqInk.map((s) => s.bounds.y + s.bounds.h));
    const left = Math.min(...eqInk.map((s) => s.bounds.x));
    const shapes = [...eq, handRule(left - 4, 404, bottom + 8), ...handRow("2", 380, bottom + 18, 40, 7)];
    const { split } = board(shapes);
    expect(split.stacks).toEqual([]);
    expect(split.bars).toHaveLength(1);
  });
});

function fixtureFractionShapes(): TLDrawShape[] {
  return fixtureFraction();
}

describe("the grid of its columns", () => {
  it("puts each place under its column, and the student's answer and carries in theirs", () => {
    const sum = writeStack(["286", "+680"], "966", { carries: [{ place: 2, digit: "1" }] });
    const [stack] = findStackedSums(toInkStrokes(sum.all), 24);
    const grid = stackGrid(stack, [
      { digits: 3, last: 0 },
      { digits: 3, last: 0 },
    ]);
    const six = toInkStrokes(sum.rows[0]).sort((a, b) => b.bounds.x - a.bounds.x)[0].bounds;
    expect(Math.abs(grid.x(0) - (six.x + six.w / 2))).toBeLessThan(4);
    expect(grid.x(1)).toBeLessThan(grid.x(0));
    expect(grid.x(3)).toBeCloseTo(grid.x(2) - grid.pitch, 5);
    expect(grid.answerLast).toBe(0);
    expect(grid.answerGlyph(2)).not.toBeNull();
    expect([...grid.carried]).toEqual([2]);
    // the answer row is under the rule; a carry over the top row
    expect(grid.answerBaseline).toBeGreaterThan(stack.ruleRect.y);
    expect(grid.carryBaseline).toBeLessThan(stack.rows[0].rect.y);
  });

  it("a digit written under the hundreds first is the hundreds", () => {
    const sum = writeStack(["286", "+680"], null);
    const ruleBottom = toInkStrokes([sum.rule])[0].bounds.y + 2;
    const stack0 = findStackedSums(toInkStrokes(sum.all), 24)[0];
    const hundreds = stackGrid(stack0, [{ digits: 3, last: 0 }, { digits: 3, last: 0 }]).x(2);
    const nine = handRow("9", hundreds + 7, ruleBottom + 10, 40, 12);
    const [stack] = findStackedSums(toInkStrokes([...sum.all, ...nine]), 24);
    expect(stackGrid(stack, [{ digits: 3, last: 0 }, { digits: 3, last: 0 }]).answerLast).toBe(2);
  });
});
