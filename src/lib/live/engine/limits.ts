/**
 * Limits at a point that direct substitution and factorising cannot do (0/0 that is not a
 * rational function), with the lines a teacher writes. Reached from `calculus.ts`'s `limit` hook,
 * which checks every answer against the function near the point.
 *
 *   \lim_{x \to 0} \frac{\sqrt{x + 4} - 2}{x}                          \lim_{x \to 0} \frac{e^{x} - 1}{x}
 *   = \lim_{x \to 0} \frac{(\sqrt{x + 4} - 2)(\sqrt{x + 4} + 2)}{x(\sqrt{x + 4} + 2)}   = \lim_{x \to 0} \frac{e^{x}}{1}
 *   = \lim_{x \to 0} \frac{x}{x(\sqrt{x + 4} + 2)}                     = \frac{e^{0}}{1}
 *   = \lim_{x \to 0} \frac{1}{\sqrt{x + 4} + 2}                        = 1
 *   = \frac{1}{\sqrt{0 + 4} + 2}
 *   = \frac{1}{4}
 *
 * A square root next to a number: multiply top and bottom by the conjugate, cancel the factor
 * that made 0/0, substitute. Anything else that is 0/0: L'Hôpital's rule — top and bottom
 * differentiated (at most three times) until substitution gives a value.
 */
import {
  add,
  canon,
  canonToExpr,
  div,
  evalExact,
  exLit,
  hasTopLevelSum,
  exNum,
  exTex,
  hasVar,
  I,
  makeDiff,
  mul,
  neg,
  pDivRoot,
  pEval,
  polyCanon,
  polyOf,
  pow,
  printCanon,
  QHALF,
  qEq,
  qZero,
  setOrderVar,
  substitute,
  tex,
  ZeroDivision,
  type Ex,
  type Expr,
  type LimitTechnique,
  type Poly,
  type Term,
} from "./calculus";

export interface Limits {
  limit(operand: Expr, x: string, a: Ex, prefix: string): LimitTechnique | null;
}

/** The operand as top / bottom: a fraction as written, or the positive and negative powers of one term. */
function fraction(e: Expr): { top: Expr; bottom: Expr } | null {
  if (e.t === "div") return { top: e.num, bottom: e.den };
  if (e.t === "neg" && e.arg.t === "div") return { top: neg(e.arg.num), bottom: e.arg.den };
  const C = canon(e);
  if (C.length !== 1) return null;
  const t = C[0];
  const bottom = t.f.filter((f) => f.e.n < 0).map((f) => ({ ...f, e: { n: -f.e.n, d: f.e.d } }));
  if (bottom.length === 0) return null;
  return { top: canonToExpr([{ c: t.c, f: t.f.filter((f) => f.e.n > 0) }]), bottom: canonToExpr([{ c: { n: 1, d: 1 }, f: bottom }]) };
}

/** A sum with exactly one square-root term: r·√g + c → { r, g, c } (c may be 0 but not have a root). */
function radicalSum(e: Expr, x: string): { root: Term; rest: Term[] } | null {
  const C = canon(e);
  if (C.length < 2) return null;
  const isRoot = (t: Term) => t.f.length === 1 && qEq(t.f[0].e, QHALF) && hasVar(t.f[0].base, x);
  const roots = C.filter(isRoot);
  if (roots.length !== 1) return null;
  const rest = C.filter((t) => !isRoot(t));
  if (rest.some((t) => t.f.some((f) => !Number.isInteger(f.e.n / f.e.d)))) return null;
  return { root: roots[0], rest };
}

const valueAt = (e: Expr, x: string, a: Ex): Ex => evalExact(e, new Map([[x, a]]));

function isZeroAt(e: Expr, x: string, a: Ex): boolean {
  try {
    return Math.abs(exNum(valueAt(e, x, a))) < 1e-12;
  } catch {
    return false;
  }
}

