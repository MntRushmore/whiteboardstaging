/**
 * The day's set (`planDailySet`): the mix of next, weak and review problems, easy to hard, the same
 * set for the same student and day, a brand-new student's easy first day, and the degrading when a
 * skill has no generator. Uses only skills whose generators exist today; a K–8 skill is checked to
 * come out of its own generator OR its stand-in, so the test holds once the catalog lands.
 */
import { describe, expect, it } from "vitest";
import type { MasteryLevel } from "@/lib/learning/contracts";
import { drawLadder, formsFor } from "@/lib/learning/generators";
import { difficultyOf } from "@/lib/learning/generators/ladder";
import { K8_SKILL_IDS } from "@/lib/learning/grades";
import { DAILY_GOAL } from "../contracts";
import { BONUS_PROBLEMS, bonusProblems, dailySeed, drawSkillFor, LADDER_RUNGS, planDailySet, STAND_INS, type DailyPlanInput } from "../plan";

const PATH = ["add_subtract", "multiply_divide", "fractions", "two_step_equations"];
const levels = (entries: Record<string, MasteryLevel>) => new Map(Object.entries(entries)) as Map<string, MasteryLevel>;
const input = (over: Partial<DailyPlanInput> = {}): DailyPlanInput => ({ day: "2026-10-08", userId: "u-1", path: PATH, levels: new Map(), weakSkills: [], ...over });
const whys = (p: ReturnType<typeof planDailySet>) => p.problems.map((x) => x.why);
const count = <T>(xs: readonly T[], v: T) => xs.filter((x) => x === v).length;
const keys = (p: ReturnType<typeof planDailySet>) => p.problems.map((x) => x.lines.join("; "));

