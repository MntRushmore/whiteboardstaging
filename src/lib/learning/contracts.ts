/**
 * The learning system's shared contract (2026-10-04): what the board records about each problem a
 * student works, the skills it is filed under, and what the Progress page and the tutor read back.
 * The single source of truth for every learning module; change it only with every owner's consent.
 *
 *   board (LiveLoop) ──signals──► learningBus ──► AttemptTracker ──AttemptRecord──► store ──► learning_attempts
 *                                                        │                                        │
 *                                                        └──attempt updates──► Now you try         ▼
 *   Progress page / board ◄── summarize(loadAttempts()) ◄─────────────────────────────── own rows (RLS)
 *   check / chat requests ◄── learnerHint(summary)
 *
 * Board-first-load rule: the board page and `liveLoop.ts` import this file for TYPES ONLY (erased).
 * At runtime they import only `bus.ts`, `hint.ts` and `practiceMarker.ts`; everything else here is
 * loaded with a dynamic import after the board is up (the board's first load is held to a budget,
 * `docs/BUNDLE.md`).
 */
import type { CourseId } from "@/lib/onboarding/courseIds";
import type { LineKind } from "@/lib/live/contracts";
import { K8_SKILLS } from "./grades";
import { MISTAKE_KINDS, type MistakeKind } from "./hint";

export { MISTAKE_KINDS, type MistakeKind } from "./hint";
export type { LearnerHint } from "./hint";

// ------------------------------------------------------------------ skills

export const SKILL_AREAS = ["arithmetic", "algebra", "functions", "geometry", "trig", "calculus", "science"] as const;
export type SkillArea = (typeof SKILL_AREAS)[number];

export interface SkillDef {
  /** stable id, stored in `learning_attempts.skill`: never rename one */
  id: string;
  /** what the student and their parent read, plain and short */
  name: string;
  area: SkillArea;
  /** the courses whose Progress map lists it before it is practised (`other` lists none up front) */
  courses: readonly CourseId[];
}

/**
 * Every skill the record files a problem under, in teaching order within each area. `classifyProblem`
 * (`skills.ts`) maps a problem to exactly one of these; `other` when nothing fits.
 *
 * Arithmetic is the K–8 path's fine skills (`grades.ts`, their names from `K8_SKILLS`), strand by
 * strand — adding and taking away, then times and sharing, then fractions, then decimals, percents
 * and ratios — each strand in the order a school teaches it. The four original coarse skills
 * (`COARSE_SKILL_IDS`) stay at the end of their strand: rows stored before 2026-10-09 use them.
 */
