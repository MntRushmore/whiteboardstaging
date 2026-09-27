/**
 * The Algebra 1 and Algebra 2 methods (`docs/eval/courses.md`), behind the engine's existing
 * contract: `index.ts` asks this module first at a few fixed points and keeps its own paths for
 * everything else.
 *
 *   simplify      `engine.simplifySteps` — an expression (exponent rules, radicals, complex
 *                 numbers, log properties, the binomial theorem, rational expressions, a series)
 *   simplifyLate  after the polynomial paths have nothing — long division
 *   solve         `engine.solveLatex` — a relation (a line in x and y to slope-intercept form,
 *                 exponentials over different bases, complex roots when the column uses `i`)
 *   fromLines     `engine.solveFromLines`, before the systems — function notation, two points /
 *                 a point and a slope, sequences, a mean, a formula with every value known
 *   fromLinesLate after the systems have nothing — a formula solved for a letter
 *   analyze       `engine.analyzeLine` — a claim about a function (`f(4) = 11`) under its definition
 *   analyzeFirst  `engine.analyzeLine`, before its own rules — a line about the data list above
 *                 (the data sorted, a statistic asked for or claimed), a form of the line or the
 *                 quadratic above asked for (`Ax + By = C`, `(h, k) = ?`), a vertex claimed
 *
 * `fromLines` and `solve` also answer those asks first: a statistic of a data list
 * (`statistics.ts`), a quadratic's vertex form, vertex or standard form (`quadraticForms.ts`), a
 * line's standard form (`linearFunctions.ts`) — asked under the line, or above the line Solve is
 * pressed on (then a line already in that form is refused: there is nothing to write).
 *
 * `"refuse"` means the line is one the older paths would misread (`f(4)` as `4f`): the engine
 * answers nothing rather than something wrong.
 */
import type { AnalyzeContext, LineAnalysis, SolveOptions } from "../contracts";
import { hasRelation, questionName, splitEquation, parseExpr, lettersOf, withoutQuestionMark, type CourseDeps } from "./courseKit";
import { complexQuadratic, complexSteps } from "./complexNumbers";
import { usesImaginaryUnit } from "./complexSetting";
import { exponentSteps } from "./exponentRules";
import { differentBasesSteps, logSteps, withChangeOfBase } from "./logProperties";
import { longDivisionSteps } from "./polynomialDivision";
import { binomialSteps, rationalSteps } from "./rationalExpressions";
import { formulaAnswer } from "./formulas";
import { sequenceAnswer, sigmaSteps } from "./sequences";
import { radicalSteps } from "./radicalExpr";
import { checkClaim, definitionFromMath, definitionOf, definitionsIn, evaluateCalls, hasFunctionCall, inverseOf, solveFunctionEquation } from "./functionNotation";
import { isLineInXY, lineFormAbove, lineFormAnalysis, lineFormAnswer, lineFormAsked, lineFromColumn, lineIn, pointsOn, sameLine, slopeIntercept } from "./linearFunctions";
import { solveForLetter } from "./literalEquations";
import { isStatisticClaim, statisticsAnalysis, statisticsAnswer } from "./statistics";
import { quadraticAnalysis, quadraticAnswer, quadraticAsk, quadraticFormAbove, quadraticIn, quadraticOf, sameQuadratic } from "./quadraticForms";

export type Refuse = "refuse";

export interface Solved {
  latex: string;
  steps: string[];
}

export interface Courses {
  simplify(latex: string): string[] | null | Refuse;
  simplifyLate(latex: string): string[] | null;
  solve(latex: string, opts?: SolveOptions): Solved | null | Refuse;
  fromLines(lines: readonly string[]): Solved | null | Refuse;
  fromLinesLate(lines: readonly string[]): Solved | null;
  analyze(latex: string, ctx: AnalyzeContext): LineAnalysis | null;
  /** a line about a data list, or asking for a form of the line / quadratic above (before the engine's own rules) */
  analyzeFirst(latex: string, ctx: AnalyzeContext): LineAnalysis | null;
  /** an exact answer finished the way the course writes it (`x = \log_{5} 7` → its change of base) */
  polish<T extends Solved>(solved: T): T;
}

const safely = <T>(fn: () => T): T | null => {
  try {
    return fn();
  } catch {
    return null;
  }
};

