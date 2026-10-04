import { describe, expect, it } from "vitest";
import { LearningBus } from "../bus";
import { MISTAKES, MISTAKE_KINDS, outcomeOf, SKILLS, isSkillId, type AttemptCounts, type LearningSignal } from "../contracts";
import { LearnerHintSchema } from "../hint";
import { clearPracticeMarker, hasPracticeMarker, PRACTICE_MARKER_TTL_MS, readPracticeMarker, writePracticeMarker, type StorageLike } from "../practiceMarker";

const zero: AttemptCounts = { linesWritten: 3, linesRight: 3, linesRinged: 0, hints: 0, tutorSteps: 0, solves: 0, asks: 0 };

describe("outcomeOf", () => {
  it("first try, self-corrected, with help", () => {
    expect(outcomeOf(zero, true, false, false)).toBe("first_try");
    expect(outcomeOf({ ...zero, linesRinged: 1 }, true, false, false)).toBe("self_corrected");
    expect(outcomeOf({ ...zero, hints: 1 }, true, false, false)).toBe("with_help");
    expect(outcomeOf({ ...zero, tutorSteps: 2, linesRinged: 1 }, true, false, true)).toBe("with_help");
  });
  it("the tutor finishing it wins over a later student answer", () => {
    expect(outcomeOf({ ...zero, solves: 1 }, true, true, false)).toBe("tutor_solved");
    expect(outcomeOf({ ...zero, solves: 1 }, false, true, true)).toBe("tutor_solved");
  });
  it("in progress until closed", () => {
    expect(outcomeOf(zero, false, false, false)).toBe("in_progress");
    expect(outcomeOf(zero, false, false, true)).toBe("unfinished");
  });
});

describe("skills and mistakes", () => {
  it("skill ids are unique and well-formed", () => {
    const ids = SKILLS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9_]{1,40}$/);
    expect(isSkillId("two_step_equations")).toBe(true);
    expect(isSkillId("nope")).toBe(false);
  });
  it("every mistake kind has a label and a tip", () => {
    for (const k of MISTAKE_KINDS) {
      expect(MISTAKES[k].label.length).toBeGreaterThan(0);
      expect(MISTAKES[k].tip.length).toBeGreaterThan(0);
    }
  });
  it("the learner hint takes defaults and caps", () => {
    expect(LearnerHintSchema.parse({})).toEqual({ weakSkills: [], strongSkills: [], recurringMistakes: [] });
    expect(LearnerHintSchema.safeParse({ weakSkills: [1, 2, 3, 4].map(() => ({ id: "fractions", name: "Fractions" })) }).success).toBe(false);
    expect(LearnerHintSchema.safeParse({ recurringMistakes: [{ kind: "nope", count: 1 }] }).success).toBe(false);
  });
});

describe("LearningBus", () => {
  const sig = (n: number): LearningSignal => ({ type: "screen", at: n, boardId: "b", pageId: "p" });
  it("buffers until the first listener, then delivers in order", () => {
    const bus = new LearningBus();
    bus.emit(sig(1));
    bus.emit(sig(2));
    const got: number[] = [];
    bus.onSignal((s) => got.push(s.at));
    bus.emit(sig(3));
    expect(got).toEqual([1, 2, 3]);
  });
  it("a throwing listener does not stop the others", () => {
    const bus = new LearningBus();
    const got: number[] = [];
    bus.onSignal(() => {
      throw new Error("x");
    });
    bus.onSignal((s) => got.push(s.at));
    bus.emit(sig(1));
    expect(got).toEqual([1]);
  });
  it("holds the learner hint until reset", () => {
    const bus = new LearningBus();
    const hint = LearnerHintSchema.parse({ recurringMistakes: [{ kind: "sign", count: 4 }] });
    bus.setLearner(hint);
    expect(bus.learner()).toBe(hint);
    bus.reset();
    expect(bus.learner()).toBeUndefined();
  });
});

describe("practice marker", () => {
  function memory(): StorageLike {
    const m = new Map<string, string>();
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
  }
  it("round-trips, expires and clears", () => {
    const s = memory();
    const marker = { boardId: "b1", skill: "fractions", problems: [["\\frac{1}{2} + \\frac{1}{3}"]], createdAt: 1000 };
    expect(writePracticeMarker(marker, s)).toBe(true);
    expect(hasPracticeMarker("b1", s)).toBe(true);
    expect(readPracticeMarker("b1", 2000, s)).toEqual(marker);
    expect(readPracticeMarker("b1", 1000 + PRACTICE_MARKER_TTL_MS + 1, s)).toBeNull();
    expect(hasPracticeMarker("b1", s)).toBe(false);
    writePracticeMarker(marker, s);
    clearPracticeMarker("b1", s);
    expect(readPracticeMarker("b1", 2000, s)).toBeNull();
  });
  it("refuses a malformed marker", () => {
    const s = memory();
    s.setItem("agathon.practice.b2", JSON.stringify({ boardId: "b2", skill: "x", problems: [[]], createdAt: 1 }));
    expect(readPracticeMarker("b2", 2, s)).toBeNull();
  });
});
