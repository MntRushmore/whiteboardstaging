import { beforeAll, describe, expect, it } from "vitest";
import type { LiveEngine } from "../../contracts";
import { planHandwriting } from "../../handwriting";
import { localAnswerStep } from "../../solveSteps";
import { getEngine } from "..";

/**
 * Calculus with teacher-quality steps (`engine/calculus.ts`): derivatives, integrals and limits
 * as the lines a teacher writes under the question — the rule applied, then simplified — exact,
 * local, and drawable by the tutor's hand. `simplifySteps` returns bare lines (the board writes
 * them as `= …`); `solveFromLines` returns lines ready to draw.
 */

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

const steps = (latex: string) => engine.simplifySteps!(latex);
const fromLines = (lines: string[]) => engine.solveFromLines!(lines);
const feedback = { mode: "feedback" as const };
const answer = { mode: "answer" as const };

// ---------------------------------------------------------------------------------------------
// 1. Derivatives
// ---------------------------------------------------------------------------------------------

const DERIVATIVES: Array<[string, string[]]> = [
  // power rule, constant multiple, sum: the rule line shows the multiplication, then it is done
  ["\\frac{d}{dx}(3x^2+2x)", ["3 \\cdot 2x + 2", "6x + 2"]],
  ["\\frac{d}{dx} x^3", ["3x^{2}"]],
  ["\\frac{d}{dx}(5x^4 - 3x^2 + 7)", ["5 \\cdot 4x^{3} - 3 \\cdot 2x", "20x^{3} - 6x"]],
  ["\\frac{d}{dx} 7", ["0"]],
  ["\\frac{d}{dt}(5t^3 - t)", ["5 \\cdot 3t^{2} - 1", "15t^{2} - 1"]],
  // negative and fractional powers: rewritten as a power first, the answer with positive indices
  ["\\frac{d}{dx} x^{-2}", ["-2x^{-3}", "-\\frac{2}{x^{3}}"]],
  ["\\frac{d}{dx}(3x^{-2})", ["3 \\cdot (-2x^{-3})", "-6x^{-3}", "-\\frac{6}{x^{3}}"]],
  ["\\frac{d}{dx} \\frac{1}{x}", ["\\frac{d}{dx} x^{-1}", "-x^{-2}", "-\\frac{1}{x^{2}}"]],
  ["\\frac{d}{dx} \\sqrt{x}", ["\\frac{d}{dx} x^{\\frac{1}{2}}", "\\frac{1}{2}x^{-\\frac{1}{2}}", "\\frac{1}{2\\sqrt{x}}"]],
  ["\\frac{d}{dx}\\frac{x^2+1}{x}", ["\\frac{d}{dx}(x + x^{-1})", "1 - x^{-2}", "1 - \\frac{1}{x^{2}}"]],
  // product rule: u'v + uv'
  ["\\frac{d}{dx}(x^2 \\sin x)", ["2x\\sin x + x^{2}\\cos x"]],
  ["\\frac{d}{dx}(x e^{x})", ["e^{x} + xe^{x}"]],
  ["\\frac{d}{dx} x(x+1)", ["x + 1 + x", "2x + 1"]],
  // quotient rule: (u'v - uv') / v², one fraction to the end
  ["\\frac{d}{dx}\\frac{x}{x+1}", ["\\frac{x + 1 - x}{(x + 1)^{2}}", "\\frac{1}{(x + 1)^{2}}"]],
  ["\\frac{d}{dx}\\frac{\\sin x}{x}", ["\\frac{x\\cos x - \\sin x}{x^{2}}"]],
  // chain rule: outer derivative · inner derivative, then tidied
  ["\\frac{d}{dx}\\sin(3x)", ["\\cos(3x) \\cdot 3", "3\\cos(3x)"]],
  ["\\frac{d}{dx}\\cos(2x)", ["-\\sin(2x) \\cdot 2", "-2\\sin(2x)"]],
  ["\\frac{d}{dx}(2x+1)^5", ["5(2x + 1)^{4} \\cdot 2", "10(2x + 1)^{4}"]],
  ["\\frac{d}{dx}e^{2x}", ["e^{2x} \\cdot 2", "2e^{2x}"]],
  ["\\frac{d}{dx}\\ln(x^2+1)", ["\\frac{1}{x^{2} + 1} \\cdot 2x", "\\frac{2x}{x^{2} + 1}"]],
  ["\\frac{d}{dx}\\sqrt{x^2+1}", ["\\frac{d}{dx} (x^{2} + 1)^{\\frac{1}{2}}", "\\frac{1}{2}(x^{2} + 1)^{-\\frac{1}{2}} \\cdot 2x", "\\frac{x}{\\sqrt{x^{2} + 1}}"]],
  ["\\frac{d}{dx}\\frac{1}{x^2+1}", ["\\frac{d}{dx} (x^{2} + 1)^{-1}", "-(x^{2} + 1)^{-2} \\cdot 2x", "-\\frac{2x}{(x^{2} + 1)^{2}}"]],
  ["\\frac{d}{dx}\\sin^2 x", ["2\\sin x \\cdot \\cos x", "2\\sin x \\cos x"]],
  // exp / log / trig
  ["\\frac{d}{dx}\\tan x", ["\\sec^{2} x"]],
  ["\\frac{d}{dx}\\ln x", ["\\frac{1}{x}"]],
  ["\\frac{d}{dx}\\ln|x|", ["\\frac{1}{x}"]],
  ["\\frac{d}{dx} 2^{x}", ["2^{x}\\ln 2"]],
  // second derivatives: differentiate under the derivative still to take, then differentiate
  // the answer — every line equals the question (`= 4x^{3}` would be the FIRST derivative)
  ["\\frac{d^2}{dx^2}(x^3 + 2x^2)", ["\\frac{d}{dx}(3x^{2} + 2 \\cdot 2x)", "\\frac{d}{dx}(3x^{2} + 4x)", "3 \\cdot 2x + 4", "6x + 4"]],
  ["\\frac{d^2}{dx^2} x^4", ["\\frac{d}{dx}(4x^{3})", "4 \\cdot 3x^{2}", "12x^{2}"]],
  ["\\frac{d^3}{dx^3} x^5", ["\\frac{d^{2}}{dx^{2}}(5x^{4})", "\\frac{d}{dx}(5 \\cdot 4x^{3})", "\\frac{d}{dx}(20x^{3})", "20 \\cdot 3x^{2}", "60x^{2}"]],
  ["\\frac{d^2}{dx^2} \\frac{1}{x}", ["\\frac{d^{2}}{dx^{2}}(x^{-1})", "\\frac{d}{dx}(-x^{-2})", "2x^{-3}", "\\frac{2}{x^{3}}"]],
];

