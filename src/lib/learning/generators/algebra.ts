/**
 * Algebra 1 and 2: expressions, equations, inequalities, systems, polynomials, radicals, rational
 * expressions and complex numbers. Every equation is built from its answer (whole numbers, or a
 * simple fraction where the form calls for one), every expression from its simplified form.
 */
import type { FormTable } from "./form";
import type { Rng } from "./rng";
import { coef, complex, frac, gcd, lin, poly, terms } from "./tex";

const RELATIONS = ["<", ">", "\\le", "\\ge"] as const;

/** The unknown: usually x, now and then another letter. */
function letter(r: Rng): string {
  return r.chance(0.75) ? "x" : r.pick(["n", "y", "m"]);
}

/** An answer for an Algebra 1 equation: mostly positive, sometimes negative, never 0. */
function answer(r: Rng, hi = 12): number {
  return r.chance(0.25) ? -r.int(1, 6) : r.int(1, hi);
}

/** `+ 3x` / `- 3x`: a term written after another. */
function tail(c: number, v: string): string {
  return c < 0 ? ` - ${coef(-c, v)}` : ` + ${coef(c, v)}`;
}

/** `x - 3` / `x + 3` for a root or shift (never `x + 0`). */
function shift(v: string, b: number): string {
  return lin(1, b, v);
}

