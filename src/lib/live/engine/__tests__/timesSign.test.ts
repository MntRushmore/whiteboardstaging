import { beforeAll, describe, expect, it } from "vitest";
import type { LiveEngine } from "../../contracts";
import { localSolve } from "../../localSolve";
import { localAnswerFor, mathSymbols } from "../../solveSteps";
import { getEngine } from "..";
import { latexToMath, preprocessLatex, timesBetweenNumbers } from "../latex";

/**
 * `2x2` is 2 × 2 (`timesBetweenNumbers`): on a phone, the times sign is the letter x between two
 * numbers. A student wrote `2x2`, tapped Solve it and got "Couldn't work this out" — the engine read
 * `2 · x · 2`, an expression in x with nothing to do, and a model was asked. Every x on the line
 * must sit between two numbers; one x used as a letter and the line reads as it always has.
 */

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

describe("timesBetweenNumbers", () => {
  it.each([
    ["2x2", "2 \\times 2"],
    ["2 x 2", "2 \\times 2"],
    ["3x4=12", "3 \\times 4=12"],
    ["1.5x2", "1.5 \\times 2"],
    ["2x3x4", "2 \\times 3 \\times 4"],
  ])("%s reads as a product of numbers", (latex, want) => {
    expect(timesBetweenNumbers(latex).replace(/\s+/g, " ").trim()).toBe(want);
  });

  it.each([
    // x is the unknown somewhere on the line
    "2x+3=11",
    "2x^{2}",
    "2 x^{2}",
    "x2",
    "x = 2x2",
    "2x2 + x",
    "2x",
    "x_{2}3",
    // x inside a command or text
    "\\frac{d}{dx} 2x3",
    "\\text{x}2",
    "2\\max3",
    "\\exp(2)",
    // nothing to do
    "2 \\times 2",
    "36+2",
  ])("%s keeps its x (or has none to read)", (latex) => {
    expect(timesBetweenNumbers(latex)).toBe(latex);
  });

  it("is part of every reader's preprocessing: the translator sees no variable", () => {
    expect(preprocessLatex("2x2")).toBe("2 \\times 2");
    const t = latexToMath("2x2");
    expect(t.variables).toEqual([]);
    expect(t.source.replace(/\s+/g, "")).toBe("2*2");
    expect(latexToMath("2x^{2}").variables).toEqual(["x"]);
    expect(latexToMath("2x+3").variables).toEqual(["x"]);
  });
});

describe("the engine on `2x2`", () => {
  it("Solve writes `= 4` locally, with no model", () => {
    expect(localSolve(engine, ["2x2"])).toMatchObject({ source: "localAnswer", steps: ["= 4"], answer: "4" });
    expect(localSolve(engine, ["2 x 2"])).toMatchObject({ source: "localAnswer", steps: ["= 4"] });
    expect(localAnswerFor(engine, "3x4")).toBe("12");
  });

  it("Feedback ticks `2x2 = 4` and `3x4 = 12`, and not `2x2 = 5`", () => {
    expect(engine.analyzeLine("2x2=4", { mode: "feedback" })).toMatchObject({ kind: "equation", verdict: "ok" });
    expect(engine.analyzeLine("3x4=12", { mode: "feedback" })).toMatchObject({ kind: "equation", verdict: "ok" });
    expect(engine.analyzeLine("2 x 2 = 4", { mode: "feedback" }).verdict).toBe("ok");
    expect(engine.analyzeLine("2x2=5", { mode: "feedback" }).verdict).not.toBe("ok");
  });

  it("`2x2 =` is finished with its value", () => {
    expect(engine.analyzeLine("2x2=", { mode: "answer" }).resultLatex).toBe("4");
  });

  it("the step check sees no name in it", () => {
    expect(mathSymbols("2x2")).toEqual([]);
    expect(mathSymbols("2x+3")).toEqual(["x"]);
  });

  it("x as the unknown is untouched: `2x + 3 = 11` is solved for x, `2x^{2}` is an expression in x", () => {
    expect(localSolve(engine, ["2x+3=11"]).steps).toEqual(["2x = 8", "x = 4"]);
    expect(engine.analyzeLine("2x^{2}", { mode: "answer" }).math.replace(/\s+/g, "")).toBe("2*x^2");
    expect(engine.analyzeLine("x2", { mode: "answer" }).math.replace(/\s+/g, "")).toBe("x*2");
    expect(engine.analyzeLine("2x", { mode: "answer" }).kind).toBe("label");
  });
});
