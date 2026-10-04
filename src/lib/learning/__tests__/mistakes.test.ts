import { beforeAll, describe, expect, it } from "vitest";
import type { LiveEngine } from "@/lib/live/contracts";
import { ANNOTATION_KINDS } from "@/lib/live/contracts";
import { getEngine } from "@/lib/live/engine";
import { MISTAKE_KINDS, type MistakeKind } from "../hint";
import { classifyMistake, mistakeFromAnnotation } from "../mistakes";

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

/** A real wrong step: the line above, the ringed line under it, and what went wrong. */
type Step = readonly [previous: string, ringed: string, kind: MistakeKind | null];

const WRONG_STEPS: Step[] = [
  // distribution: only the first term in the bracket multiplied
  ["3(x + 2) = 18", "3x + 2 = 18", "distribution"],
  ["3(x - 2) = 2x + 4", "3x - 2 = 2x + 4", "distribution"],
  ["2(x + 3) = 14", "2x + 3 = 14", "distribution"],
  ["4(2x - 1) - 3x", "= 8x - 1 - 3x", "distribution"],
  ["2(x + 4) + 3(x - 1)", "= 2x + 4 + 3x - 3", "distribution"],
  ["4(2x - 1) - 3x = 8x - 4 - 3x", "4x - 3x", "combining_terms"],
  ["4(2x - 1) - 3x = 8x - 4 - 3x", "4x - 4", "arithmetic"],
  ["4(2x - 1) - 3x", "8x - 1 - 3x", "distribution"],
  ["5 - (x - 3)", "= 5 - x - 3", "distribution"],
  ["-(x + 4) = 10", "-x + 4 = 10", "distribution"],
  // sign: one term's sign (or the inequality) the wrong way
  ["2x + 3 = 11", "2x = 11 + 3", "sign"],
  ["x - 7 = 3", "x = 3 - 7", "sign"],
  ["-2x > 4", "x > -2", "sign"],
  ["3 - 2x > 7", "2x > 4", "sign"],
  ["-3(x - 2) = 9", "-3x - 6 = 9", "sign"],
  ["5x = -20", "x = 4", "sign"],
  ["x^{2} - 5x + 6 = 0", "(x - 2)(x + 3) = 0", "sign"],
  ["-4 + 7", "= -3", "sign"],
  // both sides: one side changed, the other not
  ["2x + 3 = 11", "2x = 11", "both_sides"],
  ["3x = 12", "x = 12", "both_sides"],
  ["x + 5 = 9", "x + 5 = 4", "both_sides"],
  ["\\frac{x}{4} = 3", "x = 3", "both_sides"],
  ["3x + 5 = 2x + 9", "x + 5 = 2x + 9", "both_sides"],
  // inverse operation: across the = with the same operation, not its inverse
  ["x + 5 = 9", "x = 14", "inverse_operation"],
  ["2x = 8", "x = 16", "inverse_operation"],
  ["2x + 3 = 11", "2x = 14", "inverse_operation"],
  ["5x - 4 = 21", "5x = 17", "inverse_operation"],
  ["x - 4 = 10", "x = 6", "inverse_operation"],
  ["\\frac{x}{3} = 4", "x = \\frac{4}{3}", "inverse_operation"],
  ["3x + 5 = 2x + 9", "5x + 5 = 9", "inverse_operation"],
  // combining unlike terms
  ["3x + 2", "= 5x", "combining_terms"],
  ["4x + 3 = 11", "7x = 11", "combining_terms"],
  ["5x - 2 = 13", "3x = 13", "combining_terms"],
  ["x^{2} + 3x", "= 4x^{2}", "combining_terms"],
  // fractions added across
  ["\\frac{1}{2} + \\frac{1}{3}", "= \\frac{2}{5}", "fractions"],
  ["\\frac{3}{4} + \\frac{1}{6}", "= \\frac{4}{10}", "fractions"],
  ["\\frac{2}{3} + \\frac{1}{4}", "= \\frac{3}{12}", "fractions"],
  ["\\frac{5}{6} - \\frac{1}{4}", "= \\frac{4}{2}", "fractions"],
  ["\\frac{x}{2} + \\frac{x}{3}", "= \\frac{2x}{5}", "fractions"],
  // exponents: a wrong power rule
  ["x^{3} \\cdot x^{4}", "= x^{12}", "exponents"],
  ["(x^{2})^{3}", "= x^{5}", "exponents"],
  ["\\frac{x^{6}}{x^{2}}", "= x^{3}", "exponents"],
  ["(2x^{3})^{2}", "= 2x^{6}", "exponents"],
  ["2^{3} \\cdot 2^{4}", "= 4^{7}", "exponents"],
  ["3x \\cdot 2x", "= 6x", "exponents"],
  // arithmetic: the right step, one number off
  ["2x + 3 = 11", "2x = 9", "arithmetic"],
  ["2x = 8", "x = 6", "arithmetic"],
  ["3x = 21", "x = 8", "arithmetic"],
  ["7 \\times 8", "= 54", "arithmetic"],
  ["12 - 3 \\times 2", "= 18", "arithmetic"],
  ["0.5 + 0.25", "= 0.30", "arithmetic"],
  ["\\frac{3}{4} \\times 8", "= 5", "arithmetic"],
  ["2(x + 3) = 14", "2x + 6 = 15", "arithmetic"],
  // as Mathpix writes them
  ["2 x+3=11", "2 x=11+3", "sign"],
  ["3\\left(x+2\\right)=18", "3 x+2=18", "distribution"],
  ["x+5=9", "x=14", "inverse_operation"],
  // not a mistake it can name: the line follows, or the lines are not comparable
  ["2x + 3 = 11", "2x = 8", null],
  ["3(x + 2)", "= 3x + 6", null],
  ["x^{2} - 5x + 6 = 0", "(x - 2)(x - 3) = 0", null],
  ["-2x > 4", "x < -2", null],
  ["x^{2} = 49", "x = 8", null],
  ["2x + 3 = 11", "x + 1", null],
  ["2x + 3 = 11", "\\text{I don't know}", null],
  ["2x + 3 = 11", "", null],
  ["", "x = 4", null],
  ["2x + 3 = 11", "x = 2, x = 3", null],
];

