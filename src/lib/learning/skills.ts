/**
 * STUB (owner: agent "brain"). Files a problem under one skill (`SKILLS`, `contracts.ts`).
 * Exports are frozen by the contract; the body is replaced by its owner.
 */
import type { SkillId } from "./contracts";

/**
 * The skill a problem practises, from its LaTeX lines (and the student's course as a tie-breaker:
 * `2x + 3 = 11` is `two_step_equations` in any course). Deterministic, pure, no engine, < 1 ms.
 * `other` when nothing fits.
 */
export function classifyProblem(problemLatex: readonly string[], course?: string | null): SkillId {
  void problemLatex;
  void course;
  return "other";
}
