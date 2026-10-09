/**
 * The K–8 path's skills (`grades.ts`, 2026-10-09): one or more forms each, written from the classic
 * first problem to the hardest (the topic ladder ranks them that way, `ladder.ts`), with numbers a
 * child of that grade meets:
 *
 *  - Kindergarten: sums and take-aways up to 10, never below 0;
 *  - 1st–2nd grade: facts to 20, tens, then 2- and 3-digit adding and subtracting;
 *  - times tables and division facts 2–12; long division with 2–3 digit dividends over a 1-digit
 *    divisor and no remainder;
 *  - fractions over small denominators (answers over at most 24);
 *  - decimals with 1–2 places (answers too); percents of friendly numbers; proportions with whole
 *    answers.
 *
 * Every answer is chosen first, so each problem is clean by construction, and each problem's
 * numbers put it under its own skill (`classifyProblem` files it there: a sum to 20 never makes 10
 * or less, adding tens never makes 20 or less, a long division never has a quotient of 12 or less).
 * An unknown `x` appears only from 6th grade up (percents and proportions). `__tests__/practice.test.ts`
 * holds every form to the engine, the hand and the classifier.
 */
import type { FormTable } from "./form";
import type { Rng } from "./rng";
import { dec, frac, gcd } from "./tex";

/** A whole number in [lo, hi] that is not a multiple of 10 (a "tens" number files under adding tens). */
function notTens(r: Rng, lo: number, hi: number): number {
  for (let i = 0; i < 20; i++) {
    const n = r.int(lo, hi);
    if (n % 10 !== 0) return n;
  }
  return lo % 10 === 0 ? lo + 1 : lo;
}

/** A proper fraction in lowest terms over one of `dens`. */
function proper(r: Rng, dens: readonly number[]): [number, number] {
  const d = r.pick(dens);
  for (let i = 0; i < 20; i++) {
    const n = r.int(1, d - 1);
    if (gcd(n, d) === 1) return [n, d];
  }
  return [1, d];
}

/** A fraction answer a child can reach by hand: in lowest terms, over at most 24. */
function friendly(n: number, d: number): boolean {
  const g = gcd(n, d);
  return d / g <= 24 && n / g <= 60;
}

/** A mixed number, `2\frac{1}{3}`, as the chat writes one (no space: `tidy` keeps it so). */
function mixed(whole: number, n: number, d: number): string {
  return `${whole}${frac(n, d)}`;
}

/** Tenths that are not whole (so the number is written with a point). */
function tenths(r: Rng, lo: number, hi: number): number {
  for (let i = 0; i < 20; i++) {
    const t = r.int(lo, hi);
    if (t % 10 !== 0) return t;
  }
  return lo % 10 === 0 ? lo + 1 : lo;
}

/** Hundredths whose second place shows (`3.45`, not `3.40`). */
function hundredths(r: Rng, lo: number, hi: number): number {
  for (let i = 0; i < 20; i++) {
    const t = r.int(lo, hi);
    if (t % 10 !== 0) return t;
  }
  return lo % 10 === 0 ? lo + 1 : lo;
}

/** Denominators of a first fractions lesson. */
const SMALL_DENS = [2, 3, 4, 5, 6, 8] as const;
const DENS = [2, 3, 4, 5, 6, 8, 10, 12] as const;

