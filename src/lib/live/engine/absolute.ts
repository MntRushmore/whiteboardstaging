/**
 * Absolute value equations and inequalities, split the way a teacher splits them:
 *
 *   |2x - 3| = 5                   |x - 1| < 3            |2x + 1| \ge 5
 *   2x - 3 = 5, \ 2x - 3 = -5      -3 < x - 1 < 3         2x + 1 \le -5, \ 2x + 1 \ge 5
 *   2x = 8, \ 2x = -2              -2 < x < 4             2x \le -6, \ 2x \ge 4
 *   x = 4, \ x = -1                                       x \le -3, \ x \ge 2
 *
 * The bars are isolated first (`2|x - 1| + 3 = 7` → `2|x - 1| = 4` → `|x - 1| = 2`). A negative
 * number on the other side is `\varnothing` (or every number, for `|x| > -1`). Against an
 * expression in the unknown (`|x - 1| = 2x + 1`) both branches are solved and a root that makes
 * that side negative is shown failing its check (`|-3| \neq -3`) before it is dropped.
 * Mathpix's `|x|`, `\left|x\right|` and `\lvert x \rvert` all arrive here as `abs(x)`.
 */
import type { MathNode } from "mathjs";
import { opLatex, q, qDiv, qLatex, qNeg, termsLatex, type Q, type RelOp, type Term } from "./algebra";
import type { ParsedRelation, SolveContext } from "./advanced";
import { argsOf, coefficientOf, fnOf, polyTermsOf, stripParens, summands } from "./nodes";
import { ONE, deg, exactly, polyEval, polyFromTerms, qEq, qIsZero, qSub, termsAsWritten, type Poly } from "./poly";
import { qRoot } from "./quadratic";
import { ALL_REALS, LIST_SEP, NO_SOLUTION, StepWriter, rootsLine, type Root, type Solution } from "./solution";

const FLIP: Record<RelOp, RelOp> = { "==": "==", "<": ">", ">": "<", "<=": ">=", ">=": "<=" };

interface Bars {
  k: Q;
  inner: Term[];
  poly: Poly;
}

interface AbsSide {
  bars: Bars | null;
  rest: Term[];
}

const negate = (ts: Term[]): Term[] => ts.map((t) => ({ c: qNeg(t.c), vars: t.vars }));

function absSide(node: MathNode, variable: string): AbsSide | null {
  let bars: Bars | null = null;
  const rest: Term[] = [];
  for (const s of summands(node)) {
    const co = coefficientOf(s.node);
    const core = co ? stripParens(co.core) : null;
    if (co && core && core.type === "FunctionNode" && fnOf(core) === "abs") {
      if (bars) return null;
      const inner = polyTermsOf(argsOf(core)[0], variable);
      const poly = inner && polyFromTerms(inner, variable);
      if (!inner || !poly || deg(poly) !== 1) return null;
      bars = { k: s.sign < 0 ? qNeg(co.k) : co.k, inner, poly };
      continue;
    }
    const t = polyTermsOf(s.node, variable);
    if (!t) return null;
    rest.push(...(s.sign < 0 ? negate(t) : t));
  }
  return { bars, rest };
}

function coefTex(k: Q): string {
  if (qEq(k, ONE)) return "";
  if (qEq(k, q(-1))) return "-";
  return qLatex(k);
}

/** `-(2x + 1)` for a sum, `-2x` / `-3` for a single term. */
function negatedLatex(terms: Term[]): string {
  return terms.length === 1 ? termsLatex(negate(terms)) : `-(${termsLatex(terms)})`;
}

