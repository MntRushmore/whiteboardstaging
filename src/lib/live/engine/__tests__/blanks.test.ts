import { beforeAll, describe, expect, it } from "vitest";
import type { LiveEngine } from "../../contracts";
import { layoutSteps } from "@/lib/hand/writeSteps";
import { analyzeColumn, localSolve } from "../../localSolve";
import { blankAsUnknown, blankBack, boardBlanks, compareBlank, filledBlank } from "../blanks";
import { isArithmetic } from "../columnWork";
import { getEngine } from "..";

/**
 * A worksheet's blanks (`blanks.ts`). Prod 2026-10: "fill in the blank addition for 1st grade" came
 * back as `4 + \square = 9` and `\square + 6 = 10`; the engine read the box as a mark and threw it
 * away (`4 + = 9`), the board could check nothing, and the student got "I couldn't check those
 * problems, so I didn't write them."
 */

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

describe("blanks: read as the unknown", () => {
  it("a blank in a relation is the unknown, however it is written", () => {
    for (const [line, want] of [
      ["4 + \\square = 9", "4 + x = 9"],
      ["\\square + 6 = 10", "x + 6 = 10"],
      ["? \\times 6 = 42", "x \\times 6 = 42"],
      ["63 \\div ? = 9", "63 \\div x = 9"],
      ["7 + \\_\\_ = 12", "7 + x = 12"],
      ["7 + \\underline{\\quad} = 12", "7 + x = 12"],
      ["\\boxed{\\phantom{0}} + 3 = 8", "x + 3 = 8"],
      ["7 \\times \\boxed{} = 56", "7 \\times x = 56"],
      ["\\frac{2}{3} = \\frac{\\square}{12}", "\\frac{2}{3} = \\frac{x}{12}"],
      ["12 = 7 + \\square", "12 = 7 + x"],
      ["\\square = 7 + 5", "x = 7 + 5"],
      ["2 : 5 = 6 : \\square", "2 : 5 = 6 : x"],
      ["5 + 3 > \\square", "5 + 3 > x"],
    ] as const) {
      expect(blankAsUnknown(line)?.latex, line).toBe(want);
    }
  });

  it("not a blank to solve for: the answer's place, a checkbox, a question, letters, two blanks, no relation", () => {
    for (const line of [
      "1 + 2 = \\square", // the place for the answer: the engine reads `1 + 2 =` already
      "7 \\times 8 = ?",
      "\\square 2 + 3 = 5", // a checkbox before the line
      "5^{2} + 12^{2} \\stackrel{?}{=} 13^{2}", // "is it equal?"
      "x + \\square = 5", // letters of its own
      "3 \\, \\mathrm{ft} = \\square \\, \\mathrm{in}", // units
      "\\square + \\square = 10", // two blanks
      "4 + \\square", // no relation
      "2x + 3 = 11",
    ]) {
      expect(blankAsUnknown(line), line).toBeNull();
    }
  });

  it("written back with the blank in the letter's place; a number before it a product a child can read", () => {
    expect(blankBack("x = 5", "x")).toBe("\\square = 5");
    expect(blankBack("6x = 42", "x")).toBe("6 \\times \\square = 42");
    expect(blankBack("3x = 2(12)", "x")).toBe("3 \\times \\square = 2(12)");
    expect(blankBack("x \\cdot \\frac{63}{x} = x \\cdot 9", "x")).toBe("\\square \\cdot \\frac{63}{\\square} = \\square \\cdot 9");
    expect(blankBack("\\max(2, 3)", "x")).toBe("\\max(2, 3)");
  });

  it("the engine reads the line with its blank and solves it, the blank written back", () => {
    for (const [line, answer] of [
      ["4 + \\square = 9", "\\square = 5"],
      ["\\square + 6 = 10", "\\square = 4"],
      ["\\square \\times 8 = 56", "\\square = 7"],
      ["42 \\div \\square = 6", "\\square = 7"],
      ["\\frac{2}{3} = \\frac{\\square}{12}", "\\square = 8"],
      ["4{,}582 = 4000 + \\square + 80 + 2", "\\square = 500"],
    ] as const) {
      const [a] = analyzeColumn(engine, [line], "answer");
      expect(a?.kind, line).toBe("equation");
      const solved = localSolve(engine, [line]);
      expect(solved.steps.at(-1), line).toBe(answer);
      expect(solved.steps.every((s) => !/(^|[^\\a-z])x(?![a-z])/.test(s)), `${line}: ${solved.steps.join(" ; ")}`).toBe(true);
    }
  });

  it("a line with no blank reads exactly as before", () => {
    for (const line of ["2x + 3 = 11", "7 + 5", "\\square 2 + 3 = 5", "1 + 2 = \\square"]) {
      const before = analyzeColumn(engine, [line], "answer")[0];
      expect(before?.kind, line).not.toBe("unknown");
    }
    expect(localSolve(engine, ["1 + 2 = \\square"]).steps).toEqual(["= 3"]);
    expect(localSolve(engine, ["2x + 3 = 11"]).steps.at(-1)).toBe("x = 4");
  });
});

