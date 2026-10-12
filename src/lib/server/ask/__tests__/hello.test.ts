/**
 * Ask's hello on a board with no chat yet (src/lib/server/ask/hello.ts): every greeting a kid can
 * see, and chips that fit their grade and what they did last time, within the contract's caps.
 */
import { describe, expect, it } from "vitest";
import { AskHelloSchema } from "@/lib/live/ask/contracts";
import { GRADE_IDS } from "@/lib/learning/grades";
import { COURSE_IDS } from "@/lib/onboarding/courseIds";
import { buildAskHello, buildNewScreenHello, HELLO_CHIPS, NEW_SCREEN_GREETING, quizChip, skillInSentence } from "../hello";
import { EMPTY_ASK_CONTEXT, type AskLearnerContext } from "../store";

const ctx = (over: Partial<AskLearnerContext>): AskLearnerContext => ({ ...EMPTY_ASK_CONTEXT, ...over });

describe("buildAskHello: the greeting", () => {
  it("welcomes a kid back by name with the last skill they worked on", () => {
    const hello = buildAskHello(ctx({ name: "Maya", grade: 6, recent: ["Dividing fractions", "Percents"] }));
    expect(hello.greeting).toBe("Welcome back, Maya! Last time you worked on dividing fractions.");
  });

  it("without a name, still welcomes them back", () => {
    expect(buildAskHello(ctx({ recent: ["Times tables"] })).greeting).toBe("Welcome back! Last time you worked on times tables.");
  });

  it("with notes but no recent work, says it remembers how they learn (never the notes themselves)", () => {
    const hello = buildAskHello(ctx({ name: "Sam", memory: ["Gets stuck on borrowing across a zero"] }));
    expect(hello.greeting).toBe("Welcome back, Sam! I remember how you like to learn. What are we working on today?");
    expect(hello.greeting).not.toContain("borrowing");
  });

  it("a first time: a friendly hello", () => {
    expect(buildAskHello(ctx({ name: "Leo" })).greeting).toBe("Hi Leo! I'm your tutor. Ask me anything, or write a problem on the board.");
    expect(buildAskHello(EMPTY_ASK_CONTEXT).greeting).toBe("Hi! I'm your tutor. Ask me anything, or write a problem on the board.");
  });

  it("keeps a skill's own capital mid-sentence", () => {
    const pythagoras = buildAskHello(ctx({ recent: ["Pythagorean theorem"] }));
    expect(pythagoras.greeting).toBe("Welcome back! Last time you worked on the Pythagorean theorem.");
    expect(pythagoras.chips).toContain("Explain the Pythagorean theorem to me");
    expect(skillInSentence("Long division")).toBe("long division");
    expect(skillInSentence("3-digit adding and subtracting")).toBe("3-digit adding and subtracting");
  });
});

describe("buildAskHello: the chips", () => {
  it("after work: more like it, explain it, a quiz for the grade, homework", () => {
    const hello = buildAskHello(ctx({ name: "Maya", grade: 3, recent: ["Long division"] }));
    expect(hello.chips).toEqual([HELLO_CHIPS.moreLikeLast, "Explain long division to me", "Quiz me on times tables", HELLO_CHIPS.homework]);
  });

  it("a first time: a quiz for the grade, homework, and two ways in", () => {
    expect(buildAskHello(ctx({ grade: 0 })).chips).toEqual(["Quiz me on adding to 10", HELLO_CHIPS.homework, HELLO_CHIPS.whatCanYouDo, HELLO_CHIPS.funFact]);
  });

  it("a high-school course picks its quiz; no grade or course still offers four", () => {
    expect(buildAskHello(ctx({ course: "geometry" })).chips[0]).toBe("Quiz me on angles");
    expect(buildAskHello(EMPTY_ASK_CONTEXT).chips).toEqual([HELLO_CHIPS.homework, HELLO_CHIPS.whatCanYouDo, HELLO_CHIPS.funFact]);
  });

  it("every grade and course has a quiz chip", () => {
    for (const grade of GRADE_IDS) expect(quizChip({ grade, course: null })).toMatch(/^Quiz me on /);
    for (const course of COURSE_IDS) expect(quizChip({ grade: null, course })).toMatch(/^Quiz me on /);
    expect(quizChip({ grade: null, course: null })).toBeNull();
  });

  it("an explain chip too long for a chip is left out", () => {
    const long = "A skill with a very long name that would never fit on a chip at all";
    const hello = buildAskHello(ctx({ grade: 5, recent: [long] }));
    expect(hello.chips).not.toContain(`Explain ${skillInSentence(long)} to me`);
    expect(hello.chips).toHaveLength(4);
  });
});

