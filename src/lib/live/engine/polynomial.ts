/**
 * Factoring an expression, the way a teacher writes it under the line (Solve writes each as
 * `= …`). The rule that decides when: an expression that still has brackets to expand or like
 * terms to collect is SIMPLIFIED (`algebra.ts`); one that is already expanded and collected is
 * FACTORED when it factors over the integers — otherwise nothing is written.
 *
 *   6x^2 + 9x          2x^2 + 7x + 3               x^3 + 2x^2 + 3x + 6        x^3 - 8
 *   3x(2x + 3)         2x^{2} + 6x + x + 3         x^{2}(x + 2) + 3(x + 2)    (x - 2)(x^{2} + 2x + 4)
 *                      2x(x + 3) + (x + 3)         (x + 2)(x^{2} + 3)
 *                      (x + 3)(2x + 1)
 *
 * Common factor first (the number and the lowest power of each unknown), then: difference of
 * squares, trinomials (split the middle term and group when the leading coefficient is not 1),
 * grouping, sum and difference of cubes, and any remaining rational root by the factor theorem.
 * In two or more unknowns: the common factor and a difference of two squares.
 */
import type { MathNode } from "mathjs";
import { combineTerms, gcdInt, q, qDiv, qMul, standardOrder, termsLatex, termsOf, type Q, type Term } from "./algebra";
import { X, deg, exactly, factorLinear, lead, polyDiv, polyFromTerms, polyLatex, primitive, productLatex, qEq, qIsZero, rootFactor, trim, type Poly } from "./poly";
import { StepWriter } from "./solution";

type Normalize = (latex: string) => string;

interface Factor {
  f: Poly;
  mult: number;
}

/** `(x + 3)` for a factor inside a line. */
const bracket = (f: Poly, v: string): string => `(${polyLatex(f, v)})`;

function xTerm(c: Q, power: number, v: string): string {
  return termsLatex([{ c, vars: power === 0 ? {} : { [v]: power } }]);
}

/** `2x^{2} + 7x + 3` with rational roots n1/d1 < n2/d2: split the middle term and group. */
function writeSplitAndGroup(R: Poly, v: string, w: StepWriter): void {
  const lf = factorLinear(R);
  if (lf.roots.length !== 2 || deg(lf.rest) > 0) return;
  const [r1, r2] = lf.roots.map((r) => r.root);
  const [n1, d1, n2, d2] = [r1.n, r1.d, r2.n, r2.d];
  // a x^2 + p x + q x + c with a x^2 + p x = d2 x (d1 x - n1) and q x + c = -n2 (d1 x - n1)
  const a = R[2];
  const p = q(-d2 * n1);
  const qq = q(-n2 * d1);
  const c = R[0];
  w.write(termsLatex([
    { c: a, vars: { [v]: 2 } },
    { c: p, vars: { [v]: 1 } },
    { c: qq, vars: { [v]: 1 } },
    { c, vars: {} },
  ]));
  const F1 = bracket(rootFactor(r1), v);
  const second = -n2;
  const secondTex = Math.abs(second) === 1 ? F1 : `${Math.abs(second)}${F1}`;
  w.write(`${xTerm(q(d2), 1, v)}${F1} ${second < 0 ? "-" : "+"} ${secondTex}`);
}

/** `x^3 + 2x^2 + 3x + 6` → `x^{2}(x + 2) + 3(x + 2)` → `(x + 2)(x^{2} + 3)`; false when grouping does not work. */
function writeGrouping(R: Poly, v: string, w: StepWriter): boolean {
  if (deg(R) !== 3 || R.some(qIsZero)) return false;
  const [d, c, b, a] = R;
  if (!R.every((x) => x.d === 1)) return false;
  const g1 = gcdInt(a.n, b.n) * Math.sign(a.n);
  const B: Poly = [q(b.n / g1), q(a.n / g1)];
  // c x + d = k (a/g1 x + b/g1)
  const k = qDiv(c, B[1]);
  if (!qEq(qMul(k, B[0]), d) || k.d !== 1) return false;
  const Btex = bracket(B, v);
  const kTex = Math.abs(k.n) === 1 ? Btex : `${Math.abs(k.n)}${Btex}`;
  w.write(`${xTerm(q(g1), 2, v)}${Btex} ${k.n < 0 ? "-" : "+"} ${kTex}`);
  w.write(`${Btex}(${polyLatex(trim([k, q(0), q(g1)]), v)})`);
  return true;
}

/** Everything linear over the rationals pulled out (the factor theorem), what is left kept whole. */
function fullFactors(R: Poly): Factor[] {
  const lf = factorLinear(R);
  const out: Factor[] = lf.roots.map((r) => ({ f: rootFactor(r.root), mult: r.mult }));
  if (deg(lf.rest) >= 1) out.push({ f: lf.rest, mult: 1 });
  return out;
}

