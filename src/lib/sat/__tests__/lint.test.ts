/**
 * The bank's mechanical checks (src/lib/sat/lint.ts) and the hand-made sample the iPad lane builds
 * against (docs/sat/sample-20.json): every sample question fits the contract and passes every check,
 * and together they cover both formats, all four domains and every figure kind and item.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isCorrect } from "@/lib/sat/answer";
import { SAT_DOMAINS, SatQuestionSchema, type SatQuestion } from "@/lib/sat/contracts";
import { evalExpr, figureIssues, latexIssues, numericValue, questionIssues } from "@/lib/sat/lint";

const SAMPLE = JSON.parse(readFileSync(join(__dirname, "..", "..", "..", "..", "docs", "sat", "sample-20.json"), "utf8")) as SatQuestion[];

describe("docs/sat/sample-20.json", () => {
  it("has 20 questions, each fitting the contract and passing every check", () => {
    expect(SAMPLE).toHaveLength(20);
    for (const q of SAMPLE) {
      expect(SatQuestionSchema.safeParse(q).success, q.id).toBe(true);
      expect(questionIssues(q), q.id).toEqual([]);
    }
  });
  it("covers both formats, all four domains, every figure kind and every figure item", () => {
    expect(new Set(SAMPLE.map((q) => q.format))).toEqual(new Set(["mcq", "spr"]));
    expect(new Set(SAMPLE.map((q) => q.domain))).toEqual(new Set(SAT_DOMAINS));
    expect(new Set(SAMPLE.map((q) => q.difficulty))).toEqual(new Set([1, 2, 3]));
    const kinds = new Set(SAMPLE.flatMap((q) => (q.figure ? [q.figure.kind] : [])));
    expect(kinds).toEqual(new Set(["table", "plot", "shape"]));
    const items = new Set(SAMPLE.flatMap((q) => (q.figure && q.figure.kind !== "table" ? q.figure.items.map((i) => `${q.figure!.kind}.${i.type}`) : [])));
    for (const want of ["plot.function", "plot.point", "plot.bar", "shape.polygon", "shape.circle", "shape.segment", "shape.label", "shape.right_angle", "shape.arc_angle"]) expect(items, want).toContain(want);
  });
  it("has unique ids, and each answer is accepted by the checker", () => {
    expect(new Set(SAMPLE.map((q) => q.id)).size).toBe(SAMPLE.length);
    for (const q of SAMPLE) {
      const right = "key" in q.answer ? q.answer.key : q.answer.accepted[0];
      expect(isCorrect(q, right), q.id).toBe(true);
    }
  });
});

describe("latexIssues", () => {
  it("passes the SwiftMath-safe subset", () => {
    expect(latexIssues("Solve $\\frac{2}{3}x \\le \\sqrt{9}$ and $$\\sin \\theta = \\frac{1}{2}$$")).toEqual([]);
    expect(latexIssues("In $\\triangle ABC$, $\\angle A = 30^\\circ$ and $\\overline{AB} \\ne 2\\pi$.")).toEqual([]);
  });
  it("flags commands outside the subset, escapes, unbalanced braces and stray dollars", () => {
    expect(latexIssues("$\\dfrac{1}{2}$").join()).toMatch(/dfrac/);
    expect(latexIssues("$\\left( x \\right)$").join()).toMatch(/left/);
    expect(latexIssues("$50\\%$").join()).toMatch(/escape/);
    expect(latexIssues("$\\frac{1}{2$").join()).toMatch(/unbalanced/);
    expect(latexIssues("It costs $5 a ticket.").join()).toMatch(/unpaired/);
    expect(latexIssues("The value \\frac{1}{2} is").join()).toMatch(/outside/);
  });
});

describe("numericValue / evalExpr", () => {
  it("reads choice values", () => {
    expect(numericValue("$\\frac{4}{7}$")).toBeCloseTo(4 / 7);
    expect(numericValue("$-12$")).toBe(-12);
    expect(numericValue("$2x$")).toBeNull();
  });
  it("evaluates plot expressions and refuses anything else", () => {
    expect(evalExpr("9-(x-1)**2", 0)).toBe(8);
    // JS refuses a unary minus right before **, so the bank never writes one
    expect(evalExpr("-(x-1)**2+9", 0)).toBeNull();
    expect(evalExpr("1.5*x-2", 6)).toBe(7);
    expect(evalExpr("process.exit(1)", 0)).toBeNull();
    expect(evalExpr("Math.sqrt(x)", 4)).toBeNull();
  });
});

describe("figureIssues", () => {
  it("catches a labelled point drawn elsewhere, and a point off the plotted function", () => {
    const issues = figureIssues({
      kind: "plot",
      x: { min: -5, max: 5, step: 1 },
      y: { min: -5, max: 5, step: 1 },
      items: [{ type: "function", expr: "2*x+1" }, { type: "point", at: [1, 4], label: "(1, 3)" }],
    });
    expect(issues.join()).toMatch(/labelled \(1, 3\) is drawn at/);
    expect(issues.join()).toMatch(/not on y = 2\*x\+1/);
  });
  it("catches side labels that do not match the drawing, unless it is not to scale", () => {
    const shape = { kind: "shape" as const, items: [{ type: "polygon" as const, points: [[0, 0], [4, 0], [0, 3]] as [number, number][] }, { type: "label" as const, at: [2, -0.3] as [number, number], text: "4" }, { type: "label" as const, at: [-0.3, 1.5] as [number, number], text: "9" }] };
    expect(figureIssues(shape).join()).toMatch(/proportions/);
    expect(figureIssues({ ...shape, note: "Note: Figure not drawn to scale." })).toEqual([]);
  });
  it("catches items outside the axes", () => {
    expect(figureIssues({ kind: "plot", x: { min: 0, max: 5, step: 1 }, y: { min: 0, max: 5, step: 1 }, items: [{ type: "point", at: [7, 1] }] }).join()).toMatch(/outside/);
  });
});

describe("questionIssues", () => {
  const base = SAMPLE.find((q) => q.format === "spr")!;
  const mcq = SAMPLE.find((q) => q.format === "mcq")!;
  it("refuses an spr form that does not fit the grid, and forms that disagree", () => {
    expect(questionIssues({ ...base, answer: { accepted: ["1234567"] } }).join()).toMatch(/contract|grid-in/);
    expect(questionIssues({ ...base, answer: { accepted: ["14", "15"] } }).join()).toMatch(/disagree/);
  });
  it("refuses an mcq with two equal choices", () => {
    const choices = mcq.choices!.map((c, i) => (i === 1 ? { ...c, text: mcq.choices![0].text } : c));
    expect(questionIssues({ ...mcq, choices }).join()).toMatch(/same/);
  });
  it("refuses a row that breaks the contract", () => {
    expect(questionIssues({ ...mcq, id: "algebra-wrong-0001" }).join()).toMatch(/contract/);
    expect(questionIssues({ ...mcq, solution: { steps: [{ text: "one", math: null }], desmos_tip: null } }).join()).toMatch(/contract/);
  });
});
