import { beforeAll, describe, expect, it } from "vitest";
import type { LiveEngine } from "../../contracts";
import { getEngine } from "../../engine";
import { chainsOf, checkTeach, linkHolds, matchTemplate, namesOf, normTex, splitRelations, substitute, tokenize, unwritableWords, type TeachInput } from "../teach";
import { LINEAR_TEACH, OWNER_TEACH } from "./teachFixtures";

/**
 * The engine's check of a worked solution (`checkTeach`): the owner's circle problem as a textbook
 * works it passes; a slip in a chain, a restated value that disagrees, and an answer the working
 * did not find are each caught, with a sentence the model can act on.
 */

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

const withStep = (t: TeachInput, i: number, math: string[]): TeachInput => ({ ...t, steps: t.steps.map((s, k) => (k === i ? { ...s, math } : s)) });

describe("names, relations and templates", () => {
  it("a segment is one name, a subscripted letter one name, an angle one name; e and π are numbers", () => {
    expect([...namesOf("2OR^{2} + OS^{2}")]).toEqual(["OR", "OS"]);
    expect([...namesOf("\\sqrt{(x_2 - x_1)^2 + (y_{2} - y_1)^2}")]).toEqual(["x_{2}", "x_{1}", "y_{2}", "y_{1}"]);
    expect([...namesOf("m\\angle ROS + \\angle B = 180^{\\circ}")]).toEqual(["m∠ROS", "∠B"]);
    expect([...namesOf("\\overline{AB} = \\pi r^{2} + e^{x}")]).toEqual(["AB", "r", "x"]);
    expect([...namesOf("\\sin\\theta + a_n")]).toEqual(["\\theta", "a_{n}"]);
    expect(tokenize("OR = \\sqrt{31}").map((t) => t.name)).toEqual(["OR", null]);
  });

  it("values put in brackets (a pair stays a pair); text compared without spacing", () => {
    expect(substitute("2OR^{2}", new Map([["OR", "\\sqrt{31}"]]))).toBe("2(\\sqrt{31})^{2}");
    expect(substitute("M", new Map([["M", "(4, 5)"]]))).toBe("(4, 5)");
    expect(normTex("x^2 + \\sqrt 6 \\cdot \\left( y \\right)")).toBe("x^{2}+\\sqrt{6}\\cdot(y)");
    expect(splitRelations("OS = OR = \\sqrt{31}")).toEqual({ parts: ["OS", "OR", "\\sqrt{31}"], rels: ["=", "="] });
    expect(splitRelations("\\frac{a}{b} \\le 2x")).toEqual({ parts: ["\\frac{a}{b}", "2x"], rels: ["\\le"] });
    expect(chainsOf(["OR = \\sqrt{a}", "= \\sqrt{b}", "x = 2"]).map((c) => c.parts)).toEqual([["OR", "\\sqrt{a}", "\\sqrt{b}"], ["x", "2"]]);
  });

  it("a formula's letters matched to the line that puts the numbers in", () => {
    const m = matchTemplate("\\sqrt{(x_2 - x_1)^2 + (y_2 - y_1)^2}", "\\sqrt{(a + \\sqrt{6} - a)^2 + (b + 5 - b)^2}", new Set(["x_{1}", "x_{2}", "y_{1}", "y_{2}"]));
    expect(m.map((x) => Object.fromEntries(x))).toContainEqual({ "x_{2}": "a+\\sqrt{6}", "x_{1}": "a", "y_{2}": "b+5", "y_{1}": "b" });
    expect(matchTemplate("\\pi r^{2}", "\\pi (3)^{2}", new Set(["r"])).map((x) => x.get("r"))).toContain("(3)");
    expect(matchTemplate("a^{2} + b^{2}", "\\sqrt{6}", new Set(["a", "b"]))).toEqual([]);
  });

  it("a link holds when the engine finds both sides equal for every value of the letters", () => {
    expect(linkHolds(engine, "\\sqrt{(a + \\sqrt{6} - a)^2 + (b + 5 - b)^2}", "\\sqrt{(\\sqrt{6})^2 + 5^2}")).toBe("ok");
    expect(linkHolds(engine, "(x + 1)^{2}", "x^{2} + 2x + 1")).toBe("ok");
    expect(linkHolds(engine, "\\sqrt{6 + 25}", "\\sqrt{30}")).toBe("mismatch");
    expect(linkHolds(engine, "(a + b)^{2}", "a^{2} + b^{2}")).toBe("mismatch");
    expect(linkHolds(engine, "(\\frac{2 + 6}{2}, \\frac{3 + 7}{2})", "(4, 5)")).toBe("ok");
    expect(linkHolds(engine, "\\frac{d}{dx}(x^{3})", "3x^{2}")).toBe("ok");
  });
});

