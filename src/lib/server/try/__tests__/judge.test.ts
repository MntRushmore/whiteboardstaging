/**
 * The try board's check (`judgeTryLine`) held to the engine on every problem the page offers: the
 * onboarding's own first step under it is ticked (and finishes a one-step problem), a slip is ringed,
 * nothing read or a scribble is `unread`, half a step is `unjudged` — the board's own marks
 * (courses.test.ts holds the same starters to `analyzeColumn` + `badgeFor`).
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { LiveEngine } from "@/lib/live/contracts";
import { getEngine } from "@/lib/live/engine";
import { localSolve } from "@/lib/live/localSolve";
import { GRADE_STARTERS, STARTER_PROBLEMS, type StarterProblem } from "@/lib/onboarding/courses";
import { TRY_BANDS, type TryProblem } from "@/lib/try/contracts";
import { TRY_PROBLEMS, tryProblem } from "@/lib/try/problems";
import { CARRIED_NOTE, judgeTryLine, kidNote } from "../judge";
import { nextTryStep } from "../help";

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
}, 60_000);

const STARTERS: readonly StarterProblem[] = [...Object.values(GRADE_STARTERS).flat(), ...Object.values(STARTER_PROBLEMS).flat()];
function starterOf(p: TryProblem): StarterProblem {
  const s = STARTERS.find((x) => x.lines.join("; ") === p.lines.join("; "));
  if (!s) throw new Error(`no starter for ${p.id}`);
  return s;
}

/** A step that does not follow (courses.test.ts's WRONG_STEP, for the try board's problems). */
const WRONG_STEP: Record<string, string> = {
  "3 + 4": "8",
  "5 + 2": "6",
  "7 - 3": "5",
  "8 + 7": "16",
  "15 - 8": "8",
  "40 + 30": "60",
  "47 + 38": "75",
  "72 - 35": "47",
  "56 + 27": "73",
  "6 \\times 7": "36",
  "42 \\div 6": "6",
  "4 \\times 60": "2400",
  "\\frac{2}{7} + \\frac{3}{7}": "\\frac{5}{14}",
  "46 \\times 7": "282",
  "864 \\div 4": "226",
  "\\frac{1}{2} + \\frac{1}{3}": "\\frac{2}{5}",
  "\\frac{2}{3} \\times \\frac{3}{5}": "\\frac{5}{8}",
  "\\frac{3}{4} + \\frac{1}{6}": "\\frac{4}{10}",
  "x + 7 = 15": "x = 22",
  "3x = 24": "x = 21",
  "\\frac{3}{4} \\div \\frac{1}{2}": "\\frac{3}{8}",
  "2x + 5 = 17": "2x = 22",
  "3x - 4 = 11": "3x = 7",
  "\\frac{x}{4} = \\frac{9}{12}": "x = 4",
  "5x - 3 = 2x + 9": "7x = 12",
  "2(x + 3) = 14": "x + 3 = 12",
  "3x + 4 = x + 10": "4x + 4 = 10",
  "2x + 3 = 11": "2x = 14",
  "5x - 4 = 21": "5x = 17",
  "3(x + 2) = 18": "3x + 2 = 18",
};

/** The engine's own answer with its last number one more (`= 7` → `8`, `x = 8` → `x = 9`): a wrong answer. */
function wrongAnswer(p: TryProblem): string {
  const answer = localSolve(engine, [...p.lines]).steps.at(-1) ?? "";
  return answer.replace(/^\s*=\s*/, "").replace(/(\d+)(?!.*\d)/, (n) => String(Number(n) + 1));
}

describe("judgeTryLine on every try problem", () => {
  it("covers every problem the page offers, in every band", () => {
    expect(TRY_PROBLEMS.length).toBeGreaterThanOrEqual(TRY_BANDS.length * 2);
    for (const b of TRY_BANDS) expect(TRY_PROBLEMS.some((p) => p.band === b.id), b.id).toBe(true);
    for (const p of TRY_PROBLEMS) expect(WRONG_STEP[p.lines.join("; ")], `a wrong step for ${p.id}`).toBeTruthy();
  });

  describe.each(TRY_PROBLEMS.map((p) => ({ id: p.id, lines: p.lines.join("; "), p })))("$id: $lines", ({ p }) => {
    it("ticks the onboarding's first step, and a one-step problem's answer finishes it", () => {
      const { firstStep } = starterOf(p);
      const { verdict, note } = judgeTryLine(engine, p, [], firstStep);
      expect(note).toBeNull();
      expect(verdict).toBe(p.oneStep ? "solved" : "check");
    }, 20_000);

    it("rings a slip, with a note only in words", () => {
      for (const wrong of [WRONG_STEP[p.lines.join("; ")], wrongAnswer(p)]) {
        const { verdict, note } = judgeTryLine(engine, p, [], wrong);
        expect(verdict, wrong).toBe("ring");
        if (note !== null) expect(note).toBe(kidNote(note));
      }
    }, 20_000);

    it("reads nothing or a scribble as unread", () => {
      for (const line of ["", "   ", "@@", "\\text { lol }", "\\hline"]) expect(judgeTryLine(engine, p, [], line), JSON.stringify(line)).toEqual({ verdict: "unread", note: null });
    }, 20_000);

    it("is unread when the reader was not sure, as on the board", () => {
      const { firstStep } = starterOf(p);
      expect(judgeTryLine(engine, p, [], firstStep, { confidence: 0.3 }).verdict).toBe("unread");
      expect(judgeTryLine(engine, p, [], firstStep, { confidence: 0.95 }).verdict).toBe(p.oneStep ? "solved" : "check");
    }, 20_000);

    it("leaves half a step unjudged", () => {
      for (const line of ["=", "x", "\\cdots"]) expect(judgeTryLine(engine, p, [], line).verdict, line).toBe("unjudged");
    }, 20_000);
  });
});

