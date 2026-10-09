/**
 * The weekly report's calendar: weeks run Monday to Sunday in the grown-up's time zone. A parent
 * reads "this week" as their own week, so the edges are local midnights (an IANA zone, through
 * Intl), not UTC ones and not one fixed offset: a week that crosses a daylight-saving change still
 * starts and ends at midnight on the family's clock. Pure: the zone and the moment in, dates out.
 *
 * The server has no stored zone for an account (the cron has no browser), so it falls back to
 * DEFAULT_REPORT_TZ, where Agathon's families are (the emails say dates in the same zone).
 */

/** The zone a report is read in when none (or an unknown one) is given. */
export const DEFAULT_REPORT_TZ = "America/New_York";

const DAY_MS = 86_400_000;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** How far back the week picker (and GET /api/report) goes: a year of weeks. */
export const OLDEST_WEEK_BACK = 52;

const formatters = new Map<string, Intl.DateTimeFormat>();

/** One wall-clock formatter per zone (making them is the slow part). Throws for an unknown zone. */
function wallClock(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** True for an IANA zone this runtime knows ("America/Chicago", "UTC"). */
export function isTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) return false;
  try {
    wallClock(value);
    return true;
  } catch {
    return false;
  }
}

/** `value` when it is a known zone, else the default: a bad `?tz=` never breaks the report. */
export function reportTimeZone(value: unknown): string {
  return isTimeZone(value) ? value : DEFAULT_REPORT_TZ;
}

/** The wall-clock parts of `ms` in `timeZone`. */
function partsOf(ms: number, timeZone: string): { y: number; m: number; d: number; h: number; mi: number; s: number } {
  const out: Record<string, number> = {};
  for (const p of wallClock(timeZone).formatToParts(new Date(ms))) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return { y: out.year, m: out.month, d: out.day, h: out.hour === 24 ? 0 : out.hour, mi: out.minute, s: out.second };
}

/** How far `timeZone`'s clock is ahead of UTC at `ms` (negative west of Greenwich). */
function offsetAt(ms: number, timeZone: string): number {
  const p = partsOf(ms, timeZone);
  const wall = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return wall - (ms - (((ms % 1000) + 1000) % 1000));
}

/** The calendar date (YYYY-MM-DD) of `ms` in `timeZone`. */
export function localDayIn(ms: number, timeZone: string): string {
  const p = partsOf(ms, timeZone);
  return `${String(p.y).padStart(4, "0")}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/** True for a real calendar date written YYYY-MM-DD. */
export function isDay(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = DAY_RE.exec(value);
  if (!m) return false;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

/** `day` moved by `n` calendar days (no zone involved: dates only). */
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** The Monday of the week `day` is in. */
export function mondayOf(day: string): string {
  const weekday = (new Date(Date.parse(`${day}T00:00:00Z`)).getUTCDay() + 6) % 7; // Monday 0 … Sunday 6
  return addDays(day, -weekday);
}

/** The instant local midnight starts `day` in `timeZone` (the first moment of that date there). */
export function zonedMidnight(day: string, timeZone: string): number {
  const guess = Date.parse(`${day}T00:00:00Z`);
  const first = guess - offsetAt(guess, timeZone);
  // across a daylight-saving change the offset at the answer can differ from the guess's
  const second = guess - offsetAt(first, timeZone);
  return localDayIn(second, timeZone) === day ? second : first;
}

/** The Monday starting the week `ms` falls in, in `timeZone`. */
export function weekStartAt(ms: number, timeZone: string): string {
  return mondayOf(localDayIn(ms, timeZone));
}

/** A week's edges as instants: [startMs, endMs), local midnight Monday to the next local midnight Monday. */
export function weekRange(weekStart: string, timeZone: string): { startMs: number; endMs: number } {
  return { startMs: zonedMidnight(weekStart, timeZone), endMs: zonedMidnight(addDays(weekStart, 7), timeZone) };
}

/** The seven dates of a week, Monday first. */
export function weekDays(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

/** A week's Monday from `?week=` (any date in it is accepted), or null when it is not a date. */
export function parseWeek(raw: unknown): string | null {
  return isDay(raw) ? mondayOf(raw) : null;
}

/** The weeks the report can show at `now`: this week first, then each one before it (`count` in all). */
export function recentWeeks(now: number, timeZone: string, count = OLDEST_WEEK_BACK + 1): string[] {
  const current = weekStartAt(now, timeZone);
  return Array.from({ length: Math.max(1, count) }, (_, i) => addDays(current, -7 * i));
}

/** Whether `weekStart` is a week the report shows at `now`: not in the future, at most a year back. */
export function isReportableWeek(weekStart: string, now: number, timeZone: string): boolean {
  const current = weekStartAt(now, timeZone);
  return weekStart <= current && weekStart >= addDays(current, -7 * OLDEST_WEEK_BACK);
}
