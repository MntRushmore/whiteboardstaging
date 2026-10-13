/**
 * A skill page's math (`skillContent.ts`): for every skill in the library, one worked example and
 * ten practice problems, made by the app's generators, worked by the board's engine and every answer
 * checked again by putting it back into the problem. The same build makes the same page.
 */
import * as mathjs from "mathjs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { drawLadder } from "@/lib/learning/generators";
import { createEngine } from "@/lib/live/engine";
import { SKILL_IDS } from "../routes";
import { checkAnswer, CONTENT_SEED, kidWorking, latexToPlain, LENGTH_SKILLS, PRACTICE_COUNT, skillContent, workingChecks, type SkillContent } from "../skillContent";

// the engine works every problem of every skill: generous limits for a busy runner
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

const all = new Map<string, SkillContent>();
let builtMs = 0;
beforeAll(() => {
  const t = Date.now();
  for (const id of SKILL_IDS) all.set(id, skillContent(id));
  builtMs = Date.now() - t;
});

const content = (id: string) => all.get(id)!;
const keyOf = (lines: readonly { latex: string }[]) => lines.map((l) => l.latex).join("; ");

describe("every skill's practice set", () => {
  it("has ten problems, each with an answer", () => {
    for (const id of SKILL_IDS) {
      const c = content(id);
      expect(c.problems, id).toHaveLength(PRACTICE_COUNT);
      for (const p of c.problems) {
        expect(p.problem.length, id).toBeGreaterThan(0);
        expect(p.answer.latex.trim(), id).not.toBe("");
        expect(p.answer.text.trim(), id).not.toBe("");
      }
    }
  });

  it("never repeats a problem, nor the worked example", () => {
    for (const id of SKILL_IDS) {
      const c = content(id);
      const keys = [...c.problems.map((p) => keyOf(p.problem)), ...(c.example ? [keyOf(c.example.problem)] : [])];
      expect(new Set(keys).size, id).toBe(keys.length);
    }
  });

  it("checks every answer by putting it back into the problem", () => {
    for (const id of SKILL_IDS) {
      const c = content(id);
      for (const p of c.problems) {
        const latex = p.problem.map((l) => l.latex);
        // the answer key's form: `= 16` is shown as `16`
        const answer = /[=<>]|\\(?:le|ge)/.test(p.answer.latex) && !/^\s*=/.test(p.answer.latex) ? p.answer.latex : `= ${p.answer.latex}`;
        // a trig answer is for the interval the tutor states when the problem gives none
        const steps = p.interval ? [p.interval.latex] : [];
        expect(checkAnswer(latex, answer, steps, { lengths: LENGTH_SKILLS.has(id) }), `${id}: ${p.problem[0].text} → ${p.answer.text}`).toBe(true);
      }
    }
  });

  it("rejects a wrong answer (the check is not a rubber stamp)", () => {
    let tried = 0;
    for (const id of SKILL_IDS) {
      for (const p of content(id).problems) {
        // the answer with its first number changed by one
        const wrong = p.answer.latex.replace(/\d+/, (n) => String(Number(n) + 1));
        if (wrong === p.answer.latex) continue;
        const latex = p.problem.map((l) => l.latex);
        const answer = /[=<>]|\\(?:le|ge)/.test(wrong) && !/^\s*=/.test(wrong) ? wrong : `= ${wrong}`;
        expect(checkAnswer(latex, answer, p.interval ? [p.interval.latex] : []), `${id}: ${p.problem[0].text} → ${wrong}`).toBe(false);
        tried++;
      }
    }
    expect(tried).toBeGreaterThan(400);
  });

  it("gets plain arithmetic right, by mathjs alone", () => {
    const math = mathjs.create(mathjs.all);
    for (const id of ["add_within_100", "subtract_within_100", "multi_digit_add_subtract", "times_tables", "multiply_multi_digit", "long_division", "negative_numbers", "order_of_operations"]) {
      for (const p of content(id).problems) {
        const expr = p.problem[0].text.replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-");
        expect(Number(math.evaluate(expr)), `${id}: ${expr}`).toBe(Number(p.answer.text.replace(/−/g, "-")));
      }
    }
    // long division's answers are whole numbers
    for (const p of content("long_division").problems) expect(p.answer.text).toMatch(/^\d+$/);
  });

  it("is the topic's ladder, easy to hard, rung by rung (a rung that fails is the next seed's same rung)", () => {
    for (const id of SKILL_IDS) {
      const ladder = drawLadder(id, PRACTICE_COUNT, CONTENT_SEED).problems.map((p) => p.join("; "));
      const page = content(id).problems.map((p) => keyOf(p.problem));
      const same = page.filter((k, i) => k === ladder[i]).length;
      expect(same, id).toBeGreaterThanOrEqual(PRACTICE_COUNT - 1);
    }
  });

  it("writes fractions, powers and roots in the hand, and plain sums in type", () => {
    for (const id of ["add_fractions_unlike", "equivalent_fractions", "exponent_rules", "radicals", "integrals", "logarithms"]) expect(content(id).handwritten, id).toBe(true);
    for (const id of ["long_division", "times_tables", "add_within_10", "multiply_multi_digit"]) expect(content(id).handwritten, id).toBe(false);
  });

  it("says which interval a trig answer is for when the problem does not", () => {
    for (const p of content("trig_equations").problems) {
      const stated = p.problem.some((l) => /\\le/.test(l.latex));
      if (stated) expect(p.interval, p.problem[0].text).toBeUndefined();
      else expect(p.interval?.text, p.problem[0].text).toBe("0° ≤ x < 360°");
    }
  });
});

