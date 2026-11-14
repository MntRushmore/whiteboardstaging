/**
 * The buggy-rule library (docs/KEYS.md). `matchBug` names why an answer went wrong when a known wrong
 * procedure gives exactly that answer; null when none does (the tutor then nudges in general words).
 */
import { canonicalAnswer, type MathItem } from "../item";
import { ADDITION_BUGS } from "./addition";
import type { BugId, BugRule } from "./types";

export type { BugArea, BugId, BugRule } from "./types";

/** Every rule, in the order they are tried: the first that matches wins. */
export const BUG_RULES: readonly BugRule[] = [...ADDITION_BUGS];

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
    if (a !== null && a !== item.answer && !Object.values(out).includes(a)) out[r.id] = a;
  }
  return out;
}

/** The rule that explains this answer, or null. A right answer matches none. */
export function matchBug(item: MathItem, answer: string): BugId | null {
  const kid = canonicalAnswer(item, answer);
  if (!kid || kid === item.answer) return null;
  for (const r of BUG_RULES) {
    const a = r.produce(item);
    if (a !== null && a !== item.answer && a === kid) return r.id;
  }
  return null;
}
