import { beforeAll, describe, expect, it } from "vitest";
import type { LineAnalysis, LiveEngine } from "../contracts";
import { getEngine } from "../engine";
import {
  checkSolveStep,
  createSolveStepGuard,
  definedSymbol,
  engineParsesStep,
  isIntervalAnswer,
  isMonomial,
  localAnswerFor,
  localAnswerStep,
  mathSymbols,
  unwrapBoxed,
} from "../solveSteps";

/**
 * The two halves of "what Solve is allowed to draw" (see solveSteps.ts).
 *
 * The bug these exist for: a student wrote `36 + 2 =`, the local engine had `38`, but
 * `solveLatex` only handles equations with an unknown — so the line fell through to the model,
 * which answered `= r + 9\varepsilon`, and that was drawn on their page as fact.
 */

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

/** Everything here runs against the REAL engine: the point is what it can actually read. */
const parses = (latex: string) => engineParsesStep(engine, latex);

describe("solveSteps: reading the symbols out of a step", () => {
  it.each([
    ["= r + 9\\varepsilon", ["r", "varepsilon"]],
    ["2x = 8", ["x"]],
    ["x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}", ["x", "b", "a", "c"]],
    // units and prose are not variables: \mathrm / \text take their argument with them
    ["31.36\\,\\mathrm{N}", []],
    ["5\\,\\mathrm{km} \\text{ to } \\mathrm{m}", []],
    ["\\text{A train travels 60 km in 2 h}", []],
    // structural macros and function names are skipped; their arguments are not
    ["\\frac{\\sin(\\theta)}{2}", ["theta"]],
    ["\\sqrt{y} + \\log(z)", ["y", "z"]],
    // \pi is the constant, \varepsilon is a quantity
    ["2\\pi r", ["r"]],
    // subscripts are the same quantity
    ["v_1 + v_2", ["v"]],
    // mathjs reads e and i as constants, so they are never "introduced"
    ["e^{i}", []],
  ])("mathSymbols(%s)", (latex, expected) => {
    expect(mathSymbols(latex)).toEqual(expected);
  });

  it("unwraps the \\boxed{...} every final step arrives in", () => {
    expect(unwrapBoxed("\\boxed{x = 4}")).toBe("x = 4");
    expect(unwrapBoxed("  \\boxed{ \\frac{1}{2} }  ")).toBe("\\frac{1}{2}");
    // a box is decoration wherever it is: the board draws the maths, never a box round part of it
    expect(unwrapBoxed("\\boxed{x} + 1")).toBe("x + 1");
    expect(unwrapBoxed("x = 4")).toBe("x = 4");
  });

  it.each([
    // the whole left side is one name: the step defines it
    ["v = \\frac{60}{2}", "v"],
    ["v_1 = 30", "v"],
    ["\\varepsilon = 0.5", "varepsilon"],
    // ...and these do not define anything
    ["= r + 9\\varepsilon", null], // no left side at all — the shape of the bug
    ["r + 9\\varepsilon = 38", null], // more than a name on the left
    ["2x = 8", null],
    ["\\sqrt{x} = 4", null],
    ["x + 1", null], // no relation
    ["e = 2.718", null], // a constant is not a name to define
  ])("definedSymbol(%s)", (latex, expected) => {
    expect(definedSymbol(latex)).toBe(expected);
  });
});

