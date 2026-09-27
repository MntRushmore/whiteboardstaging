/**
 * Exact square roots the way a student simplifies them: `\sqrt{8}` → `2\sqrt{2}`,
 * `\sqrt{\frac{3}{2}}` → `\frac{\sqrt{6}}{2}`, and the quadratic-formula pair
 * `\frac{4 \pm 2\sqrt{3}}{2}` → `2 \pm \sqrt{3}`. Integers only (the callers work on primitive
 * integer polynomials); anything past 1e9 under a root is refused (`null`). Pure.
 */
import { gcdInt, q, qLatex, type Q } from "./algebra";

const MAX_RADICAND = 1e9;

/** `n = k^2 m` with `m` square-free; null for a radicand the engine will not factor. */
export function simplifySqrt(n: number): { k: number; m: number } | null {
  if (!Number.isInteger(n) || n < 0 || n > MAX_RADICAND) return null;
  if (n === 0) return { k: 0, m: 1 };
  let k = 1;
  let m = n;
  for (let i = 2; i * i <= m; i++) {
    while (m % (i * i) === 0) {
      m /= i * i;
      k *= i;
    }
  }
  return { k, m };
}

/** `\sqrt{m}` with its coefficient: `\sqrt{2}`, `3\sqrt{2}`. */
export function surdTerm(k: number, m: number): string {
  if (m === 1) return String(k);
  return k === 1 ? `\\sqrt{${m}}` : `${k}\\sqrt{${m}}`;
}

/** `(p ± k√m) / d`, reduced: `m > 1` square-free, `k > 0`, `d > 0`, gcd(p, k, d) = 1. */
export interface SurdPair {
  p: number;
  k: number;
  m: number;
  d: number;
}

export function surdPair(p: number, k: number, m: number, d: number): SurdPair {
  const sign = d < 0 ? -1 : 1;
  const g = gcdInt(gcdInt(Math.abs(p), Math.abs(k)), Math.abs(d)) || 1;
  return { p: (sign * p) / g || 0, k: Math.abs(k) / g, m, d: Math.abs(d) / g };
}

function numerator(p: number, surd: string, sign: "\\pm" | "+" | "-"): string {
  if (p === 0) return sign === "+" ? surd : sign === "-" ? `-${surd}` : `\\pm ${surd}`;
  return `${p} ${sign} ${surd}`;
}

/** `1 \pm \sqrt{2}`, `\frac{1 \pm \sqrt{5}}{2}`, `\pm 2\sqrt{3}`, `\pm \frac{\sqrt{6}}{2}`. */
export function surdPairLatex(s: SurdPair, sign: "\\pm" | "+" | "-" = "\\pm"): string {
  const surd = surdTerm(s.k, s.m);
  if (s.d === 1) return numerator(s.p, surd, sign);
  if (s.p === 0) {
    const frac = `\\frac{${surd}}{${s.d}}`;
    return sign === "+" ? frac : sign === "-" ? `-${frac}` : `\\pm ${frac}`;
  }
  return `\\frac{${numerator(s.p, surd, sign)}}{${s.d}}`;
}

export function surdValue(s: SurdPair, sign: 1 | -1): number {
  return (s.p + sign * s.k * Math.sqrt(s.m)) / s.d;
}

/** √(a/b) for a positive rational: exact rational when it is a perfect square, else `K√M / d`. */
export function sqrtQ(a: Q): { rational: Q } | { surd: SurdPair } | null {
  if (a.n < 0) return null;
  const root = simplifySqrt(a.n * a.d);
  if (!root) return null;
  // √(n/d) = √(n d) / d
  if (root.m === 1) return { rational: q(root.k, a.d) };
  return { surd: surdPair(0, root.k, root.m, a.d) };
}

/** The value of `sqrtQ` as LaTeX without a sign: `3`, `\frac{3}{2}`, `2\sqrt{2}`, `\frac{\sqrt{6}}{2}`. */
export function sqrtQLatex(r: { rational: Q } | { surd: SurdPair }): string {
  return "rational" in r ? qLatex(r.rational) : surdPairLatex(r.surd, "+");
}
