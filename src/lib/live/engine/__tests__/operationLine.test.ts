import { beforeAll, describe, expect, it } from "vitest";
import type { LineAnalysis, LiveEngine } from "../../contracts";
import { analyzeColumn, localSolve } from "../../localSolve";
import { planHandwriting } from "../../handwriting";
import { getEngine } from "..";
import { barDivisionLatex, judgeOperation, OPERATION_NOTES, operandMath, operandValue, parseOperationLine, sameOperand, sidesOf } from "../operationLine";

/**
 * Both-sides operation lines (`engine/operationLine.ts`): `-3 \quad -3` under `2x + 3 = 11`, `\div 2`
 * under `2\sin x = 1`, a bar with a `2` under it. The reads are the ones Mathpix returned for the
 * tutor's hand writing them (see the module comment).
 */

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

/** `latex` under `above` (analysed first, as the loop does), the column's context. */
function under(above: string, latex: string): LineAnalysis {
  const [, a] = analyzeColumn(engine, [above, latex], "feedback");
  return a!;
}

describe("the grammar", () => {
  it.each([
    // what Mathpix returned for the ink
    ["\\begin{array}{ll}\n-3 & -3\n\\end{array}", "subtract", ["3", "3"]],
    ["-3 \\quad-3", "subtract", ["3", "3"]],
    ["-3 \\quad-4", "subtract", ["3", "4"]],
    ["\\div 2 \\div 2", "divide", ["2", "2"]],
    ["\\div 4 \\div 4", "divide", ["4", "4"]],
    ["\\times 3 \\times 3", "multiply", ["3", "3"]],
    ["+5+5", "add", ["5", "5"]],
    ["-2 x-2 x", "subtract", ["2x", "2x"]],
    ["-\\frac{1}{2} \\quad-\\frac{1}{2}", "subtract", ["\\frac{1}{2}", "\\frac{1}{2}"]],
    ["/ 2 \\quad / 2", "divide", ["2", "2"]],
    // and the other spellings a class writes
    ["-3 \\qquad - 3", "subtract", ["3", "3"]],
    ["-3-3", "subtract", ["3", "3"]],
    ["\\cdot 3 \\cdot 3", "multiply", ["3", "3"]],
    ["\\cdot 3 \\quad \\cdot 3", "multiply", ["3", "3"]],
    ["/2 /2", "divide", ["2", "2"]],
    ["\\frac{}{2} \\quad \\frac{}{2}", "divide", ["2", "2"]],
    ["\\div (-3) \\quad \\div (-3)", "divide", ["-3", "-3"]],
    ["\\times -2 \\quad \\times -2", "multiply", ["-2", "-2"]],
    ["-x \\quad -x", "subtract", ["x", "x"]],
    ["+ 3x^2 + 3x^{2}", "add", ["3x^{2}", "3x^{2}"]],
    ["-3 -3 -3", "subtract", ["3", "3", "3"]],
    ["÷2 ÷2", "divide", ["2", "2"]],
  ])("%s is an operation under each side", (latex, op, operands) => {
    expect(parseOperationLine(latex)).toEqual({ op, operands, form: "both" });
  });

  it.each([
    ["\\div 2", "2"],
    ["/2", "2"],
    ["\\frac{}{2}", "2"],
    ["\\frac{\\square}{2}", "2"],
    ["\\overline{2}", "2"],
    ["\\div \\frac{1}{2}", "\\frac{1}{2}"],
    ["\\div(-3)", "-3"],
    ["\\div \\left( -3 \\right)", "-3"],
  ])("%s is a divisor written once", (latex, operand) => {
    expect(parseOperationLine(latex)).toEqual({ op: "divide", operands: [operand], form: "once" });
  });

  it.each([
    ["-3", "a number"],
    ["+5", "a number"],
    ["3.3", "Mathpix's read of `·3 ·3`: a decimal"],
    ["1212", "Mathpix's read of `/2 /2`: a number"],
    ["-3 + 3", "two different operations"],
    ["-3x + 2", "an expression"],
    ["2x - 3", "an expression"],
    ["-3 - 3 = -6", "arithmetic with its answer"],
    ["2x = 8", "an equation"],
    ["x > 4", "an inequality"],
    ["\\div", "no operand"],
    ["-3 -3 -3 -3", "four operands"],
    ["\\begin{array}{l} -3 \\\\ -3 \\end{array}", "two rows"],
    ["-\\sqrt{2} -\\sqrt{2}", "not a simple term"],
    ["\\sin x", "a function"],
    ["", "nothing"],
  ])("%s is not one (%s)", (latex) => {
    expect(parseOperationLine(latex)).toBeNull();
  });

  it("reads operands' values, letters and mathjs sources", () => {
    expect(operandValue("3")).toBe(3);
    expect(operandValue("-3")).toBe(-3);
    expect(operandValue("\\frac{1}{2}")).toBe(0.5);
    expect(operandValue("0")).toBe(0);
    expect(operandValue("2x")).toBeNull();
    expect(operandMath("2x")).toBe("(2*x)");
    expect(operandMath("-3")).toBe("(-3)");
    expect(operandMath("\\frac{1}{2}")).toBe("(1/2)");
    expect(operandMath("x^{2}")).toBe("x^2");
    expect(operandMath("\\frac{x}{2}")).toBe("(x/2)");
    expect(sameOperand("\\frac{1}{2}", "0.5")).toBe(true);
    expect(sameOperand("2x", "2 x")).toBe(true);
    expect(sameOperand("3", "4")).toBe(false);
    expect(sidesOf("2 * x + 3 == 11")).toBe(2);
    expect(sidesOf("-3 < 2 * x + 1 < 7")).toBe(3);
    expect(sidesOf("2 * x <= 8")).toBe(2);
    // the compound lines as the engine holds them (`compound.ts`)
    expect(sidesOf("max((- 3) - (2 * x + 1), (2 * x + 1) - (7)) < 0")).toBe(3);
    expect(sidesOf("min((x) - (2), (3) - (x)) < 0")).toBe(0);
    expect(sidesOf("((2 * x - 3) - (5)) * ((2 * x - 3) - (-5)) == 0")).toBe(0);
  });
});

