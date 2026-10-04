/**
 * STUB (owner: agent "practice"). Practice problems for a skill, and a fresh problem like one the
 * student just saw. Exports are frozen by the contract; the bodies are replaced by their owner.
 */
import type { LiveEngine } from "@/lib/live/contracts";
import type { PracticeProblem, SkillId } from "./contracts";

/** True when `practiceProblems` can make problems for this skill. */
export function hasPractice(skill: string): boolean {
  void skill;
  return false;
}

/**
 * `count` problems for a skill, different from each other, with clean answers, each one the board
 * chat's `write_problems` accepts (`verifyProblem`) and the hand can write. Same seed, same
 * problems. Pure, no engine (clean by construction; the tests hold every generator to the engine).
 * Empty when the skill has no generator.
 */
export function practiceProblems(skill: SkillId, count: number, seed: number): PracticeProblem[] {
  void skill;
  void count;
  void seed;
  return [];
}

/**
 * A new problem like this one — same form, new numbers, a clean answer that differs from the
 * original's — checked with the engine. Falls back to `practiceProblems(classifyProblem(problem), 1, seed)`.
 * Null when neither works.
 */
export function variantOf(engine: LiveEngine, problem: PracticeProblem, seed: number): PracticeProblem | null {
  void engine;
  void problem;
  void seed;
  return null;
}
