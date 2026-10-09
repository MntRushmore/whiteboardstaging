/**
 * The report page's formatting, pure so it has tests: the week's label ("Oct 5 – 11"), the week
 * picker's choices, the practised skills' bar widths, and the server's answer read defensively (a
 * page that gets something odd shows "couldn't load", never a crash). No React, no network.
 */
import { isAvatarId } from "@/lib/family/contracts";
import { gradeLabel, isGrade } from "@/lib/learning/grades";
import type { ChildWeek, ReportAnswer, ReportRole, WeeklyReport } from "./contracts";
import { REPORT_COPY } from "./copy";
import { addDays, isDay, recentWeeks } from "./week";

/** Weeks offered under "Earlier" (after this week and last week). */
export const EARLIER_WEEKS = 10;

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const DAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"] as const;
export const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

function parts(day: string): { y: number; m: number; d: number } {
  const [y, m, d] = day.split("-").map(Number);
  return { y, m, d };
}

/** "Oct 5 – 11", "Sep 28 – Oct 4", and "Dec 28, 2026 – Jan 3, 2027" across a new year. */
export function weekLabel(weekStart: string): string {
  const a = parts(weekStart);
  const b = parts(addDays(weekStart, 6));
  if (a.y !== b.y) return `${MONTH[a.m - 1]} ${a.d}, ${a.y} – ${MONTH[b.m - 1]} ${b.d}, ${b.y}`;
  if (a.m !== b.m) return `${MONTH[a.m - 1]} ${a.d} – ${MONTH[b.m - 1]} ${b.d}`;
  return `${MONTH[a.m - 1]} ${a.d} – ${b.d}`;
}

export type WeekChoice = "this" | "last" | "earlier";

/** The picker's state for a week: this week, last week, or one of the earlier ones. */
export function weekChoice(weekStart: string, now: number, timeZone: string): WeekChoice {
  const [current, last] = recentWeeks(now, timeZone, 2);
  return weekStart === current ? "this" : weekStart === last ? "last" : "earlier";
}

/** The earlier weeks the picker lists (two weeks ago and before), labelled. */
export function earlierWeeks(now: number, timeZone: string, count = EARLIER_WEEKS): { value: string; label: string }[] {
  return recentWeeks(now, timeZone, count + 2)
    .slice(2)
    .map((w) => ({ value: w, label: weekLabel(w) }));
}

/**
 * The "Earlier" list for the picker while `weekStart` is shown: the EARLIER_WEEKS weeks, and the
 * shown week at the end when it is older than those (a link may open any week up to a year back),
 * so the list always names the week on screen.
 */
export function earlierWeekOptions(weekStart: string, now: number, timeZone: string, count = EARLIER_WEEKS): { value: string; label: string }[] {
  const list = earlierWeeks(now, timeZone, count);
  if (weekChoice(weekStart, now, timeZone) !== "earlier" || list.some((w) => w.value === weekStart)) return list;
  return [...list, { value: weekStart, label: weekLabel(weekStart) }];
}

/**
 * What a failed read leaves in place of `prev`: a good read already shown for the same `failed.key`
 * stays (a background re-read that fails never swaps a report on screen for the error); anything
 * else becomes `failed`.
 */
export function afterFailedRead<R extends { key: string }>(prev: R | null, failed: R, good: (read: R) => boolean): R {
  return prev && prev.key === failed.key && good(prev) ? prev : failed;
}

/** The Monday for a picker choice ("earlier" opens two weeks back). */
export function weekForChoice(choice: WeekChoice, now: number, timeZone: string): string {
  const weeks = recentWeeks(now, timeZone, 3);
  return choice === "this" ? weeks[0] : choice === "last" ? weeks[1] : weeks[2];
}

/** A grade as the report shows it ("3rd grade"), or the no-grade line. */
export function gradeText(grade: number | null): string {
  return isGrade(grade) ? (gradeLabel(grade) ?? REPORT_COPY.gradeNone) : REPORT_COPY.gradeNone;
}

