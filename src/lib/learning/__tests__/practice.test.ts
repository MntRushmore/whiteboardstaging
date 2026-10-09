/**
 * Practice problems are free and instant — no model, no engine when they are made — so every
 * generator is held to the engine here, as `courses.test.ts` holds the starters: every problem is
 * one the board chat's `write_problems` writes (`verifyProblem`: the engine reads it, nothing on it
 * is false, `localSolve` — the very function Solve uses — answers it, the hand can write it), its
 * answer is clean, and where the engine marks a student's working (one-line problems outside
 * derivatives and indefinite integrals) a first step gets a tick under it in Feedback.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { WriteProblemsSchema } from "@/lib/live/chat/contracts";
import { PROBLEM_GRID } from "@/lib/live/chat/layout";
import { answerOf, hasWords, isCleanAnswer, verifyProblem } from "@/lib/live/chat/verify";
import { problemSteps } from "@/lib/live/chat/work";
import type { LiveEngine } from "@/lib/live/contracts";
import { getEngine } from "@/lib/live/engine";
import { planHandwriting } from "@/lib/live/handwriting";
import { normalizeStep } from "@/lib/live/liveLoop";
import { analyzeColumn, localSolve } from "@/lib/live/localSolve";
import { badgeFor } from "@/lib/live/policy";
import { FINER_SKILLS, isCoarseSkillId, SKILLS, type SkillId } from "../contracts";
import { MAX_PRACTICE } from "../generators";
import { looseSkeleton, skeletonOf } from "../generators/shape";
import { gradeOfSkill, K8_SKILL_IDS, type K8SkillId } from "../grades";
import { hasPractice, practiceProblems } from "../practice";
import { classifyProblem } from "../skills";

// the engine works every problem: generous limits for a busy test runner (as `oracle.test.ts`)
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

const PRACTISED = SKILLS.map((s) => s.id).filter(hasPractice);
/** Seeds and batch size the engine checks (the total is kept to a few hundred problems). */
const SEEDS = [1, 2, 3];
const COUNT = 4;

const canDraw = (lines: readonly string[]) => planHandwriting(lines, { size: PROBLEM_GRID.size, seed: 1 }).unsupported.length === 0;

/** Problems whose working the engine marks line by line in Feedback. */
function marked(p: readonly string[]): boolean {
  return p.length === 1 && !/\\frac\{d\}\{dx\}|\\int(?!_)/.test(p[0]);
}

/** What each skill's answers look like (the engine's last line), where a skill has one shape of answer. */
const WHOLE: ReadonlySet<SkillId> = new Set<SkillId>([
  "add_subtract",
  "multiply_divide",
  "order_of_operations",
  "powers_roots",
  ...FINER_SKILLS.add_subtract,
  ...FINER_SKILLS.multiply_divide,
]);
const FRACTION: ReadonlySet<SkillId> = new Set<SkillId>(["fractions", ...FINER_SKILLS.fractions]);
const DECIMAL: ReadonlySet<SkillId> = new Set<SkillId>(["decimals_add_subtract", "decimals_multiply"]);

/** Skills whose problems all have one shape (`a ÷ b`, `a × b`, `a/b`): their forms differ in their numbers only. */
const ONE_SHAPE: ReadonlySet<SkillId> = new Set<SkillId>(["division_facts", "multiply_by_tens", "multiply_multi_digit", "long_division", "equivalent_fractions"]);

describe("which skills have practice", () => {
  it("every skill but word problems, proofs and chemistry (words or a reaction on the board) and other", () => {
    const without = SKILLS.map((s) => s.id).filter((id) => !hasPractice(id));
    expect(without).toEqual(["word_problems", "proofs", "chemistry", "other"]);
    expect(PRACTISED.length).toBe(SKILLS.length - 4);
  });

  it("hasPractice is exactly the skills practiceProblems makes problems for", () => {
    for (const s of SKILLS) expect(practiceProblems(s.id, 3, 1).length > 0, s.id).toBe(hasPractice(s.id));
    for (const v of ["", "nope", "toString", "__proto__", "constructor", "Two_Step_Equations"]) expect(hasPractice(v)).toBe(false);
    expect(hasPractice(undefined as unknown as string)).toBe(false);
    expect(practiceProblems("nope" as SkillId, 3, 1)).toEqual([]);
  });
});

