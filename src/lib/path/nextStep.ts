/**
 * Where "next" is on a path (the skill path's Next up stop, the home's Up next, Today's practice's
 * "next" skills): the first skill not mastered, in teaching order — except a skill the student has
 * never tried that comes BEFORE one they are already Almost there or Mastered on. That one is review
 * they have shown they can skip: an Algebra 1 student who is Almost there on Two-step equations is
 * not sent back to Negative numbers first.
 *
 * Pure, import-free but a type: unit-tested in `__tests__/nextStep.test.ts`.
 */
import type { MasteryLevel } from "@/lib/learning/contracts";

/** A level that shows the student can already do a skill (and so the plain skills before it). */
function showsReach(level: MasteryLevel): boolean {
  return level === "almost" || level === "mastered";
}

/**
 * The index of the next skill on a path from each skill's level, in path order, or -1 when every
 * skill is mastered. Never a mastered skill; never a skill never tried that sits behind one the
 * student has reached (unless that leaves nothing, when it is the first not mastered).
 */
export function nextStepIndex(levels: readonly MasteryLevel[]): number {
  let reach = -1;
  levels.forEach((level, i) => {
    if (showsReach(level)) reach = i;
  });
  const ahead = levels.findIndex((level, i) => level !== "mastered" && !(level === "new" && i < reach));
  return ahead !== -1 ? ahead : levels.findIndex((level) => level !== "mastered");
}
