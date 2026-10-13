import { describe, expect, it } from "vitest";
import { EMPTY_ANSWERS, START_STORAGE_KEY, type StartAnswers } from "../contracts";
import {
  chooseLevel,
  chooseName,
  chooseRole,
  chooseTried,
  cleanName,
  flowCopy,
  flowProgress,
  flowSteps,
  FLOW_TTL_MS,
  forgetFlow,
  keepFlow,
  nextStep,
  notSure,
  previousStep,
  readKeptFlow,
  resumeStep,
  toggleFocus,
} from "../flow";

const PARENT: StartAnswers = { ...EMPTY_ANSWERS, role: "parent", name: "Sam", choice: { kind: "grade", grade: 3 }, focus: ["times_tables"] };
const KID: StartAnswers = { ...PARENT, role: "kid", name: "Maya" };
const NOW = 1_760_000_000_000;

function memory() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe("the screens", () => {
  it("a grown-up's, a kid's (no proof), and no focus for 'Something else'", () => {
    expect(flowSteps(PARENT)).toEqual(["who", "name", "grade", "focus", "proof", "try", "building", "plan", "account"]);
    expect(flowSteps(KID)).toEqual(["who", "name", "grade", "focus", "try", "building", "plan", "account"]);
    expect(flowSteps({ ...PARENT, choice: { kind: "course", course: "other" } })).not.toContain("focus");
    // before the grade, focus is still on the way
    expect(flowSteps({ ...PARENT, choice: null })).toContain("focus");
  });

  it("next and back; Back passes the beat, and a grown-up's link starts on the plan", () => {
    expect(nextStep({ step: "who", answers: PARENT })).toBe("name");
    expect(nextStep({ step: "focus", answers: KID })).toBe("try");
    expect(nextStep({ step: "account", answers: PARENT })).toBeNull();
    expect(previousStep({ step: "plan", answers: PARENT, fromLink: false })).toBe("try");
    expect(previousStep({ step: "who", answers: PARENT, fromLink: false })).toBeNull();
    expect(previousStep({ step: "plan", answers: KID, fromLink: true })).toBeNull();
    expect(previousStep({ step: "try", answers: { ...PARENT, choice: { kind: "course", course: "other" } }, fromLink: false })).toBe("proof");
  });

  it("the bar only grows, and is full on the account", () => {
    let last = 0;
    for (const step of flowSteps(PARENT)) {
      const p = flowProgress({ step, answers: PARENT });
      expect(p).toBeGreaterThan(last);
      last = p;
    }
    expect(last).toBe(1);
    // the first screen counts the grown-up's longer list, so choosing "kid" never moves the bar back
    expect(flowProgress({ step: "who", answers: EMPTY_ANSWERS })).toBeLessThanOrEqual(flowProgress({ step: "name", answers: KID }));
  });
});

describe("the answers", () => {
  it("a first name: trimmed and spaced; empty is none; anything else is not a name", () => {
    expect(cleanName("  Mary   Kate ")).toBe("Mary Kate");
    expect(cleanName("O'Neil")).toBe("O'Neil");
    expect(cleanName("")).toBe("");
    expect(cleanName("   ")).toBe("");
    expect(cleanName("Sam1")).toBeNull();
    expect(cleanName("x".repeat(25))).toBeNull();
    expect(chooseName(PARENT, null).name).toBeNull();
    expect(chooseRole(EMPTY_ANSWERS, "kid").role).toBe("kid");
  });

  it("up to three skills, in the order picked; a fourth does nothing; a second tap takes one off", () => {
    let a: StartAnswers = { ...PARENT, focus: [] };
    for (const s of ["times_tables", "division_facts", "multiply_by_tens", "add_subtract_within_1000"] as const) a = toggleFocus(a, s);
    expect(a.focus).toEqual(["times_tables", "division_facts", "multiply_by_tens"]);
    expect(toggleFocus(a, "division_facts").focus).toEqual(["times_tables", "multiply_by_tens"]);
    expect(notSure(a).focus).toEqual([]);
  });

  it("a new grade keeps only the picks it still offers", () => {
    expect(chooseLevel(PARENT, { kind: "grade", grade: 4 }).focus).toEqual([]);
    expect(chooseLevel(PARENT, { kind: "grade", grade: 3 }).focus).toEqual(["times_tables"]);
  });

  it("the try: merged upward, so a solved problem stays solved", () => {
    const once = chooseTried(PARENT, { checked: true, solved: true });
    expect(chooseTried(once, { checked: false, solved: false }).tried).toEqual({ checked: true, solved: true });
  });
});

