/**
 * The courses a new student chooses from in the welcome, the starter problems for each grade and
 * course, and which one the tutor writes on their first board. Pure data: the board writes a
 * starter through the board chat's own executor (`write_problems`, `src/lib/live/chat/desk.ts`),
 * so it is checked by the engine and written in the tutor's hand like any problem the chat writes —
 * no model call, no ink.
 *
 * A student with a grade (Kindergarten to 8th, `GRADE_STARTERS`, 2026-10-09) starts on that
 * grade's arithmetic or equations: prod showed who actually practises (young students adding,
 * times tables, fractions), and the welcome that offered Algebra 1 first lost half of them to
 * "Something else" or a skip. A high-school student starts on their course (`STARTER_PROBLEMS`).
 *
 * Every starter is held to this by `__tests__/courses.test.ts`: `verifyProblem` accepts it (the
 * engine reads it and `localSolve` answers it), the hand can write it, its answer is clean, and
 * `firstStep` — the step the coach mark nudges towards — gets a tick under it in Feedback, while
 * a wrong step gets a ring (`__tests__/starters.board.test.ts` checks the same on a live board).
 * A course's starters are all tick-able in Feedback, which is why the calculus course starts on
 * logs, exponentials and trig rather than a derivative: the engine answers a derivative but does
 * not mark a student's rewrite of one.
 */

import { isGrade, isK8SkillId, K8_SKILLS, type Grade, type PathSkillId } from "@/lib/learning/grades";
import { isCourseId, type CourseId } from "./courseIds";

export interface Course {
  id: CourseId;
  label: string;
  /** one line under the label in the welcome */
  blurb: string;
}

export const COURSES: readonly Course[] = [
  { id: "algebra1", label: "Algebra 1", blurb: "Equations, functions and graphs" },
  { id: "geometry", label: "Geometry", blurb: "Angles, triangles and proofs" },
  { id: "algebra2", label: "Algebra 2", blurb: "Quadratics, radicals and exponentials" },
  { id: "precalc_calc", label: "Pre-calculus / Calculus", blurb: "Logs, trig and derivatives" },
  { id: "other", label: "Something else", blurb: "Any math you're working on" },
];

export interface StarterProblem {
  /** the problem as the tutor writes it, in LaTeX (one line; a system would be 2–3) */
  lines: readonly string[];
  /**
   * a right first step: the engine ticks it under the problem in Feedback (tested). For a sum it is
   * what a young student writes, the answer alone (`7` under `3 + 4`), which the board judges as
   * `= 7` (`bareAnswer` in `LiveLoop.analyze`).
   */
  firstStep: string;
  /** a nudge for the first coach mark, in words — shown in the popover, never on the board */
  hint: string;
  /**
   * The first step IS the answer (`3 + 4` → `7`, `x + 7 = 15` → `x = 8`; held to the engine in the
   * tests). The first coach mark then asks for the answer rather than a step, and once the answer
   * is ticked Help me has nothing left to do on this problem, so the tour writes another one for
   * coach mark 2 (`helpProblemFor` in `tour.ts`).
   */
  oneStep?: true;
  /** a grade's starter: the skill on that grade's path it practises (`GRADE_PATHS`); it names the first board */
  skill?: PathSkillId;
}

