import { describe, expect, it } from "vitest";
import type { MasteryLevel } from "@/lib/learning/contracts";
import { GRADE_IDS, GRADE_PATHS, K8_SKILL_IDS, K8_SKILLS } from "@/lib/learning/grades";
import { LEVEL_LABELS } from "@/lib/learning/progressView";
import { courseTopicIds, isTopicId } from "@/lib/learning/topics";
import { buildPathView, LEVEL_STARS, linkWalked, PATH_COPY, pathFor, pathIcon, pathSkillBlurb, pathSkillName, pathSourceFor } from "../pathView";

const levels = (entries: Record<string, MasteryLevel> = {}) => new Map(Object.entries(entries)) as Map<string, MasteryLevel>;

describe("whose path", () => {
  it("a grade wins, then a high-school course, else Pick your grade", () => {
    expect(pathSourceFor({ grade: 3, course: "other" })).toEqual({ kind: "grade", grade: 3 });
    expect(pathSourceFor({ grade: 0, course: null })).toEqual({ kind: "grade", grade: 0 });
    expect(pathSourceFor({ grade: 5, course: "algebra1" })).toEqual({ kind: "grade", grade: 5 });
    expect(pathSourceFor({ grade: null, course: "algebra1" })).toEqual({ kind: "course", course: "algebra1" });
    expect(pathSourceFor({ grade: null, course: "precalc_calc" })).toEqual({ kind: "course", course: "precalc_calc" });
    expect(pathSourceFor({ grade: null, course: "other" })).toEqual({ kind: "pick" });
    expect(pathSourceFor({ grade: null, course: null })).toEqual({ kind: "pick" });
    expect(pathSourceFor({})).toEqual({ kind: "pick" });
  });

  it("a grade that is not one (9, 2.5, -1) is no grade", () => {
    for (const grade of [9, 2.5, -1, Number.NaN]) expect(pathSourceFor({ grade, course: "other" }).kind, String(grade)).toBe("pick");
  });
});

describe("a grade's path", () => {
  it("a brand-new 3rd grader: four stops in teaching order, the first is next, the rest still to come", () => {
    const view = buildPathView({ kind: "grade", grade: 3 }, levels());
    expect(view.nodes.map((n) => n.id)).toEqual([...GRADE_PATHS[3]]);
    expect(view.nodes.map((n) => n.state)).toEqual(["current", "upcoming", "upcoming", "upcoming"]);
    expect(view.nodes.map((n) => n.stars)).toEqual([0, 0, 0, 0]);
    expect(view.nodes.map((n) => n.step)).toEqual([1, 2, 3, 4]);
    expect(view.currentIndex).toBe(0);
    expect(view.mastered).toBe(0);
    expect(view.total).toBe(4);
    expect(view.allDone).toBe(false);
    expect(view.label).toBe("3rd grade");
    expect(view.chip).toBe("3rd");
    expect(view.homeTitle).toBe("Your 3rd grade path");
    expect(view.homeCount).toBe("0 of 4 done");
    expect(view.progressTitle).toBe("3rd grade path: 0 of 4 skills mastered");
  });

  it("two mastered: the next is the first not mastered, and the count says so", () => {
    const view = buildPathView({ kind: "grade", grade: 3 }, levels({ add_subtract_within_1000: "mastered", times_tables: "mastered", division_facts: "practicing" }));
    expect(view.nodes.map((n) => n.state)).toEqual(["done", "done", "current", "upcoming"]);
    expect(view.nodes.map((n) => n.stars)).toEqual([3, 3, 1, 0]);
    expect(view.currentIndex).toBe(2);
    expect(view.mastered).toBe(2);
    expect(view.progressTitle).toBe("3rd grade path: 2 of 4 skills mastered");
    expect(view.homeCount).toBe("2 of 4 done");
  });

  it("a skill mastered further on is done where it is; the next is still the first not mastered", () => {
    const view = buildPathView({ kind: "grade", grade: 3 }, levels({ multiply_by_tens: "mastered", times_tables: "almost" }));
    expect(view.nodes.map((n) => n.state)).toEqual(["current", "upcoming", "upcoming", "done"]);
    expect(view.nodes.map((n) => n.stars)).toEqual([0, 2, 0, 3]);
    expect(view.mastered).toBe(1);
  });

  it("every skill mastered: no next, all done", () => {
    const all = Object.fromEntries(GRADE_PATHS[0].map((id) => [id, "mastered" as const]));
    const view = buildPathView({ kind: "grade", grade: 0 }, levels(all));
    expect(view.currentIndex).toBe(-1);
    expect(view.allDone).toBe(true);
    expect(view.nodes.every((n) => n.state === "done" && n.stars === 3)).toBe(true);
    expect(view.label).toBe("Kindergarten");
    expect(view.chip).toBe("K");
    expect(view.progressTitle).toBe("Kindergarten path: 2 of 2 skills mastered");
  });

  it("every grade has a path whose stops all have a name and a picture", () => {
    for (const grade of GRADE_IDS) {
      const view = buildPathView({ kind: "grade", grade }, levels());
      expect(view.total, String(grade)).toBeGreaterThan(0);
      for (const n of view.nodes) {
        expect(n.name, n.id).not.toBe(n.id);
        expect(n.name.length, n.id).toBeGreaterThan(2);
        expect(n.icon, n.id).toBeTruthy();
      }
    }
  });

  it("stars follow the level: none, one, two, three", () => {
    expect(LEVEL_STARS).toEqual({ new: 0, practicing: 1, almost: 2, mastered: 3 });
  });
});