describe("checkTeach", () => {
  it("the owner's circle problem, as the textbook works it, is checked through: RS² = 62", () => {
    const v = checkTeach(engine, OWNER_TEACH);
    expect(v).toMatchObject({ ok: true, answerValue: "62" });
    if (!v.ok) return;
    expect(v.found).toMatchObject({ OR: "\\sqrt{31}", OS: "\\sqrt{31}", "RS^{2}": "62", RS: "\\sqrt{62}" });
    // every link but the definitions (OR = …, OS = OR, RS² = …) shown equal by the engine
    expect(v.checked).toBeGreaterThanOrEqual(8);
  });

  it("a slip in a chain (\\sqrt{6 + 25} = \\sqrt{30}) is caught at its line, and nothing after it is judged against it", () => {
    const bad = withStep(OWNER_TEACH, 1, ["OR = \\sqrt{(x_2 - x_1)^2 + (y_2 - y_1)^2}", "= \\sqrt{(a + \\sqrt{6} - a)^2 + (b + 5 - b)^2}", "= \\sqrt{(\\sqrt{6})^2 + 5^2}", "= \\sqrt{6 + 25}", "= \\sqrt{30}"]);
    const v = checkTeach(engine, bad);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.problems).toEqual(['Step 2, line 5: "\\sqrt{6 + 25}" is not equal to "\\sqrt{30}".']);
    expect(v.findings).toEqual([{ step: 2, line: 5, problem: v.problems[0] }]);
  });

  it("an answer the working did not find (RS² = 64) fails the cross-step check", () => {
    const v = checkTeach(engine, { ...OWNER_TEACH, answer: "RS^{2} = 64" });
    expect(v).toMatchObject({ ok: false, problems: ['The answer "RS^{2} = 64" does not match the working, which found "RS^{2} = 62".'] });
    // and a bare value
    expect(checkTeach(engine, { ...OWNER_TEACH, answer: "64" }).ok).toBe(false);
    expect(checkTeach(engine, { ...OWNER_TEACH, answer: "62" }).ok).toBe(true);
  });

  it("a quantity named on the way takes the chain's value (OR = OS, then = \\sqrt{31}); a wrong one is caught at the end", () => {
    const onTheWay = withStep(OWNER_TEACH, 2, ["OR = OS", "= \\sqrt{31}"]);
    expect(checkTeach(engine, onTheWay)).toMatchObject({ ok: true, found: { OS: "\\sqrt{31}" }, answerValue: "62" });
    // with the squares worked from the values (31 + 31), as a model wrote it
    const squares = withStep(onTheWay, 3, ["RS^{2} = OR^{2} + OS^{2}", "= 31 + 31", "= 62"]);
    expect(checkTeach(engine, squares).ok).toBe(true);
    const wrong = checkTeach(engine, withStep(OWNER_TEACH, 2, ["OR = OS", "= \\sqrt{30}"]));
    expect(wrong.ok).toBe(false);
  });

  it("a value restated wrongly is caught against the step that found it", () => {
    const v = checkTeach(engine, withStep(OWNER_TEACH, 2, ["OS = OR = \\sqrt{30}"]));
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.problems[0]).toBe('Step 3, line 1: "OR" is not equal to "\\sqrt{30}".');
  });

  it("a formula must be followed by itself with the numbers put in, not a leap", () => {
    const leap = withStep(OWNER_TEACH, 1, ["OR = \\sqrt{(x_2 - x_1)^2 + (y_2 - y_1)^2}", "= \\sqrt{(\\sqrt{6})^2 + 5^2}", "= \\sqrt{31}"]);
    const v = checkTeach(engine, leap);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.problems[0]).toMatch(/^Step 2, line 2: the engine could not check that .* with the numbers put in\. Write the formula, then the formula with the numbers put in/);
  });

  it("equations solved line by line: each line follows; a wrong one is caught", () => {
    const linear = LINEAR_TEACH;
    expect(checkTeach(engine, linear)).toMatchObject({ ok: true, found: { x: "4" }, answerValue: "4" });
    const wrong = withStep(linear, 1, ["x = 5"]);
    expect(checkTeach(engine, { ...wrong, steps: wrong.steps.slice(0, 2), answer: "x = 5" })).toMatchObject({ ok: false, problems: ['Step 2, line 1: "x = 5" does not follow from "2x = 8".'] });
    // a wrong check line is caught too
    expect(checkTeach(engine, withStep(linear, 2, ["2(4) + 3 = 12"])).ok).toBe(false);
  });

  it("a word problem: the setup is taken as given, every line after it checked", () => {
    const coins: TeachInput = {
      steps: [
        { say: "Let n be the nickels; the other 25 - n coins are dimes.", math: ["5n + 10(25 - n) = 185"] },
        { say: "Distribute and collect like terms.", math: ["5n + 250 - 10n = 185", "-5n + 250 = 185", "-5n = -65"] },
        { say: "Divide by -5.", math: ["n = 13"] },
        { say: "The dimes are the rest.", math: ["25 - 13 = 12"] },
      ],
      answer: "n = 13",
    };
    expect(checkTeach(engine, coins)).toMatchObject({ ok: true, answerValue: "13" });
    expect(checkTeach(engine, withStep(coins, 1, ["5n + 250 - 10n = 185", "-5n + 250 = 185", "-5n = -75"])).ok).toBe(false);
  });

  it("the Pythagorean theorem, as a chain or as equations; a root that disagrees is caught", () => {
    const chain: TeachInput = {
      steps: [
        { say: "Use the Pythagorean theorem.", math: ["c^{2} = a^{2} + b^{2}", "= 6^{2} + 8^{2}", "= 36 + 64", "= 100"] },
        { say: "Take the positive square root.", math: ["c = \\sqrt{100}", "= 10"] },
      ],
      answer: "c = 10",
    };
    // c² = a² + b² with its right side worked out: the equation c² = 100 goes in the column
    expect(checkTeach(engine, chain)).toMatchObject({ ok: true, found: { c: "10" }, answerValue: "10" });
    const equations: TeachInput = { steps: [{ say: "Use the Pythagorean theorem.", math: ["a^{2} + b^{2} = c^{2}", "6^{2} + 8^{2} = c^{2}", "100 = c^{2}", "c = 10"] }], answer: "c = 10" };
    expect(checkTeach(engine, equations).ok).toBe(true);
    const wrongRoot: TeachInput = { steps: [chain.steps[0], { say: "Take the square root.", math: ["c = 11"] }], answer: "c = 11" };
    const v = checkTeach(engine, wrongRoot);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.problems[0]).toMatch(/^Step \d, line 1: .*(does not follow|does not hold|disagree)/);
  });

  it("Algebra 2: exponents, logs, a quadratic's two roots, an inequality, a system", () => {
    const cases: TeachInput[] = [
      { steps: [{ say: "Write 16 as a power of 2.", math: ["2^{x + 1} = 16", "2^{x + 1} = 2^{4}"] }, { say: "Set the exponents equal.", math: ["x + 1 = 4", "x = 3"] }], answer: "x = 3" },
      { steps: [{ say: "Rewrite in exponential form.", math: ["\\log_{2}(x) = 5", "x = 2^{5}", "x = 32"] }], answer: "x = 32" },
      { steps: [{ say: "Factor.", math: ["x^{2} - 5x + 6 = 0", "(x - 2)(x - 3) = 0"] }, { say: "Each factor can be zero.", math: ["x = 2, \\ x = 3"] }], answer: "x = 2, \\ x = 3" },
      { steps: [{ say: "Subtract 3.", math: ["3 - 2x > 7", "-2x > 4"] }, { say: "Divide by -2 and flip the sign.", math: ["x < -2"] }], answer: "x < -2" },
      {
        steps: [
          { say: "Write the two equations.", math: ["x + y = 10", "x - y = 2"] },
          { say: "Add them.", math: ["2x = 12", "x = 6"] },
          { say: "Put x = 6 into the first.", math: ["6 + y = 10", "y = 4"] },
        ],
        answer: "x = 6, \\ y = 4",
      },
    ];
    for (const c of cases) expect(checkTeach(engine, c), JSON.stringify(c.steps[0].math)).toMatchObject({ ok: true });
    // an equation whose right side is worked out in a chain, as a model wrote it
    const rewritten: TeachInput = {
      steps: [
        { say: "Rewrite 32 as a power of 2.", math: ["2^{x+3} = 32", "= 2^{5}"] },
        { say: "The exponents must match.", math: ["x + 3 = 5"] },
        { say: "Subtract 3 from both sides.", math: ["x = 2"] },
      ],
      answer: "x = 2",
    };
    expect(checkTeach(engine, rewritten)).toMatchObject({ ok: true, answerValue: "2" });
    expect(checkTeach(engine, withStep(rewritten, 0, ["2^{x+3} = 32", "= 2^{6}"])).ok).toBe(false);
    expect(checkTeach(engine, withStep(rewritten, 2, ["x = 3"])).ok).toBe(false);
    // a wrong elimination line in the system is caught by what the system solves to
    const sys = cases[4];
    expect(checkTeach(engine, withStep(sys, 1, ["2x = 14", "x = 7"])).ok).toBe(false);
    // a quadratic with a root missing is not the answer
    expect(checkTeach(engine, { ...cases[2], answer: "x = 2" }).ok).toBe(false);
  });

  it("words in the maths, a line the hand cannot write, a symbol the words cannot write: sent back", () => {
    expect(checkTeach(engine, { steps: [{ say: "Solve.", math: ["\\text{so} x = 4"] }] })).toMatchObject({ ok: false, problems: [expect.stringMatching(/has words in it/)] });
    expect(checkTeach(engine, { steps: [{ say: "Solve.", math: ["x = 4"] }] }, () => false)).toMatchObject({ ok: false, problems: [expect.stringMatching(/the hand cannot write/)] });
    expect(unwritableWords("so ∠ROS = 90° and √31 ≈ 5.6, △ROS ≅ △SOR")).toEqual([]);
    expect(unwritableWords("x ∈ ℝ ⟹ done")).toEqual(["⟹"]);
    expect(checkTeach(engine, { steps: [{ say: "So ⟹ x = 4", math: ["x = 4"] }] }).ok).toBe(false);
  });

  it("a formula with its numbers put in (the slope, the midpoint, a circle's area)", () => {
    expect(checkTeach(engine, { steps: [{ say: "Slope.", math: ["m = \\frac{y_2 - y_1}{x_2 - x_1}", "= \\frac{7 - 3}{4 - 2}", "= \\frac{4}{2}", "= 2"] }], answer: "m = 2" }).ok).toBe(true);
    expect(checkTeach(engine, { steps: [{ say: "Average.", math: ["M = (\\frac{x_1 + x_2}{2}, \\frac{y_1 + y_2}{2})", "= (\\frac{2 + 6}{2}, \\frac{3 + 7}{2})", "= (4, 5)"] }], answer: "M = (4, 5)" }).ok).toBe(true);
    expect(checkTeach(engine, { steps: [{ say: "Area.", math: ["A = \\pi r^{2}", "= \\pi (3)^{2}", "= 9\\pi"] }], answer: "A = 9\\pi" }).ok).toBe(true);
    // the numbers put in wrong (7 - 3 over 4 - 2 is 2, not 3)
    expect(checkTeach(engine, { steps: [{ say: "Slope.", math: ["m = \\frac{y_2 - y_1}{x_2 - x_1}", "= \\frac{7 - 3}{4 - 2}", "= 3"] }] }).ok).toBe(false);
  });

  it("is quick enough for the route: the owner's solution in well under a second", () => {
    const t = Date.now();
    checkTeach(engine, OWNER_TEACH);
    expect(Date.now() - t).toBeLessThan(1500);
  });
});
