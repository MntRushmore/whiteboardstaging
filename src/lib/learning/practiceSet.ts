/**
 * The light half of practice (`practice.ts`): which skills have practice problems, and the problems
 * themselves, from the template generators alone. No engine, no verifier, no handwriting planner,
 * so the Progress page and the Ask panel's "Practice my weak spots" can load it cheaply;
 * `variantOf` ("Now you try"), which checks candidates with the engine, stays in `practice.ts`.
 */
import type { PracticeProblem, SkillId } from "./contracts";
import { drawProblems, formsFor } from "./generators";

/** True when `practiceProblems` can make problems for this skill. */
export function hasPractice(skill: string): boolean {
  return typeof skill === "string" && formsFor(skill).length > 0;
}

/**
 * `count` problems for a skill, different from each other, with clean answers, each one the board
 * chat's `write_problems` accepts (`verifyProblem`) and the hand can write. Same seed, same
 * problems. Pure, no engine (clean by construction; the tests hold every generator to the engine).
 * Empty when the skill has no generator.
 */
export function practiceProblems(skill: SkillId, count: number, seed: number): PracticeProblem[] {
  try {
    return drawProblems(skill, count, seed);
  } catch {
    return [];
  }
}
