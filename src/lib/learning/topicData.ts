/**
 * What the topic picker reads (the home's and the board's): the signed-in student's grade and course
 * and, from their learning record, each skill's level and their weak spots. Everything is the
 * student's own (their profile row, their attempts under RLS). Never throws: without a record every
 * topic is New and Up next is the first of their grade's path (or course); with neither a grade nor
 * a course the list starts with the numbers.
 */
import type { CourseId } from "@/lib/onboarding/courseIds";
import type { MasteryLevel, SkillId } from "./contracts";
import type { Grade } from "./grades";
import { readLearnerProfile } from "./profile";
import { loadAttempts } from "./store";
import { summarize } from "./summary";
import { levelsOf } from "./topics";

export interface TopicData {
  course: CourseId | null;
  /** 0..8 (Kindergarten to 8th grade): their path leads the picker; null for a course or none */
  grade: Grade | null;
  levels: Map<SkillId, MasteryLevel>;
  /** worked on and not mastered, weakest first */
  weakSkills: SkillId[];
  /** the record could not be read: levels are all New */
  recordFailed: boolean;
}

export async function loadTopicData(userId: string, now: number = Date.now()): Promise<TopicData> {
  const [profile, attempts] = await Promise.all([readLearnerProfile(userId), loadAttempts().then((a) => a, () => null)]);
  if (!attempts) return { course: profile.course, grade: profile.grade, levels: new Map(), weakSkills: [], recordFailed: true };
  const summary = summarize(attempts, now, { course: profile.course, grade: profile.grade, tzOffsetMinutes: new Date(now).getTimezoneOffset() });
  return { course: profile.course, grade: profile.grade, levels: levelsOf(summary.skills), weakSkills: [...summary.weakSkills], recordFailed: false };
}