describe("the verdict against the relation above", () => {
  const judge = (latex: string, relation: string | null) => judgeOperation(parseOperationLine(latex)!, relation);

  it("the same valid operation on every side is right", () => {
    expect(judge("-3 \\quad -3", "2 * x + 3 == 11").verdict).toBe("ok");
    expect(judge("\\div 2", "2 * sin(x) == 1").verdict).toBe("ok");
    expect(judge("\\div -2 \\quad \\div -2", "-2 * x < 6").verdict).toBe("ok");
    expect(judge("-1 -1 -1", "-3 < 2 * x + 1 < 7").verdict).toBe("ok");
  });

  it("different operands, or by 0, are wrong", () => {
    expect(judge("-3 \\quad -4", "2 * x + 3 == 11")).toEqual({ verdict: "mismatch", note: OPERATION_NOTES.different });
    expect(judge("-3x \\quad -3", "2 * x + 3 == 11").verdict).toBe("mismatch");
    expect(judge("\\div 0", "2 * x == 8")).toEqual({ verdict: "mismatch", note: OPERATION_NOTES.byZero });
    expect(judge("\\times 0 \\times 0", "x / 3 == 4").verdict).toBe("mismatch");
  });

  it("by a letter, or the wrong number of operands, is not judged", () => {
    expect(judge("\\div x \\quad \\div x", "x ^ 2 == 3 * x").verdict).toBe("none");
    expect(judge("-3 \\quad -3", "-3 < 2 * x + 1 < 7").verdict).toBe("none");
    expect(judge("\\div 2", null).verdict).toBe("none");
  });
});

