import { beforeAll, describe, expect, it, vi } from "vitest";
import type { LineAnalysis, LiveEngine } from "../contracts";
import { getEngine } from "../engine";
import { analyzeColumn, localSolve } from "../localSolve";

/**
 * `localSolve` is `LiveLoop.startSolve`'s local half as a pure function. These pin the ORDER and
 * the fall-through rules of the loop (see the file comment of localSolve.ts): the real engine for
 * what each path answers, a spy around it for which path is asked, with what, and when.
 */

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

/** The real engine with every Solve entry point spied on (and optionally overridden). */
function spied(overrides: Partial<LiveEngine> = {}) {
  const e: LiveEngine = { ...engine, ...overrides };
  return {
    engine: e,
    solveLatex: vi.spyOn(e, "solveLatex"),
    solveFromLines: vi.spyOn(e as Required<LiveEngine>, "solveFromLines"),
    simplifySteps: vi.spyOn(e as Required<LiveEngine>, "simplifySteps"),
    calculate: vi.spyOn(e, "calculate"),
  };
}

describe("localSolve — what each local path writes (real engine)", () => {
  it.each([
    [["2x + 3 = 11"], "solveLatex", ["2x = 8", "x = 4"]],
    [["2x + 3 > 11"], "solveLatex", ["2x > 8", "x > 4"]],
    [["x + y = 18", "y = 9", "x = ?"], "solveFromLines", ["x + 9 = 18", "x = 9"]],
    [["3(x+2) - x"], "simplifySteps", ["= 3x + 6 - x", "= 2x + 6"]],
    [["36 + 2 ="], "localAnswer", ["= 38"]],
    [["7 \\times 8"], "localAnswer", ["= 56"]],
  ] as const)("%j → %s", (lines, source, steps) => {
    expect(localSolve(engine, lines)).toEqual({ source, steps });
  });

  it("answers a derivative that needs the definition above it (column context)", () => {
    // calculus under a definition is answered from the column (solveFromLines), in the engine's notation
    expect(localSolve(engine, ["y = x^{3} + 2x", "\\frac{dy}{dx} ="])).toEqual({ source: "solveFromLines", steps: ["= 3x^{2} + 2"] });
  });

  it("answers a limit locally; has nothing local for a word problem (the loop would ask the model)", () => {
    expect(localSolve(engine, ["\\lim_{x \\to 0} \\frac{\\sin x}{x}"])).toEqual({ source: "simplifySteps", steps: ["= 1"] });
    expect(localSolve(engine, ["\\text{A train travels 60 km in 2 hours. What is its speed?}"])).toEqual({ source: null, steps: [] });
    expect(localSolve(engine, [])).toEqual({ source: null, steps: [] });
  });

  it("analyzes each line with the lines above it, in Solve mode", () => {
    const [first, second] = analyzeColumn(engine, ["f(x) = x^{2}", "f'(x) ="]);
    expect(first?.kind).toBe("function");
    // `f'(x) =` only means something next to its definition — and in answer mode it is answered
    expect(second?.resultLatex).toBe("2x");
  });
});

