/**
 * Radical equations: the root alone on one side, both sides squared, the result solved, and every
 * root checked in the line before squaring — the one that fails is shown failing, in maths:
 *
 *   \sqrt{x + 3} + 3 = x        \sqrt{2x + 1} = \sqrt{x + 4}     \sqrt[3]{x + 1} = 2
 *   \sqrt{x + 3} = x - 3        2x + 1 = x + 4                  x + 1 = 2^{3}
 *   x + 3 = (x - 3)^{2}         x = 3                           x + 1 = 8
 *   x + 3 = x^{2} - 6x + 9                                      x = 7
 *   x^{2} - 7x + 6 = 0
 *   (x - 1)(x - 6) = 0
 *   x = 1, \ x = 6
 *   \sqrt{4} \neq -2
 *   x = 6
 *
 * One radical per side at most; a root alone equal to a negative number is `\varnothing` at once.
 * A cube root needs no check (cubing adds no roots). Null for anything else (two roots on one
 * side, an irrational root that fails its check).
 */
import type { MathNode } from "mathjs";
import { combineTerms, q, qLatex, qMul, qNeg, standardOrder, termsLatex, type Q, type Term } from "./algebra";
import type { ParsedRelation, SolveContext } from "./advanced";
import { argsOf, coefficientOf, constantValue, fnOf, polyTermsOf, stripParens, summands } from "./nodes";
import { ONE, deg, exactly, polyEval, polyEvalNum, polyFromTerms, qEq, qNum, qPow, termsAsWritten, type Poly } from "./poly";
import { NO_SOLUTION, StepWriter, rootsLine, type Root, type Solution } from "./solution";

interface Radical {
  k: Q;
  index: 2 | 3;
  f: Term[];
  poly: Poly;
}

interface RadSide {
  rad: Radical | null;
  rest: Term[];
}

const negate = (ts: Term[]): Term[] => ts.map((t) => ({ c: qNeg(t.c), vars: t.vars }));

function radicalOf(core: MathNode, variable: string): { index: 2 | 3; f: Term[]; poly: Poly } | null {
  const n = stripParens(core);
  if (n.type !== "FunctionNode") return null;
  const name = fnOf(n);
  const args = argsOf(n);
  let index: 2 | 3;
  if (name === "sqrt" && args.length === 1) index = 2;
  else if (name === "nthRoot" && args.length === 2) {
    const i = constantValue(args[1]);
    if (!i || !qEq(i, q(3))) return null;
    index = 3;
  } else return null;
  const f = polyTermsOf(args[0], variable);
  const poly = f && polyFromTerms(f, variable);
  if (!f || !poly || deg(poly) < 1) return null;
  return { index, f, poly };
}

function radSide(node: MathNode, variable: string): RadSide | null {
  let rad: Radical | null = null;
  const rest: Term[] = [];
  for (const s of summands(node)) {
    const co = coefficientOf(s.node);
    const r = co ? radicalOf(co.core, variable) : null;
    if (co && r) {
      if (rad) return null;
      rad = { ...r, k: s.sign < 0 ? qNeg(co.k) : co.k };
      continue;
    }
    const t = polyTermsOf(s.node, variable);
    if (!t) return null;
    rest.push(...(s.sign < 0 ? negate(t) : t));
  }
  return { rad, rest };
}

const rootTex = (r: Radical, inside: string): string => (r.index === 3 ? `\\sqrt[3]{${inside}}` : `\\sqrt{${inside}}`);

function coefTex(k: Q): string {
  if (qEq(k, ONE)) return "";
  if (qEq(k, q(-1))) return "-";
  return qLatex(k);
}

/** `(x - 3)^{2}`, `x^{2}`, `9`: the square of the other side as a student writes it before expanding. */
function squaredTex(g: Term[], gPoly: Poly, power: 2 | 3): string {
  if (deg(gPoly) <= 0) return qLatex(qPow(gPoly[0] ?? q(0), power)); // a number: squared at once, `4` → `16`
  if (g.length === 1 && qEq(g[0].c, ONE)) {
    const [v] = Object.keys(g[0].vars);
    const p = g[0].vars[v];
    return p === 1 ? `${v}^{${power}}` : `(${termsLatex(g)})^{${power}}`;
  }
  return `(${termsLatex(g)})^{${power}}`;
}

