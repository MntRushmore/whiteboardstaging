/**
 * Geometry as the equation a student writes (`prompts/chat.ts` rule 3): angle facts (`x + 40 +
 * 65 = 180`), the Pythagorean theorem on whole-number triples, area and perimeter formulas with
 * their numbers in, circles in terms of π, and the distance and midpoint formulas.
 */
import type { FormTable } from "./form";
import type { Rng } from "./rng";
import { coef, deg, frac, lin } from "./tex";

/** Right triangles with whole sides (legs, hypotenuse). */
const TRIPLES: readonly (readonly [number, number, number])[] = [
  [3, 4, 5],
  [6, 8, 10],
  [5, 12, 13],
  [8, 15, 17],
  [9, 12, 15],
  [7, 24, 25],
  [12, 16, 20],
  [15, 20, 25],
  [10, 24, 26],
  [20, 21, 29],
];

/** Triples small enough for coordinates on a page. */
const SMALL_TRIPLES = TRIPLES.slice(0, 5);

/** A number as an angle: with the degree sign or without, the same for the whole problem. */
function angle(on: boolean): (v: number) => string {
  return (v) => (on ? deg(v) : String(v));
}

/** Legs in either order. */
function legs(r: Rng, t: readonly [number, number, number]): [number, number, number] {
  return r.chance(0.5) ? [t[0], t[1], t[2]] : [t[1], t[0], t[2]];
}