describe("localSolve — the loop's order and fall-through", () => {
  it("tries solveLatex first and stops there", () => {
    const s = spied();
    expect(localSolve(s.engine, ["x + y = 18", "2x = 8"]).source).toBe("solveLatex");
    expect(s.solveFromLines).not.toHaveBeenCalled();
    expect(s.simplifySteps).not.toHaveBeenCalled();
  });

  it("drops solveLatex's steps when the hand cannot draw them, and tries the next path", () => {
    const s = spied();
    const canDraw = vi.fn(() => false);
    // one line: no context path, nothing to simplify or evaluate → the model (as on the board)
    expect(localSolve(s.engine, ["2x + 3 = 11"], undefined, { canDraw })).toEqual({ source: null, steps: [] });
    expect(canDraw).toHaveBeenCalledWith(["2x = 8", "x = 4"]);
    // two lines: the column path gets its turn
    expect(localSolve(s.engine, ["x + y = 18", "x - y = 4"], undefined, { canDraw }).source).toBe("solveFromLines");
  });

  it("never asks solveLatex with the handwriting switch off", () => {
    const s = spied();
    expect(localSolve(s.engine, ["2x + 3 = 11"], undefined, { handwriting: false }).source).toBeNull();
    expect(s.solveLatex).not.toHaveBeenCalled();
    // …but the other paths do not depend on the hand
    expect(localSolve(s.engine, ["36 + 2 ="], undefined, { handwriting: false })).toEqual({ source: "localAnswer", steps: ["= 38"] });
  });

  it("hands solveFromLines the column down to the asked-for line, lines Mathpix could not read left out", () => {
    const s = spied();
    localSolve(s.engine, ["x + y = 18", "", "x - y = 4", "3x = 9"], 2);
    expect(s.solveLatex).toHaveBeenCalledWith("x - y = 4");
    expect(s.solveFromLines).toHaveBeenCalledWith(["x + y = 18", "x - y = 4"]);
  });

  it("needs two lines with LaTeX for the column path", () => {
    const s = spied({ solveLatex: () => null });
    localSolve(s.engine, ["", "x + y = 18"]);
    expect(s.solveFromLines).not.toHaveBeenCalled();
  });

  it("uses the whole column when the asked-for line has no LaTeX, and nothing else", () => {
    const s = spied();
    const r = localSolve(s.engine, ["x + y = 18", "x - y = 4", ""]);
    expect(s.solveLatex).not.toHaveBeenCalled();
    expect(s.solveFromLines).toHaveBeenCalledWith(["x + y = 18", "x - y = 4"]);
    expect(r.source).toBe("solveFromLines");
    expect(localSolve(s.engine, ["36 + 2", ""]).source).toBeNull();
  });

  it("runs simplifySteps before the local answer", () => {
    const s = spied({ solveLatex: () => null, solveFromLines: () => null, simplifySteps: () => ["2x + 6"] });
    expect(localSolve(s.engine, ["36 + 2 ="])).toEqual({ source: "simplifySteps", steps: ["= 2x + 6"] });
    expect(s.calculate).not.toHaveBeenCalled();
  });

  it("skips every local path for a word problem, even one the engine could answer", () => {
    const text: LineAnalysis = { kind: "text", math: "", resultLatex: "", verdict: "none", note: "" };
    const s = spied({ analyzeLine: () => text, solveLatex: () => ({ latex: "x = 4", steps: ["x = 4"] }) });
    expect(localSolve(s.engine, ["anything"])).toEqual({ source: null, steps: [] });
    expect(s.solveLatex).not.toHaveBeenCalled();
  });

  it("caps every path at maxSolveSteps (8)", () => {
    const twelve = Array.from({ length: 12 }, (_, i) => `x = ${i}`);
    expect(localSolve({ ...engine, solveLatex: () => ({ latex: "x = 11", steps: twelve }) }, ["x^{2} = 1"]).steps).toHaveLength(8);
    expect(localSolve({ ...engine, solveLatex: () => null, simplifySteps: () => twelve }, ["x^{2} + x"]).steps).toHaveLength(8);
  });

  it("solves the asked-for line, not the last one", () => {
    const s = spied();
    expect(localSolve(s.engine, ["2x = 8", "x + 1 = 3"], 0)).toEqual({ source: "solveLatex", steps: ["x = 4"] });
  });

  it("treats an engine that throws as having nothing", () => {
    const boom = () => {
      throw new Error("boom");
    };
    expect(localSolve({ ...engine, solveLatex: boom, solveFromLines: boom, simplifySteps: boom, calculate: boom, analyzeLine: boom }, ["2x = 8"])).toEqual({ source: null, steps: [] });
  });
});
