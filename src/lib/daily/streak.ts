/**
 * The Today's practice streak (src/lib/daily/contracts.ts): the student's `daily_practice` rows in,
 * how many days in a row they finished the set, their best run, and this week's days out. The
 * home's flame and day dots draw it, and the board's celebration says "4 days in a row" with it.
 *
 * Days are the student's LOCAL calendar dates (YYYY-MM-DD, `localDay`), as the rows store them. All
 * the arithmetic here is on those strings through UTC dates, so a daylight-saving change never moves
 * a day. A missed day breaks the streak; today not done YET keeps yesterday's streak alive, because
 * the day is not over.
 *
 * Pure, no imports but types: unit-tested in `__tests__/streak.test.ts`.
 */
import type { DailyRow, DailyStreak, DayState } from "./contracts";

const DAY_MS = 86_400_000;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A YYYY-MM-DD day as UTC midnight ms, or NaN when it is not one. */
function dayMs(day: string): number {
  const m = DAY_RE.exec(day);
  if (!m) return Number.NaN;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  // 2026-02-31 is not a day: Date.UTC rolls it over, so the round trip tells
  return new Date(ms).toISOString().slice(0, 10) === day ? ms : Number.NaN;
}

/** True when `day` is a real calendar date written YYYY-MM-DD. */
export function isDay(day: unknown): day is string {
  return typeof day === "string" && Number.isFinite(dayMs(day));
}

/** The day `n` days after `day` (before, for a negative `n`). Calendar arithmetic, never clock time. */
export function addDays(day: string, n: number): string {
  const ms = dayMs(day);
  if (!Number.isFinite(ms)) return day;
  return new Date(ms + Math.round(n) * DAY_MS).toISOString().slice(0, 10);
}

/** The Monday of `day`'s week: the week strip starts there, as a school week does. */
export function mondayOf(day: string): string {
  const ms = dayMs(day);
  if (!Number.isFinite(ms)) return day;
  // getUTCDay: Sunday 0 … Saturday 6; Monday-first means Sunday is the 7th day
  const back = (new Date(ms).getUTCDay() + 6) % 7;
  return addDays(day, -back);
}

/** A day counts once its set was finished: stamped complete, or as many done as the goal. */
export function isDayDone(row: Pick<DailyRow, "done" | "goal" | "completedAt"> | undefined | null): boolean {
  if (!row) return false;
  return row.completedAt !== null || (row.goal > 0 && row.done >= row.goal);
}

/** A day was started: a board was made for it, or a problem finished on it. */
function isDayStarted(row: Pick<DailyRow, "done" | "boardId"> | undefined): boolean {
  return Boolean(row && (row.done > 0 || row.boardId));
}

/** The rows by day; a day's best row wins when one appears twice (it never should: one per day). */
function byDay(rows: readonly DailyRow[]): Map<string, DailyRow> {
  const out = new Map<string, DailyRow>();
  for (const row of rows) {
    if (!row || !isDay(row.day)) continue;
    const seen = out.get(row.day);
    if (!seen || (isDayDone(row) && !isDayDone(seen)) || row.done > seen.done) out.set(row.day, row);
  }
  return out;
}

/**
 * The streak and this week from the student's rows, `today` being their local date. A day that is
 * not a real date is skipped; rows after today (a clock that was wrong) are ignored.
 */
export function dailyStreak(rows: readonly DailyRow[], today: string): DailyStreak {
  const days = byDay(rows);
  const doneOn = (day: string) => isDayDone(days.get(day));
  const todayDone = doneOn(today);

  // current: back from today when it is done, else from yesterday (today can still be done)
  let current = 0;
  for (let day = todayDone ? today : addDays(today, -1); doneOn(day); day = addDays(day, -1)) current++;

  // best: the longest run of consecutive done days up to today
  const doneDays = [...days.keys()].filter((d) => d <= today && doneOn(d)).sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const day of doneDays) {
    run = prev !== null && addDays(prev, 1) === day ? run + 1 : 1;
    best = Math.max(best, run);
    prev = day;
  }
  best = Math.max(best, current);

  // a day before the student's first set (a new student, or one from before Today's practice) is
  // not a missed one: missing starts counting from their first set, today for someone with none yet
  const first = [...days.keys()].filter((d) => d <= today).sort()[0] ?? today;
  const monday = mondayOf(today);
  const week = Array.from({ length: 7 }, (_, i) => {
    const day = addDays(monday, i);
    const row = days.get(day);
    return { day, state: day < first && !row ? ("before" as const) : dayState(day, today, row) };
  });

  return { current, best, todayDone, week };
}

function dayState(day: string, today: string, row: DailyRow | undefined): DayState {
  if (day > today) return "future";
  if (isDayDone(row)) return "done";
  if (isDayStarted(row)) return "started";
  return day === today ? "today" : "missed";
}

/** A row with today's progress folded in (the board's count can be ahead of the last save). */
export function withProgress(rows: readonly DailyRow[], day: string, progress: { done: number; stars: number; goal: number; boardId?: string | null }): DailyRow[] {
  const existing = rows.find((r) => r.day === day);
  // done ≥ goal is what makes the day count (`isDayDone`), stamped or not
  const merged: DailyRow = {
    day,
    boardId: existing?.boardId ?? progress.boardId ?? null,
    goal: existing?.goal ?? progress.goal,
    done: Math.max(existing?.done ?? 0, progress.done),
    stars: Math.max(existing?.stars ?? 0, progress.stars),
    completedAt: existing?.completedAt ?? null,
  };
  return [...rows.filter((r) => r.day !== day), merged];
}
