/**
 * "Now you try": `variantOf` gives a problem like the one the student just saw — the same form, new
 * numbers, a clean answer that is not the original's — and the engine has checked it as
 * `write_problems` will. Held to the starters (`courses.ts`), the chat prompt's examples and problems
 * as Mathpix reads a student's writing.
 *
 * The search stops starting engine work once its time budget is spent, so its result depends on the
 * machine's speed; the corpus runs through `findVariant` with a still clock (what an idle machine
 * finds, whatever the load on the test runner), and `variantOf` itself — the real clock — is held to
 * what holds at any speed.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { PROBLEM_GRID } from "@/lib/live/chat/layout";
import { answerOf, isCleanAnswer, verifyProblem } from "@/lib/live/chat/verify";
import type { LiveEngine } from "@/lib/live/contracts";
import { getEngine } from "@/lib/live/engine";
import { planHandwriting } from "@/lib/live/handwriting";
import { localSolve } from "@/lib/live/localSolve";
import { STARTER_PROBLEMS } from "@/lib/onboarding/courses";
import type { PracticeProblem } from "../contracts";
import { looseSkeleton, skeletonOf, tidy } from "../generators/shape";
import { answerKey, answerShape, findVariant, VARIANT_LIMITS } from "../generators/variant";
import { practiceProblems, variantOf } from "../practice";

// the engine works every problem: generous limits for a busy test runner (as `oracle.test.ts`)
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
  // the first search learns the generators' forms; time it apart from the searches
  findVariant(engine, ["1 + 1"], 1, { fallback: () => [], now: () => 0 });
});

const canDraw = (lines: readonly string[]) => planHandwriting(lines, { size: PROBLEM_GRID.size, seed: 1 }).unsupported.length === 0;
const still = () => 0;

const STARTERS: PracticeProblem[] = Object.values(STARTER_PROBLEMS).flatMap((list) => list.map((s) => [...s.lines]));

/** The problem-format examples of the chat prompt (rule 3 and its EXAMPLES), and its eval's sets. */
const CHAT_EXAMPLES: PracticeProblem[] = [
  ["3x + 4 = 19"],
  ["\\frac{x}{2} - 5 = 1"],
  ["7 - 2x = 13"],
  ["2x + 3 = 11"],
  ["x^{2} - 5x + 6 = 0"],
  ["3 - 2x > 7"],
  ["|x - 3| = 5"],
  ["\\sqrt{x + 3} = 5"],
  ["2^{x + 1} = 16"],
  ["\\log_{2}(x) = 5"],
  ["x^{2} + 5x + 6"],
  ["(x + 3)^{2}"],
  ["4(2x - 1) - 3x"],
  ["\\frac{12x^{5}}{3x^{2}}"],
  ["(3 + 2i)(1 - i)"],
  ["\\frac{3}{4} + \\frac{1}{6}"],
  ["\\frac{d}{dx}(x^{3} + 2x)"],
  ["\\int (3x^{2} + 1) \\, dx"],
  ["\\int_{0}^{2} x^{2} \\, dx"],
  ["\\lim_{x \\to 2} \\frac{x^{2} - 4}{x - 2}"],
  ["2\\cos x - 1 = 0, \\ 0 \\le x < 2\\pi"],
  ["3^{2} + 4^{2} = c^{2}"],
  ["x + 40 + 65 = 180"],
  ["x + y = 10", "x - y = 2"],
  ["5x - 4 = 16"],
  ["\\frac{x}{3} + 2 = 7"],
  ["2\\cos x = 1, 0^{\\circ} \\le x < 360^{\\circ}"],
  ["\\tan x = \\sqrt{3}, 0^{\\circ} \\le x < 360^{\\circ}"],
  ["\\sin x = -\\frac{1}{2}, 0^{\\circ} \\le x < 360^{\\circ}"],
];

/** Problems as Mathpix reads a student's handwriting. */
const STUDENT_READS: PracticeProblem[] = [
  ["2x+3=11"],
  ["x^2-5x+6=0"],
  ["3 x+4=19"],
  ["\\left(x+3\\right)\\left(x+2\\right)"],
  ["2 x^{2}+3 x-2=0"],
  ["\\sqrt{x+3}=5"],
  ["y=2 x+1", "3 x+y=11"],
  ["12+7"],
  ["8 \\times 7"],
  ["\\frac{3}{4}-\\frac{1}{3}"],
  ["5 x-3=2 x+9"],
  ["2(x-1)+3=11"],
  ["x^{2}=49"],
  ["\\frac{d}{d x}\\left(x^{4}\\right)"],
  ["4.5+2.3"],
  ["-3+8"],
  ["3^{4}"],
  ["x+7=12"],
  ["6 x=42"],
  ["2 \\sin x=1"],
  ["\\log _{3} 81"],
  ["(x-3)^{2}=16"],
  ["\\frac{x^{2}-9}{x-3}"],
  ["3 x+2 y-x+5 y"],
  ["f(x)=3 x-2", "f(4)"],
  ["f(x)=2 x+5", "f(3)="],
  ["\\frac{2}{3}+\\frac{1}{4}="],
  ["7 \\times 8=?"],
];

const TRIG_EQUATION = /\\(?:sin|cos|tan)[\s\S]*=/;

