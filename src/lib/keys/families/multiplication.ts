/**
 * Multiplying (docs/KEYS.md, Phase 3), in columns:
 *
 *  - a fact or a multiple of ten by one digit (`6 × 7`, `40 × 6`, `46 × 7`): the number, `× b`, a
 *    carry row over it (optional cells: the tens carried from each place), the product;
 *  - by a 2-digit number (`34 × 26`): two partial rows (`34 × 6 = 204`, `34 × 20 = 680`, the 0 in its
 *    ones is the placeholder) and the sum under them.
 */
import type { SkillId } from "@/lib/learning/contracts";
import type { Rng } from "@/lib/learning/generators/rng";
import { digitAt, digitCount, type Cell, type ColumnLine, type MathItem } from "../item";
import { digitsOf, givenRow, kidRow } from "./columns";

/** The carry into each place when `a` is multiplied by the one digit `d`, ones first (place 0 is 0). */
export function multiplyCarries(a: number, d: number): number[] {
  const ds = digitsOf(a);
  const carries = [0];
  let carry = 0;
  for (let p = 0; p < ds.length; p++) {
    const v = ds[p] * d + carry;
    carry = Math.floor(v / 10);
    carries.push(carry);
  }
  return carries;
}

function skillFor(a: number, b: number): SkillId {
  if (b >= 10) return "multiply_multi_digit";
  if (a <= 12) return "times_tables";
  if (a % 10 === 0 && digitCount(a) <= 4) return "multiply_by_tens";
  return "multiply_multi_digit";
}

/** `a × b` in columns. `b` up to two digits; `a` up to four. */
export function productItem(a: number, b: number): MathItem {
  if (b < 0 || a < 0 || b > 99) throw new Error("productItem: b is at most two digits");
  const total = a * b;
  const twoRows = b >= 10;
  const places = Math.max(digitCount(a), digitCount(b), digitCount(total)) + (twoRows ? 0 : 1);
  const lines: ColumnLine[] = [];
  if (!twoRows) {
    const carries = multiplyCarries(a, b);
    const cells: (Cell | null)[] = [];
    for (let p = places - 1; p >= 0; p--) {
      cells.push(p >= 1 && p < digitCount(a) ? { id: `c${p}`, role: "carry", place: p, ...(carries[p] ? { expect: String(carries[p]) } : {}) } : null);
    }
    // a one-digit number has nothing to carry over it: no row
    if (cells.some((c) => c !== null)) lines.push({ id: "carry", role: "carry", cells });
  }
  lines.push(givenRow("a", a, places), givenRow("b", b, places, "×"));
  if (twoRows) {
    const ones = a * digitAt(b, 0);
    const tens = a * digitAt(b, 1) * 10;
    lines.push(kidRow("p0", ones, places, "partial", undefined, "p0_"), kidRow("p1", tens, places, "partial", "+", "p1_"));
  }
  lines.push(kidRow("result", total, places, "result", undefined, "r"));
  const text = `${a} × ${b}`;
  return {
    id: `mul:${a}x${b}`,
    skill: skillFor(a, b),
    kind: "product",
    text,
    words: `${a} times ${b}`,
    addends: [a, b],
    total,
    answer: String(total),
    math: { kind: "multiply", a, b },
    layout: { kind: "columns", places, lines },
  };
}

/** Times-table facts, 2 to 9 each side, never × 1 or the same twice in a row. */
export function factPair(r: Rng): [number, number] {
  return [r.int(3, 9), r.int(3, 9)];
}

/** A multiple of ten by one digit: `40 × 6`, `300 × 4`. */
export function tensPair(r: Rng): [number, number] {
  const zeros = r.int(1, 2);
  return [r.int(2, 9) * 10 ** zeros, r.int(2, 9)];
}

/** Two digits by one with a carry (`46 × 7`), or by two (`34 × 26`). */
export function multiDigitPair(r: Rng, two: boolean): [number, number] {
  for (let i = 0; i < 100; i++) {
    const a = r.int(12, two ? 49 : 89);
    const b = two ? r.int(12, 39) : r.int(3, 9);
    if (a % 10 === 0 || b % 10 === 0) continue;
    if (!two && Math.floor(((a % 10) * b) / 10) === 0) continue;
    return [a, b];
  }
  return two ? [34, 26] : [46, 7];
}
