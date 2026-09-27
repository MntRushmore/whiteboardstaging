/**
 * The one-unknown solvers past linear, and the order the engine tries them in.
 *
 *   |2x - 3| = 5          absolute value    → absolute.ts
 *   \sqrt{x + 3} = x - 3  radical           → radical.ts
 *   3^{x + 1} = 27        exponential / log → explog.ts
 *   \frac{1}{x} + 2 = 3   unknown below     → rationalEquation.ts
 *   x^2 - 5x + 6 = 0      polynomial        → quadratic.ts
 *   x^2 - 4 < 0           inequality        → inequality.ts (polynomial, one fraction, a chain)
 *
 * Each turns the line into a simpler one (a branch, the squared line, the exponents, the line
 * with the denominators cleared) and hands it back through `SolveContext.solve`, so every
 * solution ends in the same teacher-style linear or quadratic steps. Linear equations are
 * `algebra.ts`'s, reached here only for those follow-on lines. Pure: no mathjs at runtime.
 */
import type { MathNode } from "mathjs";
import { linearSolveSteps, qDiv, qNeg, type RelOp } from "./algebra";
import { absoluteSteps } from "./absolute";
import { expLogSteps } from "./explog";
import { chainSteps, inequalitySteps, type ParsedChain } from "./inequality";
import { argsOf, fnOf, mentions, polyOf, some } from "./nodes";
import { deg, exactly, polySub } from "./poly";
import { polynomialEquationSteps, qRoot } from "./quadratic";
import { radicalSteps } from "./radical";
import { rationalEquationSteps } from "./rationalEquation";
import type { Solution } from "./solution";

/** One relation in one unknown, translated: its sides as mathjs trees. */
export interface ParsedRelation {
  lhs: MathNode;
  rhs: MathNode;
  op: RelOp;
  variable: string;
  /** the line as LaTeX (preprocessed), for "was there a bracket" and "is this line new" */
  latex: string;
}

export interface AdvancedDeps {
  /** a one-unknown relation without units, decimals or calculus; null otherwise */
  relation(latex: string): ParsedRelation | null;
  /** `a < f < b` in one unknown, the same restrictions; null otherwise */
  chain?(latex: string): ParsedChain | null;
  /** two step lines are the same line (`\leq` is `\le`, spacing never counts) */
  normalize(latex: string): string;
}

export interface SolveContext {
  normalize(latex: string): string;
  /** solves a follow-on line (linear or any form here), or null */
  solve(latex: string): Solution | null;
}

const MAX_DEPTH = 5;

const isCall = (name: string) => (n: MathNode) => n.type === "FunctionNode" && fnOf(n) === name;

/** The unknown in an exponent (`2^{x}`, `e^{x + 1}`) or under a log. */
function isExpLog(variable: string) {
  return (n: MathNode) => {
    if (n.type === "FunctionNode" && ["log", "log10", "log2", "exp"].includes(fnOf(n))) return argsOf(n).some((a) => mentions(a, variable));
    return n.type === "OperatorNode" && fnOf(n) === "pow" && mentions(argsOf(n)[1], variable);
  };
}

/** A denominator with the unknown in it: `\frac{3}{x - 2}`. */
function isVariableDenominator(variable: string) {
  return (n: MathNode) => n.type === "OperatorNode" && fnOf(n) === "divide" && mentions(argsOf(n)[1], variable);
}

/**
 * A linear line, solved by `algebra.ts`: its steps, and the root when it is an equation. `0 = 2`
 * comes back with no roots; `0 = 0` (every number) as null — no caller here can use it.
 */
function linearSolution(rel: ParsedRelation, normalize: (latex: string) => string): Solution | null {
  const lin = linearSolveSteps(rel.lhs, rel.rhs, rel.op, rel.variable, rel.latex, normalize);
  if (!lin || lin.outcome === "identity") return null;
  if (lin.outcome === "contradiction") return { steps: lin.steps, final: lin.final, roots: [] };
  if (rel.op !== "==") return { steps: lin.steps, final: lin.final, roots: null };
  const root = exactly(() => {
    const l = polyOf(rel.lhs, rel.variable);
    const r = polyOf(rel.rhs, rel.variable);
    if (!l || !r) return null;
    const p = polySub(l, r);
    return deg(p) === 1 ? qDiv(qNeg(p[0]), p[1]) : null;
  });
  if (!root) return null;
  // `x = \frac{1}{2}` is already the answer: nothing to write (not `2x = 1` to clear the fraction)
  const solved = rel.lhs.type === "SymbolNode" && !mentions(rel.rhs, rel.variable);
  return { steps: solved ? [] : lin.steps, final: solved ? rel.latex : lin.final, roots: [qRoot(root)] };
}

function dispatch(rel: ParsedRelation, ctx: SolveContext): Solution | null {
  const sides = [rel.lhs, rel.rhs];
  const has = (pred: (n: MathNode) => boolean) => sides.some((s) => some(s, pred));
  if (has(isCall("abs"))) return absoluteSteps(rel, ctx);
  if (rel.op !== "==") return has(isCall("sqrt")) || has(isCall("nthRoot")) || has(isExpLog(rel.variable)) ? null : inequalitySteps(rel, ctx);
  if (has(isCall("sqrt")) || has(isCall("nthRoot"))) return radicalSteps(rel, ctx);
  if (has(isExpLog(rel.variable))) return expLogSteps(rel, ctx);
  if (has(isVariableDenominator(rel.variable))) return rationalEquationSteps(rel, ctx);
  return polynomialEquationSteps(rel.lhs, rel.rhs, rel.variable, rel.latex, ctx.normalize, ctx.solve);
}

function context(deps: AdvancedDeps, depth: number): SolveContext {
  const ctx: SolveContext = {
    normalize: deps.normalize,
    solve: (latex) => {
      if (depth >= MAX_DEPTH) return null;
      const rel = deps.relation(latex);
      if (!rel) return null;
      return linearSolution(rel, deps.normalize) ?? dispatch(rel, context(deps, depth + 1));
    },
  };
  return ctx;
}

/**
 * Teacher steps for a one-unknown line that is not linear (the caller has tried that): null when
 * no exact method here applies, and the caller keeps its CAS path.
 */
export function solveAdvanced(latex: string, deps: AdvancedDeps): Solution | null {
  const rel = deps.relation(latex);
  if (!rel) {
    const chain = deps.chain?.(latex);
    return chain ? chainSteps(chain, deps.normalize) : null;
  }
  const out = dispatch(rel, context(deps, 1));
  return out && out.steps.length > 0 ? out : null;
}