describe("buildAskHello: always within the contract", () => {
  it("for every grade, course and kind of context", () => {
    const contexts: AskLearnerContext[] = [];
    for (const grade of [...GRADE_IDS, null]) {
      for (const recent of [[], ["Adding to 10"], ["Multi-step equations", "Systems of equations"]]) {
        for (const memory of [[], ["Likes shorter hints"]]) {
          contexts.push(ctx({ grade, recent, memory, name: grade === null ? null : "Alexandria" }));
        }
      }
    }
    for (const course of COURSE_IDS) contexts.push(ctx({ course, recent: ["Trig values"] }));
    for (const c of contexts) {
      const hello = buildAskHello(c);
      expect(AskHelloSchema.safeParse(hello).success).toBe(true);
      expect(hello.chips.length).toBeGreaterThan(0);
      expect(new Set(hello.chips).size).toBe(hello.chips.length);
      // US English: math, never maths
      expect(JSON.stringify(hello)).not.toMatch(/\bmaths\b/i);
    }
  });
});

describe("buildNewScreenHello: a new screen's chat", () => {
  it("a short line, and chips that name what the board was just working on (the tutor sees only this screen's chat)", () => {
    const hello = buildNewScreenHello(ctx({ name: "Maya", grade: 5, recent: ["Dividing fractions", "Percents"] }));
    expect(hello.greeting).toBe(NEW_SCREEN_GREETING);
    expect(hello.greeting).toBe("New screen! What should we work on?");
    expect(hello.chips).toEqual(["3 more on dividing fractions", "Explain dividing fractions to me", "Quiz me on fractions", "Help me with my homework"]);
    // never "like last time" or "like the last screen": the words carry the topic
    expect(hello.chips.join(" ")).not.toMatch(/\blast (time|screen)\b/i);
  });

  it("no skill known for the board: the general first asks", () => {
    expect(buildNewScreenHello(ctx({ grade: 3 })).chips).toEqual(["Quiz me on times tables", HELLO_CHIPS.homework, HELLO_CHIPS.whatCanYouDo, HELLO_CHIPS.funFact]);
    expect(buildNewScreenHello(ctx({})).chips).toEqual([HELLO_CHIPS.homework, HELLO_CHIPS.whatCanYouDo, HELLO_CHIPS.funFact]);
  });

  it("never the kid's name (a quick line, not a welcome), always within the contract", () => {
    const hello = buildNewScreenHello(ctx({ name: "Alexandria", course: "geometry", recent: ["Pythagorean theorem"] }));
    expect(JSON.stringify(hello)).not.toContain("Alexandria");
    expect(hello.chips[0]).toBe("3 more on the Pythagorean theorem");
    expect(AskHelloSchema.safeParse(hello).success).toBe(true);
    // a skill name too long for a chip is left out, not cut
    const long = buildNewScreenHello(ctx({ grade: 4, recent: ["x".repeat(70)] }));
    for (const chip of long.chips) expect(chip.length).toBeLessThanOrEqual(60);
    expect(long.chips[0]).toBe("Quiz me on long division");
  });
});
