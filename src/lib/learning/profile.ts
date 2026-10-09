/**
 * The signed-in student's course and display name (`profiles`, the owner's select policy): what the
 * Progress page and the topic picker read of the profile. Never throws: without them the pages
 * show no course (the topic picker starts with the numbers) and no name.
 */
import { supabase } from "@/lib/supabase";
import { isCourseId, type CourseId } from "@/lib/onboarding/courseIds";

export interface LearnerProfile {
  course: CourseId | null;
  displayName: string | null;
}

export async function readLearnerProfile(userId: string): Promise<LearnerProfile> {
  try {
    const { data, error } = await supabase.from("profiles").select("display_name, course").eq("user_id", userId).maybeSingle();
    if (error || !data) return { course: null, displayName: null };
    const row = data as { display_name?: unknown; course?: unknown };
    return {
      course: isCourseId(row.course) ? row.course : null,
      displayName: typeof row.display_name === "string" ? row.display_name : null,
    };
  } catch {
    return { course: null, displayName: null };
  }
}
