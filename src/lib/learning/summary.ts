/**
 * Mastery and the Progress page's numbers from the learning record, and what the tutor is told
 * about the student (`learnerHint`). Pure: the attempts in, the summary out.
 *
 * WHICH ATTEMPTS COUNT. A problem the tutor wrote that the student never touched (unfinished, no
 * line written) is not work and counts nowhere. "Worked" attempts — a line written, or a finished
 * outcome (solved by the student, with help, or by the tutor) — are the totals, the days, the
 * streak and the recent list. Mastery reads "counted" attempts: worked and over (`in_progress`
 * does not count yet; `unfinished` counts only with a line written, as evidence of a struggle).
 *
 * MASTERY, per skill, from its last 8 counted attempts, newest first:
 *
 *   value      first_try 1 · self_corrected 0.8 · with_help 0.35 · tutor_solved 0 · unfinished 0
 *   weight     0.85^i for the i-th newest (0 for the newest), × 0.5 when it started more than 30
 *              days ago, × 1.5 for a "Now you try" problem the student solved alone
 *   score      Σ weight · value / Σ weight, 0..1
 *
 *   new        no counted attempt
 *   mastered   score ≥ 0.8, at least 3 of the last 5 counted attempts solved alone (first try or
 *              self-corrected), and the newest one solved alone
 *   practicing score < 0.5, or fewer than 2 counted attempts
 *   almost     anything between
 *
 * Mastery is earned only by work the student did alone: help, a tutor's solution or a worked
 * example taught on the board are worth little or nothing, and the newest attempt must be the
 * student's own. A problem solved alone right after the tutor solved one like it ("Now you try")
 * is the strongest evidence there is that the student learned it, so it weighs half again as much.
 *
 * LOCAL DAYS use the student's time zone offset (`Date#getTimezoneOffset`: minutes behind UTC); one
 * offset for the whole range, so a daylight-saving change within it moves the hour of an attempt,
 * never more than one day's edge. The skill "Other maths" is never a weak or strong skill (nothing
 * can be practised or praised under it).
 */
import type { CourseId } from "@/lib/onboarding/courseIds";
import { INDEPENDENT_OUTCOMES, LEARNING_LIMITS, MISTAKE_KINDS, SKILLS, skillDef, type AttemptRecord, type DayActivity, type LearningSummary, type MasteryLevel, type MistakeKind, type Outcome, type SkillId, type SkillProgress } from "./contracts";
import type { LearnerHint } from "./hint";

export interface SummarizeOptions {
  /** the student's course: its skills are listed (level `new`) before they are practised */
  course?: CourseId | null;
  /** the student's time zone offset in minutes (Date#getTimezoneOffset), for local days; default 0 */
  tzOffsetMinutes?: number;
}

const DAY_MS = 86_400_000;

/** How much each outcome says the student can do it alone. */
export const OUTCOME_VALUE: Readonly<Record<Exclude<Outcome, "in_progress">, number>> = {
  first_try: 1,
  self_corrected: 0.8,
  with_help: 0.35,
  tutor_solved: 0,
  unfinished: 0,
};

export const MASTERY = {
  /** counted attempts read per skill */
  window: 8,
  /** each older attempt weighs this much of the one after it */
  decay: 0.85,
  /** an attempt older than this weighs half */
  staleDays: 30,
  staleWeight: 0.5,
  /** a Now you try problem (offered after the tutor solved or helped with one like it) solved alone */
  strongWeight: 1.5,
  mastered: 0.8,
  practicing: 0.5,
  /** solved alone, among the last `independentOf` */
  independentNeeded: 3,
  independentOf: 5,
} as const;

/** The days back the mistakes list reads. */
const MISTAKE_DAYS = 30;
const DAYS_SHOWN = 28;
const MAX_WEAK = 5;
const MAX_STRONG = 5;
const MAX_RECENT = 12;

const FINISHED_WORK: ReadonlySet<Outcome> = new Set(["first_try", "self_corrected", "with_help", "tutor_solved"]);

function independent(a: AttemptRecord): boolean {
  return INDEPENDENT_OUTCOMES.includes(a.outcome);
}

