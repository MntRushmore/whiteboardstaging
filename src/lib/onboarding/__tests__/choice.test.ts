/**
 * The welcome's second step and the account page's Grade section pick one of these: a grade or a
 * course, saved the way save_onboarding v2 expects (a grade is "other" plus the grade).
 */
import { describe, expect, it } from "vitest";
import { GRADE_IDS } from "@/lib/learning/grades";
import { COURSE_IDS } from "../courseIds";
import {
  accountChoices,
  choiceKey,
  choiceLabel,
  choiceOf,
  choiceSave,
  gradeTile,
  HIGH_SCHOOL_COURSES,
  parseChoiceKey,
  SOMETHING_ELSE,
  type WelcomeChoice,
} from "../choice";

const EVERY: WelcomeChoice[] = [
  ...GRADE_IDS.map((grade) => ({ kind: "grade" as const, grade })),
  ...COURSE_IDS.map((course) => ({ kind: "course" as const, course })),
];

describe("a choice as a card's value", () => {
  it("round-trips every grade and every course", () => {
    for (const c of EVERY) expect(parseChoiceKey(choiceKey(c))).toEqual(c);
    expect(choiceKey({ kind: "grade", grade: 0 })).toBe("grade:0");
    expect(choiceKey({ kind: "course", course: "algebra1" })).toBe("course:algebra1");
    expect(choiceKey(null)).toBeNull();
  });

  it("reads anything else as no choice, never a throw", () => {
    for (const v of ["", "grade:9", "grade:-1", "grade:1.5", "grade:", "grade:03", "course:calculus", "algebra1", "3", null, undefined]) {
      expect(parseChoiceKey(v), String(v)).toBeNull();
    }
  });
});

describe("saving a choice (save_onboarding v2)", () => {
  it("saves a grade as the course 'other' plus the grade, Kindergarten included", () => {
    expect(choiceSave({ kind: "grade", grade: 3 })).toEqual({ course: "other", grade: 3 });
    expect(choiceSave({ kind: "grade", grade: 0 })).toEqual({ course: "other", grade: 0 });
  });

  it("saves a course with no grade, and nothing for no choice", () => {
    expect(choiceSave({ kind: "course", course: "geometry" })).toEqual({ course: "geometry", grade: null });
    expect(choiceSave({ kind: "course", course: "other" })).toEqual({ course: "other", grade: null });
    expect(choiceSave(null)).toEqual({ course: null, grade: null });
  });

  it("reads back what it saved", () => {
    for (const c of EVERY) expect(choiceOf(choiceSave(c))).toEqual(c);
    expect(choiceOf({ course: null, grade: null })).toBeNull();
    expect(choiceOf(null)).toBeNull();
    // a grade outranks the course it is stored with
    expect(choiceOf({ course: "algebra1", grade: 7 })).toEqual({ kind: "grade", grade: 7 });
  });
});

describe("the words", () => {
  it("names each choice as the student reads it", () => {
    expect(choiceLabel({ kind: "grade", grade: 0 })).toBe("Kindergarten");
    expect(choiceLabel({ kind: "grade", grade: 3 })).toBe("3rd grade");
    expect(choiceLabel({ kind: "course", course: "algebra1" })).toBe("Algebra 1");
    expect(choiceLabel({ kind: "course", course: "other" })).toBe("Something else");
    expect(choiceLabel(null)).toBeNull();
  });

  it("puts a big short name on each grade's card, and a small word under it", () => {
    expect(gradeTile(0)).toEqual({ big: "K", small: "Kindergarten" });
    expect(gradeTile(1)).toEqual({ big: "1st", small: "grade" });
    expect(gradeTile(8)).toEqual({ big: "8th", small: "grade" });
    for (const g of GRADE_IDS) expect(gradeTile(g).big.length).toBeLessThanOrEqual(3);
  });

  it("lists the high-school courses after the grades, and 'Something else' last", () => {
    expect(HIGH_SCHOOL_COURSES.map((c) => c.id)).toEqual(["algebra1", "geometry", "algebra2", "precalc_calc"]);
    expect(SOMETHING_ELSE.id).toBe("other");
  });
});

describe("the account page's picker", () => {
  it("offers every grade, then the high-school courses, then 'Something else'", () => {
    const options = accountChoices(null);
    expect(options.map((o) => o.value)).toEqual([...GRADE_IDS.map((g) => `grade:${g}`), "course:algebra1", "course:geometry", "course:algebra2", "course:precalc_calc", "course:other"]);
    expect(options[0].label).toBe("Kindergarten");
    for (const o of options) expect(parseChoiceKey(o.value)).not.toBeNull();
  });

  it("leaves out 'Something else' while there is a grade (saving it would keep the grade)", () => {
    expect(accountChoices({ kind: "grade", grade: 2 }).map((o) => o.value)).not.toContain("course:other");
    expect(accountChoices({ kind: "course", course: "geometry" }).map((o) => o.value)).toContain("course:other");
    expect(accountChoices({ kind: "course", course: "other" }).map((o) => o.value)).toContain("course:other");
  });
});
