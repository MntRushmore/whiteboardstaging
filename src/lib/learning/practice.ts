/**
 * Practice problems for a skill, and a fresh problem like one the student just saw ("Now you try").
 * Free and instant: no model call, no ink. The board writes them through the chat's executor
 * (`write_problems`), which checks each with the engine and writes it in the tutor's hand.
 *
 * The problems come from template generators (`generators/`), one or more FORMS per skill
 * (`ax + b = c`, `\frac{x}{a} - b = c`, `b - ax = c`, …), each choosing its answer first so the
 * problem is clean by construction, with numbers that fit the level: small whole numbers for the
 * youngest, negatives only where they belong. `__tests__/practice.test.ts` holds every generator
 * to the engine — `verifyProblem` accepts every problem, `localSolve` answers it cleanly, the hand
 * writes it — so a practice board never needs the engine to choose its problems.
 *
 * Skills without practice: `word_problems` and `proofs` (words on the board), `chemistry` (the
 * engine reads an unbalanced equation as false) and `other`.
 */
import type { LiveEngine } from "@/lib/live/contracts";
import type { PracticeProblem, SkillId } from "./contracts";
import { drawProblems, formsFor } from "./generators";
import { findVariant } from "./generators/variant";
import { classifyProblem } from "./skills";

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

/** Practice problems the fallback offers: the first is `practiceProblems(skill, 1, seed)`'s. */
const FALLBACK_TRIES = 3;

/**
 * A new problem like this one — same form, new numbers, a clean answer that differs from the
 * original's — checked with the engine. Falls back to `practiceProblems(classifyProblem(problem), 1, seed)`.
 * Null when neither works.
 */
export function variantOf(engine: LiveEngine, problem: PracticeProblem, seed: number): PracticeProblem | null {
  try {
    return findVariant(engine, problem, seed, {
      fallback: (lines) => {
        const skill = classifyProblem(lines);
        return hasPractice(skill) ? practiceProblems(skill, FALLBACK_TRIES, seed) : [];
      },
    });
  } catch {
    return null;
  }
}
