/**
 * "The tutor writes it out" on a stacked sum (docs/TUTOR-WRITES.md): the next column's digit and its
 * carry, in their columns; long multiplication a row at a time, then the rows added; the last column
 * held back unless asked for and allowed; words only when it cannot be sure.
 */
import { describe, expect, it } from "vitest";
import type { Rect } from "../contracts";
import type { StackedSum, StackRow } from "../stackedSums";
import { stackStepOf, type StackStepResult } from "../stackStep";

/** digit height and the column pitch of the synthetic ink (page px) */
const DH = 30;
const PITCH = 24;
/** the ones column's left edge */
const RIGHT = 400;

/** A row of glyphs right-aligned on the ones column (`text` may start with an operator). */
function row(text: string, y: number): StackRow {
  const chars = [...text.replace(/\\times/, "×")];
  const glyphs: Rect[] = chars.map((_, i) => ({ x: RIGHT - (chars.length - 1 - i) * PITCH, y, w: 18, h: DH }));
  const x0 = glyphs[0].x;
  return { rect: { x: x0, y, w: RIGHT + 18 - x0, h: DH }, glyphs };
}

/** A stacked sum in ink: its rows over a rule, and the answer row under it ('' for none). */
function sum(rows: string[], answer = ""): StackedSum {
  const built = rows.map((r, i) => row(r, 100 + i * 45));
  const ruleY = 100 + rows.length * 45 - 6;
  const ruleRect = { x: RIGHT - 4 * PITCH, y: ruleY, w: 4 * PITCH + 30, h: 3 };
  return {
    rule: "shape:rule" as StackedSum["rule"],
    strokeIds: [],
    marks: [],
    markRects: [],
    rows: built,
    answer: answer ? row(answer, ruleY + 12) : null,
    more: false,
    ruleRect,
    digit: DH,
  };
}

function latex(rows: string[], answer = ""): string {
  return `\\begin{array}{r} ${rows.join(" \\\\ ")} \\\\ \\hline ${answer} \\end{array}`;
}

/** Asks until the column work ends; each answer feeds the parts written back as the tutor's. */
function ask(rows: string[], answer = "", allow = false, max = 8): StackStepResult[] {
  const out: StackStepResult[] = [];
  const tutor: string[] = [];
  for (let i = 0; i < max; i++) {
    const r = stackStepOf({ latex: latex(rows, answer), stack: sum(rows, answer), tutor, answer: allow, lineId: "l1" });
    out.push(r);
    if (r.kind !== "step") break;
    tutor.push(...r.parts.map((p) => p.part));
  }
  return out;
}

const centre = (r: StackStepResult, part: string) => {
  const p = r.parts.find((x) => x.part === part)!;
  return p.plan.bounds.x + p.plan.bounds.w / 2;
};
/** the centre of place `p`'s column in the synthetic ink */
const column = (p: number) => RIGHT + 9 - p * PITCH;

describe("column addition", () => {
  it("writes the next column's digit, then its carry over the next column, one column per ask", () => {
    const [ones, tens, last] = ask(["286", "+680"]);
    expect(ones).toMatchObject({ kind: "step", why: "Ones: 6 + 0 = 6.", key: "+ 286 680" });
    expect(ones.parts.map((p) => [p.part, p.text])).toEqual([["a0", "6"]]);
    expect(Math.abs(centre(ones, "a0") - column(0))).toBeLessThan(3);
    expect(tens.parts.map((p) => [p.part, p.text])).toEqual([["a1", "6"], ["c2", "1"]]);
    expect(tens.why).toBe("Tens: 8 + 8 = 16. Write 6 and carry the 1.");
    expect(Math.abs(centre(tens, "c2") - column(2))).toBeLessThan(3);
    // the carry sits over the top row, the digits under the rule
    const carry = tens.parts.find((p) => p.part === "c2")!.plan.bounds;
    expect(carry.y + carry.h).toBeLessThan(100);
    expect(tens.parts[0].plan.bounds.y).toBeGreaterThan(100 + 2 * 45 - 6);
    // the last column is the answer: held back, its digit not said
    expect(last).toMatchObject({ kind: "lastStep", parts: [] });
    expect(last.why).toBe("One column left: add the hundreds, and the 1 you carried. You can do this one.");
  });

  it("writes the last column when the answer is asked for and allowed", () => {
    const r = stackStepOf({ latex: latex(["286", "+680"]), stack: sum(["286", "+680"]), tutor: ["a0", "a1", "c2"], answer: true });
    expect(r.kind).toBe("answer");
    expect(r.parts.map((p) => [p.part, p.text])).toEqual([["a2", "9"]]);
    expect(r.why).toBe("Hundreds: 2 + 6 + the 1 you carried = 9.");
  });

  it("goes on from the kid's own digits", () => {
    const r = stackStepOf({ latex: latex(["286", "+680"], "6"), stack: sum(["286", "+680"], "6"), tutor: [] });
    expect(r.parts.map((p) => p.part)).toEqual(["a1", "c2"]);
  });

  it("is done when the answer is all there and right", () => {
    expect(stackStepOf({ latex: latex(["286", "+680"], "966"), stack: sum(["286", "+680"], "966") }).kind).toBe("solved");
  });

  it("writes the right digit under a wrong one, with the engine's note", () => {
    const r = stackStepOf({ latex: latex(["286", "+680"], "866"), stack: sum(["286", "+680"], "866") });
    expect(r.kind).toBe("fix");
    expect(r.parts.map((p) => [p.part, p.text])).toEqual([["f2", "9"]]);
    expect(r.why).toBe("Add the 1 you carried to the hundreds.");
  });

  it("only words on a read it is not sure of", () => {
    const r = stackStepOf({ latex: latex(["286", "+680"], "866"), stack: sum(["286", "+680"], "866"), confidence: 0.5 });
    expect(r).toMatchObject({ kind: "unsure", parts: [] });
  });
});

