/**
 * The starter problems: every one is a problem the board chat's executor would write (the engine
 * reads it and `localSolve` — the very function Solve uses — answers it; the hand can write it),
 * and the first step the coach mark nudges towards gets a tick under it in Feedback, while a wrong
 * one gets a ring. This is the unit-level promise behind "the tutor writes one verified problem";
 * `starters.board.test.ts` keeps the same promise on a live board.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { LiveEngine } from "@/lib/live/contracts";
import { getEngine } from "@/lib/live/engine";
import { answerOf, hasWords, isCleanAnswer, verifyProblem } from "@/lib/live/chat/verify";
import { WriteProblemsSchema } from "@/lib/live/chat/contracts";
import { PROBLEM_GRID } from "@/lib/live/chat/layout";
import { planHandwriting } from "@/lib/live/handwriting";
import { analyzeColumn, localSolve } from "@/lib/live/localSolve";
import { badgeFor } from "@/lib/live/policy";
import { problemSteps } from "@/lib/live/chat/work";
import { normalizeStep } from "@/lib/live/liveLoop";
import { GRADE_IDS, GRADE_PATHS, K8_SKILLS } from "@/lib/learning/grades";
import { COURSE_IDS, isCourseId } from "../courseIds";
import { COURSES, GRADE_STARTERS, STARTER_PROBLEMS, starterBoardTitle, starterIndex, startersFor } from "../courses";

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

const ALL = [
  ...COURSE_IDS.flatMap((course) => STARTER_PROBLEMS[course].map((p, i) => ({ set: course as string, i, ...p }))),
  ...GRADE_IDS.flatMap((grade) => GRADE_STARTERS[grade].map((p, i) => ({ set: `grade ${grade}`, i, ...p }))),
];

/** A step that does not follow from the problem (a sign or a number slipped). */
const WRONG_STEP: Record<string, string> = {
  "2x + 3 = 11": "2x = 14",
  "5x - 4 = 21": "5x = 17",
  "3(x + 2) = 18": "3x + 2 = 18",
  "3^{2} + 4^{2} = c^{2}": "6 + 8 = c^{2}",
  "6^{2} + 8^{2} = c^{2}": "12 + 16 = c^{2}",
  "x + 65^{\\circ} = 180^{\\circ}": "x = 125^{\\circ}",
  "x^{2} - 5x + 6 = 0": "(x - 1)(x - 6) = 0",
  "\\sqrt{x + 3} = 5": "x + 3 = 10",
  "2^{x} = 32": "2^{x} = 2^{4}",
  "\\log_{2} x = 5": "x = 5^{2}",
  "3^{x - 1} = 27": "3^{x - 1} = 3^{2}",
  "2\\sin x = 1": "\\sin x = 2",
  "4x - 7 = 13": "4x = 6",
  "\\frac{3}{4} + \\frac{1}{6}": "= \\frac{4}{10}",
  "2(x - 1) = 10": "x - 1 = 8",
  // the grades: a young student's slip is a number off by one, or the tops and bottoms both added
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
  "x + 7 = 15": "x = 22",
  "3x = 24": "x = 21",
  "\\frac{3}{4} \\div \\frac{1}{2}": "\\frac{3}{8}",
  "2x + 5 = 17": "2x = 22",
  "3x - 4 = 11": "3x = 7",
  "\\frac{x}{4} = \\frac{9}{12}": "x = 4",
  "5x - 3 = 2x + 9": "7x = 12",
  "2(x + 3) = 14": "x + 3 = 12",
  "3x + 4 = x + 10": "4x + 4 = 10",
};

/** Maths with digits and no letters (as `isArithmetic` in liveLoop.ts): a sum, a product, fractions. */
function isArithmetic(latex: string): boolean {
  const bare = latex.replace(/\\(?:frac|dfrac|tfrac|times|div|cdot|left|right|quad|qquad|,|;|:|!)/g, " ");
  return /\d/.test(bare) && !/[a-zA-Z\\]/.test(bare);
}

/** A number alone, as a young student writes an answer (`BARE_NUMBER` in liveLoop.ts, without the `=`). */
const BARE = /^\s*-?\s*(?:\d+(?:\.\d+)?|\\frac\s*\{\s*\d+\s*\}\s*\{\s*\d+\s*\}|\d+\s*\/\s*\d+)\s*$/;

/**
 * The line as the board judges it under the problem: under a sum, a number alone is the answer and
 * is judged as `= 7` (`bareAnswer`, `LiveLoop.analyze`; held on a live board in
 * `starters.board.test.ts` and `liveLoop.problems.test.ts`). Every other line as written.
 */
