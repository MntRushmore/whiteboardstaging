/**
 * The Progress page's words and numbers, from a `LearningSummary` (`summary.ts`) and the attempts
 * it was made from. Every label, count, date, the chart's scale and the paragraph for grown-ups
 * are made here, so the page's components only lay them out. Pure: no React, no network, no
 * `Date.now()` (the caller passes `now`), so every line is tested with hand-made summaries
 * (`__tests__/progressView.test.ts`).
 *
 * Voice: the page talks to the student ("you"), short and kind; the grown-ups paragraph talks
 * about them (third person). Local days follow `summarize`: `tzOffsetMinutes` is the browser's
 * `Date#getTimezoneOffset()` (minutes west of UTC).
 */
import { latexToPlainText } from "@/lib/boards/boardTitle";
import { COURSES } from "@/lib/onboarding/courses";
import type { CourseId } from "@/lib/onboarding/courseIds";
import {
  INDEPENDENT_OUTCOMES,
  LEARNING_LIMITS,
  MISTAKES,
  SKILL_AREAS,
  SKILLS,
  skillDef,
  type AttemptRecord,
  type DayActivity,
  type LearningSummary,
  type MasteryLevel,
  type MistakeKind,
  type Outcome,
  type SkillArea,
  type SkillId,
  type SkillProgress,
} from "./contracts";

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
/** The activity chart's span: `LearningSummary.days` holds this many local days. */
export const CHART_DAYS = 28;
/** "This week": the last 7 local days, today included. */
export const WEEK_DAYS = 7;

// ------------------------------------------------------------------ copy

export const PROGRESS_COPY = {
  title: "Your progress",
  back: "My whiteboards",
  weekTitle: "This week",
  weekHint: "The last 7 days",
  activityTitle: "Last 4 weeks",
  activityHint: "Minutes of practice each day",
  skillsTitle: "Your skills",
  skillsHint: "Each skill grows as you solve problems on your own.",
  skillsLadder: "How a skill grows",
  watchTitle: "Watch out for",
  watchHint: "Slips from the last 30 days, and a tip for each one.",
  recentTitle: "Recent problems",
  grownUpsTitle: "For grown-ups",
  emptyTitle: "Nothing here yet",
  emptyHint: "Solve a problem on a board and your progress shows up here.",
  newBoard: "New board",
  practice: "Practice",
  practiceStarting: "Opening…",
  openBoard: "Open board",
  loadFailedTitle: "We couldn't load your progress",
  loadFallback: "Something went wrong while loading your progress. Try again in a moment.",
  retry: "Try again",
  practiceFailedTitle: "That practice board didn't open",
  practiceFallback: "The board was not created. Try again in a moment.",
  practiceNone: "There are no practice problems for that skill yet.",
  newBoardFailedTitle: "The board didn't open",
  courseSkillsTitle: (course: string) => `Skills in ${course}`,
} as const;

export const LEVEL_LABELS: Readonly<Record<MasteryLevel, string>> = {
  new: "New",
  practicing: "Practicing",
  almost: "Almost there",
  mastered: "Mastered",
};

export const OUTCOME_LABELS: Readonly<Record<Outcome, string>> = {
  first_try: "On your own",
  self_corrected: "Fixed it yourself",
  with_help: "With help",
  tutor_solved: "Tutor solved it",
  unfinished: "Unfinished",
  in_progress: "In progress",
};

/** The outcome chip's Arc Badge tone: green for solved alone, calm grey for the rest (never red). */
export type OutcomeTone = "success" | "info" | "neutral";
export const OUTCOME_TONES: Readonly<Record<Outcome, OutcomeTone>> = {
  first_try: "success",
  self_corrected: "success",
  with_help: "info",
  tutor_solved: "neutral",
  unfinished: "neutral",
  in_progress: "neutral",
};

