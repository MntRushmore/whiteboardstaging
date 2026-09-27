/**
 * What every one-unknown solver in the engine hands back, and how its lines are written.
 *
 * No words on the board: several answers are written as a list, `x = 2, \ x = 3` (a comma and
 * a space the hand can draw), never joined by "or"; no answer is `\varnothing`. The block under
 * the student's line holds `MAX_STEPS` lines, so a long solution drops its optional working
 * lines — never the first, never the answer.
 */
import type { Q } from "./algebra";

/** Joins several answers on one line: `x = 2, \ x = 3`. */
export const LIST_SEP = ", \\ ";

/** No solution. Drawn by the hand as `∅`. */
export const NO_SOLUTION = "\\varnothing";

/** Every real number, as an inequality's answer (`|x| \ge -1`, `2x + 1 < 2x + 5`): an interval. */
export const ALL_REALS = (variable: string): string => `-\\infty < ${variable} < \\infty`;

/** Every real number, as an equation's answer (`2(x + 3) = 2x + 6` → `0 = 0`): the hand draws ∈ and ℝ. */
export const EVERY_REAL = (variable: string): string => `${variable} \\in \\mathbb{R}`;

/** The Solve block's line budget (`LIVE_LIMITS.maxSolveSteps`). */
export const MAX_STEPS = 8;

export interface Root {
  latex: string;
  value: number;
  /** the root as an exact rational, when it is one (what a check line substitutes) */
  exact?: Q;
}

export interface Solution {
  steps: string[];
  /** the answer line, always the last step */
  final: string;
  /** the real solutions of an equation; null for an inequality */
  roots: Root[] | null;
}

/**
 * Writes lines once: a line identical (normalized) to the input or to a line already written is
 * skipped. `optional` lines are the first to go when the solution is over budget.
 */
export class StepWriter {
  private readonly out: Array<{ latex: string; optional: boolean }> = [];
  private readonly seen = new Set<string>();

  constructor(
    private readonly normalize: (latex: string) => string,
    input?: string,
  ) {
    if (input !== undefined) this.seen.add(normalize(input));
  }

  write(latex: string, optional = false): void {
    const key = this.normalize(latex);
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.out.push({ latex, optional });
  }

  /** Lines another solver produced, in order (deduplicated here too). */
  writeAll(lines: readonly string[], optional = false): void {
    for (const l of lines) this.write(l, optional);
  }

  get length(): number {
    return this.out.length;
  }

  get last(): string | undefined {
    return this.out[this.out.length - 1]?.latex;
  }

  /** The lines within `max`: optional ones dropped first (latest first), then the oldest middle ones. */
  lines(max = MAX_STEPS): string[] {
    const lines = [...this.out];
    for (let i = lines.length - 2; i >= 1 && lines.length > max; i--) if (lines[i].optional) lines.splice(i, 1);
    while (lines.length > max && lines.length > 3) lines.splice(1, 1);
    return lines.map((l) => l.latex);
  }
}

/** `x = -1, \ x = 4` (ascending), one root `x = 4`, none `\varnothing`. Same-value roots once. */
export function rootsLine(variable: string, roots: readonly Root[]): string {
  const sorted = dedupeRoots(roots).sort((a, b) => a.value - b.value);
  if (sorted.length === 0) return NO_SOLUTION;
  return sorted.map((r) => `${variable} = ${r.latex}`).join(LIST_SEP);
}

function dedupeRoots(roots: readonly Root[]): Root[] {
  const out: Root[] = [];
  for (const r of roots) if (!out.some((o) => Math.abs(o.value - r.value) < 1e-9 * Math.max(1, Math.abs(r.value)))) out.push(r);
  return out;
}
