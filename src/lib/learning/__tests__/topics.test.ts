import { describe, expect, it } from "vitest";
import { CHAT_LIMITS } from "@/lib/live/chat/contracts";
import { ASK_KICKOFF_MAX } from "@/lib/boards/askKickoff";
import { COARSE_SKILL_IDS, SKILLS, type MasteryLevel } from "../contracts";
import { GRADE_IDS, gradePath, K8_SKILL_IDS, K8_SKILLS } from "../grades";
import { hasPractice } from "../practiceSet";
import { AREA_LABELS, LEVEL_LABELS } from "../progressView";
import {
  courseName,
  courseTopicIds,
  familyTopic,
  isTopicId,
  keepMathsTogether,
  levelsOf,
  matchTopic,
  normalizeWords,
  NOT_TOPICS,
  TOPIC_FAMILIES,
  TOPIC_IDS,
  TOPIC_INFO,
  TOPIC_TITLE_MAX,
  topicBoardTitle,
  topicGroups,
  topicView,
  upNext,
} from "../topics";

const levels = (entries: Record<string, MasteryLevel> = {}) => new Map(Object.entries(entries)) as Map<string, MasteryLevel>;
const mastered = (ids: readonly string[]) => levels(Object.fromEntries(ids.map((id) => [id, "mastered" as MasteryLevel])));

describe("which skills are topics", () => {
  it("exactly the skills with practice problems, in teaching order, but the coarse ones the K–8 topics replace", () => {
    const coarse: readonly string[] = COARSE_SKILL_IDS;
    expect(TOPIC_IDS).toEqual(SKILLS.map((s) => s.id).filter((id) => hasPractice(id) && !coarse.includes(id)));
    for (const id of NOT_TOPICS) expect(hasPractice(id), id).toBe(false);
    // a coarse skill keeps its practice problems (an old weak spot), but is not a topic
    for (const id of COARSE_SKILL_IDS) {
      expect(hasPractice(id), id).toBe(true);
      expect(isTopicId(id), id).toBe(false);
    }
    for (const id of K8_SKILL_IDS) expect(isTopicId(id), id).toBe(true);
    expect(isTopicId("add_fractions_unlike")).toBe(true);
    for (const v of ["other", "proofs", "fractions", "nope", "", null, 3]) expect(isTopicId(v)).toBe(false);
  });

  it("every topic has a short line and words a student types for it", () => {
    for (const id of TOPIC_IDS) {
      const info = TOPIC_INFO[id];
      expect(info.blurb.length, id).toBeGreaterThan(8);
      expect(info.blurb.length, id).toBeLessThanOrEqual(44);
      expect(info.aliases.length, id).toBeGreaterThan(0);
      for (const a of info.aliases) expect(normalizeWords(a), `${id}: ${a}`).toBe(a);
    }
  });

  it("a K–8 topic's name and line are the path's own (one source: K8_SKILLS)", () => {
    for (const id of K8_SKILL_IDS) {
      expect(TOPIC_INFO[id].blurb, id).toBe(K8_SKILLS[id].blurb);
      expect(topicView(id, levels()), id).toMatchObject({ name: K8_SKILLS[id].name, blurb: keepMathsTogether(K8_SKILLS[id].blurb), area: "arithmetic", level: "new" });
    }
  });

  it("the kickoff's length is the chat's", () => {
    expect(ASK_KICKOFF_MAX).toBe(CHAT_LIMITS.message);
  });
});

describe("a course's topics", () => {
  it("Algebra 1: its skills in SKILLS order (the arithmetic it lists first)", () => {
    const ids = courseTopicIds("algebra1");
    expect(ids.slice(0, 4)).toEqual(["negative_numbers", "order_of_operations", "add_fractions_unlike", "powers_roots"]);
    expect(ids).toContain("two_step_equations");
    expect(ids).not.toContain("add_within_20");
    expect(ids).not.toContain("word_problems");
  });

  it("course other and an unknown course, with no grade: every arithmetic topic, numbers first", () => {
    const young = TOPIC_IDS.filter((id) => SKILLS.find((s) => s.id === id)?.area === "arithmetic");
    expect(young.slice(0, 3)).toEqual(["add_within_10", "subtract_within_10", "add_within_20"]);
    expect(young).toContain("negative_numbers");
    expect(young).toContain("proportions");
    for (const id of COARSE_SKILL_IDS) expect(young).not.toContain(id);
    expect(courseTopicIds("other")).toEqual(young);
    expect(courseTopicIds(null)).toEqual(young);
    expect(courseTopicIds(undefined)).toEqual(young);
  });

  it("names the course, or none for other", () => {
    expect(courseName("algebra1")).toBe("Algebra 1");
    expect(courseName("precalc_calc")).toBe("Pre-calculus / Calculus");
    expect(courseName("other")).toBeNull();
    expect(courseName(null)).toBeNull();
  });
});