describe("solveSteps: the interlock on a streamed step", () => {
  const known = ["x"];

  it.each([
    // [what the model sent, is it drawable, why not]
    ["2x = 8", true, undefined],
    ["\\boxed{x = 4}", true, undefined],
    ["= 38", true, undefined], // a bare number continuing the line above
    ["x = \\left(4\\right)", true, undefined], // \left / \right are only sizing
    ["", false, "empty"],
    ["   ", false, "empty"],
    ["\\text{Sorry, I can't do that}", false, "unparseable"], // prose is not a step
    ["\\frac{}{}", false, "unparseable"],
    ["= r + 9\\varepsilon", false, "unknown-symbol"], // THE bug, verbatim
    ["x = 2y", false, "unknown-symbol"],
    ["\\boxed{q = 7}", true, undefined], // a step may name its own quantity...
    ["\\boxed{q = 7z}", false, "unknown-symbol"], // ...but only the one it defines
  ])("checkSolveStep(%s)", (latex, ok, reason) => {
    const verdict = checkSolveStep(latex, { known, parses });
    expect(verdict.ok).toBe(ok);
    expect(verdict.reason).toBe(reason);
  });

  it("carries the names of accepted steps forward, and the rejected ones' not at all", () => {
    const guard = createSolveStepGuard({ sourceLatex: ["\\text{A train travels 60 km in 2 h}"], parses });
    // the solution may name its own quantity
    expect(guard.check("v = \\frac{60}{2}").ok).toBe(true);
    expect(guard.known()).toContain("v");
    // ...and later steps may then use it
    expect(guard.check("\\boxed{v = 30\\,\\mathrm{km/h}}").ok).toBe(true);
    // a name from nowhere is still refused, and stays unknown afterwards
    expect(guard.check("= 2w + 1")).toMatchObject({ ok: false, reason: "unknown-symbol", introduced: ["w"] });
    expect(guard.known()).not.toContain("w");
    expect(guard.check("w = 3v").ok).toBe(true); // an assignment defines it
  });

  it("a word problem's solution may introduce its quantity by assignment (train: v = 60/2, v = 30)", () => {
    const guard = createSolveStepGuard({
      sourceLatex: ["\\text{A train travels 60 km in 2 hours. What is its speed?}"],
      parses,
    });
    // the prose contributes no names at all...
    expect(guard.known()).toEqual([]);
    // ...so the first step must be the assignment that names the unknown
    expect(guard.check("v = \\frac{60}{2}")).toMatchObject({ ok: true, symbols: ["v"] });
    expect(guard.check("v = 30")).toMatchObject({ ok: true });
    expect(guard.check("\\boxed{v = 30}")).toMatchObject({ ok: true });
    // a bare equation in a name nobody introduced is still refused
    expect(guard.check("s = 2t")).toMatchObject({ ok: false, reason: "unknown-symbol", introduced: ["t"] });
  });

  it("seeds the known names from every line of the student's column", () => {
    const guard = createSolveStepGuard({ sourceLatex: ["a = 3", "b = 4"], parses });
    expect(guard.check("= a + b").ok).toBe(true);
    expect(guard.check("= a + b + d")).toMatchObject({ ok: false, introduced: ["d"] });
    // `c^2` is not a bare name, so this step does not define `c` — it introduces it
    expect(guard.check("c^2 = a^2 + b^2")).toMatchObject({ ok: false, introduced: ["c"] });
  });

  it("holds nothing back when there is no engine to check with", () => {
    // `parses` is the engine half; with no engine the loop passes () => true and the symbol
    // rule still applies on its own.
    const guard = createSolveStepGuard({ sourceLatex: ["2x+3=11"], parses: () => true });
    expect(guard.check("\\text{anything}").ok).toBe(true);
    expect(guard.check("= r + 9\\varepsilon").ok).toBe(false);
  });

  it("treats an engine that throws as a step that does not parse", () => {
    const throwing: Pick<LiveEngine, "analyzeLine"> = {
      analyzeLine: () => {
        throw new Error("boom");
      },
    };
    expect(engineParsesStep(throwing, "2x = 8")).toBe(false);
  });

  it.each([
    ["2x = 8", true],
    ["= 38", true],
    ["\\boxed{38}", true],
    ["= 31.36\\,\\mathrm{N}", true],
    ["\\text{Sorry}", false],
    ["", false],
  ])("engineParsesStep(%s)", (latex, expected) => {
    expect(parses(latex)).toBe(expected);
  });

  // `4x` is a label to the engine (a lone `2x` on the page names something), so the model's right
  // answer to `3x + x` was refused, every step with it, and Solve said "Couldn't work this out"
  it.each([
    ["4x", true],
    ["= 4x", true],
    ["\\boxed{4x}", true],
    ["-2y", true],
    ["x", true],
    ["3ab^{2}", true],
    ["\\frac{1}{2}\\theta", true],
    ["= 5x", true],
    // not letters, or not maths
    ["\\sin", false],
    ["\\cdot x", false],
    ["\\text{x}", false],
  ])("a monomial answer is a step: engineParsesStep(%s) = %s", (latex, expected) => {
    expect(parses(latex)).toBe(expected);
  });

  it("isMonomial: one term, a number times letters to whole powers", () => {
    for (const yes of ["4x", "-2y", "x", "3ab^{2}", "\\frac{1}{2}\\theta", "2.5x^2", "7 x"]) expect(isMonomial(yes), yes).toBe(true);
    for (const no of ["4x + 1", "x\\frac{1}{2}", "\\sin x", "2\\cdot x", "4", "x^{y}", "\\text{x}", ""]) expect(isMonomial(no), no).toBe(false);
  });

  it("a solution that ends in a monomial is drawn whole", () => {
    const guard = createSolveStepGuard({ sourceLatex: ["3x + x"], parses });
    expect(["= 4x"].map((s) => guard.check(s).ok)).toEqual([true]);
    // its letters are still checked: a monomial in a name from nowhere is not
    expect(guard.check("= 4r").ok).toBe(false);
  });
});

