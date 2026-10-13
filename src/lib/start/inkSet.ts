/**
 * The handwriting /start shows, written once per build on the server (`GET /api/start/ink`, a
 * static route) so the browser never loads the hand engine:
 *
 * - one example problem for every skill a family can pick or see on the plan (`focusOptions` of
 *   every grade and course), in the tutor's hand: the example its own line names ("Multiply facts
 *   like 6 × 7"), picked by hand (`SKILL_EXAMPLES`) so each one says the skill at a glance;
 * - every problem of the try board (`TRY_PROBLEMS`), for the `try` screen.
 *
 * A line the hand cannot write is left out (the card shows its words alone), never half-written.
 *
 * Server only: it loads the hand engine.
 */
import { GRADE_IDS } from "@/lib/learning/grades";
import { handInk } from "@/lib/landing/handInk";
import { COURSE_IDS } from "@/lib/onboarding/courseIds";
import { TRY_PROBLEMS } from "@/lib/try/problems";
import { focusOptions } from "./plan";

/** One stroke: SVG path data, the pen's weight (1 = the usual pen), and when it is drawn. */
export interface StartInkStroke {
  d: string;
  w: number;
  at: number;
  for: number;
}

/** A line in the hand, in px at `START_INK_SIZE`. */
export interface StartInkLine {
  strokes: StartInkStroke[];
  width: number;
  height: number;
  durationMs: number;
}

export interface StartInkSet {
  /** a skill's example: one or two lines (a system is two) */
  skills: Record<string, { latex: string[]; lines: StartInkLine[] }>;
  /** a try problem's lines, by its id */
  problems: Record<string, StartInkLine[]>;
}

/** The hand's size the set is written at (the try board's own, so its problems look the same). */
export const START_INK_SIZE = 60;
/**
 * Each skill's example, as its line on the screens names it (`K8_SKILLS` blurbs, plan.ts's
 * `COURSE_BLURBS`): one line, or two for a system. Held to the hand in `__tests__/inkSet.test.ts`.
 */
export const SKILL_EXAMPLES: Readonly<Record<string, readonly string[]>> = {
  add_within_10: ["3 + 4"],
  subtract_within_10: ["7 - 2"],
  add_within_20: ["8 + 7"],
  subtract_within_20: ["15 - 8"],
  add_tens: ["40 + 30"],
  add_within_100: ["47 + 38"],
  subtract_within_100: ["72 - 35"],
  add_subtract_within_1000: ["386 + 247"],
  times_tables: ["6 \\times 7"],
  division_facts: ["42 \\div 6"],
  multiply_by_tens: ["4 \\times 60"],
  multi_digit_add_subtract: ["4386 + 2947"],
  multiply_multi_digit: ["34 \\times 26"],
  long_division: ["864 \\div 4"],
  equivalent_fractions: ["\\frac{6}{8} = \\frac{3}{4}"],
  add_fractions_like: ["\\frac{2}{7} + \\frac{3}{7}"],
  add_fractions_unlike: ["\\frac{3}{4} + \\frac{1}{6}"],
  multiply_fractions: ["\\frac{2}{3} \\times \\frac{3}{5}"],
  divide_fractions: ["\\frac{3}{4} \\div \\frac{1}{2}"],
  decimals_add_subtract: ["3.45 + 2.8"],
  decimals_multiply: ["1.2 \\times 3"],
  order_of_operations: ["2 + 3 \\times 4"],
  percents: ["25\\% \\text{ of } 80"],
  negative_numbers: ["-5 + 8"],
  powers_roots: ["3^{2} + \\sqrt{16}"],
  one_step_equations: ["x + 5 = 12"],
  simplify_expressions: ["3x + 2x"],
  proportions: ["\\frac{x}{4} = \\frac{9}{12}"],
  two_step_equations: ["2x + 3 = 11"],
  inequalities: ["2x + 1 > 7"],
  area_perimeter: ["A = 6 \\times 4"],
  circles: ["C = 2\\pi r"],
  exponent_rules: ["x^{2} \\cdot x^{3}"],
  multi_step_equations: ["3(x + 2) = 18"],
  pythagorean: ["a^{2} + b^{2} = c^{2}"],
  linear_functions: ["y = 2x + 1"],
  systems: ["x + y = 10", "x - y = 2"],
  factoring: ["x^{2} + 5x + 6"],
  quadratic_equations: ["x^{2} - 5x + 6 = 0"],
  angles: ["x + 65^{\\circ} = 180^{\\circ}"],
  triangles: ["x + 50 + 60 = 180"],
  coordinate_geometry: ["\\sqrt{3^{2} + 4^{2}}"],
  radicals: ["\\sqrt{x + 3} = 5"],
  rational_expressions: ["\\frac{4}{x} + \\frac{9}{x}"],
  exponential_equations: ["2^{x} = 32"],
  logarithms: ["\\log_{2} 8"],
  functions: ["f(x) = 2x + 1"],
  trig_values: ["\\sin 30^{\\circ}"],
  trig_equations: ["2\\sin x = 1"],
  limits: ["\\lim_{x \\to 2} (x + 3)"],
  derivatives: ["\\frac{d}{dx} x^{3}"],
};

function line(latex: string, seed: number): StartInkLine | null {
  try {
    const hand = handInk(latex, { size: START_INK_SIZE, seed });
    return {
      strokes: hand.strokes.map((s) => ({ d: s.d, w: s.weight, at: s.atMs, for: s.forMs })),
      width: hand.width,
      height: hand.height,
      durationMs: hand.durationMs,
    };
  } catch {
    return null;
  }
}

/** Every skill /start can show: each grade's path and each course's topics, once each. */
export function startSkills(): string[] {
  const all = [...GRADE_IDS.map((grade) => ({ kind: "grade" as const, grade })), ...COURSE_IDS.map((course) => ({ kind: "course" as const, course }))];
  return [...new Set(all.flatMap((choice) => focusOptions(choice)))];
}

export function buildStartInkSet(): StartInkSet {
  const skills: StartInkSet["skills"] = {};
  startSkills().forEach((skill, n) => {
    const example = SKILL_EXAMPLES[skill];
    if (!example) return;
    const lines = example.map((l, i) => line(l, n * 3 + i + 1));
    if (lines.every((l): l is StartInkLine => l !== null)) skills[skill] = { latex: [...example], lines };
  });

  const problems: StartInkSet["problems"] = {};
  const seen = new Map<string, number>();
  for (const p of TRY_PROBLEMS) {
    // the seeds /try uses for the same problem, so the hand is the same on both pages
    const n = (seen.get(p.band) ?? 0) + 1;
    seen.set(p.band, n);
    const lines = p.lines.map((l, i) => line(l, n + i));
    if (lines.every((l): l is StartInkLine => l !== null)) problems[p.id] = lines;
  }
  return { skills, problems };
}