describe("a batch of practice problems", () => {
  it("is `count` different problems, the same for the same seed and different for another", () => {
    for (const skill of PRACTISED) {
      const a = practiceProblems(skill, 8, 42);
      expect(a.length, skill).toBe(8);
      expect(new Set(a.map((p) => p.join("; "))).size, skill).toBe(8);
      expect(practiceProblems(skill, 8, 42), skill).toEqual(a);
      expect(practiceProblems(skill, 8, 43), skill).not.toEqual(a);
      // a shorter batch from the same seed is the start of the longer one
      expect(practiceProblems(skill, 3, 42), skill).toEqual(a.slice(0, 3));
    }
  });

  it("takes any count and seed", () => {
    expect(practiceProblems("two_step_equations", 0, 1)).toEqual([]);
    expect(practiceProblems("two_step_equations", -3, 1)).toEqual([]);
    expect(practiceProblems("two_step_equations", Number.NaN, 1)).toEqual([]);
    expect(practiceProblems("two_step_equations", 2.7, 1)).toHaveLength(2);
    expect(practiceProblems("two_step_equations", 1000, 1)).toHaveLength(MAX_PRACTICE);
    for (const seed of [0, -1, 0.5, 1e15, Number.NaN, Number.POSITIVE_INFINITY]) expect(practiceProblems("fractions", 2, seed)).toHaveLength(2);
  });

  it("varies in form: consecutive problems come from different forms", () => {
    for (const skill of PRACTISED.filter((s) => !ONE_SHAPE.has(s))) {
      const shapes = new Set(practiceProblems(skill, 6, 7).map((p) => looseSkeleton(skeletonOf(p))));
      expect(shapes.size, skill).toBeGreaterThanOrEqual(2);
    }
    // one shape, but a range of sizes: a fact, then bigger numbers
    for (const skill of ONE_SHAPE) {
      const sizes = new Set(practiceProblems(skill, 6, 7).map((p) => (p[0].match(/\d/g) ?? []).length));
      expect(sizes.size, skill).toBeGreaterThanOrEqual(2);
    }
    // the example of the brief: ax + b = c, x/a − b = c and b − ax = c all come up
    const two = practiceProblems("two_step_equations", 12, 1).map((p) => p[0]);
    expect(two.some((p) => /^\d+x [+-] \d+ = -?\d+$/.test(p))).toBe(true);
    expect(two.some((p) => /^\\frac\{x\}\{\d+\} [+-] \d+ = -?\d+$/.test(p))).toBe(true);
    expect(two.some((p) => /^\d+ - \d+x = -?\d+$/.test(p))).toBe(true);
  });

  it("is a valid write_problems action: maths only, a system as its 2 lines", () => {
    for (const skill of PRACTISED) {
      const batch = practiceProblems(skill, 12, 3);
      expect(WriteProblemsSchema.safeParse({ type: "write_problems", problems: batch }).success, skill).toBe(true);
      for (const p of batch) {
        expect(p.some(hasWords), p.join("; ")).toBe(false);
        expect(p.join(" "), p.join("; ")).not.toMatch(/\$|\\text/);
        expect(p.length).toBe(skill === "systems" ? 2 : p.length);
      }
    }
    for (const p of practiceProblems("systems", 6, 1)) expect(p).toHaveLength(2);
  });

  it("keeps the youngest students' numbers small and whole, with negatives only where they belong", () => {
    const young: SkillId[] = ["add_subtract", "multiply_divide", "order_of_operations", "powers_roots"];
    for (const skill of young) {
      for (const p of practiceProblems(skill, 24, 5)) {
        const text = p.join(" ");
        // no negative number anywhere (a minus is only ever a take-away)
        expect(text, text).not.toMatch(/(^|[(=]\s*|[+\-×÷]\s+)-\d/);
        for (const n of text.match(/\d+/g) ?? []) expect(Number(n), text).toBeLessThanOrEqual(skill === "add_subtract" ? 99 : 300);
      }
    }
    // a one-step equation for a young student: whole numbers under 100
    for (const p of practiceProblems("one_step_equations", 12, 5)) for (const n of p[0].match(/\d+/g) ?? []) expect(Number(n)).toBeLessThan(100);
  });
});

describe("the K–8 path's problems: numbers right for the grade", () => {
  const batch = (skill: K8SkillId) => [1, 2, 3, 4].flatMap((seed) => practiceProblems(skill, 24, seed)).map((p) => p.join(" "));
  const numbers = (text: string) => (text.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
  /** `a ÷ b` as its two numbers */
  const quotient = (text: string) => /^(\d+) \\div (\d+)$/.exec(text)!.slice(1).map(Number);

  it("never a negative number, and no unknown before 6th grade", () => {
    for (const skill of K8_SKILL_IDS) {
      for (const text of batch(skill)) {
        expect(text, `${skill}: ${text}`).not.toMatch(/(^|[(=]\s*|[+\-×÷]\s+|\\(?:times|div) )-\d/);
        if ((gradeOfSkill(skill) ?? 9) <= 5) expect(text.replace(/\\[a-z]+/g, ""), `${skill}: ${text}`).not.toMatch(/[a-z]/i);
      }
    }
  });

  it("Kindergarten: everything up to 10; 1st grade: facts to 20", () => {
    for (const text of [...batch("add_within_10"), ...batch("subtract_within_10")]) {
      for (const n of numbers(text)) expect(n, text).toBeLessThanOrEqual(10);
      expect(classifyProblem([text]), text).toMatch(/_within_10$/);
    }
    for (const text of [...batch("add_within_20"), ...batch("subtract_within_20")]) for (const n of numbers(text)) expect(n, text).toBeLessThanOrEqual(20);
    for (const text of batch("add_tens")) expect(numbers(text).filter((n) => n % 10 !== 0).length, text).toBeLessThanOrEqual(1);
  });

  it("times tables 2–12; division facts and long division come out whole", () => {
    for (const text of batch("times_tables")) for (const n of numbers(text)) expect(n >= 2 && n <= 12, text).toBe(true);
    for (const text of batch("division_facts")) {
      const [a, b] = quotient(text);
      expect(a % b === 0 && b >= 2 && b <= 12 && a / b >= 2 && a / b <= 12, text).toBe(true);
    }
    for (const text of batch("long_division")) {
      const [a, b] = quotient(text);
      // a 2- or 3-digit number over a 1-digit one, no remainder, more than a fact
      expect(a >= 10 && a <= 999 && b >= 2 && b <= 9 && a % b === 0 && a / b > 12, text).toBe(true);
    }
  });

  it("fractions over small denominators; decimals with 1–2 places; percents of friendly numbers", () => {
    for (const skill of FINER_SKILLS.fractions) {
      for (const text of batch(skill as K8SkillId)) for (const m of text.matchAll(/\\frac\{\d+\}\{(\d+)\}/g)) expect(Number(m[1]), text).toBeLessThanOrEqual(skill === "equivalent_fractions" ? 60 : 12);
    }
    for (const skill of ["decimals_add_subtract", "decimals_multiply"] as const) for (const text of batch(skill)) expect(text, text).not.toMatch(/\.\d{3}/);
    for (const text of batch("percents")) {
      // the percent is a friendly one, or the unknown (`x\%`)
      const p = /(\d+)\\%/.exec(text)?.[1];
      if (p !== undefined) expect([5, 10, 15, 20, 25, 30, 40, 50, 60, 75, 80], text).toContain(Number(p));
      else expect(text, text).toMatch(/^x\\%/);
      for (const n of numbers(text)) expect(n, text).toBeLessThanOrEqual(400);
    }
  });
});

describe.each(PRACTISED)("practice: %s", (skill) => {
  const problems = SEEDS.flatMap((seed) => practiceProblems(skill, COUNT, seed));

  it("every problem is verified by the engine, written by the hand, and answered cleanly by localSolve", () => {
    expect(problems.length).toBe(SEEDS.length * COUNT);
    for (const p of problems) {
      const label = p.join("; ");
      const verdict = verifyProblem(engine, p, canDraw);
      expect(verdict.ok, `${label}: ${verdict.ok ? "" : verdict.reason}`).toBe(true);
      const { plan, unsupported } = planHandwriting([...p], { size: PROBLEM_GRID.size, seed: 1 });
      expect(plan, label).not.toBeNull();
      expect(unsupported, label).toEqual([]);
      const solved = localSolve(engine, p);
      expect(solved.source, label).not.toBeNull();
      const answer = answerOf(solved.steps);
      expect(isCleanAnswer(answer), `${label} → ${answer}`).toBe(true);
      expect(answer, `${label} → ${answer}`).not.toMatch(/\\ln|\\log|\\approx|\\varnothing|\\emptyset/);
      if (WHOLE.has(skill)) expect(answer, label).toMatch(/^= \d+$/);
      if (FRACTION.has(skill)) expect(answer, label).toMatch(/^= (\d+|\\frac\{\d+\}\{\d+\}|\d+\\frac\{\d+\}\{\d+\})$/);
      if (DECIMAL.has(skill)) expect(answer, label).toMatch(/^= \d+(\.\d{1,2})?$/);
      if (skill === "percents") expect(answer, label).toMatch(/^(= |x = )\d+$/);
      if (skill === "proportions") expect(answer, label).toMatch(/^x = \d+$/);
      // a negative number in it, or one for an answer
      if (skill === "negative_numbers") expect(/(^|[(]|[+-] )-\d/.test(label) || /^= -\d/.test(answer), `${label} → ${answer}`).toBe(true);
    }
  });

  it.runIf(problems.some(marked))("a first step under each problem gets a tick in Feedback", () => {
    for (const p of problems.filter(marked)) {
      const ticked = (step: string) => {
        const a = analyzeColumn(engine, [...p, step], "feedback").at(-1) ?? null;
        // the interval written again is ticked, but it is not a step (as the loop's `problemStepsFor`)
        return !(a?.domain && !a.math) && ["ok", "solved"].includes(badgeFor("feedback", a));
      };
      const solution = localSolve(engine, p).steps;
      const [step] = problemSteps({ solution, head: p, written: [], depth: "step", normalize: normalizeStep, ticked });
      expect(step, p.join("; ")).toBeTruthy();
      expect(ticked(step), `${p.join("; ")} | ${step}`).toBe(true);
    }
  });
});

describe("the classifier files practice under its skill", () => {
  // switches on by itself when the real classifier (agent "brain") replaces the stub
  const stub = classifyProblem(["2x + 3 = 11"]) === "other";
  it.skipIf(stub)("classifyProblem(practiceProblems(skill, …)[i]) is skill (a coarse skill's: it, or one of its finer skills)", () => {
    const wrong: string[] = [];
    const files = (skill: SkillId, got: SkillId) => got === skill || (isCoarseSkillId(skill) && FINER_SKILLS[skill].includes(got));
    for (const skill of PRACTISED) {
      for (const seed of [1, 2]) for (const p of practiceProblems(skill, 8, seed)) if (!files(skill, classifyProblem(p))) wrong.push(`${skill}: ${p.join("; ")} → ${classifyProblem(p)}`);
    }
    expect(wrong).toEqual([]);
  });

  it("every K–8 skill's problems file under exactly that skill, over many seeds", () => {
    const wrong: string[] = [];
    for (const skill of K8_SKILL_IDS) {
      for (const seed of [1, 2, 3, 4, 5, 6]) for (const p of practiceProblems(skill, 24, seed)) if (classifyProblem(p) !== skill) wrong.push(`${skill}: ${p.join("; ")} → ${classifyProblem(p)}`);
    }
    expect(wrong).toEqual([]);
  });
});