export const AREA_LABELS: Readonly<Record<SkillArea, string>> = {
  arithmetic: "Numbers",
  algebra: "Algebra",
  functions: "Functions and graphs",
  geometry: "Geometry",
  trig: "Trigonometry",
  calculus: "Calculus",
  science: "Science",
};
/** The fallback skill (`other`) gets a group of its own at the end, not a place under Algebra. */
export const OTHER_GROUP_LABEL = "Everything else";

/** How the grown-ups paragraph names each kind of slip ("Keeps tripping on …"). */
const TRIP_PHRASES: Readonly<Record<MistakeKind, string>> = {
  sign: "plus and minus signs",
  arithmetic: "small number slips",
  distribution: "distributing",
  both_sides: "doing the same to both sides of the =",
  combining_terms: "combining like terms",
  inverse_operation: "undoing steps",
  fractions: "fractions",
  exponents: "powers",
  algebra: "algebra steps",
  units: "units",
  concept: "some of the big ideas",
};

// ------------------------------------------------------------------ numbers and words

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

/** Whole minutes of `ms`, rounded (a 40-second day is 1 minute; nothing is 0). */
function wholeMinutes(ms: number): number {
  if (!(ms > 0)) return 0;
  return Math.max(1, Math.round(ms / MINUTE_MS));
}

/** "no time", "1 minute", "42 minutes", "1 hour", "1 hour 5 minutes", "3 hours 20 minutes". */
export function formatDuration(ms: number): string {
  const minutes = wholeMinutes(ms);
  if (minutes === 0) return "no time";
  if (minutes < 60) return plural(minutes, "minute");
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? plural(hours, "hour") : `${plural(hours, "hour")} ${plural(rest, "minute")}`;
}

