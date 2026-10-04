import { describe, expect, it } from "vitest";
import type { LineAnalysis } from "../contracts";
import { evaluatedLineFor, givensFor, givensOf } from "../givens";

/** The values a column gives its letters (`givens.ts`): pure, over LaTeX and the lines' analyses. */

const line = (kind: LineAnalysis["kind"], extra: Partial<LineAnalysis> = {}): LineAnalysis => ({ kind, math: "", resultLatex: "", verdict: "none", note: "", ...extra });
const assignment = (variable: string) => line("assignment", { variable });

describe("givensOf", () => {
  it("reads `x = 3` (and a negative, a fraction) from assignment lines", () => {
    expect(givensOf(["3x+24=", "x=3"], [line("incomplete"), assignment("x")])).toEqual([{ variable: "x", value: "3", lines: [1] }]);
    expect(givensOf(["y = -2", "a = \\frac{1}{2}"], [assignment("y"), assignment("a")])).toEqual([
      { variable: "y", value: "-2", lines: [0] },
      { variable: "a", value: "\\frac{1}{2}", lines: [1] },
    ]);
  });

  it("reads `x =` with a lone number on the next line as one given", () => {
    expect(givensOf(["3x+24=", "x=", "3"], [line("incomplete"), line("incomplete"), line("label")])).toEqual([{ variable: "x", value: "3", lines: [1, 2] }]);
    // ...but not `x =` followed by more working
    expect(givensOf(["x=", "2x+1"], [line("incomplete"), line("expression")])).toEqual([]);
  });

  it("is no given: an equation's answer, a value in letters, units, a constant's letter, two values for one letter", () => {
    expect(givensOf(["2x+3=11", "x=4"], [line("equation"), line("equation", { variable: "x" })])).toEqual([]);
    expect(givensOf(["x=2y"], [assignment("x")])).toEqual([]);
    expect(givensOf(["m=2\\mathrm{kg}"], [line("assignment", { variable: "m", units: { ok: true } })])).toEqual([]);
    expect(givensOf(["e=3"], [assignment("e")])).toEqual([]);
    expect(givensOf(["x=3", "x=4"], [assignment("x"), assignment("x")])).toEqual([]);
    // the same value again changes nothing
    expect(givensOf(["x=3", "x = 3"], [assignment("x"), assignment("x")])).toEqual([{ variable: "x", value: "3", lines: [0] }]);
  });
});

describe("givensFor / evaluatedLineFor", () => {
  const lines = ["3x+24=", "x=", "3"];
  const analyses = [line("expression", { substituted: "3(3)+24" }), line("incomplete"), line("label")];
  const givens = givensOf(lines, analyses);

  it("a line never uses a given read from itself", () => {
    expect(givensFor(givens, 0)).toEqual({ x: "3" });
    expect(givensFor(givens, 1)).toBeUndefined();
    expect(givensFor(givens, 2)).toBeUndefined();
  });

  it("asked on a given (either half of it), the line it evaluates", () => {
    expect(evaluatedLineFor(lines, analyses, givens, 0)).toBe(0);
    expect(evaluatedLineFor(lines, analyses, givens, 1)).toBe(0);
    expect(evaluatedLineFor(lines, analyses, givens, 2)).toBe(0);
    // a given no evaluated line uses
    expect(evaluatedLineFor(["2y+1=", "x=3"], [line("incomplete"), assignment("x")], givensOf(["2y+1=", "x=3"], [line("incomplete"), assignment("x")]), 1)).toBe(-1);
  });
});
