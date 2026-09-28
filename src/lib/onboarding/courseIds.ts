/**
 * The course ids alone (the database's `profiles_course_known` check), apart from the starter
 * problems in `courses.ts`, so the boards home can validate a profile without loading them.
 */
export const COURSE_IDS = ["algebra1", "geometry", "algebra2", "precalc_calc", "other"] as const;
export type CourseId = (typeof COURSE_IDS)[number];

export function isCourseId(value: unknown): value is CourseId {
  return typeof value === "string" && (COURSE_IDS as readonly string[]).includes(value);
}