describe("derivatives: the rule applied, then simplified", () => {
  it.each(DERIVATIVES)("%s", (latex, expected) => {
    expect(steps(latex)).toEqual(expected);
  });

  it("the answer is the same with a trailing `=` and as the line's own result", () => {
    expect(steps("\\frac{d}{dx}(3x^2+2x) =")).toEqual(["3 \\cdot 2x + 2", "6x + 2"]);
    expect(engine.analyzeLine("\\frac{d}{dx}(3x^2+2x) =", answer).resultLatex).toBe("6x + 2");
  });
});

// ---------------------------------------------------------------------------------------------
// 2. Indefinite integrals
// ---------------------------------------------------------------------------------------------

const INDEFINITE: Array<[string, string[]]> = [
  ["\\int x^2 dx", ["\\frac{x^{3}}{3} + C"]],
  ["\\int 3x^2 dx", ["3 \\cdot \\frac{x^{3}}{3} + C", "x^{3} + C"]],
  ["\\int (4x^3 - 2x + 5) dx", ["4 \\cdot \\frac{x^{4}}{4} - 2 \\cdot \\frac{x^{2}}{2} + 5x + C", "x^{4} - x^{2} + 5x + C"]],
  ["\\int 5 \\, dx", ["5x + C"]],
  // rewrite first: a root or a reciprocal as a power
  ["\\int \\sqrt{x} dx", ["\\int x^{\\frac{1}{2}} \\, dx", "\\frac{x^{\\frac{3}{2}}}{\\frac{3}{2}} + C", "\\frac{2}{3}x^{\\frac{3}{2}} + C"]],
  ["\\int \\frac{1}{x^2} dx", ["\\int x^{-2} \\, dx", "\\frac{x^{-1}}{-1} + C", "-\\frac{1}{x} + C"]],
  ["\\int x(x+2) dx", ["\\int (x^{2} + 2x) \\, dx", "\\frac{x^{3}}{3} + 2 \\cdot \\frac{x^{2}}{2} + C", "\\frac{x^{3}}{3} + x^{2} + C"]],
  ["\\int \\frac{x^2+1}{x} dx", ["\\int (x + \\frac{1}{x}) \\, dx", "\\frac{x^{2}}{2} + \\ln|x| + C"]],
  // 1/x, e^{kx}, sin(kx), cos(kx), a linear inside
  ["\\int \\frac{1}{x} dx", ["\\ln|x| + C"]],
  ["\\int \\frac{3}{x} dx", ["3\\ln|x| + C"]],
  ["\\int e^{2x} dx", ["\\frac{e^{2x}}{2} + C"]],
  ["\\int 6e^{3x} dx", ["6 \\cdot \\frac{e^{3x}}{3} + C", "2e^{3x} + C"]],
  ["\\int \\sin(3x) dx", ["-\\frac{\\cos(3x)}{3} + C"]],
  ["\\int \\cos x \\, dx", ["\\sin x + C"]],
  ["\\int (2x+1)^3 dx", ["\\frac{(2x + 1)^{4}}{4 \\cdot 2} + C", "\\frac{(2x + 1)^{4}}{8} + C"]],
  ["\\int \\frac{1}{2x+1} dx", ["\\frac{1}{2}\\ln|2x + 1| + C"]],
];