export function createCourses(deps: CourseDeps): Courses {
  /**
   * A form asked for above the target (`Ax + By = C`, `y = a(x - h)^{2} + k`, `\text{standard
   * form}`) and the target is that line / quadratic: its working, or "refuse" when it is already
   * in that form (nothing to write — and not a system of the lines above). Only when every other
   * line or quadratic above is the target rewritten: two different lines are a system.
   */
  const formAbove = (target: string, above: readonly string[]): Solved | Refuse | null => {
    const others = above.filter((l) => !lineFormAsked(l) && !quadraticAsk(l) && (isLineInXY(deps, l) || quadraticOf(deps, l) !== null));
    const quadForm = quadraticFormAbove(above);
    const quad = quadForm ? quadraticOf(deps, target) : null;
    if (quadForm && quad) return others.every((l) => sameQuadratic(deps, l, quad)) ? (quadraticIn(deps, quad, quadForm, target) ?? "refuse") : null;
    const lineForm = lineFormAbove(above);
    if (lineForm && isLineInXY(deps, target)) return others.every((l) => sameLine(deps, l, target)) ? (lineIn(deps, target, lineForm) ?? "refuse") : null;
    return null;
  };

  const fromLines = (lines: readonly string[]): Solved | null | Refuse => {
    const target = lines[lines.length - 1] ?? "";
    const above = lines.slice(0, -1);
    // asked by name or template under what it is about: a statistic of the data list, the
    // quadratic's vertex (form), the line's standard form — then a form asked for above the line
    const asked = statisticsAnswer(deps, lines) ?? quadraticAnswer(deps, lines) ?? lineFormAnswer(deps, lines);
    if (asked) return asked;
    const wanted = formAbove(target, above);
    if (wanted) return wanted;
    // function notation: a definition above and the target applies it
    const defs = definitionsIn(above);
    if (defs.size > 0) {
      const own = definitionOf(target);
      const redefined = own && defs.has(own.name) && !/[a-zA-Z]/.test(own.rhs.replace(/\\[a-zA-Z]+/g, ""));
      if (redefined || hasFunctionCall(target, defs.keys())) {
        const done = inverseOf(deps, target, defs) ?? evaluateCalls(deps, target, defs) ?? solveFunctionEquation(deps, target, defs);
        return done ?? "refuse";
      }
    }
    // two points, a point and a slope (`m = ?`, `y = ?` or nothing asked)
    const line = lineFromColumn(deps, lines);
    if (line) return line;
    // `y = ?` under one linear equation in x and y: slope-intercept form
    if (questionName(target) === "y") {
      const relations = above.filter(hasRelation);
      if (relations.length === 1) {
        const si = slopeIntercept(deps, relations[0]);
        if (si) return si;
      }
    }
    // a list of terms or a rule above: the nth term, the formula, a sum (a list's mean: `statistics.ts`, above)
    const seq = sequenceAnswer(deps, lines);
    if (seq) return seq;
    // a formula with every value known in decimals: worked out in those decimals
    return formulaAnswer(deps, lines);
  };

  /** A lone line in the column (nothing above it that is a relation or a point). */
  const alone = (latex: string, opts?: SolveOptions): boolean => {
    const column = opts?.column;
    if (!column || column.length === 0) return false;
    const others = column.slice(0, -1).filter((l) => l.trim() && l.trim() !== latex.trim());
    return others.every((l) => !hasRelation(l) && !pointsOn(deps, l));
  };

  const solve = (latex: string, opts?: SolveOptions): Solved | null | Refuse => {
    const defs = definitionsIn(opts?.column ?? []);
    if (hasFunctionCall(latex, defs.keys())) return "refuse";
    // a form asked for above the line (`Ax + By = C`, `\text{vertex form}`): the line in that form
    const wanted = opts?.column && opts.column.length > 1 ? formAbove(latex, opts.column.slice(0, -1)) : null;
    if (wanted) return wanted;
    // `\bar{x} = 10` under a data list is a claim about the data, not `x = 10` to solve
    if (opts?.column && isStatisticClaim(opts.column)) return "refuse";
    // no real roots, and the column already works with i: the complex ones (complexSetting.ts)
    if (opts?.complexRoots) {
      const c = complexQuadratic(deps, latex);
      if (c) return c;
    }
    // `3^{x} = 2^{x + 1}`: no common base, so the logs of both sides
    const bases = differentBasesSteps(deps, latex);
    if (bases) return bases;
    if (alone(latex, opts)) {
      // `(2, 3), (5, 9)`: the line through them
      if (pointsOn(deps, latex)?.length === 2) return lineFromColumn(deps, [latex]);
      // `y - 3 = 2(x - 1)`, `y = 3(x + 1) - 2`: already a line in y, written as y = mx + b. A
      // bare `2x + 3y = 6` is not (it may be one equation of a problem in two unknowns — a word
      // problem's setup): it needs `y = ?` below it.
      if (/^\s*y\s*(?:[+-]\s*(?:\d+(?:\.\d+)?|\\frac\s*\{\s*\d+\s*\}\s*\{\s*\d+\s*\}))?\s*=/.test(latex)) {
        const si = slopeIntercept(deps, latex);
        if (si) return si;
      }
    }
    return null;
  };

  const fromLinesLate = (lines: readonly string[]): Solved | null => {
    const target = lines[lines.length - 1] ?? "";
    const asked = questionName(target);
    if (!asked || !/^[a-zA-Z]$/.test(asked)) return null;
    // the nearest formula above that has the letter asked for, and another letter
    for (let i = lines.length - 2; i >= 0; i--) {
      const sides = splitEquation(lines[i]);
      if (!sides) continue;
      const node = parseExpr(deps, sides.join(" - (") + ")");
      if (!node) continue;
      const letters = lettersOf(node);
      if (!letters.includes(asked) || letters.length < 2) continue;
      const solved = solveForLetter(deps, lines[i], asked);
      return solved ? { latex: solved.final, steps: solved.steps } : null;
    }
    return null;
  };

  const simplify = (latex: string): string[] | null | Refuse => {
    if (hasFunctionCall(latex)) return "refuse";
    // `\sum_{n=1}^{10}(2n + 1)`: an arithmetic or geometric series, by its formula
    if (/^\s*\\sum/.test(latex)) return sigmaSteps(deps, latex);
    const { body } = withoutQuestionMark(latex);
    if (!body || hasRelation(body)) return null;
    const node = parseExpr(deps, body);
    if (!node) return null;
    const numeric = lettersOf(node).length === 0;
    if (numeric && (usesImaginaryUnit(body) || /\\sqrt\s*\{\s*-/.test(body))) return complexSteps(deps, node, body);
    if (/\\(?:log|ln)(?![a-zA-Z])/.test(body)) return logSteps(deps, node, body);
    if (numeric) return radicalSteps(deps, node, body) ?? exponentSteps(deps, node, body);
    return exponentSteps(deps, node, body) ?? binomialSteps(deps, node, body) ?? rationalSteps(deps, node, body);
  };

  return {
    simplify: (latex) => safely(() => simplify(latex)) ?? null,
    simplifyLate: (latex) =>
      safely(() => {
        const { body } = withoutQuestionMark(latex);
        const node = body && !hasRelation(body) ? parseExpr(deps, body) : null;
        return node ? longDivisionSteps(deps, node, body) : null;
      }) ?? null,
    solve: (latex, opts) => safely(() => solve(latex, opts)) ?? null,
    polish: (solved) => safely(() => withChangeOfBase(solved)) ?? solved,
    fromLines: (lines) => safely(() => fromLines(lines)) ?? null,
    fromLinesLate: (lines) => safely(() => fromLinesLate(lines)) ?? null,
    analyze: (latex, ctx) =>
      safely(() => {
        const prev = ctx.previous;
        if (!prev || prev.kind !== "function" || !prev.math) return null;
        const def = definitionFromMath(deps, prev.math);
        if (!def) return null;
        const verdict = checkClaim(deps, latex, new Map([[def.name, def]]));
        if (!verdict) return null;
        return { kind: "equation", math: "", resultLatex: "", verdict, note: "" } satisfies LineAnalysis;
      }) ?? null,
    analyzeFirst: (latex, ctx) => safely(() => statisticsAnalysis(deps, latex, ctx) ?? quadraticAnalysis(deps, latex, ctx) ?? lineFormAnalysis(deps, latex, ctx)) ?? null,
  };
}
