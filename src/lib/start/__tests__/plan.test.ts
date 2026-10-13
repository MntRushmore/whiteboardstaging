import { describe, expect, it } from "vitest";
import { SKILLS } from "@/lib/learning/contracts";
import { GRADE_IDS, GRADE_PATHS, isK8SkillId, K8_SKILLS } from "@/lib/learning/grades";
import { TOPIC_IDS, TOPIC_INFO, type TopicId } from "@/lib/learning/topics";
import { COURSE_IDS } from "@/lib/onboarding/courseIds";
import { EMPTY_ANSWERS, type StartAnswers } from "../contracts";
import { buildPlan, COURSE_FOCUS, focusOptions, PLAN_SKILLS, planSkills, skillWords } from "../plan";

const SAM: StartAnswers = { ...EMPTY_ANSWERS, role: "parent", name: "Sam", choice: { kind: "grade", grade: 3 }, focus: ["division_facts", "times_tables"] };

describe("what a family can pick on focus", () => {
  it("a grade: its path, in teaching order", () => {
    for (const grade of GRADE_IDS) expect(focusOptions({ kind: "grade", grade })).toEqual([...GRADE_PATHS[grade]]);
  });

  it("a high-school course: six of its own topics, each one with practice problems", () => {
    for (const course of COURSE_IDS.filter((c) => c !== "other")) {
      const options = focusOptions({ kind: "course", course });
      expect(options, course).toHaveLength(6);
      for (const id of options) {
        expect(TOPIC_IDS, `${course}: ${id}`).toContain(id);
        expect(SKILLS.find((s) => s.id === id)?.courses, `${course}: ${id}`).toContain(course);
      }
    }
  });

  it("'Something else' and no answer: nothing (the screen is skipped)", () => {
    expect(focusOptions({ kind: "course", course: "other" })).toEqual([]);
    expect(focusOptions(null)).toEqual([]);
    expect(COURSE_FOCUS.other).toEqual([]);
  });
});

describe("the plan's skills", () => {
  it("the ones picked, in the path's teaching order (not the order tapped), then the rest of the path, each once", () => {
    expect(planSkills(SAM)).toEqual(["times_tables", "division_facts", "add_subtract_within_1000", "multiply_by_tens"]);
    expect(planSkills({ ...SAM, choice: { kind: "grade", grade: 1 }, focus: ["subtract_within_20", "add_within_20"] }).slice(0, 2)).toEqual(["add_within_20", "subtract_within_20"]);
    expect(planSkills({ ...SAM, focus: [] })).toEqual([...GRADE_PATHS[3]]);
    expect(planSkills({ ...SAM, focus: ["times_tables"], choice: { kind: "course", course: "geometry" } })[0]).toBe("times_tables");
  });

  it("the plan screen: the first three, which were picked, and the level", () => {
    const plan = buildPlan(SAM);
    expect(plan.level).toBe("3rd grade");
    expect(plan.open).toBe(false);
    expect(plan.skills).toHaveLength(PLAN_SKILLS);
    expect(plan.skills.map((s) => [s.id, s.picked])).toEqual([
      ["times_tables", true],
      ["division_facts", true],
      ["add_subtract_within_1000", false],
    ]);
    expect(plan.skills[0]).toMatchObject({ name: "Times tables", blurb: K8_SKILLS.times_tables.blurb });
    expect(buildPlan({ ...SAM, choice: { kind: "course", course: "algebra1" }, focus: [] }).level).toBe("Algebra 1");
  });

  it("'Something else': an open plan, no list of skills", () => {
    expect(buildPlan({ ...SAM, choice: { kind: "course", course: "other" }, focus: [] })).toEqual({ level: "Something else", skills: [], open: true });
    expect(buildPlan({ ...SAM, choice: null, focus: [] })).toEqual({ level: null, skills: [], open: true });
  });
});

describe("the words for a skill", () => {
  it("every skill /start can show has a name and a line, the topic list's own", () => {
    const all = new Set([...GRADE_IDS.flatMap((grade) => focusOptions({ kind: "grade", grade })), ...COURSE_IDS.flatMap((course) => focusOptions({ kind: "course", course }))]);
    for (const id of all) {
      const words = skillWords(id);
      expect(words.name, id).toBe(SKILLS.find((s) => s.id === id)?.name);
      expect(words.blurb, id).not.toBe("");
      // the copy here is the topic list's, word for word
      if (!isK8SkillId(id)) expect(words.blurb, id).toBe(TOPIC_INFO[id as TopicId].blurb);
    }
  });
});
