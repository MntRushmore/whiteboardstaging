/**
 * The SAT bank pipeline's pure parts (scripts/sat): the plan, the numeric check, the near-duplicate
 * check, reading the writer's and the solver's replies, the LaTeX clean-ups, and the upsert's plan
 * and SQL. No model is called. And the checked-in bank itself: every live question passes every
 * mechanical check, and the ids are the plan's.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isCorrect } from "@/lib/sat/answer";
import { SatQuestionSchema, type SatQuestion } from "@/lib/sat/contracts";
import { questionIssues } from "@/lib/sat/lint";
import { casCheck, latexToMathjs } from "../../scripts/sat/cas";
import { mathOf, nearDuplicates, shingles, jaccard } from "../../scripts/sat/dedupe";
import { agrees, normalizeLatex, parseJsonObject, toQuestion } from "../../scripts/sat/pipeline";
import { batches, buildPlan, SKILL_QUOTA } from "../../scripts/sat/plan";
import { numberHints, solverPrompt, writerPrompt } from "../../scripts/sat/prompts";
import { bankSql, contentHash, planUpsert } from "../../scripts/sat/upsert";

const ROOT = join(__dirname, "..", "..");
const SAMPLE = JSON.parse(readFileSync(join(ROOT, "docs", "sat", "sample-20.json"), "utf8")) as SatQuestion[];
const BANK = JSON.parse(readFileSync(join(ROOT, "data", "sat", "bank.json"), "utf8")) as SatQuestion[];

describe("the plan", () => {
  const plan = buildPlan();
  it("is 640 slots in the spec's mix, the same every time, with unique ids from 0101", () => {
    expect(plan).toHaveLength(640);
    expect(buildPlan()).toEqual(plan);
    expect(new Set(plan.map((s) => s.id)).size).toBe(640);
    expect(plan.every((s) => /-(0[1-9]\d\d|1\d\d\d)$/.test(s.id) && Number(s.id.slice(-4)) >= 101)).toBe(true);
    const by = (f: (s: (typeof plan)[number]) => string) => plan.reduce<Record<string, number>>((m, s) => ((m[f(s)] = (m[f(s)] ?? 0) + 1), m), {});
    expect(by((s) => s.domain)).toEqual({ algebra: 224, advanced_math: 224, psda: 96, geometry_trig: 96 });
    for (const d of ["1", "2", "3"]) expect(Math.abs(by((s) => String(s.difficulty))[d] - 640 / 3)).toBeLessThan(10);
    expect(by((s) => s.format).spr / 640).toBeGreaterThan(0.22);
    expect(by((s) => s.format).spr / 640).toBeLessThan(0.32);
    expect(Object.values(SKILL_QUOTA).reduce((a, b) => a + b, 0)).toBe(640);
  });
  it("batches share a skill and a difficulty, at most 5", () => {
    for (const b of batches(plan)) {
      expect(b.length).toBeLessThanOrEqual(5);
      expect(new Set(b.map((s) => `${s.skill}|${s.difficulty}`)).size).toBe(1);
    }
  });
  it("prompts are built from the plan only (stable cache keys), with stable number hints", () => {
    const b = batches(plan)[0];
    expect(writerPrompt(b)).toBe(writerPrompt(b));
    expect(writerPrompt(b)).toContain(b[0].id);
    expect(numberHints(b[0].id)).toEqual(numberHints(b[0].id));
    expect(numberHints(b[0].id).every((n) => n >= 2 && n < 60)).toBe(true);
    const sp = solverPrompt(SAMPLE[3]);
    expect(sp).not.toContain("answer");
    expect(sp).toContain('"kind":"plot"');
  });
});

describe("latexToMathjs and the numeric check", () => {
  it("reads choices", () => {
    expect(latexToMathjs("$\\frac{3}{4}$")).toBe("((3)/(4))");
    expect(latexToMathjs("$2\\sqrt{3}$")).toBe("2sqrt(3)");
    expect(latexToMathjs("$x(x - 4)$")).toBe("x*(x - 4)");
    expect(latexToMathjs("$y = 2x$")).toBeNull();
    expect(latexToMathjs("Exactly one")).toBeNull();
    expect(latexToMathjs("$(3, 4)$")).toBeNull();
  });
  const spr = (accepted: string[]) => ({ format: "spr" as const, choices: null, answer: { accepted } });
  const mcq = (texts: string[], key: "A" | "B" | "C" | "D") => ({ format: "mcq" as const, choices: texts.map((text, i) => ({ key: "ABCD"[i] as "A", text })), answer: { key } });
  it("grid-ins: every form within its precision of the computed value", () => {
    expect(casCheck(spr(["2/3", ".6666", ".6667"]), { kind: "value", expr: "2/3" }).result).toBe("pass");
    expect(casCheck(spr(["14"]), { kind: "value", expr: "(212-4*20)/3 - 30" }).result).toBe("pass");
    expect(casCheck(spr(["15"]), { kind: "value", expr: "28/2" }).result).toBe("fail");
    // numerically close enough; the lint is what refuses a decimal shorter than the grid (below)
    expect(casCheck(spr([".67"]), { kind: "value", expr: "2/3" }).result).toBe("pass");
    const twoThirds = SAMPLE.find((q) => q.format === "spr")!;
    expect(questionIssues({ ...twoThirds, answer: { accepted: ["2/3", ".67"] } }).join()).toMatch(/not as precise/);
    expect(questionIssues({ ...twoThirds, answer: { accepted: ["2/3", ".6667", ".6666", "0.667", "0.666"] } })).toEqual([]);
  });
  it("multiple choice: the key is the value, and no other choice is", () => {
    expect(casCheck(mcq(["$2\\pi$", "$4\\pi$", "$6\\pi$", "$12\\pi$"], "B"), { kind: "value", expr: "120/360*2*pi*6" }).result).toBe("pass");
    expect(casCheck(mcq(["$2$", "$4$", "$6$", "$8$"], "B"), { kind: "value", expr: "3*2" }).result).toBe("fail");
    expect(casCheck(mcq(["$4$", "$\\frac{8}{2}$", "$6$", "$8$"], "A"), { kind: "value", expr: "2+2" }).detail).toMatch(/also equals/);
    expect(casCheck(mcq(["Zero", "One", "Two", "Many"], "B"), { kind: "value", expr: "1" }).result).toBe("skipped");
  });
  it("a bare number is the writer's answer again: skipped, never a pass", () => {
    expect(casCheck(spr(["28"]), { kind: "value", expr: "28" }).result).toBe("skipped");
  });
  it("expressions: the key is equivalent to the target at 5 points, the others are not", () => {
    const q = mcq(["$2x^2 - 12$", "$2x^2 - 11x - 12$", "$2x^2 - 5x - 12$", "$2x^2 + 5x - 12$"], "C");
    expect(casCheck(q, { kind: "expression", target: "(2x+3)(x-4)" }).result).toBe("pass");
    expect(casCheck({ ...q, answer: { key: "D" } }, { kind: "expression", target: "(2x+3)(x-4)" }).result).toBe("fail");
    expect(casCheck(mcq(["$x$", "$y$", "$2x$", "$3x$"], "A"), { kind: "expression", target: "x" }).result).toBe("skipped");
  });
});

describe("near duplicates", () => {
  it("the same question with new numbers, or the same equation, is a duplicate; a different form is not", () => {
    const items = [
      { id: "a", skill: "s", stem: "A bakery sells muffins for 3 dollars each and scones for 4 dollars each. It took in 212 dollars." },
      { id: "b", skill: "s", stem: "A bakery sells muffins for 5 dollars each and scones for 2 dollars each. It took in 300 dollars." },
      { id: "c", skill: "s", stem: "Which of the following is equivalent to $(x+9)(x-12)$?" },
      { id: "d", skill: "s", stem: "Which of the following is equivalent to $45x^2 - 20$?" },
      { id: "e", skill: "s", stem: "If $5(x-3)=2x+9$, what is the value of $x$?" },
      { id: "f", skill: "s", stem: "What value of $x$ satisfies the equation $5(x - 3) = 2x + 9$?" },
      { id: "g", skill: "t", stem: "A bakery sells muffins for 3 dollars each and scones for 4 dollars each. It took in 212 dollars." },
    ];
    expect(Object.fromEntries(nearDuplicates(items))).toEqual({ b: "a", f: "e" });
    expect(mathOf("Solve $5(x-3)=2x+9$.")).toEqual(new Set(["5(x-3)=2x+9"]));
    expect(jaccard(shingles(items[2].stem), shingles(items[3].stem))).toBeLessThan(0.8);
  });
});

describe("reading the models", () => {
  it("parses the JSON in a reply, fenced or not", () => {
    expect(parseJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonObject("no json")).toBeNull();
  });
  it("turns a writer's question into a bank row, cleaning the LaTeX", () => {
    const slot = buildPlan()[0];
    const { q, verify, distractors } = toQuestion(slot, {
      slot: slot.id,
      stem: "If $\\dfrac{x}{5} - 2 = 7$, what is $x$?",
      choices: ["$1$", "$25$", "$35$", "$45$"],
      answer: "d",
      distractors: { A: "x", B: "y", C: "z" },
      steps: [{ text: "Add 2.", math: "$\\frac{x}{5} = 9$" }, { text: "Multiply by 5.", math: "x = 45 \\quad \\Rightarrow \\quad \\text{done}" }],
      desmos_tip: "null",
      verify: { kind: "value", expr: "(7+2)*5" },
    });
    expect(q.stem).toBe("If $\\frac{x}{5} - 2 = 7$, what is $x$?");
    expect(q.answer).toEqual({ key: "D" });
    expect(q.solution.steps[0].math).toBe("\\frac{x}{5} = 9");
    expect(q.solution.steps[1].math).toBe("x = 45, done");
    expect(q.solution.desmos_tip).toBeNull();
    expect(q.status).toBe("draft");
    expect(verify).toEqual({ kind: "value", expr: "(7+2)*5" });
    expect(distractors).toEqual({ A: "x", B: "y", C: "z" });
    expect(SatQuestionSchema.safeParse(q).success).toBe(slot.format === "mcq");
  });
  it("normalizes only to the subset's equivalents", () => {
    expect(normalizeLatex("$2 \\times 3 \\div 4 \\leq 5$")).toBe("$2 \\cdot 3 / 4 \\le 5$");
    expect(normalizeLatex("$\\left(x\\right)$")).toBe("$(x)$");
  });
  it("agrees: a key, a grid-in form, or an equal value", () => {
    expect(agrees({ format: "mcq", answer: { key: "B" } }, "(B)")).toBe(true);
    expect(agrees({ format: "mcq", answer: { key: "B" } }, "C")).toBe(false);
    expect(agrees({ format: "spr", answer: { accepted: ["3/4", ".75"] } }, "0.75")).toBe(true);
    expect(agrees({ format: "spr", answer: { accepted: ["2/3", ".6666", ".6667"] } }, "0.6667")).toBe(true);
    expect(agrees({ format: "spr", answer: { accepted: ["7"] } }, "7.0")).toBe(true);
    expect(agrees({ format: "spr", answer: { accepted: ["7"] } }, "8")).toBe(false);
    expect(agrees({ format: "spr", answer: { accepted: ["7"] } }, null)).toBe(false);
  });
});

describe("the upsert", () => {
  const row = (q: SatQuestion, version = 1, status = q.status) => ({ id: q.id, domain: q.domain, skill: q.skill, difficulty: q.difficulty, format: q.format, stem: q.stem, figure: q.figure, choices: q.choices, answer: q.answer, solution: q.solution, nudge: q.nudge ?? null, common_wrong: q.common_wrong ?? null, status, version });
  // a sample as v1 had it, without the v2 notes
  const v1 = (q: SatQuestion): SatQuestion => {
    const { nudge, common_wrong, ...rest } = q;
    void nudge;
    void common_wrong;
    return { ...rest, choices: q.choices ? q.choices.map(({ key, text }) => ({ key, text })) : null, solution: { steps: q.solution.steps, desmos_tip: q.solution.desmos_tip } };
  };
  it("writes new rows, skips unchanged ones, bumps the version only on a content change, retires the missing", () => {
    const [a, b, c] = SAMPLE;
    const changed = { ...b, stem: `${b.stem} ` };
    const plan = planUpsert([a, changed], [row(a, 3), row(b, 2), row(c, 1)]);
    expect(plan.unchanged).toBe(1);
    expect(plan.upsert).toEqual([expect.objectContaining({ id: b.id, version: 3 })]);
    expect(plan.retire).toEqual([c.id]);
    // a status change alone writes the row with the same version
    expect(planUpsert([{ ...a, status: "draft" }], [row(a, 3)]).upsert).toEqual([expect.objectContaining({ id: a.id, version: 3, status: "draft" })]);
    // key order inside jsonb does not count as a change
    expect(contentHash(row(a))).toBe(contentHash({ ...row(a), solution: { desmos_steps: a.solution.desmos_steps, desmos_tip: a.solution.desmos_tip, steps: a.solution.steps } }));
  });
  it("loads a live row that fails a check as draft", () => {
    const bad = { ...SAMPLE[0], stem: "Costs $5 a day" };
    expect(planUpsert([bad], []).demoted).toEqual([bad.id]);
  });
  it("v2 notes: written as columns (null when absent, so a removed note is cleared), a failing note left out with the question kept live, a note change is a new version", () => {
    const a = v1(SAMPLE[0]);
    const withNudge = { ...a, nudge: "What could you do to both sides first?" };
    const plan = planUpsert([withNudge], [row(a, 2)]);
    expect(plan.upsert).toEqual([expect.objectContaining({ id: a.id, nudge: withNudge.nudge, common_wrong: null, version: 3, status: "live" })]);
    // an old row (no note columns yet) and the same question without notes: unchanged
    expect(planUpsert([a], [row(a, 2)]).unchanged).toBe(1);
    expect(planUpsert([a], [{ ...row(a, 2), nudge: null, common_wrong: null }]).unchanged).toBe(1);
    // a leaking nudge is left out; the question stays live
    const leaky = planUpsert([{ ...a, nudge: "Choice B." }], []);
    expect(leaky.upsert[0]).toMatchObject({ status: "live", nudge: null });
    expect(leaky.droppedNotes).toEqual({ [a.id]: ["nudge"] });
    expect(leaky.demoted).toEqual([]);
    const sql = bankSql([withNudge, v1(SAMPLE[1])]);
    expect(sql).toContain("'What could you do to both sides first?'");
    expect(sql).toContain("nudge = excluded.nudge, common_wrong = excluded.common_wrong");
    expect(sql).toContain("null, null::jsonb, 'live'");
  });
  it("writes the bank as one idempotent SQL transaction, quotes escaped", () => {
    const sql = bankSql([{ ...SAMPLE[0], stem: "Dana's $x$" }]);
    expect(sql.startsWith("begin;\n")).toBe(true);
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
    expect(sql).toContain("'Dana''s $x$'");
    expect(sql).toContain("on conflict (id) do update");
    expect(sql).toContain("set status = 'retired'");
  });
});

describe("data/sat/bank.json", () => {
  it("every row fits the contract; every live row passes every check and has a right answer the checker accepts", () => {
    expect(BANK.length).toBeGreaterThan(300);
    const live = BANK.filter((q) => q.status === "live");
    for (const q of BANK) expect(SatQuestionSchema.safeParse(q).success || q.status === "draft", q.id).toBe(true);
    for (const q of live) {
      expect(questionIssues(q), q.id).toEqual([]);
      expect(isCorrect(q, "key" in q.answer ? q.answer.key : q.answer.accepted[0]), q.id).toBe(true);
    }
  });
  it("ids are unique, and the generated ones are the plan's", () => {
    expect(new Set(BANK.map((q) => q.id)).size).toBe(BANK.length);
    const planned = new Set(buildPlan().map((s) => s.id));
    const sample = new Set(SAMPLE.map((q) => q.id));
    for (const q of BANK) expect(planned.has(q.id) || sample.has(q.id), q.id).toBe(true);
  });
});
