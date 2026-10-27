/**
 * The buggy-rule library (docs/KEYS.md). `matchBug` names why an answer went wrong when a known wrong
 * procedure gives exactly that answer; null when none does (the tutor then nudges in general words).
 */
import { answersEqual, canonicalAnswer, parseFrac, type MathItem } from "../item";
import { ADDITION_BUGS } from "./addition";
import { EQUATION_BUGS } from "./equations";
import { FRACTION_BUGS } from "./fractions";
import { MULTIPLICATION_BUGS } from "./multiplication";
import { SUBTRACTION_BUGS } from "./subtraction";
import type { BugId, BugRule } from "./types";

export type { BugArea, BugId, BugRule } from "./types";

/** Every rule, in the order they are tried: the first that matches wins. */
export const BUG_RULES: readonly BugRule[] = [...ADDITION_BUGS, ...SUBTRACTION_BUGS, ...MULTIPLICATION_BUGS, ...FRACTION_BUGS, ...EQUATION_BUGS];

/** Two answers in the item's form are the same: equal fractions (`2/5` and `4/10`) count as one. */
function same(item: MathItem, a: string, b: string): boolean {
  if (a === b) return true;
  if (item.kind !== "fraction_sum") return false;
  const x = parseFrac(a);
  const y = parseFrac(b);
  return x !== null && y !== null && x.n * y.d === y.n * x.d;
}

export function bugRule(id: BugId): BugRule {
  const r = BUG_RULES.find((b) => b.id === id);
  if (!r) throw new Error(`unknown bug ${id}`);
  return r;
}

/** What each rule gives for this item, when it applies and differs from the right answer. */
export function bugAnswers(item: MathItem): Partial<Record<BugId, string>> {
  const out: Partial<Record<BugId, string>> = {};
  for (const r of BUG_RULES) {
    const a = r.produce(item);
    if (a !== null && !answersEqual(item, a) && !Object.values(out).some((o) => same(item, o, a))) out[r.id] = a;
  }
  return out;
}

/** The rule that explains this answer, or null. A right answer matches none. */
export function matchBug(item: MathItem, answer: string): BugId | null {
  const kid = canonicalAnswer(item, answer);
  if (!kid || answersEqual(item, kid)) return null;
  for (const r of BUG_RULES) {
    const a = r.produce(item);
    if (a !== null && !answersEqual(item, a) && same(item, canonicalAnswer(item, a), kid)) return r.id;
  }
  return null;
}