export const STARTER_PROBLEMS: Readonly<Record<CourseId, readonly StarterProblem[]>> = {
  algebra1: [
    { lines: ["2x + 3 = 11"], firstStep: "2x = 8", hint: "Try taking 3 from both sides." },
    { lines: ["5x - 4 = 21"], firstStep: "5x = 25", hint: "Try adding 4 to both sides." },
    { lines: ["3(x + 2) = 18"], firstStep: "3x + 6 = 18", hint: "Try expanding the bracket." },
  ],
  geometry: [
    { lines: ["3^{2} + 4^{2} = c^{2}"], firstStep: "9 + 16 = c^{2}", hint: "Try working out the two squares." },
    { lines: ["6^{2} + 8^{2} = c^{2}"], firstStep: "36 + 64 = c^{2}", hint: "Try working out the two squares." },
    { lines: ["x + 65^{\\circ} = 180^{\\circ}"], firstStep: "x = 115^{\\circ}", hint: "Angles on a straight line add up to 180°.", oneStep: true },
  ],
  algebra2: [
    { lines: ["x^{2} - 5x + 6 = 0"], firstStep: "(x - 2)(x - 3) = 0", hint: "Try factoring the left side." },
    { lines: ["\\sqrt{x + 3} = 5"], firstStep: "x + 3 = 25", hint: "Try squaring both sides." },
    { lines: ["2^{x} = 32"], firstStep: "2^{x} = 2^{5}", hint: "Try writing 32 as a power of 2." },
  ],
  precalc_calc: [
    { lines: ["\\log_{2} x = 5"], firstStep: "x = 2^{5}", hint: "Try writing it without the log." },
    { lines: ["3^{x - 1} = 27"], firstStep: "3^{x - 1} = 3^{3}", hint: "Try writing 27 as a power of 3." },
    { lines: ["2\\sin x = 1"], firstStep: "\\sin x = \\frac{1}{2}", hint: "Try dividing both sides by 2." },
  ],
  other: [
    { lines: ["4x - 7 = 13"], firstStep: "4x = 20", hint: "Try adding 7 to both sides." },
    { lines: ["\\frac{3}{4} + \\frac{1}{6}"], firstStep: "\\frac{9}{12} + \\frac{2}{12}", hint: "Try writing both fractions in twelfths." },
    { lines: ["2(x - 1) = 10"], firstStep: "x - 1 = 5", hint: "Try dividing both sides by 2." },
  ],
};

/**
 * Each grade's starters (0 is Kindergarten): the first skills of its path (`GRADE_PATHS`), at the
 * size a child of that age meets them. Arithmetic up to 4th grade, where the first step is the
 * answer and the hints count on fingers and tens; fractions in 4th and 5th; equations from 6th.
 * No decimals yet: the engine does not ring a wrong decimal sum, and coach mark 1 promises a tick
 * or a ring.
 */
export const GRADE_STARTERS: Readonly<Record<Grade, readonly StarterProblem[]>> = {
  0: [
    { lines: ["3 + 4"], firstStep: "7", hint: "Hold up 3 fingers, then 4 more.", oneStep: true, skill: "add_within_10" },
    { lines: ["5 + 2"], firstStep: "7", hint: "Start at 5 and count on 2 more.", oneStep: true, skill: "add_within_10" },
    { lines: ["7 - 3"], firstStep: "4", hint: "Start at 7 and count back 3.", oneStep: true, skill: "subtract_within_10" },
  ],
  1: [
    { lines: ["8 + 7"], firstStep: "15", hint: "Make a 10 first: 8 and 2 more is 10.", oneStep: true, skill: "add_within_20" },
    { lines: ["15 - 8"], firstStep: "7", hint: "Count up from 8 to 15.", oneStep: true, skill: "subtract_within_20" },
    { lines: ["40 + 30"], firstStep: "70", hint: "4 tens and 3 tens make how many tens?", oneStep: true, skill: "add_tens" },
  ],
  2: [
    { lines: ["47 + 38"], firstStep: "85", hint: "Add the tens, then add the ones.", oneStep: true, skill: "add_within_100" },
    { lines: ["72 - 35"], firstStep: "37", hint: "Take away 30, then take away 5.", oneStep: true, skill: "subtract_within_100" },
    { lines: ["56 + 27"], firstStep: "83", hint: "Add the tens, then add the ones.", oneStep: true, skill: "add_within_100" },
  ],
  3: [
    { lines: ["6 \\times 7"], firstStep: "42", hint: "Think of 6 groups of 7.", oneStep: true, skill: "times_tables" },
    { lines: ["42 \\div 6"], firstStep: "7", hint: "What times 6 makes 42?", oneStep: true, skill: "division_facts" },
    { lines: ["4 \\times 60"], firstStep: "240", hint: "Work out 4 × 6, then put a 0 on the end.", oneStep: true, skill: "multiply_by_tens" },
  ],
  4: [
    { lines: ["\\frac{2}{7} + \\frac{3}{7}"], firstStep: "\\frac{5}{7}", hint: "Same bottom number: add the tops.", oneStep: true, skill: "add_fractions_like" },
    { lines: ["46 \\times 7"], firstStep: "322", hint: "Try 40 × 7 and 6 × 7, then add them.", oneStep: true, skill: "multiply_multi_digit" },
    { lines: ["864 \\div 4"], firstStep: "216", hint: "Share out the hundreds, then tens, then ones.", oneStep: true, skill: "long_division" },
  ],
  5: [
    { lines: ["\\frac{1}{2} + \\frac{1}{3}"], firstStep: "\\frac{3}{6} + \\frac{2}{6}", hint: "Try writing both fractions in sixths.", skill: "add_fractions_unlike" },
    { lines: ["\\frac{2}{3} \\times \\frac{3}{5}"], firstStep: "\\frac{6}{15}", hint: "Multiply the tops, then the bottoms.", skill: "multiply_fractions" },
    { lines: ["\\frac{3}{4} + \\frac{1}{6}"], firstStep: "\\frac{9}{12} + \\frac{2}{12}", hint: "Try writing both fractions in twelfths.", skill: "add_fractions_unlike" },
  ],
  6: [
    { lines: ["x + 7 = 15"], firstStep: "x = 8", hint: "Try taking 7 from both sides.", oneStep: true, skill: "one_step_equations" },
    { lines: ["3x = 24"], firstStep: "x = 8", hint: "Try dividing both sides by 3.", oneStep: true, skill: "one_step_equations" },
    { lines: ["\\frac{3}{4} \\div \\frac{1}{2}"], firstStep: "\\frac{3}{4} \\times \\frac{2}{1}", hint: "Flip the second fraction, then multiply.", skill: "divide_fractions" },
  ],
  7: [
    { lines: ["2x + 5 = 17"], firstStep: "2x = 12", hint: "Try taking 5 from both sides.", skill: "two_step_equations" },
    { lines: ["3x - 4 = 11"], firstStep: "3x = 15", hint: "Try adding 4 to both sides.", skill: "two_step_equations" },
    { lines: ["\\frac{x}{4} = \\frac{9}{12}"], firstStep: "12x = 36", hint: "Try cross-multiplying.", skill: "proportions" },
  ],
  8: [
    { lines: ["5x - 3 = 2x + 9"], firstStep: "3x - 3 = 9", hint: "Try taking 2x from both sides.", skill: "multi_step_equations" },
    { lines: ["2(x + 3) = 14"], firstStep: "x + 3 = 7", hint: "Try dividing both sides by 2.", skill: "multi_step_equations" },
    { lines: ["3x + 4 = x + 10"], firstStep: "2x + 4 = 10", hint: "Try taking x from both sides.", skill: "multi_step_equations" },
  ],
};