export const SKILLS = [
  // arithmetic: adding and taking away (K–4)
  { id: "add_within_10", name: K8_SKILLS.add_within_10.name, area: "arithmetic", courses: [] },
  { id: "subtract_within_10", name: K8_SKILLS.subtract_within_10.name, area: "arithmetic", courses: [] },
  { id: "add_within_20", name: K8_SKILLS.add_within_20.name, area: "arithmetic", courses: [] },
  { id: "subtract_within_20", name: K8_SKILLS.subtract_within_20.name, area: "arithmetic", courses: [] },
  { id: "add_tens", name: K8_SKILLS.add_tens.name, area: "arithmetic", courses: [] },
  { id: "add_within_100", name: K8_SKILLS.add_within_100.name, area: "arithmetic", courses: [] },
  { id: "subtract_within_100", name: K8_SKILLS.subtract_within_100.name, area: "arithmetic", courses: [] },
  { id: "add_subtract_within_1000", name: K8_SKILLS.add_subtract_within_1000.name, area: "arithmetic", courses: [] },
  { id: "multi_digit_add_subtract", name: K8_SKILLS.multi_digit_add_subtract.name, area: "arithmetic", courses: [] },
  { id: "add_subtract", name: "Adding and subtracting", area: "arithmetic", courses: [] },
  // arithmetic: times and sharing (3–4)
  { id: "times_tables", name: K8_SKILLS.times_tables.name, area: "arithmetic", courses: [] },
  { id: "division_facts", name: K8_SKILLS.division_facts.name, area: "arithmetic", courses: [] },
  { id: "multiply_by_tens", name: K8_SKILLS.multiply_by_tens.name, area: "arithmetic", courses: [] },
  { id: "multiply_multi_digit", name: K8_SKILLS.multiply_multi_digit.name, area: "arithmetic", courses: [] },
  { id: "long_division", name: K8_SKILLS.long_division.name, area: "arithmetic", courses: [] },
  { id: "multiply_divide", name: "Multiplying and dividing", area: "arithmetic", courses: [] },
  // arithmetic: the rest of the numbers an Algebra 1 student reviews first
  { id: "negative_numbers", name: "Negative numbers", area: "arithmetic", courses: ["algebra1"] },
  { id: "order_of_operations", name: "Order of operations", area: "arithmetic", courses: ["algebra1"] },
  // arithmetic: fractions (4–6); Algebra 1 reviews adding unlike fractions (the coarse skill's place)
  { id: "equivalent_fractions", name: K8_SKILLS.equivalent_fractions.name, area: "arithmetic", courses: [] },
  { id: "add_fractions_like", name: K8_SKILLS.add_fractions_like.name, area: "arithmetic", courses: [] },
  { id: "add_fractions_unlike", name: K8_SKILLS.add_fractions_unlike.name, area: "arithmetic", courses: ["algebra1"] },
  { id: "multiply_fractions", name: K8_SKILLS.multiply_fractions.name, area: "arithmetic", courses: [] },
  { id: "divide_fractions", name: K8_SKILLS.divide_fractions.name, area: "arithmetic", courses: [] },
  { id: "fractions", name: "Fractions", area: "arithmetic", courses: [] },
  // arithmetic: decimals, percents and ratios (5–7)
  { id: "decimals_add_subtract", name: K8_SKILLS.decimals_add_subtract.name, area: "arithmetic", courses: [] },
  { id: "decimals_multiply", name: K8_SKILLS.decimals_multiply.name, area: "arithmetic", courses: [] },
  { id: "percents", name: K8_SKILLS.percents.name, area: "arithmetic", courses: [] },
  { id: "proportions", name: K8_SKILLS.proportions.name, area: "arithmetic", courses: [] },
  { id: "decimals_percents", name: "Decimals and percents", area: "arithmetic", courses: [] },
  { id: "powers_roots", name: "Powers and square roots", area: "arithmetic", courses: ["algebra1"] },
  // algebra
  { id: "simplify_expressions", name: "Simplifying expressions", area: "algebra", courses: ["algebra1"] },
  { id: "one_step_equations", name: "One-step equations", area: "algebra", courses: ["algebra1"] },
  { id: "two_step_equations", name: "Two-step equations", area: "algebra", courses: ["algebra1"] },
  { id: "multi_step_equations", name: "Multi-step equations", area: "algebra", courses: ["algebra1", "algebra2"] },
  { id: "inequalities", name: "Inequalities", area: "algebra", courses: ["algebra1", "algebra2"] },
  { id: "absolute_value", name: "Absolute value", area: "algebra", courses: ["algebra1", "algebra2"] },
  { id: "systems", name: "Systems of equations", area: "algebra", courses: ["algebra1", "algebra2"] },
  { id: "exponent_rules", name: "Exponent rules", area: "algebra", courses: ["algebra1", "algebra2"] },
  { id: "polynomials", name: "Multiplying polynomials", area: "algebra", courses: ["algebra1", "algebra2"] },
  { id: "factoring", name: "Factoring", area: "algebra", courses: ["algebra1", "algebra2"] },
  { id: "quadratic_equations", name: "Quadratic equations", area: "algebra", courses: ["algebra1", "algebra2"] },
  { id: "radicals", name: "Radicals", area: "algebra", courses: ["algebra2"] },
  { id: "rational_expressions", name: "Rational expressions", area: "algebra", courses: ["algebra2"] },
  { id: "complex_numbers", name: "Complex numbers", area: "algebra", courses: ["algebra2"] },
  { id: "word_problems", name: "Word problems", area: "algebra", courses: ["algebra1", "algebra2"] },
  // functions
  { id: "linear_functions", name: "Lines and slope", area: "functions", courses: ["algebra1"] },
  { id: "functions", name: "Functions", area: "functions", courses: ["algebra1", "algebra2", "precalc_calc"] },
  { id: "exponential_equations", name: "Exponential equations", area: "functions", courses: ["algebra2", "precalc_calc"] },
  { id: "logarithms", name: "Logarithms", area: "functions", courses: ["algebra2", "precalc_calc"] },
  // geometry
  { id: "angles", name: "Angles", area: "geometry", courses: ["geometry"] },
  { id: "triangles", name: "Triangles", area: "geometry", courses: ["geometry"] },
  { id: "pythagorean", name: "Pythagorean theorem", area: "geometry", courses: ["geometry"] },
  { id: "area_perimeter", name: "Area and perimeter", area: "geometry", courses: ["geometry"] },
  { id: "circles", name: "Circles", area: "geometry", courses: ["geometry"] },
  { id: "coordinate_geometry", name: "Distance and midpoint", area: "geometry", courses: ["geometry"] },
  { id: "proofs", name: "Proofs", area: "geometry", courses: ["geometry"] },
  // trig
  { id: "trig_values", name: "Trig values", area: "trig", courses: ["precalc_calc"] },
  { id: "trig_equations", name: "Trig equations", area: "trig", courses: ["precalc_calc"] },
  // calculus
  { id: "limits", name: "Limits", area: "calculus", courses: ["precalc_calc"] },
  { id: "derivatives", name: "Derivatives", area: "calculus", courses: ["precalc_calc"] },
  { id: "integrals", name: "Integrals", area: "calculus", courses: ["precalc_calc"] },
  // science
  { id: "units", name: "Units and conversions", area: "science", courses: [] },
  { id: "chemistry", name: "Balancing equations", area: "science", courses: [] },
  // fallback
  { id: "other", name: "Other maths", area: "algebra", courses: [] },
] as const satisfies readonly SkillDef[];
export type SkillId = (typeof SKILLS)[number]["id"];
export const SKILL_IDS: readonly SkillId[] = SKILLS.map((s) => s.id);

