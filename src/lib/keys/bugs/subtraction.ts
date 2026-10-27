/**
 * Taking away's buggy rules (docs/KEYS.md, Phase 3). Each one runs the wrong procedure a kid really
 * follows on the item (Brown and Burton's subtraction bugs): what it gives is what that kid writes.
 */
import type { MistakeKind } from "@/lib/learning/hint";
import type { MathItem } from "../item";
import { digitsOf, fromDigits } from "../families/columns";
import type { BugRule } from "./types";

function cols(item: MathItem): { t: number[]; b: number[] } | null {
  if (item.kind !== "difference" || item.math?.kind !== "subtract") return null;
  const t = digitsOf(item.math.top);
  return { t, b: digitsOf(item.math.bottom, t.length) };
}

/** Column by column with a rule for each place (no borrowing between places). */
function byColumn(item: MathItem, f: (t: number, b: number) => number): string | null {
  const c = cols(item);
  if (!c) return null;
  return String(fromDigits(c.t.map((t, p) => f(t, c.b[p]))));
}

/** Regroups, but a zero that lends never takes its ten from the place left of it (it just becomes 9). */
function acrossZeroNoTake(item: MathItem): string | null {
  const c = cols(item);
  if (!c) return null;
  const d = [...c.t];
  let crossed = false;
  for (let p = 0; p < d.length; p++) {
    if (d[p] >= c.b[p]) continue;
    let q = p + 1;
    while (q < d.length && d[q] === 0) q++;
    if (q >= d.length) return null;
    if (q > p + 1) {
      crossed = true;
      for (let k = q - 1; k > p; k--) d[k] = 9;
    } else d[q] -= 1;
    d[p] += 10;
  }
  if (!crossed) return null;
  return String(fromDigits(d.map((t, p) => t - c.b[p])));
}

function rule(id: BugRule["id"], label: string, mistake: MistakeKind, produce: BugRule["produce"]): BugRule {
  return { id, area: "subtraction", label, mistake, produce };
}

export const SUBTRACTION_BUGS: readonly BugRule[] = [
  rule("sub_smaller_from_larger", "Took the smaller digit from the larger", "concept", (item) => byColumn(item, (t, b) => Math.abs(t - b))),
  rule("sub_forgot_borrow", "Wrote 0 where the top digit was smaller", "concept", (item) => byColumn(item, (t, b) => (t < b ? 0 : t - b))),
  rule("sub_borrow_no_reduce", "Regrouped but did not take 1 from the next place", "arithmetic", (item) => byColumn(item, (t, b) => (t < b ? t + 10 - b : t - b))),
  rule("sub_borrow_across_zero", "Regrouped across a zero without taking 1 from the next place", "arithmetic", acrossZeroNoTake),
  rule("sub_added_instead", "Added instead of taking away", "concept", (item) => (item.math?.kind === "subtract" ? String(item.math.top + item.math.bottom) : null)),
];
