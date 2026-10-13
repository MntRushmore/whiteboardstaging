/**
 * Fakes for the /start account tests: a localStorage, and a Supabase client that keeps one profile
 * and a board list the way the database would (save_onboarding v2's rules, the display name only
 * over none), and can be told to fail at each step.
 */
import type { StartClient } from "../finish";

export type FakeStorage = Pick<Storage, "getItem" | "setItem" | "removeItem"> & { data: Map<string, string> };

export function fakeStorage(seed: Record<string, string> = {}): FakeStorage {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, String(v)),
    removeItem: (k) => void data.delete(k),
  };
}

export interface FakeProfile {
  display_name: string | null;
  course: string | null;
  grade: number | null;
  heard_from: string | null;
  onboarded_at: string | null;
}

export interface FakeDbOptions {
  saveError?: boolean;
  nameError?: boolean;
  boardError?: boolean;
  /** the rpc throws instead of answering (a client bug) */
  rpcThrows?: boolean;
  profile?: Partial<FakeProfile>;
}

export function fakeDb(opts: FakeDbOptions = {}) {
  const profile: FakeProfile = { display_name: null, course: null, grade: null, heard_from: null, onboarded_at: null, ...opts.profile };
  const calls = {
    rpc: [] as { fn: string; args: Record<string, unknown> }[],
    updates: [] as { values: Record<string, unknown>; eq: [string, string]; is: [string, null] }[],
    boards: [] as Record<string, unknown>[],
  };
  const client = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (opts.rpcThrows) throw new Error("rpc exploded");
      calls.rpc.push({ fn, args });
      if (opts.saveError) return { data: null, error: { message: "save_onboarding failed" } };
      if (typeof args.p_course === "string") profile.course = args.p_course;
      if (typeof args.p_grade === "number") profile.grade = args.p_grade;
      else if (typeof args.p_course === "string" && args.p_course !== "other") profile.grade = null;
      profile.heard_from ??= typeof args.p_heard_from === "string" ? args.p_heard_from : null;
      if (args.p_complete) profile.onboarded_at ??= "2026-10-13T12:00:00Z";
      return { data: { course: profile.course, grade: profile.grade, heard_from: profile.heard_from, onboarded_at: profile.onboarded_at }, error: null };
    },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: table === "profiles" ? { ...profile } : null, error: null }),
        }),
      }),
      insert: (rows: Record<string, unknown>[]) => ({
        select: () => ({
          single: async () => {
            if (opts.boardError) return { data: null, error: { message: "insert refused" } };
            calls.boards.push(rows[0]);
            return { data: { id: `board-${calls.boards.length}` }, error: null };
          },
        }),
      }),
      update: (values: Record<string, unknown>) => ({
        eq: (eqCol: string, eqVal: string) => ({
          is: (isCol: string, isVal: null) => ({
            select: async () => {
              calls.updates.push({ values, eq: [eqCol, eqVal], is: [isCol, isVal] });
              if (opts.nameError) return { data: null, error: { message: "permission denied" } };
              if (profile.display_name !== null) return { data: [], error: null };
              profile.display_name = values.display_name as string;
              return { data: [{ display_name: profile.display_name }], error: null };
            },
          }),
        }),
      }),
    }),
  };
  return { client: client as unknown as StartClient, calls, profile };
}
