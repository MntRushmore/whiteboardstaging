import type { SupabaseClient } from "@supabase/supabase-js";
import type { Grade } from "@/lib/learning/grades";
import { isHeardFrom, type HeardFrom } from "@/lib/funnel/contracts";
import { isCourseId, type CourseId } from "./courseIds";
import type { OnboardingProfile } from "./state";

/**
 * Onboarding's reads and writes, as the student (their JWT; RLS and the RPC act on auth.uid()):
 *
 * - `profiles.course, grade, onboarded_at` are read with the owner-select policy;
 * - they and `heard_from` are written only by `save_onboarding(p_course, p_complete, p_grade,
 *   p_heard_from)` (v2, a SECURITY DEFINER RPC: course, grade and source validated, onboarded_at
 *   stamped once, heard_from kept the first time) — a user has no update grant on them;
 * - the first board is an ordinary `whiteboards` insert, owned by the student.
 *
 * The client is structural (only the calls used here), so the tests pass a fake. Nothing throws:
 * every call returns `{ ok: false, error }` instead, and the callers carry on without it.
 *
 * On the boards home's first load (`useWelcome`): grades.ts is imported for its type only.
 */

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

interface QueryResult<T> {
  data: T | null;
  error: { message?: string; code?: string } | null;
}

export interface OnboardingClient {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): { maybeSingle(): PromiseLike<QueryResult<Record<string, unknown>>> };
    };
    insert(rows: Record<string, unknown>[]): {
      select(columns: string): { single(): PromiseLike<QueryResult<Record<string, unknown>>> };
    };
  };
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<QueryResult<unknown>>;
}

/**
 * The real `SupabaseClient` as an {@link OnboardingClient}. Relating supabase-js's client to a
 * slice with a `select(...).eq(...)` chain expands its column-parsing generics past TypeScript's
 * limit (TS2589, as in `asDeleteBoardClient`), so production code passes it through this one cast;
 * the methods used are exactly those the interface lists.
 */
export function asOnboardingClient(client: Pick<SupabaseClient, "from" | "rpc">): OnboardingClient {
  return client as unknown as OnboardingClient;
}

function errorText(error: { message?: string; code?: string } | null | undefined, fallback: string): string {
  return (error?.message ?? "").trim() || fallback;
}

/** 0..8 (`isGrade` in grades.ts, spelled out to keep that module off the home's first load). */
function gradeOf(value: unknown): Grade | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 8 ? (value as Grade) : null;
}

function toProfile(row: Record<string, unknown> | null | undefined): OnboardingProfile | null {
  if (!row) return null;
  const at = row.onboarded_at;
  return {
    course: isCourseId(row.course) ? row.course : null,
    grade: gradeOf(row.grade),
    onboarded_at: typeof at === "string" && at ? at : null,
  };
}

/**
 * The student's onboarding fields; `value: null` when they have no profile row. A database
 * without the migrations answers 42703 (no such column): an error, so the welcome stays hidden.
 */
export async function fetchOnboardingProfile(client: OnboardingClient, userId: string): Promise<Result<OnboardingProfile | null>> {
  try {
    const { data, error } = await client.from("profiles").select("course, grade, onboarded_at").eq("user_id", userId).maybeSingle();
    if (error) return { ok: false, error: errorText(error, "Couldn't read your profile.") };
    return { ok: true, value: toProfile(data) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface OnboardingSave {
  /** the course; "other" for a student with a grade (the welcome's `choiceSave`) */
  course?: CourseId | null;
  /** 0..8: sets the grade. Left out, a high-school course clears it (the RPC's rule) */
  grade?: Grade | null;
  /** "How did you hear about Agathon?": kept only the first time it is given */
  heardFrom?: HeardFrom | null;
  /** marks onboarding done */
  complete?: boolean;
}

/**
 * Stores the course, the grade and where they heard of us (each when given) and/or marks
 * onboarding done (`complete`). Anything the database would refuse is left out instead, so a stray
 * value never costs the student their save. `p_grade` and `p_heard_from` are sent only with a
 * value: a call without them is v1's call, so completing the tour still saves on a database the
 * v2 migration has not reached (PostgREST picks the function by its argument names).
 */
export async function saveOnboarding(client: OnboardingClient, { course, grade, heardFrom, complete = false }: OnboardingSave): Promise<Result<OnboardingProfile>> {
  try {
    const g = gradeOf(grade);
    const { data, error } = await client.rpc("save_onboarding", {
      p_course: isCourseId(course) ? course : null,
      p_complete: complete,
      ...(g === null ? {} : { p_grade: g }),
      ...(isHeardFrom(heardFrom) ? { p_heard_from: heardFrom } : {}),
    });
    if (error) return { ok: false, error: errorText(error, "Couldn't save your progress.") };
    const profile = toProfile(data && typeof data === "object" ? (data as Record<string, unknown>) : null);
    return profile ? { ok: true, value: profile } : { ok: false, error: "Unexpected reply from save_onboarding." };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Creates the student's first board (empty; the tutor writes the starter on it) and returns its id. */
export async function createFirstBoard(client: OnboardingClient, userId: string, title: string): Promise<Result<string>> {
  try {
    const { data, error } = await client.from("whiteboards").insert([{ title, data: {}, user_id: userId }]).select("id").single();
    if (error) return { ok: false, error: errorText(error, "The board was not created.") };
    const id = data?.id;
    return typeof id === "string" && id ? { ok: true, value: id } : { ok: false, error: "The board was not created." };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