describe("judgeTryLine, line by line", () => {
  const p = (id: string) => tryProblem(id)!;

  it("finishes a one-step problem with its answer, however it is written", () => {
    for (const line of ["7", "= 7", "3 + 4 = 7"]) expect(judgeTryLine(engine, p("k2-0"), [], line).verdict, line).toBe("solved");
    expect(judgeTryLine(engine, p("g68-0"), [], "x = 8").verdict).toBe("solved");
    expect(judgeTryLine(engine, p("g35-3"), [], "\\frac{5}{7}").verdict).toBe("solved");
  }, 20_000);

  it("rings `3 + 4 = 8` with the engine's note in words", () => {
    expect(judgeTryLine(engine, p("k2-0"), [], "3 + 4 = 8")).toEqual({ verdict: "ring", note: "Re-check the arithmetic here" });
  }, 20_000);

  it("ticks each line of a worked problem and finishes it on the last", () => {
    const g68 = p("g68-3");
    expect(judgeTryLine(engine, g68, [], "2x = 12").verdict).toBe("check");
    expect(judgeTryLine(engine, g68, ["2x = 12"], "x = 6").verdict).toBe("solved");
    expect(judgeTryLine(engine, g68, ["2x = 12"], "x = 7").verdict).toBe("ring");
    const fractions = p("g35-6");
    expect(judgeTryLine(engine, fractions, [], "\\frac{3}{6} + \\frac{2}{6}").verdict).toBe("check");
    expect(judgeTryLine(engine, fractions, ["\\frac{3}{6} + \\frac{2}{6}"], "\\frac{5}{6}").verdict).toBe("solved");
    // a young student's working under a sum is judged against the sum, not the line above
    const sum = p("k2-6");
    expect(judgeTryLine(engine, sum, [], "40 + 30 = 70").verdict).toBe("check");
    expect(judgeTryLine(engine, sum, ["40 + 30 = 70", "7 + 8 = 15"], "85").verdict).toBe("solved");
  }, 30_000);

  it("never checks a line against a ringed one: carried on from a slip is ringed for the slip", () => {
    const g68 = p("g68-3");
    expect(judgeTryLine(engine, g68, ["2x = 22"], "x = 11")).toEqual({ verdict: "ring", note: CARRIED_NOTE });
    expect(judgeTryLine(engine, g68, ["2x = 22"], "x = 6").verdict).toBe("solved");
  }, 20_000);

  it("leaves half a step and a lone wrong number under algebra unjudged", () => {
    expect(judgeTryLine(engine, p("g68-3"), [], "2x =").verdict).toBe("unjudged");
    expect(judgeTryLine(engine, p("g68-3"), [], "2x").verdict).toBe("unjudged");
    expect(judgeTryLine(engine, p("k2-0"), [], "3 +").verdict).toBe("unjudged");
    // a lone wrong number may be a side sum: never a slip (x + 7 = 15)
    expect(judgeTryLine(engine, p("g68-0"), [], "9").verdict).toBe("unjudged");
  }, 20_000);

  it("takes a lone right number under algebra as the answer: children write 8, not x = 8 (the real-ink bench)", () => {
    expect(judgeTryLine(engine, p("g68-0"), [], "8").verdict).toBe("solved");
  }, 20_000);
});

describe("walked to the end with Show me a step", () => {
  const firsts = TRY_BANDS.map((b) => TRY_PROBLEMS.find((p) => p.band === b.id)!);
  const longest = ["g68-6", "hs-2", "g35-6"].map((id) => tryProblem(id)!);
  it.each([...firsts, ...longest].map((p) => ({ id: p.id, p })))("$id: each step is ticked and the last one solves it", ({ p }) => {
    const work: string[] = [];
    for (let i = 0; i < 6; i++) {
      const step = nextTryStep(engine, p, work);
      expect(step.latex, `step ${i + 1} of ${p.id}`).not.toBeNull();
      const { verdict } = judgeTryLine(engine, p, work, step.latex!);
      expect(verdict).toBe(step.solves ? "solved" : "check");
      work.push(step.latex!);
      if (step.solves) break;
    }
    expect(judgeTryLine(engine, p, work.slice(0, -1), work.at(-1)!).verdict).toBe("solved");
    expect(nextTryStep(engine, p, work)).toEqual({ latex: null, solves: false });
  }, 60_000);
});

describe("kidNote", () => {
  it("keeps words and drops LaTeX, symbols alone and essays", () => {
    expect(kidNote("Re-check the arithmetic here")).toBe("Re-check the arithmetic here");
    expect(kidNote("  The remainder must be less than 6.  ")).toBe("The remainder must be less than 6.");
    for (const bad of ["", "   ", null, undefined, "x = \\frac{1}{2}", "Try $x$", "a^2", "= 7", "x".repeat(141)]) expect(kidNote(bad), String(bad)).toBeNull();
  });
});
