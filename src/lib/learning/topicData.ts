/**
 * What the topic picker reads (the home's and the board's): the signed-in student's course and,
 * from their learning record, each skill's level and their weak spots. Everything is the student's
 * own (their profile row, their attempts under RLS). Never throws: without a record every topic is
 * New and Up next is the course's first; without a course the list starts with the numbers.
 */
import type { CourseId } from "@/lib/onboarding/courseIds";
import type { MasteryLevel, SkillId } from "./contracts";
import { readLearnerProfile } from "./profile";
import { loadAttempts } from "./store";
import { summarize } from "./summary";
import { levelsOf } from "./topics";

export interface TopicData {
  course: CourseId | null;
  levels: Map<SkillId, MasteryLevel>;
  /** worked on and not mastered, weakest first */
  weakSkills: SkillId[];
  /** the record could not be read: levels are all New */
  recordFailed: boolean;
}

export async function loadTopicData(userId: string, now: number = Date.now()): Promise<TopicData> {
  const [profile, attempts] = await Promise.all([readLearnerProfile(userId), loadAttempts().then((a) => a, () => null)]);
  if (!attempts) return { course: profile.course, levels: new Map(), weakSkills: [], recordFailed: true };
  const summary = summarize(attempts, now, { course: profile.course, tzOffsetMinutes: new Date(now).getTimezoneOffset() });
  return { course: profile.course, levels: levelsOf(summary.skills), weakSkills: [...summary.weakSkills], recordFailed: false };
}
