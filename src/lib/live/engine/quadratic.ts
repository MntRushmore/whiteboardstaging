/**
 * Polynomial equations in one unknown (degree 2 to 4), solved the way a teacher writes them:
 *
 *   x^2 - 5x + 6 = 0        x(x + 1) = 12             x^2 - 2x - 1 = 0
 *   (x - 2)(x - 3) = 0      x^{2} + x = 12            x = \frac{2 \pm \sqrt{(-2)^{2} - 4 \cdot 1 \cdot (-1)}}{2 \cdot 1}
 *   x = 2, \ x = 3          x^{2} + x - 12 = 0        x = \frac{2 \pm \sqrt{8}}{2}
 *                           (x + 4)(x - 3) = 0        x = \frac{2 \pm 2\sqrt{2}}{2}
 *                           x = -4, \ x = 3           x = 1 \pm \sqrt{2}
 *
 *   (x + 3)^2 = 16          2x^2 - 18 = 0             x^2 + x + 1 = 0
 *   x + 3 = \pm 4           2x^{2} = 18               x = \frac{-1 \pm \sqrt{1^{2} - 4 \cdot 1 \cdot 1}}{2 \cdot 1}
 *   x = -3 \pm 4            x^{2} = 9                 x = \frac{-1 \pm \sqrt{-3}}{2}
 *   x = -7, \ x = 1         x = \pm 3                 \varnothing
 *
 * Order of methods: a line already in `a(px + q)^2 + c = d` form is finished by square roots
 * (completing the square's last step); `ax^n + c = 0` by roots too; rational roots by factoring
 * (a common factor first, then the whole product); otherwise the quadratic formula with the
 * values substituted, the surd simplified and the fraction reduced. No real roots ends at the
 * negative number under the root and `\varnothing`. Exact throughout: `null` for anything else.
 */
import type { MathNode } from "mathjs";
import { combineTerms, gcdInt, hasBracket, q, qAdd, qDiv, qLatex, qMul, qNeg, standardOrder, termsLatex, type Q, type Term } from "./algebra";
import { argsOf, coefficientOf, constantValue, fnOf, polyTermsOf, stripParens, summands } from "./nodes";
import {
  ONE,
  deg,
  exactly,
  factorLinear,
  lead,
  polyDiv,
  polyFromTerms,
  polyLatex,
  polyNeg,
  polySub,
  primitive,
  productLatex,
  qAbs,
  qEq,
  qIsZero,
  qNum,
  qParen,
  qSub,
  rootFactor,
  termsAsWritten,
  trim,
  type Poly,
} from "./poly";
import { StepWriter, NO_SOLUTION, rootsLine, type Root, type Solution } from "./solution";
import { simplifySqrt, sqrtQ, sqrtQLatex, surdPair, surdPairLatex, surdTerm, surdValue, type SurdPair } from "./surd";

type Normalize = (latex: string) => string;

export const qRoot = (r: Q): Root => ({ latex: qLatex(r), value: qNum(r), exact: r });

function lcdOf(terms: readonly Term[]): number {
  let lcd = 1;
  for (const t of terms) lcd = (lcd * t.c.d) / gcdInt(lcd, t.c.d);
  return lcd;
}

const scaleTerms = (terms: readonly Term[], k: Q): Term[] => terms.map((t) => ({ c: qMul(t.c, k), vars: t.vars }));

/** The answer line for a `± surd` pair and some rational roots, ascending by value. */
function answerLine(variable: string, rational: readonly Q[], pairs: readonly SurdPair[]): { line: string; roots: Root[] } {
  const roots: Root[] = rational.map(qRoot);
  const entries: Array<{ latex: string; value: number }> = rational.map((r) => ({ latex: qLatex(r), value: qNum(r) }));
  for (const s of pairs) {
    roots.push({ latex: surdPairLatex(s, "-"), value: surdValue(s, -1) }, { latex: surdPairLatex(s, "+"), value: surdValue(s, 1) });
    entries.push({ latex: surdPairLatex(s), value: surdValue(s, -1) });
  }
  if (entries.length === 0) return { line: NO_SOLUTION, roots: [] };
  if (pairs.length === 0) return { line: rootsLine(variable, roots), roots };
  entries.sort((a, b) => a.value - b.value);
  return { line: entries.map((e) => `${variable} = ${e.latex}`).join(", \\ "), roots };
}