/** The chart's short form: "0 min", "42 min", "1 h", "1 h 5 min". */
export function formatShortDuration(ms: number): string {
  const minutes = wholeMinutes(ms);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/**
 * The minutes tile: minutes up to 2 hours ("42" "minutes of practice"), then hours to the half
 * ("2½" "hours of practice"), so the number stays one a child can read.
 */
export function durationTile(ms: number): { value: string; label: string } {
  const minutes = wholeMinutes(ms);
  if (minutes < 120) return { value: String(minutes), label: minutes === 1 ? "minute of practice" : "minutes of practice" };
  const halves = Math.round(minutes / 30);
  const whole = Math.floor(halves / 2);
  return { value: halves % 2 ? `${whole}½` : String(whole), label: "hours of practice" };
}

/** "Not tried yet", "1 problem", "6 problems". */
export function problemsLabel(n: number): string {
  return n > 0 ? plural(n, "problem") : "Not tried yet";
}

/** A 0..1 score as a whole percentage, clamped (a bad value is 0). */
export function scorePercent(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.round(Math.min(1, Math.max(0, score)) * 100);
}

/**
 * "Solved on your own" in words a child gets: the share as a percentage and a phrase.
 * `percent` is null when there were no problems.
 */
export function independentWording(independent: number, problems: number): { percent: number | null; phrase: string } {
  if (!(problems > 0)) return { percent: null, phrase: "Solve one on your own!" };
  const share = Math.min(Math.max(independent, 0), problems) / problems;
  const percent = Math.round(share * 100);
  let phrase: string;
  if (share >= 1) phrase = "All of them!";
  else if (percent >= 75) phrase = "Most of them!";
  else if (percent > 50) phrase = "More than half";
  else if (percent === 50) phrase = "Half of them";
  else if (percent >= 25) phrase = "Some of them";
  else if (independent > 0) phrase = "A few of them";
  else phrase = "Not yet. You'll get there!";
  return { percent, phrase };
}

/** The streak tile's words under the number. */
export function streakWording(days: number): { label: string; hint: string } {
  const n = Math.max(0, Math.floor(days || 0));
  return {
    label: n === 1 ? "day in a row" : "days in a row",
    hint: n === 0 ? "Solve one today to start!" : n === 1 ? "Come back tomorrow!" : "Keep it going!",
  };
}

/** "once", "twice", "3 times". */
export function timesLabel(n: number): string {
  if (n === 1) return "once";
  if (n === 2) return "twice";
  return `${n.toLocaleString("en-US")} times`;
}

// ------------------------------------------------------------------ dates

/** The local calendar date (YYYY-MM-DD) of an instant, for a time zone offset as `getTimezoneOffset` gives it. */
export function localDateKey(ms: number, tzOffsetMinutes = 0): string {
  return new Date(ms - tzOffsetMinutes * MINUTE_MS).toISOString().slice(0, 10);
}

function keyToUtcMs(key: string): number {
  return Date.parse(`${key}T00:00:00Z`);
}

function addDays(key: string, days: number): string {
  return new Date(keyToUtcMs(key) + days * DAY_MS).toISOString().slice(0, 10);
}

const DAY_SHORT: Intl.DateTimeFormatOptions = { timeZone: "UTC", month: "short", day: "numeric" };
const DAY_LONG: Intl.DateTimeFormatOptions = { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" };

/** A YYYY-MM-DD as "Sep 30" (`short`) or "Tue, Sep 30" (`long`); "" for a bad key. */
export function dayLabel(key: string, style: "short" | "long" = "short"): string {
  const ms = keyToUtcMs(key);
  if (Number.isNaN(ms)) return "";
  return new Date(ms).toLocaleDateString("en-US", style === "long" ? DAY_LONG : DAY_SHORT);
}

/**
 * When something happened, in local calendar days: "Today", "Yesterday", "3 days ago" (this
 * week), then "Sep 12" (or "Sep 12, 2025" in another year). "" for an unparsable time.
 */
export function relativeDay(iso: string, now: number, tzOffsetMinutes = 0): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const key = localDateKey(t, tzOffsetMinutes);
  const today = localDateKey(now, tzOffsetMinutes);
  const days = Math.round((keyToUtcMs(today) - keyToUtcMs(key)) / DAY_MS);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  const label = dayLabel(key);
  return key.slice(0, 4) === today.slice(0, 4) ? label : `${label}, ${key.slice(0, 4)}`;
}

/**
 * The chart's days: exactly `CHART_DAYS` local days ending today, oldest first, each with the
 * summary's numbers for that date (zeros for a date it does not list).
 */
export function normalizeDays(days: readonly DayActivity[], now: number, tzOffsetMinutes = 0): DayActivity[] {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const today = localDateKey(now, tzOffsetMinutes);
  return Array.from({ length: CHART_DAYS }, (_, i) => {
    const date = addDays(today, i - (CHART_DAYS - 1));
    const day = byDate.get(date);
    return { date, problems: Math.max(0, day?.problems ?? 0), activeMs: Math.max(0, day?.activeMs ?? 0) };
  });
}

// ------------------------------------------------------------------ this week

export interface WeekStats {
  activeMs: number;
  problems: number;
  /** solved with no help (first try or fixed after a ring), never more than `problems` */
  independent: number;
  /** days with at least one problem */
  activeDays: number;
}

function isIndependent(outcome: Outcome): boolean {
  return INDEPENDENT_OUTCOMES.includes(outcome);
}

/**
 * The last 7 local days. Time, problems and days come from the summary's days (so the tiles agree
 * with the chart); the summary has no per-day independence, so that count comes from the attempts
 * started on those days.
 */
export function weekStats(days: readonly DayActivity[], attempts: readonly AttemptRecord[], now: number, tzOffsetMinutes = 0): WeekStats {
  const week = normalizeDays(days, now, tzOffsetMinutes).slice(-WEEK_DAYS);
  const dates = new Set(week.map((d) => d.date));
  const problems = week.reduce((n, d) => n + d.problems, 0);
  const independent = attempts.filter((a) => {
    const t = Date.parse(a.startedAt);
    return !Number.isNaN(t) && isIndependent(a.outcome) && dates.has(localDateKey(t, tzOffsetMinutes));
  }).length;
  return {
    activeMs: week.reduce((n, d) => n + d.activeMs, 0),
    problems,
    independent: Math.min(independent, problems),
    activeDays: week.filter((d) => d.problems > 0 || d.activeMs > 0).length,
  };
}

// ------------------------------------------------------------------ activity chart

export interface ChartBar {
  date: string;
  minutes: number;
  problems: number;
  /** bar height as a share of the chart's scale, 0..1 */
  ratio: number;
  isToday: boolean;
  /** "Tue, Sep 30" */
  day: string;
  /** "42 min, 6 problems" or "no practice" */
  value: string;
  /** "Tue, Sep 30: 42 min, 6 problems" — the screen reader's line */
  label: string;
  /** an x-axis label under this bar ("Sep 7", "Today"), or null */
  axisLabel: string | null;
}

export interface ActivityChartView {
  bars: ChartBar[];
  /** the top of the scale, in minutes */
  maxMinutes: number;
  /** gridlines above the baseline, bottom to top */
  ticks: { minutes: number; label: string; ratio: number }[];
  /** one sentence a screen reader (and anyone) can read instead of the bars */
  summary: string;
}

/** Scale tops: each one's half is a clean tick too. */
const SCALE_STEPS = [10, 20, 30, 40, 60, 90, 120, 180, 240, 360, 480];

/** The chart's top in minutes: the first clean step at or above the busiest day (10 at least). */
export function chartScaleMax(maxMinutes: number): number {
  const m = Number.isFinite(maxMinutes) ? Math.max(0, maxMinutes) : 0;
  return SCALE_STEPS.find((s) => s >= m) ?? Math.ceil(m / 240) * 240;
}

/** A tick in minutes: "5 min", "30 min", "1 h", "1½ h", "2 h". */
export function tickLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  if (Number.isInteger(hours)) return `${hours} h`;
  if (Number.isInteger(hours * 2)) return `${Math.floor(hours)}½ h`;
  return `${hours.toFixed(1)} h`;
}