export const PRIMARY: FormTable = {
  // ---------------------------------------------------------------- Kindergarten

  add_within_10: [
    // two small numbers
    (r) => [`${r.int(1, 5)} + ${r.int(1, 5)}`],
    // two numbers that make 6 to 10
    (r) => {
      const sum = r.int(6, 10);
      const a = r.int(1, sum - 1);
      return [`${a} + ${sum - a}`];
    },
    // three small numbers, 10 at most
    (r) => {
      const a = r.int(1, 4);
      const b = r.int(1, 4);
      return [`${a} + ${b} + ${r.int(1, 10 - a - b)}`];
    },
  ],

  subtract_within_10: [
    (r) => {
      const a = r.int(2, 5);
      return [`${a} - ${r.int(1, a - 1)}`];
    },
    (r) => {
      const a = r.int(6, 10);
      return [`${a} - ${r.int(1, a - 1)}`];
    },
    // two take-aways in a row, never below 1
    (r) => {
      const a = r.int(5, 10);
      const b = r.int(1, 3);
      return [`${a} - ${b} - ${r.int(1, a - b - 1)}`];
    },
  ],

  // ---------------------------------------------------------------- 1st grade

  add_within_20: [
    // across ten: 8 + 7
    (r) => {
      const a = r.int(2, 9);
      return [`${a} + ${r.int(Math.max(2, 11 - a), 9)}`];
    },
    // a teen and a small number: 13 + 5
    (r) => {
      const a = r.int(10, 17);
      return [`${a} + ${r.int(2, 20 - a)}`];
    },
    // three numbers, 11 to 20 together
    (r) => {
      const a = r.int(2, 9);
      const b = r.int(2, 9);
      const c = r.int(Math.max(2, 11 - a - b), Math.min(9, 20 - a - b));
      return a + b + c >= 11 && a + b + c <= 20 ? [`${a} + ${b} + ${c}`] : null;
    },
  ],

  subtract_within_20: [
    // across ten: 15 - 8
    (r) => {
      const a = r.int(11, 18);
      return [`${a} - ${r.int(Math.max(2, a - 9), 9)}`];
    },
    // within the teens: 17 - 4
    (r) => {
      const a = r.int(12, 20);
      return [`${a} - ${r.int(2, Math.min(9, a - 10))}`];
    },
    (r) => {
      const a = r.int(12, 20);
      const b = r.int(2, 6);
      return [`${a} - ${b} - ${r.int(2, Math.min(9, a - b - 1))}`];
    },
  ],

  add_tens: [
    // tens and tens: 40 + 30
    (r) => {
      const a = r.int(1, 8);
      return [`${a * 10} + ${r.int(Math.max(1, 3 - a), 10 - a) * 10}`];
    },
    // tens taken from tens: 70 - 40
    (r) => {
      const a = r.int(3, 9);
      return [`${a * 10} - ${r.int(1, a - 1) * 10}`];
    },
    // count on by tens: 34 + 20
    (r) => {
      const a = notTens(r, 12, 69);
      return [`${a} + ${r.int(1, 9 - Math.floor(a / 10)) * 10}`];
    },
    // count back by tens: 56 - 30
    (r) => {
      const a = notTens(r, 31, 99);
      return [`${a} - ${r.int(1, Math.floor(a / 10) - 1) * 10}`];
    },
    // three tens: 20 + 30 + 40
    (r) => {
      const a = r.int(1, 4);
      const b = r.int(1, 4);
      return [`${a * 10} + ${b * 10} + ${r.int(1, 10 - a - b) * 10}`];
    },
  ],

  // ---------------------------------------------------------------- 2nd grade

  add_within_100: [
    // a 2-digit and a 1-digit number, carrying: 47 + 6
    (r) => {
      const tens = r.int(2, 8);
      const ones = r.int(2, 9);
      return [`${tens * 10 + ones} + ${r.int(Math.max(2, 10 - ones), 9)}`];
    },
    // two 2-digit numbers: 47 + 38
    (r) => {
      const a = notTens(r, 11, 79);
      return [`${a} + ${notTens(r, 11, Math.min(89, 100 - a))}`];
    },
    // three 2-digit numbers: 23 + 14 + 31
    (r) => {
      const a = notTens(r, 11, 39);
      const b = notTens(r, 11, 39);
      return [`${a} + ${b} + ${notTens(r, 11, Math.min(39, 100 - a - b))}`];
    },
  ],

  subtract_within_100: [
    // a 1-digit number from a 2-digit one, borrowing: 43 - 7
    (r) => {
      const tens = r.int(2, 9);
      const ones = r.int(0, 7);
      const a = tens * 10 + ones;
      return a > 20 ? [`${a} - ${r.int(Math.max(2, ones + 1), 9)}`] : null;
    },
    // two 2-digit numbers: 72 - 35
    (r) => {
      const a = r.int(30, 99);
      return [`${a} - ${notTens(r, 11, a - 1)}`];
    },
    // two take-aways: 85 - 23 - 17
    (r) => {
      const a = r.int(50, 99);
      const b = notTens(r, 11, 29);
      return [`${a} - ${b} - ${notTens(r, 11, Math.min(29, a - b - 1))}`];
    },
  ],

  add_subtract_within_1000: [
    // 479 + 36
    (r) => {
      const a = r.int(101, 899);
      return [`${a} + ${notTens(r, 11, Math.min(99, 999 - a))}`];
    },
    // 386 + 247
    (r) => {
      const a = r.int(101, 699);
      return [`${a} + ${r.int(101, 999 - a)}`];
    },
    // 634 - 278
    (r) => {
      const a = r.int(200, 999);
      return [`${a} - ${r.int(101, a - 1)}`];
    },
    // 348 + 276 - 129
    (r) => {
      const a = r.int(101, 499);
      const b = r.int(101, 499);
      return [`${a} + ${b} - ${r.int(101, a + b - 1)}`];
    },
  ],

  // ---------------------------------------------------------------- 3rd grade

  times_tables: [
    // the friendly tables: 2, 3, 4, 5 and 10
    (r) => {
      const a = r.pick([2, 3, 4, 5, 10]);
      const b = r.int(2, 10);
      return [r.chance(0.5) ? `${a} \\times ${b}` : `${b} \\times ${a}`];
    },
    // up to 9 × 9
    (r) => [`${r.int(6, 9)} \\times ${r.int(2, 9)}`],
    // three at once: 3 × 4 × 2
    (r) => [`${r.int(2, 5)} \\times ${r.int(2, 5)} \\times ${r.int(2, 5)}`],
    // up to 12 × 12
    (r) => [`${r.int(6, 12)} \\times ${r.int(6, 12)}`],
  ],

  division_facts: [
    (r) => {
      const b = r.int(2, 5);
      return [`${b * r.int(2, 10)} \\div ${b}`];
    },
    (r) => {
      const b = r.int(6, 9);
      return [`${b * r.int(2, 9)} \\div ${b}`];
    },
    (r) => {
      const b = r.int(6, 12);
      return [`${b * r.int(6, 12)} \\div ${b}`];
    },
  ],

  multiply_by_tens: [
    // 4 × 60
    (r) => [`${r.int(2, 9)} \\times ${r.int(2, 9) * 10}`],
    // 30 × 7
    (r) => [`${r.int(2, 9) * 10} \\times ${r.int(2, 9)}`],
    // 30 × 50
    (r) => [`${r.int(2, 9) * 10} \\times ${r.int(2, 9) * 10}`],
    // 6 × 400
    (r) => [`${r.int(2, 9)} \\times ${r.int(2, 9) * 100}`],
  ],

  // ---------------------------------------------------------------- 4th grade

  multi_digit_add_subtract: [
    // 4386 + 725
    (r) => {
      const a = r.int(1001, 8999);
      return [`${a} + ${r.int(101, Math.min(999, 9999 - a))}`];
    },
    // 4386 + 2947
    (r) => [`${r.int(1001, 4999)} + ${r.int(1001, 4999)}`],
    // 5032 - 687
    (r) => [`${r.int(1001, 9999)} - ${r.int(101, 999)}`],
    // 7032 - 2847
    (r) => {
      const a = r.int(2001, 9999);
      return [`${a} - ${r.int(1001, a - 1)}`];
    },
    // 34386 + 28947
    (r) => [`${r.int(10001, 49999)} + ${r.int(10001, 49999)}`],
    // 2345 + 1678 - 987
    (r) => {
      const a = r.int(1001, 4999);
      const b = r.int(1001, 4999);
      return [`${a} + ${b} - ${r.int(101, 999)}`];
    },
  ],

  multiply_multi_digit: [
    // 46 × 7
    (r) => [`${notTens(r, 13, 99)} \\times ${r.int(2, 9)}`],
    // 213 × 4
    (r) => [`${notTens(r, 101, 999)} \\times ${r.int(2, 9)}`],
    // 34 × 26
    (r) => [`${notTens(r, 13, 99)} \\times ${notTens(r, 13, 99)}`],
    // 213 × 32
    (r) => [`${notTens(r, 101, 499)} \\times ${notTens(r, 11, 39)}`],
  ],

  long_division: [
    // 84 ÷ 6
    (r) => {
      const b = r.int(2, 7);
      return [`${b * r.int(13, Math.floor(99 / b))} \\div ${b}`];
    },
    // 252 ÷ 7
    (r) => {
      const b = r.int(3, 9);
      return [`${b * r.int(Math.max(13, Math.ceil(100 / b)), 99)} \\div ${b}`];
    },
    // 864 ÷ 4
    (r) => {
      const b = r.int(2, 4);
      return [`${b * r.int(100, Math.floor(999 / b))} \\div ${b}`];
    },
  ],

  equivalent_fractions: [
    // halve the top and bottom: 6/8
    (r) => {
      const [n, d] = proper(r, [2, 3, 4, 5]);
      return [frac(2 * n, 2 * d)];
    },
    // 9/12
    (r) => {
      const [n, d] = proper(r, SMALL_DENS);
      const k = r.int(3, 5);
      return [frac(k * n, k * d)];
    },
    // a mixed number as a fraction: 2 1/3
    (r) => {
      const [n, d] = proper(r, SMALL_DENS);
      return [mixed(r.int(1, 4), n, d)];
    },
    // bigger numbers, and more than one whole: 24/36, 18/8
    (r) => {
      const d = r.int(2, 6);
      const n = r.int(1, 2 * d - 1);
      const k = r.int(4, 9);
      return n !== d && gcd(n, d) === 1 ? [frac(k * n, k * d)] : null;
    },
  ],

  add_fractions_like: [
    // 2/7 + 3/7
    (r) => {
      const d = r.int(3, 10);
      const a = r.int(1, d - 2);
      return [`${frac(a, d)} + ${frac(r.int(1, d - 1 - a), d)}`];
    },
    // 5/8 - 3/8
    (r) => {
      const d = r.int(3, 10);
      const a = r.int(2, d - 1);
      return [`${frac(a, d)} - ${frac(r.int(1, a - 1), d)}`];
    },
    // mixed numbers: 2 1/5 + 1 3/5
    (r) => {
      const [a, d] = proper(r, [3, 4, 5, 6, 8]);
      const [b] = proper(r, [d]);
      return [`${mixed(r.int(1, 4), a, d)} + ${mixed(r.int(1, 3), b, d)}`];
    },
    // mixed numbers taken away: 4 2/5 - 1 4/5
    (r) => {
      const [a, d] = proper(r, [3, 4, 5, 6, 8]);
      const [b] = proper(r, [d]);
      const w = r.int(1, 3);
      return [`${mixed(w + r.int(1, 3), a, d)} - ${mixed(w, b, d)}`];
    },
    // three at once: 1/8 + 3/8 + 2/8
    (r) => {
      const d = r.int(5, 12);
      const a = r.int(1, d - 3);
      const b = r.int(1, d - 2 - a);
      return [`${frac(a, d)} + ${frac(b, d)} + ${frac(r.int(1, d - 1 - a - b), d)}`];
    },
  ],

  // ---------------------------------------------------------------- 5th grade

  add_fractions_unlike: [
    // one bottom number goes into the other: 1/2 + 1/4
    (r) => {
      const [a, b] = proper(r, [2, 3, 4, 5]);
      const d = b * r.int(2, Math.floor(12 / b));
      const [c] = proper(r, [d]);
      return friendly(a * d + c * b, b * d) ? [`${frac(a, b)} + ${frac(c, d)}`] : null;
    },
    // 2/3 + 1/4
    (r) => {
      const [a, b] = proper(r, DENS);
      const [c, d] = proper(r, DENS);
      return b !== d && b % d !== 0 && d % b !== 0 && friendly(a * d + c * b, b * d) ? [`${frac(a, b)} + ${frac(c, d)}`] : null;
    },
    // 3/4 - 1/6
    (r) => {
      const [a, b] = proper(r, DENS);
      const [c, d] = proper(r, DENS);
      return b !== d && a * d > c * b && friendly(a * d - c * b, b * d) ? [`${frac(a, b)} - ${frac(c, d)}`] : null;
    },
    // mixed numbers: 1 1/2 + 2 1/3
    (r) => {
      const [a, b] = proper(r, SMALL_DENS);
      const [c, d] = proper(r, SMALL_DENS);
      return b !== d && friendly(a * d + c * b, b * d) ? [`${mixed(r.int(1, 3), a, b)} + ${mixed(r.int(1, 3), c, d)}`] : null;
    },
  ],

  multiply_fractions: [
    // 3 × 2/5
    (r) => {
      const [a, b] = proper(r, SMALL_DENS);
      return [`${r.int(2, 6)} \\times ${frac(a, b)}`];
    },
    // 3/4 × 8
    (r) => {
      const [a, b] = proper(r, SMALL_DENS);
      return [`${frac(a, b)} \\times ${b * r.int(2, 4)}`];
    },
    // 2 1/2 × 3
    (r) => {
      const [a, b] = proper(r, [2, 3, 4]);
      return [`${mixed(r.int(1, 3), a, b)} \\times ${r.int(2, 5)}`];
    },
    // 2/3 × 3/5
    (r) => {
      const [a, b] = proper(r, SMALL_DENS);
      const [c, d] = proper(r, SMALL_DENS);
      return friendly(a * c, b * d) ? [`${frac(a, b)} \\times ${frac(c, d)}`] : null;
    },
  ],

  decimals_add_subtract: [
    // 2.4 + 3.5
    (r) => [`${dec(tenths(r, 11, 59), 1)} + ${dec(tenths(r, 11, 39), 1)}`],
    // 3.45 + 2.8
    (r) => [`${dec(hundredths(r, 101, 599), 2)} + ${dec(tenths(r, 11, 49), 1)}`],
    // 6.3 - 2.7
    (r) => {
      const a = tenths(r, 31, 99);
      return [`${dec(a, 1)} - ${dec(tenths(r, 11, a - 1), 1)}`];
    },
    // 5 - 2.3
    (r) => {
      const a = r.int(3, 10);
      return [`${a} - ${dec(tenths(r, 11, a * 10 - 1), 1)}`];
    },
    // 4.25 - 1.8
    (r) => {
      const a = hundredths(r, 201, 999);
      return [`${dec(a, 2)} - ${dec(tenths(r, 11, Math.floor(a / 10) - 1), 1)}`];
    },
  ],

  decimals_multiply: [
    // 1.2 × 3
    (r) => [`${dec(tenths(r, 11, 49), 1)} \\times ${r.int(2, 9)}`],
    // the point moves: 3.45 × 10, 2.7 × 100
    (r) => (r.chance(0.5) ? [`${dec(hundredths(r, 101, 999), 2)} \\times 10`] : [`${dec(tenths(r, 11, 99), 1)} \\times 100`]),
    // 3.6 ÷ 10
    (r) => [`${dec(tenths(r, 11, 99), 1)} \\div 10`],
    // 5.4 × 0.1
    (r) => [`${dec(tenths(r, 11, 99), 1)} \\times 0.1`],
    // 0.6 × 0.4, 1.2 × 0.3
    (r) => [`${dec(tenths(r, 2, 19), 1)} \\times ${dec(r.int(2, 9), 1)}`],
  ],

  // ---------------------------------------------------------------- 6th grade

  divide_fractions: [
    // 6 ÷ 1/3
    (r) => [`${r.int(2, 9)} \\div ${frac(1, r.int(2, 6))}`],
    // 1/4 ÷ 2
    (r) => [`${frac(1, r.int(2, 6))} \\div ${r.int(2, 5)}`],
    // 4/5 ÷ 2
    (r) => {
      const [a, b] = proper(r, SMALL_DENS);
      return a > 1 ? [`${frac(a, b)} \\div ${r.int(2, 4)}`] : null;
    },
    // 3/4 ÷ 1/2
    (r) => {
      const [a, b] = proper(r, SMALL_DENS);
      const [c, d] = proper(r, SMALL_DENS);
      return a * d !== b * c && friendly(a * d, b * c) ? [`${frac(a, b)} \\div ${frac(c, d)}`] : null;
    },
  ],

  percents: [
    // 50%, 10% and 25% of a number
    (r) => {
      const p = r.pick([10, 25, 50]);
      return [`${p}\\% \\times ${(100 / gcd(p, 100)) * r.int(2, 12)}`];
    },
    // 15% of 80
    (r) => {
      const p = r.pick([5, 15, 20, 30, 40, 60, 75, 80]);
      const step = 100 / gcd(p, 100);
      return [`${p}\\% \\times ${step * r.int(2, Math.max(2, Math.floor(400 / step)))}`];
    },
    // the whole from a part: 25% of what is 20?
    (r) => {
      const p = r.pick([10, 20, 25, 50]);
      const whole = (100 / gcd(p, 100)) * r.int(2, 10);
      return [`${p}\\% \\times x = ${(p * whole) / 100}`];
    },
    // the percent: what percent of 80 is 20?
    (r) => {
      const p = r.pick([10, 20, 25, 50, 75]);
      const whole = (100 / gcd(p, 100)) * r.int(2, 8);
      return [`x\\% \\times ${whole} = ${(p * whole) / 100}`];
    },
  ],

  // ---------------------------------------------------------------- 7th grade

  proportions: [
    // a ratio first: x:4 = 9:12
    (r) => {
      const [n, d] = proper(r, [2, 3, 4, 5]);
      const m = r.int(1, 3);
      const k = r.intExcept(2, 5, [m]);
      return [`x:${d * m} = ${n * k}:${d * k}`];
    },
    // x/4 = 9/12
    (r) => {
      const [n, d] = proper(r, [2, 3, 4, 5, 6]);
      const m = r.int(1, 4);
      const k = r.intExcept(2, 6, [m]);
      return [`${frac("x", d * m)} = ${frac(n * k, d * k)}`];
    },
    // 3/5 = x/20
    (r) => {
      const [n, d] = proper(r, [2, 3, 4, 5, 6]);
      const m = r.int(1, 3);
      const k = r.intExcept(2, 6, [m]);
      return [`${frac(n * m, d * m)} = ${frac("x", d * k)}`];
    },
    // 6/x = 9/12
    (r) => {
      const [n, d] = proper(r, [2, 3, 4, 5, 6]);
      const m = r.int(2, 4);
      const k = r.intExcept(2, 6, [m]);
      return [`${frac(n * m, "x")} = ${frac(n * k, d * k)}`];
    },
  ],
};