/** Work: a line written, or a finished outcome. */
function worked(a: AttemptRecord): boolean {
  return a.linesWritten > 0 || FINISHED_WORK.has(a.outcome);
}

/** Evidence for mastery: worked and over. */
function counted(a: AttemptRecord): boolean {
  if (a.outcome === "in_progress") return false;
  if (a.outcome === "unfinished") return a.linesWritten > 0;
  return true;
}

function startMs(a: AttemptRecord): number {
  return Date.parse(a.startedAt);
}

/** The local calendar date (YYYY-MM-DD) of a moment, for an offset in minutes behind UTC. */
function localDate(ms: number, tzOffsetMinutes: number): string {
  return new Date(ms - tzOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

function num(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;
}

/** The attempts newest first, one per id (its latest state), with readable start times. */
function cleanAttempts(attempts: readonly AttemptRecord[]): AttemptRecord[] {
  const byId = new Map<string, AttemptRecord>();
  for (const a of attempts) {
    if (!a || !Number.isFinite(startMs(a))) continue;
    const seen = byId.get(a.id);
    if (!seen || Date.parse(a.updatedAt) > Date.parse(seen.updatedAt)) byId.set(a.id, a);
  }
  return [...byId.values()].sort((a, b) => startMs(b) - startMs(a) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

/** A skill's mastery from its attempts (newest first). */
export function masteryOf(attempts: readonly AttemptRecord[], now: number): { level: MasteryLevel; score: number } {
  const evidence = attempts.filter(counted).slice(0, MASTERY.window);
  if (evidence.length === 0) return { level: "new", score: 0 };
  let total = 0;
  let weights = 0;
  evidence.forEach((a, i) => {
    let w = Math.pow(MASTERY.decay, i);
    if (now - startMs(a) > MASTERY.staleDays * DAY_MS) w *= MASTERY.staleWeight;
    if (a.origin === "now_you_try" && independent(a)) w *= MASTERY.strongWeight;
    total += w * OUTCOME_VALUE[a.outcome as Exclude<Outcome, "in_progress">];
    weights += w;
  });
  const score = Math.round((total / weights) * 1000) / 1000;
  const alone = evidence.slice(0, MASTERY.independentOf).filter(independent).length;
  if (score >= MASTERY.mastered && alone >= MASTERY.independentNeeded && independent(evidence[0])) return { level: "mastered", score };
  if (score < MASTERY.practicing || evidence.length < 2) return { level: "practicing", score };
  return { level: "almost", score };
}

/** Everything the Progress page shows, from the student's attempts. Pure. */
export function summarize(attempts: readonly AttemptRecord[], now: number, opts: SummarizeOptions = {}): LearningSummary {
  const tz = Number.isFinite(opts.tzOffsetMinutes) ? (opts.tzOffsetMinutes as number) : 0;
  const all = cleanAttempts(attempts);
  const work = all.filter(worked);

  // totals
  const totals = { problems: work.length, independent: 0, withHelp: 0, tutorSolved: 0, activeMs: 0, lines: 0, linesRight: 0 };
  for (const a of all) totals.activeMs += num(a.activeMs);
  for (const a of work) {
    if (independent(a)) totals.independent++;
    else if (a.outcome === "with_help") totals.withHelp++;
    else if (a.outcome === "tutor_solved") totals.tutorSolved++;
    totals.lines += num(a.linesWritten);
    totals.linesRight += num(a.linesRight);
  }

  // the last 28 local days, oldest first
  const today = localDate(now, tz);
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  const days: DayActivity[] = [];
  const index = new Map<string, DayActivity>();
  for (let i = DAYS_SHOWN - 1; i >= 0; i--) {
    const d: DayActivity = { date: new Date(todayMs - i * DAY_MS).toISOString().slice(0, 10), problems: 0, activeMs: 0 };
    days.push(d);
    index.set(d.date, d);
  }
  const activeDates = new Set<string>();
  for (const a of all) {
    const date = localDate(startMs(a), tz);
    const day = index.get(date);
    if (day) day.activeMs += num(a.activeMs);
    if (worked(a)) {
      activeDates.add(date);
      if (day) day.problems++;
    }
  }

  // the streak: consecutive days with a problem, ending today (or yesterday, before today's first)
  let streakDays = 0;
  const dayBefore = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
  let cursor = activeDates.has(today) ? today : dayBefore(today);
  while (activeDates.has(cursor)) {
    streakDays++;
    cursor = dayBefore(cursor);
  }

  // skills: worked on, plus the course's not yet practised
  const bySkill = new Map<SkillId, AttemptRecord[]>();
  for (const a of work) {
    const id = (skillDef(a.skill)?.id ?? "other") as SkillId;
    const list = bySkill.get(id) ?? [];
    list.push(a);
    bySkill.set(id, list);
  }
  const course = opts.course ?? null;
  const skills: SkillProgress[] = [];
  for (const def of SKILLS) {
    const list = bySkill.get(def.id);
    const inCourse = course !== null && (def.courses as readonly string[]).includes(course);
    if (!list && !inCourse) continue;
    const mastery = list ? masteryOf(list, now) : { level: "new" as const, score: 0 };
    skills.push({
      skill: def.id,
      name: def.name,
      area: def.area,
      level: mastery.level,
      score: mastery.score,
      attempts: list ? list.filter(counted).length : 0,
      independent: list ? list.filter(independent).length : 0,
      lastAt: list ? list[0].startedAt : null,
    });
  }

  const order = new Map(SKILLS.map((s, i) => [s.id as SkillId, i]));
  const practised = skills.filter((s) => s.skill !== "other" && s.level !== "new");
  const weakSkills = practised
    .filter((s) => s.level !== "mastered")
    .sort((a, b) => a.score - b.score || b.attempts - a.attempts || Date.parse(b.lastAt ?? "") - Date.parse(a.lastAt ?? "") || order.get(a.skill)! - order.get(b.skill)!)
    .slice(0, MAX_WEAK)
    .map((s) => s.skill);
  const strongSkills = practised
    .filter((s) => s.level === "mastered")
    .sort((a, b) => Date.parse(b.lastAt ?? "") - Date.parse(a.lastAt ?? "") || order.get(a.skill)! - order.get(b.skill)!)
    .slice(0, MAX_STRONG)
    .map((s) => s.skill);

  // mistakes in the last 30 days, most frequent first
  const counts = new Map<MistakeKind, number>();
  for (const a of all) {
    if (now - startMs(a) > MISTAKE_DAYS * DAY_MS) continue;
    for (const k of MISTAKE_KINDS) {
      const n = num(a.mistakes?.[k]);
      if (n > 0) counts.set(k, (counts.get(k) ?? 0) + Math.round(n));
    }
  }
  const mistakes = MISTAKE_KINDS.filter((k) => counts.has(k))
    .map((kind) => ({ kind, count: counts.get(kind)! }))
    .sort((a, b) => b.count - a.count || MISTAKE_KINDS.indexOf(a.kind) - MISTAKE_KINDS.indexOf(b.kind));

  return { totals, days, streakDays, skills, weakSkills, strongSkills, mistakes, recent: work.slice(0, MAX_RECENT) };
}

/**
 * What the tutor is told about the student (`LearnerHint`), from a summary: the three weakest
 * skills, the three most recently mastered, and the three mistakes made most often (twice or more)
 * in the last 30 days. Undefined when there is nothing to say.
 */
export function learnerHint(summary: LearningSummary): LearnerHint | undefined {
  const ref = (id: SkillId) => ({ id, name: skillDef(id)?.name ?? id });
  const weakSkills = summary.weakSkills.slice(0, 3).map(ref);
  const strongSkills = summary.strongSkills.slice(0, 3).map(ref);
  const recurringMistakes = summary.mistakes
    .filter((m) => m.count >= LEARNING_LIMITS.recurringMistake)
    .slice(0, 3)
    .map((m) => ({ kind: m.kind, count: Math.min(9999, m.count) }));
  if (weakSkills.length === 0 && strongSkills.length === 0 && recurringMistakes.length === 0) return undefined;
  return { weakSkills, strongSkills, recurringMistakes };
}
