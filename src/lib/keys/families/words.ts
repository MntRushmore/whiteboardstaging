/**
 * The tutor's words for Phase 3's families (docs/KEYS.md): a nudge (Help me's first rung) and a
 * worked step (its third), from the item, the named bug and the cell that broke. Short and sure,
 * full stops, US English, never "wrong". `copy.ts` asks these first for an item with `math`.
 */
import type { BugId } from "../bugs";
import { cellById, digitAt, digitCount, placeName, type MathItem } from "../item";
import { digitsOf } from "./columns";
import { lcm } from "./fractions";
import { multiplyCarries } from "./multiplication";
import { needsBorrow, regrouped } from "./subtraction";

const S = ["one", "ten", "hundred", "thousand"] as const;

function brokenPlace(item: MathItem, cellId?: string): number | null {
  const c = cellId ? cellById(item, cellId) : undefined;
  return c && !c.spare && c.role !== "given" ? c.place : null;
}

function brokenLine(item: MathItem, cellId?: string): string | null {
  if (!cellId || item.layout.kind !== "columns") return null;
  return item.layout.lines.find((l) => l.cells.some((c) => c?.id === cellId))?.id ?? null;
}

// ---------------------------------------------------------------- nudges

export function nudgeFamily(item: MathItem, bug: BugId | null): string | null {
  const m = item.math;
  if (!m) return null;
  switch (m.kind) {
    case "subtract": {
      const t = digitsOf(m.top);
      const b = digitsOf(m.bottom, t.length);
      const p = Math.max(0, t.findIndex((_, i) => needsBorrow(m.top, m.bottom, i)));
      switch (bug) {
        case "sub_smaller_from_larger":
          return `In the ${placeName(p)}, the top is ${t[p]}. Take ${b[p]} from ${t[p]}, not ${t[p]} from ${b[p]}.`;
        case "sub_forgot_borrow":
          return `${t[p]} is less than ${b[p]}. Regroup: 1 ${S[p + 1]} is 10 ${placeName(p)}.`;
        case "sub_borrow_no_reduce":
          return `The ${placeName(p + 1)} gave 1 away. Is it still ${t[p + 1]}?`;
        case "sub_borrow_across_zero":
          return "The 0 has nothing to give yet. It gets 10 from the next place first.";
        case "sub_added_instead":
          return "Look at the sign. It says take away.";
        default:
          return needsBorrow(m.top, m.bottom, 0) ? `Start with the ones. Can you take ${b[0]} from ${t[0]}?` : `Start with the ones. What is ${t[0]} − ${b[0]}?`;
      }
    }
    case "multiply": {
      const { a, b } = m;
      const carries = multiplyCarries(a, b % 10);
      const top = digitCount(a) - 1;
      const tens = digitAt(b, 1);
      switch (bug) {
        case "mul_added_instead":
          return `Look at the sign. ${a} × ${b} means ${a} groups of ${b}.`;
        case "mul_one_group_short":
        case "mul_one_group_over":
          return `Count the groups again. ${a} × ${b} is ${a} groups of ${b}.`;
        case "mul_tens_dropped_zero":
          return `${a} is tens, not ones. Where do the tens go?`;
        case "mul_tens_extra_zero":
          return `Count the zeros in ${a} again.`;
        case "mul_forgot_carry":
          return `Did you add the ${carries[top] || 1} you carried?`;
        case "mul_carry_added_first":
          return `Multiply first. Then add the ${carries[top] || 1} you carried.`;
        case "mul_no_placeholder":
          return `The ${tens} in ${b} is ${tens} tens. Start that row with a 0.`;
        case "mul_ones_only":
          return `That is ${a} × ${digitAt(b, 0)}. Now do ${a} × ${tens * 10} on the next row.`;
        case "mul_column_by_column":
          return `Multiply all of ${a} by each digit of ${b}. One row each.`;
        default:
          if (a <= 12 && b <= 12) return `Think of ${a} groups of ${b}.`;
          return `Start with the ones: ${digitAt(a, 0)} × ${digitAt(b, 0)}.`;
      }
    }
    case "fractions": {
      const L = lcm(m.left.d, m.right.d);
      const like = m.left.d === m.right.d;
      switch (bug) {
        case "frac_added_denominators":
        case "frac_multiplied_denominators":
          return like ? "The bottom says how big the parts are. It stays the same." : "Make the bottoms the same first. Then add only the tops.";
        case "frac_not_scaled_numerator":
          return `If the bottom changes, the top changes too. ${m.left.n}/${m.left.d} is ?/${L}.`;
        default:
          return like ? "Same bottoms: add the tops." : `Find a bottom both can make. Try ${L}.`;
      }
    }
    case "equivalent": {
      const k = m.to / m.from.d;
      switch (bug) {
        case "eqv_added_same":
          return "Equal fractions grow by times, not by plus.";
        case "eqv_copied_numerator":
          return "The parts got smaller, so you need more of them.";
        case "eqv_wrote_factor":
          return `${k} is how many times bigger. Multiply the top by it.`;
        default:
          return `How many times bigger is ${m.to} than ${m.from.d}?`;
      }
    }
    case "equation": {
      const L = m.letter;
      switch (bug) {
        case "eq_same_operation":
          return m.form === "ax" ? `To undo times ${m.a}, divide by ${m.a}.` : m.form === "x-a" ? `To undo − ${m.a}, add ${m.a}.` : `To undo + ${m.a}, take ${m.a} away.`;
        case "eq_sign_error":
          return `Take ${m.a} away from ${m.b}, not ${m.b} from ${m.a}.`;
        case "eq_subtracted_coefficient":
          return `${m.a}${L} means ${m.a} times ${L}. Undo it by dividing.`;
        default:
          return m.form === "ax" ? `What times ${m.a} makes ${m.b}?` : m.form === "x-a" ? `What number take away ${m.a} leaves ${m.b}?` : `What number plus ${m.a} makes ${m.b}?`;
      }
    }
  }
}