export const GEOMETRY: FormTable = {
  // with the degree sign: an angle fact reads as one (not a one-step equation) in any course
  angles: [
    // complementary, supplementary, around a point
    (r) => [`x + ${deg(r.int(10, 80))} = ${deg(90)}`],
    (r) => [`x + ${deg(r.int(20, 160))} = ${deg(180)}`],
    (r) => {
      const a = r.int(60, 150);
      return [`x + ${deg(a)} + ${deg(r.int(60, Math.min(150, 330 - a)))} = ${deg(360)}`];
    },
    (r) => {
      // vertical angles: (ax + b)° = (cx + d)°, each angle between 10° and 170°
      const x = r.int(5, 30);
      const a = r.int(2, 6);
      const c = r.intExcept(2, 6, [a]);
      const b = r.intExcept(-20, 30, [0]);
      const value = a * x + b;
      const d = value - c * x;
      return value < 10 || value > 170 || d === 0 ? null : [`${deg(`(${lin(a, b)})`)} = ${deg(`(${lin(c, d)})`)}`];
    },
    (r) => {
      // a linear pair: (ax + b)° + (cx + d)° = 180°
      const a = r.int(1, 5);
      const c = r.int(1, 5);
      const x = r.int(5, 40);
      const rest = 180 - (a + c) * x;
      if (rest < 2 || rest > 60) return null;
      const b = r.int(1, rest - 1);
      return [`${deg(`(${lin(a, b)})`)} + ${deg(`(${lin(c, rest - b)})`)} = ${deg(180)}`];
    },
    (r) => {
      // a right angle or a straight line split in a ratio
      const total = r.pick([90, 180]);
      const a = r.int(1, 5);
      const b = r.int(1, 5);
      return total % (a + b) === 0 ? [`${coef(a, "x")} + ${coef(b, "x")} = ${deg(total)}`] : null;
    },
    (r) => {
      const k = r.int(2, 4);
      const a = 180 - k * r.int(10, Math.floor(170 / k));
      return a <= 0 ? null : [`${k}x + ${deg(a)} = ${deg(180)}`];
    },
  ],

  triangles: [
    (r) => {
      const d = angle(r.chance(0.5));
      const a = r.int(20, 100);
      const b = r.int(20, Math.min(100, 160 - a));
      return [`x + ${d(a)} + ${d(b)} = ${d(180)}`];
    },
    (r) => {
      const d = angle(r.chance(0.5));
      return [`x + ${d(r.int(15, 75))} + ${d(90)} = ${d(180)}`];
    },
    (r) => {
      const d = angle(r.chance(0.5));
      return [`x + x + ${d(2 * r.int(10, 70))} = ${d(180)}`];
    },
    (r) => {
      const a = r.int(1, 5);
      const b = r.int(1, 5);
      const c = r.int(1, 5);
      return 180 % (a + b + c) === 0 && a + b + c >= 3 ? [`${coef(a, "x")} + ${coef(b, "x")} + ${coef(c, "x")} = 180`] : null;
    },
    (r) => {
      const x = r.int(10, 35);
      const rest = 180 - 4 * x;
      const a = r.int(1, 40);
      const b = rest - a;
      if (b === 0 || x + a <= 0 || 2 * x + b <= 0) return null;
      return [`(${lin(1, a)}) + (${lin(2, b)}) + x = 180`];
    },
  ],

  pythagorean: [
    (r) => {
      const [a, b] = legs(r, r.pick(TRIPLES));
      return [`${a}^{2} + ${b}^{2} = c^{2}`];
    },
    (r) => {
      const [a, b, c] = legs(r, r.pick(TRIPLES));
      return [r.chance(0.5) ? `a^{2} + ${b}^{2} = ${c}^{2}` : `${a}^{2} + b^{2} = ${c}^{2}`];
    },
    (r) => {
      const [a, b] = legs(r, r.pick(TRIPLES));
      return [`c^{2} = ${a}^{2} + ${b}^{2}`];
    },
    (r) => {
      const [a, , c] = legs(r, r.pick(TRIPLES));
      return [r.chance(0.5) ? `x^{2} + ${a}^{2} = ${c}^{2}` : `${a}^{2} + x^{2} = ${c}^{2}`];
    },
  ],

  area_perimeter: [
    (r) => [`A = ${r.int(2, 15)} \\times ${r.int(2, 12)}`],
    (r) => [`P = 2(${r.int(2, 20)}) + 2(${r.int(2, 15)})`],
    (r) => {
      const b = r.int(2, 16);
      const h = r.int(2, 12);
      return (b * h) % 2 === 0 ? [`A = ${frac(1, 2)} \\cdot ${b} \\cdot ${h}`] : null;
    },
    (r) => [`A = ${r.int(2, 15)}^{2}`],
    (r) => [`P = 4 \\times ${r.int(2, 25)}`],
    (r) => {
      const a = r.int(2, 12);
      const b = r.intExcept(2, 14, [a]);
      const h = r.int(2, 10);
      return ((a + b) * h) % 2 === 0 ? [`A = ${frac(1, 2)}(${a} + ${b}) \\cdot ${h}`] : null;
    },
  ],

  circles: [
    (r) => [`C = 2\\pi \\cdot ${r.int(2, 12)}`],
    (r) => [`A = \\pi \\cdot ${r.int(2, 10)}^{2}`],
    (r) => [`\\pi r^{2} = ${r.int(2, 12) ** 2}\\pi`],
    (r) => [`2\\pi r = ${2 * r.int(2, 12)}\\pi`],
    (r) => [`C = \\pi \\cdot ${r.int(2, 20)}`],
    (r) => [`A = \\pi r^{2}`, `r = ${r.int(2, 10)}`],
    (r) => [`C = 2\\pi r`, `r = ${r.int(2, 12)}`],
  ],

  coordinate_geometry: [
    (r) => {
      const [a, b] = legs(r, r.pick(SMALL_TRIPLES));
      const x1 = r.int(0, 6);
      const y1 = r.int(0, 6);
      return [`d = \\sqrt{(${x1 + a} - ${x1})^{2} + (${y1 + b} - ${y1})^{2}}`];
    },
    (r) => {
      const x1 = r.int(0, 9);
      const y1 = r.int(0, 9);
      const x2 = x1 + 2 * r.int(1, 5);
      const y2 = y1 + 2 * r.int(1, 5);
      return [`M = \\left(${frac(`${x1} + ${x2}`, 2)}, ${frac(`${y1} + ${y2}`, 2)}\\right)`];
    },
  ],
};