describe("analyzeLine: an operation line under an equation", () => {
  it.each([
    ["2x + 3 = 11", "-3 \\quad-3", "ok", "2x = 8"],
    ["2x + 3 = 11", "\\begin{array}{ll}\n-3 & -3\n\\end{array}", "ok", "2x = 8"],
    ["2x = 8", "\\div 2 \\div 2", "ok", "x = 4"],
    ["2 \\sin x = 1", "\\div 2", "ok", "\\sin x = \\frac{1}{2}"],
    ["\\frac{x}{3} = 4", "\\times 3 \\times 3", "ok", "x = 12"],
    ["x - 5 = 2", "+5+5", "ok", "x = 7"],
    ["5x = 2x + 9", "-2 x-2 x", "ok", "3x = 9"],
    ["x + \\frac{1}{2} = 3", "-\\frac{1}{2} \\quad-\\frac{1}{2}", "ok", "x = \\frac{5}{2}"],
    ["4x = 12", "\\div 4 \\div 4", "ok", "x = 3"],
    ["-2x < 6", "\\div (-2) \\quad \\div (-2)", "ok", "x > -3"],
    ["2x + 3 > 11", "-3 -3", "ok", "2x > 8"],
    // a chain: every part, but the engine holds it as `max(…) < 0` and writes no result
    ["-3 < 2x + 1 < 7", "-1 -1 -1", "ok", ""],
    ["-3 < 2x + 1 < 7", "-1 -1", "none", ""],
    ["2 \\sin x + 1 = 2", "-1 \\quad -1", "ok", "2\\sin x = 1"],
    ["3x + 6 = 21", "\\div 3 \\div 3", "ok", "x + 2 = 7"],
    ["2x + 3 = 11", "-3 \\quad-4", "mismatch", ""],
    ["2x = 8", "\\div 0", "mismatch", ""],
    ["x^{2} = 3x", "\\div x \\quad \\div x", "none", ""],
  ])("%s, then %s: %s", (above, latex, verdict, result) => {
    const a = under(above, latex);
    expect(a.kind).toBe("operation");
    expect(a.verdict).toBe(verdict);
    expect(a.operation?.result ?? "").toBe(result);
    expect(a.resultLatex).toBe("");
  });

  it("the tutor's hand can write every result", () => {
    for (const r of ["2x = 8", "\\sin x = \\frac{1}{2}", "x > -3", "2\\sin x = 1", "x = \\frac{5}{2}"]) {
      expect(planHandwriting([r], { size: 28, seed: 1 }).unsupported).toEqual([]);
    }
  });

  it("with no relation above, a sum stays a sum and a divisor is not judged", () => {
    expect(engine.analyzeLine("-3 \\quad-3", { mode: "feedback" }).kind).toBe("expression");
    expect(engine.analyzeLine("-3-3", { mode: "feedback" }).kind).toBe("expression");
    const alone = engine.analyzeLine("\\div 2", { mode: "feedback" });
    expect(alone.kind).toBe("operation");
    expect(alone.verdict).toBe("none");
    // under an expression, `-3 - 3` is still arithmetic
    expect(under("3(x + 2) - x", "-3 - 3").kind).not.toBe("operation");
  });

  it("the line after an operation line is checked against the equation above it", () => {
    const col = (lines: string[]) => analyzeColumn(engine, lines, "feedback").map((a) => a?.verdict);
    expect(col(["2x + 3 = 11", "-3 \\quad -3", "2x = 8"])).toEqual(["none", "ok", "ok"]);
    expect(col(["2x + 3 = 11", "-3 \\quad -3", "2x = 14"])).toEqual(["none", "ok", "mismatch"]);
    // equivalent although it is not what the operation written gives: equivalence is what counts
    expect(col(["2x + 3 = 11", "-3 \\quad -3", "x = 4"])).toEqual(["none", "ok", "ok"]);
    expect(col(["2 \\sin x = 1", "\\div 2", "\\sin x = \\frac{1}{2}"])).toEqual(["none", "ok", "ok"]);
    expect(col(["2x + 3 = 11", "-3 \\quad -4", "2x = 7"])).toEqual(["none", "mismatch", "mismatch"]);
    // an inequality divided by a negative: the next line must turn the sign round
    expect(col(["-2x < 6", "\\div (-2) \\quad \\div (-2)", "x > -3"])).toEqual(["none", "ok", "ok"]);
    expect(col(["-2x < 6", "\\div (-2) \\quad \\div (-2)", "x < -3"])).toEqual(["none", "ok", "mismatch"]);
  });
});

describe("Solve with an operation line in the column", () => {
  it("solves the equation above it, not the operation", () => {
    expect(localSolve(engine, ["2x + 3 = 11", "-3 \\quad -3"])).toEqual({ source: "solveLatex", steps: ["2x = 8", "x = 4"] });
    expect(localSolve(engine, ["2x + 3 = 11", "-3 \\quad -3", "2x = 8"]).steps).toEqual(["x = 4"]);
    expect(localSolve(engine, ["2x + 3 = 11", "-3 \\quad -3", "2x = 8"], 1).steps).toEqual(["2x = 8", "x = 4"]);
    expect(localSolve(engine, ["\\div 2"]).source).toBeNull();
  });
});

describe("a division bar's read (`barDivisionLatex`)", () => {
  it.each([
    ["2", "\\div 2"],
    ["4", "\\div 4"],
    ["-3", "\\div (-3)"],
    ["\\text { -3 }", "\\div (-3)"],
    ["\\overline{2}", "\\div 2"],
    ["\\frac{}{2}", "\\div 2"],
    ["\\div 2", "\\div 2"],
    ["\\frac{1}{2}", "\\div \\frac{1}{2}"],
    ["x", "\\div x"],
    ["(-3)", "\\div (-3)"],
  ])("%s → %s", (read, latex) => {
    expect(barDivisionLatex(read)).toBe(latex);
  });

  it.each(["", "x = 2", "\\text{hello}", "2x + 1", "-3 \\quad -3"])("%s is not a divisor", (read) => {
    expect(barDivisionLatex(read)).toBeNull();
  });
});