describe("indefinite integrals: rewrite, integrate term by term, simplify, + C", () => {
  it.each(INDEFINITE)("%s", (latex, expected) => {
    expect(steps(latex)).toEqual(expected);
  });

  it("is the line's own answer too, where it used to be refused", () => {
    const a = engine.analyzeLine("\\int x^2 dx =", answer);
    expect(a.kind).toBe("expression");
    expect(a.resultLatex).toBe("\\frac{x^{3}}{3} + C");
    // a trailing `=` is still an answer-mode reveal
    expect(engine.analyzeLine("\\int x^2 dx =", feedback).resultLatex).toBe("");
  });
});

// ---------------------------------------------------------------------------------------------
// 3. Definite integrals
// ---------------------------------------------------------------------------------------------

const DEFINITE: Array<[string, string[]]> = [
  ["\\int_0^2 3x^2 dx", ["\\left[x^{3}\\right]_{0}^{2}", "8 - 0", "8"]],
  ["\\int_1^3 (4x^3 - 2x) dx", ["\\left[x^{4} - x^{2}\\right]_{1}^{3}", "72 - 0", "72"]],
  ["\\int_1^4 \\sqrt{x} dx", ["\\int_{1}^{4} x^{\\frac{1}{2}} \\, dx", "\\left[\\frac{2}{3}x^{\\frac{3}{2}}\\right]_{1}^{4}", "\\frac{16}{3} - \\frac{2}{3}", "\\frac{14}{3}"]],
  ["\\int_1^2 x^{-2} dx", ["\\left[-\\frac{1}{x}\\right]_{1}^{2}", "-\\frac{1}{2} - (-1)", "\\frac{1}{2}"]],
  // exact where the old engine gave 4 significant figures
  ["\\int_1^2 \\frac{1}{x} dx", ["\\left[\\ln|x|\\right]_{1}^{2}", "\\ln 2 - 0", "\\ln 2"]],
  ["\\int_2^4 \\frac{1}{x} dx", ["\\left[\\ln|x|\\right]_{2}^{4}", "\\ln 4 - \\ln 2", "\\ln 2"]],
  ["\\int_0^2 e^x dx", ["\\left[e^{x}\\right]_{0}^{2}", "e^{2} - 1"]],
  ["\\int_0^{\\pi} \\sin x \\, dx", ["\\left[-\\cos x\\right]_{0}^{\\pi}", "1 - (-1)", "2"]],
  ["\\int_{0}^{\\frac{\\pi}{2}} \\cos x \\, dx", ["\\left[\\sin x\\right]_{0}^{\\frac{\\pi}{2}}", "1 - 0", "1"]],
];

