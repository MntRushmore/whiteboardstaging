/**
 * Today's practice (2026-10-09, "kids come back"): one big button on the home that gives the student
 * a short daily set — a few problems picked from their path and their learning record — on a board
 * of its own, with stars as they finish problems, a celebration at the goal, and a streak of days.
 *
 * Shared contract for the K–8 build (docs/KIDS-COME-BACK.md). The table is `daily_practice`
 * (supabase/migrations/20261009000000_kids_come_back.sql), written only through the
 * `save_daily_practice` RPC (one row per student per local day; counts only go up).
 *
 *   home: TodayCard ── planDailySet() ──► board created ──► practice marker (problems) + daily marker
 *                                                    │
 *   board: PracticeBoard writes the problems ◄───────┘      DailyBoard (lazy, `hasDailyMarker`)
 *          learningBus.onAttempt ──► done / stars ──► save_daily_practice ──► the celebration at the goal
 */

/** Problems in a day's set. */
export const DAILY_GOAL = 5;

/** Why a problem is in the set: the path's next skill, a weak spot, or a review of one mastered. */
export const DAILY_REASONS = ["next", "weak", "review"] as const;
export type DailyReason = (typeof DAILY_REASONS)[number];

export interface DailyProblem {
  /** a skill id (`SKILLS`, or a K–8 skill from `grades.ts`) */
  skill: string;
  /** the problem's LaTeX lines, as `write_problems` takes them */
  lines: string[];
  why: DailyReason;
}

export interface DailyPlan {
  /** the student's local calendar date, YYYY-MM-DD */
  day: string;
  goal: number;
  problems: DailyProblem[];
}

/** One `daily_practice` row, camelCased. */
export interface DailyRow {
  day: string;
  boardId: string | null;
  goal: number;
  /** problems finished on the day's board (any outcome but in_progress / unfinished) */
  done: number;
  /** problems the student solved themselves (first_try, self_corrected): one star each */
  stars: number;
  /** ISO, when `done` reached `goal` */
  completedAt: string | null;
}

/** `before`: a day before the student's first Today's practice (a new student's week is not "missed"). */
export type DayState = "done" | "started" | "missed" | "today" | "future" | "before";

export interface DailyStreak {
  /** consecutive local days with the set completed, ending today or yesterday */
  current: number;
  best: number;
  todayDone: boolean;
  /** this week, Monday first: one entry per day */
  week: { day: string; state: DayState }[];
}

/** The local calendar date of `at`, YYYY-MM-DD (the device's time zone). */
export function localDay(at: Date = new Date()): string {
  const y = at.getFullYear();
  const m = String(at.getMonth() + 1).padStart(2, "0");
  const d = String(at.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