function barValue(day: DayActivity): string {
  if (day.problems === 0 && day.activeMs === 0) return "no practice";
  return `${formatShortDuration(day.activeMs)}, ${plural(day.problems, "problem")}`;
}

/**
 * The last 28 days as bars of minutes, today last. Axis labels under the first bar of each week
 * and "Today" under the last.
 */
export function activityChart(days: readonly DayActivity[], now: number, tzOffsetMinutes = 0): ActivityChartView {
  const all = normalizeDays(days, now, tzOffsetMinutes);
  const minutesOf = (d: DayActivity) => d.activeMs / MINUTE_MS;
  const busiest = all.reduce((best, d) => (minutesOf(d) > minutesOf(best) ? d : best), all[0]);
  const maxMinutes = chartScaleMax(minutesOf(busiest));
  const bars: ChartBar[] = all.map((d, i) => {
    const isToday = i === all.length - 1;
    const day = dayLabel(d.date, "long");
    const value = barValue(d);
    return {
      date: d.date,
      minutes: wholeMinutes(d.activeMs),
      problems: d.problems,
      ratio: Math.min(1, minutesOf(d) / maxMinutes),
      isToday,
      day,
      value,
      label: `${day}: ${value}`,
      axisLabel: isToday ? "Today" : i % 7 === 0 ? dayLabel(d.date) : null,
    };
  });
  const half = maxMinutes / 2;
  const ticks = [
    { minutes: half, label: tickLabel(half), ratio: 0.5 },
    { minutes: maxMinutes, label: tickLabel(maxMinutes), ratio: 1 },
  ];
  const active = all.filter((d) => d.problems > 0 || d.activeMs > 0);
  const total = all.reduce((n, d) => n + d.activeMs, 0);
  const summary =
    active.length === 0
      ? "No practice in the last 4 weeks yet."
      : `You practiced on ${active.length} of the last ${CHART_DAYS} days, ${formatDuration(total)} in all. ` +
        `Your busiest day was ${dayLabel(busiest.date, "long")}, with ${formatDuration(busiest.activeMs)}.`;
  return { bars, maxMinutes, ticks, summary };
}

// ------------------------------------------------------------------ skills