describe("column subtraction", () => {
  it("says the borrow in words, column by column", () => {
    const [ones, last] = ask(["52", "-17"]);
    expect(ones.parts.map((p) => [p.part, p.text])).toEqual([["a0", "5"]]);
    expect(ones.why).toBe("Ones: 2 is less than 7, so borrow 1 from the tens. 12 - 7 = 5.");
    expect(last.kind).toBe("lastStep");
    const r = stackStepOf({ latex: latex(["52", "-17"]), stack: sum(["52", "-17"]), tutor: ["a0"], answer: true });
    expect(r.parts.map((p) => p.text)).toEqual(["3"]);
    expect(r.why).toBe("Tens: The 5 lent 1, so it's 4 now. 4 - 1 = 3.");
  });
});

describe("multiplication", () => {
  it("by one digit: the digit and the carry", () => {
    const [ones] = ask(["23", "\\times 4"]);
    expect(ones.parts.map((p) => [p.part, p.text])).toEqual([["a0", "2"], ["c1", "1"]]);
    expect(ones.why).toBe("Ones: 3 × 4 = 12. Write 2 and carry the 1.");
  });

  it("long: a row at a time, then a rule and the rows added", () => {
    const steps = ask(["46", "\\times 23"]);
    const [r0, r1, s0, s1, last] = steps;
    expect(r0.why).toBe("Ones row: 46 × 3 = 138.");
    expect(r0.parts.map((p) => p.text).join("")).toBe("831");
    expect(r0.parts.at(-1)!.part).toBe("r0");
    expect(r1.why).toBe("Tens row: 46 × 20 = 920. The 0 holds the ones place.");
    expect(r1.parts.map((p) => p.text).reverse().join("")).toBe("920");
    // the second row is under the first, in the same columns
    expect(r1.parts[0].plan.bounds.y).toBeGreaterThan(r0.parts[0].plan.bounds.y + DH);
    expect(Math.abs(r1.parts[0].plan.bounds.x + r1.parts[0].plan.bounds.w / 2 - column(0))).toBeLessThan(3);
    expect(s0.parts.map((p) => p.part)).toEqual(["rule", "s0"]);
    expect(s0.why).toBe("Now add the rows. Ones: 8 + 0 = 8.");
    expect(s1.parts.map((p) => [p.part, p.text])).toEqual([["s1", "5"]]);
    expect(last.kind).toBe("lastStep");
    const done = stackStepOf({ latex: latex(["46", "\\times 23"]), stack: sum(["46", "\\times 23"]), tutor: ["r0", "r1", "rule", "s0", "s1"], answer: true });
    expect(done.parts.map((p) => p.text).join("")).toBe("01");
    expect(done.kind).toBe("answer");
  });

  it("goes on from the kid's own first row", () => {
    const r = stackStepOf({ latex: latex(["46", "\\times 23"], "138"), stack: sum(["46", "\\times 23"], "138"), inkBottom: 100 + 2 * 45 + 6 + DH });
    expect(r.why).toBe("Tens row: 46 × 20 = 920. The 0 holds the ones place.");
    expect(r.parts.at(-1)!.part).toBe("r1");
  });
});
