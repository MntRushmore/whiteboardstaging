/**
 * What the home's skill path reads: the signed-in student's grade and course (their profile row)
 * and, from their learning record (their own attempts, under RLS), each skill's level. One read of
 * each, in parallel, after the home is up (SkillPathCard is loaded with a dynamic import).
 *
 * Never throws. A record that cannot be read is `failed`, and the home then draws no path rather
 * than one that says nothing is done. The profile never fails (`readLearnerProfile` falls back to no
 * grade and no course, which asks the student to pick their grade).
 */
import type { CourseId } from "@/lib/onboarding/courseIds";
import type { MasteryLevel } from "@/lib/learning/contracts";
import type { Grade } from "@/lib/learning/grades";
import { readLearnerProfile } from "@/lib/learning/profile";
import { loadAttempts } from "@/lib/learning/store";
import { summarize } from "@/lib/learning/summary";
import { levelsOf } from "@/lib/learning/topics";

export interface PathProfile {
  grade: Grade | null;
  course: CourseId | null;
}

export type PathData = { status: "failed" } | { status: "ready"; profile: PathProfile; levels: Map<string, MasteryLevel> };

export async function loadPathData(userId: string, now: number = Date.now()): Promise<PathData> {
  try {
    const [profile, attempts] = await Promise.all([readLearnerProfile(userId), loadAttempts().then((a) => a, () => null)]);
    if (!attempts) return { status: "failed" };
    const summary = summarize(attempts, now, { course: profile.course, tzOffsetMinutes: new Date(now).getTimezoneOffset() });
    return { status: "ready", profile: { grade: profile.grade, course: profile.course }, levels: levelsOf(summary.skills) };
  } catch {
    return { status: "failed" };
  }
}
