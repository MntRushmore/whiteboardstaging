/**
 * Fractions' buggy rules (docs/KEYS.md, Phase 3): adding the denominators, a common denominator with
 * the numerators left as they were, and the slips of an equivalent fraction.
 */
import type { MistakeKind } from "@/lib/learning/hint";
import type { MathItem } from "../item";
import { lcm } from "../families/fractions";
import type { BugRule } from "./types";

function sum(item: MathItem) {
  return item.kind === "fraction_sum" && item.math?.kind === "fractions" ? item.math : null;
}

function eqv(item: MathItem) {
  return item.kind === "equivalent" && item.math?.kind === "equivalent" ? item.math : null;
}

function rule(id: BugRule["id"], label: string, mistake: MistakeKind, produce: BugRule["produce"]): BugRule {
  return { id, area: "fractions", label, mistake, produce };
}

export const FRACTION_BUGS: readonly BugRule[] = [
  rule("frac_added_denominators", "Added the bottoms as well as the tops", "fractions", (item) => {
    const m = sum(item);
    return m ? `${m.left.n + m.right.n}/${m.left.d + m.right.d}` : null;
  }),
  rule("frac_not_scaled_numerator", "Made the bottoms the same but left the tops", "fractions", (item) => {
    const m = sum(item);
    return m && m.left.d !== m.right.d ? `${m.left.n + m.right.n}/${lcm(m.left.d, m.right.d)}` : null;
  }),
  rule("frac_multiplied_denominators", "Multiplied the bottoms and added the tops", "fractions", (item) => {
    const m = sum(item);
    return m ? `${m.left.n + m.right.n}/${m.left.d * m.right.d}` : null;
  }),
  rule("eqv_added_same", "Added to the top what was added to the bottom", "fractions", (item) => {
    const m = eqv(item);
    return m ? String(m.from.n + (m.to - m.from.d)) : null;
  }),
  rule("eqv_copied_numerator", "Kept the top the same", "fractions", (item) => {
    const m = eqv(item);
    return m ? String(m.from.n) : null;
  }),
  rule("eqv_wrote_factor", "Wrote how many times bigger, not the new top", "fractions", (item) => {
    const m = eqv(item);
    return m ? String(m.to / m.from.d) : null;
  }),
];
