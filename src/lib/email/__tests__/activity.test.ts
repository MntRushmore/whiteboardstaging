/**
 * What a family did, as the trial's emails say it (src/lib/email/activity.ts): safe names, skill
 * names, the streak, the summaries, "practiced since the welcome", and the one reader.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  ATTEMPT_READ_CAP,
  familyProgress,
  learnerNames,
  localDayIn,
  practiceStreak,
  practicedSinceOnboarding,
  readFamilyActivity,
  safeFirstName,
  shownLearners,
  skillTitle,
  summarizeLearner,
  type FamilyActivity,
  type LearnerActivity,
} from "@/lib/email/activity";

const NOW = new Date("2026-10-12T16:00:00Z"); // Sunday noon in New York
const SINCE = new Date("2026-10-08T16:00:00Z");

function learner(over: Partial<LearnerActivity> = {}): LearnerActivity {
  return { userId: "u1", displayName: "Maya Chen", isKid: false, onboardedAt: "2026-10-08T15:00:00Z", attempts: [], practice: [], ...over };
}
const attempt = (skill: string, outcome: string, startedAt = "2026-10-10T20:00:00Z") => ({ skill, outcome, startedAt });
const day = (d: string, done = 5, completed = true) => ({ day: d, done, goal: 5, completedAt: completed ? `${d}T20:00:00Z` : null });

describe("names", () => {
  it("keeps a first name of letters only, else no name", () => {
    expect(safeFirstName("Maya Chen")).toBe("Maya");
    expect(safeFirstName("  José ")).toBe("José");
    expect(safeFirstName("Anne-Marie")).toBe("Anne-Marie");
    expect(safeFirstName("O'Neil")).toBe("O'Neil");
    expect(safeFirstName("Zoë")).toBe("Zoë");
    expect(safeFirstName("evil.example")).toBeNull();
    expect(safeFirstName("https://evil.example")).toBeNull();
    expect(safeFirstName("Claim your prize")).toBe("Claim"); // one word: no sentence gets through
    expect(safeFirstName("<b>x</b>")).toBeNull();
    expect(safeFirstName("Kid42")).toBeNull();
    expect(safeFirstName("-Maya")).toBeNull();
    expect(safeFirstName("a".repeat(21))).toBeNull();
    expect(safeFirstName("")).toBeNull();
    expect(safeFirstName(null)).toBeNull();
  });

  it("names K-8 and original skills, never 'other' or an unknown id", () => {
    expect(skillTitle("times_tables")).toBe("Times tables");
    expect(skillTitle("fractions")).toBe("Fractions");
    expect(skillTitle("other")).toBeNull();
    expect(skillTitle("made_up")).toBeNull();
  });

  it("talks about the kids when there are any, else the account", () => {
    const solo: FamilyActivity = { learners: [learner()] };
    const family: FamilyActivity = { learners: [learner({ displayName: "Priya" }), learner({ userId: "k1", displayName: "Leo", isKid: true }), learner({ userId: "k2", displayName: "x1", isKid: true })] };
    expect(shownLearners(solo).map((l) => l.userId)).toEqual(["u1"]);
    expect(shownLearners(family).map((l) => l.userId)).toEqual(["k1", "k2"]);
    expect(learnerNames(family)).toEqual(["Leo"]);
    expect(learnerNames(solo)).toEqual(["Maya"]);
  });
});

describe("the numbers", () => {
  it("reads the day in New York", () => {
    expect(localDayIn(new Date("2026-10-12T03:00:00Z"))).toBe("2026-10-11");
    expect(localDayIn(NOW)).toBe("2026-10-12");
  });

  it("counts a streak of completed days ending today or yesterday", () => {
    expect(practiceStreak([day("2026-10-10"), day("2026-10-11"), day("2026-10-12")], "2026-10-12")).toBe(3);
    // today not done yet: the streak still stands until tomorrow
    expect(practiceStreak([day("2026-10-10"), day("2026-10-11")], "2026-10-12")).toBe(2);
    expect(practiceStreak([day("2026-10-09"), day("2026-10-11")], "2026-10-12")).toBe(1);
    expect(practiceStreak([day("2026-10-09"), day("2026-10-10")], "2026-10-12")).toBe(0);
    // started but not finished does not count
    expect(practiceStreak([day("2026-10-11", 2, false), day("2026-10-12", 5, false)], "2026-10-12")).toBe(1);
    expect(practiceStreak([], "2026-10-12")).toBe(0);
  });

  it("sums up a learner since the trial started", () => {
    const l = learner({
      attempts: [
        attempt("times_tables", "first_try"),
        attempt("times_tables", "self_corrected"),
        attempt("times_tables", "with_help"),
        attempt("add_fractions_like", "tutor_solved"),
        attempt("other", "in_progress"),
        attempt("long_division", "first_try", "2026-10-01T12:00:00Z"), // before the trial
      ],
      practice: [day("2026-10-11"), day("2026-10-12"), day("2026-10-05")],
    });
    expect(summarizeLearner(l, SINCE, NOW)).toEqual({
      name: "Maya",
      tried: 5,
      solved: 3,
      alone: 2,
      skills: ["Times tables", "Adding fractions"],
      streak: 2,
      practiceDays: 2,
    });
  });

  it("lists only the learners who did something, and nothing for a quiet family", () => {
    const family: FamilyActivity = {
      learners: [learner({ displayName: "Priya" }), learner({ userId: "k1", displayName: "Leo", isKid: true, attempts: [attempt("times_tables", "first_try")] }), learner({ userId: "k2", displayName: "Ava", isKid: true })],
    };
    expect(familyProgress(family, SINCE, NOW).map((p) => p.name)).toEqual(["Leo"]);
    expect(familyProgress({ learners: [learner()] }, SINCE, NOW)).toEqual([]);
  });

  it("counts the account's own work alongside its kids', as 'practiced since the welcome' does", () => {
    // Priya practises on the grown-up's login; her brother Leo, a kid profile, has not started
    const priya = learner({ displayName: "Priya", attempts: [attempt("times_tables", "first_try", "2026-10-09T20:00:00Z")], practice: [day("2026-10-09")] });
    const leo = learner({ userId: "k1", displayName: "Leo", isKid: true });
    const family: FamilyActivity = { learners: [priya, leo] };
    expect(practicedSinceOnboarding(family)).toBe(true);
    expect(familyProgress(family, SINCE, NOW)).toEqual([{ name: "Priya", tried: 1, solved: 1, alone: 1, skills: ["Times tables"], streak: 0, practiceDays: 1 }]);
    // the emails still name the kids
    expect(learnerNames(family)).toEqual(["Leo"]);

    // both at it: the kids first, then the account
    const both: FamilyActivity = { learners: [priya, { ...leo, attempts: [attempt("long_division", "with_help")] }] };
    expect(familyProgress(both, SINCE, NOW).map((p) => p.name)).toEqual(["Leo", "Priya"]);

    // the account's welcome problem only (before the trial, before onboarding): neither counts it
    const welcomeOnly: FamilyActivity = { learners: [learner({ attempts: [attempt("times_tables", "first_try", "2026-10-08T14:50:00Z")] }), leo] };
    expect(practicedSinceOnboarding(welcomeOnly)).toBe(false);
    expect(familyProgress(welcomeOnly, SINCE, NOW)).toEqual([]);
  });

  it("knows whether anyone practiced since the welcome", () => {
    const onboarded = "2026-10-08T15:00:00Z";
    expect(practicedSinceOnboarding({ learners: [learner({ onboardedAt: onboarded, attempts: [attempt("times_tables", "first_try", "2026-10-08T14:50:00Z")] })] })).toBe(false); // the welcome's own problem
    expect(practicedSinceOnboarding({ learners: [learner({ onboardedAt: onboarded, attempts: [attempt("times_tables", "first_try", "2026-10-08T15:30:00Z")] })] })).toBe(true);
    expect(practicedSinceOnboarding({ learners: [learner({ onboardedAt: null, attempts: [attempt("times_tables", "first_try", "2026-10-01T00:00:00Z")] })] })).toBe(true);
    expect(practicedSinceOnboarding({ learners: [learner(), learner({ userId: "k1", isKid: true, practice: [day("2026-10-09", 1, false)] })] })).toBe(true);
    expect(practicedSinceOnboarding({ learners: [learner()] })).toBe(false);
  });
});

/** A supabase-js stand-in: each table answers its rows; calls are recorded. */
function fakeDb(tables: Record<string, { data?: unknown[]; error?: { message: string } }>) {
  const calls: Array<[string, string, ...unknown[]]> = [];
  const db = {
    from(table: string) {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "gte", "order", "limit"]) {
        b[m] = (...args: unknown[]) => {
          calls.push([table, m, ...args]);
          return b;
        };
      }
      b.then = (resolve: (v: unknown) => unknown) => resolve({ data: tables[table]?.data ?? [], error: tables[table]?.error ?? null });
      return b;
    },
  };
  return { db: db as unknown as Pick<SupabaseClient, "from">, calls };
}