export const ALGEBRA: FormTable = {
  simplify_expressions: [
    (r) => {
      const a = r.int(2, 9);
      const b = r.int(2, 9) * r.sign();
      const c = r.intExcept(-9, 9, [0]);
      return a + b === 0 ? null : [`${a}x${tail(b, "x")}${tail(c, "")}`];
    },
    (r) => {
      const a = r.int(2, 9);
      const b = r.intExcept(-9, 9, [0]);
      const c = r.intExcept(-9, 9, [0, -a]);
      const d = r.intExcept(-9, 9, [0, -b]);
      return [
        terms([
          [a, "x"],
          [b, ""],
          [c, "x"],
          [d, ""],
        ]),
      ];
    },
    (r) => {
      const a = r.int(2, 6);
      const b = r.int(1, 5);
      const d = r.intExcept(-9, 9, [0, -a * b]);
      return [`${a}(${lin(b, r.intExcept(-9, 9, [0]))})${tail(d, "x")}`];
    },
    (r) => {
      const a = r.int(2, 6);
      const c = r.int(2, 6);
      const minus = r.chance(0.4);
      if (minus && a === c) return null;
      return [`${a}(${shift("x", r.intExcept(-9, 9, [0]))}) ${minus ? "-" : "+"} ${c}(${shift("x", r.intExcept(-9, 9, [0]))})`];
    },
    (r) => {
      const a = r.int(3, 9);
      const c = r.intExcept(1, 8, [a]);
      const b = r.int(1, 8);
      const d = r.intExcept(-8, 8, [0, -b]);
      return [
        terms([
          [a, "x"],
          [b, "y"],
          [-c, "x"],
          [d, "y"],
        ]),
      ];
    },
    (r) => {
      const a = r.int(2, 6);
      const c = r.intExcept(-9, 9, [0, a]);
      return [`-${a}(${shift("x", -r.int(1, 9))})${tail(c, "x")}`];
    },
    (r) => {
      const a = r.int(2, 6);
      const c = r.intExcept(-5, 5, [0, -a]);
      const b = r.intExcept(-9, 9, [0]);
      const d = r.intExcept(-9, 9, [0, -b]);
      return [
        terms([
          [a, "x^{2}"],
          [b, "x"],
          [c, "x^{2}"],
          [d, "x"],
        ]),
      ];
    },
  ],

  one_step_equations: [
    (r) => {
      const v = letter(r);
      const a = r.int(2, 20);
      return [`${v} + ${a} = ${r.int(1, 20) + a}`];
    },
    (r) => {
      const v = letter(r);
      const a = r.int(2, 15);
      return [`${v} - ${a} = ${r.int(a + 1, 30) - a}`];
    },
    (r) => {
      const v = letter(r);
      const a = r.int(2, 12);
      const x = r.chance(0.2) ? -r.int(2, 9) : r.int(2, 12);
      return [`${a}${v} = ${a * x}`];
    },
    (r) => [`${frac(letter(r), r.int(2, 9))} = ${r.int(2, 9)}`],
    (r) => {
      const v = letter(r);
      const a = r.int(2, 15);
      return [`${a} + ${v} = ${a + r.int(1, 15)}`];
    },
    (r) => {
      const a = r.int(5, 15);
      return [`x + ${a} = ${a - r.int(1, a - 1) - r.int(1, 5)}`];
    },
  ],

  two_step_equations: [
    (r) => {
      const a = r.int(2, 9);
      const b = r.int(1, 20);
      return [`${a}x + ${b} = ${a * answer(r) + b}`];
    },
    (r) => {
      const a = r.int(2, 9);
      const b = r.int(1, 20);
      return [`${a}x - ${b} = ${a * answer(r) - b}`];
    },
    (r) => {
      const a = r.int(2, 6);
      const b = r.int(1, 12);
      return [`${frac("x", a)} - ${b} = ${answer(r, 9) - b}`];
    },
    (r) => {
      const a = r.int(2, 6);
      const b = r.int(1, 12);
      return [`${frac("x", a)} + ${b} = ${answer(r, 9) + b}`];
    },
    (r) => {
      const a = r.int(2, 6);
      const b = r.int(5, 20);
      return [`${b} - ${a}x = ${b - a * answer(r)}`];
    },
    (r) => {
      const a = r.int(2, 9);
      const b = r.int(1, 20);
      return [`-${a}x + ${b} = ${-a * answer(r) + b}`];
    },
    (r) => {
      const a = r.int(2, 5);
      const b = r.intExcept(-9, 9, [0]);
      return [`${frac(shift("x", b), a)} = ${answer(r, 9)}`];
    },
    (r) => {
      // \frac{ax}{b} + c = d: x a multiple of b
      const b = r.int(2, 5);
      const a = r.intExcept(2, 5, [b]);
      if (gcd(a, b) !== 1) return null;
      const c = r.intExcept(-9, 9, [0]);
      return [`${frac(`${a}x`, b)}${tail(c, "")} = ${a * answer(r, 6) + c}`];
    },
  ],

  multi_step_equations: [
    (r) => {
      const a = r.int(2, 9);
      const c = r.intExcept(2, 9, [a]);
      const b = r.intExcept(-12, 12, [0]);
      const d = (a - c) * answer(r, 10) + b;
      return d === 0 ? null : [`${lin(a, b)} = ${lin(c, d)}`];
    },
    (r) => {
      const a = r.int(2, 5);
      const b = r.intExcept(-6, 6, [0]);
      const c = r.intExcept(2, 9, [a]);
      const x = answer(r, 10);
      const d = a * (x + b) - c * x;
      return d === 0 ? null : [`${a}(${shift("x", b)}) = ${lin(c, d)}`];
    },
    (r) => {
      const a = r.int(2, 6);
      const b = r.int(1, 6);
      const c = r.intExcept(-9, 9, [0]);
      return [`${a}(x - ${b})${tail(c, "")} = ${a * (answer(r, 10) - b) + c}`];
    },
    (r) => {
      const a = r.int(2, 6);
      const c = r.intExcept(2, 6, [a]);
      const b = r.intExcept(-6, 6, [0]);
      const x = answer(r, 10);
      // a(x + b) = c(x + e): c·e = (a - c)·x + a·b
      const ce = (a - c) * x + a * b;
      if (ce % c !== 0 || ce === 0 || ce / c === b) return null;
      const e = ce / c;
      return Math.abs(e) > 12 ? null : [`${a}(${shift("x", b)}) = ${c}(${shift("x", e)})`];
    },
    (r) => {
      // brackets make it more than two steps: a(x + b) = c
      const a = r.int(2, 6);
      const b = r.intExcept(-9, 9, [0]);
      const x = answer(r);
      return x + b === 0 ? null : [`${a}(${shift("x", b)}) = ${a * (x + b)}`];
    },
    (r) => {
      const a = r.int(2, 4);
      const b = r.int(2, 3);
      const c = r.int(1, 5);
      const d = r.int(2, 3);
      const e = r.int(1, 5);
      if (a * b === d) return null;
      const x = r.int(1, 8);
      return [`${a}(${b}x - ${c}) - ${d}(x + ${e}) = ${a * (b * x - c) - d * (x + e)}`];
    },
    (r) => {
      const a = r.int(4, 9);
      const c = r.int(2, a - 1);
      const b = r.intExcept(-9, 9, [0]);
      return [`${a}x${tail(b, "")} - ${c}x = ${(a - c) * answer(r, 10) + b}`];
    },
  ],

  inequalities: [
    (r) => {
      const a = r.int(2, 9);
      const b = r.intExcept(-12, 12, [0]);
      return [`${lin(a, b)} ${r.pick(RELATIONS)} ${a * r.int(-5, 10) + b}`];
    },
    (r) => {
      const a = r.int(2, 6);
      const b = r.int(2, 15);
      return [`${b} - ${a}x ${r.pick(RELATIONS)} ${b - a * r.int(-5, 8)}`];
    },
    (r) => {
      const a = r.int(2, 5);
      const b = r.int(1, 9);
      return [`${frac("x", a)} - ${b} ${r.pick(RELATIONS)} ${r.int(-4, 8) - b}`];
    },
    (r) => {
      const a = r.int(2, 5);
      const b = r.int(1, 6);
      return [`${a}(x - ${b}) ${r.pick(RELATIONS)} ${a * (r.int(-3, 10) - b)}`];
    },
    (r) => {
      const a = r.int(2, 9);
      return [`-${a}x ${r.pick(RELATIONS)} ${-a * r.intExcept(-9, 9, [0])}`];
    },
    (r) => {
      const a = r.int(3, 9);
      const c = r.int(1, a - 1);
      const b = r.intExcept(-9, 9, [0]);
      return [`${lin(a, b)} ${r.pick(RELATIONS)} ${lin(c, (a - c) * r.int(-5, 8) + b)}`];
    },
    (r) => {
      const lo = r.int(-8, 3);
      const hi = r.int(lo + 2, lo + 10);
      const b = r.intExcept(-6, 6, [0]);
      return [`${lo + b} ${r.pick(["<", "\\le"])} ${shift("x", b)} ${r.pick(["<", "\\le"])} ${hi + b}`];
    },
    (r) => {
      const a = r.int(2, 4);
      const b = r.intExcept(-6, 6, [0]);
      const lo = r.int(-5, 2);
      const hi = r.int(lo + 2, lo + 8);
      return [`${a * lo + b} ${r.pick(["<", "\\le"])} ${lin(a, b)} ${r.pick(["<", "\\le"])} ${a * hi + b}`];
    },
  ],

  absolute_value: [
    (r) => [`|${shift("x", r.intExcept(-9, 9, [0]))}| = ${r.int(1, 9)}`],
    (r) => {
      const a = r.int(2, 3);
      const x1 = r.int(-6, 9);
      const x2 = r.int(-6, 9);
      if (x1 === x2 || (a * (x1 + x2)) % 2 !== 0 || (a * (x1 - x2)) % 2 !== 0) return null;
      const b = (a * (x1 + x2)) / 2;
      const c = Math.abs(a * (x1 - x2)) / 2;
      return b === 0 ? null : [`|${lin(a, -b)}| = ${c}`];
    },
    (r) => {
      const a = r.int(2, 5);
      return [`${a}|${shift("x", r.intExcept(-9, 9, [0]))}| = ${a * r.int(1, 8)}`];
    },
    (r) => [`|${shift("x", r.intExcept(-6, 9, [0]))}| ${r.pick(["<", "\\le"])} ${r.int(1, 9)}`],
    (r) => [`|${shift("x", r.intExcept(-6, 9, [0]))}| ${r.pick([">", "\\ge"])} ${r.int(1, 9)}`],
    (r) => {
      const a = r.int(1, 9);
      return [`|x| + ${a} = ${a + r.int(1, 9)}`];
    },
  ],

  systems: [
    (r) => {
      const [x, y] = point(r);
      return [`x + y = ${x + y}`, `x - y = ${x - y}`];
    },
    (r) => {
      const [x, y] = point(r);
      const a = r.int(1, 5);
      const b = r.int(1, 5);
      const d = r.int(1, 5);
      return [`${coef(a, "x")} + ${coef(b, "y")} = ${a * x + b * y}`, `${coef(d, "x")} - ${coef(b, "y")} = ${d * x - b * y}`];
    },
    (r) => {
      const [x, y] = point(r);
      const m = r.intExcept(-3, 4, [0]);
      const a = r.int(1, 5);
      if (a + m === 0) return null;
      return [`y = ${lin(m, y - m * x)}`, `${coef(a, "x")} + y = ${a * x + y}`];
    },
    (r) => {
      const [x, y] = point(r);
      const a = r.intExcept(-3, 4, [0]);
      const c = r.intExcept(-3, 4, [0, a]);
      return [`y = ${lin(a, y - a * x)}`, `y = ${lin(c, y - c * x)}`];
    },
    (r) => {
      const [x, y] = point(r);
      if (x === y) return null;
      const b = r.int(1, 4);
      const c = r.int(1, 4);
      return [`x = ${lin(1, x - y, "y")}`, `${coef(b, "x")} + ${coef(c, "y")} = ${b * x + c * y}`];
    },
    (r) => {
      const [x, y] = point(r);
      const a = r.int(1, 5);
      const b = r.intExcept(-5, 5, [0]);
      const d = r.int(1, 5);
      const e = r.intExcept(-5, 5, [0]);
      if (a * e - b * d === 0) return null;
      return [
        `${terms([
          [a, "x"],
          [b, "y"],
        ])} = ${a * x + b * y}`,
        `${terms([
          [d, "x"],
          [e, "y"],
        ])} = ${d * x + e * y}`,
      ];
    },
  ],

  exponent_rules: [
    (r) => {
      const v = power(r);
      return [`${v}^{${r.int(2, 9)}} \\cdot ${v}^{${r.int(2, 9)}}`];
    },
    (r) => {
      const v = power(r);
      const a = r.int(5, 12);
      return [frac(`${v}^{${a}}`, `${v}^{${r.int(2, a - 2)}}`)];
    },
    (r) => [`(${power(r)}^{${r.int(2, 6)}})^{${r.int(2, 4)}}`],
    (r) => [`(${r.int(2, 3)}${power(r)}^{${r.int(2, 4)}})^{${r.int(2, 3)}}`],
    (r) => {
      const v = power(r);
      return [`${r.int(2, 6)}${v}^{${r.int(2, 6)}} \\cdot ${r.int(2, 6)}${v}^{${r.int(2, 6)}}`];
    },
    (r) => {
      const v = power(r);
      const b = r.int(2, 5);
      const m = r.int(4, 9);
      return [frac(`${b * r.int(2, 5)}${v}^{${m}}`, `${b}${v}^{${r.int(2, m - 2)}}`)];
    },
    (r) => {
      const v = power(r);
      const a = r.int(2, 5);
      return [`${v}^{-${a}} \\cdot ${v}^{${r.int(a + 2, 9)}}`];
    },
    (r) => {
      const a = r.int(2, 4);
      return [`(x^{${a}}y^{${r.intExcept(2, 4, [a])}})^{${r.int(2, 3)}}`];
    },
    (r) => {
      const p = r.int(4, 8);
      return [frac(`x^{${p}}y^{${r.int(3, 6)}}`, `x^{${r.int(2, p - 1)}}y`)];
    },
  ],

  polynomials: [
    (r) => [`(${shift("x", r.intExcept(-9, 9, [0]))})(${shift("x", r.intExcept(-9, 9, [0]))})`],
    (r) => [`(${shift("x", r.int(1, 9) * r.sign())})^{2}`],
    (r) => {
      const a = r.int(2, 9);
      return [`(x - ${a})(x + ${a})`];
    },
    (r) => [`(${lin(r.int(2, 3), r.intExcept(-7, 7, [0]))})(${lin(r.int(2, 3), r.intExcept(-7, 7, [0]))})`],
    (r) => [`(${shift("x", r.intExcept(-5, 5, [0]))})(${poly([1, r.int(-4, 4), r.intExcept(-6, 6, [0])])})`],
    (r) => [`${r.int(2, 5)}x(${shift("x", r.intExcept(-8, 8, [0]))})`],
  ],

  factoring: [
    (r) => {
      const p = r.intExcept(-9, 9, [0]);
      const q = r.intExcept(-9, 9, [0, p, -p]);
      return [poly([1, -(p + q), p * q])];
    },
    (r) => [`x^{2} - ${r.int(2, 10) ** 2}`],
    (r) => {
      const p = r.int(2, 3);
      const q = r.intExcept(-7, 7, [0]);
      const s = r.intExcept(-6, 6, [0]);
      if (gcd(p, q) !== 1 || p * s + q === 0) return null;
      return [poly([p, p * s + q, q * s])];
    },
    (r) => {
      const g = r.int(2, 6);
      const u = r.int(1, 3);
      const w = r.intExcept(-9, 9, [0]);
      return gcd(u, w) === 1 ? [poly([g * u, g * w, 0])] : null;
    },
    (r) => {
      const a = r.int(2, 5);
      const b = r.int(1, 9);
      return gcd(a, b) === 1 ? [`${a * a}x^{2} - ${b * b}`] : null;
    },
    (r) => {
      const a = r.int(1, 9) * r.sign();
      return [poly([1, 2 * a, a * a])];
    },
  ],

  quadratic_equations: [
    (r) => {
      const p = r.intExcept(-9, 9, [0]);
      const q = r.intExcept(-9, 9, [0, p, -p]);
      return [`${poly([1, -(p + q), p * q])} = 0`];
    },
    (r) => {
      const a = r.int(2, 10);
      return [r.chance(0.5) ? `x^{2} - ${a * a} = 0` : `x^{2} = ${a * a}`];
    },
    (r) => {
      // (p·x - q)(x - s) = 0: one whole root, one fraction
      const p = r.int(2, 3);
      const q = r.intExcept(-5, 5, [0]);
      const s = r.intExcept(-6, 6, [0]);
      if (gcd(p, q) !== 1 || p * s + q === 0) return null;
      return [`${poly([p, -(p * s + q), q * s])} = 0`];
    },
    (r) => {
      const p = r.intExcept(-9, 9, [0]);
      const q = r.intExcept(-9, 9, [0, p, -p]);
      return [`${poly([1, -(p + q), 0])} = ${-p * q}`];
    },
    (r) => [`(${shift("x", r.intExcept(-6, 9, [0]))})^{2} = ${r.int(1, 9) ** 2}`],
    (r) => {
      const a = r.int(2, 5);
      return [`${a}x^{2} = ${a * r.int(1, 9) ** 2}`];
    },
    (r) => [`${poly([1, r.intExcept(-9, 9, [0]), 0])} = 0`],
  ],

  radicals: [
    (r) => {
      const b = r.int(2, 9);
      return [`\\sqrt{${shift("x", r.intExcept(-9, 12, [0]))}} = ${b}`];
    },
    (r) => {
      const a = r.int(2, 5);
      const c = r.int(1, 7);
      const b = r.int(1, 9);
      return (c * c + b) % a === 0 ? [`\\sqrt{${a}x - ${b}} = ${c}`] : null;
    },
    (r) => {
      const k = r.int(2, 6);
      return [`\\sqrt{${k * k * r.pick([2, 3, 5, 6, 7])}}`];
    },
    (r) => {
      const m = r.pick([2, 3, 5]);
      const p = r.int(1, 4);
      const q = r.intExcept(2, 4, [p]);
      return [`\\sqrt{${p * p * m}} + \\sqrt{${q * q * m}}`];
    },
    (r) => {
      const m = r.pick([2, 3, 5, 6]);
      const u = r.int(1, 3);
      const v = r.intExcept(1, 3, [u]);
      return [`\\sqrt{${m * u * u}} \\cdot \\sqrt{${m * v * v}}`];
    },
    (r) => {
      const a = r.int(2, 5);
      return [`${a}\\sqrt{x} = ${a * r.int(2, 6)}`];
    },
    (r) => {
      const a = r.int(1, 9);
      return [`\\sqrt{x} + ${a} = ${a + r.int(2, 9)}`];
    },
    (r) => {
      const a = r.int(1, 8);
      return [`\\sqrt{x} - ${a} = ${r.int(a + 1, 12) - a}`];
    },
  ],

  rational_expressions: [
    (r) => {
      const a = r.int(1, 9);
      return [frac(`x^{2} - ${a * a}`, shift("x", a * r.sign()))];
    },
    (r) => {
      const p = r.intExcept(-7, 7, [0]);
      const q = r.intExcept(-7, 7, [0, p, -p]);
      return [frac(poly([1, p + q, p * q]), shift("x", p))];
    },
    (r) => {
      const v = r.pick(["x", "x", "y", "a"]);
      return [`${frac(r.int(1, 9), v)} + ${frac(r.int(1, 9), v)}`];
    },
    (r) => {
      const a = r.int(1, 6);
      return [frac(`x^{2} - ${a * a}`, poly([1, 2 * a, a * a]))];
    },
    (r) => {
      const b = r.int(2, 9);
      return [`${frac(b * r.int(2, 9), "x")} = ${b}`];
    },
    (r) => {
      const x = r.int(-4, 9);
      const p = r.intExcept(-5, 5, [0]);
      const q = r.intExcept(-5, 5, [0, p]);
      const u = x + p;
      const w = x + q;
      if (u === 0 || w === 0 || Math.sign(u) !== Math.sign(w)) return null;
      const g = gcd(u, w);
      const a = Math.abs(u / g);
      const b = Math.abs(w / g);
      if (a === b || a > 12 || b > 12) return null;
      return [`${frac(a, shift("x", p))} = ${frac(b, shift("x", q))}`];
    },
    (r) => [`${frac(r.int(1, 6), "x")} + ${frac(r.int(1, 6), shift("x", r.int(1, 5)))}`],
  ],

  complex_numbers: [
    (r) => [`(${gaussian(r, 8)}) + (${gaussian(r, 8)})`],
    (r) => [`(${gaussian(r, 8)}) - (${gaussian(r, 8)})`],
    (r) => [`(${gaussian(r, 5)})(${gaussian(r, 5)})`],
    (r) => {
      const a = r.int(1, 6);
      const b = r.int(1, 6);
      return [`(${complex(a, b)})(${complex(a, -b)})`];
    },
    (r) => [`i^{${r.int(5, 30)}}`],
    (r) => [`\\sqrt{-${r.int(2, 12) ** 2}}`],
    (r) => [`${r.int(2, 5)}i(${gaussian(r, 6)})`],
    (r) => [`(${complex(r.int(1, 5), r.intExcept(-4, 4, [0]))})^{2}`],
  ],
};

/** A system's solution: small whole numbers, mostly positive. */
function point(r: Rng): [number, number] {
  const one = () => (r.chance(0.2) ? -r.int(1, 4) : r.int(1, 9));
  return [one(), one()];
}

/** The base of a power in an exponent-rules problem. */
function power(r: Rng): string {
  // not m (read as metres) nor a and b together: the engine marks steps in those less surely
  return r.chance(0.7) ? "x" : r.pick(["y", "n", "a"]);
}

/** `a + bi` with neither part 0. */
function gaussian(r: Rng, hi: number): string {
  return complex(r.intExcept(-hi + 2, hi, [0]), r.intExcept(-hi + 2, hi - 2, [0]));
}