// --- a(px + q)^2 + c = d ------------------------------------------------------

interface SquareForm {
  /** coefficient of the square */
  k: Q;
  /** the bracket, as terms in the order written */
  inner: Term[];
  /** constant beside the square */
  c: Q;
  /** the other side */
  other: Q;
}

function squareSide(node: MathNode, variable: string): { k: Q; inner: Term[]; c: Q } | null {
  let square: { k: Q; inner: Term[] } | null = null;
  let c = q(0);
  for (const s of summands(node)) {
    const value = constantValue(s.node);
    if (value) {
      c = qAdd(c, s.sign < 0 ? qNeg(value) : value);
      continue;
    }
    if (square) return null;
    const co = coefficientOf(s.node);
    if (!co) return null;
    const core = stripParens(co.core);
    if (fnOf(core) !== "pow") return null;
    const [base, exp] = argsOf(core);
    const e = constantValue(exp);
    if (!e || !qEq(e, q(2))) return null;
    if (asParen(base) === null) return null;
    const inner = polyTermsOf(base, variable);
    if (!inner) return null;
    const p = polyFromTerms(inner, variable);
    // a bracket with a number in it: `(x + 3)^2`, `(2x - 1)^2` — `x^2` alone is a pure square
    if (!p || deg(p) !== 1 || qIsZero(p[0])) return null;
    square = { k: s.sign < 0 ? qNeg(co.k) : co.k, inner };
  }
  return square ? { ...square, c } : null;
}

function asParen(node: MathNode): MathNode | null {
  return (node as MathNode & { type: string }).type === "ParenthesisNode" ? node : null;
}

function squareForm(lhs: MathNode, rhs: MathNode, variable: string): SquareForm | null {
  return exactly(() => {
    const l = squareSide(lhs, variable);
    const rv = constantValue(rhs);
    if (l && rv) return { ...l, other: rv };
    const r = squareSide(rhs, variable);
    const lv = constantValue(lhs);
    if (r && lv) return { ...r, other: lv };
    return null;
  });
}

/** `(x + 3)^2 = 16` → `x + 3 = \pm 4` → `x = -3 \pm 4` → `x = -7, \ x = 1`. */
function solveSquareForm(sf: SquareForm, variable: string, w: StepWriter, rawSolve: (latex: string) => Solution | null): Solution | null {
  const innerTex = `(${termsAsWritten(sf.inner)})^{2}`;
  const rhs = qSub(sf.other, sf.c);
  if (!qIsZero(sf.c)) w.write(`${coefTex(sf.k)}${innerTex} = ${qLatex(rhs)}`);
  const v = qDiv(rhs, sf.k);
  w.write(`${innerTex} = ${qLatex(v)}`);
  const innerLatex = termsAsWritten(sf.inner);
  const p = polyFromTerms(sf.inner, variable)!;
  const [beta, alpha] = [p[0], p[1]];
  if (v.n < 0) {
    w.write(NO_SOLUTION);
    return { steps: w.lines(), final: NO_SOLUTION, roots: [] };
  }
  if (v.n === 0) {
    const zero = `${innerLatex} = 0`;
    w.write(zero);
    const lin = rawSolve(zero);
    if (lin) w.writeAll(lin.steps);
    const root = qDiv(qNeg(beta), alpha);
    const final = `${variable} = ${qLatex(root)}`;
    w.write(final);
    return { steps: w.lines(), final, roots: [qRoot(root)] };
  }
  const s = sqrtQ(v);
  if (!s) return null;
  const sTex = sqrtQLatex(s);
  w.write(`${innerLatex} = \\pm ${sTex}`);
  const minusBeta = qLatex(qNeg(beta));
  const shifted = qIsZero(beta) ? `\\pm ${sTex}` : `${minusBeta} \\pm ${sTex}`;
  const alphaOne = qEq(alpha, ONE);
  if (!qIsZero(beta)) w.write(`${alphaOne ? variable : `${coefTex(alpha)}${variable}`} = ${shifted}`);
  if (!alphaOne) w.write(`${variable} = \\frac{${shifted}}{${qLatex(alpha)}}`, true);
  if ("rational" in s) {
    const r1 = qDiv(qSub(qNeg(beta), s.rational), alpha);
    const r2 = qDiv(qAdd(qNeg(beta), s.rational), alpha);
    const { line, roots } = answerLine(variable, [r1, r2], []);
    w.write(line);
    return { steps: w.lines(), final: line, roots };
  }
  // x = (-β ± K√M/d) / α, over one denominator
  const pair = exactly(() => {
    const K = s.surd.k;
    const d = s.surd.d;
    const bn = -beta.n;
    const bd = beta.d;
    return surdPair(bn * d * alpha.d, K * bd * alpha.d, s.surd.m, bd * d * alpha.n);
  });
  if (!pair) return null;
  const { line, roots } = answerLine(variable, [], [pair]);
  w.write(line);
  return { steps: w.lines(), final: line, roots };
}