describe("classifyMistake: real wrong steps", () => {
  it.each(WRONG_STEPS)("%s  →  %s  is %s", (previous, ringed, kind) => {
    expect(classifyMistake(engine, previous, ringed)).toBe(kind);
  });

  it("covers every kind the local classifier can name", () => {
    const named = new Set(WRONG_STEPS.map((s) => s[2]).filter(Boolean));
    for (const k of ["sign", "distribution", "both_sides", "inverse_operation", "combining_terms", "fractions", "exponents", "arithmetic"] as const) expect(named.has(k), k).toBe(true);
  });
});

describe("classifyMistake: safety", () => {
  it("never throws, whatever it is given", () => {
    const junk = ["\\frac{", "}{", "((", "\\", "=", "==", "?", "|x", "x^", "\\sqrt", "1/0 = x", "x = \\frac{1}{0}", "a".repeat(500), "\\int x dx", "x'"];
    for (const a of junk) for (const b of junk) expect(() => classifyMistake(engine, a, b)).not.toThrow();
    expect(classifyMistake(engine, null as unknown as string, "x")).toBeNull();
    expect(classifyMistake(engine, "x + 1 = 2", undefined as unknown as string)).toBeNull();
  });

  it("speaks only when its reading of the lines agrees with the engine's", () => {
    const disagrees: LiveEngine = { ...engine, compileExpr: () => () => 12345 };
    expect(classifyMistake(disagrees, "x + 5 = 9", "x = 14")).toBeNull();
    // an engine that cannot compile anything (mathjs failed to load) leaves the reading unchecked
    const stub: LiveEngine = { ...engine, compileExpr: () => null };
    expect(classifyMistake(stub, "x + 5 = 9", "x = 14")).toBe("inverse_operation");
    // a throwing engine is no engine
    const throwing: LiveEngine = {
      ...engine,
      compileExpr: () => {
        throw new Error("boom");
      },
    };
    expect(classifyMistake(throwing, "x + 5 = 9", "x = 14")).toBeNull();
  });

  it("runs in under 5 ms a call", () => {
    for (const [p, c] of WRONG_STEPS) classifyMistake(engine, p, c); // warm
    // each step's time, the best of three (a busy test machine's pauses are not the classifier's)
    const times = WRONG_STEPS.map(([p, c]) => {
      let best = Infinity;
      for (let r = 0; r < 3; r++) {
        const t0 = performance.now();
        classifyMistake(engine, p, c);
        best = Math.min(best, performance.now() - t0);
      }
      return best;
    });
    times.sort((a, b) => a - b);
    expect(times[Math.floor(times.length / 2)]).toBeLessThan(2);
    expect(times[times.length - 1]).toBeLessThan(5);
  });
});

describe("mistakeFromAnnotation", () => {
  it("the check model's mistake kinds are mistakes; praise, notation and incomplete are not", () => {
    expect(mistakeFromAnnotation("arithmetic")).toBe("arithmetic");
    expect(mistakeFromAnnotation("sign")).toBe("sign");
    expect(mistakeFromAnnotation("algebra")).toBe("algebra");
    expect(mistakeFromAnnotation("units")).toBe("units");
    expect(mistakeFromAnnotation("concept")).toBe("concept");
    for (const k of ["praise", "notation", "incomplete", "", "wrong", "distribution"]) expect(mistakeFromAnnotation(k)).toBeNull();
  });

  it("every annotation kind maps to a mistake kind or to nothing", () => {
    for (const k of ANNOTATION_KINDS) {
      const m = mistakeFromAnnotation(k);
      if (m !== null) expect(MISTAKE_KINDS).toContain(m);
    }
  });
});
