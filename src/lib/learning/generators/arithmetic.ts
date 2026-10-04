/**
 * Arithmetic for the youngest students up: small numbers, whole-number answers (fractions and
 * decimals only in their own skills), and negatives only in `negative_numbers`.
 */
import type { FormTable } from "./form";
import type { Rng } from "./rng";
import { dec, frac, gcd, par } from "./tex";

/** Denominators a student meets first. */
const DENOMS = [2, 3, 4, 5, 6, 8, 10, 12] as const;

export const ARITHMETIC: FormTable = {
  add_subtract: [
    (r) => [`${r.int(2, 12)} + ${r.int(2, 12)}`],
    (r) => [`${r.int(11, 59)} + ${r.int(11, 39)}`],
    (r) => {
      const a = r.int(6, 20);
      return [`${a} - ${r.int(2, a - 1)}`];
    },
    (r) => {
      const a = r.int(30, 99);
      return [`${a} - ${r.int(11, a - 5)}`];
    },
    (r) => [`${r.int(2, 15)} + ${r.int(2, 15)} + ${r.int(2, 15)}`],
    (r) => {
      const a = r.int(5, 25);
      const b = r.int(5, 25);
      return [`${a} + ${b} - ${r.int(2, a + b - 1)}`];
    },
  ],

  multiply_divide: [
    (r) => [`${r.int(2, 12)} \\times ${r.int(2, 12)}`],
    (r) => {
      const b = r.int(2, 10);
      return [`${b * r.int(2, 12)} \\div ${b}`];
    },
    (r) => [`${r.int(11, 30)} \\times ${r.int(2, 9)}`],
    (r) => {
      const b = r.int(2, 9);
      return [`${b * r.int(11, 25)} \\div ${b}`];
    },
    (r) => [`${r.int(2, 6)} \\times ${r.int(2, 6)} \\times ${r.int(2, 5)}`],
    (r) => {
      const c = r.int(2, 6);
      const a = r.int(2, 9);
      const b = c * r.int(1, 4);
      return [`${a} \\times ${b} \\div ${c}`];
    },
  ],

  negative_numbers: [
    (r) => {
      const a = r.int(2, 20);
      return [`-${a} + ${r.intExcept(2, 20, [a])}`];
    },
    (r) => {
      const a = r.int(1, 12);
      return [`${a} - ${r.int(a + 1, 20)}`];
    },
    (r) => [`-${r.int(2, 15)} - ${r.int(2, 15)}`],
    (r) => [`${r.intExcept(-12, 12, [0])} - (-${r.int(2, 12)})`],
    (r) => [`-${r.int(2, 15)} + (-${r.int(2, 15)})`],
    (r) => {
      const a = r.int(2, 9);
      const b = r.int(2, 9);
      return [r.chance(0.5) ? `(-${a})(${b})` : `(-${a})(-${b})`];
    },
    (r) => [`(-${r.int(2, 9)}) \\times ${par(r.sign() * r.int(2, 9))}`],
    (r) => {
      const b = r.int(2, 9);
      const q = r.int(2, 9);
      const s = r.pick([
        [-1, 1],
        [1, -1],
        [-1, -1],
      ] as const);
      return [`${par(s[0] * b * q)} \\div ${par(s[1] * b)}`];
    },
  ],

  order_of_operations: [
    (r) => [`${r.int(1, 20)} + ${r.int(2, 9)} \\times ${r.int(2, 9)}`],
    (r) => [`(${r.int(1, 12)} + ${r.int(1, 12)}) \\times ${r.int(2, 9)}`],
    (r) => {
      const c = r.int(2, 9);
      const q = r.int(2, 9);
      return [`${r.int(q + 1, 30)} - ${c * q} \\div ${c}`];
    },
    (r) => {
      const a = r.int(3, 9);
      const b = r.int(3, 9);
      const c = r.int(2, 6);
      const d = r.int(2, 6);
      return a * b > c * d ? [`${a} \\times ${b} - ${c} \\times ${d}`] : null;
    },
    (r) => {
      const d = r.int(1, 6);
      return [`(${r.int(1, 9)} + ${r.int(1, 9)}) \\times (${d + r.int(1, 5)} - ${d})`];
    },
    (r) => {
      const d = r.int(1, 8);
      return [`${r.int(1, 15)} + ${r.int(2, 6)} \\times (${d + r.int(1, 6)} - ${d})`];
    },
    (r) => {
      const a = r.int(2, 6);
      const b = r.int(1, 9);
      const c = r.int(1, 9);
      return [`${a} \\times (${b} + ${c}) - ${r.int(1, a * (b + c) - 1)}`];
    },
    (r) => {
      const c = r.int(2, 6);
      const sum = c * r.int(2, 6);
      const a = r.int(1, sum - 1);
      return [`(${a} + ${sum - a}) \\div ${c} + ${r.int(1, 12)}`];
    },
  ],

  fractions: [
    (r) => {
      const d = r.pick(DENOMS.filter((x) => x >= 5));
      const a = r.int(1, d - 2);
      return [`${frac(a, d)} + ${frac(r.int(1, d - 1 - a), d)}`];
    },
    (r) => {
      const [a, b] = properFraction(r);
      const [c, d] = properFraction(r);
      return b !== d && friendly(a * d + c * b, b * d) ? [`${frac(a, b)} + ${frac(c, d)}`] : null;
    },
    (r) => {
      const [a, b] = properFraction(r);
      const [c, d] = properFraction(r);
      return b !== d && a * d > c * b && friendly(a * d - c * b, b * d) ? [`${frac(a, b)} - ${frac(c, d)}`] : null;
    },
    (r) => {
      const [a, b] = properFraction(r);
      const [c, d] = properFraction(r);
      return friendly(a * c, b * d) ? [`${frac(a, b)} \\times ${frac(c, d)}`] : null;
    },
    (r) => {
      const [a, b] = properFraction(r);
      const [c, d] = properFraction(r);
      return a * d !== b * c && friendly(a * d, b * c) ? [`${frac(a, b)} \\div ${frac(c, d)}`] : null;
    },
    (r) => {
      const [a, b] = properFraction(r);
      return [`${r.int(2, 6)} \\times ${frac(a, b)}`];
    },
  ],

  decimals_percents: [
    (r) => [`${dec(tenths(r, 11, 99), 1)} + ${dec(tenths(r, 11, 99), 1)}`],
    (r) => [`${dec(tenths(r, 11, 99), 1)} + ${dec(hundredths(r), 2)}`],
    (r) => {
      const a = tenths(r, 31, 99);
      return [`${dec(a, 1)} - ${dec(tenths(r, 11, a - 1), 1)}`];
    },
    (r) => [`${dec(tenths(r, 11, 49), 1)} \\times ${r.int(2, 9)}`],
    (r) => {
      const b = r.int(2, 9);
      return [`${dec(tenths(r, 11, 49) * b, 1)} \\div ${b}`];
    },
    (r) => {
      const p = r.pick([5, 10, 15, 20, 25, 30, 40, 50, 60, 75]);
      const step = 100 / gcd(p, 100);
      return [`${p}\\% \\times ${step * r.int(1, Math.max(1, Math.floor(400 / step)))}`];
    },
    (r) => [`0.${r.int(2, 9)} \\times 0.${r.int(2, 9)}`],
  ],

  powers_roots: [
    (r) => [`${r.int(2, 15)}^{2}`],
    (r) => [`${r.int(2, 5)}^{3}`],
    (r) => [`2^{${r.int(3, 8)}}`],
    (r) => [`\\sqrt{${r.int(2, 15) ** 2}}`],
    (r) => [`${r.int(2, 9)}^{2} + \\sqrt{${r.int(2, 10) ** 2}}`],
    (r) => [`\\sqrt{${r.int(2, 10) ** 2}} \\times ${r.int(2, 9)}`],
    (r) => {
      const a = r.int(3, 12);
      return [`${a}^{2} - ${r.int(2, a - 1)}^{2}`];
    },
    (r) => [`\\sqrt{${r.int(2, 10) ** 2}} + \\sqrt{${r.int(2, 10) ** 2}}`],
  ],
};

/** A fraction answer a student can reach by hand: in lowest terms, its denominator at most 24. */
function friendly(n: number, d: number): boolean {
  const g = gcd(n, d);
  return d / g <= 24 && n / g <= 60;
}

/** A proper fraction in lowest terms over a friendly denominator. */
function properFraction(r: Rng): [number, number] {
  const d = r.pick(DENOMS);
  for (let i = 0; i < 20; i++) {
    const n = r.int(1, d - 1);
    if (gcd(n, d) === 1) return [n, d];
  }
  return [1, d];
}

/** A whole number of tenths in [lo, hi] that is not a whole number (so it is written with a point). */
function tenths(r: Rng, lo: number, hi: number): number {
  for (let i = 0; i < 20; i++) {
    const t = r.int(lo, hi);
    if (t % 10 !== 0) return t;
  }
  return lo % 10 === 0 ? lo + 1 : lo;
}

/** Hundredths with two places that show (`1.25`, not `1.20`). */
function hundredths(r: Rng): number {
  for (let i = 0; i < 20; i++) {
    const t = r.int(101, 499);
    if (t % 10 !== 0) return t;
  }
  return 125;
}
