import { beforeAll, describe, expect, it } from "vitest";
import type { LineAnalysis, LiveEngine } from "../contracts";
import { getEngine } from "../engine";
import {
  checkSolveStep,
  createSolveStepGuard,
  definedSymbol,
  engineParsesStep,
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
    // only when it wraps the WHOLE step
    expect(unwrapBoxed("\\boxed{x} + 1")).toBe("\\boxed{x} + 1");
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
    ["\\frac{d}{dx} x^3", "3\\cdot{x}^{2}"],
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
