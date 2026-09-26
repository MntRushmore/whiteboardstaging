import { beforeAll, describe, expect, it } from "vitest";
import type { LiveEngine } from "../../contracts";
import { getEngine } from "..";
import { linearLatex, questionVariable, substituteLatex } from "../systems";

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

const solve = (lines: string[]) => engine.solveFromLines!(lines)?.steps ?? null;

describe("solveFromLines: the lines above answer `x = ?`", () => {
  it("substitutes a known value (the board that stacked two AI answers)", () => {
    expect(solve(["x+y=18", "y=9", "x=?"])).toEqual(["x+9=18", "x = 9"]);
  });

  it("answers Solve on the known-value line itself: the other unknown is what is left", () => {
    expect(solve(["x+y=18", "y=9"])).toEqual(["x+9=18", "x = 9"]);
  });

  it("brackets a value after a coefficient", () => {
    expect(solve(["2x+3y=12", "y=2", "x="])).toEqual(["2x+3(2)=12", "2x + 6 = 12", "2x = 6", "x = 3"]);
  });

  it("solves two linear equations by substitution, isolating a coefficient-1 variable", () => {
    expect(solve(["x+y=18", "x-y=4", "x=?"])).toEqual(["y = 18 - x", "x-(18 - x)=4", "x - 18 + x = 4", "2x - 18 = 4", "2x = 22", "x = 11", "y = 18 - 11", "y = 7"]);
  });

  it("isolates the variable NOT asked for", () => {
    const steps = solve(["x+y=18", "x-y=4", "y=?"])!;
    expect(steps[0]).toBe("x = 18 - y");
    expect(steps).toContain("y = 7");
    expect(steps.at(-1)).toBe("x = 11");
  });

  it("writes a rearrangement the way a student does (variable first when positive)", () => {
    expect(solve(["2x+3y=12", "x-y=1"])![0]).toBe("y = x - 1");
  });

  it("keeps fractions exact", () => {
    const steps = solve(["3x+2y=16", "2x+3y=14"])!;
    expect(steps).toContain("x = 4");
    expect(steps.at(-1)).toBe("y = 2");
  });

  it("returns a value already known", () => {
    expect(solve(["2x=8", "x=?"])).toEqual(["x = 4"]);
  });

  it("refuses what it cannot answer rather than guessing", () => {
    expect(solve(["x+y=18"])).toBeNull();
    expect(solve(["y=9"])).toBeNull();
    expect(solve(["x^2+y^2=25", "x+y=7"])).toBeNull(); // not linear
  });
});

describe("solveLatex: nothing to write for a line already solved", () => {
  it("`y = 9` is not solved again under itself", () => {
    expect(engine.solveLatex("y=9")).toBeNull();
    expect(engine.solveLatex("2x+3=11")?.steps).toEqual(["2x = 8", "x = 4"]);
  });
});

describe("helpers", () => {
  it.each([
    ["x = ?", "x"],
    ["x=?", "x"],
    ["y =", "y"],
    ["x = \\text{?}", "x"],
    ["x = 4", null],
    ["2x = ?", null],
  ])("questionVariable(%s)", (latex, want) => {
    expect(questionVariable(latex)).toBe(want);
  });

  it("substitutes letters, never command names", () => {
    expect(substituteLatex("\\frac{x}{y}+y=3", { y: "9" })).toBe("\\frac{x}{9}+9=3");
    expect(substituteLatex("3y-x=1", { y: "-2" })).toBe("3(-2)-x=1");
  });

  it("formats a linear side", () => {
    const fmt = (n: number) => String(n);
    expect(linearLatex(18, -1, "x", fmt)).toBe("18 - x");
    expect(linearLatex(-1, 1, "x", fmt)).toBe("x - 1");
    expect(linearLatex(0, -2, "x", fmt)).toBe("-2x");
    expect(linearLatex(5, 0, "x", fmt)).toBe("5");
  });
});