/** "Times tables", "Times tables and Long division", "A, B and C". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Each practised skill's bar: its width against the busiest skill, and the solved-alone share inside it (both 0..100). */
export function practisedBars(practised: ChildWeek["practised"]): { skill: string; width: number; alone: number }[] {
  const max = Math.max(1, ...practised.map((p) => p.problems));
  return practised.map((p) => ({
    skill: p.skill,
    width: Math.max(8, Math.round((p.problems / max) * 100)),
    alone: p.problems > 0 ? Math.round((Math.min(p.independent, p.problems) / p.problems) * 100) : 0,
  }));
}

/** A day's dot strength in the week strip: 0 none, 1 a little, 2 some, 3 a lot. */
export function dayLevel(problems: number): 0 | 1 | 2 | 3 {
  return problems <= 0 ? 0 : problems < 3 ? 1 : problems < 6 ? 2 : 3;
}

/** Whether a whole report has nothing in it (every week empty). */
export function reportIsQuiet(report: WeeklyReport): boolean {
  return report.children.every((c) => c.problems === 0 && c.activeDays === 0 && c.dailySets === 0);
}

// ------------------------------------------------------------------ reading the answer

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const count = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);
const text = (v: unknown, max = 200): string | null => (typeof v === "string" && v.length <= max ? v : null);

function parseChild(raw: unknown): ChildWeek | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const numbers = ["problems", "independent", "minutes", "activeDays", "dailySets", "streak"].map((k) => count(r[k]));
  if (typeof r.userId !== "string" || !UUID.test(r.userId) || text(r.displayName) === null || numbers.some((n) => n === null)) return null;
  const [problems, independent, minutes, activeDays, dailySets, streak] = numbers as number[];
  const practised = Array.isArray(r.practised)
    ? r.practised.flatMap((p) => {
        const q = (p ?? {}) as Record<string, unknown>;
        const n = count(q.problems);
        const alone = count(q.independent);
        return text(q.skill, 40) && text(q.name) && n !== null && alone !== null ? [{ skill: q.skill as string, name: q.name as string, problems: n, independent: alone }] : [];
      })
    : [];
  const f = (r.focus ?? null) as Record<string, unknown> | null;
  const focus = f && text(f.skill, 40) && text(f.name) && text(f.tip, 400) ? { skill: f.skill as string, name: f.name as string, tip: f.tip as string } : null;
  const days = Array.isArray(r.days) && r.days.length === 7 && r.days.every((d) => count(d) !== null) ? (r.days as number[]) : undefined;
  return {
    userId: r.userId,
    displayName: r.displayName as string,
    avatar: isAvatarId(r.avatar) ? r.avatar : null,
    grade: isGrade(r.grade) ? r.grade : null,
    problems,
    independent,
    minutes,
    activeDays,
    dailySets,
    streak,
    newlyMastered: Array.isArray(r.newlyMastered) ? r.newlyMastered.filter((n): n is string => text(n) !== null) : [],
    practised,
    focus,
    highlightBoardId: typeof r.highlightBoardId === "string" && UUID.test(r.highlightBoardId) ? r.highlightBoardId : null,
    ...(days ? { days } : {}),
  };
}

/** GET /api/report's body as the page uses it, or null for anything malformed. Never throws. */
export function parseReportAnswer(raw: unknown): ReportAnswer | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const rep = (r.report ?? null) as Record<string, unknown> | null;
  if (!rep || !isDay(rep.weekStart) || text(rep.timeZone, 64) === null || typeof rep.ownerId !== "string" || !Array.isArray(rep.children)) return null;
  const children = rep.children.map(parseChild);
  if (children.some((c) => c === null)) return null;
  const role = r.role === "solo" || r.role === "parent" || r.role === "kid" ? (r.role as ReportRole) : null;
  if (!role) return null;
  const e = (r.email ?? null) as Record<string, unknown> | null;
  return {
    report: {
      weekStart: rep.weekStart as string,
      timeZone: rep.timeZone as string,
      ownerId: rep.ownerId,
      children: children as ChildWeek[],
      generatedAt: typeof rep.generatedAt === "string" ? rep.generatedAt : "",
    },
    role,
    email: e && typeof e.optedOut === "boolean" && typeof e.sending === "boolean" ? { optedOut: e.optedOut, sending: e.sending } : null,
  };
}
