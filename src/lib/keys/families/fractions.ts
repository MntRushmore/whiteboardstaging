/**
 * Fractions (docs/KEYS.md, Phase 3): adding like and unlike fractions (`2/7 + 3/7`, `3/4 + 1/6`) and
 * equivalent fractions (`3/4 = ?/12`), stacked on the page. The kid types a numerator, `/` stacks it
 * and goes to the denominator, arrows move between them.
 */
import type { SkillId } from "@/lib/learning/contracts";
import type { Rng } from "@/lib/learning/generators/rng";
import { gcd, type Cell, type Frac, type FracPart, type MathItem } from "../item";

export function lcm(a: number, b: number): number {
  return (a / gcd(a, b)) * b;
}

function given(id: string, f: Frac): FracPart {
  return {
    id,
    num: { id: `${id}n`, role: "given", place: 0, value: String(f.n) },
    den: { id: `${id}d`, role: "given", place: 1, value: String(f.d) },
  };
}

function kidCell(id: string, place: number, expect: string): Cell {
  return { id, role: "blank", place, expect, width: 3 };
}

const show = (f: Frac) => `${f.n}/${f.d}`;

/** The sum written over the common denominator (the least one), not simplified further: `11/12`, `5/7`. */
export function fractionSum(left: Frac, right: Frac): Frac {
  const d = lcm(left.d, right.d);
  return { n: left.n * (d / left.d) + right.n * (d / right.d), d };
}

/** `left + right = ?/?`: the kid writes the sum's numerator and denominator. */
export function fractionSumItem(left: Frac, right: Frac): MathItem {
  const sum = fractionSum(left, right);
  const like = left.d === right.d;
  const skill: SkillId = like ? "add_fractions_like" : "add_fractions_unlike";
  const text = `${show(left)} + ${show(right)}`;
  return {
    id: `frac:${text.replace(/\s+/g, "")}`,
    skill,
    kind: "fraction_sum",
    text,
    words: `${left.n} over ${left.d} plus ${right.n} over ${right.d}`,
    addends: [],
    total: sum.n / sum.d,
    answer: show(sum),
    math: { kind: "fractions", op: "+", left, right },
    layout: {
      kind: "fraction",
      parts: [given("f0", left), "+", given("f1", right), "=", { id: "f2", num: kidCell("rn", 0, String(sum.n)), den: kidCell("rd", 1, String(sum.d)) }],
    },
  };
}

/** `from = ?/to`: the kid finds the numerator. */
export function equivalentItem(from: Frac, to: number): MathItem {
  if (to % from.d !== 0) throw new Error("equivalentItem: the new denominator must be a multiple");
  const n = from.n * (to / from.d);
  const text = `${show(from)} = ?/${to}`;
  return {
    id: `eqv:${show(from)}=?/${to}`,
    skill: "equivalent_fractions",
    kind: "equivalent",
    text,
    words: `${from.n} over ${from.d} equals blank over ${to}`,
    addends: [],
    total: n,
    answer: String(n),
    math: { kind: "equivalent", from, to },
    layout: {
      kind: "fraction",
      parts: [given("f0", from), "=", { id: "f1", num: kidCell("rn", 0, String(n)), den: { id: "f1d", role: "given", place: 1, value: String(to) } }],
    },
  };
}

/** Like fractions with a proper sum: `2/7 + 3/7`. */
export function likePair(r: Rng): [Frac, Frac] {
  const d = r.int(5, 12);
  const a = r.int(1, d - 2);
  const c = r.int(1, d - 1 - a);
  return [
    { n: a, d },
    { n: c, d },
  ];
}

/** Unlike fractions with a small common denominator and a proper sum: `3/4 + 1/6`. */
export function unlikePair(r: Rng): [Frac, Frac] {
  const pairs: [number, number][] = [
    [2, 3], [2, 5], [3, 4], [4, 6], [2, 6], [3, 6], [4, 8], [6, 8], [3, 5], [5, 10], [4, 10], [6, 9],
  ];
  for (let i = 0; i < 100; i++) {
    const [d1, d2] = pairs[r.int(0, pairs.length - 1)];
    const a = r.int(1, d1 - 1);
    const c = r.int(1, d2 - 1);
    if (gcd(a, d1) !== 1 || gcd(c, d2) !== 1) continue;
    const sum = fractionSum({ n: a, d: d1 }, { n: c, d: d2 });
    if (sum.n >= sum.d) continue;
    return [
      { n: a, d: d1 },
      { n: c, d: d2 },
    ];
  }
  return [
    { n: 3, d: 4 },
    { n: 1, d: 6 },
  ];
}

/** An equivalent fraction to find: `3/4 = ?/12` (the factor 2 to 4, never the numerator itself). */
export function equivalentPair(r: Rng): [Frac, number] {
  for (let i = 0; i < 100; i++) {
    const d = r.int(2, 6);
    const n = r.int(1, d - 1);
    const k = r.int(2, 4);
    if (gcd(n, d) !== 1 || k === n) continue;
    return [{ n, d }, d * k];
  }
  return [{ n: 3, d: 4 }, 12];
}
