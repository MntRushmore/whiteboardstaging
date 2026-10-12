import { beforeAll, describe, expect, it } from "vitest";
import type { LineAnalysis, LiveEngine } from "../contracts";
import { getEngine } from "../engine";
import {
  boundSymbols,
  checkSolveStep,
  createSolveStepGuard,
  createSolveStepJudge,
  definedSymbol,
  definedSymbols,
  engineParsesStep,
  isIntervalAnswer,
  isMonomial,
  localAnswerFor,
  localAnswerStep,
  mathSymbols,
  solveSourceLatex,
  sourceSymbols,
  stepKey,
  unwrapBoxed,
} from "../solveSteps";
import { normalizeStep } from "../liveLoop";

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
    // a sum of mixed numbers is answered in one, as the class works it — a fraction stays one
    ["2\\frac{1}{3} + 1\\frac{1}{2}", "3\\frac{5}{6}"],
    ["2\\frac{1}{2} + 1\\frac{1}{2} =", "4"],
    ["\\frac{7}{3} + \\frac{3}{2}", "\\frac{23}{6}"],
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

/**
 * Names a right solution legitimately has, against the REAL engine (2026-10-11). Each was a
 * "Couldn't solve this one" for maths the student had written fine: the guard took a name the
 * step defines, binds or the problem already has in another form for one from nowhere.
 */
