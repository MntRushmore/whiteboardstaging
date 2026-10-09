/**
 * The weekly report's core: one child's week (`ChildWeek`, src/lib/report/contracts.ts) from their
 * learning record and Today's practice rows. Pure, so every number a parent reads has a test: the
 * server reads the rows (src/lib/report/server.ts, service role, the caller's own family only) and
 * hands them here, and the page and the Sunday email only format what comes back.
 *
 * The rules, chosen to agree with what the kid sees on their own Progress page and home:
 *  - A week is [local midnight Monday, local midnight next Monday) in the report's zone (week.ts).
 *    An attempt belongs to the week it STARTED in, as on the Progress page.
 *  - problems      attempts that finished (first_try, self_corrected, with_help, tutor_solved)
 *  - independent   of those, solved without help (INDEPENDENT_OUTCOMES)
 *  - minutes       the week's attempts' active time (any outcome), rounded
 *  - activeDays    local days with work: a line written or a finished outcome (summary.ts "worked")
 *  - mastery       `summarize` (src/lib/learning/summary.ts) over the record as it stood at the
 *                  week's start and at its end (or now, for the week under way): the same rule,
 *                  the same re-filing of old coarse rows, so "mastered this week" is exactly the
 *                  skills that turned `mastered` on Progress during it.
 *  - practised     the 4 skills with the most finished problems ("Other maths" only after named ones)
 *  - focus         the weakest skill worked this week that is not mastered (lowest mastery score at
 *                  the week's end), with a tip a parent can act on (tips.ts); when everything worked
 *                  on is mastered, the next skill on the kid's grade path; else null.
 *  - streak        Today's practice days in a row at the week's end (or today), the home's rule
 *                  (src/lib/family/stats.ts dailyStreak); dailySets, sets completed in the week.
 *  - highlight     the board with the most finished problems this week (ties: the most recent),
 *                  among the boards still there when `liveBoards` is given.
 */
import { dailyStreak } from "@/lib/family/stats";
import { ATTEMPT_ORIGINS, INDEPENDENT_OUTCOMES, isSkillId, MISTAKE_KINDS, OUTCOMES, SKILL_IDS, type AttemptOrigin, type AttemptRecord, type MistakeKind, type Outcome, type SkillId } from "@/lib/learning/contracts";
import { gradePath, isGrade, type Grade } from "@/lib/learning/grades";
import { refiled, summarize } from "@/lib/learning/summary";
import { isCourseId, type CourseId } from "@/lib/onboarding/courseIds";
import type { ChildWeek, WeeklyReport } from "./contracts";
import { focusTip, skillName, skillTip } from "./tips";
import { addDays, localDayIn, weekDays, weekRange } from "./week";

/** Skills listed under "What they practised". */
export const PRACTISED_SHOWN = 4;

const FINISHED: ReadonlySet<Outcome> = new Set(["first_try", "self_corrected", "with_help", "tutor_solved"]);

/** One `learning_attempts` row as the server reads it (snake_case, as stored). */
export interface ReportAttemptRow {
  id: string;
  board_id: string | null;
  problem_latex: string | null;
  skill: string;
  course: string | null;
  origin: string;
  outcome: string;
  lines_written: number | null;
  active_ms: number | null;
  mistakes: unknown;
  started_at: string;
  updated_at: string | null;
  finished_at: string | null;
}

/** One `daily_practice` row, as much as the report needs. */
export interface ReportDailyRow {
  /** the kid's local date, YYYY-MM-DD */
  day: string;
  completed_at: string | null;
}

/** One person whose week is told: their profile and rows. */
export interface ChildInput {
  userId: string;
  displayName: string;
  avatar: string | null;
  grade: number | null;
  course: string | null;
  /** any order; from LEARNING_LIMITS.readDays before the week's end, so mastery at its start is right */
  attempts: readonly ReportAttemptRow[];
  daily: readonly ReportDailyRow[];
  /** left out of the report when the week has nothing in it (the grown-up's own section) */
  optional?: boolean;
}

export interface WeekContext {
  /** the Monday, YYYY-MM-DD */
  weekStart: string;
  timeZone: string;
  now: number;
  /** boards still there (not deleted): the highlight is one of these; every board when absent */
  liveBoards?: ReadonlySet<string>;
}

const clampCount = (n: unknown): number => (typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

function cleanMistakes(raw: unknown): Partial<Record<MistakeKind, number>> {
  const out: Partial<Record<MistakeKind, number>> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const kind of MISTAKE_KINDS) {
    const n = clampCount((raw as Record<string, unknown>)[kind]);
    if (n > 0) out[kind] = n;
  }
  return out;
}