/** Everything a variant promises, against its original. */
function expectVariant(original: PracticeProblem, variant: PracticeProblem | null): void {
  const label = original.join("; ");
  expect(variant, label).not.toBeNull();
  if (!variant) return;
  // a trailing `=` (`\frac{2}{3} + \frac{1}{4} =`) asks for the value: the problem is the expression
  const tidied = original.map((l) => tidy(l.replace(/\s*=\s*\??$/, "")));
  expect(variant.join("; "), label).not.toBe(tidied.join("; "));
  // the board will write it: the engine reads and solves it, the hand writes it
  const verdict = verifyProblem(engine, variant, canDraw);
  expect(verdict.ok, `${label} → ${variant.join("; ")}`).toBe(true);
  // the same form (its signs may differ)
  expect(looseSkeleton(skeletonOf(variant.map(tidy))), `${label} → ${variant.join("; ")}`).toBe(looseSkeleton(skeletonOf(tidied)));
  // a clean answer of the same kind, and a different one
  const was = localSolve(engine, tidied).steps;
  const now = localSolve(engine, variant).steps;
  const answer = answerOf(now);
  expect(isCleanAnswer(answer), `${variant.join("; ")} → ${answer}`).toBe(true);
  expect(answerKey(now), `${label} → ${variant.join("; ")}`).not.toBe(answerKey(was));
  if (!TRIG_EQUATION.test(label)) expect(answerShape(answer), `${label} → ${variant.join("; ")}: ${answer} for ${answerOf(was)}`).toBe(answerShape(answerOf(was)));
}

describe.each([
  ["the starters", STARTERS],
  ["the chat's examples", CHAT_EXAMPLES],
  ["a student's reads", STUDENT_READS],
])("a variant of %s", (_, corpus) => {
  it.each(corpus.map((p) => [p.join("; "), p] as const))("%s", (_label, problem) => {
    for (const seed of [1, 2]) expectVariant(problem, findVariant(engine, problem, seed, { fallback: () => [], now: still }));
  });
});

describe("variantOf", () => {
  it("is the same for the same seed, and usually different for another", () => {
    let differ = 0;
    for (const p of STARTERS) {
      const a = findVariant(engine, p, 11, { fallback: () => [], now: still });
      expect(findVariant(engine, p, 11, { fallback: () => [], now: still })).toEqual(a);
      if (JSON.stringify(findVariant(engine, p, 12, { fallback: () => [], now: still })) !== JSON.stringify(a)) differ++;
    }
    expect(differ).toBeGreaterThanOrEqual(STARTERS.length - 3);
  });

  it("with the real clock: a variant for the starters, each one checked", () => {
    let found = 0;
    for (const p of STARTERS) {
      const v = variantOf(engine, p, 3);
      if (!v) continue;
      found++;
      expect(verifyProblem(engine, v, canDraw).ok, v.join("; ")).toBe(true);
      expect(answerKey(localSolve(engine, v).steps)).not.toBe(answerKey(localSolve(engine, p).steps));
    }
    // a loaded machine may run out of time on one or two; an idle one finds every one
    expect(found).toBeGreaterThanOrEqual(STARTERS.length - 2);
  });

  it("is fast: the median search well under 100 ms, none past the cap by more than an engine call", () => {
    const times: number[] = [];
    for (const p of [...STARTERS, ...CHAT_EXAMPLES.slice(0, 16)]) {
      const t = performance.now();
      variantOf(engine, p, 5);
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    expect(times[Math.floor(times.length / 2)]).toBeLessThan(100);
    expect(times[times.length - 1]).toBeLessThan(VARIANT_LIMITS.capMs + 400);
  });

  it("never throws, and gives null when there is nothing like the problem", () => {
    const odd: unknown[] = [[], [""], ["   "], ["hello there"], ["x = 4"], ["2x + 3y = 12"], ["\\frac{"], ["}{"], ["x".repeat(400)], ["1", "2", "3", "4"], [null], [42], "2x + 3 = 11", null, undefined, [["2x + 3 = 11"]], ["\\text{solve } 2x = 4"], ["2x+3=11", ""]];
    for (const p of odd) {
      let v: PracticeProblem | null = null;
      expect(() => (v = variantOf(engine, p as PracticeProblem, 1)), JSON.stringify(p)).not.toThrow();
      if (v) expect(verifyProblem(engine, v, canDraw).ok, JSON.stringify(p)).toBe(true);
    }
    for (const p of [[], [""], ["hello there"], ["x = 4"], ["2x + 3y = 12"]]) expect(variantOf(engine, p, 1), JSON.stringify(p)).toBeNull();
    // a stray empty line is not part of the problem
    expect(variantOf(engine, ["2x+3=11", ""], 1)).not.toBeNull();
  });

  it("falls back to the skill's practice problems when the problem itself gives nothing", () => {
    const fallback = practiceProblems("two_step_equations", 3, 9);
    // nothing to vary in `x = 4`: the first practice problem, checked
    expect(findVariant(engine, ["x = 4"], 9, { fallback: () => fallback, now: still })).toEqual(fallback[0]);
    // never the problem itself
    expect(findVariant(engine, fallback[0], 9, { fallback: () => fallback, now: still })).not.toEqual(fallback[0]);
    // nothing at all: null
    expect(findVariant(engine, ["x = 4"], 9, { fallback: () => [], now: still })).toBeNull();
    // a fallback that throws is no fallback
    expect(
      findVariant(engine, ["x = 4"], 9, {
        fallback: () => {
          throw new Error("no");
        },
        now: still,
      }),
    ).toBeNull();
  });

  it("past the time cap, gives the fallback unchecked rather than nothing", () => {
    let t = 0;
    const late = () => (t += VARIANT_LIMITS.capMs);
    const fallback = practiceProblems("quadratic_equations", 2, 4);
    expect(findVariant(engine, ["x^{2} - 5x + 6 = 0"], 4, { fallback: () => fallback, now: late })).toEqual(fallback[0]);
  });
});