/** FNV-1a over the string: a stable small number from a user id. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * The starter list a student draws from: their grade's when they have one (it outranks the course,
 * which is "other" for every grade), else their course's. A student who chose neither gets
 * "Something else".
 */
function starterList(course: unknown, grade: unknown): readonly StarterProblem[] {
  if (isGrade(grade)) return GRADE_STARTERS[grade];
  return STARTER_PROBLEMS[isCourseId(course) ? course : "other"];
}

/**
 * Which of a grade's or course's starters a student gets: stable for one seed (their user id), so
 * a reload writes the same problem, and spread across students.
 */
export function starterIndex(course: CourseId, seed: string, grade: Grade | null = null): number {
  const n = starterList(course, grade).length;
  const key = isGrade(grade) ? `grade${grade}` : course;
  return n === 0 ? 0 : hash(`${key}:${seed}`) % n;
}

/**
 * The starters to try, in order: the student's own first, then the rest of the grade's or course's
 * as fallbacks (the board writes the first one the engine and the hand accept). Read back from the
 * tour's marker, so whatever is unknown falls back: no grade → the course, no course → "Something
 * else".
 */
export function startersFor(course: string | null | undefined, index: number, grade?: number | null): StarterProblem[] {
  const list = starterList(course, grade);
  if (list.length === 0) return [];
  const first = ((Math.trunc(index) % list.length) + list.length) % list.length;
  return [...list.slice(first), ...list.slice(0, first)];
}

/**
 * The first board's name from its starter: the skill a young student is practising ("Adding to
 * 10") reads better on the boards home than the sum ("3 + 4"). Null when the starter has no K–8
 * skill; the caller then names the board from the problem (`boardTitleFromLatex`), as before.
 */
export function starterBoardTitle(starter: StarterProblem | null | undefined): string | null {
  return starter?.skill && isK8SkillId(starter.skill) ? K8_SKILLS[starter.skill].name : null;
}