describe("blanks: a comparison to fill in", () => {
  it("two sides and a blank between them, no relation", () => {
    expect(compareBlank("\\frac{3}{4} \\; ? \\; \\frac{5}{8}")).toEqual({ left: "\\frac{3}{4}", right: "\\frac{5}{8}" });
    expect(compareBlank("345 \\bigcirc 354")).toEqual({ left: "345", right: "354" });
    expect(compareBlank("-3 \\; ? \\; -5")).toEqual({ left: "-3", right: "-5" });
    for (const line of ["4 + \\square = 9", "x ? 5", "3 + ? ", "? 5", "\\frac{1}{2} < \\frac{3}{4}"]) expect(compareBlank(line), line).toBeNull();
  });

  it("Solve fills in the one relation that holds", () => {
    for (const [line, filled] of [
      ["\\frac{3}{4} \\bigcirc \\frac{5}{8}", "\\frac{3}{4} > \\frac{5}{8}"],
      ["345 \\bigcirc 354", "345 < 354"],
      ["0.7 \\bigcirc 0.70", "0.7 = 0.70"],
      ["-3 \\bigcirc -5", "-3 > -5"],
    ] as const) {
      expect(localSolve(engine, [line]).steps, line).toEqual([filled]);
    }
  });
});

describe("blanks: the board's one form, which the hand draws", () => {
  it("every blank as the box; a comparison's as the circle; spaced as the hand writes them", () => {
    expect(boardBlanks("7 + ? = 12")).toBe("7 + \\square = 12");
    expect(boardBlanks("7 + \\_\\_ = 12")).toBe("7 + \\square = 12");
    expect(boardBlanks("7 + \\underline{\\quad} = 12")).toBe("7 + \\square = 12");
    expect(boardBlanks("\\boxed{\\phantom{0}} + 3 = 8")).toBe("\\square + 3 = 8");
    expect(boardBlanks("25 + 17 = ?")).toBe("25 + 17 = \\square");
    expect(boardBlanks("\\frac{6}{8} = \\frac{?}{4}")).toBe("\\frac{6}{8} = \\frac{\\square}{4}");
    expect(boardBlanks("\\frac{3}{4} \\; ? \\; \\frac{5}{8}")).toBe("\\frac{3}{4} \\bigcirc \\frac{5}{8}");
    expect(boardBlanks("5^{2} + 12^{2} \\stackrel{?}{=} 13^{2}")).toBe("5^{2} + 12^{2} \\stackrel{?}{=} 13^{2}");
    expect(boardBlanks("2x + 3 = 11")).toBe("2x + 3 = 11");
  });

  it("the hand draws the box, the circle and a dollar sign", () => {
    for (const line of ["4 + \\square = 9", "\\Box + 6 = 10", "\\frac{3}{4} \\bigcirc \\frac{5}{8}", "\\$3.25 + \\$1.50", "1 + 2 = \\square"]) {
      expect(layoutSteps([line], { size: 48, seed: 1 }).unsupported, line).toEqual([]);
    }
  });
});