export function radicalSteps(rel: ParsedRelation, ctx: SolveContext): Solution | null {
  return exactly(() => {
    const v = rel.variable;
    let L = radSide(rel.lhs, v);
    let R = radSide(rel.rhs, v);
    if (!L || !R) return null;
    if (!L.rad && R.rad) [L, R] = [R, L];
    const rad = L.rad;
    if (!rad) return null;
    const w = new StepWriter(ctx.normalize, rel.latex);

    if (R.rad) {
      // \sqrt{f} = \sqrt{g}: square both, and the root must keep both radicands non-negative
      const other = R.rad;
      if (L.rest.length > 0 || R.rest.length > 0 || !qEq(rad.k, ONE) || !qEq(other.k, ONE) || rad.index !== other.index) return null;
      const line = `${termsAsWritten(rad.f)} = ${termsAsWritten(other.f)}`;
      w.write(line);
      const sol = ctx.solve(line);
      if (!sol || !sol.roots) return null;
      w.writeAll(sol.steps);
      if (sol.roots.length === 0) {
        w.write(NO_SOLUTION);
        return { steps: w.lines(), final: NO_SOLUTION, roots: [] };
      }
      if (rad.index === 2 && sol.roots.some((r) => polyEvalNum(rad.poly, r.value) < -1e-12)) return null;
      w.write(rootsLine(v, sol.roots));
      return { steps: w.lines(), final: w.last!, roots: sol.roots };
    }

    // the root alone: `k\sqrt{f} = g`
    const gTerms = standardOrder(combineTerms([...R.rest, ...negate(L.rest)]));
    const g = polyFromTerms(gTerms, v);
    if (!g) return null;
    const gTex = termsLatex(gTerms);
    const radTex = `${coefTex(rad.k)}${rootTex(rad, termsAsWritten(rad.f))}`;
    w.write(`${radTex} = ${gTex}`);

    if (rad.index === 3) {
      if (deg(g) > 0 || !qEq(rad.k, ONE)) return null;
      const cubed = `${termsAsWritten(rad.f)} = ${squaredTex(gTerms, g, 3)}`;
      w.write(cubed);
      const sol = ctx.solve(cubed);
      if (!sol || !sol.roots) return null;
      w.writeAll(sol.steps);
      w.write(rootsLine(v, sol.roots));
      return { steps: w.lines(), final: w.last!, roots: sol.roots };
    }

    // a root is never negative: `\sqrt{x} = -2` has no solution
    if (deg(g) <= 0 && Math.sign(qNum(g[0] ?? q(0))) * Math.sign(qNum(rad.k)) < 0) {
      w.write(NO_SOLUTION);
      return { steps: w.lines(), final: NO_SOLUTION, roots: [] };
    }
    const k2 = qMul(rad.k, rad.k);
    const fTex = termsAsWritten(rad.f);
    const left = qEq(k2, ONE) ? fTex : rad.f.length === 1 ? termsLatex(rad.f.map((t) => ({ c: qMul(t.c, k2), vars: t.vars }))) : `${qLatex(k2)}(${fTex})`;
    const squared = `${left} = ${squaredTex(gTerms, g, 2)}`;
    w.write(squared);
    const sol = ctx.solve(squared);
    if (!sol || !sol.roots) return null;
    w.writeAll(sol.steps);
    if (sol.roots.length === 0) {
      if (w.last !== NO_SOLUTION) w.write(NO_SOLUTION);
      return { steps: w.lines(), final: NO_SOLUTION, roots: [] };
    }
    const kept: Root[] = [];
    for (const r of sol.roots) {
      const fv = polyEvalNum(rad.poly, r.value);
      const lhs = qNum(rad.k) * Math.sqrt(Math.max(0, fv));
      const rhs = polyEvalNum(g, r.value);
      if (fv >= -1e-12 && Math.abs(lhs - rhs) <= 1e-9 * Math.max(1, Math.abs(rhs))) {
        kept.push(r);
        continue;
      }
      if (!r.exact) return null;
      w.write(`${coefTex(rad.k)}\\sqrt{${qLatex(polyEval(rad.poly, r.exact))}} \\neq ${qLatex(polyEval(g, r.exact))}`);
    }
    w.write(rootsLine(v, kept));
    return { steps: w.lines(), final: w.last!, roots: kept };
  });
}