export interface SkillView extends SkillProgress {
  levelLabel: string;
  /** the progress bar, 0..100 */
  percent: number;
  problemsText: string;
}

export interface SkillGroup {
  /** a SkillArea, or "other" for the fallback skill */
  key: SkillArea | "other";
  label: string;
  skills: SkillView[];
}

/** The course's own skills, each `new` with nothing done: what the map shows before any practice. */
export function courseSkills(course: CourseId | null | undefined): SkillProgress[] {
  if (!course) return [];
  return SKILLS.filter((s) => (s.courses as readonly CourseId[]).includes(course)).map((s) => ({
    skill: s.id,
    name: s.name,
    area: s.area,
    level: "new" as const,
    score: 0,
    attempts: 0,
    independent: 0,
    lastAt: null,
  }));
}

const SKILL_ORDER = new Map<string, number>(SKILLS.map((s, i) => [s.id, i]));

/**
 * The skill map: the summary's skills (or, before any practice, the course's skills as New),
 * grouped by area in `SKILL_AREAS` order, each group in `SKILLS` (teaching) order, the fallback
 * skill last on its own.
 */
export function skillGroups(skills: readonly SkillProgress[], course: CourseId | null | undefined): SkillGroup[] {
  const list = skills.length > 0 ? skills : courseSkills(course);
  const sorted = [...list].sort((a, b) => (SKILL_ORDER.get(a.skill) ?? 1e6) - (SKILL_ORDER.get(b.skill) ?? 1e6));
  const groups: SkillGroup[] = [];
  const keys: SkillGroup["key"][] = [...SKILL_AREAS, "other"];
  for (const key of keys) {
    const inGroup = sorted.filter((s) => (s.skill === "other" ? "other" : s.area) === key);
    if (inGroup.length === 0) continue;
    groups.push({
      key,
      label: key === "other" ? OTHER_GROUP_LABEL : AREA_LABELS[key],
      skills: inGroup.map((s) => ({
        ...s,
        levelLabel: LEVEL_LABELS[s.level] ?? LEVEL_LABELS.new,
        // a mastered skill's bar is full, whatever its score
        percent: s.level === "mastered" ? 100 : scorePercent(s.score),
        problemsText: problemsLabel(s.attempts),
      })),
    });
  }
  return groups;
}

/** A skill's name, from the summary's list or `SKILLS`. */
export function skillName(id: string, skills: readonly SkillProgress[] = []): string {
  return skills.find((s) => s.skill === id)?.name ?? skillDef(id)?.name ?? skillDef("other")!.name;
}

/** "Practice: Two-step equations": the practice board's name. */
export function practiceTitle(name: string): string {
  return `Practice: ${name}`;
}

// ------------------------------------------------------------------ mistakes and recent problems

export interface MistakeView {
  kind: MistakeKind;
  label: string;
  count: number;
  countText: string;
  tip: string;
}

/** The top slips (most frequent first, as the summary orders them), with their tips. */
export function topMistakes(mistakes: LearningSummary["mistakes"], n = 3): MistakeView[] {
  return mistakes
    .filter((m) => m.count > 0 && MISTAKES[m.kind])
    .slice(0, n)
    .map((m) => ({ kind: m.kind, label: MISTAKES[m.kind].label, count: m.count, countText: timesLabel(m.count), tip: MISTAKES[m.kind].tip }));
}

export interface RecentView {
  id: string;
  /** what KaTeX renders: a system's lines side by side, fractions full size */
  latex: string;
  /** the same as readable text: the screen reader's name for it, and what shows until KaTeX loads */
  plain: string;
  skillName: string;
  outcome: Outcome;
  outcomeLabel: string;
  tone: OutcomeTone;
  when: string;
  boardHref: string | null;
}

