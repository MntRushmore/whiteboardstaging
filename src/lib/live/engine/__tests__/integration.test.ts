import { beforeAll, describe, expect, it } from "vitest";
import type { LiveEngine } from "../../contracts";
import { planHandwriting } from "../../handwriting";
import { localAnswerStep } from "../../solveSteps";
import { getEngine } from "..";

/**
 * Integration techniques (`engine/integration.ts`, reached through `calculus.ts` when the
 * term-by-term rules have nothing): substitution with u and du shown, integration by parts with
 * u, dv, du, v and the formula, the identities (sin², cos², tan², tan), the standard forms
 * (tan⁻¹, sin⁻¹) and partial fractions — indefinite and definite. `simplifySteps` returns bare
 * lines; the board writes a relation (`u = x^{2} + 1`) as it stands and the rest as `= …`.
 */

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

const steps = (latex: string) => engine.simplifySteps!(latex);
const answer = { mode: "answer" as const };
const drawable = (lines: readonly string[]) => planHandwriting(lines, { size: 28, seed: 1 }).unsupported;

const INDEFINITE: Array<[string, string[]]> = [
  // substitution: u, du, the integral in u, back to x
  ["\\int 2x(x^{2}+1)^{5} \\, dx", ["u = x^{2} + 1", "du = 2x \\, dx", "\\int u^{5} \\, du", "\\frac{u^{6}}{6} + C", "\\frac{(x^{2} + 1)^{6}}{6} + C"]],
  ["\\int x e^{x^{2}} \\, dx", ["u = x^{2}", "du = 2x \\, dx", "\\frac{1}{2}\\int e^{u} \\, du", "\\frac{e^{u}}{2} + C", "\\frac{e^{x^{2}}}{2} + C"]],
  ["\\int \\frac{2x}{x^{2}+1} dx", ["u = x^{2} + 1", "du = 2x \\, dx", "\\int \\frac{1}{u} \\, du", "\\ln|u| + C", "\\ln(x^{2} + 1) + C"]],
  ["\\int \\sin x \\cos x \\, dx", ["u = \\sin x", "du = \\cos x \\, dx", "\\int u \\, du", "\\frac{u^{2}}{2} + C", "\\frac{\\sin^{2} x}{2} + C"]],
  ["\\int \\frac{\\ln x}{x} dx", ["u = \\ln x", "du = \\frac{1}{x} \\, dx", "\\int u \\, du", "\\frac{u^{2}}{2} + C", "\\frac{1}{2}(\\ln x)^{2} + C"]],
  [
    "\\int x \\sqrt{x^{2}+1} \\, dx",
    ["u = x^{2} + 1", "du = 2x \\, dx", "\\frac{1}{2}\\int \\sqrt{u} \\, du", "\\frac{1}{2} \\cdot \\frac{u^{\\frac{3}{2}}}{\\frac{3}{2}} + C", "\\frac{1}{3}u^{\\frac{3}{2}} + C", "\\frac{1}{3}(x^{2} + 1)^{\\frac{3}{2}} + C"],
  ],
  ["\\int \\frac{e^{x}}{1 + e^{x}} dx", ["u = 1 + e^{x}", "du = e^{x} \\, dx", "\\int \\frac{1}{u} \\, du", "\\ln|u| + C", "\\ln(1 + e^{x}) + C"]],
  // by parts: the formula, u and dv, du and v, uv - ∫v du
  ["\\int x e^{x} dx", ["\\int u \\, dv = uv - \\int v \\, du", "u = x, \\ dv = e^{x} \\, dx", "du = dx, \\ v = e^{x}", "xe^{x} - \\int e^{x} \\, dx", "xe^{x} - e^{x} + C"]],
  ["\\int x \\sin x \\, dx", ["\\int u \\, dv = uv - \\int v \\, du", "u = x, \\ dv = \\sin x \\, dx", "du = dx, \\ v = -\\cos x", "-x\\cos x + \\int \\cos x \\, dx", "-x\\cos x + \\sin x + C"]],
  ["\\int \\ln x \\, dx", ["\\int u \\, dv = uv - \\int v \\, du", "u = \\ln x, \\ dv = dx", "du = \\frac{1}{x} \\, dx, \\ v = x", "x\\ln x - \\int 1 \\, dx", "x\\ln x - x + C"]],
  [
    "\\int x^{2} \\ln x \\, dx",
    ["\\int u \\, dv = uv - \\int v \\, du", "u = \\ln x, \\ dv = x^{2} \\, dx", "du = \\frac{1}{x} \\, dx, \\ v = \\frac{x^{3}}{3}", "\\frac{1}{3}x^{3}\\ln x - \\int \\frac{x^{2}}{3} \\, dx", "\\frac{1}{3}x^{3}\\ln x - \\frac{x^{3}}{9} + C"],
  ],
  [
    "\\int \\tan^{-1} x \\, dx",
    ["\\int u \\, dv = uv - \\int v \\, du", "u = \\tan^{-1} x, \\ dv = dx", "du = \\frac{1}{1 + x^{2}} \\, dx, \\ v = x", "x\\tan^{-1} x - \\int \\frac{x}{1 + x^{2}} \\, dx", "x\\tan^{-1} x - \\frac{1}{2}\\ln(1 + x^{2}) + C"],
  ],
  // identities first
  ["\\int \\sin^{2} x \\, dx", ["\\int \\frac{1 - \\cos(2x)}{2} \\, dx", "\\frac{1}{2}x - \\frac{1}{2} \\cdot \\frac{\\sin(2x)}{2} + C", "\\frac{x}{2} - \\frac{\\sin(2x)}{4} + C"]],
  ["\\int \\cos^{2} x \\, dx", ["\\int \\frac{1 + \\cos(2x)}{2} \\, dx", "\\frac{1}{2}x + \\frac{1}{2} \\cdot \\frac{\\sin(2x)}{2} + C", "\\frac{x}{2} + \\frac{\\sin(2x)}{4} + C"]],
  ["\\int \\tan^{2} x \\, dx", ["\\int (\\sec^{2} x - 1) \\, dx", "\\tan x - x + C"]],
  ["\\int \\tan x \\, dx", ["\\int \\frac{\\sin x}{\\cos x} \\, dx", "u = \\cos x", "du = -\\sin x \\, dx", "-\\int \\frac{1}{u} \\, du", "-\\ln|u| + C", "-\\ln|\\cos x| + C"]],
  // standard forms
  ["\\int \\frac{1}{1+x^{2}} dx", ["\\tan^{-1} x + C"]],
  ["\\int \\frac{1}{x^{2}+4} dx", ["\\int \\frac{1}{x^{2} + 2^{2}} \\, dx", "\\frac{1}{2}\\tan^{-1}\\frac{x}{2} + C"]],
  ["\\int \\frac{1}{\\sqrt{1 - x^{2}}} dx", ["\\sin^{-1} x + C"]],
  // partial fractions: the decomposition, the identity, the cover-up values, the logs
  [
    "\\int \\frac{1}{x^{2}-1} dx",
    [
      "\\frac{1}{(x - 1)(x + 1)} = \\frac{A}{x - 1} + \\frac{B}{x + 1}",
      "1 = A(x + 1) + B(x - 1)",
      "A = \\frac{1}{2}, \\ B = -\\frac{1}{2}",
      "\\int \\left(\\frac{1}{2(x - 1)} - \\frac{1}{2(x + 1)}\\right) \\, dx",
      "\\frac{1}{2}\\ln|x - 1| - \\frac{1}{2}\\ln|x + 1| + C",
    ],
  ],
  [
    "\\int \\frac{x}{x^{2} - 5x + 6} dx",
    ["\\frac{x}{(x - 2)(x - 3)} = \\frac{A}{x - 2} + \\frac{B}{x - 3}", "x = A(x - 3) + B(x - 2)", "A = -2, \\ B = 3", "\\int \\left(-\\frac{2}{x - 2} + \\frac{3}{x - 3}\\right) \\, dx", "-2\\ln|x - 2| + 3\\ln|x - 3| + C"],
  ],
];

