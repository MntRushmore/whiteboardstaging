import { beforeAll, describe, expect, it } from "vitest";
import type { LiveEngine } from "../../contracts";
import { planHandwriting } from "../../handwriting";
import { localAnswerStep } from "../../solveSteps";
import { getEngine } from "..";

/**
 * 0/0 limits past factorising (`engine/limits.ts`: the conjugate, L'Hôpital's rule) and the
 * harder derivatives (`engine/calculus.ts`: logarithmic and implicit differentiation, higher
 * derivatives written under the derivatives still to take). Exact, maths only, drawable.
 */

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

const steps = (latex: string) => engine.simplifySteps!(latex);
const fromLines = (lines: string[]) => engine.solveFromLines!(lines);
const answer = { mode: "answer" as const };
const drawable = (lines: readonly string[]) => planHandwriting(lines, { size: 28, seed: 1 }).unsupported;

const LIMITS: Array<[string, string[]]> = [
  // a root next to a number: the conjugate, top and bottom
  [
    "\\lim_{x \\to 0}\\frac{\\sqrt{x+4}-2}{x}",
    [
      "\\lim_{x \\to 0} \\frac{(\\sqrt{x + 4} - 2)(\\sqrt{x + 4} + 2)}{x(\\sqrt{x + 4} + 2)}",
      "\\lim_{x \\to 0} \\frac{x + 4 - 4}{x(\\sqrt{x + 4} + 2)}",
      "\\lim_{x \\to 0} \\frac{1}{\\sqrt{x + 4} + 2}",
      "\\frac{1}{\\sqrt{0 + 4} + 2}",
      "\\frac{1}{4}",
    ],
  ],
  [
    "\\lim_{x \\to 4}\\frac{\\sqrt{x}-2}{x-4}",
    [
      "\\lim_{x \\to 4} \\frac{(\\sqrt{x} - 2)(\\sqrt{x} + 2)}{(x - 4)(\\sqrt{x} + 2)}",
      "\\lim_{x \\to 4} \\frac{x - 4}{(x - 4)(\\sqrt{x} + 2)}",
      "\\lim_{x \\to 4} \\frac{1}{\\sqrt{x} + 2}",
      "\\frac{1}{\\sqrt{4} + 2}",
      "\\frac{1}{4}",
    ],
  ],
  [
    "\\lim_{x \\to 9}\\frac{x - 9}{\\sqrt{x} - 3}",
    [
      "\\lim_{x \\to 9} \\frac{(x - 9)(\\sqrt{x} + 3)}{(\\sqrt{x} - 3)(\\sqrt{x} + 3)}",
      "\\lim_{x \\to 9} \\frac{(x - 9)(\\sqrt{x} + 3)}{x - 9}",
      "\\lim_{x \\to 9} (\\sqrt{x} + 3)",
      "\\sqrt{9} + 3",
      "6",
    ],
  ],
  // any other 0/0: L'Hôpital — top and bottom differentiated until substitution gives a value
  ["\\lim_{x \\to 0}\\frac{e^{x}-1}{x}", ["\\lim_{x \\to 0} e^{x}", "e^{0}", "1"]],
  ["\\lim_{x \\to 0}\\frac{\\sin 3x}{\\sin 2x}", ["\\lim_{x \\to 0} \\frac{3\\cos(3x)}{2\\cos(2x)}", "\\frac{3\\cos(3 \\cdot 0)}{2\\cos(2 \\cdot 0)}", "\\frac{3}{2}"]],
  ["\\lim_{x \\to 0}\\frac{1 - \\cos x}{x^{2}}", ["\\lim_{x \\to 0} \\frac{\\sin x}{2x}", "\\lim_{x \\to 0} \\frac{\\cos x}{2}", "\\frac{\\cos 0}{2}", "\\frac{1}{2}"]],
  ["\\lim_{x \\to 1}\\frac{\\ln x}{x - 1}", ["\\lim_{x \\to 1} \\frac{1}{x}", "1"]],
];