export function isSkillId(value: unknown): value is SkillId {
  return typeof value === "string" && (SKILL_IDS as readonly string[]).includes(value);
}

export function skillDef(id: string): SkillDef | undefined {
  return SKILLS.find((s) => s.id === id);
}

/**
 * The original coarse arithmetic skills (2026-10-04), split into the K–8 path's finer ones on
 * 2026-10-09. Rows stored under them stay valid, and the summary re-files such a row under the fine
 * skill its problem shows (`summary.ts`); new problems go under a coarse skill only when no fine one
 * fits (`9 \times 4 \div 6`, a mix of fraction steps). They keep their practice problems (an old weak
 * spot can still be practised) but are not topics: the finer skills replace them in the picker.
 */
export const COARSE_SKILL_IDS = ["add_subtract", "multiply_divide", "fractions", "decimals_percents"] as const satisfies readonly SkillId[];
export type CoarseSkillId = (typeof COARSE_SKILL_IDS)[number];

export function isCoarseSkillId(value: unknown): value is CoarseSkillId {
  return typeof value === "string" && (COARSE_SKILL_IDS as readonly string[]).includes(value);
}

/** The finer K–8 skills each coarse skill was split into: where its kind of problem goes now. */
export const FINER_SKILLS: Readonly<Record<CoarseSkillId, readonly SkillId[]>> = {
  add_subtract: ["add_within_10", "subtract_within_10", "add_within_20", "subtract_within_20", "add_tens", "add_within_100", "subtract_within_100", "add_subtract_within_1000", "multi_digit_add_subtract"],
  multiply_divide: ["times_tables", "division_facts", "multiply_by_tens", "multiply_multi_digit", "long_division"],
  fractions: ["equivalent_fractions", "add_fractions_like", "add_fractions_unlike", "multiply_fractions", "divide_fractions"],
  decimals_percents: ["decimals_add_subtract", "decimals_multiply", "percents"],
};