describe("a grade's topics", () => {
  it("the grade's path, in its order, over any course", () => {
    expect(courseTopicIds(null, 0)).toEqual(["add_within_10", "subtract_within_10"]);
    expect(courseTopicIds("other", 3)).toEqual(["add_subtract_within_1000", "times_tables", "division_facts", "multiply_by_tens"]);
    expect(courseTopicIds("algebra1", 6)).toEqual(gradePath(6));
    for (const g of GRADE_IDS) expect(courseTopicIds(null, g), String(g)).toEqual(gradePath(g));
    // not a grade: the course decides
    expect(courseTopicIds("algebra1", null)).toEqual(courseTopicIds("algebra1"));
    expect(courseTopicIds("algebra1", 9 as never)).toEqual(courseTopicIds("algebra1"));
  });

  it("Up next walks the grade's path, then the next grade's", () => {
    expect(upNext(null, levels(), [], 0).next?.id).toBe("add_within_10");
    expect(upNext(null, levels(), [], 3).next).toMatchObject({ id: "add_subtract_within_1000", name: "3-digit adding and subtracting", level: "new" });
    expect(upNext("other", mastered(["add_subtract_within_1000"]), [], 3).next?.id).toBe("times_tables");
    // the whole grade mastered: on to 4th grade, never back to Adding to 10
    expect(upNext(null, mastered(gradePath(3)), [], 3).next?.id).toBe("multi_digit_add_subtract");
    expect(upNext(null, mastered([...gradePath(7), ...gradePath(8)]), [], 7).next?.id).toBe("add_within_10");
  });

  it("the weakest spot is offered beside the path, as for a course", () => {
    const l = levels({ times_tables: "practicing", add_within_20: "practicing" });
    expect(upNext(null, l, ["times_tables", "add_within_20"], 3)).toMatchObject({ next: { id: "add_subtract_within_1000" }, weakest: { id: "times_tables" } });
    // an old weak spot under a coarse skill is not a topic: passed over
    expect(upNext(null, l, ["add_subtract", "add_within_20"], 3).weakest?.id).toBe("add_within_20");
  });

  it("the topic list: the grade's path first, by area; everything else under Other topics", () => {
    const { mine, others } = topicGroups(null, levels({ percents: "almost" }), 6);
    expect(mine.map((g) => g.area)).toEqual(["arithmetic", "algebra"]);
    expect(mine[0].topics.map((t) => t.id)).toEqual(["divide_fractions", "percents", "negative_numbers", "powers_roots"]);
    expect(mine[0].topics.find((t) => t.id === "percents")?.level).toBe("almost");
    expect(mine[1].topics.map((t) => t.id)).toEqual(["one_step_equations", "simplify_expressions"]);
    expect(others[0].topics.map((t) => t.id)).toContain("add_within_10");
    for (const g of GRADE_IDS) {
      const groups = topicGroups(null, levels(), g);
      const ids = [...groups.mine, ...groups.others].flatMap((x) => x.topics.map((t) => t.id));
      expect([...ids].sort(), String(g)).toEqual([...TOPIC_IDS].sort());
    }
  });
});