describe("solveSteps: the answer the engine already has", () => {
  it.each([
    // the line the student wrote            what the tutor should finish it with
    ["36+2=", "38"],
    ["36 + 2", "38"], // no trailing '='; the echo's calculator rule hides it, Solve asked for it
    ["100-45", "55"],
    ["\\frac{1}{2}+\\frac{1}{3}=", "\\frac{5}{6}"],
    ["3.2 kg \\cdot 9.8 m/s^2", "31.36\\,\\mathrm{N}"],
    ["5 km/h \\text{ to } m/s", "1.389\\,\\mathrm{m/s}"],
    ["\\frac{d}{dx} x^3", "3x^{2}"],
  ])("localAnswerFor(%s)", (latex, expected) => {
    expect(localAnswerFor(engine, latex)).toBe(expected);
  });

  it.each([
    ["2x+3=11"], // an equation is solveLatex's job, not this one
    ["2x+3"], // an expression with an unknown has no answer to write
    ["38"], // nothing to compute: the answer would repeat the line
    ["x"],
    [""],
    ["\\text{A train travels 60 km in 2 h. How fast is it going?}"], // a word problem needs the model
  ])("has nothing to say about %s", (latex) => {
    expect(localAnswerFor(engine, latex)).toBeNull();
  });

  it("never lets an engine that throws become a model call", () => {
    const throwing = {
      analyzeLine: () => {
        throw new Error("boom");
      },
      calculate: () => {
        throw new Error("boom");
      },
    } as unknown as LiveEngine;
    expect(localAnswerFor(throwing, "36+2=")).toBeNull();
  });

  it("ignores a result the engine flagged an error on", () => {
    const broken = {
      analyzeLine: (): LineAnalysis => ({
        kind: "expression",
        math: "36 + 2",
        resultLatex: "38",
        verdict: "none",
        note: "",
        error: "Unit mismatch",
      }),
      calculate: () => null,
    } as unknown as LiveEngine;
    expect(localAnswerFor(broken, "36+2=")).toBeNull();
  });

  it("writes the answer the way a person finishes the line", () => {
    expect(localAnswerStep("38")).toBe("= 38");
    expect(localAnswerStep(" 31.36\\,\\mathrm{N} ")).toBe("= 31.36\\,\\mathrm{N}");
  });
});

describe("the step check lets through what a right answer looks like (model benchmark findings)", () => {
  // stand-in for the engine: everything with maths in it parses
  const parses = (latex: string) => /[0-9a-zA-Z]/.test(latex) && !/\\text/.test(latex);
  const run = (source: string[], steps: string[]) => {
    const guard = createSolveStepGuard({ sourceLatex: source, parses });
    return steps.map((s) => guard.check(s).ok);
  };

  it("an antiderivative's + C", () => {
    expect(run(["\\int 2x \\, dx"], ["= x^{2} + C"])).toEqual([true]);
    // but C is still a name from nowhere where there is no integral
    expect(run(["2x + 3 = 11"], ["x = 4 + C"])).toEqual([false]);
  });

  it("the integer of a periodic trig solution", () => {
    expect(run(["\\sin x = \\frac{1}{2}"], ["x = 30^{\\circ} + 360^{\\circ} k"])).toEqual([true]);
    expect(run(["2x + 3 = 11"], ["x = 4 + k"])).toEqual([false]);
  });

  it("differentials: d/dx written out, and u, dv, du, v in an integration by parts", () => {
    expect(run(["\\int x e^{x} \\, dx"], ["u = x", "dv = e^{x} \\, dx", "du = dx", "v = e^{x}", "= x e^{x} - \\int e^{x} \\, dx", "= x e^{x} - e^{x} + C"])).toEqual([true, true, true, true, true, true]);
    expect(run(["y = x^{3}"], ["\\frac{dy}{dx} = 3x^{2}"])).toEqual([true]);
  });

  it("a box anywhere in the step", () => {
    expect(unwrapBoxed("= \\boxed{1}")).toBe("= 1");
    expect(unwrapBoxed("x = \\boxed{\\frac{3}{2}}")).toBe("x = \\frac{3}{2}");
    expect(unwrapBoxed("\\boxed{x = 3}")).toBe("x = 3");
  });

  it("interval answers are maths, prose is not", () => {
    expect(isIntervalAnswer("(2, \\infty)")).toBe(true);
    expect(isIntervalAnswer("x \\in [1, 4)")).toBe(true);
    expect(isIntervalAnswer("(-\\infty, -1) \\cup (3, \\infty)")).toBe(true);
    expect(isIntervalAnswer("\\left(\\frac{1}{2}, 5\\right]".replace(/\\left|\\right/g, ""))).toBe(true);
    expect(isIntervalAnswer("(so, x is big)")).toBe(false);
  });
});
