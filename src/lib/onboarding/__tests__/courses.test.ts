/**
 * The starter problems: every one is a problem the board chat's executor would write (the engine
 * reads it and `localSolve` — the very function Solve uses — answers it; the hand can write it),
 * and the first step the coach mark nudges towards gets a tick under it in Feedback, while a wrong
 * one gets a ring. This is the unit-level promise behind "the tutor writes one verified problem".
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
import { COURSE_IDS, COURSES, isCourseId, STARTER_PROBLEMS, starterIndex, startersFor } from "../courses";

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

const ALL = COURSE_IDS.flatMap((course) => STARTER_PROBLEMS[course].map((p, i) => ({ course, i, ...p })));

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
};

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

  it("gives every course a small curated set", () => {
    for (const id of COURSE_IDS) {
      expect(STARTER_PROBLEMS[id].length, id).toBeGreaterThanOrEqual(2);
      expect(STARTER_PROBLEMS[id].length, id).toBeLessThanOrEqual(4);
    }
  });
});

describe.each(ALL)("starter $course #$i: $lines", ({ lines, firstStep, hint }) => {
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
    const analysis = analyzeColumn(engine, [...lines, firstStep], "feedback").at(-1) ?? null;
    expect(["ok", "solved"]).toContain(badgeFor("feedback", analysis));
  });

  it("rings a wrong first step", () => {
    const wrong = WRONG_STEP[lines.join("; ")];
    expect(wrong, "a wrong step for this starter").toBeTruthy();
    const analysis = analyzeColumn(engine, [...lines, wrong], "feedback").at(-1) ?? null;
    expect(badgeFor("feedback", analysis)).toBe("warn");
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

  it("spreads students over the whole set", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 60; i++) seen.add(starterIndex("algebra1", `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`));
    expect(seen.size).toBe(STARTER_PROBLEMS.algebra1.length);
  });

  it("tries the student's own starter first, then the rest of the course as fallbacks", () => {
    const list = STARTER_PROBLEMS.geometry;
    expect(startersFor("geometry", 1)).toEqual([list[1], list[2], list[0]]);
    expect(startersFor("geometry", 0)).toEqual([...list]);
    expect(startersFor("geometry", 4)).toEqual([list[1], list[2], list[0]]);
    expect(startersFor("geometry", -1)).toEqual([list[2], list[0], list[1]]);
  });

  it("falls back to 'Something else' without a known course", () => {
    expect(startersFor(null, 0)).toEqual([...STARTER_PROBLEMS.other]);
    expect(startersFor("astrology", 0)).toEqual([...STARTER_PROBLEMS.other]);
  });
});
