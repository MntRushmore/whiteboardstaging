/**
 * Grades and the K–8 skill path (2026-10-09, "kids come back"). Prod showed who actually practises:
 * young students on adding, times tables and fractions, while the welcome offered Algebra 1 first.
 * A student (or their grown-up) now picks a GRADE (Kindergarten to 8th) or a high-school course, and
 * each grade has a path: its skills in teaching order, the Today's practice set and the skill path
 * draw from it.
 *
 * Shared contract for the K–8 build (docs/KIDS-COME-BACK.md). The K–8 skill ids below are stored in
 * `learning_attempts.skill` once the catalog work files problems under them: never rename one.
 *
 * Pure data: no React, no network, no generators. Safe to import from any page.
 */
import type { SkillId } from "./contracts";

// ------------------------------------------------------------------ grades

/** 0 is Kindergarten; `profiles.grade` (smallint, 0..8). A high-school student has no grade, only a course. */
export const GRADE_IDS = [0, 1, 2, 3, 4, 5, 6, 7, 8] as const;
export type Grade = (typeof GRADE_IDS)[number];

export interface GradeDef {
  id: Grade;
  /** "Kindergarten", "3rd grade" */
  label: string;
  /** "K", "3rd": the path's chip */
  short: string;
}

export const GRADES: readonly GradeDef[] = [
  { id: 0, label: "Kindergarten", short: "K" },
  { id: 1, label: "1st grade", short: "1st" },
  { id: 2, label: "2nd grade", short: "2nd" },
  { id: 3, label: "3rd grade", short: "3rd" },
  { id: 4, label: "4th grade", short: "4th" },
  { id: 5, label: "5th grade", short: "5th" },
  { id: 6, label: "6th grade", short: "6th" },
  { id: 7, label: "7th grade", short: "7th" },
  { id: 8, label: "8th grade", short: "8th" },
];

export function isGrade(value: unknown): value is Grade {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 8;
}

export function gradeLabel(grade: Grade | null | undefined): string | null {
  return grade === null || grade === undefined ? null : (GRADES.find((g) => g.id === grade)?.label ?? null);
}

// ------------------------------------------------------------------ K–8 skills

/**
 * The finer arithmetic skills a K–8 path needs. The older, coarse ids (`add_subtract`,
 * `multiply_divide`, `fractions`, `decimals_percents`) stay valid for rows already stored; new
 * problems are filed under these (`classifyProblem`, the catalog work).
 */
export const K8_SKILL_IDS = [
  "add_within_10",
  "subtract_within_10",
  "add_within_20",
  "subtract_within_20",
  "add_tens",
  "add_within_100",
  "subtract_within_100",
  "add_subtract_within_1000",
  "times_tables",
  "division_facts",
  "multiply_by_tens",
  "multi_digit_add_subtract",
  "multiply_multi_digit",
  "long_division",
  "equivalent_fractions",
  "add_fractions_like",
  "add_fractions_unlike",
  "multiply_fractions",
  "divide_fractions",
  "decimals_add_subtract",
  "decimals_multiply",
  "percents",
  "proportions",
] as const;
export type K8SkillId = (typeof K8_SKILL_IDS)[number];

export function isK8SkillId(value: unknown): value is K8SkillId {
  return typeof value === "string" && (K8_SKILL_IDS as readonly string[]).includes(value);
}

export interface K8SkillInfo {
  /** what the student and their grown-up read: plain and short */
  name: string;
  /** one line under it, in a kid's words, with an example */
  blurb: string;
}

