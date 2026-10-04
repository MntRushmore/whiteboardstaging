/**
 * The pure half of "a problem like this one" (`generators/shape.ts`, `generators/variant.ts`): a read
 * problem tidied to the chat's conventions, its skeleton (the form without its numbers), and how two
 * answers are compared. No engine.
 */
import { describe, expect, it } from "vitest";
import { SKILL_IDS } from "../contracts";
import { drawProblems, formsFor } from "../generators";
import { makeRng, seedFrom } from "../generators/rng";
import { freeNumbers, looseSkeleton, skeletonOf, tidy } from "../generators/shape";
import { answerKey, answerShape, nudgedCandidates, trigKey } from "../generators/variant";

describe("tidy: a read problem in the chat's conventions", () => {
  it.each([
    ["2x+3=11", "2x + 3 = 11"],
    ["x^2-5x+6=0", "x^{2} - 5x + 6 = 0"],
    ["3 x+4=19", "3x + 4 = 19"],
    ["\\left(x+3\\right)\\left(x+2\\right)", "(x + 3)(x + 2)"],
    ["2 x^{2}+3 x-2=0", "2x^{2} + 3x - 2 = 0"],
    ["2 \\cos x-1=0,\\ 0\\le x<2\\pi", "2\\cos x - 1 = 0, \\ 0 \\le x < 2\\pi"],
    ["\\frac{d}{d x}\\left(x^{4}\\right)", "\\frac{d}{dx}(x^{4})"],
    ["\\log _{3} 81", "\\log_{3} 81"],
    ["\\log_2 x=5", "\\log_{2} x = 5"],
    ["x=-3", "x = -3"],
    ["|x-3|=5", "|x - 3| = 5"],
    ["-3+8", "-3 + 8"],
    ["(-4)(6)", "(-4)(6)"],
    ["5-(-3)", "5 - (-3)"],
    ["x^{-2} \\cdot x^{5}", "x^{-2} \\cdot x^{5}"],
    ["\\int (3x^{2}+1)\\,dx", "\\int (3x^{2} + 1) \\, dx"],
    ["3-2x\\geq 7", "3 - 2x \\ge 7"],
    ["\\dfrac{x}{2}-5=1", "\\frac{x}{2} - 5 = 1"],
    ["5 \\mathrm{km} \\to \\mathrm{m}", "5 \\mathrm{km} \\to \\mathrm{m}"],
    ["2 \\sqrt{x}=8", "2\\sqrt{x} = 8"],
    ["\\lim_{x\\to 2}\\frac{x^{2}-4}{x-2}", "\\lim_{x \\to 2}\\frac{x^{2} - 4}{x - 2}"],
  ])("%s → %s", (read, tidied) => {
    expect(tidy(read)).toBe(tidied);
    expect(tidy(tidied)).toBe(tidied);
  });

  it("leaves every practice problem as it is (they are written in the conventions already), but for \\left( \\right)", () => {
    for (const skill of SKILL_IDS) {
      for (const seed of [1, 2, 3]) {
        for (const p of drawProblems(skill, 8, seed)) {
          expect(
            p.map(tidy),
            `${skill}: ${p.join("; ")}`,
          ).toEqual(p.map((l) => l.replace(/\\(?:left|right)(?![a-zA-Z])/g, "")));
        }
      }
    }
  });
});

describe("skeleton: the form without its numbers", () => {
  const same = (a: string[], b: string[]) => skeletonOf(a.map(tidy)) === skeletonOf(b.map(tidy));

  it("is one for problems that differ only in their numbers, however they were read", () => {
    expect(same(["3x + 4 = 19"], ["5x + 2 = 17"])).toBe(true);
    expect(same(["2x+3=11"], ["7x + 12 = 40"])).toBe(true);
    expect(same(["x^{2} - 5x + 6 = 0"], ["x^2-8x+15=0"])).toBe(true);
    expect(same(["x + y = 10", "x - y = 2"], ["x + y = 13", "x - y = 5"])).toBe(true);
    expect(same(["2.5 + 1.75"], ["3.25 + 4.5"])).toBe(true);
  });

  it("tells forms apart", () => {
    expect(same(["3x + 4 = 19"], ["3x - 4 = 19"])).toBe(false);
    expect(same(["3x + 4 = 19"], ["x + 4 = 19"])).toBe(false);
    expect(same(["x^{2} - 5x + 6 = 0"], ["x^{3} - 5x + 6 = 0"])).toBe(false);
    expect(same(["x^{2} - 5x + 6 = 0"], ["x^{2} - 5x + 6 = 1"])).toBe(false);
    expect(same(["2.5 + 1.5"], ["25 + 15"])).toBe(false);
    // the loose skeleton forgives the signs
    expect(looseSkeleton(skeletonOf(["3x + 4 = 19"]))).toBe(looseSkeleton(skeletonOf(["3x - 4 = 19"])));
  });

  it("keeps the numbers that are the form: 0, a square, the angle totals, a trig interval", () => {
    expect(skeletonOf(["x^{2} - 5x + 6 = 0"])).toBe("x^{2}-#x+#=0");
    expect(skeletonOf(["3^{2} + 4^{2} = c^{2}"])).toBe("#^{2}+#^{2}=c^{2}");
    expect(skeletonOf(["x + 65^{\\circ} = 180^{\\circ}"])).toBe("x+#^{\\circ}=180^{\\circ}");
    expect(skeletonOf(["2\\cos x - 1 = 0, \\ 0 \\le x < 2\\pi"])).toBe("#\\trigx-#=0,0\\lex<2\\pi");
    // a sine and a cosine equation have one form; the interval's spacing does not count
    expect(skeletonOf([tidy("2\\sin x - 1 = 0, 0 \\le x < 2\\pi")])).toBe(skeletonOf(["2\\cos x - 1 = 0, \\ 0 \\le x < 2\\pi"]));
    // an integral's upper limit is a number like any other, not a square
    expect(skeletonOf(["\\int_{0}^{2} x^{2} \\, dx"])).toBe("\\int_{0}^{#}x^{2}dx");
    expect(freeNumbers(["\\int_{0}^{2} x^{2} \\, dx"])).toEqual(["2"]);
  });
});