function asJudged(lines: readonly string[], step: string): string {
  return lines.every(isArithmetic) && BARE.test(step) ? `= ${step.trim()}` : step;
}

function badgeUnder(lines: readonly string[], step: string) {
  const analysis = analyzeColumn(engine, [...lines, asJudged(lines, step)], "feedback").at(-1) ?? null;
  return badgeFor("feedback", analysis);
}

describe("courses", () => {
  it("has the five courses of the welcome, in order, each with a label and a blurb", () => {
    expect(COURSES.map((c) => c.id)).toEqual(["algebra1", "geometry", "algebra2", "precalc_calc", "other"]);
    expect(COURSES.map((c) => c.label)).toEqual(["Algebra 1", "Geometry", "Algebra 2", "Pre-calculus / Calculus", "Something else"]);
    for (const c of COURSES) expect(c.blurb.length).toBeGreaterThan(0);
  });

  it("matches the database's course check (migration 20260928100000_onboarding.sql)", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync(new URL("../../../../supabase/migrations/20260928100000_onboarding.sql", import.meta.url), "utf8");
    const check = sql.match(/course in \(([^)]*)\)/);
    expect(check).not.toBeNull();
    const ids = [...(check?.[1] ?? "").matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(ids).toEqual([...COURSE_IDS]);
  });

  it("recognises course ids and nothing else", () => {
    for (const id of COURSE_IDS) expect(isCourseId(id)).toBe(true);
    for (const v of ["", "calculus", "Algebra 1", null, undefined, 3]) expect(isCourseId(v)).toBe(false);
  });

  it("gives every course and every grade a small curated set", () => {
    for (const id of COURSE_IDS) {
      expect(STARTER_PROBLEMS[id].length, id).toBeGreaterThanOrEqual(2);
      expect(STARTER_PROBLEMS[id].length, id).toBeLessThanOrEqual(4);
    }
    for (const g of GRADE_IDS) {
      expect(GRADE_STARTERS[g].length, `grade ${g}`).toBeGreaterThanOrEqual(2);
      expect(GRADE_STARTERS[g].length, `grade ${g}`).toBeLessThanOrEqual(4);
    }
  });

  it("starts each grade on a skill of its own path", () => {
    for (const g of GRADE_IDS) {
      for (const s of GRADE_STARTERS[g]) expect(GRADE_PATHS[g], `${s.lines.join("; ")} in grade ${g}`).toContain(s.skill);
    }
  });

  it("keeps the youngest on sums: no letters before 6th grade", () => {
    for (const g of [0, 1, 2, 3, 4, 5] as const) {
      for (const s of GRADE_STARTERS[g]) expect(s.lines.every(isArithmetic), s.lines.join("; ")).toBe(true);
    }
  });
});

describe.each(ALL)("starter $set #$i: $lines", ({ lines, firstStep, hint, oneStep }) => {
  it("is a valid write_problems action (no words, no $)", () => {
    expect(WriteProblemsSchema.safeParse({ type: "write_problems", problems: [[...lines]] }).success).toBe(true);
    expect(lines.some(hasWords)).toBe(false);
  });

  it("is verified by the engine, and localSolve answers it with a clean answer", () => {
    const verdict = verifyProblem(engine, lines);
    expect(verdict.ok).toBe(true);
    const solved = localSolve(engine, [...lines]);
    expect(solved.source).not.toBeNull();
    expect(solved.steps.length).toBeGreaterThan(0);
    if (verdict.ok) expect(isCleanAnswer(answerOf(verdict.steps))).toBe(true);
  });

  it("is written by the tutor's hand at the problem size (nothing it cannot draw)", () => {
    const { plan, unsupported } = planHandwriting([...lines], { size: PROBLEM_GRID.size, seed: 1 });
    expect(plan).not.toBeNull();
    expect(unsupported).toEqual([]);
  });

  it("ticks the first step under it in Feedback", () => {
    expect(["ok", "solved"]).toContain(badgeUnder(lines, firstStep));
  });

  it("says whether the first step is the answer (oneStep), as the engine solves it", () => {
    const solution = localSolve(engine, [...lines]).steps;
    const isAnswer = normalizeStep(asJudged(lines, firstStep)) === normalizeStep(answerOf(solution));
    expect(Boolean(oneStep)).toBe(isAnswer);
  });

  it("makes coach mark 2 true: Suggest writes a first step the engine ticks under it, Solve has a solution to write", () => {
    const solution = localSolve(engine, [...lines]).steps;
    const ticked = (step: string) => {
      const a = analyzeColumn(engine, [...lines, step], "feedback").at(-1) ?? null;
      // the interval written again is ticked, but it is not a step (as the loop's `problemStepsFor`)
      return !(a?.domain && !a.math) && ["ok", "solved"].includes(badgeFor("feedback", a));
    };
    const [step] = problemSteps({ solution, head: lines, written: [], depth: "step", normalize: normalizeStep, ticked });
    expect(step, "a first step").toBeTruthy();
    expect(ticked(step)).toBe(true);
    expect(problemSteps({ solution, head: lines, written: [], depth: "solve", normalize: normalizeStep }).length).toBeGreaterThan(0);
  });

  it("rings a wrong first step", () => {
    const wrong = WRONG_STEP[lines.join("; ")];
    expect(wrong, "a wrong step for this starter").toBeTruthy();
    expect(badgeUnder(lines, wrong)).toBe("warn");
  });

  it("has a short hint in words for the coach mark", () => {
    expect(hint.length).toBeGreaterThan(8);
    expect(hint.length).toBeLessThan(60);
    expect(hint).not.toMatch(/\\|\$/);
  });
});