describe("names, lines and pictures", () => {
  it("a K–8 skill takes its name and line from K8_SKILLS, whether or not SKILLS lists it yet", () => {
    for (const id of K8_SKILL_IDS) {
      expect(pathSkillName(id)).toBe(K8_SKILLS[id].name);
      expect(pathSkillBlurb(id)).toContain(K8_SKILLS[id].blurb.split(" ")[0]);
    }
  });

  it("any other skill takes its name from SKILLS and its line from the topic", () => {
    expect(pathSkillName("order_of_operations")).toBe("Order of operations");
    expect(pathSkillBlurb("order_of_operations")).toBe("Which step comes first (PEMDAS)");
    expect(pathSkillName("proofs")).toBe("Proofs");
    expect(pathSkillBlurb("proofs")).toBeNull();
  });

  it("a blurb's maths stays on one line", () => {
    expect(pathSkillBlurb("add_within_10")).toBe("Put two small numbers together, like 3 + 4");
  });

  it("arithmetic shows its sign; the rest shows its area", () => {
    expect(pathIcon("add_within_10")).toBe("add");
    expect(pathIcon("subtract_within_20")).toBe("subtract");
    expect(pathIcon("times_tables")).toBe("multiply");
    expect(pathIcon("long_division")).toBe("divide");
    expect(pathIcon("add_fractions_unlike")).toBe("fraction");
    expect(pathIcon("decimals_multiply")).toBe("decimal");
    expect(pathIcon("percents")).toBe("percent");
    expect(pathIcon("proportions")).toBe("ratio");
    expect(pathIcon("fractions")).toBe("fraction");
    expect(pathIcon("two_step_equations")).toBe("algebra");
    expect(pathIcon("pythagorean")).toBe("geometry");
    expect(pathIcon("linear_functions")).toBe("functions");
    expect(pathIcon("nope")).toBe("arithmetic");
  });
});

describe("tapping a stop", () => {
  it("a topic opens its board; a K–8 skill that is not a topic yet opens nothing (Coming soon)", () => {
    const view = buildPathView({ kind: "grade", grade: 6 }, levels());
    for (const n of view.nodes) expect(n.topic, n.id).toBe(isTopicId(n.id) ? n.id : null);
    const percents = view.nodes.find((n) => n.id === "percents")!;
    // once the catalog work makes it a topic, it opens like any other
    if (!isTopicId("percents")) {
      expect(percents.topic).toBeNull();
      expect(percents.label).toContain(PATH_COPY.comingSoonTitle);
    } else {
      expect(percents.topic).toBe("percents");
    }
    expect(view.nodes.find((n) => n.id === "negative_numbers")!.topic).toBe("negative_numbers");
  });
});

describe("what a screen reader says", () => {
  it("each stop: its name, where it is on the path, whether it is next, and its stars", () => {
    const view = buildPathView({ kind: "grade", grade: 7 }, levels({ proportions: "mastered", negative_numbers: "practicing", inequalities: "almost" }));
    const [first, second, , fourth, fifth] = view.nodes;
    expect(first.label).toMatch(/^Proportions, step 1 of 6\. Mastered, 3 of 3 stars\./);
    expect(second.label).toBe(`Negative numbers, step 2 of 6. Next up. ${LEVEL_LABELS.practicing}, 1 of 3 stars.`);
    expect(fourth.label).toBe(`Inequalities, step 4 of 6. ${LEVEL_LABELS.almost}, 2 of 3 stars.`);
    expect(fifth.label).toBe("Area and perimeter, step 5 of 6. Not started yet.");
  });
});

describe("a high-school course's path", () => {
  it("Algebra 1: the course's topics in teaching order, named from SKILLS, every one a topic", () => {
    const view = buildPathView({ kind: "course", course: "algebra1" }, levels({ negative_numbers: "mastered", order_of_operations: "almost" }));
    expect(view.nodes.map((n) => n.id)).toEqual(courseTopicIds("algebra1"));
    expect(view.label).toBe("Algebra 1");
    expect(view.chip).toBe("Algebra 1");
    expect(view.nodes[0].name).toBe("Negative numbers");
    expect(view.nodes.map((n) => n.state).slice(0, 3)).toEqual(["done", "current", "upcoming"]);
    expect(view.nodes.every((n) => n.topic === n.id)).toBe(true);
    expect(view.progressTitle).toBe(`Algebra 1 path: 1 of ${view.total} skills mastered`);
  });
});

describe("pathFor", () => {
  it("a path for a grade or a course; none (Pick your grade) without either", () => {
    expect(pathFor({ grade: 1, course: "other" }, levels())?.nodes.map((n) => n.id)).toEqual([...GRADE_PATHS[1]]);
    expect(pathFor({ grade: null, course: "geometry" }, levels())?.label).toBe("Geometry");
    expect(pathFor({ grade: null, course: "other" }, levels())).toBeNull();
    expect(pathFor({ grade: null, course: null }, levels())).toBeNull();
  });
});

describe("the trail's colour", () => {
  it("walked up to the next stop, and all of it once every skill is done", () => {
    const view = buildPathView({ kind: "grade", grade: 3 }, levels({ add_subtract_within_1000: "mastered", times_tables: "mastered" }));
    expect([0, 1, 2].map((i) => linkWalked(view, i))).toEqual([true, true, false]);
    const fresh = buildPathView({ kind: "grade", grade: 3 }, levels());
    expect([0, 1, 2].map((i) => linkWalked(fresh, i))).toEqual([false, false, false]);
    expect(linkWalked({ currentIndex: -1, allDone: true }, 2)).toBe(true);
  });
});