/** Two branches written side by side, line by line; a branch with no solution drops out. */
function zipBranches(aLine: string, a: Solution, bLine: string, b: Solution): string[] {
  const dead = (s: Solution) => s.roots !== null && s.roots.length === 0 && s.final !== NO_SOLUTION;
  if (dead(a) && dead(b)) return [...a.steps, NO_SOLUTION];
  if (dead(a)) return b.steps.length > 0 ? b.steps : [bLine];
  if (dead(b)) return a.steps.length > 0 ? a.steps : [aLine];
  const A = a.steps.length > 0 ? a.steps : [aLine];
  const B = b.steps.length > 0 ? b.steps : [bLine];
  const out: string[] = [];
  for (let i = 0; i < Math.max(A.length, B.length); i++) out.push(`${A[Math.min(i, A.length - 1)]}${LIST_SEP}${B[Math.min(i, B.length - 1)]}`);
  return out;
}

function branches(aLine: string, bLine: string, ctx: SolveContext, w: StepWriter): Root[] | null | undefined {
  const a = ctx.solve(aLine);
  const b = ctx.solve(bLine);
  if (!a || !b) return undefined;
  w.write(`${aLine}${LIST_SEP}${bLine}`);
  w.writeAll(zipBranches(aLine, a, bLine, b));
  if (a.roots === null || b.roots === null) return null;
  return [...a.roots, ...b.roots];
}

/** `-3 < x - 1 < 3` → `-2 < x < 4`: the number moved out of the middle, then the coefficient. */
function chain(value: Q, bars: Bars, strict: boolean, variable: string, w: StepWriter): void {
  const rel = strict ? "<" : "\\le";
  const middle = termsAsWritten(bars.inner);
  let lo = qNeg(value);
  let hi = value;
  w.write(`${qLatex(lo)} ${rel} ${middle} ${rel} ${qLatex(hi)}`);
  const [beta, alpha] = [bars.poly[0], bars.poly[1]];
  if (!qIsZero(beta)) {
    lo = qSub(lo, beta);
    hi = qSub(hi, beta);
    w.write(`${qLatex(lo)} ${rel} ${termsLatex([{ c: alpha, vars: { [variable]: 1 } }])} ${rel} ${qLatex(hi)}`);
  }
  if (!qEq(alpha, ONE)) {
    [lo, hi] = alpha.n > 0 ? [qDiv(lo, alpha), qDiv(hi, alpha)] : [qDiv(hi, alpha), qDiv(lo, alpha)];
    w.write(`${qLatex(lo)} ${rel} ${variable} ${rel} ${qLatex(hi)}`);
  }
}

function finish(w: StepWriter, roots: Root[] | null): Solution {
  return { steps: w.lines(), final: w.last ?? NO_SOLUTION, roots };
}

/** `|f| op value`, the bars already alone on the left. */
function isolated(bars: Bars, op: RelOp, value: Q, variable: string, ctx: SolveContext, w: StepWriter): Solution | null {
  const inner = termsAsWritten(bars.inner);
  const rootOfInner = qDiv(qNeg(bars.poly[0]), bars.poly[1]);
  if (op === "==") {
    if (value.n < 0) {
      w.write(NO_SOLUTION);
      return finish(w, []);
    }
    if (value.n === 0) {
      const zero = `${inner} = 0`;
      w.write(zero);
      w.writeAll(ctx.solve(zero)?.steps ?? []);
      w.write(`${variable} = ${qLatex(rootOfInner)}`);
      return finish(w, [qRoot(rootOfInner)]);
    }
    if (qIsZero(bars.poly[0]) && qEq(bars.poly[1], ONE)) {
      w.write(`${variable} = \\pm ${qLatex(value)}`);
      return finish(w, [qRoot(qNeg(value)), qRoot(value)]);
    }
    const roots = branches(`${inner} = ${qLatex(value)}`, `${inner} = ${qLatex(qNeg(value))}`, ctx, w);
    if (!roots) return null;
    return finish(w, roots);
  }
  const strict = op === "<" || op === ">";
  if (op === "<" || op === "<=") {
    if (value.n < 0 || (value.n === 0 && strict)) {
      w.write(NO_SOLUTION);
      return finish(w, null);
    }
    if (value.n === 0) {
      const zero = `${inner} = 0`;
      w.write(zero);
      w.writeAll(ctx.solve(zero)?.steps ?? []);
      w.write(`${variable} = ${qLatex(rootOfInner)}`);
      return finish(w, null);
    }
    chain(value, bars, strict, variable, w);
    return finish(w, null);
  }
  if (value.n < 0 || (value.n === 0 && !strict)) {
    w.write(ALL_REALS(variable));
    return finish(w, null);
  }
  if (value.n === 0) {
    w.write(`${inner} \\neq 0`);
    w.write(`${variable} \\neq ${qLatex(rootOfInner)}`);
    return finish(w, null);
  }
  const low = `${inner} ${opLatex(strict ? "<" : "<=")} ${qLatex(qNeg(value))}`;
  const high = `${inner} ${opLatex(op)} ${qLatex(value)}`;
  const out = branches(low, high, ctx, w);
  if (out === undefined) return null;
  return finish(w, null);
}