describe("definite integrals: the antiderivative in brackets, evaluated, subtracted", () => {
  it.each(DEFINITE)("%s", (latex, expected) => {
    expect(steps(latex)).toEqual(expected);
  });

  it("gives the same exact answer on the line itself", () => {
    expect(engine.analyzeLine("\\int_1^2 \\frac{1}{x} dx =", answer).resultLatex).toBe("\\ln 2");
    expect(engine.analyzeLine("\\int_0^2 e^x dx =", answer).resultLatex).toBe("e^{2} - 1");
  });

  it("refuses rather than integrate across a pole or a root of a negative", () => {
    expect(steps("\\int_{-1}^{1} \\frac{1}{x} dx")).toBeNull();
    expect(steps("\\int_{0}^{1} \\frac{1}{x^2} dx")).toBeNull();
    expect(steps("\\int_{-1}^{1} \\sqrt{x} dx")).toBeNull();
    expect(steps("\\int_{0}^{\\infty} e^{-x} dx")).toBeNull();
  });

  it("keeps the numeric fallback for what it cannot integrate, as a 4-significant-figure decimal", () => {
    expect(steps("\\int_{0}^{1} e^{x^2} dx")).toBeNull();
    expect(engine.analyzeLine("\\int_{0}^{1} e^{x^2} dx =", answer).resultLatex).toBe("1.463");
  });
});

// ---------------------------------------------------------------------------------------------
// 4. Limits
// ---------------------------------------------------------------------------------------------

const LIMITS: Array<[string, string[]]> = [
  // direct substitution when the function is defined there
  ["\\lim_{x \\to 3}(x^2+1)", ["3^{2} + 1", "10"]],
  ["\\lim_{x \\to -1}(x^3 - x)", ["(-1)^{3} - (-1)", "0"]],
  ["\\lim_{x \\to 4}\\sqrt{x}", ["\\sqrt{4}", "2"]],
  ["\\lim_{x \\to \\pi}\\sin x", ["\\sin\\pi", "0"]],
  // 0/0: factor, cancel, substitute
  ["\\lim_{x \\to 2}\\frac{x^2-4}{x-2}", ["\\lim_{x \\to 2} \\frac{(x - 2)(x + 2)}{x - 2}", "\\lim_{x \\to 2} (x + 2)", "4"]],
  ["\\lim_{x \\to 1}\\frac{x^2 - 1}{x^2 + x - 2}", ["\\lim_{x \\to 1} \\frac{(x - 1)(x + 1)}{(x - 1)(x + 2)}", "\\lim_{x \\to 1} \\frac{x + 1}{x + 2}", "\\frac{2}{3}"]],
  ["\\lim_{x \\to 0}\\frac{x^2+3x}{x}", ["\\lim_{x \\to 0} \\frac{x(x + 3)}{x}", "\\lim_{x \\to 0} (x + 3)", "3"]],
  ["\\lim_{x \\to 3}\\frac{x^3 - 27}{x - 3}", ["\\lim_{x \\to 3} \\frac{(x - 3)(x^{2} + 3x + 9)}{x - 3}", "\\lim_{x \\to 3} (x^{2} + 3x + 9)", "27"]],
  ["\\lim_{x \\to \\frac{1}{2}}\\frac{2x^2 - x}{2x - 1}", ["\\lim_{x \\to \\frac{1}{2}} \\frac{x(2x - 1)}{2x - 1}", "\\lim_{x \\to \\frac{1}{2}} x", "\\frac{1}{2}"]],
  // at infinity: divide by the highest power in the denominator
  ["\\lim_{x \\to \\infty}\\frac{3x^2+1}{2x^2-x}", ["\\lim_{x \\to \\infty} \\frac{3 + \\frac{1}{x^{2}}}{2 - \\frac{1}{x}}", "\\frac{3 + 0}{2 - 0}", "\\frac{3}{2}"]],
  ["\\lim_{x \\to \\infty}\\frac{x+1}{x^2}", ["\\lim_{x \\to \\infty} (\\frac{1}{x} + \\frac{1}{x^{2}})", "0 + 0", "0"]],
  ["\\lim_{x \\to \\infty}\\frac{x^2+1}{x-1}", ["\\lim_{x \\to \\infty} \\frac{x + \\frac{1}{x}}{1 - \\frac{1}{x}}", "\\infty"]],
  ["\\lim_{x \\to -\\infty}\\frac{x^3}{x^2+1}", ["\\lim_{x \\to -\\infty} \\frac{x}{1 + \\frac{1}{x^{2}}}", "-\\infty"]],
  ["\\lim_{x \\to \\infty}(x^2 - 3x)", ["\\lim_{x \\to \\infty} x^{2}(1 - \\frac{3}{x})", "\\infty"]],
  ["\\lim_{x \\to \\infty}\\frac{1}{x}", ["0"]],
  // the standard results
  ["\\lim_{x \\to 0}\\frac{\\sin x}{x}", ["1"]],
  ["\\lim_{x \\to 0}\\frac{\\sin 3x}{x}", ["\\lim_{x \\to 0} 3 \\cdot \\frac{\\sin(3x)}{3x}", "3 \\cdot 1", "3"]],
  ["\\lim_{x \\to 0}\\frac{1 - \\cos x}{x}", ["0"]],
];

