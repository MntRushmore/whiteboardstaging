/**
 * Phase 3's smaller problems (docs/KEYS.md, "Breadth"): for each named bug, the one step the kid
 * missed, as a line with a box, a manipulative when one helps, and where its answer goes back up.
 *
 *  - taking away: the place that needs a regroup (`12 − 7 = ?`, base-ten blocks), the place that lent
 *    (`5 − 1 − 2 = ?`), the zero that lends (`10 − 1 − 2 = ?`);
 *  - multiplying: a fact split in two (`30 + 12 = ?`, an area model), a multiple of ten
 *    (`4 × 6 = ?` tens, an area model), the carry (`4 × 7 + 4 = ?`), the placeholder zero (`34 × 20 = ?`);
 *  - fractions: the tops over the common bottom (`9 + 2 = ?` twelfths, fraction bars), an equivalent
 *    fraction's top (`3 × 3 = ?`, two bars);
 *  - equations: undoing the step (`15 − 7 = ?`, a number line), its answer into the answer row.
 */
import type { SkillId } from "@/lib/learning/contracts";
import type { BugId } from "../bugs";
import { ANSWER_LINE } from "../check";
import { cellById, digitAt, digitCount, FRACTION_LINE, lineFact, placeName, type Cell, type ColumnsLayout, type MathItem } from "../item";
import type { SubStep } from "../shrink";
import { digitsOf } from "./columns";
import { lcm } from "./fractions";
import { multiplyCarries } from "./multiplication";
import { needsBorrow, regrouped } from "./subtraction";

/** The result row's cells from `place` up (a value of several digits goes into them, lowest place first). */
function resultFrom(item: MathItem, place: number, line = "result"): string[] {
  if (item.layout.kind !== "columns") return [];
  const row = (item.layout as ColumnsLayout).lines.find((l) => l.id === line);
  return (row?.cells ?? [])
    .filter((c): c is Cell => c !== null && c.role !== "given" && c.place >= place)
    .sort((a, b) => a.place - b.place)
    .map((c) => c.id);
}

function resultCell(item: MathItem, place: number): string | null {
  return resultFrom(item, place)[0] ?? null;
}

/** The place of the cell that broke, when it is in the result row. */
function brokenPlace(item: MathItem, cellId?: string): number | null {
  const c = cellId ? cellById(item, cellId) : undefined;
  return c && c.id.startsWith("r") && !c.spare ? c.place : null;
}

const SINGULAR = ["one", "ten", "hundred", "thousand"] as const;

/** Spare cells over a result, to clear when the tutor writes a value back (`2400` → `240`). */
function clearSpares(item: MathItem): Record<string, string> {
  if (item.layout.kind !== "columns") return {};
  const row = item.layout.lines.find((l) => l.id === "result");
  return Object.fromEntries((row?.cells ?? []).filter((c): c is Cell => c !== null && c.spare === true).map((c) => [c.id, ""]));
}

// ---------------------------------------------------------------- taking away

function shrinkSubtract(item: MathItem, bug: BugId, cellId?: string): SubStep | null {
  if (item.math?.kind !== "subtract") return null;
  const { top, bottom } = item.math;
  const t = digitsOf(top);
  const b = digitsOf(bottom, t.length);
  const { digits } = regrouped(top, bottom);
  const skill: SkillId = "subtract_within_20";
  const firstBorrow = t.findIndex((_, p) => needsBorrow(top, bottom, p));
  if (firstBorrow < 0) return null;

  if (bug === "sub_smaller_from_larger" || bug === "sub_forgot_borrow") {
    const broken = brokenPlace(item, cellId);
    const p = broken !== null && needsBorrow(top, bottom, broken) ? broken : firstBorrow;
    const target = resultCell(item, p);
    if (!target) return null;
    const have = t[p] + 10;
    const answer = have - b[p];
    return {
      bug,
      lead: "regroup",
      leadText: `1 ${SINGULAR[p + 1]} is 10 ${placeName(p)}. ${t[p]} ${placeName(p)} become ${have}.`,
      item: lineFact([have, "−", b[p], "=", "?"], answer, skill),
      manipulative: { kind: "base_ten", unit: p === 0 ? "one" : "ten", groups: [{ count: 10, carried: true }, { count: t[p], op: "+" }, { count: b[p], op: "−" }, { count: answer, box: true, op: "=" }] },
      target: { cellId: target, place: p },
      under: "result",
    };
  }

  if (bug === "sub_borrow_no_reduce") {
    // the place that lent: one less than it was, then take the bottom digit
    const q = firstBorrow + 1;
    if (q >= t.length || t[q] === 0) return null;
    const target = resultCell(item, q);
    if (!target) return null;
    const answer = digits[q] - b[q];
    if (answer < 0) return null;
    return {
      bug,
      lead: "regroup_lent",
      leadText: `The ${placeName(q)} gave 1 to the ${placeName(firstBorrow)}. ${t[q]} − 1 = ${t[q] - 1}.`,
      item: lineFact([t[q], "−", 1, "−", b[q], "=", "?"], answer, skill),
      manipulative: { kind: "base_ten", unit: q === 1 ? "ten" : "one", groups: [{ count: t[q] }, { count: 1, carried: true, op: "−" }, { count: b[q], op: "−" }, { count: answer, box: true, op: "=" }] },
      target: { cellId: target, place: q },
      under: "result",
    };
  }

  if (bug === "sub_borrow_across_zero") {
    // the zeros became 9s; the place past them that really lends still has its 1 to give
    let q = firstBorrow + 1;
    while (q < t.length && t[q] === 0) q++;
    if (q >= t.length || q === firstBorrow + 1) return null;
    const target = resultCell(item, q);
    if (!target) return null;
    const answer = t[q] - 1 - b[q];
    if (answer < 0) return null;
    return {
      bug,
      lead: "regroup_zero",
      leadText: `The 0 ${placeName(q - 1)} have nothing to give, so the ${placeName(q)} give 1. ${t[q]} − 1 = ${t[q] - 1}.`,
      item: lineFact([t[q], "−", 1, "−", b[q], "=", "?"], answer, skill),
      manipulative: { kind: "base_ten", unit: q === 1 ? "ten" : "one", groups: [{ count: t[q] }, { count: 1, carried: true, op: "−" }, { count: b[q], op: "−" }, { count: answer, box: true, op: "=" }] },
      target: { cellId: target, place: q },
      under: "result",
    };
  }
  return null;
}