describe("the step check knows the names a solution brings with it", () => {
  const run = (source: string[], steps: string[]) => {
    const guard = createSolveStepGuard({ sourceLatex: source, parses });
    return steps.map((s) => guard.check(s).ok);
  };

  it("an integration by parts set up in one step: `u = x, \\ dv = e^{x} \\, dx` defines u AND v", () => {
    // the most common refusal in the model eval (every model, fb-01 / fb-05 / fb-07)
    expect(run(["\\int x e^{x} \\, dx"], ["u = x, \\ dv = e^{x} \\, dx", "du = dx, \\ v = e^{x}", "\\int u \\, dv = uv - \\int v \\, du", "= x e^{x} - e^{x} + C"])).toEqual([true, true, true, true]);
    expect(run(["\\int \\ln x \\, dx"], ["u = \\ln x,\\quad dv = dx", "du = \\frac{1}{x}\\,dx,\\quad v = x"])).toEqual([true, true]);
    expect(run(["\\int e^{x} \\sin x \\, dx"], ["\\text{Let } u = \\sin x, \\ dv = e^x \\, dx \\implies du = \\cos x \\, dx, \\ v = e^x"])).toEqual([true]);
    expect(definedSymbols("u = x, \\ dv = e^{x} \\, dx")).toEqual(["u", "v"]);
    // a point, an interval and a thin space are one clause each, not a list of definitions
    expect(definedSymbols("(x, y) = (3, 9)")).toEqual([]);
    expect(definedSymbols("u = 2x\\,dx")).toEqual(["u"]);
  });

  it("a substitution the steps introduce explicitly: `\\text{Let } u = …` (it was not an assignment to the guard)", () => {
    expect(run(["\\int 2x(x^{2} + 1)^{5} \\, dx"], ["\\text{Let } u = x^{2} + 1", "du = 2x \\, dx", "= \\int u^{5} \\, du", "= \\frac{u^{6}}{6} + C", "\\boxed{= \\frac{(x^{2} + 1)^{6}}{6} + C}"])).toEqual([true, true, true, true, true]);
    expect(run(["\\sin^{2} x - \\sin x = 0"], ["\\text{let } t = \\sin x", "t^{2} - t = 0"])).toEqual([true, true]);
    // ...but only a name the step defines: `u` used before any step says what it is stays refused
    expect(run(["\\int 2x(x^{2} + 1)^{5} \\, dx"], ["= \\int u^{5} \\, du"])).toEqual([false]);
  });

  it("the constant of integration as a class writes it: + C, + c, + K, C_1 — and in a differential equation", () => {
    expect(run(["\\int 2x \\, dx"], ["= x^{2} + c"])).toEqual([true]);
    expect(run(["\\int 2x \\, dx"], ["= x^{2} + K"])).toEqual([true]);
    expect(run(["\\int \\frac{1}{x} \\, dx"], ["= \\ln|x| + C_{1}"])).toEqual([true]);
    expect(run(["\\frac{dy}{dx} = 2x"], ["y = x^{2} + C"])).toEqual([true]);
    expect(run(["y' = 3x^{2}"], ["y = x^{3} + C"])).toEqual([true]);
    expect(run(["f^{\\prime}(x) = 6x"], ["f(x) = 3x^{2} + C"])).toEqual([true]);
    expect(run(["\\text{Find the antiderivative of } 4x^{3}"], ["= x^{4} + C"])).toEqual([true]);
    // no integral, no derivative to undo: still a name from nowhere, in any spelling
    expect(run(["2x + 3 = 11"], ["x = 4 + c"])).toEqual([false]);
    expect(run(["2x + 3 = 11"], ["x = 4 + K"])).toEqual([false]);
    expect(run(["\\text{what's } 3 + 4"], ["= 7 + C"])).toEqual([false]);
  });

  it("standard constants are never introduced: π, e, i, ∞", () => {
    expect(run(["x^{2} = -4"], ["x = \\pm 2i"])).toEqual([true]);
    expect(run(["\\ln x = 2"], ["x = e^{2}"])).toEqual([true]);
    expect(run(["2\\cos x - 1 = 0"], ["x = \\frac{\\pi}{3} + 2\\pi n"])).toEqual([true]);
    expect(run(["\\frac{x - 1}{x + 2} > 0"], ["x \\in (-\\infty, -2) \\cup (1, \\infty)"])).toEqual([true]);
  });

  it("a name the problem has in another form: Greek typed as a character, or the other spelling of the letter", () => {
    expect(run(["2\\sin θ = 1"], ["\\sin \\theta = \\frac{1}{2}"])).toEqual([true]);
    expect(run(["|x - 3| < \\epsilon"], ["3 - \\varepsilon < x < 3 + \\varepsilon"])).toEqual([true]);
    expect(run(["\\vartheta = 2\\phi"], ["\\theta = 2\\varphi"])).toEqual([true]);
    // neither spelling in the problem: still from nowhere, named as the model wrote it
    const guard = createSolveStepGuard({ sourceLatex: ["36 + 2 ="], parses });
    expect(guard.check("= r + 9\\varepsilon")).toMatchObject({ ok: false, introduced: ["r", "varepsilon"] });
    expect(sourceSymbols("2\\sin θ = 1")).toEqual(["theta"]);
  });

  it("a word problem read as prose names its letters (but `a`, `A` and `I` are words)", () => {
    expect(run(["\\text{The angles of a triangle are x, 2x and 3x. Find x.}"], ["x + 2x + 3x = 180", "6x = 180", "\\boxed{x = 30}"])).toEqual([true, true, true]);
    expect(sourceSymbols("\\text{A train travels at a speed of 60 km/h. I want x.}")).toEqual(["x"]);
    expect(run(["\\text{A number doubled is 10}"], ["2a = 10"])).toEqual([false]);
  });

  it("`y` for the value of a function the problem writes as f(x): its inverse starts from it (fb-23)", () => {
    expect(run(["f(x) = \\frac{2x + 1}{x - 3}; f^{-1}(x) = ?"], ["x = \\frac{2y + 1}{y - 3}", "x(y - 3) = 2y + 1", "y(x - 2) = 3x + 1", "\\boxed{f^{-1}(x) = \\frac{3x + 1}{x - 2}}"])).toEqual([true, true, true, true]);
    expect(run(["g\\left(x\\right) = x^{2} + 1"], ["y = x^{2} + 1"])).toEqual([true]);
    // no function in the problem: `y` is a second unknown nobody asked for
    expect(run(["2x + 3 = 11"], ["2x + 3 = y"])).toEqual([false]);
    // `x(x + 1)` is a product, not a function
    expect(run(["x(x + 1) = 6"], ["y = 6"])).toEqual([true]); // an assignment defines y on its own...
    expect(run(["x(x + 1) = 6"], ["x^{2} + x = y"])).toEqual([false]); // ...but x(…) does not make it known
  });

  it("a limit's variable and a sum's index are the step's own (fb-08: the improper integral's b)", () => {
    // DeepSeek's steps in the eval, verbatim: the second has no limit of its own, its b is the first's
    expect(
      run(
        ["\\int_{1}^{\\infty} \\frac{1}{x^{2}} \\, dx"],
        ["\\int_{1}^{\\infty} \\frac{1}{x^{2}} \\, dx = \\lim_{b \\to \\infty} \\int_{1}^{b} x^{-2} \\, dx", "\\left[-\\frac{1}{x}\\right]_{1}^{b} = -\\frac{1}{b} + 1", "\\lim_{b \\to \\infty} \\left(1 - \\frac{1}{b}\\right) = 1"],
      ),
    ).toEqual([true, true, true]);
    expect(run(["f(x) = x^{2}"], ["\\lim_{h \\to 0} \\frac{(x + h)^{2} - x^{2}}{h}", "= \\lim_{h \\to 0} (2x + h)", "= 2x"])).toEqual([true, true, true]);
    expect(run(["1 + 2 + 3 + \\dots + 100"], ["= \\sum_{k=1}^{100} k", "= \\frac{100 \\cdot 101}{2}"])).toEqual([true, true]);
    expect(boundSymbols("\\lim_{b \\to \\infty} \\int_{1}^{b} x^{-2} \\, dx")).toEqual(["b"]);
    // a `b` with no limit binding it is still a name from nowhere
    expect(run(["\\int_{1}^{\\infty} \\frac{1}{x^{2}} \\, dx"], ["= 1 - \\frac{1}{b}"])).toEqual([false]);
  });

  it("a sequence's general term defines its index (fb-15: `a_n = a_1 + (n - 1)d`)", () => {
    expect(run(["a_{1} = 3; d = 4; a_{20} = ?"], ["a_n = a_1 + (n - 1)d", "a_{20} = 3 + 19 \\cdot 4", "\\boxed{a_{20} = 79}"])).toEqual([true, true, true]);
    expect(definedSymbols("a_{n} = a_{1} + (n - 1)d")).toEqual(["a", "n"]);
  });

  it("still refuses a hallucinated variable, whatever else is now allowed", () => {
    expect(run(["36 + 2 ="], ["= r + 9\\varepsilon"])).toEqual([false]);
    expect(run(["2x + 3 = 11"], ["2x = 8 + 2y"])).toEqual([false]);
    // partial fractions' A and B are names no step defined (a known gap, not a hole)
    expect(run(["\\int \\frac{1}{x^{2} - 1} \\, dx"], ["\\frac{1}{x^{2} - 1} = \\frac{A}{x - 1} + \\frac{B}{x + 1}"])).toEqual([false]);
    // a list of answers is not a way in: each clause only defines its own left-hand side
    expect(run(["2x + 3 = 11"], ["x = 4, \\ x = 4 + w"])).toEqual([false]);
  });
});