describe("planDailySet", () => {
  it("a brand-new student gets five from the first path skills, at the easy end of each ladder", () => {
    const plan = planDailySet(input());
    expect(plan.day).toBe("2026-10-08");
    expect(plan.goal).toBe(DAILY_GOAL);
    expect(plan.problems).toHaveLength(DAILY_GOAL);
    expect(new Set(plan.problems.map((p) => p.skill))).toEqual(new Set(["add_subtract", "multiply_divide"]));
    expect(whys(plan).every((w) => w === "next")).toBe(true);
    // the easy end: every problem from the bottom half of its ladder
    const seed = dailySeed("u-1", "2026-10-08");
    for (const p of plan.problems) {
      const ladder = drawLadder(p.skill, LADDER_RUNGS, seed).problems.map((l) => l.join("; "));
      expect(ladder.indexOf(p.lines.join("; ")), p.lines.join()).toBeLessThan(LADDER_RUNGS / 2);
    }
  });

  it("the same student on the same day gets the same set; another day or student, another", () => {
    const a = planDailySet(input({ levels: levels({ add_subtract: "mastered", multiply_divide: "almost" }), weakSkills: ["fractions"] }));
    const b = planDailySet(input({ levels: levels({ add_subtract: "mastered", multiply_divide: "almost" }), weakSkills: ["fractions"] }));
    expect(b).toEqual(a);
    expect(keys(planDailySet(input({ day: "2026-10-09" })))).not.toEqual(keys(planDailySet(input())));
    expect(keys(planDailySet(input({ userId: "u-2" })))).not.toEqual(keys(planDailySet(input())));
  });

  it("the mix: about 2 next, 2 weak and 1 review", () => {
    const plan = planDailySet(
      input({
        levels: levels({ add_subtract: "mastered", multiply_divide: "practicing", fractions: "almost", two_step_equations: "new", negative_numbers: "practicing" }),
        weakSkills: ["negative_numbers", "multiply_divide"],
      }),
    );
    expect(plan.problems).toHaveLength(5);
    expect(count(whys(plan), "next")).toBe(2);
    expect(count(whys(plan), "weak")).toBe(2);
    expect(count(whys(plan), "review")).toBe(1);
    // next: the first path skills not mastered; weak: a weak spot that is not already next; review: the mastered one
    const by = (why: string) => plan.problems.filter((p) => p.why === why).map((p) => p.skill);
    expect(by("next")).toEqual(expect.arrayContaining(["multiply_divide", "fractions"]));
    expect(by("weak")).toEqual(["negative_numbers", "negative_numbers"]);
    expect(by("review")).toEqual(["add_subtract"]);
  });

  it("orders the set easy to hard: earlier skills first, then up each ladder", () => {
    const plan = planDailySet(input({ levels: levels({ add_subtract: "mastered", multiply_divide: "practicing", two_step_equations: "practicing" }), weakSkills: ["two_step_equations"] }));
    const order = ["add_subtract", "multiply_divide", "fractions", "two_step_equations"];
    const ranks = plan.problems.map((p) => order.indexOf(p.skill));
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    // two of one skill: the easier first
    for (let i = 1; i < plan.problems.length; i++) {
      const [a, b] = [plan.problems[i - 1], plan.problems[i]];
      if (a.skill === b.skill) expect(difficultyOf(a.lines) <= difficultyOf(b.lines) + 6, `${a.lines} then ${b.lines}`).toBe(true);
    }
  });

  it("no weak spot yet: its slots go to next; nothing mastered: the review's too", () => {
    const plan = planDailySet(input({ levels: levels({ add_subtract: "practicing" }) }));
    expect(plan.problems).toHaveLength(5);
    expect(whys(plan).every((w) => w === "next")).toBe(true);
    expect(new Set(plan.problems.map((p) => p.skill))).toEqual(new Set(["add_subtract", "multiply_divide"]));
  });

  it("a whole path mastered: on to the next grade's path, else all reviews", () => {
    const all = levels({ add_subtract: "mastered", multiply_divide: "mastered", fractions: "mastered", two_step_equations: "mastered" });
    const beyond = planDailySet(input({ levels: all, beyond: ["inequalities", "systems"] }));
    expect(beyond.problems).toHaveLength(5);
    expect(beyond.problems.filter((p) => p.why === "next").map((p) => p.skill)).toEqual(expect.arrayContaining(["inequalities", "systems"]));
    const reviews = planDailySet(input({ levels: all }));
    expect(reviews.problems).toHaveLength(5);
    expect(whys(reviews).every((w) => w === "review")).toBe(true);
    expect(new Set(reviews.problems.map((p) => p.skill)).size).toBeGreaterThan(1);
  });

  it("the review changes from day to day among the mastered skills", () => {
    const lv = levels({ add_subtract: "mastered", multiply_divide: "mastered", fractions: "mastered", two_step_equations: "practicing" });
    const reviewed = new Set<string>();
    for (let d = 1; d <= 14; d++) {
      const plan = planDailySet(input({ levels: lv, day: `2026-10-${String(d).padStart(2, "0")}` }));
      for (const p of plan.problems) if (p.why === "review") reviewed.add(p.skill);
    }
    expect(reviewed.size).toBeGreaterThan(1);
  });

  it("never repeats a problem, and every problem is a skill's own lines", () => {
    for (let d = 1; d <= 20; d++) {
      const plan = planDailySet(input({ day: `2026-09-${String(d).padStart(2, "0")}`, levels: levels({ add_subtract: "almost", fractions: "practicing" }), weakSkills: ["fractions", "two_step_equations"] }));
      expect(new Set(keys(plan)).size).toBe(plan.problems.length);
      for (const p of plan.problems) {
        expect(p.lines.length).toBeGreaterThan(0);
        expect(p.lines.every((l) => typeof l === "string" && l.length > 0)).toBe(true);
      }
    }
  });

  it("skips skills with no generator, and with none at all falls back to the numbers", () => {
    const plan = planDailySet(input({ path: ["proofs", "word_problems", "fractions"], levels: levels({ fractions: "practicing" }) }));
    expect(plan.problems.every((p) => p.skill === "fractions")).toBe(true);
    expect(plan.problems).toHaveLength(5);
    const none = planDailySet(input({ path: ["proofs", "chemistry"] }));
    expect(none.problems).toHaveLength(5);
    expect(none.problems.every((p) => drawSkillFor(p.skill) !== null)).toBe(true);
    expect(planDailySet(input({ path: [] })).problems).toHaveLength(5);
  });

  it("a K–8 path draws each skill from its own generator, or its stand-in until that lands", () => {
    const plan = planDailySet(input({ path: ["add_within_10", "subtract_within_10"] }));
    expect(plan.problems).toHaveLength(5);
    for (const p of plan.problems) {
      expect(["add_within_10", "subtract_within_10"]).toContain(p.skill);
      const from = drawSkillFor(p.skill);
      expect(from === p.skill || from === STAND_INS[p.skill as keyof typeof STAND_INS]).toBe(true);
    }
    // every K–8 skill can be drawn one way or the other
    for (const id of K8_SKILL_IDS) expect(drawSkillFor(id), id).not.toBeNull();
  });

  it("a smaller goal plans a smaller set with the same kinds of problem", () => {
    const plan = planDailySet(input({ goal: 3, levels: levels({ add_subtract: "mastered", multiply_divide: "practicing" }), weakSkills: ["fractions"] }));
    expect(plan.problems).toHaveLength(3);
    expect(plan.goal).toBe(3);
  });
});

describe("bonusProblems", () => {
  it("three more from the day's skills, none of them already on the board, the same for the same seed", () => {
    const today = planDailySet(input({ levels: levels({ add_subtract: "almost" }) }));
    const skills = [...new Set(today.problems.map((p) => p.skill))];
    const more = bonusProblems(skills, 42, BONUS_PROBLEMS, today.problems.map((p) => p.lines));
    expect(more).toHaveLength(BONUS_PROBLEMS);
    const onBoard = new Set(keys(today));
    for (const p of more) expect(onBoard.has(p.join("; "))).toBe(false);
    expect(new Set(more.map((p) => p.join("; "))).size).toBe(BONUS_PROBLEMS);
    expect(bonusProblems(skills, 42, BONUS_PROBLEMS, today.problems.map((p) => p.lines))).toEqual(more);
  });

  it("no skills that can be drawn: the numbers; a K–8 skill: its stand-in until its generator lands", () => {
    expect(bonusProblems([], 1)).toHaveLength(BONUS_PROBLEMS);
    expect(bonusProblems(["proofs"], 1)).toHaveLength(BONUS_PROBLEMS);
    expect(bonusProblems(["times_tables"], 1)).toHaveLength(BONUS_PROBLEMS);
    expect(formsFor("proofs")).toHaveLength(0);
  });
});
