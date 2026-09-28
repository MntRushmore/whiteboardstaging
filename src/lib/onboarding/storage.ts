import type { SupabaseClient } from "@supabase/supabase-js";
import { isCourseId, type CourseId } from "./courseIds";
import type { OnboardingProfile } from "./state";

/**
 * Onboarding's reads and writes, as the student (their JWT; RLS and the RPC act on auth.uid()):
 *
 * - `profiles.course, profiles.onboarded_at` are read with the owner-select policy;
 * - both are written only by `save_onboarding(p_course, p_complete)` (a SECURITY DEFINER RPC:
 *   course validated, onboarded_at stamped once) — a user has no update grant on them;
 * - the first board is an ordinary `whiteboards` insert, owned by the student.
 *
 * The client is structural (only the calls used here), so the tests pass a fake. Nothing throws:
 * every call returns `{ ok: false, error }` instead, and the callers carry on without it.
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

function toProfile(row: Record<string, unknown> | null | undefined): OnboardingProfile | null {
  if (!row) return null;
  const at = row.onboarded_at;
  return {
    course: isCourseId(row.course) ? row.course : null,
    onboarded_at: typeof at === "string" && at ? at : null,
  };
}

/**
 * The student's onboarding fields; `value: null` when they have no profile row. A database
 * without the migration answers 42703 (no such column): an error, so the welcome stays hidden.
 */
export async function fetchOnboardingProfile(client: OnboardingClient, userId: string): Promise<Result<OnboardingProfile | null>> {
  try {
    const { data, error } = await client.from("profiles").select("course, onboarded_at").eq("user_id", userId).maybeSingle();
    if (error) return { ok: false, error: errorText(error, "Couldn't read your profile.") };
    return { ok: true, value: toProfile(data) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Stores the course (when given) and/or marks onboarding done (`complete`). */
export async function saveOnboarding(
  client: OnboardingClient,
  { course, complete = false }: { course?: CourseId | null; complete?: boolean },
): Promise<Result<OnboardingProfile>> {
  try {
    const { data, error } = await client.rpc("save_onboarding", {
      p_course: isCourseId(course) ? course : null,
      p_complete: complete,
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
