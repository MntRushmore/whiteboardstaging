import { describe, expect, it } from "vitest";
import { CHAT_LIMITS } from "@/lib/live/chat/contracts";
import { ASK_KICKOFF_MAX } from "@/lib/boards/askKickoff";
import { SKILLS, type MasteryLevel } from "../contracts";
import { hasPractice } from "../practiceSet";
import { AREA_LABELS, LEVEL_LABELS } from "../progressView";
import { courseName, courseTopicIds, isTopicId, levelsOf, matchTopic, normalizeWords, NOT_TOPICS, TOPIC_IDS, TOPIC_INFO, TOPIC_TITLE_MAX, topicBoardTitle, topicGroups, upNext } from "../topics";

const levels = (entries: Record<string, MasteryLevel> = {}) => new Map(Object.entries(entries)) as Map<string, MasteryLevel>;

describe("which skills are topics", () => {
  it("exactly the skills with practice problems, in teaching order", () => {
    expect(TOPIC_IDS).toEqual(SKILLS.map((s) => s.id).filter(hasPractice));
    for (const id of NOT_TOPICS) expect(hasPractice(id), id).toBe(false);
    expect(isTopicId("fractions")).toBe(true);
    for (const v of ["other", "proofs", "nope", "", null, 3]) expect(isTopicId(v)).toBe(false);
  });

  it("every topic has a short line and words a student types for it", () => {
    for (const id of TOPIC_IDS) {
      const info = TOPIC_INFO[id];
      expect(info.blurb.length, id).toBeGreaterThan(8);
      expect(info.blurb.length, id).toBeLessThanOrEqual(40);
      expect(info.aliases.length, id).toBeGreaterThan(0);
      for (const a of info.aliases) expect(normalizeWords(a), `${id}: ${a}`).toBe(a);
    }
  });

  it("the kickoff's length is the chat's", () => {
    expect(ASK_KICKOFF_MAX).toBe(CHAT_LIMITS.message);
  });
});

describe("a course's topics", () => {
  it("Algebra 1: its skills in SKILLS order (the arithmetic it lists first)", () => {
    const ids = courseTopicIds("algebra1");
    expect(ids.slice(0, 4)).toEqual(["negative_numbers", "order_of_operations", "fractions", "powers_roots"]);
    expect(ids).toContain("two_step_equations");
    expect(ids).not.toContain("add_subtract");
    expect(ids).not.toContain("word_problems");
  });

  it("course other and an unknown course: every arithmetic topic, numbers first", () => {
    const young = ["add_subtract", "multiply_divide", "negative_numbers", "order_of_operations", "fractions", "decimals_percents", "powers_roots"];
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

describe("Up next", () => {
  it("a new student: the first topic of their course, no weakest spot", () => {
    expect(upNext("algebra1", levels()).next?.id).toBe("negative_numbers");
    expect(upNext("geometry", levels()).next?.id).toBe("angles");
    expect(upNext("algebra2", levels()).next?.id).toBe("multi_step_equations");
    expect(upNext("precalc_calc", levels()).next?.id).toBe("functions");
    expect(upNext("other", levels()).next?.id).toBe("add_subtract");
    expect(upNext(null, levels()).weakest).toBeNull();
  });

  it("skips what is mastered, keeps what is being learned", () => {
    const l = levels({ negative_numbers: "mastered", order_of_operations: "almost" });
    expect(upNext("algebra1", l).next).toMatchObject({ id: "order_of_operations", level: "almost", levelLabel: LEVEL_LABELS.almost });
    expect(upNext("algebra1", levels({ negative_numbers: "mastered", order_of_operations: "mastered" })).next?.id).toBe("fractions");
  });

  it("the weakest spot: the first weak skill that is a topic and not Up next", () => {
    const l = levels({ negative_numbers: "practicing", fractions: "practicing" });
    expect(upNext("algebra1", l, ["negative_numbers", "fractions"]).weakest?.id).toBe("fractions");
    // a weak skill with no topic (word problems) is passed over
    expect(upNext("algebra1", l, ["word_problems", "negative_numbers", "fractions"]).weakest?.id).toBe("fractions");
    // a weak skill outside the course is still offered
    expect(upNext("algebra1", levels({ derivatives: "practicing" }), ["derivatives"]).weakest?.id).toBe("derivatives");
    expect(upNext("algebra1", l, ["negative_numbers"]).weakest).toBeNull();
  });

  it("the whole course mastered: the next topic not mastered of the rest", () => {
    const all = Object.fromEntries(courseTopicIds("other").map((id) => [id, "mastered" as MasteryLevel]));
    expect(upNext("other", levels(all)).next?.id).toBe("simplify_expressions");
    const everything = Object.fromEntries(TOPIC_IDS.map((id) => [id, "mastered" as MasteryLevel]));
    expect(upNext("other", levels(everything))).toEqual({ next: null, weakest: null });
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
  it("a 4th grader (course other): Numbers first, everything else under Other topics", () => {
    const { mine, others } = topicGroups("other", levels());
    expect(mine.map((g) => g.area)).toEqual(["arithmetic"]);
    expect(mine[0].label).toBe(AREA_LABELS.arithmetic);
    expect(mine[0].topics.map((t) => t.id)).toEqual(courseTopicIds("other"));
    expect(others.map((g) => g.area)).toEqual(["algebra", "functions", "geometry", "trig", "calculus", "science"]);
  });

  it("an Algebra 1 student can still pick Adding and subtracting, under Other topics", () => {
    const { mine, others } = topicGroups("algebra1", levels({ fractions: "practicing" }));
    expect(mine.map((g) => g.area)).toEqual(["arithmetic", "algebra", "functions"]);
    expect(mine.flatMap((g) => g.topics).find((t) => t.id === "fractions")?.level).toBe("practicing");
    expect(others[0].area).toBe("arithmetic");
    expect(others[0].topics.map((t) => t.id)).toEqual(["add_subtract", "multiply_divide", "decimals_percents"]);
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
    expect(matchTopic("fractions")).toBe("fractions");
    expect(matchTopic("Fractions!")).toBe("fractions");
    expect(matchTopic("test on quadratics Friday")).toBe("quadratic_equations");
    expect(matchTopic("times tables")).toBe("multiply_divide");
    expect(matchTopic("Pythagoras")).toBe("pythagorean");
    expect(matchTopic("practice two-step equations")).toBe("two_step_equations");
    expect(matchTopic("SOH CAH TOA")).toBe("trig_values");
    expect(matchTopic("factorising")).toBe("factoring");
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
