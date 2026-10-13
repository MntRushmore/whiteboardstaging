/**
 * The plan /start builds (docs/START-FLOW.md, screens `focus`, `building` and `plan`): which skills a
 * family can pick as tricky, which skills the plan starts with, and the words for them. The same
 * choice decides the first board once the account exists (`finish.ts` reads `planSkills`), so the
 * plan the family saw is the board they get.
 *
 * - A grade (Kindergarten to 8th) offers its path (`GRADE_PATHS`), in teaching order.
 * - A high-school course offers a short list of its topics (`COURSE_FOCUS`), the ones a student
 *   most often gets stuck on, in teaching order.
 * - "Something else", or no answer, offers none: the `focus` screen is skipped.
 *
 * The plan's skills are the ones picked (in the order picked), then the rest of the offer, so a
 * family that picked "Not sure" starts at the beginning of the path.
 *
 * Pure: no React, no storage, no network, no generators (whether a skill has practice problems is
 * `finish.ts`'s question, asked once the account exists).
 */
import { SKILLS, type SkillId } from "@/lib/learning/contracts";
import { GRADE_PATHS, gradeLabel, isK8SkillId, K8_SKILLS, type PathSkillId } from "@/lib/learning/grades";
import type { CourseId } from "@/lib/onboarding/courseIds";
import type { WelcomeChoice } from "@/lib/onboarding/choice";
import { COURSES } from "@/lib/onboarding/courses";
import type { StartAnswers } from "./contracts";

/** How many skills the plan screen shows. */
export const PLAN_SKILLS = 3;

/**
 * A high-school course's topics on the `focus` screen: six each, picked from the course's own
 * (`SKILLS[].courses`), every one a topic with practice problems (`TOPIC_IDS`, held to it in the tests).
 */
export const COURSE_FOCUS: Readonly<Record<CourseId, readonly SkillId[]>> = {
  algebra1: ["two_step_equations", "inequalities", "linear_functions", "systems", "factoring", "quadratic_equations"],
  geometry: ["angles", "triangles", "pythagorean", "area_perimeter", "circles", "coordinate_geometry"],
  algebra2: ["factoring", "quadratic_equations", "radicals", "rational_expressions", "exponential_equations", "logarithms"],
  precalc_calc: ["functions", "logarithms", "trig_values", "trig_equations", "limits", "derivatives"],
  other: [],
};

/**
 * One line under each high-school topic, in a student's words (the topic list's own lines, from
 * src/lib/learning/topics.ts, copied here so /start does not load the topic list). K–8 skills take
 * theirs from `K8_SKILLS`.
 */
const COURSE_BLURBS: Partial<Record<SkillId, string>> = {
  two_step_equations: "Solve equations like 2x + 3 = 11",
  inequalities: "Solve with <, >, ≤ and ≥",
  linear_functions: "Slope, lines and y = mx + b",
  systems: "Two equations, two unknowns",
  factoring: "Turn x² + 5x + 6 into brackets",
  quadratic_equations: "Solve equations with an x²",
  angles: "Angles on a line and around a point",
  triangles: "The angles in a triangle make 180°",
  pythagorean: "a² + b² = c² in a right triangle",
  area_perimeter: "How much space, and the way round",
  circles: "Circumference and area with π",
  coordinate_geometry: "Distance and midpoint of two points",
  radicals: "Simplify roots and solve √ equations",
  rational_expressions: "Fractions with x in them",
  exponential_equations: "Solve equations like 2ˣ = 32",
  logarithms: "Logs, the opposite of powers",
  functions: "f(x): put a number in, get one out",
  trig_values: "sin, cos and tan of special angles",
  trig_equations: "Solve equations like 2 sin x = 1",
  limits: "Where a function is heading",
  derivatives: "How fast things change: d/dx",
  // the path skills a K–8 grade shares with the courses
  negative_numbers: "Numbers below zero",
  order_of_operations: "Which step comes first (PEMDAS)",
  powers_roots: "Squares, cubes and square roots",
  simplify_expressions: "Collect like terms, like 3x + 2x",
  one_step_equations: "Solve x + 5 = 12 in one step",
  multi_step_equations: "Brackets, or x on both sides",
  exponent_rules: "x² · x³ and the other power rules",
};

/** The skills a family may pick on `focus` for this grade or course; [] when there are none. */
export function focusOptions(choice: WelcomeChoice | null): PathSkillId[] {
  if (!choice) return [];
  if (choice.kind === "grade") return [...GRADE_PATHS[choice.grade]];
  return [...(COURSE_FOCUS[choice.course] ?? [])];
}

/**
 * The plan's skills, in order: those picked on `focus` (in the order picked), then the rest of the
 * grade's path or the course's list. `finish.ts` makes the first board on the first of these that
 * has practice problems.
 */
export function planSkills(answers: Pick<StartAnswers, "focus" | "choice">): PathSkillId[] {
  return [...new Set([...answers.focus, ...focusOptions(answers.choice)])];
}

export interface PlanSkill {
  id: PathSkillId;
  /** "Times tables" */
  name: string;
  /** "Multiply facts like 6 × 7" */
  blurb: string;
  /** picked on `focus` */
  picked: boolean;
}

/** A skill's name and line as the screens say them. */
export function skillWords(id: PathSkillId): { name: string; blurb: string } {
  if (isK8SkillId(id)) return K8_SKILLS[id];
  return { name: SKILLS.find((s) => s.id === id)?.name ?? id, blurb: COURSE_BLURBS[id as SkillId] ?? "" };
}

export interface StartPlan {
  /** "3rd grade", "Algebra 1"; null with no answer */
  level: string | null;
  /** the first `PLAN_SKILLS` of `planSkills` */
  skills: PlanSkill[];
  /** "Something else" or no answer: the plan is the course's starters, not a list of skills */
  open: boolean;
}

/** The plan screen's plan. */
export function buildPlan(answers: Pick<StartAnswers, "focus" | "choice">): StartPlan {
  const picked = new Set<string>(answers.focus);
  const skills = planSkills(answers)
    .slice(0, PLAN_SKILLS)
    .map((id) => ({ id, ...skillWords(id), picked: picked.has(id) }));
  const choice = answers.choice;
  const level = !choice ? null : choice.kind === "grade" ? gradeLabel(choice.grade) : (COURSES.find((c) => c.id === choice.course)?.label ?? null);
  return { level, skills, open: skills.length === 0 };
}
