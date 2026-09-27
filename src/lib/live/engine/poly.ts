/**
 * Exact polynomials in one unknown, for the algebra a strong high-school student does by hand:
 * quadratics, factoring, clearing denominators, squaring both sides.
 *
 * A `Poly` is its coefficient list, lowest power first, every coefficient an exact rational
 * (`algebra.ts`'s `Q`), with no trailing zeros (the zero polynomial is `[]`). Every operation
 * that would leave exact arithmetic — a decimal, a number past 1e12 — throws `NotAlgebra`
 * through `q()`; `exactly()` turns that into `null` for the caller. Pure: no mathjs.
 */
import { NotAlgebra, combineTerms, gcdInt, q, qAdd, qDiv, qLatex, qMul, qNeg, termsLatex, type Q, type Term } from "./algebra";

export type Poly = Q[];

/** Runs `fn`, answering `null` instead of leaving exact arithmetic. */
export function exactly<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch (e) {
    if (e instanceof NotAlgebra) return null;
    throw e;
  }
}

const ZERO: Q = { n: 0, d: 1 };
export const ONE: Q = { n: 1, d: 1 };

export const qSub = (a: Q, b: Q): Q => qAdd(a, qNeg(b));
export const qIsZero = (a: Q): boolean => a.n === 0;
export const qEq = (a: Q, b: Q): boolean => a.n === b.n && a.d === b.d;
export const qNum = (a: Q): number => a.n / a.d;
export const qAbs = (a: Q): Q => ({ n: Math.abs(a.n), d: a.d });
const qCmp = (a: Q, b: Q): number => a.n * b.d - b.n * a.d;

/** `a^k` for a small integer `k` (negative allowed when `a` is not zero). */
export function qPow(a: Q, k: number): Q {
  let out = q(1);
  const base = k < 0 ? qDiv(q(1), a) : a;
  for (let i = 0; i < Math.abs(k); i++) out = qMul(out, base);
  return out;
}

/** An exact rational for a JS number that is one (an integer or a small fraction), else null. */
export function qFromNumber(x: number, maxDen = 1000): Q | null {
  if (!Number.isFinite(x)) return null;
  for (let d = 1; d <= maxDen; d++) {
    const n = Math.round(x * d);
    if (Math.abs(n - x * d) < 1e-9 * Math.max(1, Math.abs(x * d))) return exactly(() => q(n, d));
  }
  return null;
}

export function trim(p: readonly Q[]): Poly {
  const out = [...p];
  while (out.length > 0 && qIsZero(out[out.length - 1])) out.pop();
  return out;
}

export const deg = (p: Poly): number => p.length - 1;
export const lead = (p: Poly): Q => p[p.length - 1] ?? ZERO;

function polyAdd(a: Poly, b: Poly): Poly {
  const out: Q[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) out.push(qAdd(a[i] ?? ZERO, b[i] ?? ZERO));
  return trim(out);
}

export const polyScale = (p: Poly, k: Q): Poly => trim(p.map((c) => qMul(c, k)));
export const polyNeg = (p: Poly): Poly => polyScale(p, q(-1));
export const polySub = (a: Poly, b: Poly): Poly => polyAdd(a, polyNeg(b));

/** Long division: `a = quotient * b + remainder`. */
export function polyDiv(a: Poly, b: Poly): { quotient: Poly; remainder: Poly } {
  if (b.length === 0) throw new NotAlgebra();
  let rem = [...a];
  const quo: Q[] = new Array(Math.max(0, a.length - b.length + 1)).fill(ZERO);
  while (rem.length >= b.length && rem.length > 0) {
    const shift = rem.length - b.length;
    const k = qDiv(lead(rem), lead(b));
    quo[shift] = k;
    const sub = new Array(shift).fill(ZERO).concat(b.map((c) => qMul(c, k)));
    rem = polySub(rem, sub);
  }
  return { quotient: trim(quo), remainder: rem };
}

export function polyEval(p: Poly, x: Q): Q {
  let out = q(0);
  for (let i = p.length - 1; i >= 0; i--) out = qAdd(qMul(out, x), p[i]);
  return out;
}

export function polyEvalNum(p: Poly, x: number): number {
  let out = 0;
  for (let i = p.length - 1; i >= 0; i--) out = out * x + qNum(p[i]);
  return out;
}

export const X: Poly = [ZERO, ONE];

/** The polynomial of terms in `variable` only, or null when a term mentions anything else. */
export function polyFromTerms(terms: readonly Term[], variable: string): Poly | null {
  return exactly(() => {
    let out: Poly = [];
    for (const t of terms) {
      const keys = Object.keys(t.vars);
      if (keys.some((k) => k !== variable)) return null;
      const power = t.vars[variable] ?? 0;
      if (power > 12) return null;
      const mono: Q[] = new Array(power + 1).fill(ZERO);
      mono[power] = t.c;
      out = polyAdd(out, mono);
    }
    return out;
  });
}

/** Terms of `p`, highest power first. */
function polyTerms(p: Poly, variable: string): Term[] {
  const out: Term[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    if (qIsZero(p[i])) continue;
    out.push({ c: p[i], vars: i === 0 ? {} : { [variable]: i } });
  }
  return out;
}

/** `x^{2} - 5x + 6`; `0` for the zero polynomial. */
export function polyLatex(p: Poly, variable: string): string {
  return termsLatex(polyTerms(p, variable));
}