/** A stored row as the learning record's AttemptRecord, or null for one this code cannot read. */
export function toRecord(row: ReportAttemptRow): AttemptRecord | null {
  if (!row || typeof row.id !== "string" || !row.id) return null;
  if (!(ATTEMPT_ORIGINS as readonly string[]).includes(row.origin) || !(OUTCOMES as readonly string[]).includes(row.outcome)) return null;
  const started = Date.parse(row.started_at);
  if (!Number.isFinite(started)) return null;
  const startedAt = new Date(started).toISOString();
  const updated = row.updated_at ? Date.parse(row.updated_at) : NaN;
  const finished = row.finished_at ? Date.parse(row.finished_at) : NaN;
  return {
    id: row.id,
    boardId: typeof row.board_id === "string" && row.board_id ? row.board_id : null,
    problemLatex: typeof row.problem_latex === "string" ? row.problem_latex : "",
    skill: isSkillId(row.skill) ? row.skill : "other",
    course: isCourseId(row.course) ? row.course : null,
    origin: row.origin as AttemptOrigin,
    parentId: null,
    outcome: row.outcome as Outcome,
    mistakes: cleanMistakes(row.mistakes),
    activeMs: clampCount(row.active_ms),
    startedAt,
    updatedAt: Number.isFinite(updated) ? new Date(updated).toISOString() : startedAt,
    finishedAt: Number.isFinite(finished) ? new Date(finished).toISOString() : null,
    linesWritten: clampCount(row.lines_written),
    linesRight: 0,
    linesRinged: 0,
    hints: 0,
    tutorSteps: 0,
    solves: 0,
    asks: 0,
  };
}

/** One record per attempt id (its latest state), old coarse rows re-filed like the Progress page. */
function latestRecords(rows: readonly ReportAttemptRow[]): AttemptRecord[] {
  const byId = new Map<string, AttemptRecord>();
  for (const row of rows) {
    const r = toRecord(row);
    if (!r) continue;
    const seen = byId.get(r.id);
    if (!seen || Date.parse(r.updatedAt) > Date.parse(seen.updatedAt)) byId.set(r.id, r);
  }
  const skills = new Map<string, SkillId>();
  return [...byId.values()].map((r) => refiled(r, skills));
}

const worked = (a: AttemptRecord) => a.linesWritten > 0 || FINISHED.has(a.outcome);
const independent = (a: AttemptRecord) => INDEPENDENT_OUTCOMES.includes(a.outcome);

/** Each skill's mastery level and score from the record as it stood at `at` (attempts started before it). */
function masteryAt(records: readonly AttemptRecord[], at: number, opts: { grade: Grade | null; course: CourseId | null }) {
  const before = records.filter((r) => Date.parse(r.startedAt) < at);
  const summary = summarize(before, at, { grade: opts.grade, course: opts.course });
  return new Map(summary.skills.map((s) => [s.skill as string, { level: s.level, score: s.score }]));
}

const SKILL_ORDER = new Map<string, number>(SKILL_IDS.map((id, i) => [id, i]));
const orderOf = (id: string) => SKILL_ORDER.get(id) ?? SKILL_ORDER.size;