/** `2`, `-`, `` (for 1), `\frac{1}{2}` in front of a bracket or an unknown. */
function coefTex(k: Q): string {
  if (qEq(k, ONE)) return "";
  if (qEq(k, q(-1))) return "-";
  return qLatex(k);
}

// --- a x^n + c = 0 ----------------------------------------------------------------

/** `x^{2} = 9` → `x = \\pm 3`; `x^{3} = 8` → `x = \\sqrt[3]{8}` → `x = 2`. */
function solvePurePower(P: Poly, variable: string, w: StepWriter): Solution | null {
  const n = deg(P);
  const a = lead(P);
  const power = `${variable}^{${n}}`;
  // `2x^{2} = 18`, then `x^{2} = 9`: the number moved across, then divided out
  w.write(`${coefTex(a)}${power} = ${qLatex(qNeg(P[0]))}`);
  const value = qDiv(qNeg(P[0]), a);
  w.write(`${power} = ${qLatex(value)}`);
  const even = n % 2 === 0;
  if (even && value.n < 0) {
    w.write(NO_SOLUTION);
    return { steps: w.lines(), final: NO_SOLUTION, roots: [] };
  }
  if (value.n === 0) {
    const final = `${variable} = 0`;
    w.write(final);
    return { steps: w.lines(), final, roots: [{ latex: "0", value: 0 }] };
  }
  const pm = even ? "\\pm " : "";
  if (n === 2) {
    const s = sqrtQ(value);
    if (!s) return null;
    if ("surd" in s) w.write(`${variable} = \\pm \\sqrt{${qLatex(value)}}`);
    const final = `${variable} = \\pm ${sqrtQLatex(s)}`;
    w.write(final);
    const roots: Root[] =
      "rational" in s
        ? [qRoot(qNeg(s.rational)), qRoot(s.rational)]
        : [
            { latex: surdPairLatex(s.surd, "-"), value: surdValue(s.surd, -1) },
            { latex: surdPairLatex(s.surd, "+"), value: surdValue(s.surd, 1) },
          ];
    return { steps: w.lines(), final, roots };
  }
  if (n !== 3 && n !== 4) return null;
  const radical = `\\sqrt[${n}]{${qLatex(value)}}`;
  w.write(`${variable} = ${pm}${radical}`);
  const root = exactRoot(value, n);
  const r: Root = root ? qRoot(root) : { latex: radical, value: Math.sign(qNum(value)) * Math.pow(Math.abs(qNum(value)), 1 / n) };
  if (root) w.write(`${variable} = ${pm}${qLatex(root)}`);
  const roots = even ? [root ? qRoot(qNeg(root)) : { latex: `-${radical}`, value: -r.value }, r] : [r];
  return { steps: w.lines(), final: w.last!, roots };
}