describe("every skill's worked example", () => {
  it("is one the engine works out, ending in the answer", () => {
    const oneLine: string[] = [];
    for (const id of SKILL_IDS) {
      const ex = content(id).example;
      expect(ex, id).not.toBeNull();
      expect(ex!.steps.length, id).toBeGreaterThan(0);
      if (ex!.steps.length === 1) oneLine.push(id);
      const last = ex!.steps.at(-1)!.latex;
      // the tutor's working ends in the answer (a system's gathers its letters' values); a kid's last line is `… = answer`
      if (ex!.by === "kid") expect(last.endsWith(`= ${ex!.answer.latex}`), `${id}: ${last}`).toBe(true);
      else if (id !== "systems") expect(ex!.answer.latex, id).toBe(last.replace(/^\s*=\s*/, "").trim());
    }
    // skills worked in more than one line on the board (algebra and up) show every line
    for (const id of ["two_step_equations", "multi_step_equations", "systems", "quadratic_equations", "pythagorean", "derivatives", "integrals", "trig_equations"]) {
      expect(oneLine, id).not.toContain(id);
    }
    // only single facts (and a few one-line skills) are one line: a fact is its own working
    expect(oneLine.sort()).toEqual(
      ["add_tens", "add_within_10", "area_perimeter", "division_facts", "factoring", "negative_numbers", "one_step_equations", "powers_roots", "simplify_expressions", "subtract_within_10", "times_tables", "units"].sort(),
    );
  });

  it("shows a kid's working where the tutor's is the answer alone, every line checked by the board's checker", () => {
    const kid = SKILL_IDS.filter((id) => content(id).example?.by === "kid");
    expect(kid).toEqual(expect.arrayContaining(["long_division", "multiply_multi_digit", "add_within_100", "add_fractions_unlike", "order_of_operations", "decimals_multiply", "divide_fractions"]));
    const engine = createEngine(mathjs);
    for (const id of kid) {
      const ex = content(id).example!;
      const problem = ex.problem.map((l) => l.latex);
      const lines = ex.steps.map((l) => l.latex);
      expect(lines.length, id).toBeGreaterThanOrEqual(2);
      expect(workingChecks(engine, problem, lines), id).toBe(true);
      // a slip in any line is caught: the checker is not a rubber stamp
      for (let i = 0; i < lines.length; i++) {
        const slipped = lines.map((l, k) => (k === i ? l.replace(/(\d+)(?!.*\d)/, (n) => String(Number(n) + 1)) : l));
        expect(workingChecks(engine, problem, slipped), `${id} line ${i + 1}: ${slipped[i]}`).toBe(false);
      }
    }
    expect(content("long_division").example!.steps.map((l) => l.text)).toEqual(["3 × 10 = 30", "48 − 30 = 18", "3 × 6 = 18", "10 + 6 = 16"]);
  });

  it("makes a kid's working from the problem's own numbers", () => {
    expect(kidWorking(["570 \\div 6"])).toEqual(["6 \\times 90 = 540", "570 - 540 = 30", "6 \\times 5 = 30", "90 + 5 = 95"]);
    expect(kidWorking(["67 \\times 8"])).toEqual(["60 \\times 8 = 480", "7 \\times 8 = 56", "480 + 56 = 536"]);
    expect(kidWorking(["6 + 8"])).toEqual(["8 + 2 = 10", "10 + 4 = 14"]);
    expect(kidWorking(["13 - 7"])).toEqual(["13 - 3 = 10", "10 - 4 = 6"]);
    expect(kidWorking(["(6 + 7) \\times (10 - 6)"])).toEqual(["6 + 7 = 13", "10 - 6 = 4", "13 \\times 4 = 52"]);
    expect(kidWorking(["\\frac{7}{12} - \\frac{1}{4}"])).toEqual(["\\frac{1}{4} = \\frac{3}{12}", "\\frac{7}{12} - \\frac{3}{12} = \\frac{4}{12}", "\\frac{4}{12} = \\frac{1}{3}"]);
    expect(kidWorking(["1.44 + 4.7"])).toEqual(["1.44 + 4 = 5.44", "5.44 + 0.7 = 6.14"]);
    expect(kidWorking(["15\\% \\times 200"])).toEqual(["15\\% = 0.15", "0.15 \\times 200 = 30"]);
    // a fact is its own working
    for (const p of ["6 \\times 7", "21 \\div 3", "3 + 4", "\\frac{3}{5} + \\frac{1}{5}", "x + 3 = 5"]) expect(kidWorking([p]), p).toBeNull();
  });

  it("gives a system's answer as every unknown's value", () => {
    const ex = content("systems").example!;
    expect(ex.answer.text).toMatch(/^x = −?\d+, y = −?\d+$/);
    for (const p of content("systems").problems) expect(p.answer.text).toMatch(/^x = −?\d+, y = −?\d+$/);
  });
});

