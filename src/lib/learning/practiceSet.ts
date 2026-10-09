/**
 * The light half of practice (`practice.ts`): which skills have practice problems, and the problems
 * themselves, from the template generators alone. No engine, no verifier, no handwriting planner,
 * so the Progress page and the Ask panel's "Practice my weak spots" can load it cheaply;
 * `variantOf` ("Now you try"), which checks candidates with the engine, stays in `practice.ts`.
 */
import type { PracticeProblem, SkillId } from "./contracts";
import { drawLadder, drawProblems, formsFor } from "./generators";

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

/** A topic board's problems: a worked example to show first, then the problems, easy to hard. */
export interface TopicSet {
  skill: SkillId;
  /** easy to hard: the first is like the worked example, the last the hardest the skill has */
  problems: PracticeProblem[];
  /** worked-example candidates, easiest first (the board works the first its engine solves) */
  examples: PracticeProblem[];
}

/**
 * A topic's set (`generators/ladder.ts`): free and instant like `practiceProblems`, clean by
 * construction. Empty problems when the skill has no generator.
 */
export function topicSet(skill: SkillId, count: number, seed: number): TopicSet {
  try {
    const ladder = drawLadder(skill, count, seed);
    return { skill, problems: ladder.problems, examples: ladder.examples };
  } catch {
    return { skill, problems: [], examples: [] };
  }
}