describe("indefinite integrals by technique (simplifySteps)", () => {
  it.each(INDEFINITE)("%s", (latex, expected) => {
    expect(steps(latex)).toEqual(expected);
    expect(drawable(expected.map(localAnswerStep))).toEqual([]);
  });

  it("a substitution's lines stand on their own; the rest continue with `=`", () => {
    expect(steps("\\int 2x(x^{2}+1)^{5} \\, dx")!.map(localAnswerStep)).toEqual([
      "u = x^{2} + 1",
      "du = 2x \\, dx",
      "= \\int u^{5} \\, du",
      "= \\frac{u^{6}}{6} + C",
      "= \\frac{(x^{2} + 1)^{6}}{6} + C",
    ]);
  });

  it("the answer after `=` is the antiderivative, and a claimed one is checked", () => {
    expect(engine.analyzeLine("\\int x e^{x} dx =", answer).resultLatex).toBe("xe^{x} - e^{x} + C");
    expect(engine.analyzeLine("\\int x e^{x^{2}} \\, dx =", answer).resultLatex).toBe("\\frac{e^{x^{2}}}{2} + C");
    expect(engine.analyzeLine("\\int \\ln x \\, dx = x \\ln x - x + C", { mode: "feedback" }).verdict).toBe("ok");
    expect(engine.analyzeLine("\\int \\ln x \\, dx = x \\ln x + C", { mode: "feedback" }).verdict).toBe("mismatch");
  });

  it("refuses what has no elementary antiderivative or goes round in a circle", () => {
    for (const latex of ["\\int e^{x^{2}} dx", "\\int \\sin(x^{2}) dx", "\\int e^{x}\\sin x \\, dx", "\\int \\frac{1}{x^{2} + x + 1} dx", "\\int \\frac{x^{3}}{x^{2} - 1} dx"]) {
      expect(steps(latex), latex).toBeNull();
    }
  });
});