/** Terms kept in the order written, like terms merged: `3 + x` stays `3 + x`. */
export function termsAsWritten(terms: readonly Term[]): string {
  return termsLatex(combineTerms(terms));
}

/**
 * `p = content * primitive`, where the primitive polynomial has coprime integer coefficients and
 * a positive leading coefficient. The content carries the sign.
 */
export function primitive(p: Poly): { content: Q; prim: Poly } {
  if (p.length === 0) return { content: q(1), prim: [] };
  let den = 1;
  for (const c of p) den = (den * c.d) / gcdInt(den, c.d);
  const ints = p.map((c) => (c.n * den) / c.d);
  let g = 0;
  for (const n of ints) if (n !== 0) g = g === 0 ? Math.abs(n) : gcdInt(g, n);
  if (g === 0) g = 1;
  const sign = ints[ints.length - 1] < 0 ? -1 : 1;
  const content = q(sign * g, den);
  return { content, prim: p.map((c) => qDiv(c, content)) };
}

function divisors(n: number): number[] {
  const m = Math.abs(n);
  if (m === 0 || m > 1e8) return [];
  const small: number[] = [];
  const large: number[] = [];
  for (let d = 1; d * d <= m; d++) {
    if (m % d !== 0) continue;
    small.push(d);
    if (d * d !== m) large.unshift(m / d);
  }
  return [...small, ...large];
}

/** Distinct rational roots, ascending (rational root theorem on the primitive polynomial). */
function rationalRoots(p: Poly): Q[] {
  const out: Q[] = [];
  if (p.length <= 1) return out;
  let { prim } = primitive(p);
  if (qIsZero(prim[0])) {
    out.push(q(0));
    while (prim.length > 0 && qIsZero(prim[0])) prim = prim.slice(1);
  }
  if (prim.length <= 1) return out;
  const a0 = prim[0].n;
  const an = lead(prim).n;
  for (const num of divisors(a0)) {
    for (const den of divisors(an)) {
      for (const sign of [1, -1]) {
        const r = q(sign * num, den);
        if (out.some((o) => qEq(o, r))) continue;
        if (qIsZero(polyEval(prim, r))) out.push(r);
      }
    }
  }
  return out.sort(qCmp);
}

interface LinearFactorization {
  /** the constant in front */
  content: Q;
  /** rational roots with their multiplicities, ascending */
  roots: Array<{ root: Q; mult: number }>;
  /** what is left: primitive, no rational roots (`[1]` when nothing) */
  rest: Poly;
}

/**
 * `p = content * Π (d x - n)^mult * rest` over the integers (Gauss): each rational root `n/d`
 * contributes the primitive factor `d x - n`.
 */
export function factorLinear(p: Poly): LinearFactorization {
  const { content, prim } = primitive(p);
  let rest = prim;
  const roots: Array<{ root: Q; mult: number }> = [];
  for (const r of rationalRoots(prim)) {
    let mult = 0;
    const f = rootFactor(r);
    for (;;) {
      if (deg(rest) < 1) break;
      const { quotient, remainder } = polyDiv(rest, f);
      if (remainder.length !== 0) break;
      rest = quotient;
      mult++;
    }
    if (mult > 0) roots.push({ root: r, mult });
  }
  return { content, roots, rest };
}

/** The primitive linear factor of a rational root `n/d`: `d x - n` (`x` for 0). */
export function rootFactor(r: Q): Poly {
  return [q(-r.n), q(r.d)];
}

/** `(x - 2)`, `(2x + 1)`, `x`; `^{k}` for a repeated one. Brackets always except for `x`. */
function factorLatex(f: Poly, variable: string, mult = 1): string {
  const bare = deg(f) === 1 && qIsZero(f[0]) && qEq(f[1], ONE);
  const body = bare ? variable : `(${polyLatex(f, variable)})`;
  return mult > 1 ? `${body}^{${mult}}` : body;
}

/**
 * A product of factors as a student writes it: the constant, then a bare `x` (or `x^{2}`), then
 * the bracketed factors — `2x(x - 3)(x + 1)`, `-(x - 2)`, `3(x + 1)^{2}`.
 */
export function productLatex(content: Q, factors: ReadonlyArray<{ f: Poly; mult: number }>, variable: string): string {
  const mono = factors.filter((x) => deg(x.f) === 1 && qIsZero(x.f[0]) && qEq(x.f[1], ONE));
  const others = factors.filter((x) => !mono.includes(x));
  const monoPower = mono.reduce((s, x) => s + x.mult, 0);
  let out = "";
  if (monoPower > 0) out += monoPower === 1 ? variable : `${variable}^{${monoPower}}`;
  for (const x of others) out += factorLatex(x.f, variable, x.mult);
  if (!out) return qLatex(content);
  if (qEq(content, ONE)) return out;
  if (qEq(content, q(-1))) return `-${out}`;
  const c = qLatex(content);
  // `\frac{1}{2}(x - 1)`: a fraction in front reads fine; a bare `x` after a fraction too
  return `${c}${out}`;
}

/** A number as it sits inside a longer line: negatives bracketed (`(-3)`), fractions as written. */
export function qParen(a: Q): string {
  return a.n < 0 ? `(${qLatex(a)})` : qLatex(a);
}
