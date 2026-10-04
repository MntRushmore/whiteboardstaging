/**
 * Hand-made learning records for the Progress page's tests: a few weeks of an Algebra 1 student's
 * attempts and the `LearningSummary` a summarizer would make of them. Written by hand (not with
 * `summarize`) so the page is tested against the contract, whatever the summarizer does.
 */
import type { AttemptRecord, DayActivity, LearningSummary, Outcome, SkillId, SkillProgress } from "../contracts";
import { INDEPENDENT_OUTCOMES, skillDef } from "../contracts";
import { localDateKey } from "../progressView";

/** Sunday 2026-10-04, 1 pm in Chicago (UTC-5 in October). */
export const NOW = Date.parse("2026-10-04T18:00:00Z");
export const TZ = 300;
const DAY = 86_400_000;
const MIN = 60_000;

let seq = 0;
export function attempt(over: Partial<AttemptRecord> = {}): AttemptRecord {
  seq += 1;
  const startedAt = over.startedAt ?? new Date(NOW - seq * 3_600_000).toISOString();
  return {
    id: `a${seq}`,
    boardId: "b1",
    problemLatex: "2x + 3 = 11",
    skill: "two_step_equations",
    course: "algebra1",
    origin: "student",
    parentId: null,
    outcome: "first_try",
    mistakes: {},
    activeMs: 3 * MIN,
    startedAt,
    updatedAt: startedAt,
    finishedAt: startedAt,
    linesWritten: 3,
    linesRight: 3,
    linesRinged: 0,
    hints: 0,
    tutorSteps: 0,
    solves: 0,
    asks: 0,
    ...over,
  };
}

/** One attempt `daysAgo` local days before NOW, at `hour` local time. */
function at(daysAgo: number, hour: number, skill: SkillId, outcome: Outcome, minutes: number, latex: string, extra: Partial<AttemptRecord> = {}): AttemptRecord {
  // local midnight of NOW's local day, in UTC ms
  const localMidnight = Date.parse(`${localDateKey(NOW, TZ)}T00:00:00Z`) + TZ * MIN;
  const startedAt = new Date(localMidnight - daysAgo * DAY + hour * 3_600_000).toISOString();
  return attempt({ skill, outcome, activeMs: minutes * MIN, problemLatex: latex, startedAt, updatedAt: startedAt, finishedAt: outcome === "in_progress" ? null : startedAt, ...extra });
}

/** Newest first, like `loadAttempts`. */
export const ATTEMPTS: AttemptRecord[] = [
  at(0, 11, "two_step_equations", "in_progress", 4, "3x - 5 = 16"),
  at(0, 10, "two_step_equations", "first_try", 3, "2x + 3 = 11"),
  at(0, 9, "negative_numbers", "self_corrected", 5, "-7 + 12 - (-3)", { mistakes: { sign: 1 } }),
  at(1, 17, "factoring", "with_help", 9, "x^{2} - 5x + 6 = 0", { mistakes: { sign: 1 }, hints: 2 }),
  at(1, 16, "two_step_equations", "first_try", 4, "5x - 4 = 21"),
  at(2, 16, "systems", "tutor_solved", 7, "x + y = 10; x - y = 2", { boardId: null, solves: 1 }),
  at(2, 15, "fractions", "first_try", 3, "\\frac{3}{4} + \\frac{1}{6}"),
  at(3, 18, "multi_step_equations", "self_corrected", 6, "3(x + 2) = 18", { mistakes: { distribution: 1 } }),
  at(3, 17, "multi_step_equations", "unfinished", 2, "4(2x - 1) = 3x + 11", { mistakes: { distribution: 1, sign: 1 } }),
  at(3, 16, "fractions", "first_try", 2, "\\frac{2}{3} \\cdot \\frac{9}{4}"),
  at(9, 16, "one_step_equations", "first_try", 2, "x + 7 = 12"),
  at(9, 15, "one_step_equations", "first_try", 2, "4x = 28"),
  at(10, 16, "negative_numbers", "with_help", 6, "-3 \\cdot (-4) - 10", { mistakes: { sign: 1, arithmetic: 1 } }),
  at(16, 17, "fractions", "first_try", 4, "\\frac{1}{2} + \\frac{1}{3}"),
  at(23, 16, "order_of_operations", "first_try", 3, "2 + 3 \\cdot 4"),
];

function daysOf(attempts: readonly AttemptRecord[]): DayActivity[] {
  const today = Date.parse(`${localDateKey(NOW, TZ)}T00:00:00Z`);
  return Array.from({ length: 28 }, (_, i) => {
    const date = new Date(today - (27 - i) * DAY).toISOString().slice(0, 10);
    const on = attempts.filter((a) => localDateKey(Date.parse(a.startedAt), TZ) === date);
    return { date, problems: on.length, activeMs: on.reduce((n, a) => n + a.activeMs, 0) };
  });
}

function skill(id: SkillId, level: SkillProgress["level"], score: number, attempts: number, independent: number, lastAt: string | null): SkillProgress {
  const def = skillDef(id)!;
  return { skill: id, name: def.name, area: def.area, level, score, attempts, independent, lastAt };
}

export function makeSummary(attempts: readonly AttemptRecord[] = ATTEMPTS): LearningSummary {
  const independent = attempts.filter((a) => INDEPENDENT_OUTCOMES.includes(a.outcome)).length;
  const last = (id: SkillId) => attempts.find((a) => a.skill === id)?.startedAt ?? null;
  return {
    totals: {
      problems: attempts.length,
      independent,
      withHelp: attempts.filter((a) => a.outcome === "with_help").length,
      tutorSolved: attempts.filter((a) => a.outcome === "tutor_solved").length,
      activeMs: attempts.reduce((n, a) => n + a.activeMs, 0),
      lines: 40,
      linesRight: 31,
    },
    days: daysOf(attempts),
    streakDays: 4,
    skills: [
      skill("negative_numbers", "practicing", 0.42, 2, 1, last("negative_numbers")),
      skill("order_of_operations", "practicing", 0.3, 1, 1, last("order_of_operations")),
      skill("fractions", "mastered", 0.93, 3, 3, last("fractions")),
      skill("powers_roots", "new", 0, 0, 0, null),
      skill("simplify_expressions", "new", 0, 0, 0, null),
      skill("one_step_equations", "almost", 0.71, 2, 2, last("one_step_equations")),
      skill("two_step_equations", "almost", 0.78, 3, 2, last("two_step_equations")),
      skill("multi_step_equations", "practicing", 0.38, 2, 1, last("multi_step_equations")),
      skill("systems", "practicing", 0.05, 1, 0, last("systems")),
      skill("factoring", "practicing", 0.12, 1, 0, last("factoring")),
      skill("linear_functions", "new", 0, 0, 0, null),
    ],
    weakSkills: ["systems", "factoring", "order_of_operations", "multi_step_equations", "negative_numbers"],
    strongSkills: ["fractions"],
    mistakes: [
      { kind: "sign", count: 4 },
      { kind: "distribution", count: 2 },
      { kind: "arithmetic", count: 1 },
    ],
    recent: attempts.slice(0, 12),
  };
}

export const EMPTY_SUMMARY: LearningSummary = {
  totals: { problems: 0, independent: 0, withHelp: 0, tutorSolved: 0, activeMs: 0, lines: 0, linesRight: 0 },
  days: [],
  streakDays: 0,
  skills: [],
  weakSkills: [],
  strongSkills: [],
  mistakes: [],
  recent: [],
};