// ---------------------------------------------------------------- multiplying

function shrinkMultiply(item: MathItem, bug: BugId, cellId?: string): SubStep | null {
  if (item.math?.kind !== "multiply") return null;
  const { a, b } = item.math;
  void cellId;

  if ((bug === "mul_added_instead" || bug === "mul_one_group_short" || bug === "mul_one_group_over") && a <= 12 && b <= 12) {
    // a × b as two easy parts: a × 5 and a × (b − 5) (or a × (b − 1) and a × 1 for a small b)
    const split = b > 5 ? 5 : b - 1;
    if (split < 1) return null;
    const left = a * split;
    const right = a * (b - split);
    const spill = resultFrom(item, 0);
    return {
      bug,
      lead: "times_split",
      leadText: `${a} × ${b} is ${a} × ${split} and ${a} × ${b - split}.`,
      item: lineFact([left, "+", right, "=", "?"], a * b, "times_tables"),
      manipulative: { kind: "area", rows: a, cols: b, split },
      target: { cellId: spill[0], place: 0, spill, also: clearSpares(item) },
      under: "result",
    };
  }

  if ((bug === "mul_tens_dropped_zero" || bug === "mul_tens_extra_zero") && a % 10 === 0) {
    let zeros = 0;
    let d = a;
    while (d % 10 === 0) {
      d /= 10;
      zeros++;
    }
    const spill = resultFrom(item, zeros).filter((id) => !cellById(item, id)?.spare);
    const zeroCells = resultFrom(item, 0).slice(0, zeros);
    return {
      bug,
      lead: "times_tens",
      leadText: `${a} is ${d} ${zeros === 1 ? "tens" : "hundreds"}. ${d} × ${b} = ? ${zeros === 1 ? "tens" : "hundreds"}.`,
      item: lineFact([d, "×", b, "=", "?"], d * b, "times_tables"),
      manipulative: d <= 9 ? { kind: "area", rows: d, cols: b, split: 0 } : null,
      target: { cellId: spill[0], place: zeros, spill, also: { ...clearSpares(item), ...Object.fromEntries(zeroCells.map((id) => [id, "0"])) } },
      under: "result",
    };
  }

  if ((bug === "mul_forgot_carry" || bug === "mul_carry_added_first") && b < 10) {
    // only the top digit: its product and the carry are written whole
    const top = digitCount(a) - 1;
    const carry = multiplyCarries(a, b)[top];
    if (!carry) return null;
    const d = digitAt(a, top);
    const spill = resultFrom(item, top);
    return {
      bug,
      lead: "times_carry",
      leadText: `You carried ${carry}. ${d} × ${b} first, then add the ${carry}.`,
      item: lineFact([d, "×", b, "+", carry, "=", "?"], d * b + carry, "times_tables"),
      manipulative: null,
      target: { cellId: spill[0], place: top, spill, also: clearSpares(item) },
      under: "result",
    };
  }

  if ((bug === "mul_no_placeholder" || bug === "mul_ones_only") && b >= 10) {
    const tens = digitAt(b, 1);
    const value = a * tens * 10;
    const spill = resultFrom(item, 0, "p1");
    if (!spill.length) return null;
    return {
      bug,
      lead: "times_placeholder",
      leadText: `The ${tens} in ${b} is ${tens} tens. ${a} × ${tens * 10} = ?`,
      item: lineFact([a, "×", tens * 10, "=", "?"], value, "multiply_by_tens"),
      manipulative: null,
      target: { cellId: spill[0], place: 0, spill: spill.slice(0, String(value).length) },
      under: "p1",
    };
  }
  return null;
}

