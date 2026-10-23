/**
 * The student's own calendar day. The free tutor's passes and "today" in SAT progress are counted
 * by the date where the student is, from the IANA time zone the iPad sends (`tz`).
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat | null {
  const hit = formatters.get(tz);
  if (hit) return hit;
  try {
    // en-CA formats a date as YYYY-MM-DD
    const f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
    if (formatters.size > 200) formatters.clear();
    formatters.set(tz, f);
    return f;
  } catch {
    return null;
  }
}

/** Is `tz` a time zone this runtime knows ("America/New_York", "UTC")? */
export function isTimeZone(tz: string): boolean {
  return formatter(tz) !== null;
}

/** The date (YYYY-MM-DD) at instant `at` in `tz`; UTC for a zone this runtime does not know. */
export function localDay(tz: string, at: number | Date = Date.now()): string {
  const f = formatter(tz) ?? formatter("UTC")!;
  const parts = f.formatToParts(typeof at === "number" ? new Date(at) : at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** The day before `day` (YYYY-MM-DD), by the calendar. */
export function previousDay(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** The day `n` days after `day` (YYYY-MM-DD), by the calendar (negative `n` goes back). */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
