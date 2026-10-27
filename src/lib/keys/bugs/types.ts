import type { MistakeKind } from "@/lib/learning/hint";
import type { MathItem } from "../item";

export type BugId = "add_forgot_carry" | "add_carry_twice" | "add_whole_column_sum" | "add_swapped_places";

export type BugArea = "addition";

export interface BugRule {
  id: BugId;
  area: BugArea;
  /** for grown-ups (Progress, Phase 2) */
  label: string;
  /** the learning record's kind for it (Phase 2) */
  mistake: MistakeKind;
  /** the answer a kid following this rule writes, in the item's answer form; null when it does not apply */
  produce(item: MathItem): string | null;
}
