/**
 * Lines and slope, functions, exponential equations and logarithms. Exponentials and logs are
 * built on exact powers (`2^{x} = 32`, `\log_{3} 81`), so every answer is a whole number or, for a
 * common-base equation, a simple fraction.
 */
import type { FormTable } from "./form";
import type { Rng } from "./rng";
import { frac, gcd, lin, poly } from "./tex";

/** Bases and the largest power of each a student works out by hand. */
const BASES: readonly (readonly [base: number, maxPower: number])[] = [
  [2, 7],
  [3, 5],
  [4, 4],
  [5, 4],
  [10, 4],
];

/** Pairs a^x = b on one common base (`4^{x} = 8`: 2^{2x} = 2^{3}), each answer a simple fraction. */
const COMMON_BASE: readonly (readonly [a: number, b: number])[] = [
  [4, 8],
  [8, 4],
  [9, 27],
  [27, 9],
  [4, 32],
  [25, 125],
  [16, 8],
  [8, 16],
  [32, 8],
];

/** A base and an exponent 2..max for it. */
function exact(r: Rng, minPower = 2): [base: number, power: number, value: number] {
  const [b, max] = r.pick(BASES);
  const k = r.int(minPower, max);
  return [b, k, b ** k];
}

/** A slope or coefficient: a small whole number, not 0 (nor 1 when `noOne`). */
function slope(r: Rng, noOne = false): number {
  return r.intExcept(-4, 5, noOne ? [0, 1, -1] : [0]);
}

export const FUNCTIONS: FormTable = {
  linear_functions: [
    (r) => {
      const m = slope(r);
      const x1 = r.int(0, 6);
      const x2 = x1 + r.int(1, 4);
      const y1 = r.int(0, 9);
      const y2 = y1 + m * (x2 - x1);
      return y2 < 0 ? null : [`m = ${frac(`${y2} - ${y1}`, `${x2} - ${x1}`)}`];
    },
    (r) => [`y = ${lin(slope(r), r.int(-9, 9))}`, `x = ${r.int(-5, 6)}`],
    (r) => {
      const m = slope(r);
      const b = r.int(-9, 9);
      return [`y = ${lin(m, b)}`, `y = ${m * r.int(-4, 8) + b}`];
    },
    (r) => {
      const m = slope(r, true);
      const a = r.intExcept(-9, 9, [0]);
      const b = r.intExcept(-6, 6, [0]);
      return [`${lin(1, -a, "y")} = ${m}(${lin(1, -b)})`];
    },
    (r) => {
      const q = r.int(2, 4);
      const p = r.int(1, q - 1) * r.sign();
      if (gcd(p, q) !== 1) return null;
      const b = r.int(-6, 9);
      return [`y = ${p < 0 ? "-" : ""}${frac(Math.abs(p), q)}x${b === 0 ? "" : b < 0 ? ` - ${-b}` : ` + ${b}`}`, `x = ${q * r.intExcept(-3, 5, [0])}`];
    },
  ],

  functions: [
    (r) => {
      const f = r.pick(["f", "g", "h"]);
      return [`${f}(x) = ${lin(slope(r, true), r.intExcept(-9, 9, [0]))}`, `${f}(${r.int(-4, 6)})`];
    },
    (r) => [`g(x) = ${poly([r.int(1, 3), 0, r.intExcept(-9, 9, [0])])}`, `g(${r.intExcept(-4, 4, [0])})`],
    (r) => [`h(x) = ${poly([1, r.intExcept(-6, 6, [0]), r.intExcept(-9, 9, [0])])}`, `h(${r.intExcept(-3, 5, [0])})`],
    (r) => {
      const a = slope(r, true);
      const b = r.intExcept(-9, 9, [0]);
      return [`f(x) = ${lin(a, b)}`, `f(x) = ${a * r.int(-5, 9) + b}`];
    },
    (r) => {
      const inner = r.chance(0.5) ? "x^{2}" : lin(r.int(2, 4), r.intExcept(-5, 5, [0]));
      return [`f(x) = ${lin(r.int(2, 4), r.intExcept(-6, 6, [0]))}`, `g(x) = ${inner}`, `f(g(${r.int(1, 4)}))`];
    },
    (r) => [`f(x) = ${lin(r.int(2, 5), r.intExcept(-9, 9, [0]))}`, `f^{-1}(x)`],
  ],

  exponential_equations: [
    (r) => {
      const [b, , v] = exact(r);
      return [`${b}^{x} = ${v}`];
    },
    (r) => {
      const [b, , v] = exact(r);
      return [`${b}^{x + ${r.int(1, 3)}} = ${v}`];
    },
    (r) => {
      const [b, , v] = exact(r);
      return [`${b}^{x - ${r.int(1, 3)}} = ${v}`];
    },
    (r) => {
      const [b, , v] = exact(r, 1);
      const c = r.int(2, 5);
      return [`${c} \\cdot ${b}^{x} = ${c * v}`];
    },
    (r) => {
      const [b, k, v] = exact(r);
      const m = r.int(2, 3);
      return k % m === 0 ? [`${b}^{${m}x} = ${v}`] : null;
    },
    (r) => {
      const [a, b] = r.pick(COMMON_BASE);
      return [`${a}^{x} = ${b}`];
    },
    (r) => {
      const [b, , v] = exact(r, 1);
      return [`${b}^{x} = ${frac(1, v)}`];
    },
    (r) => {
      const [b, k, v] = exact(r, 1);
      return k % 2 === 1 ? [`${b}^{2x - 1} = ${v}`] : null;
    },
  ],

  logarithms: [
    (r) => {
      const [b, k] = exact(r);
      return [r.chance(0.5) ? `\\log_{${b}} x = ${k}` : `\\log_{${b}}(x) = ${k}`];
    },
    (r) => {
      const [b, , v] = exact(r);
      return [`\\log_{${b}} ${v}`];
    },
    (r) => {
      const [b, k] = exact(r, 1);
      return [`\\log_{${b}}(x + ${r.int(1, 9)}) = ${k}`];
    },
    (r) => {
      const [b, , v] = exact(r);
      const factors: number[] = [];
      for (let m = 2; m * m <= v; m++) if (v % m === 0) factors.push(m);
      if (factors.length === 0) return null;
      const m = r.pick(factors);
      return [`\\log_{${b}} ${m} + \\log_{${b}} ${v / m}`];
    },
    (r) => {
      const [b, , v] = exact(r, 1);
      const n = r.int(2, 6);
      return n * v > 500 ? null : [`\\log_{${b}} ${n * v} - \\log_{${b}} ${n}`];
    },
    (r) => [`\\log ${10 ** r.int(2, 5)}`],
    (r) => {
      const [b, k] = exact(r, 1);
      const c = r.int(2, 3);
      return [`${c}\\log_{${b}} x = ${c * k}`];
    },
    (r) => {
      const k = r.int(2, 3);
      const base = r.int(2, k === 2 ? 9 : 4);
      return [`\\log_{x} ${base ** k} = ${k}`];
    },
    (r) => {
      const [b, k, v] = exact(r);
      const divisors: number[] = [];
      for (let a = 2; a < v; a++) if (v % a === 0) divisors.push(a);
      if (divisors.length === 0) return null;
      return [`\\log_{${b}} x + \\log_{${b}} ${r.pick(divisors)} = ${k}`];
    },
  ],
};