describe("kept on the device", () => {
  it("kept beside the journey id, read back where it was, forgotten without the journey", () => {
    const s = memory();
    s.setItem(START_STORAGE_KEY, JSON.stringify({ journeyId: "j-1" }));
    keepFlow(s, { step: "focus", answers: PARENT }, NOW);
    expect(JSON.parse(s.getItem(START_STORAGE_KEY)!).journeyId).toBe("j-1");
    expect(readKeptFlow(s, NOW + 1000)).toEqual({ step: "focus", answers: PARENT });
    forgetFlow(s);
    expect(readKeptFlow(s, NOW)).toBeNull();
    expect(JSON.parse(s.getItem(START_STORAGE_KEY)!)).toEqual({ journeyId: "j-1" });
  });

  it("a week old is too old; junk is nothing; a flow before 'who' is not worth keeping", () => {
    const s = memory();
    keepFlow(s, { step: "grade", answers: PARENT }, NOW);
    expect(readKeptFlow(s, NOW + FLOW_TTL_MS + 1)).toBeNull();
    s.setItem(START_STORAGE_KEY, "{not json");
    expect(readKeptFlow(s, NOW)).toBeNull();
    keepFlow(s, { step: "who", answers: EMPTY_ANSWERS }, NOW);
    expect(readKeptFlow(s, NOW)).toBeNull();
    expect(readKeptFlow(null, NOW)).toBeNull();
  });

  it("reopens at the first screen whose answers are missing; the beat and the account reopen on the plan", () => {
    expect(resumeStep(PARENT, "building")).toBe("plan");
    expect(resumeStep(PARENT, "account")).toBe("plan");
    expect(resumeStep({ ...PARENT, choice: null }, "plan")).toBe("grade");
    expect(resumeStep({ ...KID, choice: null }, "try")).toBe("grade");
    expect(resumeStep(KID, "proof")).toBe("who");
  });
});

describe("the words", () => {
  it("the grown-up's, with and without the name, and the kid's own", () => {
    expect(flowCopy(PARENT).grade.title).toBe("What grade is Sam in?");
    expect(flowCopy({ ...PARENT, name: null }).grade.title).toBe("What grade is your kid in?");
    expect(flowCopy(KID).grade.title).toBe("What grade are you in?");
    expect(flowCopy(PARENT).plan.save).toBe("Save Sam’s plan");
    expect(flowCopy(KID).plan.save).toBe("Save my plan");
    expect(flowCopy(PARENT).building.start("Times tables")).toBe("Starting with Times tables");
  });

  it("a grown-up who opened the kid's link is spoken to as the grown-up", () => {
    const copy = flowCopy(KID, true);
    expect(copy.plan.title).toBe("Maya made a math plan");
    expect(copy.plan.save).toBe("Save Maya’s plan");
  });

  it("no word is ever undefined or a placeholder", () => {
    for (const answers of [PARENT, KID, { ...PARENT, name: null }, { ...EMPTY_ANSWERS }]) {
      const text = JSON.stringify(flowCopy(answers), (_k, v) => (typeof v === "function" ? String(v(1)) : v));
      expect(text).not.toMatch(/undefined|null|NaN|\[object/);
    }
  });
});
