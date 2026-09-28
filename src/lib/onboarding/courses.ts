/**
 * The courses a new student chooses from in the welcome, and the starter problem the tutor writes
 * on their first board. Pure data: the board writes a starter through the board chat's own
 * executor (`write_problems`, `src/lib/live/chat/desk.ts`), so it is checked by the engine and
 * written in the tutor's hand like any problem the chat writes — no model call, no credits.
 *
 * Every starter is held to this by `__tests__/courses.test.ts`: `verifyProblem` accepts it (the
 * engine reads it and `localSolve` answers it), the hand can write it, its answer is clean, and
 * `firstStep` — the step the coach mark nudges towards — gets a tick under it in Feedback, while
 * a wrong step gets a ring. A course's starters are all tick-able in Feedback, which is why the
 * calculus course starts on logs, exponentials and trig rather than a derivative: the engine
 * answers a derivative but does not mark a student's rewrite of one.
 */

import { isCourseId, type CourseId } from "./courseIds";

export { COURSE_IDS, isCourseId, type CourseId } from "./courseIds";

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
  { id: "other", label: "Something else", blurb: "Any maths you're working on" },
];

export interface StarterProblem {
  /** the problem as the tutor writes it, in LaTeX (one line; a system would be 2–3) */
  lines: readonly string[];
  /** a right first step: the engine ticks it under the problem in Feedback (tested) */
  firstStep: string;
  /** a nudge for the first coach mark, in words — shown in the popover, never on the board */
  hint: string;
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
    { lines: ["x + 65^{\\circ} = 180^{\\circ}"], firstStep: "x = 115^{\\circ}", hint: "Angles on a straight line add up to 180°." },
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
 * Which of a course's starters a student gets: stable for one seed (their user id), so a reload
 * writes the same problem, and spread across students.
 */
export function starterIndex(course: CourseId, seed: string): number {
  const n = STARTER_PROBLEMS[course].length;
  return n === 0 ? 0 : hash(`${course}:${seed}`) % n;
}

/**
 * The starters to try, in order: the student's own first, then the rest of the course's as
 * fallbacks (the board writes the first one the engine and the hand accept). A course the
 * student skipped choosing gets "Something else".
 */
export function startersFor(course: string | null | undefined, index: number): StarterProblem[] {
  const list = STARTER_PROBLEMS[isCourseId(course) ? course : "other"];
  if (list.length === 0) return [];
  const first = ((Math.trunc(index) % list.length) + list.length) % list.length;
  return [...list.slice(first), ...list.slice(0, first)];
}