/** The exact n-th root of a rational (`\sqrt[3]{-\frac{8}{27}}` = `-\frac{2}{3}`), or null. */
function exactRoot(v: Q, n: number): Q | null {
  const neg = v.n < 0;
  if (neg && n % 2 === 0) return null;
  const rn = Math.round(Math.pow(Math.abs(v.n), 1 / n));
  const rd = Math.round(Math.pow(v.d, 1 / n));
  if (Math.pow(rn, n) !== Math.abs(v.n) || Math.pow(rd, n) !== v.d) return null;
  return q(neg ? -rn : rn, rd);
}

// --- factoring -----------------------------------------------------------------------

interface Factored {
  content: Q;
  factors: Array<{ f: Poly; mult: number }>;
  roots: Q[];
}

/** Every factor linear over the rationals (or an irreducible quadratic left over), or null. */
function fullFactor(P: Poly): Factored | null {
  const lf = factorLinear(P);
  const factors = lf.roots.map((r) => ({ f: rootFactor(r.root), mult: r.mult }));
  if (deg(lf.rest) > 2) return null;
  if (deg(lf.rest) >= 1) factors.push({ f: lf.rest, mult: 1 });
  return { content: lf.content, factors, roots: lf.roots.map((r) => r.root) };
}

/** The primitive polynomial as its product (its constant has already been divided out). */
function factoredLine(f: Factored, variable: string): string {
  return `${productLatex(ONE, f.factors, variable)} = 0`;
}

// --- the quadratic formula -------------------------------------------------------------

function solveByFormula(prim: Poly, variable: string, w: StepWriter): Solution | null {
  const [c, b, a] = [prim[0], prim[1], prim[2]];
  if (!a || !b || a.d !== 1 || b.d !== 1 || c.d !== 1) return null;
  const minusB = qLatex(qNeg(b));
  const disc = qSub(qMul(b, b), qMul(q(4), qMul(a, c)));
  w.write(`${variable} = \\frac{${minusB} \\pm \\sqrt{${qParen(b)}^{2} - 4 \\cdot ${qParen(a)} \\cdot ${qParen(c)}}}{2 \\cdot ${qParen(a)}}`);
  const twoA = qMul(q(2), a);
  w.write(`${variable} = \\frac{${minusB} \\pm \\sqrt{${qLatex(disc)}}}{${qLatex(twoA)}}`);
  if (disc.n < 0) {
    w.write(NO_SOLUTION);
    return { steps: w.lines(), final: NO_SOLUTION, roots: [] };
  }
  const root = simplifySqrt(disc.n);
  if (!root || root.m === 1) return null; // a square discriminant has rational roots: factoring's job
  if (root.k > 1) w.write(`${variable} = \\frac{${minusB} \\pm ${surdTerm(root.k, root.m)}}{${qLatex(twoA)}}`);
  const pair = surdPair(-b.n, root.k, root.m, twoA.n);
  const { line, roots } = answerLine(variable, [], [pair]);
  w.write(line);
  return { steps: w.lines(), final: line, roots };
}

// --- a product equal to zero -----------------------------------------------------------------

/**
 * `(x - 2)(x + 3) = 0`, `2x(x - 5) = 0`, `(x - 1)^2(x + 2) = 0`: the factors (a number in front
 * dropped, a power by its base) when one side is a product of two or more and the other is 0.
 */
function zeroProductFactors(lhs: MathNode, rhs: MathNode, variable: string): Term[][] | null {
  const isZero = (n: MathNode) => {
    const v = constantValue(n);
    return v !== null && qIsZero(v);
  };
  const side = isZero(rhs) ? lhs : isZero(lhs) ? rhs : null;
  if (!side) return null;
  const nodes: MathNode[] = [];
  const collect = (node: MathNode) => {
    const m = stripParens(node);
    if (m.type === "OperatorNode" && fnOf(m) === "multiply") argsOf(m).forEach(collect);
    else nodes.push(m);
  };
  collect(side);
  const out: Term[][] = [];
  for (const node of nodes) {
    if (constantValue(node)) continue;
    let base = node;
    if (node.type === "OperatorNode" && fnOf(node) === "pow") {
      const e = constantValue(argsOf(node)[1]);
      if (!e || e.d !== 1 || e.n < 1) return null;
      base = argsOf(node)[0];
    }
    const t = polyTermsOf(base, variable);
    const p = t && polyFromTerms(t, variable);
    if (!t || !p || deg(p) < 1) return null;
    out.push(combineTerms(t));
  }
  return out.length >= 2 ? out : null;
}