/** The one source of each K–8 skill's name and blurb (SKILLS and TOPIC_INFO take theirs from here). */
export const K8_SKILLS: Readonly<Record<K8SkillId, K8SkillInfo>> = {
  add_within_10: { name: "Adding to 10", blurb: "Put two small numbers together, like 3 + 4" },
  subtract_within_10: { name: "Taking away to 10", blurb: "Take some away, like 7 − 2" },
  add_within_20: { name: "Adding to 20", blurb: "Add facts like 8 + 7" },
  subtract_within_20: { name: "Subtracting to 20", blurb: "Take-away facts like 15 − 8" },
  add_tens: { name: "Adding tens", blurb: "Count by tens, like 40 + 30" },
  add_within_100: { name: "Adding 2-digit numbers", blurb: "Add numbers like 47 + 38" },
  subtract_within_100: { name: "Subtracting 2-digit numbers", blurb: "Take away numbers like 72 − 35" },
  add_subtract_within_1000: { name: "3-digit adding and subtracting", blurb: "Bigger sums like 386 + 247" },
  times_tables: { name: "Times tables", blurb: "Multiply facts like 6 × 7" },
  division_facts: { name: "Division facts", blurb: "Share equally, like 42 ÷ 6" },
  multiply_by_tens: { name: "Multiplying by tens", blurb: "Like 4 × 60 = 240" },
  multi_digit_add_subtract: { name: "Big adding and subtracting", blurb: "4-digit sums like 4386 + 2947" },
  multiply_multi_digit: { name: "Multiplying bigger numbers", blurb: "Like 46 × 7 and 34 × 26" },
  long_division: { name: "Long division", blurb: "Like 864 ÷ 4" },
  equivalent_fractions: { name: "Equivalent fractions", blurb: "Same amount, new numbers: 6/8 = 3/4" },
  add_fractions_like: { name: "Adding fractions", blurb: "Same bottom number, like 2/7 + 3/7" },
  add_fractions_unlike: { name: "Adding unlike fractions", blurb: "Different bottoms, like 3/4 + 1/6" },
  multiply_fractions: { name: "Multiplying fractions", blurb: "Like 2/3 × 3/5" },
  divide_fractions: { name: "Dividing fractions", blurb: "Flip and multiply: 3/4 ÷ 1/2" },
  decimals_add_subtract: { name: "Adding decimals", blurb: "Line up the points: 3.45 + 2.8" },
  decimals_multiply: { name: "Multiplying decimals", blurb: "Like 1.2 × 3" },
  percents: { name: "Percents", blurb: "A percent of a number, like 25% of 80" },
  proportions: { name: "Proportions", blurb: "Equal ratios, like x/4 = 9/12" },
};

/** A skill on a path: a K–8 skill or one of the original skills (`SKILLS`). */
export type PathSkillId = SkillId | K8SkillId;

// ------------------------------------------------------------------ paths

/**
 * Each grade's path, in teaching order (loosely the US Common Core). Only skills whose problems the
 * engine can write and mark line by line: no clocks, coins or pictures yet.
 */
export const GRADE_PATHS: Readonly<Record<Grade, readonly PathSkillId[]>> = {
  0: ["add_within_10", "subtract_within_10"],
  1: ["add_within_20", "subtract_within_20", "add_tens"],
  2: ["add_within_100", "subtract_within_100", "add_subtract_within_1000"],
  3: ["add_subtract_within_1000", "times_tables", "division_facts", "multiply_by_tens"],
  4: ["multi_digit_add_subtract", "multiply_multi_digit", "long_division", "equivalent_fractions", "add_fractions_like"],
  5: ["add_fractions_unlike", "multiply_fractions", "decimals_add_subtract", "decimals_multiply", "order_of_operations"],
  6: ["divide_fractions", "percents", "negative_numbers", "powers_roots", "one_step_equations", "simplify_expressions"],
  7: ["proportions", "negative_numbers", "two_step_equations", "inequalities", "area_perimeter", "circles"],
  8: ["exponent_rules", "multi_step_equations", "pythagorean", "linear_functions", "systems"],
};

/** A grade's path; with `warmUp`, the grade below's path first (its review). */
export function gradePath(grade: Grade, opts: { warmUp?: boolean } = {}): PathSkillId[] {
  const own = GRADE_PATHS[grade];
  if (!opts.warmUp || grade === 0) return [...own];
  const below = GRADE_PATHS[(grade - 1) as Grade].filter((id) => !own.includes(id));
  return [...below, ...own];
}

/** The grade whose path first lists a skill, or null (a high-school skill). */
export function gradeOfSkill(id: string): Grade | null {
  for (const g of GRADE_IDS) if ((GRADE_PATHS[g] as readonly string[]).includes(id)) return g;
  return null;
}
