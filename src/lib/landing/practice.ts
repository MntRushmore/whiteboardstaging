/**
 * "What they'll practice" on the parent landing page: one tab per grade, Kindergarten to 8th, with
 * that grade's skill path in teaching order, and a High school tab with the four courses. A parent
 * asks "is this at my kid's level?" before anything else, so the page answers with the real paths
 * (`GRADE_PATHS`, the skills' names and one-line examples from `K8_SKILLS` and `SKILLS`), never a
 * hand-written list that could drift from what the app teaches.
 *
 * Only skills a student can open today are listed (`isTopicId`): a skill whose topic board is not
 * built yet would be a promise the app cannot keep.
 *
 * Pure: no React, no network. Unit-tested in `__tests__/practice.test.ts`.
 */
import { GRADES, gradePath, type Grade } from "@/lib/learning/grades";
import { courseTopicIds, isTopicId } from "@/lib/learning/topics";
import { COURSES } from "@/lib/onboarding/courses";
import { pathIcon, pathSkillBlurb, pathSkillName, type PathIcon } from "@/lib/path/pathView";

/** A skill on a grade's path, as the picker shows it. */
export interface PracticeSkill {
  id: string;
  name: string;
  /** one line with an example, in a kid's words; null when the skill has none */
  blurb: string | null;
  /** the operation's sign or the skill's area, for the stop's picture */
  icon: PathIcon;
}

/** A high-school course and its topics. */
export interface PracticeCourse {
  id: string;
  label: string;
  blurb: string;
  topics: string[];
}

/** One tab of the picker: a grade with its path, or the high-school courses. */
export type PracticeTab =
  | { kind: "grade"; id: string; grade: Grade; chip: string; title: string; skills: PracticeSkill[] }
  | { kind: "courses"; id: string; chip: string; title: string; courses: PracticeCourse[] };

/** The high-school tab's id (the grades' tabs are "0" to "8"). */
export const HIGH_SCHOOL_TAB = "hs";

/** The tab shown first: 3rd grade, the middle of who practises most (adding, times tables, fractions). */
export const DEFAULT_PRACTICE_TAB = "3";

export const PRACTICE_COPY = {
  /** a grade's chip: "K", "1st" … "8th" (GRADES' `short`), and the high-school chip */
  highSchoolChip: "High school",
  highSchoolTitle: "High school courses",
  /** under a grade's name: no count (two skills for Kindergarten would undersell it) */
  gradeNote: "Their path this year, one skill after another",
  courseNote: "They pick the course they're taking",
} as const;

/**
 * The app's skill blurbs in US English for this page, where every parent is in the US: the app's
 * own words ("Brackets, or x on both sides") read like typos here. Whole words only.
 */
const US_WORDS: readonly [RegExp, string][] = [
  [/\bBrackets\b/g, "Parentheses"],
  [/\bbrackets\b/g, "parentheses"],
  [/\bbracket\b/g, "parenthesis"],
  [/\bthe way round\b/g, "the distance around"],
  [/\bpractis(e|es|ed|ing)\b/g, "practic$1"],
  [/\bmaths\b/g, "math"],
  [/\bcolour/g, "color"],
  [/\bcentre/g, "center"],
];

export function usEnglish(text: string): string {
  return US_WORDS.reduce((out, [from, to]) => out.replace(from, to), text);
}

function skillOf(id: string): PracticeSkill {
  const blurb = pathSkillBlurb(id);
  return { id, name: usEnglish(pathSkillName(id)), blurb: blurb && usEnglish(blurb), icon: pathIcon(id) };
}

/** Every tab, Kindergarten first and High school last. */
export function practiceTabs(): PracticeTab[] {
  const grades: PracticeTab[] = GRADES.map((g) => ({
    kind: "grade",
    id: String(g.id),
    grade: g.id,
    chip: g.short,
    title: g.label,
    skills: gradePath(g.id).filter(isTopicId).map(skillOf),
  }));
  const courses: PracticeCourse[] = COURSES.filter((c) => c.id !== "other").map((c) => ({
    id: c.id,
    label: c.label,
    blurb: usEnglish(c.blurb),
    topics: courseTopicIds(c.id).filter(isTopicId).map((t) => usEnglish(pathSkillName(t))),
  }));
  return [
    ...grades,
    { kind: "courses", id: HIGH_SCHOOL_TAB, chip: PRACTICE_COPY.highSchoolChip, title: PRACTICE_COPY.highSchoolTitle, courses },
  ];
}
