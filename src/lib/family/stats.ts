/**
 * Each kid's three headline numbers on the grown-up's Family page: the Today's practice streak,
 * problems this week and skills mastered. A grown-up with several kids wants to see at a glance who
 * practised, without opening each kid's Progress page. Pure: the server reads the rows with the
 * service role (only the caller's own kids, src/lib/family/server/store.ts) and hands them here.
 *
 *  - streak             consecutive days with the daily set completed (`daily_practice.completed_at`),
 *                       ending today or yesterday: the same rule as Today's practice
 *                       (src/lib/daily/contracts.ts DailyStreak.current).
 *  - problemsThisWeek   problems worked (a line written, or a finished outcome) since Monday, the
 *                       same "worked" as the Progress page (src/lib/learning/summary.ts).
 *  - mastered           skills whose mastery is `mastered` by the Progress page's own rule
 *                       (`masteryOf`), per stored skill id, so the K–8 skills count as they arrive.
 *
 * Local days use the grown-up's time zone offset (minutes behind UTC, Date#getTimezoneOffset): the
 * family shares a home, and the daily rows carry each kid's own local date already.
 */
import type { AttemptOrigin, AttemptRecord, Outcome } from "@/lib/learning/contracts";
import { masteryOf } from "@/lib/learning/summary";
import type { KidStats } from "./members";

const DAY_MS = 86_400_000;

/** A `daily_practice` row, as much as the streak needs. */
export interface DailyStatRow {
  day: string;
  completed_at: string | null;
}

/** A `learning_attempts` row, as much as the numbers need. */
export interface AttemptStatRow {
  id: string;
  skill: string;
  origin: string;
  outcome: string;
  lines_written: number | null;
  started_at: string;
  updated_at?: string | null;
}

const FINISHED: ReadonlySet<string> = new Set(["first_try", "self_corrected", "with_help", "tutor_solved"]);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The local calendar date (YYYY-MM-DD) of `ms`, for an offset in minutes behind UTC. */
export function localDateOf(ms: number, tzOffsetMinutes = 0): string {
  return new Date(ms - tzOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

function dayBefore(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
}

/** Monday of the week `day` is in (YYYY-MM-DD). */
export function weekStartOf(day: string): string {
  const ms = Date.parse(`${day}T00:00:00Z`);
  const weekday = (new Date(ms).getUTCDay() + 6) % 7; // Monday 0 … Sunday 6
  return new Date(ms - weekday * DAY_MS).toISOString().slice(0, 10);
}

/** Days in a row with the daily set completed, ending `today` or the day before. */
export function dailyStreak(rows: readonly DailyStatRow[], today: string): number {
  const done = new Set(rows.filter((r) => r && r.completed_at && DAY_RE.test(r.day)).map((r) => r.day));
  let cursor = done.has(today) ? today : dayBefore(today);
  let streak = 0;
  while (done.has(cursor)) {
    streak++;
    cursor = dayBefore(cursor);
  }
  return streak;
}

function worked(a: AttemptStatRow): boolean {
  return (a.lines_written ?? 0) > 0 || FINISHED.has(a.outcome);
}

function record(a: AttemptStatRow): AttemptRecord {
  return {
    id: a.id,
    boardId: null,
    problemLatex: "",
    skill: a.skill as AttemptRecord["skill"],
    course: null,
    origin: a.origin as AttemptOrigin,
    parentId: null,
    outcome: a.outcome as Outcome,
    mistakes: {},
    activeMs: 0,
    startedAt: a.started_at,
    updatedAt: a.updated_at ?? a.started_at,
    finishedAt: null,
    linesWritten: a.lines_written ?? 0,
    linesRight: 0,
    linesRinged: 0,
    hints: 0,
    tutorSteps: 0,
    solves: 0,
    asks: 0,
  } as AttemptRecord;
}

/** Skills at `mastered` by the Progress page's rule, from one kid's attempts (any order). */
export function masteredCount(attempts: readonly AttemptStatRow[], now: number): number {
  const bySkill = new Map<string, AttemptStatRow[]>();
  for (const a of attempts) {
    if (!a || a.skill === "other" || !Number.isFinite(Date.parse(a.started_at)) || !worked(a)) continue;
    const list = bySkill.get(a.skill) ?? [];
    list.push(a);
    bySkill.set(a.skill, list);
  }
  let mastered = 0;
  for (const list of bySkill.values()) {
    const newestFirst = list.sort((x, y) => Date.parse(y.started_at) - Date.parse(x.started_at)).map(record);
    if (masteryOf(newestFirst, now).level === "mastered") mastered++;
  }
  return mastered;
}

/** One kid's three numbers. */
export function kidStats(input: {
  daily: readonly DailyStatRow[];
  attempts: readonly AttemptStatRow[];
  now: number;
  tzOffsetMinutes?: number;
}): KidStats {
  const tz = Number.isFinite(input.tzOffsetMinutes) ? (input.tzOffsetMinutes as number) : 0;
  const today = localDateOf(input.now, tz);
  const monday = weekStartOf(today);
  const problemsThisWeek = input.attempts.filter((a) => {
    const ms = Date.parse(a?.started_at);
    return Number.isFinite(ms) && worked(a) && localDateOf(ms, tz) >= monday;
  }).length;
  return {
    streak: dailyStreak(input.daily, today),
    problemsThisWeek,
    mastered: masteredCount(input.attempts, input.now),
  };
}