// ---------------------------------------------------------------- worked steps

export function workedFamily(item: MathItem, bug: BugId | null, cellId?: string): string | null {
  const m = item.math;
  if (!m) return null;
  switch (m.kind) {
    case "subtract": {
      const t = digitsOf(m.top);
      const b = digitsOf(m.bottom, t.length);
      const { digits } = regrouped(m.top, m.bottom);
      const firstBorrow = t.findIndex((_, i) => needsBorrow(m.top, m.bottom, i));
      let p = brokenPlace(item, cellId) ?? (firstBorrow >= 0 ? firstBorrow : 0);
      if (bug === "sub_borrow_no_reduce" && brokenPlace(item, cellId) === null && firstBorrow >= 0) p = firstBorrow + 1;
      if (p >= t.length) p = 0;
      const v = digits[p] - b[p];
      const how = digits[p] !== t[p] ? `After regrouping, the ${placeName(p)} have ${digits[p]}. ` : "";
      return `${how}${digits[p]} − ${b[p]} = ${v}. Write the ${v} in the ${placeName(p)}.`;
    }
    case "multiply": {
      const { a, b } = m;
      if (b >= 10) {
        const p0 = a * digitAt(b, 0);
        const p1 = a * digitAt(b, 1) * 10;
        const line = brokenLine(item, cellId);
        if (line === "p0") return `${a} × ${digitAt(b, 0)} = ${p0}. Write it on the first row.`;
        if (line === "result") return `${p0} + ${p1} = ${p0 + p1}.`;
        return `${a} × ${digitAt(b, 1) * 10} = ${p1}. The 0 holds the ones place.`;
      }
      if (a % 10 === 0) {
        let d = a;
        while (d % 10 === 0) d /= 10;
        return `${d} × ${b} = ${d * b}. So ${a} × ${b} = ${a * b}.`;
      }
      if (a <= 12) {
        const split = b > 5 ? 5 : Math.max(1, b - 1);
        return `${a} × ${split} = ${a * split}. ${a} × ${b - split} = ${a * (b - split)}. ${a * split} + ${a * (b - split)} = ${a * b}.`;
      }
      const carries = multiplyCarries(a, b);
      const p = brokenPlace(item, cellId) ?? digitCount(a) - 1;
      const top = digitCount(a) - 1;
      const q = Math.min(p, top);
      const d = digitAt(a, q);
      const v = d * b + carries[q];
      const plus = carries[q] ? ` + ${carries[q]}` : "";
      return q === top ? `${d} × ${b}${plus} = ${v}. Write ${v} in front.` : `${d} × ${b}${plus} = ${v}. Write the ${v % 10} in the ${placeName(q)}. Carry the ${Math.floor(v / 10)}.`;
    }
    case "fractions": {
      const L = lcm(m.left.d, m.right.d);
      const n1 = m.left.n * (L / m.left.d);
      const n2 = m.right.n * (L / m.right.d);
      const scale = m.left.d === m.right.d ? "" : `${m.left.n}/${m.left.d} = ${n1}/${L}. ${m.right.n}/${m.right.d} = ${n2}/${L}. `;
      return `${scale}${n1}/${L} + ${n2}/${L} = ${n1 + n2}/${L}.`;
    }
    case "equivalent": {
      const k = m.to / m.from.d;
      return `${m.from.d} × ${k} = ${m.to}. So the top is ${m.from.n} × ${k} = ${m.from.n * k}.`;
    }
    case "equation": {
      const L = m.letter;
      if (m.form === "ax") return `${L} = ${m.b} ÷ ${m.a} = ${m.x}.`;
      if (m.form === "x-a") return `${L} = ${m.b} + ${m.a} = ${m.x}.`;
      return `${L} = ${m.b} − ${m.a} = ${m.x}.`;
    }
  }
}