/** The latest problems (at most 12), newest first as the summary gives them. */
export function recentProblems(recent: readonly AttemptRecord[], now: number, tzOffsetMinutes = 0, skills: readonly SkillProgress[] = []): RecentView[] {
  return recent.slice(0, 12).map((a) => {
    const parts = a.problemLatex.split(/;\s+/).filter(Boolean);
    return {
      id: a.id,
      latex: parts.join(",\\quad ").replace(/\\frac(?![a-zA-Z])/g, "\\dfrac"),
      plain: parts.map((p) => latexToPlainText(p)).join(", "),
      skillName: skillName(a.skill, skills),
      outcome: a.outcome,
      outcomeLabel: OUTCOME_LABELS[a.outcome] ?? OUTCOME_LABELS.in_progress,
      tone: OUTCOME_TONES[a.outcome] ?? "neutral",
      when: relativeDay(a.startedAt, now, tzOffsetMinutes),
      boardHref: a.boardId ? `/board/${a.boardId}` : null,
    };
  });
}

// ------------------------------------------------------------------ the course and the student

/** The course's name for the title ("Algebra 1"); null when unknown or "Something else". */
export function courseLabel(course: CourseId | null | undefined): string | null {
  if (!course || course === "other") return null;
  return COURSES.find((c) => c.id === course)?.label ?? null;
}

/** The first word of the display name, for the grown-ups paragraph; null for none or an email. */
export function firstName(displayName: string | null | undefined): string | null {
  const word = (displayName ?? "").trim().split(/\s+/)[0] ?? "";
  if (!word || word.includes("@") || !/\p{L}/u.test(word)) return null;
  return word.length > 30 ? null : word;
}

/** "A", "A and B", "A, B and C". */
function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// ------------------------------------------------------------------ for grown-ups

export interface GrownUpsInput {
  name: string | null;
  week: WeekStats;
  /** every problem the record holds (the summary's totals) */
  totalProblems: number;
  skills: readonly SkillProgress[];
  strongSkills: readonly SkillId[];
  weakSkills: readonly SkillId[];
  mistakes: LearningSummary["mistakes"];
  /** the latest attempt's start, for "last practiced" */
  lastAt: string | null;
  now: number;
  tzOffsetMinutes?: number;
}

/**
 * A few plain sentences for a parent: this week's time and problems, a strength, what to practise
 * next and the slip to watch for, with its tip. Third person; kind; at most five sentences.
 */
export function grownUpsSummary(input: GrownUpsInput): string {
  const { name, week, skills, now } = input;
  const tz = input.tzOffsetMinutes ?? 0;
  const who = name ?? "your child";
  const Who = name ?? "Your child";

  if (input.totalProblems <= 0) {
    return `Nothing to report yet. Once ${who} solves a few problems on a board, you'll see the time spent, what was solved without help, which skills are growing and the slips to watch for.`;
  }

  const sentences: string[] = [];
  if (week.problems > 0) {
    const time = `${formatDuration(week.activeMs)} over ${plural(week.activeDays, "day")}`;
    const counts = `${plural(week.problems, "problem")}, ${week.independent.toLocaleString("en-US")} solved without help`;
    sentences.push(name ? `This week ${name} practiced ${time}: ${counts}.` : `This week: ${time}, ${counts}.`);
  } else {
    const last = input.lastAt ? relativeDay(input.lastAt, now, tz) : "";
    // a week or more ago, relativeDay gives a date: "the last time was on Sep 12"
    const when = !last ? "" : /^(Today|Yesterday|\d+ days ago)$/.test(last) ? last.toLowerCase() : `on ${last}`;
    sentences.push(`No practice yet this week${when ? `; the last time was ${when}` : ""}.`);
  }

  const nameOf = (id: string) => skillName(id, skills);
  const mastered = input.strongSkills.slice(0, 2).map(nameOf);
  if (mastered.length > 0) sentences.push(`Has mastered ${listNames(mastered)}.`);

  const growing = [...skills]
    .filter((s) => s.attempts > 0 && (s.level === "almost" || (s.level === "practicing" && s.independent > 0)))
    .sort((a, b) => (a.level === b.level ? b.score - a.score : a.level === "almost" ? -1 : 1))[0];
  if (growing) sentences.push(`Getting stronger at ${growing.name}.`);

  const next = input.weakSkills.find((id) => id !== growing?.skill && !input.strongSkills.includes(id));
  if (next) sentences.push(`A good one to practice next: ${nameOf(next)}.`);

  // "keeps tripping" needs a pattern, counted as the tutor's learner hint counts a recurring mistake
  const slip = input.mistakes.find((m) => m.count >= LEARNING_LIMITS.recurringMistake && MISTAKES[m.kind]);
  if (slip) sentences.push(`Keeps tripping on ${TRIP_PHRASES[slip.kind]}; a tip: ${MISTAKES[slip.kind].tip}`);

  if (sentences.length === 1 && week.problems > 0) sentences.push(`${Who} is off to a good start.`);
  return sentences.join(" ");
}

