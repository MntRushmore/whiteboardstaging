/**
 * Multiplying's buggy rules (docs/KEYS.md, Phase 3): the times table's slips, the zeros of a multiple
 * of ten, the carry and the placeholder zero.
 */
import type { MistakeKind } from "@/lib/learning/hint";
import { digitAt, digitCount, type MathItem } from "../item";
import { digitsOf } from "../families/columns";
import type { BugRule } from "./types";

function ab(item: MathItem): { a: number; b: number } | null {
  return item.kind === "product" && item.math?.kind === "multiply" ? { a: item.math.a, b: item.math.b } : null;
}

const isFact = (a: number, b: number) => a <= 12 && b <= 12;

/** Multiplies place by place, writing each place's whole product at the top and its ones elsewhere, the carry dropped. */
function dropCarry(a: number, d: number): string {
  const ds = digitsOf(a);
  const top = ds.length - 1;
  return String(ds[top] * d) + ds.slice(0, top).map((x) => String((x * d) % 10)).reverse().join("");
}

/** Adds the carry to the next digit before multiplying it. */
function carryFirst(a: number, d: number): string {
  const ds = digitsOf(a);
  let carry = 0;
  let out = "";
  for (let p = 0; p < ds.length; p++) {
    const v = (ds[p] + carry) * d;
    out = (p === ds.length - 1 ? String(v) : String(v % 10)) + out;
    carry = Math.floor(v / 10);
  }
  return out;
}

function stripZeros(n: number): number {
  let m = n;
  while (m > 0 && m % 10 === 0) m /= 10;
  return m;
}

function rule(id: BugRule["id"], label: string, mistake: MistakeKind, produce: BugRule["produce"]): BugRule {
  return { id, area: "multiplication", label, mistake, produce };
}

export const MULTIPLICATION_BUGS: readonly BugRule[] = [
  rule("mul_added_instead", "Added instead of multiplying", "concept", (item) => {
    const m = ab(item);
    return m && m.b < 10 ? String(m.a + m.b) : null;
  }),
  rule("mul_one_group_short", "Counted one group too few", "arithmetic", (item) => {
    const m = ab(item);
    return m && isFact(m.a, m.b) ? String(m.a * (m.b - 1)) : null;
  }),
  rule("mul_one_group_over", "Counted one group too many", "arithmetic", (item) => {
    const m = ab(item);
    return m && isFact(m.a, m.b) ? String(m.a * (m.b + 1)) : null;
  }),
  rule("mul_tens_dropped_zero", "Left out the zeros of a multiple of ten", "concept", (item) => {
    const m = ab(item);
    return m && m.a % 10 === 0 && m.b < 10 ? String(stripZeros(m.a) * m.b) : null;
  }),
  rule("mul_tens_extra_zero", "Wrote one zero too many", "concept", (item) => {
    const m = ab(item);
    return m && m.a % 10 === 0 && m.b < 10 ? String(m.a * m.b * 10) : null;
  }),
  rule("mul_forgot_carry", "Forgot to add the carried tens", "arithmetic", (item) => {
    const m = ab(item);
    return m && m.b < 10 && digitCount(m.a) >= 2 && m.a % 10 !== 0 ? dropCarry(m.a, m.b) : null;
  }),
  rule("mul_carry_added_first", "Added the carry before multiplying", "arithmetic", (item) => {
    const m = ab(item);
    return m && m.b < 10 && digitCount(m.a) >= 2 && m.a % 10 !== 0 ? carryFirst(m.a, m.b) : null;
  }),
  rule("mul_no_placeholder", "Forgot the placeholder zero", "concept", (item) => {
    const m = ab(item);
    return m && m.b >= 10 ? String(m.a * digitAt(m.b, 0) + m.a * digitAt(m.b, 1)) : null;
  }),
  rule("mul_ones_only", "Multiplied by the ones digit only", "concept", (item) => {
    const m = ab(item);
    return m && m.b >= 10 ? String(m.a * digitAt(m.b, 0)) : null;
  }),
  rule("mul_column_by_column", "Multiplied tens by tens and ones by ones", "concept", (item) => {
    const m = ab(item);
    return m && m.b >= 10 && digitCount(m.a) === 2 ? String(digitAt(m.a, 1) * digitAt(m.b, 1)) + String(digitAt(m.a, 0) * digitAt(m.b, 0)) : null;
  }),
];
