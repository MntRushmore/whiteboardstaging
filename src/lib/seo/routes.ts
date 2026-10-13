/**
 * Every public, indexable address on agathon.app, in one place (SEO build 2026-10-13, docs/SEO.md).
 * The sitemap, llms.txt, the /math pages' links and their tests all read this file, so a page
 * cannot be linked under one address and listed under another.
 *
 * The math library:
 * - `/math`: the hub, every grade and course.
 * - `/math/<level>`: a grade (`/math/3rd-grade`, `/math/kindergarten`) or a high-school course
 *   (`/math/algebra-1`), with its skill path.
 * - `/math/<skill>`: one skill (`/math/long-division`): a worked example, the usual slips and a
 *   practice set with answers.
 * Levels and skills share the one `[slug]` segment, so their slugs must never collide (tested).
 *
 * Slugs are the words a parent types into a search box, not the app's ids. They are addresses:
 * never rename one once it is live (a rename needs a permanent redirect in next.config.ts).
 *
 * Pure data and helpers: no React, no network.
 */
import { GRADES, type Grade } from "@/lib/learning/grades";
import type { TopicId } from "@/lib/learning/topics";
import type { CourseId } from "@/lib/onboarding/courseIds";

/** The math library's root. */
export const MATH_PATH = "/math";

// ------------------------------------------------------------------ levels (grades and courses)

/** "kindergarten", "1st-grade" … "8th-grade" */
export const GRADE_SLUGS: Readonly<Record<Grade, string>> = {
  0: "kindergarten",
  1: "1st-grade",
  2: "2nd-grade",
  3: "3rd-grade",
  4: "4th-grade",
  5: "5th-grade",
  6: "6th-grade",
  7: "7th-grade",
  8: "8th-grade",
};

/** The high-school courses a student can pick (COURSES without "other"). */
export type SeoCourseId = Exclude<CourseId, "other">;

export const COURSE_SLUGS: Readonly<Record<SeoCourseId, string>> = {
  algebra1: "algebra-1",
  geometry: "geometry",
  algebra2: "algebra-2",
  precalc_calc: "precalculus-and-calculus",
};

export type Level = { kind: "grade"; grade: Grade; slug: string } | { kind: "course"; course: SeoCourseId; slug: string };

/** Kindergarten to 8th grade, then the courses, in teaching order. */
export const LEVELS: readonly Level[] = [
  ...GRADES.map((g): Level => ({ kind: "grade", grade: g.id, slug: GRADE_SLUGS[g.id] })),
  ...(Object.keys(COURSE_SLUGS) as SeoCourseId[]).map((course): Level => ({ kind: "course", course, slug: COURSE_SLUGS[course] })),
];

export function levelBySlug(slug: string): Level | null {
  return LEVELS.find((l) => l.slug === slug) ?? null;
}

export function gradePath(grade: Grade): string {
  return `${MATH_PATH}/${GRADE_SLUGS[grade]}`;
}

export function coursePath(course: SeoCourseId): string {
  return `${MATH_PATH}/${COURSE_SLUGS[course]}`;
}

export function levelPath(level: Level): string {
  return `${MATH_PATH}/${level.slug}`;
}

// ------------------------------------------------------------------ skills

/**
 * Every topic the app can teach (a topic board with a generator), under the words people search
 * for. 56 topics on 2026-10-13; the test fails when a topic is added without a slug here.
 */
export const SKILL_SLUGS: Readonly<Record<TopicId, string>> = {
  add_within_10: "addition-within-10",
  subtract_within_10: "subtraction-within-10",
  add_within_20: "addition-within-20",
  subtract_within_20: "subtraction-within-20",
  add_tens: "adding-tens",
  add_within_100: "two-digit-addition",
  subtract_within_100: "two-digit-subtraction",
  add_subtract_within_1000: "three-digit-addition-and-subtraction",
  multi_digit_add_subtract: "multi-digit-addition-and-subtraction",
  times_tables: "times-tables",
  division_facts: "division-facts",
  multiply_by_tens: "multiplying-by-multiples-of-10",
  multiply_multi_digit: "multi-digit-multiplication",
  long_division: "long-division",
  negative_numbers: "negative-numbers",
  order_of_operations: "order-of-operations",
  equivalent_fractions: "equivalent-fractions",
  add_fractions_like: "adding-fractions-with-like-denominators",
  add_fractions_unlike: "adding-fractions-with-unlike-denominators",
  multiply_fractions: "multiplying-fractions",
  divide_fractions: "dividing-fractions",
  decimals_add_subtract: "adding-and-subtracting-decimals",
  decimals_multiply: "multiplying-decimals",
  percents: "percents",
  proportions: "proportions",
  powers_roots: "exponents-and-square-roots",
  simplify_expressions: "simplifying-expressions",
  one_step_equations: "one-step-equations",
  two_step_equations: "two-step-equations",
  multi_step_equations: "multi-step-equations",
  inequalities: "inequalities",
  absolute_value: "absolute-value-equations",
  systems: "systems-of-equations",
  exponent_rules: "exponent-rules",
  polynomials: "multiplying-polynomials",
  factoring: "factoring-quadratics",
  quadratic_equations: "quadratic-equations",
  radicals: "radicals",
  rational_expressions: "rational-expressions",
  complex_numbers: "complex-numbers",
  linear_functions: "slope-and-linear-equations",
  functions: "functions",
  exponential_equations: "exponential-equations",
  logarithms: "logarithms",
  angles: "angles",
  triangles: "triangle-angles",
  pythagorean: "pythagorean-theorem",
  area_perimeter: "area-and-perimeter",
  circles: "circumference-and-area-of-circles",
  coordinate_geometry: "distance-and-midpoint",
  trig_values: "trig-values-of-special-angles",
  trig_equations: "trig-equations",
  limits: "limits",
  derivatives: "derivatives",
  integrals: "integrals",
  units: "unit-conversions",
};

export const SKILL_IDS = Object.keys(SKILL_SLUGS) as TopicId[];

export function skillBySlug(slug: string): TopicId | null {
  return SKILL_IDS.find((id) => SKILL_SLUGS[id] === slug) ?? null;
}

export function skillPath(id: TopicId): string {
  return `${MATH_PATH}/${SKILL_SLUGS[id]}`;
}

/** Every slug the `/math/[slug]` route answers, levels first. */
export function mathSlugs(): string[] {
  return [...LEVELS.map((l) => l.slug), ...SKILL_IDS.map((id) => SKILL_SLUGS[id])];
}

// ------------------------------------------------------------------ the whole site

/** The other public pages (the landing page is "/"). */
export const ABOUT_PATH = "/about";
export const LEGAL_PATHS = ["/privacy", "/terms", "/refunds"] as const;

export interface PublicPage {
  path: string;
  /** sitemap priority, 0..1 */
  priority: number;
  changeFrequency: "daily" | "weekly" | "monthly" | "yearly";
}

/** Every page a search engine or an AI crawler should read, most important first. */
export function publicPages(): PublicPage[] {
  return [
    { path: "/", priority: 1, changeFrequency: "weekly" },
    { path: MATH_PATH, priority: 0.9, changeFrequency: "weekly" },
    ...LEVELS.map((l) => ({ path: levelPath(l), priority: 0.8, changeFrequency: "monthly" as const })),
    ...SKILL_IDS.map((id) => ({ path: skillPath(id), priority: 0.7, changeFrequency: "monthly" as const })),
    { path: ABOUT_PATH, priority: 0.6, changeFrequency: "monthly" },
    ...LEGAL_PATHS.map((path) => ({ path, priority: 0.2, changeFrequency: "yearly" as const })),
  ];
}