/** `|f| = g(x)`: both branches, then the roots that make `g` negative fail their check. */
function againstExpression(bars: Bars, other: Term[], variable: string, ctx: SolveContext, w: StepWriter): Solution | null {
  const inner = termsAsWritten(bars.inner);
  const g = polyFromTerms(other, variable);
  if (!g) return null;
  const roots = branches(`${inner} = ${termsAsWritten(other)}`, `${inner} = ${negatedLatex(other)}`, ctx, w);
  if (!roots) return null;
  const kept: Root[] = [];
  for (const r of roots) {
    if (!r.exact) return null;
    const gv = polyEval(g, r.exact);
    if (gv.n >= 0) {
      kept.push(r);
      continue;
    }
    w.write(`|${qLatex(polyEval(bars.poly, r.exact))}| \\neq ${qLatex(gv)}`);
  }
  w.write(rootsLine(variable, kept));
  return finish(w, kept);
}

export function absoluteSteps(rel: ParsedRelation, ctx: SolveContext): Solution | null {
  return exactly(() => {
    const v = rel.variable;
    let L = absSide(rel.lhs, v);
    let R = absSide(rel.rhs, v);
    if (!L || !R) return null;
    let op = rel.op;
    if (!L.bars && R.bars) {
      [L, R] = [R, L];
      op = FLIP[op];
    }
    const bars = L.bars;
    if (!bars) return null;
    // `\lvert x \rvert` is the `|x|` this module writes: not a new line
    const w = new StepWriter(ctx.normalize, rel.latex.replace(/\\[lr]?vert\b\s*/g, "|"));

    if (R.bars) {
      // |f| = |g|: f = g or f = -g, nothing to check
      if (op !== "==" || L.rest.length > 0 || R.rest.length > 0 || !qEq(bars.k, ONE) || !qEq(R.bars.k, ONE)) return null;
      const roots = branches(`${termsAsWritten(bars.inner)} = ${termsAsWritten(R.bars.inner)}`, `${termsAsWritten(bars.inner)} = ${negatedLatex(R.bars.inner)}`, ctx, w);
      if (!roots) return null;
      return finish(w, roots);
    }

    const restL = polyFromTerms(L.rest, v);
    const other = polyFromTerms(R.rest, v);
    if (!restL || !other || deg(restL) >= 1) return null;
    if (deg(other) >= 1) {
      if (op !== "==" || L.rest.length > 0 || !qEq(bars.k, ONE)) return null;
      return againstExpression(bars, R.rest, v, ctx, w);
    }
    const c = restL[0] ?? q(0);
    const d = other[0] ?? q(0);
    const barsTex = `|${termsAsWritten(bars.inner)}|`;
    if (!qIsZero(c)) w.write(`${coefTex(bars.k)}${barsTex} ${opLatex(op)} ${qLatex(qSub(d, c))}`);
    const value = qDiv(qSub(d, c), bars.k);
    if (bars.k.n < 0) op = FLIP[op];
    w.write(`${barsTex} ${opLatex(op)} ${qLatex(value)}`);
    const out = isolated(bars, op, value, v, ctx, w);
    return out && out.steps.length > 0 ? out : null;
  });
}
