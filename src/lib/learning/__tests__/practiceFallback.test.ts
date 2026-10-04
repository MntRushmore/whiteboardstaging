/**
 * `variantOf`'s last resort: a problem it cannot vary is filed under its skill (`classifyProblem`,
 * mocked here: the real one belongs to agent "brain") and the first practice problem of that skill
 * is given instead — `practiceProblems(classifyProblem(problem), 1, seed)`.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { LiveEngine } from "@/lib/live/contracts";
import { getEngine } from "@/lib/live/engine";
import type { SkillId } from "../contracts";

const classify = vi.hoisted(() => ({ skill: "other" as SkillId }));
vi.mock("../skills", () => ({ classifyProblem: vi.fn(() => classify.skill) }));

import { practiceProblems, variantOf } from "../practice";
import { classifyProblem } from "../skills";

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

describe("variantOf's fallback", () => {
  it("gives practiceProblems(classifyProblem(problem), 1, seed) when the problem has no variant", () => {
    classify.skill = "two_step_equations";
    expect(variantOf(engine, ["x = 4"], 21)).toEqual(practiceProblems("two_step_equations", 1, 21)[0]);
    expect(classifyProblem).toHaveBeenCalledWith(["x = 4"]);
    classify.skill = "pythagorean";
    expect(variantOf(engine, ["2x + 3y = 12"], 4)).toEqual(practiceProblems("pythagorean", 1, 4)[0]);
  });

  it("is not needed when the problem has a variant of its own", () => {
    classify.skill = "pythagorean";
    const v = variantOf(engine, ["2x + 3 = 11"], 1);
    expect(v).not.toBeNull();
    expect(v?.[0]).toMatch(/x/);
  });

  it("gives null for a skill without practice", () => {
    for (const skill of ["other", "word_problems", "proofs", "chemistry"] as SkillId[]) {
      classify.skill = skill;
      expect(variantOf(engine, ["x = 4"], 1), skill).toBeNull();
    }
  });
});