describe("readFamilyActivity", () => {
  it("reads the account and its kids, their attempts since `since` and their practice", async () => {
    const { db, calls } = fakeDb({
      family_members: { data: [{ child_id: "k1" }] },
      profiles: { data: [{ user_id: "u1", display_name: "Priya", onboarded_at: null }, { user_id: "k1", display_name: "Leo", onboarded_at: "2026-10-08T15:00:00Z" }] },
      learning_attempts: { data: [{ user_id: "k1", skill: "times_tables", outcome: "first_try", started_at: "2026-10-10T20:00:00Z" }, { user_id: "zz", skill: "x", outcome: "y", started_at: "2026-10-10T20:00:00Z" }] },
      daily_practice: { data: [{ user_id: "k1", day: "2026-10-11", done: 5, goal: 5, completed_at: "2026-10-11T20:00:00Z" }] },
    });
    const got = await readFamilyActivity(db, "u1", SINCE, NOW);
    expect(got).toEqual({
      learners: [
        { userId: "u1", displayName: "Priya", isKid: false, onboardedAt: null, attempts: [], practice: [] },
        {
          userId: "k1",
          displayName: "Leo",
          isKid: true,
          onboardedAt: "2026-10-08T15:00:00Z",
          attempts: [{ skill: "times_tables", outcome: "first_try", startedAt: "2026-10-10T20:00:00Z" }],
          practice: [{ day: "2026-10-11", done: 5, goal: 5, completedAt: "2026-10-11T20:00:00Z" }],
        },
      ],
    });
    expect(calls).toContainEqual(["family_members", "eq", "parent_id", "u1"]);
    expect(calls).toContainEqual(["learning_attempts", "in", "user_id", ["u1", "k1"]]);
    expect(calls).toContainEqual(["learning_attempts", "gte", "started_at", SINCE.toISOString()]);
    expect(calls).toContainEqual(["learning_attempts", "limit", ATTEMPT_READ_CAP]);
  });

  it("answers an error for the account or its attempts, and carries on without Today's practice", async () => {
    expect(await readFamilyActivity(fakeDb({ family_members: { error: { message: "down" } } }).db, "u1", SINCE, NOW)).toEqual({ error: "family_members: down" });
    expect(await readFamilyActivity(fakeDb({ learning_attempts: { error: { message: "slow" } } }).db, "u1", SINCE, NOW)).toEqual({ error: "learning_attempts: slow" });
    const noPractice = await readFamilyActivity(fakeDb({ daily_practice: { error: { message: "missing" } } }).db, "u1", SINCE, NOW);
    expect(noPractice).toEqual({ learners: [{ userId: "u1", displayName: null, isKid: false, onboardedAt: null, attempts: [], practice: [] }] });
    const throwing = { from: () => { throw new Error("boom"); } } as unknown as Pick<SupabaseClient, "from">;
    expect(await readFamilyActivity(throwing, "u1", SINCE, NOW)).toEqual({ error: "boom" });
  });
});