describe("solveSteps: the board's judge of a whole solve stream (shared with the solve route)", () => {
  const judgeFor = (lines: string[]) => createSolveStepJudge({ sourceLatex: lines, parses: (latex) => engineParsesStep(engine, latex) });

  it("skips a restatement, draws what the guard accepts, refuses the rest and keeps the first refusal's reason", () => {
    const judge = judgeFor(["2x + 3 = 11"]);
    // the student's own line read back is skipped, not refused
    expect(judge.judge("2x+3=11")).toEqual({ drawn: false, skipped: true });
    expect(judge.judge("2x + 3 - 3 = 11 - y")).toMatchObject({ drawn: false, skipped: false, reason: "unknown-symbol", introduced: ["y"] });
    expect(judge.judge("\\text{Sorry, I can't}")).toMatchObject({ drawn: false, reason: "unparseable" });
    expect(judge.judge("2x = 8")).toEqual({ drawn: true });
    expect(judge.judge("\\boxed{x = 4}")).toEqual({ drawn: true });
    // the same step again is a restatement now
    expect(judge.judge("x=4")).toEqual({ drawn: false, skipped: true });
    expect(judge.drawn).toBe(2);
    expect(judge.discarded).toBe(2);
    expect(judge.firstRejection).toEqual({ reason: "unknown-symbol", introduced: ["y"], latex: "2x + 3 - 3 = 11 - y" });
  });

  it("a solve the board can draw nothing of: drawn 0, discarded > 0 (what the route retries once)", () => {
    const judge = judgeFor(["3(x+2)=21"]);
    judge.judge("u = x + 2");
    expect(judge.drawn).toBe(1);
    const none = judgeFor(["3(x+2)=21"]);
    none.judge("y = 7 + z");
    none.judge("\\boxed{x = 5w}");
    expect(none.drawn).toBe(0);
    expect(none.discarded).toBe(2);
  });

  it("compares steps exactly as the board does (`normalizeStep` is `stepKey`)", () => {
    for (const latex of ["\\boxed{x = 4}", "2 \\cdot x \\quad = 8", "\\left(x+1\\right)^{2}", "x\\times y"]) expect(normalizeStep(latex)).toBe(stepKey(latex));
  });

  // Production, 2026-10-10 (board cb442a82): the chat's problem `n^{5} \cdot n^{4}` heads the column,
  // the child's answer under it was read as `1 A^{9}`. The model, shown both, answers in n.
  const PROD_REQUEST = [
    { id: "chat-problem-1-0", latex: "n^{5} \\cdot n^{4}" },
    { id: "ln_7a08c98d", latex: "1 A^{9}" },
  ];
  const PROD_STEPS = ["n^{5} \\cdot n^{4}", "= n^{5 + 4}", "\\boxed{= n^{9}}"];

  it("judged against the lines the model was shown (`solveSourceLatex`), the chat's problem included, the steps are drawn", () => {
    expect(solveSourceLatex(PROD_REQUEST)).toEqual(["n^{5} \\cdot n^{4}", "1 A^{9}"]);
    const judge = judgeFor(solveSourceLatex(PROD_REQUEST));
    // the problem read back is skipped; the working is drawn
    expect(PROD_STEPS.map((s) => judge.judge(s))).toEqual([{ drawn: false, skipped: true }, { drawn: true }, { drawn: true }]);
    expect(judge.firstRejection).toBeNull();
  });

  it("…which the board's guard, judging against the child's line alone, refused every one of (the prod failure)", () => {
    const judge = judgeFor(["1 A^{9}"]);
    for (const s of PROD_STEPS) judge.judge(s);
    expect({ drawn: judge.drawn, discarded: judge.discarded }).toEqual({ drawn: 0, discarded: 3 });
    expect(judge.firstRejection).toEqual({ reason: "unknown-symbol", introduced: ["n"], latex: "n^{5} \\cdot n^{4}" });
  });
});