// ------------------------------------------------------------------ mistakes

export interface MistakeDef {
  kind: MistakeKind;
  /** the Progress page's name for it */
  label: string;
  /** one sentence a parent or the student can act on */
  tip: string;
}

export const MISTAKES: Readonly<Record<MistakeKind, MistakeDef>> = {
  sign: { kind: "sign", label: "Plus and minus signs", tip: "When a term moves across the = or you multiply by a negative, check its sign." },
  arithmetic: { kind: "arithmetic", label: "Number slips", tip: "Take each sum one small step at a time, then check it once more." },
  distribution: { kind: "distribution", label: "Distributing", tip: "Multiply every term inside the brackets, not just the first one." },
  both_sides: { kind: "both_sides", label: "Both sides of the =", tip: "Whatever you do to one side of the =, do to the other side too." },
  combining_terms: { kind: "combining_terms", label: "Combining like terms", tip: "Only add terms with the same letter and power: 3x + 2x, never 3x + 2." },
  inverse_operation: { kind: "inverse_operation", label: "Undoing steps", tip: "To undo +5, subtract 5; to undo ×3, divide by 3." },
  fractions: { kind: "fractions", label: "Fractions", tip: "Find a common denominator before adding or subtracting fractions." },
  exponents: { kind: "exponents", label: "Powers", tip: "Multiplying powers adds the exponents; a power of a power multiplies them." },
  algebra: { kind: "algebra", label: "Algebra steps", tip: "Write one small step per line, so each change is easy to check." },
  units: { kind: "units", label: "Units", tip: "Carry the units on every line and convert before you combine." },
  concept: { kind: "concept", label: "Big ideas", tip: "Ask the tutor to explain the idea behind the step, then try one more." },
};
const _mistakesComplete: Record<(typeof MISTAKE_KINDS)[number], MistakeDef> = MISTAKES;
void _mistakesComplete;

// ------------------------------------------------------------------ attempts

/** Where a problem came from. */
export const ATTEMPT_ORIGINS = [
  /** the student wrote the problem themselves */
  "student",
  /** the board chat wrote it (write_problems) */
  "tutor_problem",
  /** the onboarding tour's starter */
  "starter",
  /** "Now you try" after the tutor solved or helped with a problem (`parentId` is that attempt) */
  "now_you_try",
  /** a practice board opened from the Progress page or "Practice my weak spots" */
  "practice",
  /** the chat taught it ("explain it"): the tutor wrote the whole worked solution */
  "teach",
] as const;
export type AttemptOrigin = (typeof ATTEMPT_ORIGINS)[number];

/** How a problem went. */
export const OUTCOMES = [
  /** being worked on: no answer yet, and not given up on */
  "in_progress",
  /** the student reached the answer with no ring and no help */
  "first_try",
  /** the student reached the answer after a ring, with no help beyond the marks */
  "self_corrected",
  /** the student reached the answer after hints or tutor-written steps */
  "with_help",
  /** the tutor finished it (Solve, "solve 3", a taught problem) before the student did */
  "tutor_solved",
  /** left without an answer (the board closed, the screen changed or 30 min went by) */
  "unfinished",
] as const;
export type Outcome = (typeof OUTCOMES)[number];

/** Outcomes that count as the student solving it themselves (mastery's evidence). */
export const INDEPENDENT_OUTCOMES: readonly Outcome[] = ["first_try", "self_corrected"];

