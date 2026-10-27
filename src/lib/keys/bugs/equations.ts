/**
 * One-step equations' buggy rules (docs/KEYS.md, Phase 3): doing the same operation instead of the
 * inverse, a sign slip, and taking the number away from a product instead of dividing.
 */
import type { MistakeKind } from "@/lib/learning/hint";
import type { MathItem } from "../item";
import type { BugRule } from "./types";

function eq(item: MathItem) {
  return item.kind === "equation" && item.math?.kind === "equation" ? item.math : null;
}

function rule(id: BugRule["id"], label: string, mistake: MistakeKind, produce: BugRule["produce"]): BugRule {
  return { id, area: "equations", label, mistake, produce };
}

export const EQUATION_BUGS: readonly BugRule[] = [
  rule("eq_same_operation", "Did the same operation instead of undoing it", "inverse_operation", (item) => {
    const m = eq(item);
    if (!m) return null;
    return String(m.form === "x-a" ? m.b - m.a : m.form === "ax" ? m.a * m.b : m.b + m.a);
  }),
  rule("eq_sign_error", "Took the bigger number from the smaller", "sign", (item) => {
    const m = eq(item);
    return m && (m.form === "x+a" || m.form === "a+x") ? String(m.a - m.b) : null;
  }),
  rule("eq_subtracted_coefficient", "Took the number away instead of dividing", "inverse_operation", (item) => {
    const m = eq(item);
    return m && m.form === "ax" ? String(m.b - m.a) : null;
  }),
];