describe("limits: substitute, or factor and cancel, or divide by the highest power", () => {
  it.each(LIMITS)("%s", (latex, expected) => {
    expect(steps(latex)).toEqual(expected);
  });

  it("the value is the line's answer too", () => {
    expect(engine.analyzeLine("\\lim_{x \\to 2}\\frac{x^2-4}{x-2} =", answer).resultLatex).toBe("4");
    expect(engine.analyzeLine("\\lim_{x \\to \\infty}\\frac{x^2+1}{x-1} =", answer).resultLatex).toBe("\\infty");
  });

  it("refuses what it cannot do exactly", () => {
    for (const latex of [
      "\\lim_{x \\to 1}\\frac{1}{x-1}", // no finite limit
      "\\lim_{n \\to \\infty}(1 + \\frac{1}{n})^n", // e, not a rational function
      "\\lim_{x \\to 4}\\frac{\\sqrt{x} - 2}{x - 4}", // needs the conjugate
      "\\lim_{x \\to 0}\\frac{\\sin x}{x^2}",
      "\\lim_{x \\to 0^{+}}\\ln x", // one-sided
    ]) {
      expect(steps(latex), latex).toBeNull();
    }
  });
});

describe("the board's order of asking", () => {
  it("solveLatex leaves a calculus line to simplifySteps (it is not an equation to solve)", () => {
    for (const latex of ["\\int x^2 dx =", "\\lim_{x \\to 2}\\frac{x^2-4}{x-2} =", "\\frac{d}{dx}(3x^2+2x) =", "\\int_0^2 3x^2 dx =", "\\frac{d}{dx}(x^3) = 3x^2", "\\int 2x \\, dx = x^2 + C"]) {
      expect(engine.solveLatex(latex), latex).toBeNull();
    }
  });
});