describe("the content is fixed at build time", () => {
  it("is the same from a fresh engine", () => {
    const engine = createEngine(mathjs);
    for (const id of ["long_division", "add_fractions_unlike", "two_step_equations", "derivatives", "trig_equations", "systems"] as const) {
      expect(skillContent(id, engine), id).toEqual(content(id));
    }
  });

  it("is built for all 56 skills in reasonable time", () => {
    expect(SKILL_IDS).toHaveLength(56);
    expect(builtMs).toBeLessThan(90_000);
  });
});

describe("latexToPlain", () => {
  it.each([
    ["\\frac{3}{4} + \\frac{1}{6}", "3/4 + 1/6"],
    ["46 \\times 7", "46 × 7"],
    ["864 \\div 4", "864 ÷ 4"],
    ["x^{2}", "x²"],
    ["2x + 3 = 11", "2x + 3 = 11"],
    ["52 - 17", "52 − 17"],
    ["2\\frac{1}{3} + 1\\frac{2}{3}", "2 1/3 + 1 2/3"],
    ["\\frac{x + 2}{3}", "(x + 2)/3"],
    ["\\frac{12 - 4}{8 - 4}", "(12 − 4)/(8 − 4)"],
    ["y = -\\frac{1}{3}x + 9", "y = −(1/3)x + 9"],
    ["\\frac{6y^{7}}{3y^{5}}", "6y⁷/(3y⁵)"],
    ["\\frac{(x + 6)(x - 6)}{(x + 6)^{2}}", "(x + 6)(x − 6)/(x + 6)²"],
    ["\\sqrt{125}", "√125"],
    ["\\sqrt{x - 5} = 2", "√(x − 5) = 2"],
    ["5\\sqrt{5}", "5√5"],
    ["x = \\pm 8", "x = ±8"],
    ["x = -7 \\pm 9", "x = −7 ± 9"],
    ["x^{7 + 2}", "x^(7 + 2)"],
    ["2^{x + 1} = 8", "2^(x + 1) = 8"],
    ["e^{5x}", "e⁵ˣ"],
    ["y^{-2}", "y⁻²"],
    ["\\log_{2} 64", "log₂ 64"],
    ["\\log_{10}(x + 7) = 1", "log₁₀(x + 7) = 1"],
    ["\\sin 30^{\\circ}", "sin 30°"],
    ["2\\sin x = -1", "2 sin x = −1"],
    ["\\cos^{-1}\\left(\\frac{1}{2}\\right) = 60^{\\circ}", "cos⁻¹(1/2) = 60°"],
    ["\\sin \\frac{7\\pi}{6}", "sin 7π/6"],
    ["0 \\le x < 2\\pi", "0 ≤ x < 2π"],
    ["\\lim_{x \\to 3} \\frac{x^{2} - 9}{x - 3}", "lim x→3 (x² − 9)/(x − 3)"],
    ["\\lim_{x \\to \\infty} (3x)", "lim x→∞ (3x)"],
    ["\\frac{d}{dx}(7x^{5})", "d/dx (7x⁵)"],
    ["\\int (6x - 5) \\, dx", "∫ (6x − 5) dx"],
    ["\\int_{1}^{4} 9x^{2} \\, dx", "∫₁⁴ 9x² dx"],
    ["= \\left[3x^{3}\\right]_{1}^{4}", "= [3x³]₁⁴"],
    ["9 \\mathrm{L} \\to \\mathrm{mL}", "9 L → mL"],
    ["= 9000\\,\\mathrm{mL}", "= 9000 mL"],
    ["10\\% \\times 100", "10% × 100"],
    ["x \\neq 0", "x ≠ 0"],
    ["|2x + 2| = 4", "|2x + 2| = 4"],
    ["M = \\left(\\frac{2 + 10}{2}, \\frac{0 + 10}{2}\\right)", "M = ((2 + 10)/2, (0 + 10)/2)"],
    ["d = \\sqrt{(10 - 5)^{2} + (18 - 6)^{2}}", "d = √((10 − 5)² + (18 − 6)²)"],
    ["x = 5, \\ x = -1", "x = 5, x = −1"],
    ["(i^{4})^{5} \\cdot i^{2}", "(i⁴)⁵ · i²"],
    ["f^{-1}(x) = \\frac{x + 2}{3}", "f⁻¹(x) = (x + 2)/3"],
  ])("%s → %s", (latex, plain) => {
    expect(latexToPlain(latex)).toBe(plain);
  });

  it("leaves no LaTeX in any line of any page", () => {
    for (const id of SKILL_IDS) {
      const c = content(id);
      const lines = [...c.problems.flatMap((p) => [...p.problem, p.answer]), ...(c.example ? [...c.example.problem, ...c.example.steps, c.example.answer] : [])];
      for (const l of lines) expect(l.text, `${id}: ${l.latex}`).not.toMatch(/\\|[{}]|\^\{|_\{|\$/);
    }
  });
});