// ---------------------------------------------------------------- fractions

const DEN_NAMES: Readonly<Record<number, string>> = {
  2: "halves", 3: "thirds", 4: "fourths", 5: "fifths", 6: "sixths", 7: "sevenths", 8: "eighths", 9: "ninths", 10: "tenths", 12: "twelfths",
};

export function denominatorName(d: number): string {
  return DEN_NAMES[d] ?? `${d}ths`;
}

function shrinkFractions(item: MathItem, bug: BugId): SubStep | null {
  const m = item.math;
  if (m?.kind === "fractions" && (bug === "frac_added_denominators" || bug === "frac_not_scaled_numerator" || bug === "frac_multiplied_denominators")) {
    const L = lcm(m.left.d, m.right.d);
    const n1 = m.left.n * (L / m.left.d);
    const n2 = m.right.n * (L / m.right.d);
    const like = m.left.d === m.right.d;
    const name = denominatorName(L);
    return {
      bug,
      lead: like ? "fraction_same" : "fraction_common",
      leadText: like
        ? `${name[0].toUpperCase()}${name.slice(1)} stay ${name}. Add the tops: ${n1} + ${n2}.`
        : `${m.left.n}/${m.left.d} is ${n1}/${L}. ${m.right.n}/${m.right.d} is ${n2}/${L}. Add the tops.`,
      item: lineFact([n1, "+", n2, "=", "?"], n1 + n2, like ? "add_fractions_like" : "add_fractions_unlike"),
      manipulative: { kind: "fraction_bar", parts: L, shaded: [{ count: n1 }, { count: n2, carried: true }] },
      target: { cellId: "rn", place: 0, also: { rd: String(L) } },
      under: FRACTION_LINE,
    };
  }
  if (m?.kind === "equivalent" && (bug === "eqv_added_same" || bug === "eqv_copied_numerator" || bug === "eqv_wrote_factor")) {
    const k = m.to / m.from.d;
    return {
      bug,
      lead: "fraction_split",
      leadText: `${m.from.d} parts became ${m.to}: each part splits into ${k}. So ${m.from.n} parts become ${m.from.n} × ${k}.`,
      item: lineFact([m.from.n, "×", k, "=", "?"], m.from.n * k, "equivalent_fractions"),
      manipulative: { kind: "fraction_bar", parts: m.to, shaded: [], match: { parts: m.from.d, shaded: m.from.n } },
      target: { cellId: "rn", place: 0 },
      under: FRACTION_LINE,
    };
  }
  return null;
}

// ---------------------------------------------------------------- equations

function shrinkEquation(item: MathItem, bug: BugId): SubStep | null {
  const m = item.math;
  if (m?.kind !== "equation" || !(bug === "eq_same_operation" || bug === "eq_sign_error" || bug === "eq_subtracted_coefficient")) return null;
  const L = m.letter;
  if (m.form === "ax") {
    return {
      bug,
      lead: "undo",
      leadText: `${m.a}${L} means ${m.a} times ${L}. Undo it: divide ${m.b} by ${m.a}.`,
      item: lineFact([m.b, "÷", m.a, "=", "?"], m.x, "division_facts"),
      manipulative: null,
      target: { cellId: ANSWER_LINE, place: 0, answer: true },
      under: ANSWER_LINE,
    };
  }
  const minus = m.form === "x-a";
  return {
    bug,
    lead: "undo",
    leadText: minus ? `Undo − ${m.a}: add ${m.a} back to ${m.b}.` : `Undo + ${m.a}: take ${m.a} away from ${m.b}.`,
    item: lineFact(minus ? [m.b, "+", m.a, "=", "?"] : [m.b, "−", m.a, "=", "?"], m.x, minus ? "add_within_20" : "subtract_within_20"),
    manipulative: { kind: "number_line", min: 0, max: Math.max(m.b, m.x) + 2, start: m.b },
    target: { cellId: ANSWER_LINE, place: 0, answer: true },
    under: ANSWER_LINE,
  };
}

/** The smaller problem for a Phase 3 item, or null. */
export function shrinkFamily(item: MathItem, bug: BugId, cellId?: string): SubStep | null {
  switch (item.math?.kind) {
    case "subtract":
      return shrinkSubtract(item, bug, cellId);
    case "multiply":
      return shrinkMultiply(item, bug, cellId);
    case "fractions":
    case "equivalent":
      return shrinkFractions(item, bug);
    case "equation":
      return shrinkEquation(item, bug);
    default:
      return null;
  }
}