const DEFINITE: Array<[string, string[]]> = [
  // a substitution changes the limits
  ["\\int_{0}^{1} 2x(x^{2}+1)^{5} dx", ["u = x^{2} + 1", "du = 2x \\, dx", "\\int_{1}^{2} u^{5} \\, du", "\\left[\\frac{u^{6}}{6}\\right]_{1}^{2}", "\\frac{32}{3} - \\frac{1}{6}", "\\frac{21}{2}"]],
  [
    "\\int_{0}^{1} x e^{x} dx",
    [
      "\\int u \\, dv = uv - \\int v \\, du",
      "u = x, \\ dv = e^{x} \\, dx",
      "du = dx, \\ v = e^{x}",
      "\\left[xe^{x}\\right]_{0}^{1} - \\int_{0}^{1} e^{x} \\, dx",
      "\\left[xe^{x} - e^{x}\\right]_{0}^{1}",
      "0 - (-1)",
      "1",
    ],
  ],
  ["\\int_{0}^{\\pi} \\sin^{2} x \\, dx", ["\\int_{0}^{\\pi} \\frac{1 - \\cos(2x)}{2} \\, dx", "\\left[\\frac{x}{2} - \\frac{\\sin(2x)}{4}\\right]_{0}^{\\pi}", "\\frac{\\pi}{2} - 0", "\\frac{\\pi}{2}"]],
  ["\\int_{0}^{1} \\frac{1}{1 + x^{2}} dx", ["\\left[\\tan^{-1} x\\right]_{0}^{1}", "\\frac{\\pi}{4} - 0", "\\frac{\\pi}{4}"]],
  [
    "\\int_{2}^{3} \\frac{1}{x^{2}-1} dx",
    [
      "\\frac{1}{(x - 1)(x + 1)} = \\frac{A}{x - 1} + \\frac{B}{x + 1}",
      "1 = A(x + 1) + B(x - 1)",
      "A = \\frac{1}{2}, \\ B = -\\frac{1}{2}",
      "\\int_{2}^{3} \\left(\\frac{1}{2(x - 1)} - \\frac{1}{2(x + 1)}\\right) \\, dx",
      "\\left[\\frac{1}{2}\\ln|x - 1| - \\frac{1}{2}\\ln|x + 1|\\right]_{2}^{3}",
      "(\\frac{1}{2}\\ln 2 - \\frac{1}{2}\\ln 4) - (-\\frac{1}{2}\\ln 3)",
      "\\frac{1}{2}\\ln\\frac{3}{2}",
    ],
  ],
];

describe("definite integrals by technique", () => {
  it.each(DEFINITE)("%s", (latex, expected) => {
    expect(steps(latex)).toEqual(expected);
    expect(drawable(expected.map(localAnswerStep))).toEqual([]);
  });

  it("the value after `=` is exact", () => {
    expect(engine.analyzeLine("\\int_{0}^{1} x e^{x} dx =", answer).resultLatex).toBe("1");
    expect(engine.analyzeLine("\\int_{0}^{1} \\frac{1}{1 + x^{2}} dx =", answer).resultLatex).toBe("\\frac{\\pi}{4}");
  });

  it("refuses across a pole", () => {
    expect(steps("\\int_{0}^{2} \\frac{1}{x^{2}-1} dx")).toBeNull();
  });
});

describe("inverse trig in the calculus tree", () => {
  it("differentiates tan⁻¹, sin⁻¹", () => {
    expect(steps("\\frac{d}{dx}\\tan^{-1} x")).toEqual(["\\frac{1}{1 + x^{2}}"]);
    expect(steps("\\frac{d}{dx}\\sin^{-1}(2x)")).toEqual(["\\frac{1}{\\sqrt{1 - (2x)^{2}}} \\cdot 2", "\\frac{2}{\\sqrt{1 - 4x^{2}}}"]);
  });
});
