/**
 * Derivatives, integrals and limits as the chat writes them (`\frac{d}{dx}(x^{3} + 2x)`,
 * `\int (3x^{2} + 1) \, dx`, `\lim_{x \to 2} \frac{x^{2} - 4}{x - 2}`): integrals built so the
 * antiderivative has whole coefficients, limits so the factor cancels.
 */
import type { FormTable } from "./form";
import type { Rng } from "./rng";
import { coef, frac, lin, poly } from "./tex";

/** `x^{n}`, with `x` for n = 1. */
function xn(n: number): string {
  return n === 1 ? "x" : `x^{${n}}`;
}

function nonzero(r: Rng, lo: number, hi: number): number {
  return r.intExcept(lo, hi, [0]);
}

export const CALCULUS: FormTable = {
  derivatives: [
    (r) => [`\\frac{d}{dx}(${poly([r.int(1, 5), nonzero(r, -6, 6), nonzero(r, -9, 9), r.int(-9, 9)])})`],
    (r) => [`\\frac{d}{dx}(${coef(r.int(1, 9), xn(r.int(2, 6)))})`],
    (r) => [`\\frac{d}{dx}(${poly([r.int(1, 4), 0, nonzero(r, -9, 9), r.int(-9, 9)])})`],
    (r) => [`\\frac{d}{dx}(${poly([r.int(1, 3), 0, nonzero(r, -5, 5), 0, r.int(-9, 9)])})`],
    (r) => {
      const fn = r.pick(["\\sin x", "\\cos x"]);
      return [`\\frac{d}{dx}(${coef(r.int(1, 6), fn)})`];
    },
    (r) => [`\\frac{d}{dx}(\\${r.pick(["sin", "cos"])} ${r.int(2, 5)}x)`],
    (r) => [`\\frac{d}{dx}(${coef(r.int(1, 5), `e^{${r.int(2, 5)}x}`)})`],
    (r) => [`\\frac{d}{dx}((${lin(r.int(2, 3), nonzero(r, -5, 5))})^{${r.int(2, 4)}})`],
    (r) => [`f(x) = ${poly([r.int(1, 5), nonzero(r, -6, 6), r.int(-9, 9)])}`, `f'(x)`],
  ],

  integrals: [
    (r) => [`\\int (${poly([3 * r.int(1, 3), 2 * nonzero(r, -4, 4), nonzero(r, -9, 9)])}) \\, dx`],
    (r) => {
      const n = r.int(1, 5);
      return [`\\int ${coef((n + 1) * r.int(1, 3), xn(n))} \\, dx`];
    },
    (r) => [`\\int (${lin(2 * r.int(1, 5), nonzero(r, -9, 9))}) \\, dx`],
    (r) => {
      const n = r.int(1, 3);
      const p = r.int(0, 2);
      const q = r.int(p + 1, 4);
      return [`\\int_{${p}}^{${q}} ${coef((n + 1) * r.int(1, 3), xn(n))} \\, dx`];
    },
    (r) => [`\\int_{0}^{${r.int(1, 3)}} (${poly([3 * r.int(1, 2), 2 * r.int(1, 4), 0])}) \\, dx`],
    (r) => [`\\int ${coef(r.int(1, 6), r.pick(["\\cos x", "\\sin x", "e^{x}"]))} \\, dx`],
  ],

  limits: [
    (r) => {
      const a = r.int(1, 9);
      return [`\\lim_{x \\to ${a}} ${frac(`x^{2} - ${a * a}`, `x - ${a}`)}`];
    },
    (r) => {
      const a = r.intExcept(-5, 6, [0]);
      const q = r.intExcept(-6, 6, [0, a]);
      return [`\\lim_{x \\to ${a}} ${frac(poly([1, -(a + q), a * q]), lin(1, -a))}`];
    },
    (r) => [`\\lim_{x \\to ${r.int(-3, 5)}} (${lin(r.int(2, 6), nonzero(r, -9, 9))})`],
    (r) => [`\\lim_{x \\to ${r.int(-3, 4)}} (${poly([1, nonzero(r, -5, 5), 0])})`],
    (r) => [`\\lim_{x \\to \\infty} ${frac(poly([r.int(1, 6), 0, nonzero(r, -9, 9)]), poly([r.int(1, 4), 0, nonzero(r, -9, 9)]))}`],
    (r) => [`\\lim_{x \\to \\infty} ${frac(lin(r.int(1, 9), nonzero(r, -9, 9)), lin(r.int(1, 6), nonzero(r, -9, 9)))}`],
    (r) => {
      const a = r.int(1, 7);
      return [`\\lim_{x \\to -${a}} ${frac(`x^{2} - ${a * a}`, `x + ${a}`)}`];
    },
  ],
};
