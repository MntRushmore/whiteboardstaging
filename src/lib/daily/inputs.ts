/**
 * What the day's set is planned from (`planDailySet`): the student's path — their grade's, or their
 * high-school course's topics — and, from their learning record, each skill's level and their weak
 * spots. Everything is the student's own (their profile row, their attempts under RLS).
 *
 * Never throws: with no profile the path is the numbers (`courseTopicIds(null)`), and with no
 * record the student is planned for as brand new, so Start always has a set to give.
 */
import type { CourseId } from "@/lib/onboarding/courseIds";
import type { MasteryLevel } from "@/lib/learning/contracts";
import { GRADE_PATHS, gradePath, isGrade, type Grade } from "@/lib/learning/grades";
import { readLearnerProfile } from "@/lib/learning/profile";
import { loadAttempts } from "@/lib/learning/store";
import { summarize } from "@/lib/learning/summary";
import { courseTopicIds, levelsOf } from "@/lib/learning/topics";
import type { DailyPlanInput } from "./plan";

/** A student's path: their grade's (and the grade above's, for when it is all mastered), else their course's topics. */
export function pathFor(grade: Grade | null, course: CourseId | null): { path: string[]; beyond: string[] } {
  if (grade !== null && isGrade(grade)) {
    return { path: gradePath(grade), beyond: grade < 8 ? [...GRADE_PATHS[(grade + 1) as Grade]] : [] };
  }
  return { path: courseTopicIds(course), beyond: [] };
}

/** The day's plan input for the signed-in student. Never throws (see the module's comment). */
export async function loadDailyPlanInput(userId: string, day: string, now: number = Date.now()): Promise<DailyPlanInput> {
  const [profile, attempts] = await Promise.all([
    readLearnerProfile(userId),
    loadAttempts().then(
      (a) => a,
      () => null,
    ),
  ]);
  const { path, beyond } = pathFor(profile.grade, profile.course);
  let levels = new Map<string, MasteryLevel>();
  let weakSkills: string[] = [];
  if (attempts) {
    try {
      const summary = summarize(attempts, now, { course: profile.course, tzOffsetMinutes: new Date(now).getTimezoneOffset() });
      levels = levelsOf(summary.skills);
      weakSkills = [...summary.weakSkills];
    } catch {
      // a record that cannot be summarised: planned for as brand new
    }
  }
  return { day, userId, path, beyond, levels, weakSkills };
}