/** One child's week. */
export function buildChildWeek(input: ChildInput, ctx: WeekContext): ChildWeek {
  const { startMs, endMs } = weekRange(ctx.weekStart, ctx.timeZone);
  const cutoff = Math.min(endMs, Math.max(ctx.now, startMs));
  const grade = isGrade(input.grade) ? input.grade : null;
  const course = isCourseId(input.course) ? input.course : null;
  const records = latestRecords(input.attempts);
  const week = records.filter((r) => {
    const t = Date.parse(r.startedAt);
    return t >= startMs && t < endMs;
  });
  const finished = week.filter((r) => FINISHED.has(r.outcome));
  const workedWeek = week.filter(worked);

  // the numbers
  const minutes = Math.round(week.reduce((sum, r) => sum + r.activeMs, 0) / 60_000);
  const dayList = weekDays(ctx.weekStart);
  const perDay = new Map(dayList.map((d) => [d, 0]));
  for (const r of workedWeek) {
    const day = localDayIn(Date.parse(r.startedAt), ctx.timeZone);
    if (perDay.has(day)) perDay.set(day, perDay.get(day)! + 1);
  }
  const days = dayList.map((d) => perDay.get(d)!);

  // mastery at the week's start and at its end (or now)
  const before = masteryAt(records, startMs, { grade, course });
  const after = masteryAt(records, cutoff, { grade, course });
  const newlyMastered = [...after.entries()]
    .filter(([skill, m]) => skill !== "other" && m.level === "mastered" && before.get(skill)?.level !== "mastered")
    .sort((a, b) => orderOf(a[0]) - orderOf(b[0]))
    .map(([skill]) => skillName(skill));

  // what they practised
  const bySkill = new Map<string, { problems: number; independent: number; latest: number }>();
  for (const r of finished) {
    const s = bySkill.get(r.skill) ?? { problems: 0, independent: 0, latest: 0 };
    s.problems++;
    if (independent(r)) s.independent++;
    s.latest = Math.max(s.latest, Date.parse(r.startedAt));
    bySkill.set(r.skill, s);
  }
  const practised = [...bySkill.entries()]
    .sort((a, b) => Number(a[0] === "other") - Number(b[0] === "other") || b[1].problems - a[1].problems || b[1].independent - a[1].independent || orderOf(a[0]) - orderOf(b[0]))
    .slice(0, PRACTISED_SHOWN)
    .map(([skill, s]) => ({ skill, name: skillName(skill), problems: s.problems, independent: s.independent }));

  // next week's focus: the weakest skill worked on and not mastered, else the path's next skill
  const workedSkills = new Map<string, { count: number; mistakes: Partial<Record<MistakeKind, number>> }>();
  for (const r of workedWeek) {
    if (r.skill === "other") continue;
    const w = workedSkills.get(r.skill) ?? { count: 0, mistakes: {} };
    w.count++;
    for (const kind of MISTAKE_KINDS) {
      const n = r.mistakes[kind] ?? 0;
      if (n > 0) w.mistakes[kind] = (w.mistakes[kind] ?? 0) + n;
    }
    workedSkills.set(r.skill, w);
  }
  const weak = [...workedSkills.entries()]
    .map(([skill, w]) => ({ skill, ...w, mastery: after.get(skill) }))
    .filter((s) => s.mastery && s.mastery.level !== "mastered")
    .sort((a, b) => a.mastery!.score - b.mastery!.score || b.count - a.count || orderOf(a.skill) - orderOf(b.skill))[0];
  let focus: ChildWeek["focus"] = null;
  if (weak) {
    focus = { skill: weak.skill, name: skillName(weak.skill), tip: focusTip(weak.skill, weak.mistakes) };
  } else if (grade !== null) {
    const next = gradePath(grade).find((id) => after.get(id)?.level !== "mastered");
    if (next) focus = { skill: next, name: skillName(next), tip: skillTip(next) };
  }

  // Today's practice
  const lastDay = dayList[6];
  const today = localDayIn(cutoff - 1, ctx.timeZone);
  const streakDay = today < lastDay ? today : lastDay;
  const daily = input.daily.filter((d) => d && typeof d.day === "string");
  const dailySets = daily.filter((d) => d.completed_at && d.day >= ctx.weekStart && d.day <= lastDay).length;
  const streak = dailyStreak(
    daily.filter((d) => d.day <= streakDay),
    streakDay,
  );

  // the board to watch
  const boards = new Map<string, { problems: number; latest: number }>();
  for (const r of finished) {
    if (!r.boardId || (ctx.liveBoards && !ctx.liveBoards.has(r.boardId))) continue;
    const b = boards.get(r.boardId) ?? { problems: 0, latest: 0 };
    b.problems++;
    b.latest = Math.max(b.latest, Date.parse(r.startedAt));
    boards.set(r.boardId, b);
  }
  const highlight = [...boards.entries()].sort((a, b) => b[1].problems - a[1].problems || b[1].latest - a[1].latest)[0];

  return {
    userId: input.userId,
    displayName: input.displayName,
    avatar: input.avatar,
    grade,
    problems: finished.length,
    independent: finished.filter(independent).length,
    minutes,
    activeDays: days.filter((n) => n > 0).length,
    dailySets,
    streak,
    newlyMastered,
    practised,
    focus,
    highlightBoardId: highlight ? highlight[0] : null,
    days,
  };
}

/** Whether a week has anything to tell: a problem worked or a Today's practice set completed. */
export function hasActivity(week: Pick<ChildWeek, "problems" | "activeDays" | "dailySets">): boolean {
  return week.problems > 0 || week.activeDays > 0 || week.dailySets > 0;
}

/**
 * The whole report: one ChildWeek per person, in the order given, without the optional ones (the
 * grown-up's own section) whose week was empty.
 */
export function buildWeeklyReport(input: { ownerId: string; children: readonly ChildInput[]; generatedAt?: string } & WeekContext): WeeklyReport {
  const ctx: WeekContext = { weekStart: input.weekStart, timeZone: input.timeZone, now: input.now, liveBoards: input.liveBoards };
  const children = input.children.map((c) => ({ c, week: buildChildWeek(c, ctx) })).filter(({ c, week }) => !c.optional || hasActivity(week));
  return {
    weekStart: input.weekStart,
    timeZone: input.timeZone,
    ownerId: input.ownerId,
    children: children.map(({ week }) => week),
    generatedAt: input.generatedAt ?? new Date(input.now).toISOString(),
  };
}

/** The earliest moment whose attempts the report needs: the record's read window before the week's end. */
export function readSince(weekStart: string, readDays: number): string {
  return addDays(weekStart, 7 - readDays);
}