/** Each factor equal to zero, side by side, then each solved: `x - 2 = 0, \ x + 3 = 0` → `x = 2, \ x = -3`. */
function solveZeroProduct(factors: Term[][], w: StepWriter, rawSolve: (latex: string) => Solution | null): Solution | null {
  const lines = factors.map((f) => `${termsLatex(f)} = 0`);
  const sols = lines.map((l) => rawSolve(l));
  if (sols.some((s) => !s || !s.roots)) return null;
  w.write(lines.join(", \\ "));
  const live = sols.map((s, i) => ({ s: s!, line: lines[i] })).filter((b) => b.s.roots!.length > 0);
  const columns = live.map((b) => (b.s.steps.length > 0 ? b.s.steps : [b.line]));
  const height = Math.max(0, ...columns.map((c) => c.length));
  for (let i = 0; i < height; i++) w.write(columns.map((c) => c[Math.min(i, c.length - 1)]).join(", \\ "));
  const roots = live.flatMap((b) => b.s.roots!);
  if (roots.length === 0) w.write(NO_SOLUTION);
  return { steps: w.lines(), final: w.last ?? NO_SOLUTION, roots };
}

// --- the solver ---------------------------------------------------------------------------

/**
 * Teacher steps for a polynomial equation of degree 2–4 in `variable`; null when a side is not a
 * polynomial with exact coefficients, the degree is out of range, or no exact method applies.
 * `rawSolve` solves a follow-on linear line (`x + 3 = 0`) with the engine's own steps.
 */
export function polynomialEquationSteps(
  lhs: MathNode,
  rhs: MathNode,
  variable: string,
  inputLatex: string,
  normalize: Normalize,
  rawSolve: (latex: string) => Solution | null,
): Solution | null {
  return exactly(() => {
    let L = polyTermsOf(lhs, variable);
    let R = polyTermsOf(rhs, variable);
    if (!L || !R) return null;
    const pl = polyFromTerms(L, variable);
    const pr = polyFromTerms(R, variable);
    if (!pl || !pr) return null;
    let P = polySub(pl, pr);
    const n = deg(P);
    const w = new StepWriter(normalize, inputLatex);
    if (n === 1 && Math.max(deg(pl), deg(pr)) >= 2) return cancelledSquares(L, R, P, variable, inputLatex, w, rawSolve);
    if (n < 2 || n > 4) return null;

    const zp = zeroProductFactors(lhs, rhs, variable);
    if (zp) return solveZeroProduct(zp, w, rawSolve);

    const sf = squareForm(lhs, rhs, variable);
    if (sf && !qIsZero(sf.k)) return solveSquareForm(sf, variable, w, rawSolve);

    const lcd = lcdOf([...L, ...R]);
    if (lcd > 1) {
      L = scaleTerms(L, q(lcd));
      R = scaleTerms(R, q(lcd));
      P = polySub(polyFromTerms(L, variable)!, polyFromTerms(R, variable)!);
    }
    if (hasBracket(inputLatex) || lcd > 1) w.write(`${termsLatex(L)} = ${termsLatex(R)}`);
    if (lead(P).n < 0) P = polyNeg(P);

    // a x^n + c = 0: square (or cube) roots
    if (P.slice(1, n).every(qIsZero)) return solvePurePower(P, variable, w);

    w.write(`${polyLatex(P, variable)} = 0`);
    const { content, prim } = primitive(P);
    if (!qEq(qAbs(content), ONE)) w.write(`${polyLatex(prim, variable)} = 0`);

    const fac = fullFactor(prim);
    if (fac && fac.roots.length > 0) {
      const biquadratic = n === 4 && !qIsZero(prim[0]) && writeBiquadratic(prim, variable, w);
      if (n >= 3 && !biquadratic) writeFirstFactor(prim, fac, variable, w);
      w.write(factoredLine(fac, variable));
      const rest = fac.factors.find((f) => deg(f.f) === 2);
      const pairs: SurdPair[] = [];
      if (rest) {
        const [c0, b0, a0] = rest.f;
        const disc = qSub(qMul(b0, b0), qMul(q(4), qMul(a0, c0)));
        if (disc.n > 0) {
          const root = simplifySqrt(disc.n * disc.d);
          if (!root || root.m === 1 || disc.d !== 1 || b0.d !== 1 || a0.d !== 1) return null;
          pairs.push(surdPair(-b0.n, root.k, root.m, 2 * a0.n));
        }
      }
      const { line, roots } = answerLine(variable, fac.roots, pairs);
      w.write(line);
      return { steps: w.lines(), final: line, roots };
    }
    if (n === 2) return solveByFormula(prim, variable, w);
    return null;
  });
}