describe("limits past factorising (simplifySteps)", () => {
  it.each(LIMITS)("%s", (latex, expected) => {
    expect(steps(latex)).toEqual(expected);
    expect(drawable(expected.map(localAnswerStep))).toEqual([]);
  });

  it("the value after `=` is exact", () => {
    expect(engine.analyzeLine("\\lim_{x \\to 0}\\frac{\\sqrt{x+4}-2}{x} =", answer).resultLatex).toBe("\\frac{1}{4}");
    expect(engine.analyzeLine("\\lim_{x \\to 0}\\frac{1 - \\cos x}{x^{2}} =", answer).resultLatex).toBe("\\frac{1}{2}");
  });

  it("still refuses what has no finite limit", () => {
    for (const latex of ["\\lim_{x \\to 0} \\frac{1}{x}", "\\lim_{x \\to 0} \\frac{\\cos x}{x}", "\\lim_{x \\to 0} \\frac{|x|}{x}"]) expect(steps(latex), latex).toBeNull();
  });
});

describe("harder derivatives", () => {
  it("logarithmic differentiation: y = f^g, logs, both sides, back", () => {
    const expected = ["y = x^{x}", "\\ln y = x\\ln x", "\\frac{1}{y}\\frac{dy}{dx} = \\ln x + 1", "\\frac{dy}{dx} = y(\\ln x + 1)", "x^{x}(\\ln x + 1)"];
    expect(steps("\\frac{d}{dx} x^{x}")).toEqual(expected);
    expect(drawable(expected.map(localAnswerStep))).toEqual([]);
    expect(engine.analyzeLine("\\frac{d}{dx} x^{x} =", answer).resultLatex).toBe("x^{x}(\\ln x + 1)");
    // under its definition, the definition is not written again
    expect(fromLines(["y = x^{x}", "\\frac{dy}{dx}"])?.steps).toEqual(["\\ln y = x\\ln x", "\\frac{1}{y}\\frac{dy}{dx} = \\ln x + 1", "\\frac{dy}{dx} = y(\\ln x + 1)", "= x^{x}(\\ln x + 1)"]);
  });

  it("implicit differentiation under a relation in x and y", () => {
    expect(fromLines(["x^{2} + y^{2} = 25", "\\frac{dy}{dx} ="])).toEqual({
      latex: "\\frac{dy}{dx} = -\\frac{x}{y}",
      steps: ["2x + 2y\\frac{dy}{dx} = 0", "2y\\frac{dy}{dx} = -2x", "\\frac{dy}{dx} = -\\frac{x}{y}"],
    });
    expect(fromLines(["xy = 6", "\\frac{dy}{dx}"])?.steps).toEqual(["y + x\\frac{dy}{dx} = 0", "x\\frac{dy}{dx} = -y", "\\frac{dy}{dx} = -\\frac{y}{x}"]);
    expect(fromLines(["x^{2} + xy + y^{2} = 7", "\\frac{dy}{dx}"])?.steps).toEqual(["2x + y + (x + 2y)\\frac{dy}{dx} = 0", "(x + 2y)\\frac{dy}{dx} = -2x - y", "\\frac{dy}{dx} = \\frac{-2x - y}{x + 2y}"]);
    expect(fromLines(["y^{3} + 3x^{2} = 2x", "\\frac{dy}{dx}"])?.steps).toEqual(["6x - 2 + 3y^{2}\\frac{dy}{dx} = 0", "3y^{2}\\frac{dy}{dx} = -6x + 2", "\\frac{dy}{dx} = \\frac{-6x + 2}{3y^{2}}"]);
    // with nothing above, `\frac{dy}{dx}` means nothing
    expect(fromLines(["\\frac{dy}{dx}"])).toBeNull();
  });

  it("inverse trig and higher derivatives", () => {
    expect(steps("\\frac{d}{dx}\\tan^{-1} x")).toEqual(["\\frac{1}{1 + x^{2}}"]);
    expect(steps("\\frac{d^{3}}{dx^{3}} x^{5} =")).toEqual(["\\frac{d^{2}}{dx^{2}}(5x^{4})", "\\frac{d}{dx}(5 \\cdot 4x^{3})", "\\frac{d}{dx}(20x^{3})", "20 \\cdot 3x^{2}", "60x^{2}"]);
  });
});