describe("answers compared", () => {
  it("a key: roots in any order, a system's every value", () => {
    expect(answerKey(["(x - 2)(x - 3) = 0", "x = 2, \\ x = 3"])).toBe(answerKey(["x = 3, \\ x = 2"]));
    expect(answerKey(["x = 4"])).not.toBe(answerKey(["x = 5"]));
    expect(answerKey(["y = 10 - x", "x = 6", "y = 10 - 6", "y = 4"])).toBe("x=6;y=4");
    expect(answerKey(["y = 13 - x", "x = 9", "y = 4"])).not.toBe(answerKey(["y = 10 - x", "x = 6", "y = 4"]));
  });

  it("a shape: the same kind of answer, whatever its numbers and signs", () => {
    expect(answerShape("x = 7")).toBe(answerShape("x = -4"));
    expect(answerShape("= 5x - 4")).toBe(answerShape("= x + 2"));
    expect(answerShape("x = 2, \\ x = 3")).toBe(answerShape("x = -5, \\ x = 1"));
    expect(answerShape("x = 7")).not.toBe(answerShape("x = \\frac{3}{7}"));
    expect(answerShape("x = 7")).not.toBe(answerShape("x = \\frac{\\ln 5}{\\ln 2}"));
    expect(answerShape("x = 2, \\ x = 3")).not.toBe(answerShape("x = 3"));
    expect(answerShape("= (x + 3)(x + 2)")).not.toBe(answerShape("= (x + 3)^{2}"));
  });

  it("a trig equation's answer from its numbers, without solving it", () => {
    const rad = ", \\ 0 \\le x < 2\\pi";
    expect(trigKey(`2\\cos x - 1 = 0${rad}`)).toBe(trigKey(`\\cos x = \\frac{1}{2}${rad}`));
    expect(trigKey(`2\\cos x - 1 = 0${rad}`)).toBe(trigKey(`6\\cos x = 3${rad}`));
    expect(trigKey(`2\\cos x - 1 = 0${rad}`)).not.toBe(trigKey(`2\\sin x - 1 = 0${rad}`));
    expect(trigKey(`2\\cos x - 1 = 0${rad}`)).not.toBe(trigKey("2\\cos x - 1 = 0, \\ 0^{\\circ} \\le x < 360^{\\circ}"));
    expect(trigKey(`2\\sin x + \\sqrt{3} = 0${rad}`)).toBe(trigKey(`\\sin x = -\\frac{\\sqrt{3}}{2}${rad}`));
    expect(trigKey("\\sin^{2} x = 1")).toBeNull();
  });
});

describe("nudged numbers", () => {
  it("keep the form's numbers, keep equal numbers equal and different ones different", () => {
    for (const p of nudgedCandidates(["(x - 3)(x + 3)"], 1)) {
      const [a, b] = freeNumbers(p);
      expect(a).toBe(b);
    }
    for (const p of nudgedCandidates(["3^{2} + 4^{2} = c^{2}"], 1)) {
      expect(skeletonOf(p)).toBe("#^{2}+#^{2}=c^{2}");
      const [a, b] = freeNumbers(p);
      expect(a).not.toBe(b);
    }
    for (const p of nudgedCandidates(["x + 40 + 65 = 180"], 2)) expect(p[0]).toMatch(/= 180$/);
  });

  it("never write a coefficient or a power of 1", () => {
    for (const seed of [1, 2, 3])
      for (const p of nudgedCandidates(["2x + 3y = 12", "y = 3x - 2"], seed)) expect(p.join(" ")).not.toMatch(/(?<![\d.])1[a-z(]|\^\{1\}/);
  });

  it("are the same for the same seed", () => {
    expect(nudgedCandidates(["3x + 4 = 19"], 5)).toEqual(nudgedCandidates(["3x + 4 = 19"], 5));
    expect(nudgedCandidates(["3x + 4 = 19"], 5)).not.toEqual(nudgedCandidates(["3x + 4 = 19"], 6));
  });
});

describe("the seeded generator", () => {
  it("is the same for the same seed, whatever the seed is", () => {
    for (const seed of [0, 1, -7, 3.5, 1e12, Number.NaN]) {
      const a = makeRng(seedFrom(seed, "x"));
      const b = makeRng(seedFrom(seed, "x"));
      for (let i = 0; i < 20; i++) expect(a.int(0, 100)).toBe(b.int(0, 100));
    }
  });

  it("every practised skill has at least two forms", () => {
    for (const skill of SKILL_IDS) if (formsFor(skill).length > 0) expect(formsFor(skill).length, skill).toBeGreaterThanOrEqual(2);
  });
});