/** What the tracker counts for one attempt; `outcomeOf` turns it into an outcome. */
export interface AttemptCounts {
  /** distinct student lines read in this problem */
  linesWritten: number;
  /** distinct student lines whose latest mark is a tick */
  linesRight: number;
  /** distinct student lines that were ever ringed (fixed or not) */
  linesRinged: number;
  /** written hints and Socratic questions shown for this problem (Suggest, Help me) */
  hints: number;
  /** next steps the tutor wrote under the student's work (Suggest's step, "help me with 3") */
  tutorSteps: number;
  /** times the tutor wrote the rest of the solution (Solve, "solve 3", teach) */
  solves: number;
  /** explicit asks: Help me / Solve it taps and chat requests about this problem */
  asks: number;
}

/**
 * The outcome of an attempt from its counts and two facts the tracker keeps. The one rule every
 * module shares, so the Progress page, mastery and Now you try agree.
 *
 * @param solvedByStudent a student line reached the answer (the engine's `solved`, ticked)
 * @param tutorFinished   the tutor wrote the rest of the solution before that happened
 * @param closed          the attempt is over (board closed, screen left, 30 min idle)
 */
export function outcomeOf(counts: AttemptCounts, solvedByStudent: boolean, tutorFinished: boolean, closed: boolean): Outcome {
  if (solvedByStudent && !tutorFinished) {
    if (counts.hints > 0 || counts.tutorSteps > 0 || counts.solves > 0) return "with_help";
    return counts.linesRinged > 0 ? "self_corrected" : "first_try";
  }
  if (tutorFinished) return "tutor_solved";
  return closed ? "unfinished" : "in_progress";
}

/**
 * One problem one student worked, as the board records it and the Progress page reads it.
 * One row of `learning_attempts` (snake_case there; `store.ts` maps). Upserted by `id` as the
 * attempt goes on, so a row is always the attempt's latest state.
 */
export interface AttemptRecord extends AttemptCounts {
  /** uuid v4, made on the board when the attempt starts */
  id: string;
  /** the board it was worked on; null once that board is deleted */
  boardId: string | null;
  /** the problem as LaTeX (its lines joined by "; " for a system), at most LEARNING_LIMITS.problemLatex chars */
  problemLatex: string;
  skill: SkillId;
  /** the student's course when it was recorded (`profiles.course`), null when unknown */
  course: CourseId | null;
  origin: AttemptOrigin;
  /** for `now_you_try`: the attempt it follows; else null */
  parentId: string | null;
  outcome: Outcome;
  /** mistakes seen in this attempt, by kind (only kinds with a count) */
  mistakes: Partial<Record<MistakeKind, number>>;
  /** time spent working on it: the gaps between its events, each capped at LEARNING_LIMITS.maxGapMs */
  activeMs: number;
  /** ISO timestamps */
  startedAt: string;
  updatedAt: string;
  /** set when the outcome stopped being `in_progress` */
  finishedAt: string | null;
}

export const LEARNING_LIMITS = {
  problemLatex: 500,
  /** a gap between two events of one attempt longer than this counts as this much (a break) */
  maxGapMs: 120_000,
  /** an attempt with no event for this long is closed (`unfinished` unless it has an outcome) */
  idleCloseMs: 30 * 60_000,
  /** an attempt's active time never exceeds this (the database's check too) */
  maxActiveMs: 4 * 60 * 60_000,
  /** each count column's ceiling (smallint) */
  maxCount: 32_767,
  /** a mistake counts as one the student keeps making (the tutor's hint, the grown-ups summary) from this many */
  recurringMistake: 2,
  /** the Progress page and the board's learner hint read this many days back */
  readDays: 120,
  /** and at most this many attempts */
  readLimit: 5_000,
} as const;

// ------------------------------------------------------------------ board signals

/** The tutor's mark on a student line, as `meta.mark` names it (`check:` / `circle:` / a question mark). */
export type LineMark = "check" | "circle" | "question" | null;

/**
 * What the board tells the learning tracker (`learningBus.emit`). Emitted by `LiveLoop` at the
 * moments it already knows about; the tracker (loaded later) turns them into attempts.
 *
 * `problemKey` names one problem on one screen and stays the same while the problem is there:
 * the chat/starter/practice problem cell it sits under, or the column's head line for a problem the
 * student wrote. `pageId` is the tldraw page (one screen). Times are `Date.now()` ms.
 */
