/**
 * The signed-in student's course, grade, display name and picture (`profiles`, the owner's select
 * policy): what the Progress page, the topic picker, Today's practice and the skill path read of the
 * profile. Never throws: without them the pages show no course (the topic picker starts with the
 * numbers), no grade and no name.
 */
import { supabase } from "@/lib/supabase";
import { isCourseId, type CourseId } from "@/lib/onboarding/courseIds";
import { isGrade, type Grade } from "./grades";

export interface LearnerProfile {
  course: CourseId | null;
  /** 0..8 (Kindergarten to 8th grade); null for a high-school course or not chosen */
  grade: Grade | null;
  displayName: string | null;
  /** an AVATARS id (src/lib/family/contracts.ts), or null */
  avatar: string | null;
}

const EMPTY: LearnerProfile = { course: null, grade: null, displayName: null, avatar: null };

export async function readLearnerProfile(userId: string): Promise<LearnerProfile> {
  try {
    const { data, error } = await supabase.from("profiles").select("display_name, course, grade, avatar").eq("user_id", userId).maybeSingle();
    if (error || !data) return EMPTY;
    const row = data as { display_name?: unknown; course?: unknown; grade?: unknown; avatar?: unknown };
    return {
      course: isCourseId(row.course) ? row.course : null,
      grade: isGrade(row.grade) ? row.grade : null,
      displayName: typeof row.display_name === "string" ? row.display_name : null,
      avatar: typeof row.avatar === "string" ? row.avatar : null,
    };
  } catch {
    return EMPTY;
  }
}