describe("which starter a student gets", () => {
  it("is stable for one student and within the course's list", () => {
    for (const id of COURSE_IDS) {
      const a = starterIndex(id, "user-1");
      expect(starterIndex(id, "user-1")).toBe(a);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(STARTER_PROBLEMS[id].length);
    }
  });

  it("is stable within the grade's list when the student has a grade", () => {
    for (const g of GRADE_IDS) {
      const a = starterIndex("other", "user-1", g);
      expect(starterIndex("other", "user-1", g)).toBe(a);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(GRADE_STARTERS[g].length);
    }
  });

  it("spreads students over the whole set", () => {
    const seen = new Set<number>();
    const kids = new Set<number>();
    for (let i = 0; i < 60; i++) {
      const id = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
      seen.add(starterIndex("algebra1", id));
      kids.add(starterIndex("other", id, 0));
    }
    expect(seen.size).toBe(STARTER_PROBLEMS.algebra1.length);
    expect(kids.size).toBe(GRADE_STARTERS[0].length);
  });

  it("tries the student's own starter first, then the rest of the course as fallbacks", () => {
    const list = STARTER_PROBLEMS.geometry;
    expect(startersFor("geometry", 1)).toEqual([list[1], list[2], list[0]]);
    expect(startersFor("geometry", 0)).toEqual([...list]);
    expect(startersFor("geometry", 4)).toEqual([list[1], list[2], list[0]]);
    expect(startersFor("geometry", -1)).toEqual([list[2], list[0], list[1]]);
  });

  it("uses the grade's starters when there is a grade, whatever the course says", () => {
    const k = GRADE_STARTERS[0];
    expect(startersFor("other", 1, 0)).toEqual([k[1], k[2], k[0]]);
    expect(startersFor(null, 0, 4)).toEqual([...GRADE_STARTERS[4]]);
    expect(startersFor("algebra1", 0, 2)).toEqual([...GRADE_STARTERS[2]]);
    // a marker with a garbled grade falls back to the course
    expect(startersFor("geometry", 0, 12)).toEqual([...STARTER_PROBLEMS.geometry]);
    expect(startersFor("geometry", 0, null)).toEqual([...STARTER_PROBLEMS.geometry]);
  });

  it("falls back to 'Something else' without a known course or grade", () => {
    expect(startersFor(null, 0)).toEqual([...STARTER_PROBLEMS.other]);
    expect(startersFor("astrology", 0)).toEqual([...STARTER_PROBLEMS.other]);
    expect(startersFor(undefined, 0, undefined)).toEqual([...STARTER_PROBLEMS.other]);
  });
});

describe("the first board's name", () => {
  it("is the K–8 skill's name for a grade's starter", () => {
    expect(starterBoardTitle(GRADE_STARTERS[0][0])).toBe("Adding to 10");
    expect(starterBoardTitle(GRADE_STARTERS[2][0])).toBe(K8_SKILLS.add_within_100.name);
    for (const g of GRADE_IDS) {
      for (const s of GRADE_STARTERS[g]) {
        const title = starterBoardTitle(s);
        if (title !== null) expect(title.length).toBeLessThanOrEqual(40);
      }
    }
  });

  it("is null (named from the problem) for a high-school skill or a course's starter", () => {
    expect(starterBoardTitle(GRADE_STARTERS[6][0])).toBeNull();
    expect(starterBoardTitle(STARTER_PROBLEMS.algebra1[0])).toBeNull();
    expect(starterBoardTitle(null)).toBeNull();
  });
});
