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
 * `finish.ts`'s question, asked once the account exists). Light on purpose: /start's first screen
 * loads it, so it reads the K–8 skills from `grades.ts` and keeps its own words for the high-school
 * ones (held to `SKILLS` and the topic list in `__tests__/plan.test.ts`) rather than load
 * src/lib/learning/contracts.ts, which brings zod.
 */
import type { SkillId } from "@/lib/learning/contracts";
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
 * The words for each skill /start shows that is not a K–8 one (those come from `K8_SKILLS`): its
 * name (`SKILLS`) and its line in a student's words (the topic list's, src/lib/learning/topics.ts),
 * copied here so the first screen loads neither. `__tests__/plan.test.ts` holds both to their source.
 */
const COURSE_WORDS: Partial<Record<SkillId, { name: string; blurb: string }>> = {
  two_step_equations: { name: "Two-step equations", blurb: "Solve equations like 2x + 3 = 11" },
  inequalities: { name: "Inequalities", blurb: "Solve with <, >, ≤ and ≥" },
  linear_functions: { name: "Lines and slope", blurb: "Slope, lines and y = mx + b" },
  systems: { name: "Systems of equations", blurb: "Two equations, two unknowns" },
  factoring: { name: "Factoring", blurb: "Turn x² + 5x + 6 into brackets" },
  quadratic_equations: { name: "Quadratic equations", blurb: "Solve equations with an x²" },
  angles: { name: "Angles", blurb: "Angles on a line and around a point" },
  triangles: { name: "Triangles", blurb: "The angles in a triangle make 180°" },
  pythagorean: { name: "Pythagorean theorem", blurb: "a² + b² = c² in a right triangle" },
  area_perimeter: { name: "Area and perimeter", blurb: "How much space, and the way round" },
  circles: { name: "Circles", blurb: "Circumference and area with π" },
  coordinate_geometry: { name: "Distance and midpoint", blurb: "Distance and midpoint of two points" },
  radicals: { name: "Radicals", blurb: "Simplify roots and solve √ equations" },
  rational_expressions: { name: "Rational expressions", blurb: "Fractions with x in them" },
  exponential_equations: { name: "Exponential equations", blurb: "Solve equations like 2ˣ = 32" },
  logarithms: { name: "Logarithms", blurb: "Logs, the opposite of powers" },
  functions: { name: "Functions", blurb: "f(x): put a number in, get one out" },
  trig_values: { name: "Trig values", blurb: "sin, cos and tan of special angles" },
  trig_equations: { name: "Trig equations", blurb: "Solve equations like 2 sin x = 1" },
  limits: { name: "Limits", blurb: "Where a function is heading" },
  derivatives: { name: "Derivatives", blurb: "How fast things change: d/dx" },
  negative_numbers: { name: "Negative numbers", blurb: "Numbers below zero" },
  order_of_operations: { name: "Order of operations", blurb: "Which step comes first (PEMDAS)" },
  powers_roots: { name: "Powers and square roots", blurb: "Squares, cubes and square roots" },
  simplify_expressions: { name: "Simplifying expressions", blurb: "Collect like terms, like 3x + 2x" },
  one_step_equations: { name: "One-step equations", blurb: "Solve x + 5 = 12 in one step" },
  multi_step_equations: { name: "Multi-step equations", blurb: "Brackets, or x on both sides" },
  exponent_rules: { name: "Exponent rules", blurb: "x² · x³ and the other power rules" },
};

/** The skills a family may pick on `focus` for this grade or course; [] when there are none. */
export function focusOptions(choice: WelcomeChoice | null): PathSkillId[] {
  if (!choice) return [];
  if (choice.kind === "grade") return [...GRADE_PATHS[choice.grade]];
  return [...(COURSE_FOCUS[choice.course] ?? [])];
}

/**
 * The plan's skills, in order: those picked on `focus`, in teaching order (the path's own, so
 * adding comes before subtracting whatever was tapped first), then the rest of the grade's path or
 * the course's list. `finish.ts` makes the first board on the first of these that has practice
 * problems.
 */
export function planSkills(answers: Pick<StartAnswers, "focus" | "choice">): PathSkillId[] {
  const offer = focusOptions(answers.choice);
  const rank = (id: PathSkillId) => {
    const at = offer.indexOf(id);
    return at < 0 ? offer.length : at;
  };
  const picked = [...new Set(answers.focus)].sort((a, b) => rank(a) - rank(b));
  return [...new Set([...picked, ...offer])];
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
  return COURSE_WORDS[id as SkillId] ?? { name: id, blurb: "" };
}

/** Every skill /start can offer: each grade's path and each course's topics. */
export const START_SKILLS: ReadonlySet<string> = new Set<string>([...Object.values(GRADE_PATHS).flat(), ...Object.values(COURSE_FOCUS).flat()]);

/** A skill /start offers (and so the only kind its answers may carry). */
export function isStartSkill(id: unknown): id is PathSkillId {
  return typeof id === "string" && START_SKILLS.has(id);
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