// ------------------------------------------------------------------ the page

export type ProgressState = "loading" | "error" | "empty" | "ready";

/** Which of the page's states to show. `empty`: the record holds no problem yet. */
export function progressStateFor({ loading, error, summary }: { loading: boolean; error: string | null; summary: LearningSummary | null }): ProgressState {
  if (error) return "error";
  if (loading || !summary) return "loading";
  return summary.totals.problems > 0 || summary.recent.length > 0 ? "ready" : "empty";
}

export interface WeekTile {
  key: "minutes" | "problems" | "independent" | "streak";
  value: string;
  label: string;
  hint: string | null;
}

export interface ProgressView {
  title: string;
  course: string | null;
  week: WeekStats;
  tiles: WeekTile[];
  chart: ActivityChartView;
  skillsTitle: string;
  skills: SkillGroup[];
  mistakes: MistakeView[];
  recent: RecentView[];
  grownUps: string;
}

export interface ProgressInput {
  attempts: readonly AttemptRecord[];
  now: number;
  tzOffsetMinutes?: number;
  course?: CourseId | null;
  displayName?: string | null;
}

/** Everything the page shows, from the summary (and the attempts it was made from). */
export function buildProgressView(summary: LearningSummary, input: ProgressInput): ProgressView {
  const tz = input.tzOffsetMinutes ?? 0;
  const course = courseLabel(input.course);
  const week = weekStats(summary.days, input.attempts, input.now, tz);
  const minutes = durationTile(week.activeMs);
  const solo = independentWording(week.independent, week.problems);
  const streak = streakWording(summary.streakDays);
  const empty = summary.totals.problems <= 0 && summary.recent.length === 0;
  return {
    title: PROGRESS_COPY.title,
    course,
    week,
    tiles: [
      { key: "minutes", value: minutes.value, label: minutes.label, hint: week.activeDays > 0 ? `on ${plural(week.activeDays, "day")}` : null },
      { key: "problems", value: week.problems.toLocaleString("en-US"), label: week.problems === 1 ? "problem worked on" : "problems worked on", hint: null },
      {
        key: "independent",
        value: week.independent.toLocaleString("en-US"),
        label: "solved on your own",
        hint: solo.percent === null ? solo.phrase : `${solo.percent}% · ${solo.phrase}`,
      },
      { key: "streak", value: String(Math.max(0, summary.streakDays)), label: streak.label, hint: streak.hint },
    ],
    chart: activityChart(summary.days, input.now, tz),
    skillsTitle: empty && course ? PROGRESS_COPY.courseSkillsTitle(course) : PROGRESS_COPY.skillsTitle,
    skills: skillGroups(summary.skills, input.course),
    mistakes: topMistakes(summary.mistakes),
    recent: recentProblems(summary.recent, input.now, tz, summary.skills),
    grownUps: grownUpsSummary({
      name: firstName(input.displayName),
      week,
      totalProblems: empty ? 0 : Math.max(summary.totals.problems, summary.recent.length),
      skills: summary.skills,
      strongSkills: summary.strongSkills,
      weakSkills: summary.weakSkills,
      mistakes: summary.mistakes,
      lastAt: summary.recent[0]?.startedAt ?? null,
      now: input.now,
      tzOffsetMinutes: tz,
    }),
  };
}