describe("Up next", () => {
  it("a new student: the first topic of their course, no weakest spot", () => {
    expect(upNext("algebra1", levels()).next?.id).toBe("negative_numbers");
    expect(upNext("geometry", levels()).next?.id).toBe("angles");
    expect(upNext("algebra2", levels()).next?.id).toBe("multi_step_equations");
    expect(upNext("precalc_calc", levels()).next?.id).toBe("functions");
    expect(upNext("other", levels()).next?.id).toBe("add_within_10");
    expect(upNext(null, levels()).weakest).toBeNull();
  });

  it("skips what is mastered, keeps what is being learned", () => {
    const l = levels({ negative_numbers: "mastered", order_of_operations: "almost" });
    expect(upNext("algebra1", l).next).toMatchObject({ id: "order_of_operations", level: "almost", levelLabel: LEVEL_LABELS.almost });
    expect(upNext("algebra1", levels({ negative_numbers: "mastered", order_of_operations: "mastered" })).next?.id).toBe("add_fractions_unlike");
  });

  it("the weakest spot: the first weak skill that is a topic and not Up next", () => {
    const l = levels({ negative_numbers: "practicing", add_fractions_unlike: "practicing" });
    expect(upNext("algebra1", l, ["negative_numbers", "add_fractions_unlike"]).weakest?.id).toBe("add_fractions_unlike");
    // a weak skill with no topic (word problems) is passed over
    expect(upNext("algebra1", l, ["word_problems", "negative_numbers", "add_fractions_unlike"]).weakest?.id).toBe("add_fractions_unlike");
    // a weak skill outside the course is still offered
    expect(upNext("algebra1", levels({ derivatives: "practicing" }), ["derivatives"]).weakest?.id).toBe("derivatives");
    expect(upNext("algebra1", l, ["negative_numbers"]).weakest).toBeNull();
  });

  it("the whole course mastered: the next topic not mastered of the rest", () => {
    expect(upNext("other", mastered(courseTopicIds("other"))).next?.id).toBe("simplify_expressions");
    expect(upNext("other", mastered(TOPIC_IDS))).toEqual({ next: null, weakest: null });
    expect(upNext(null, mastered(TOPIC_IDS), [], 4)).toEqual({ next: null, weakest: null });
  });

  it("levels come from the summary's skills; anything else is New", () => {
    const l = levelsOf([
      { skill: "fractions", level: "almost" },
      { skill: "angles", level: "mastered" },
    ]);
    expect(l.get("fractions")).toBe("almost");
    expect(upNext("geometry", l).next).toMatchObject({ id: "triangles", level: "new", name: "Triangles", area: "geometry" });
  });
});

describe("the topic list", () => {
  it("a 4th grader with no grade set (course other): Numbers first, everything else under Other topics", () => {
    const { mine, others } = topicGroups("other", levels());
    expect(mine.map((g) => g.area)).toEqual(["arithmetic"]);
    expect(mine[0].label).toBe(AREA_LABELS.arithmetic);
    expect(mine[0].topics.map((t) => t.id)).toEqual(courseTopicIds("other"));
    expect(others.map((g) => g.area)).toEqual(["algebra", "functions", "geometry", "trig", "calculus", "science"]);
  });

  it("an Algebra 1 student can still pick Adding to 20, under Other topics", () => {
    const { mine, others } = topicGroups("algebra1", levels({ add_fractions_unlike: "practicing" }));
    expect(mine.map((g) => g.area)).toEqual(["arithmetic", "algebra", "functions"]);
    expect(mine.flatMap((g) => g.topics).find((t) => t.id === "add_fractions_unlike")?.level).toBe("practicing");
    expect(others[0].area).toBe("arithmetic");
    expect(others[0].topics.map((t) => t.id)).toContain("add_within_20");
    expect(others[0].topics.map((t) => t.id)).not.toContain("negative_numbers");
  });

  it("every topic is listed exactly once, each group in teaching order", () => {
    for (const course of ["algebra1", "geometry", "algebra2", "precalc_calc", "other", null] as const) {
      const { mine, others } = topicGroups(course, levels());
      const ids = [...mine, ...others].flatMap((g) => g.topics.map((t) => t.id));
      expect([...ids].sort(), String(course)).toEqual([...TOPIC_IDS].sort());
      for (const g of [...mine, ...others]) {
        const order = g.topics.map((t) => TOPIC_IDS.indexOf(t.id));
        expect(order, `${course} ${g.area}`).toEqual([...order].sort((a, b) => a - b));
      }
    }
  });
});

