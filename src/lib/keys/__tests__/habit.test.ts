import { describe, expect, it } from "vitest";
import { ATTEMPT_ORIGINS } from "@/lib/learning/contracts";
import { summarize } from "@/lib/learning/summary";
import { toRecord } from "@/lib/report/build";
import type { DailyPlan } from "@/lib/daily/contracts";
import { planDailySet } from "@/lib/daily/plan";
import { gradePath } from "@/lib/learning/grades";
import { dueComebacks } from "../comebacks";
import { generateMixed, isKeysSkill, keysItemFromText } from "../generate";
import { keysRecord, startClock, tickClock } from "../record";
import { keysSkillFor, planKeysSet } from "../plan";
import { problemReducer, startProblem, type ProblemAction, type ProblemState } from "../session";

const plan = (skills: [string, "next" | "weak" | "review"][]): DailyPlan => ({
  day: "2026-10-27",
  goal: skills.length,
  problems: skills.map(([skill, why]) => ({ skill, why, lines: ["1+1"] })),
});

describe("Today's practice on Keys", () => {
  it("keeps the day's skills Keys can write, and swaps the rest for the path's", () => {
    const p = planKeysSet(
      plan([
        ["times_tables", "next"],
        ["division_facts", "next"],
        ["add_fractions_like", "weak"],
        ["multiply_by_tens", "weak"],
        ["subtract_within_100", "review"],
      ]),
      [],
      ["times_tables", "division_facts", "multiply_by_tens"],
    );
    expect(p.skills).toEqual(["times_tables", "times_tables", "add_fractions_like", "multiply_by_tens", "subtract_within_100"]);
    expect(p.keysable).toBe(true);
    expect(p.comeback).toBeNull();
  });

  it("opens with a comeback, in place of the review", () => {
    const p = planKeysSet(
      plan([
        ["add_within_100", "next"],
        ["subtract_within_100", "next"],
        ["times_tables", "weak"],
        ["times_tables", "weak"],
        ["add_within_100", "review"],
      ]),
      [{ skill: "add_fractions_like", dueDay: "2026-10-27", after: 2, fromAttemptId: "a" }],
    );
    expect(p.skills[0]).toBe("add_fractions_like");
    expect(p.why).toEqual(["comeback", "next", "next", "weak", "weak"]);
  });

  it("is not Keys' when the day is mostly what Keys cannot write (Kindergarten)", () => {
    const p = planKeysSet(
      plan([
        ["add_within_10", "next"],
        ["subtract_within_10", "next"],
        ["add_within_10", "next"],
        ["subtract_within_10", "next"],
        ["add_within_10", "next"],
      ]),
      [],
      gradePath(0),
    );
    expect(p.keysable).toBe(false);
    expect(keysSkillFor("add_subtract")).toBe("add_within_100");
    expect(keysSkillFor("long_division")).toBeNull();
  });

  it("from a 3rd grader's real day: the path, written as Keys problems", () => {
    const input = { day: "2026-10-27", userId: "kid", path: gradePath(3), levels: new Map(), weakSkills: [] as string[] };
    const p = planKeysSet(planDailySet(input), [], input.path);
    expect(p.keysable).toBe(true);
    expect(p.skills.every(isKeysSkill)).toBe(true);
    const items = generateMixed(42, p.skills);
    expect(items).toHaveLength(5);
  });
});

/** A finished attempt on Keys, as the store saves it. */
function finished(text: string, ...actions: ProblemAction[]) {
  const s = actions.reduce<ProblemState>(problemReducer, startProblem(keysItemFromText(text)!));
  const at = Date.parse("2026-10-20T16:00:00Z");
  return keysRecord(s, { id: crypto.randomUUID(), course: null, parentId: null, clock: tickClock(startClock(at), at + 40_000), closed: true });
}

describe("Keys in the learning record", () => {
  const helped = finished("6 x 7", { type: "answer", value: "13" }, { type: "check" }, { type: "help" }, { type: "answer", value: "42" }, { type: "check" });
  const alone = finished("53 - 27", { type: "answer", value: "26" }, { type: "check" });

  it("Progress counts Keys attempts like board work", () => {
    expect(ATTEMPT_ORIGINS).toContain("keys");
    const now = Date.parse("2026-10-21T12:00:00Z");
    const summary = summarize([helped, alone], now);
    expect(summary.totals).toMatchObject({ problems: 2, independent: 1, withHelp: 1 });
    expect(summary.skills.find((s) => s.skill === "times_tables")).toMatchObject({ attempts: 1, independent: 0 });
    expect(summary.skills.find((s) => s.skill === "subtract_within_100")).toMatchObject({ attempts: 1, independent: 1 });
    expect(summary.mistakes).toEqual([{ kind: "concept", count: 1 }]);
    expect(summary.recent.map((r) => r.origin)).toEqual(["keys", "keys"]);
  });

  it("the parents' weekly report reads a Keys row", () => {
    const row = {
      id: helped.id,
      board_id: null,
      problem_latex: helped.problemLatex,
      skill: helped.skill,
      course: null,
      origin: "keys",
      outcome: helped.outcome,
      lines_written: helped.linesWritten,
      active_ms: helped.activeMs,
      mistakes: helped.mistakes,
      started_at: helped.startedAt,
      updated_at: helped.updatedAt,
      finished_at: helped.finishedAt,
    };
    expect(toRecord(row)).toMatchObject({ origin: "keys", outcome: "with_help", skill: "times_tables" });
  });

  it("a skill done with help on Keys comes back two days later", () => {
    const due = dueComebacks([helped], { now: Date.parse("2026-10-22T15:00:00Z"), tzOffsetMinutes: 0, canWrite: isKeysSkill });
    expect(due).toMatchObject([{ skill: "times_tables", after: 2 }]);
  });
});
