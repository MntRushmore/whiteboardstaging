/**
 * What a student picks in the welcome's second step, and later in the account page's Grade
 * section: a grade (Kindergarten to 8th) or a course (a high-school one, or "Something else").
 * Prod showed who practises — young students adding, times tables, fractions — so the grade comes
 * first and the courses follow it.
 *
 * One string per card (`choiceKey`), so each picker is a plain radio group or select, and one rule
 * for saving (`choiceSave`, save_onboarding v2): a grade is the course "other" plus the grade, and
 * a course is the course alone, which clears any grade.
 *
 * Pure: no React, no network. Loaded only by the welcome and the account page.
 */
import { GRADES, gradeLabel, isGrade, type Grade } from "@/lib/learning/grades";
import { isCourseId, type CourseId } from "./courseIds";
import { COURSES, type Course } from "./courses";

export type WelcomeChoice = { kind: "grade"; grade: Grade } | { kind: "course"; course: CourseId };

/** `grade:3`, `course:geometry`: a card's value in a picker. */
export function choiceKey(choice: WelcomeChoice | null): string | null {
  if (!choice) return null;
  return choice.kind === "grade" ? `grade:${choice.grade}` : `course:${choice.course}`;
}

/** The choice a card's value stands for; null for anything else (never throws). */
export function parseChoiceKey(key: string | null | undefined): WelcomeChoice | null {
  const m = /^(grade|course):(.+)$/.exec(key ?? "");
  if (!m) return null;
  if (m[1] === "grade") {
    const grade = /^\d$/.test(m[2]) ? Number(m[2]) : NaN;
    return isGrade(grade) ? { kind: "grade", grade } : null;
  }
  return isCourseId(m[2]) ? { kind: "course", course: m[2] } : null;
}

/**
 * What save_onboarding stores for a choice: a grade is the course "other" with the grade; a course
 * has no grade (the RPC clears one when a high-school course comes without it). No choice: neither.
 */
export function choiceSave(choice: WelcomeChoice | null): { course: CourseId | null; grade: Grade | null } {
  if (!choice) return { course: null, grade: null };
  return choice.kind === "grade" ? { course: "other", grade: choice.grade } : { course: choice.course, grade: null };
}

/** The choice a profile holds: its grade when it has one, else its course; null when it has neither. */
export function choiceOf(profile: { course: CourseId | null; grade: Grade | null } | null | undefined): WelcomeChoice | null {
  if (!profile) return null;
  if (isGrade(profile.grade)) return { kind: "grade", grade: profile.grade };
  return isCourseId(profile.course) ? { kind: "course", course: profile.course } : null;
}

/** "3rd grade", "Kindergarten", "Algebra 1", "Something else"; null for no choice. */
export function choiceLabel(choice: WelcomeChoice | null): string | null {
  if (!choice) return null;
  if (choice.kind === "grade") return gradeLabel(choice.grade);
  return COURSES.find((c) => c.id === choice.course)?.label ?? null;
}

/** The high-school courses, after the grades in the welcome. */
export const HIGH_SCHOOL_COURSES: readonly Course[] = COURSES.filter((c) => c.id !== "other");
/** "Something else": the last card, for anyone neither list fits. */
export const SOMETHING_ELSE: Course = COURSES.find((c) => c.id === "other") ?? { id: "other", label: "Something else", blurb: "" };

/**
 * A grade's card in the welcome, big enough for a five-year-old's finger: the short name large
 * ("K", "3rd") and a small word under it ("Kindergarten", "grade"), so it reads "3rd grade".
 */
export function gradeTile(grade: Grade): { big: string; small: string } {
  const def = GRADES.find((g) => g.id === grade);
  return { big: def?.short ?? String(grade), small: grade === 0 ? "Kindergarten" : "grade" };
}

/**
 * The account page's picker: every grade, then the high-school courses, then "Something else" —
 * which is left out while the student has a grade. save_onboarding keeps a grade that "other"
 * comes without (that is how a grade is saved), so picking it there would change nothing.
 */
export function accountChoices(current: WelcomeChoice | null): { value: string; label: string }[] {
  const grades = GRADES.map((g) => ({ value: `grade:${g.id}`, label: g.label }));
  const courses = HIGH_SCHOOL_COURSES.map((c) => ({ value: `course:${c.id}`, label: c.label }));
  const other = current?.kind === "grade" ? [] : [{ value: `course:${SOMETHING_ELSE.id}`, label: SOMETHING_ELSE.label }];
  return [...grades, ...courses, ...other];
}

/** The words of the account page's Grade section (`GradeSection`), for a grown-up or an older student. */
export const GRADE_SECTION_COPY = {
  title: "Grade",
  description: "Your tutor picks problems for this grade. Change it any time.",
  label: "Grade or course",
  placeholder: "Pick a grade",
  saving: "Saving…",
  saved: (label: string) => `Saved: ${label}.`,
  loadFailedTitle: "Couldn't load your grade",
  loadFallback: "Your grade didn't load. Retry in a moment.",
  saveFailedTitle: "Couldn't save your grade",
  saveFallback: "Your grade wasn't saved. Retry in a moment.",
} as const;