/** `(x - 1)(x^{2} - 5x + 6) = 0` / `x(x^{2} - 4) = 0`: the first factor out, as a teacher does for a cubic. */
function writeFirstFactor(prim: Poly, fac: Factored, variable: string, w: StepWriter): void {
  const zero = fac.roots.find((r) => r.n === 0);
  let first: Q | undefined = zero;
  if (!first) first = [...fac.roots].sort((a, b) => Math.abs(qNum(a)) - Math.abs(qNum(b)) || qNum(b) - qNum(a))[0];
  if (!first) return;
  let f = rootFactor(first);
  let mult = 1;
  if (first.n === 0) {
    // every power of x at once: x^{2}(x - 1)
    let rest = prim;
    mult = 0;
    while (rest.length > 0 && qIsZero(rest[0])) {
      rest = rest.slice(1);
      mult++;
    }
    const cofactor = trim(rest);
    if (deg(cofactor) < 2) return;
    w.write(`${productLatex(ONE, [{ f, mult }, { f: cofactor, mult: 1 }], variable)} = 0`, true);
    return;
  }
  const { quotient } = polyDiv(prim, f);
  if (deg(quotient) < 2) return;
  if (lead(f).n < 0) f = polyNeg(f);
  w.write(`${productLatex(ONE, [{ f, mult }, { f: quotient, mult: 1 }], variable)} = 0`, true);
}

/** `x^4 - 5x^2 + 4 = 0` → `(x^{2} - 1)(x^{2} - 4) = 0` before the full factorisation. */
function writeBiquadratic(prim: Poly, variable: string, w: StepWriter): boolean {
  if (!qIsZero(prim[1]) || !qIsZero(prim[3])) return false;
  const u: Poly = trim([prim[0], prim[2], prim[4]]);
  const lf = factorLinear(u);
  if (lf.roots.length === 0 || deg(lf.rest) > 0) return false;
  const factors: Array<{ f: Poly; mult: number }> = [];
  for (const r of lf.roots) {
    const lin = rootFactor(r.root); // d u - n  →  d x^2 - n
    factors.push({ f: trim([lin[0], q(0), lin[1]]), mult: r.mult });
  }
  w.write(`${productLatex(ONE, factors, variable)} = 0`, true);
  return true;
}

/**
 * `(x - 1)^2 = (x + 1)^2`: the squares cancel. Expanded, then the linear equation that is left
 * (`-2x + 1 = 2x + 1`), solved with the linear steps.
 */
function cancelledSquares(L: Term[], R: Term[], P: Poly, variable: string, inputLatex: string, w: StepWriter, rawSolve: (latex: string) => Solution | null): Solution | null {
  if (hasBracket(inputLatex)) w.write(`${termsLatex(L)} = ${termsLatex(R)}`);
  const low = (ts: Term[]) => combineTerms(ts).filter((t) => (t.vars[variable] ?? 0) <= 1);
  const line = `${termsLatex(standardOrder(low(L)))} = ${termsLatex(standardOrder(low(R)))}`;
  w.write(line);
  const lin = rawSolve(line);
  if (!lin) return null;
  w.writeAll(lin.steps);
  const root = qDiv(qNeg(P[0]), P[1]);
  const final = `${variable} = ${qLatex(root)}`;
  w.write(final);
  return { steps: w.lines(), final, roots: [qRoot(root)] };
}
