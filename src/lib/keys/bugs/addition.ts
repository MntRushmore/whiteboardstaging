/**
 * Adding's buggy rules (docs/KEYS.md, "The bugs"). Each one is the wrong procedure a kid really
 * follows, run on the item: what it gives is what that kid would write. A kid's answer equal to a
 * rule's names the cause, exactly.
 */
import type { MistakeKind } from "@/lib/learning/hint";
import { carryInto, digitAt, digitCount, type MathItem } from "../item";
import type { BugRule } from "./types";

/** The column sums, ones first, without any carrying. */
function columnSums(addends: readonly number[]): number[] {
  const places = Math.max(...addends.map(digitCount));
  const sums: number[] = [];
  for (let p = 0; p < places; p++) sums.push(addends.reduce((s, n) => s + digitAt(n, p), 0));
  return sums;
}

/** Adds column by column, with each carry counted `carryWeight` times (1 is the right way). */
function addWithCarry(addends: readonly number[], carryWeight: number): string {
  const sums = columnSums(addends);
  let carry = 0;
  let out = "";
  for (const s of sums) {
    const v = s + carryWeight * carry;
    out = String(v % 10) + out;
    carry = Math.floor(v / 10);
  }
  return (carry ? String(carry) : "") + out;
}

/**
 * What a kid following a rule writes in the box of a missing digit: the total's digit at that place,
 * less the other addends' digits there, less the carry counted `carryWeight` times. Null when that is
 * no digit.
 */
function missingDigit(item: MathItem, carryWeight: number): string | null {
  const hidden = item.hidden;
  if (!hidden) return null;
  const others = item.addends.filter((_, i) => i !== hidden.addend);
  const d = digitAt(item.total, hidden.place) - others.reduce((s, n) => s + digitAt(n, hidden.place), 0) - carryWeight * carryInto(item.addends, hidden.place);
  return d >= 0 && d <= 9 ? String(d) : null;
}

function rule(id: BugRule["id"], label: string, mistake: MistakeKind, produce: BugRule["produce"]): BugRule {
  return { id, area: "addition", label, mistake, produce };
}

export const ADDITION_BUGS: readonly BugRule[] = [
  rule("add_forgot_carry", "Forgot to add the carried 1", "arithmetic", (item) => {
    if (item.kind === "missing_addend") return missingDigit(item, 0);
    if (item.kind !== "sum") return null;
    // Each column's ones digit, the 1 dropped; the top column is written whole.
    const sums = columnSums(item.addends);
    const top = sums.length - 1;
    return String(sums[top]) + sums.slice(0, top).map((s) => String(s % 10)).reverse().join("");
  }),
  rule("add_carry_twice", "Added the carried 1 twice", "arithmetic", (item) => {
    if (item.kind === "missing_addend") return missingDigit(item, 2);
    if (item.kind !== "sum") return null;
    return addWithCarry(item.addends, 2);
  }),
  rule("add_whole_column_sum", "Wrote each column's whole sum", "concept", (item) => {
    if (item.kind !== "sum") return null;
    return columnSums(item.addends).reverse().map(String).join("");
  }),
  rule("add_swapped_places", "Swapped the tens and the ones", "concept", (item) => {
    if (item.kind !== "sum" || item.total < 10) return null;
    const s = String(item.total);
    return s.slice(0, -2) + s[s.length - 1] + s[s.length - 2];
  }),
];