describe("the words box", () => {
  it("one topic named: that topic", () => {
    expect(matchTopic("test on quadratics Friday")).toBe("quadratic_equations");
    expect(matchTopic("Pythagoras")).toBe("pythagorean");
    expect(matchTopic("practice two-step equations")).toBe("two_step_equations");
    expect(matchTopic("SOH CAH TOA")).toBe("trig_values");
    expect(matchTopic("factorising")).toBe("factoring");
  });

  it("the K–8 topics by their own words", () => {
    expect(matchTopic("times tables")).toBe("times_tables");
    expect(matchTopic("my 7 times table")).toBeNull(); // typed maths: Ask reads it
    expect(matchTopic("Times Tables!")).toBe("times_tables");
    expect(matchTopic("long division")).toBe("long_division");
    expect(matchTopic("adding fractions")).toBe("add_fractions_like");
    expect(matchTopic("number bonds")).toBe("add_within_10");
    expect(matchTopic("equivalent fractions")).toBe("equivalent_fractions");
    expect(matchTopic("common denominators")).toBe("add_fractions_unlike");
    expect(matchTopic("dividing fractions")).toBe("divide_fractions");
    expect(matchTopic("percentages")).toBe("percents");
    expect(matchTopic("ratios")).toBe("proportions");
    expect(matchTopic("multiplying decimals")).toBe("decimals_multiply");
    expect(matchTopic("counting by tens")).toBe("add_tens");
    expect(matchTopic("multiplying by tens")).toBe("multiply_by_tens");
    expect(matchTopic("long multiplication")).toBe("multiply_multi_digit");
  });

  it("a kind of maths ('adding', 'fractions') names that kind's topic for the student's grade", () => {
    expect(matchTopic("adding", 0)).toBe("add_within_10");
    expect(matchTopic("adding", 1)).toBe("add_within_20");
    expect(matchTopic("addition", 2)).toBe("add_within_100");
    expect(matchTopic("adding", 3)).toBe("add_subtract_within_1000");
    expect(matchTopic("adding", 6)).toBe("multi_digit_add_subtract");
    expect(matchTopic("take away", 0)).toBe("subtract_within_10");
    expect(matchTopic("subtraction", 2)).toBe("subtract_within_100");
    expect(matchTopic("times", 3)).toBe("times_tables");
    expect(matchTopic("multiplication", 5)).toBe("multiply_multi_digit");
    expect(matchTopic("division", 3)).toBe("division_facts");
    expect(matchTopic("division", 4)).toBe("long_division");
    expect(matchTopic("fractions", 2)).toBe("equivalent_fractions");
    expect(matchTopic("fractions", 4)).toBe("equivalent_fractions");
    expect(matchTopic("fractions", 5)).toBe("add_fractions_unlike");
    expect(matchTopic("fractions", 6)).toBe("divide_fractions");
    expect(matchTopic("decimals", 5)).toBe("decimals_add_subtract");
    // no grade (a high-school student, or none chosen): the family's middle
    expect(matchTopic("fractions")).toBe("add_fractions_unlike");
    expect(matchTopic("Fractions!")).toBe("add_fractions_unlike");
    expect(matchTopic("adding")).toBe("add_within_100");
    expect(matchTopic("times")).toBe("times_tables");
    // a longer name still wins: "times tables" is times tables in any grade
    expect(matchTopic("times tables", 6)).toBe("times_tables");
    expect(matchTopic("adding fractions", 2)).toBe("add_fractions_like");
    for (const family of TOPIC_FAMILIES) {
      expect(family.topics, family.words[0]).toContain(family.noGrade);
      for (const g of GRADE_IDS) expect(family.topics, `${family.words[0]} ${g}`).toContain(familyTopic(family, g));
    }
  });

  it("a longer name wins over a word inside it", () => {
    expect(matchTopic("trig equations")).toBe("trig_equations");
    expect(matchTopic("area of a circle")).toBe("circles");
    expect(matchTopic("the power rule")).toBe("derivatives");
    expect(matchTopic("rational expressions")).toBe("rational_expressions");
  });

  it("no one topic, typed maths, a question, or too many words: Ask reads it", () => {
    expect(matchTopic("help with my homework on area of triangles")).toBeNull();
    expect(matchTopic("area of triangles")).toBeNull();
    expect(matchTopic("how do I add fractions")).toBeNull();
    expect(matchTopic("solve 2x + 3 = 11")).toBeNull();
    expect(matchTopic("x^2 - 5x + 6")).toBeNull();
    expect(matchTopic("I have a big test next week and want to review fractions")).toBeNull();
    expect(matchTopic("adding and times tables")).toBeNull();
    expect(matchTopic("dinosaurs")).toBeNull();
    expect(matchTopic("")).toBeNull();
    expect(matchTopic("   ")).toBeNull();
  });

  it("names a board after the words: tidied, a capital first, cut at a word", () => {
    expect(topicBoardTitle("  test on   quadratics Friday ")).toBe("Test on quadratics Friday");
    expect(topicBoardTitle("")).toBe("");
    const long = topicBoardTitle("help with my homework on the area of triangles and also some circles please thank you");
    expect(long.length).toBeLessThanOrEqual(TOPIC_TITLE_MAX);
    expect(long.endsWith("…")).toBe(true);
    expect(long).toBe("Help with my homework on the area of triangles and also…");
  });
});