describe("what the engine refuses stays refused (the model may try; nothing wrong is drawn)", () => {
  it.each([
    "\\int x e^{x} dx", // integration by parts
    "\\int \\sin^2 x \\, dx", // an identity first
    "\\int \\frac{1}{x^2+1} dx", // arctan
    "\\int x\\cos(x^2) dx", // substitution
    "\\frac{d}{dx} x^x",
    "\\frac{d}{dx} f(x)",
  ])("%s", (latex) => {
    expect(steps(latex)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// dy/dx, f'(x) and f'(2) from the lines above
// ---------------------------------------------------------------------------------------------

describe("derivative notation against a definition above (solveFromLines)", () => {
  it("\\frac{dy}{dx} under y = …", () => {
    expect(fromLines(["y = 3x^2 + 2x", "\\frac{dy}{dx}"])).toEqual({ latex: "\\frac{dy}{dx} = 6x + 2", steps: ["= 3 \\cdot 2x + 2", "= 6x + 2"] });
    expect(fromLines(["y = \\sin(2x)", "\\frac{\\mathrm{d} y}{\\mathrm{d} x} ="])?.steps).toEqual(["= \\cos(2x) \\cdot 2", "= 2\\cos(2x)"]);
  });

  it("f'(x), f''(x) and y' under their definitions", () => {
    expect(fromLines(["f(x) = x^3 - 2x", "f'(x) ="])?.steps).toEqual(["= 3x^{2} - 2"]);
    expect(fromLines(["f(x) = x^3 - 2x", "f''(x)"])?.steps).toEqual(["= \\frac{d}{dx}(3x^{2} - 2)", "= 3 \\cdot 2x", "= 6x"]);
    expect(fromLines(["y = e^{3x}", "y'"])?.steps).toEqual(["= e^{3x} \\cdot 3", "= 3e^{3x}"]);
  });

  it("f'(2): the derivative, then its value at the point", () => {
    expect(fromLines(["f(x) = x^3", "f'(2) ="])).toEqual({ latex: "f'(2) = 12", steps: ["f'(x) = 3x^{2}", "f'(2) = 3 \\cdot 2^{2}", "= 12"] });
    expect(fromLines(["f(x) = 3x^2 + 2x", "f'(-1)"])?.steps).toEqual(["f'(x) = 3 \\cdot 2x + 2", "= 6x + 2", "f'(-1) = 6(-1) + 2", "= -4"]);
  });

  it("a calculus line under a system is answered as calculus, not as the system", () => {
    expect(fromLines(["x + y = 18", "x - y = 4", "\\frac{d}{dx}(x^2)"])?.steps).toEqual(["= 2x"]);
    // …and the system still solves when the last line asks for it, or is ordinary algebra
    expect(fromLines(["x + y = 18", "x - y = 4", "x = ?"])?.latex).toBe("x = 11");
    expect(fromLines(["x + y = 18", "x - y = 4", "\\frac{d + 1}{2}"])?.latex).toBe("x = 11");
  });

  it("no definition in scope: nothing to say", () => {
    expect(fromLines(["\\frac{dy}{dx}"])).toBeNull();
    expect(fromLines(["y = 2x", "f'(x)"])).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// 5. Checking the student's own calculus
// ---------------------------------------------------------------------------------------------

describe("checking a student's calculus line", () => {
  const verdict = (latex: string) => engine.analyzeLine(latex, feedback).verdict;

  it("derivatives", () => {
    expect(verdict("\\frac{d}{dx}(x^3) = 3x^2")).toBe("ok");
    expect(verdict("\\frac{d}{dx}(x^3) = 3x")).toBe("mismatch");
    expect(verdict("\\frac{d}{dx}\\sin(3x) = 3\\cos(3x)")).toBe("ok");
    expect(verdict("\\frac{d}{dx}\\sin(3x) = \\cos(3x)")).toBe("mismatch");
  });

  it("an antiderivative is checked by differentiating it back, + C included", () => {
    expect(verdict("\\int 2x \\, dx = x^2 + C")).toBe("ok");
    expect(verdict("\\int \\cos x \\, dx = \\sin x + C")).toBe("ok");
    expect(verdict("\\int \\frac{1}{x} dx = \\ln|x| + C")).toBe("ok");
    expect(verdict("\\int 2x \\, dx = 2x^2 + C")).toBe("mismatch");
    // the constant of integration is part of the answer
    expect(verdict("\\int 2x \\, dx = x^2")).toBe("mismatch");
    // one the engine cannot integrate itself is still checked
    expect(verdict("\\int x e^{x} dx = x e^{x} - e^{x} + C")).toBe("ok");
    expect(verdict("\\int x e^{x} dx = x e^{x} + C")).toBe("mismatch");
  });

  it("definite integrals and limits, the evaluation bracket too", () => {
    expect(verdict("\\int_0^2 3x^2 dx = 8")).toBe("ok");
    expect(verdict("\\int_0^2 3x^2 dx = 6")).toBe("mismatch");
    expect(verdict("\\int_0^2 3x^2 dx = \\left[x^3\\right]_0^2")).toBe("ok");
    expect(verdict("\\left[x^3\\right]_0^2 = 8")).toBe("ok");
    expect(verdict("\\int_1^2 \\frac{1}{x} dx = \\ln 2")).toBe("ok");
    expect(verdict("\\lim_{x \\to 2}\\frac{x^2-4}{x-2} = 4")).toBe("ok");
    expect(verdict("\\lim_{x \\to 2}\\frac{x^2-4}{x-2} = 2")).toBe("mismatch");
  });
});

// ---------------------------------------------------------------------------------------------
// 6. Mathpix's LaTeX
// ---------------------------------------------------------------------------------------------

describe("Mathpix variants read the same", () => {
  it.each([
    ["\\int x^{2} d x", ["\\frac{x^{3}}{3} + C"]],
    ["\\int x^2 \\, dx", ["\\frac{x^{3}}{3} + C"]],
    ["\\int x^{2} \\mathrm{~d} x", ["\\frac{x^{3}}{3} + C"]],
    ["\\int x^{2} \\mathrm{d} x", ["\\frac{x^{3}}{3} + C"]],
    ["\\int x^{2} \\operatorname{d} x", ["\\frac{x^{3}}{3} + C"]],
    ["\\int_{0}^{2} 3 x^{2} d x", ["\\left[x^{3}\\right]_{0}^{2}", "8 - 0", "8"]],
    ["\\lim _{x \\rightarrow 2} \\frac{x^{2}-4}{x-2}", ["\\lim_{x \\to 2} \\frac{(x - 2)(x + 2)}{x - 2}", "\\lim_{x \\to 2} (x + 2)", "4"]],
    ["\\lim_{x \\to \\infty} \\frac{1}{x}", ["0"]],
    ["\\frac{d}{d x}\\left(3 x^{2}+2 x\\right)", ["3 \\cdot 2x + 2", "6x + 2"]],
    ["\\frac{\\mathrm{d}}{\\mathrm{d} x}\\left(x^{3}\\right)", ["3x^{2}"]],
    ["\\frac{\\operatorname{d}}{\\operatorname{d} x} x^{3}", ["3x^{2}"]],
    ["\\frac{d^{2}}{d x^{2}} x^{4}", ["\\frac{d}{dx}(4x^{3})", "4 \\cdot 3x^{2}", "12x^{2}"]],
    ["\\int e^{x} d x", ["e^{x} + C"]],
    ["\\int \\exp (x) d x", ["e^{x} + C"]],
    ["\\frac{d}{d x} \\exp (2 x)", ["e^{2x} \\cdot 2", "2e^{2x}"]],
    ["\\int \\frac{1}{x} d x=", ["\\ln|x| + C"]],
  ])("%s", (latex, expected) => {
    expect(steps(latex)).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------------------------
// The tutor's hand can write it
// ---------------------------------------------------------------------------------------------

/** Every step must be drawable by the tutor's hand: no `unsupported` (a partial `\frac` would be wrong maths). */
function unsupportedIn(lines: readonly string[]): string[] {
  const out = new Set<string>();
  for (const line of lines) for (const u of planHandwriting([line], { size: 28, seed: 1 }).unsupported) out.add(u);
  return [...out];
}

function expectDrawable(lines: readonly string[]): void {
  expect(unsupportedIn(lines)).toEqual([]);
  const { plan, unsupported } = planHandwriting(lines, { size: 28, seed: 1 });
  expect(unsupported).toEqual([]);
  expect(plan).not.toBeNull();
}

describe("the hand can write every step", () => {
  const all = [...DERIVATIVES, ...INDEFINITE, ...DEFINITE, ...LIMITS];
  it.each(all)("%s, as written under the line", (latex) => {
    const s = steps(latex);
    expect(s).not.toBeNull();
    expectDrawable(s!.map(localAnswerStep));
  });

  it.each([
    [["y = 3x^2 + 2x", "\\frac{dy}{dx}"]],
    [["f(x) = x^3", "f'(2) ="]],
    [["f(x) = 3x^2 + 2x", "f'(-1)"]],
    [["f(x) = x^3 - 2x", "f''(x)"]],
  ])("solveFromLines(%j)", (lines) => {
    const r = fromLines(lines);
    expect(r).not.toBeNull();
    expectDrawable(r!.steps);
  });
});
