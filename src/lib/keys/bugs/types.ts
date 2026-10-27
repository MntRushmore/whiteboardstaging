import type { MistakeKind } from "@/lib/learning/hint";
import type { MathItem } from "../item";

export type BugId =
  // adding (Phase 1)
  | "add_forgot_carry"
  | "add_carry_twice"
  | "add_whole_column_sum"
  | "add_swapped_places"
  // taking away
  | "sub_smaller_from_larger"
  | "sub_forgot_borrow"
  | "sub_borrow_no_reduce"
  | "sub_borrow_across_zero"
  | "sub_added_instead"
  // times tables and multiplying
  | "mul_added_instead"
  | "mul_one_group_short"
  | "mul_one_group_over"
  | "mul_tens_dropped_zero"
  | "mul_tens_extra_zero"
  | "mul_forgot_carry"
  | "mul_carry_added_first"
  | "mul_no_placeholder"
  | "mul_ones_only"
  | "mul_column_by_column"
  // fractions
  | "frac_added_denominators"
  | "frac_not_scaled_numerator"
  | "frac_multiplied_denominators"
  | "eqv_added_same"
  | "eqv_copied_numerator"
  | "eqv_wrote_factor"
  // one-step equations
  | "eq_same_operation"
  | "eq_sign_error"
  | "eq_subtracted_coefficient";

export type BugArea = "addition" | "subtraction" | "multiplication" | "fractions" | "equations";

export interface BugRule {
  id: BugId;
  area: BugArea;
  /** for grown-ups (Progress) */
  label: string;
  /** the learning record's kind for it */
  mistake: MistakeKind;
  /** the answer a kid following this rule writes, in the item's answer form; null when it does not apply */
  produce(item: MathItem): string | null;
}