export function createLimits(): Limits {
  const conjugate = (top: Expr, bottom: Expr, x: string, a: Ex, prefix: string): LimitTechnique | null => {
    const inTop = radicalSum(top, x);
    const inBottom = inTop ? null : radicalSum(bottom, x);
    const r = inTop ?? inBottom;
    if (!r || !r.rest.length) return null;
    // r√g + c times r√g - c is r²g - c²: no root left
    // `\sqrt{x + 4}`, as written, not the index form
    const radicand = r.root.f[0].base;
    const sq: Expr = { t: "sqrt", arg: radicand };
    const rootE = r.root.c.n === r.root.c.d ? sq : mul([canonToExpr([{ c: r.root.c, f: [] }]), sq]);
    const restE = canonToExpr(r.rest);
    const conj = add([rootE, neg(restE)]);
    const product = canon(add([pow(rootE, I(2)), neg(pow(restE, I(2)))]));
    const P = polyOf(canonToExpr(product), x);
    const other = inTop ? bottom : top;
    const Q = polyOf(other, x);
    if (!P || !Q) return null;
    if (a.t.length > 0) return null; // the point is a rational
    // cancel (x - a) from the polynomial top and bottom while both vanish there
    let Pk: Poly = P;
    let Qk: Poly = Q;
    let k = 0;
    while (Pk.length > 1 && Qk.length > 1 && qZero(pEval(Pk, a.r)) && qZero(pEval(Qk, a.r)) && k < 6) {
      Pk = pDivRoot(Pk, a.r);
      Qk = pDivRoot(Qk, a.r);
      k++;
    }
    if (k === 0) return null;
    const polyE = (p: Poly) => canonToExpr(polyCanon(p, x));
    const multiplied = div(mul([top, conj]), mul([bottom, conj]));
    const expanded = inTop ? div(canonToExpr(product), mul([bottom, conj])) : div(mul([top, conj]), canonToExpr(product));
    const cancelled = inTop ? overOrAlone(polyE(Pk), mulOrOne(polyE(Qk), conj)) : overOrAlone(mulOrOne(polyE(Qk), conj), polyE(Pk));
    let value: Ex;
    try {
      value = valueAt(cancelled, x, a);
    } catch {
      return null;
    }
    const lines = [`${prefix} ${tex(multiplied)}`, `${prefix} ${tex(expanded)}`, `${prefix} ${grouped(tex(cancelled))}`, ...substituted(cancelled, x, a), exTex(value, true)];
    return { lines, value };
  };

  const lhopital = (top: Expr, bottom: Expr, x: string, a: Ex, prefix: string): LimitTechnique | null => {
    const d = makeDiff(x);
    let f = top;
    let g = bottom;
    const lines: string[] = [];
    for (let k = 0; k < 3; k++) {
      // only 0/0 is L'Hôpital's
      if (!isZeroAt(f, x, a) || !isZeroAt(g, x, a)) return null;
      f = canonToExpr(canon(d(f).val));
      g = canonToExpr(canon(d(g).val));
      // top and bottom differentiated, side by side — or the quotient when that would stack fractions
      const fTex = printCanon(canon(f), "display", x);
      const gTex = printCanon(canon(g), "display", x);
      const shown = gTex === "1" ? fTex : /\\frac/.test(fTex + gTex) ? printCanon(canon(div(f, g)), "display", x) : `\\frac{${fTex}}{${gTex}}`;
      lines.push(`${prefix} ${grouped(shown)}`);
      try {
        const value = valueAt(div(f, g), x, a);
        lines.push(...substituted(gTex === "1" ? f : div(f, g), x, a), exTex(value, true));
        return { lines, value };
      } catch (e) {
        if (!(e instanceof ZeroDivision)) return null;
      }
    }
    return null;
  };

  const limit = (operand: Expr, x: string, a: Ex, prefix: string): LimitTechnique | null => {
    setOrderVar(x);
    const fr = fraction(operand);
    if (!fr) return null;
    return conjugate(fr.top, fr.bottom, x, a, prefix) ?? lhopital(fr.top, fr.bottom, x, a, prefix);
  };

  return { limit };
}

/** The value put in (`\frac{1}{\sqrt{0 + 4} + 2}`) — skipped when it would read `1^{-1}`. */
function substituted(e: Expr, x: string, a: Ex): string[] {
  const t = tex(substitute(e, x, exLit(a)));
  return /\^\{-|\^\{\\frac/.test(t) ? [] : [t];
}

/** `\lim (\sqrt{x + 1} + 1)`: the limit of the whole sum. */
function grouped(t: string): string {
  return hasTopLevelSum(t) ? `(${t})` : t;
}

/** p / q, or p alone when q is 1. */
function overOrAlone(p: Expr, q: Expr): Expr {
  const c = canon(q);
  return c.length === 1 && c[0].f.length === 0 && c[0].c.n === c[0].c.d ? p : div(p, q);
}

/** p · q, or just q when p is 1. */
function mulOrOne(p: Expr, q: Expr): Expr {
  const c = canon(p);
  if (c.length === 1 && c[0].f.length === 0 && c[0].c.n === c[0].c.d) return q;
  return mul([p, q]);
}