function univariate(P: Poly, v: string, w: StepWriter): boolean {
  const terms = P.filter((c) => !qIsZero(c)).length;
  if (terms < 2 || deg(P) < 1) return false;
  const { content, prim } = primitive(P);
  if (content.d !== 1) return false; // `\frac{1}{2}x + 1`: no integer factor to take out
  let low = 0;
  while (qIsZero(prim[low])) low++;
  const R = trim(prim.slice(low));
  const lead0: Factor[] = low > 0 ? [{ f: X, mult: low }] : [];
  const common = Math.abs(content.n) !== 1 || low > 0 || content.n < 0;
  if (common) w.write(productLatex(content, [...lead0, { f: R, mult: 1 }], v));
  const full = fullFactors(R);
  const irreducible = full.length === 1 && full[0].mult === 1;
  if (irreducible) return common;
  const n = deg(R);
  const prefix = (s: string) => `${productLatex(content, lead0, v).replace(/^1$/, "").replace(/^-1$/, "-")}${s}`;
  if (n === 2 && !qEq(lead(R), q(1)) && !qIsZero(R[1]) && full.length === 2) {
    if (!common) writeSplitAndGroup(R, v, w);
  } else if (n === 3 && !common) {
    if (!writeGrouping(R, v, w)) {
      const lf = factorLinear(R);
      const first = lf.roots.find((r) => r.root.d === 1) ?? lf.roots[0];
      if (first) {
        const f = rootFactor(first.root);
        const quotient = polyDiv(R, f).quotient;
        if (deg(quotient) === 2 && fullFactors(quotient).length > 1) w.write(`${bracket(f, v)}${bracket(quotient, v)}`, true);
      }
    }
  } else if (n === 4 && qIsZero(R[1]) && qIsZero(R[3])) {
    const u = trim([R[0], R[2], R[4]]);
    const lu = factorLinear(u);
    if (lu.roots.length > 0 && deg(lu.rest) === 0) {
      const factors = lu.roots.map((r) => {
        const lin = rootFactor(r.root);
        return { f: trim([lin[0], q(0), lin[1]]), mult: r.mult };
      });
      w.write(prefix(productLatex(q(1), factors, v)), true);
    }
  }
  w.write(prefix(productLatex(q(1), full, v)));
  return true;
}

// --- two or more unknowns -------------------------------------------------------------

function isSquareTerm(t: Term): boolean {
  const r = Math.round(Math.sqrt(Math.abs(t.c.n)));
  const rd = Math.round(Math.sqrt(t.c.d));
  return r * r === Math.abs(t.c.n) && rd * rd === t.c.d && Object.values(t.vars).every((p) => p % 2 === 0);
}

function sqrtTerm(t: Term): Term {
  const vars: Record<string, number> = {};
  for (const [k, p] of Object.entries(t.vars)) vars[k] = p / 2;
  return { c: q(Math.round(Math.sqrt(Math.abs(t.c.n))), Math.round(Math.sqrt(t.c.d))), vars };
}

function multivariate(terms: Term[], w: StepWriter): boolean {
  const ts = standardOrder(combineTerms(terms));
  if (ts.length < 2 || ts.some((t) => t.c.d !== 1)) return false;
  let g = 0;
  for (const t of ts) g = gcdInt(g, t.c.n);
  if (ts[0].c.n < 0) g = -g;
  const low: Record<string, number> = {};
  for (const v of Object.keys(ts[0].vars)) {
    const m = Math.min(...ts.map((t) => t.vars[v] ?? 0));
    if (m > 0) low[v] = m;
  }
  const rest: Term[] = ts.map((t) => {
    const vars: Record<string, number> = {};
    for (const [k, p] of Object.entries(t.vars)) if (p - (low[k] ?? 0) > 0) vars[k] = p - (low[k] ?? 0);
    return { c: q(t.c.n / g), vars };
  });
  const common = Math.abs(g) !== 1 || Object.keys(low).length > 0 || g < 0;
  const gTex = common ? termsLatex([{ c: q(g), vars: low }]).replace(/^1$/, "").replace(/^-1$/, "-") : "";
  if (common) w.write(`${gTex}(${termsLatex(rest)})`);
  if (rest.length === 2 && rest[0].c.n > 0 && rest[1].c.n < 0 && isSquareTerm(rest[0]) && isSquareTerm(rest[1])) {
    const A = termsLatex([sqrtTerm(rest[0])]);
    const B = termsLatex([sqrtTerm(rest[1])]);
    w.write(`${gTex}(${A} + ${B})(${A} - ${B})`);
    return true;
  }
  return common;
}

/**
 * The factoring steps for an expression already expanded and collected, or null when it does not
 * factor over the integers (or is not a polynomial).
 */
export function factorExpressionSteps(node: MathNode, unknowns: readonly string[], inputLatex: string, normalize: Normalize): string[] | null {
  return exactly(() => {
    const terms = termsOf(node, unknowns);
    if (!terms) return null;
    const w = new StepWriter(normalize, inputLatex);
    let ok = false;
    if (unknowns.length === 1) {
      const P = polyFromTerms(terms, unknowns[0]);
      if (!P) return null;
      ok = univariate(P, unknowns[0], w);
    } else ok = multivariate(terms, w);
    const lines = w.lines();
    return ok && lines.length > 0 ? lines : null;
  });
}