export type LearningSignal =
  | {
      type: "problem";
      at: number;
      boardId: string;
      pageId: string;
      problemKey: string;
      /** the problem as LaTeX lines (one for most, 2–3 for a system) */
      problemLatex: string[];
      origin: AttemptOrigin;
      /** for `now_you_try`: the attempt it follows */
      parentId?: string;
    }
  | {
      type: "line";
      at: number;
      boardId: string;
      pageId: string;
      problemKey: string;
      /** the problem's lines, when the problem is the student's own (its head line, read) */
      problemLatex: string[];
      lineId: string;
      latex: string;
      kind: LineKind;
      /** the line above it in the same problem, as read (for the mistake classifier) */
      previousLatex?: string;
      mark: LineMark;
      /** the engine says this line is the answer (`LineAnalysis.solved`) */
      solved: boolean;
    }
  | {
      type: "mistake";
      at: number;
      problemKey: string;
      lineId: string;
      kind: MistakeKind;
      /** `model`: a check annotation's kind; `local`: the board's own classifier */
      source: "model" | "local";
    }
  | {
      type: "help";
      at: number;
      problemKey: string;
      help: "hint" | "next_step" | "solve" | "ask";
      /** Auto did it (no tap) */
      auto: boolean;
    }
  | {
      /** the tutor finished writing the solution of this problem */
      type: "tutor_solved";
      at: number;
      boardId: string;
      pageId: string;
      problemKey: string;
      problemLatex: string[];
      origin?: AttemptOrigin;
    }
  | { type: "screen"; at: number; boardId: string; pageId: string }
  | { type: "closed"; at: number; boardId: string };

/** How a caller of `LiveController.runChatActions` says where the problems it writes come from. */
export interface ChatRunOrigin {
  origin: AttemptOrigin;
  parentId?: string;
}

// ------------------------------------------------------------------ what is read back

export const MASTERY_LEVELS = ["new", "practicing", "almost", "mastered"] as const;
export type MasteryLevel = (typeof MASTERY_LEVELS)[number];

export interface SkillProgress {
  skill: SkillId;
  name: string;
  area: SkillArea;
  level: MasteryLevel;
  /** 0..1, recency-weighted independence (`summary.ts` documents the formula) */
  score: number;
  attempts: number;
  /** attempts with an INDEPENDENT_OUTCOMES outcome */
  independent: number;
  /** ISO, the latest attempt's start; null for a course or path skill never practised */
  lastAt: string | null;
}

export interface DayActivity {
  /** local calendar date, YYYY-MM-DD */
  date: string;
  problems: number;
  activeMs: number;
}

export interface LearningSummary {
  totals: {
    problems: number;
    /** first_try + self_corrected */
    independent: number;
    withHelp: number;
    tutorSolved: number;
    activeMs: number;
    lines: number;
    linesRight: number;
  };
  /** the last 28 local days, oldest first, every day present (zeros included) */
  days: DayActivity[];
  /** consecutive local days with at least one problem, ending today or yesterday */
  streakDays: number;
  /** skills worked on, plus the grade's path and the course's skills not yet practised (level `new`), in SKILLS order */
  skills: SkillProgress[];
  /** worked on and not mastered, weakest first (at most 5) */
  weakSkills: SkillId[];
  /** mastered, most recent first (at most 5) */
  strongSkills: SkillId[];
  /** every mistake kind seen in the last 30 days, most frequent first */
  mistakes: { kind: MistakeKind; count: number }[];
  /** the latest attempts, newest first (at most 12) */
  recent: AttemptRecord[];
}

// ------------------------------------------------------------------ practice

/** A practice problem: its LaTeX lines (one for most, 2–3 for a system), as `write_problems` takes it. */
export type PracticeProblem = string[];

/** Every MistakeKind has a definition (compile-time check above); this list is for iteration. */
export const MISTAKE_DEFS: readonly MistakeDef[] = MISTAKE_KINDS.map((k) => MISTAKES[k]);