describe("blanks: a child's answer, put in the blank", () => {
  it("a lone number, the blank = it, the problem written out with it; a sign or the comparison written out", () => {
    expect(filledBlank("4 + \\square = 9", "5")).toEqual({ line: "4 + 5 = 9", lone: true });
    expect(filledBlank("4 + \\square = 9", "= 5")).toEqual({ line: "4 + 5 = 9", lone: true });
    expect(filledBlank("4 + \\square = 9", "\\square = 5")).toEqual({ line: "4 + 5 = 9", lone: true });
    expect(filledBlank("\\frac{2}{3} = \\frac{\\square}{12}", "8")).toEqual({ line: "\\frac{2}{3} = \\frac{8}{12}", lone: true });
    expect(filledBlank("4 + \\square = 9", "4+5=9")).toEqual({ line: "4+5=9", lone: false });
    expect(filledBlank("\\frac{3}{4} \\bigcirc \\frac{5}{8}", ">")).toEqual({ line: "\\frac{3}{4} > \\frac{5}{8}", lone: true });
    expect(filledBlank("\\frac{3}{4} \\bigcirc \\frac{5}{8}", "\\frac{3}{4}<\\frac{5}{8}")).toEqual({ line: "\\frac{3}{4}<\\frac{5}{8}", lone: false });
  });

  it("no blank to answer, or no answer for it", () => {
    expect(filledBlank("1 + 2 = \\square", "3")).toBeNull(); // the answer's place: `primaryWork` judges it as `1 + 2`
    expect(filledBlank("2x + 3 = 11", "4")).toBeNull();
    expect(filledBlank("4 + \\square = 9", "4 + 5")).toBeNull();
    expect(filledBlank("4 + \\square = 9", "x = 5")).toBeNull();
    expect(filledBlank("\\frac{3}{4} \\bigcirc \\frac{5}{8}", "3")).toBeNull();
  });

  it("the engine's young-work judge ticks the right one (solved) and rings a wrong one", () => {
    const judge = (problem: string, latex: string) => engine.judgeWork?.({ problem: [problem], above: [], latex, ctx: { mode: "feedback" } });
    expect(judge("4 + \\square = 9", "5")).toMatchObject({ verdict: "ok", solved: true, bareAnswer: true });
    expect(judge("4 + \\square = 9", "6")).toMatchObject({ verdict: "mismatch", bareAnswer: true });
    expect(judge("\\frac{3}{4} \\bigcirc \\frac{5}{8}", ">")).toMatchObject({ verdict: "ok", solved: true });
    expect(judge("\\frac{3}{4} \\bigcirc \\frac{5}{8}", "<")).toMatchObject({ verdict: "mismatch" });
    expect(judge("1 + 2 = \\square", "3")).toMatchObject({ verdict: "ok", solved: true });
  });

  it("a worksheet's problem is arithmetic: its blanks are places for numbers, not letters", () => {
    for (const line of ["4 + \\square = 9", "1 + 2 = \\square", "? \\times 6 = 42", "\\frac{3}{4} \\bigcirc \\frac{5}{8}"]) expect(isArithmetic(line), line).toBe(true);
    expect(isArithmetic("x + 7 = 12")).toBe(false);
  });
});

describe("thousands separators as LaTeX writes them", () => {
  it("`1{,}234` is one thousand two hundred thirty-four, every group of it", () => {
    expect(localSolve(engine, ["1{,}234 + 567"]).steps).toEqual(["= 1801"]);
    expect(localSolve(engine, ["1{,}000{,}000 - 1"]).steps).toEqual(["= 999999"]);
    expect(localSolve(engine, ["1{,}248 \\div 6"]).steps).toEqual(["= 208"]);
  });
});
