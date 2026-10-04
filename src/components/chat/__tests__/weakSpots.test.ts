import { describe, expect, it, vi } from "vitest";
import { LearnerHintSchema, type LearnerHint } from "@/lib/learning/hint";
import { CHAT_SUGGESTIONS, historyFor, WEAK_SPOTS_COPY, weakSpotPractice, weakSpotSkill, type ChatMessage, type PracticeSource } from "../chatView";

const hint = (weak: [string, string][]): LearnerHint => LearnerHintSchema.parse({ weakSkills: weak.map(([id, name]) => ({ id, name })) });

const HINT = hint([
  ["proofs", "Proofs"],
  ["two_step_equations", "Two-step equations"],
  ["fractions", "Fractions"],
]);

/** practice for equations and fractions; none for proofs */
function source(problemsFor: Record<string, string[][]> = {}): PracticeSource & { practiceProblems: ReturnType<typeof vi.fn> } {
  const has = new Set(["two_step_equations", "fractions"]);
  return {
    hasPractice: (id) => has.has(id),
    practiceProblems: vi.fn((skill: string, count: number) =>
      (problemsFor[skill] ?? Array.from({ length: count }, (_, i) => [`${i + 2}x + 1 = ${2 * (i + 2) + 1}`])).slice(0, count),
    ),
  };
}

describe("Practice my weak spots: the chip", () => {
  it("shows for the weakest skill that has practice problems", () => {
    expect(weakSpotSkill(HINT, source().hasPractice)).toEqual({ id: "two_step_equations", name: "Two-step equations" });
  });

  it("hidden with no record, no weak skills, or none with practice problems", () => {
    expect(weakSpotSkill(undefined, source().hasPractice)).toBeNull();
    expect(weakSpotSkill(hint([]), source().hasPractice)).toBeNull();
    expect(weakSpotSkill(hint([["proofs", "Proofs"]]), source().hasPractice)).toBeNull();
    // the contract's stub (practice.ts before its owner merges) has practice for nothing
    expect(weakSpotSkill(HINT, () => false)).toBeNull();
  });

  it("the chip's words are the student's own; the four suggestions stay as they were", () => {
    expect(WEAK_SPOTS_COPY.chip).toBe("Practice my weak spots");
    expect(CHAT_SUGGESTIONS).toHaveLength(4);
    expect(CHAT_SUGGESTIONS).not.toContain(WEAK_SPOTS_COPY.chip);
  });
});

describe("Practice my weak spots: a tap", () => {
  it("4 problems on the weakest practicable skill, made with the seed given", () => {
    const practice = source();
    const plan = weakSpotPractice(HINT, practice, 42);
    expect(plan?.skill).toEqual({ id: "two_step_equations", name: "Two-step equations" });
    expect(plan?.problems).toHaveLength(WEAK_SPOTS_COPY.count);
    expect(practice.practiceProblems).toHaveBeenCalledTimes(1);
    expect(practice.practiceProblems).toHaveBeenCalledWith("two_step_equations", 4, 42);
  });

  it("a skill whose generator makes nothing gives way to the next", () => {
    const plan = weakSpotPractice(HINT, source({ two_step_equations: [] }), 1);
    expect(plan?.skill.id).toBe("fractions");
    expect(plan?.problems.length).toBeGreaterThan(0);
  });

  it("nothing to practise: null (the reply then asks them what they'd like)", () => {
    expect(weakSpotPractice(hint([["proofs", "Proofs"]]), source(), 1)).toBeNull();
    expect(weakSpotPractice(undefined, source(), 1)).toBeNull();
    expect(WEAK_SPOTS_COPY.none).not.toMatch(/weak/i);
  });

  it("the reply names the skill, counts the problems, and never says weak", () => {
    expect(WEAK_SPOTS_COPY.reply(4, "Two-step equations")).toBe("Here are 4 problems on Two-step equations to practise.");
    expect(WEAK_SPOTS_COPY.reply(1, "Fractions")).toBe("Here is 1 problem on Fractions to practise.");
    for (const n of [1, 2, 3, 4]) expect(WEAK_SPOTS_COPY.reply(n, "Fractions")).not.toMatch(/weak/i);
    expect(WEAK_SPOTS_COPY.failed).not.toMatch(/weak/i);
    expect(WEAK_SPOTS_COPY.chipHint).not.toMatch(/weak/i);
  });

  it("the chip and its reply are part of the chat so far, so the next request knows what is on the board", () => {
    const messages: ChatMessage[] = [
      { id: "1", role: "user", text: WEAK_SPOTS_COPY.chip },
      { id: "2", role: "tutor", text: WEAK_SPOTS_COPY.reply(4, "Fractions"), state: "done" },
    ];
    expect(historyFor(messages)).toEqual([
      { role: "user", text: "Practice my weak spots" },
      { role: "tutor", text: "Here are 4 problems on Fractions to practise." },
    ]);
  });
});
