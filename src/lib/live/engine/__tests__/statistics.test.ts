import { beforeAll, describe, expect, it } from "vitest";
import type { EngineVerdict, LiveEngine } from "../../contracts";
import { planHandwriting } from "../../handwriting";
import { analyzeColumn, localSolve } from "../../localSolve";
import { getEngine } from "..";

/**
 * Statistics of a data list (`statistics.ts`): median, mode, range, Q1, Q3, IQR, the five-number
 * summary, the mean and the standard deviation (σ population, s sample, an unnamed SD the
 * population's), asked for by symbol or by the student's own word. Quartiles: the median of each
 * half, the median itself in neither half when n is odd (TI-84). Exact, with 2-place ≈ only for
 * a standard deviation that is not exact. A data list never takes a sequence's, a point's or a
 * solution list's question.
 */

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

const solveIn = (lines: string[]) => localSolve(engine, lines);
const verdicts = (lines: string[]): EngineVerdict[] => analyzeColumn(engine, lines, "feedback").map((a) => a?.verdict ?? "none");

/** Drawable, and no word but one the student wrote. */
function expectDrawable(steps: readonly string[], lines: readonly string[]) {
  const plan = planHandwriting(steps, { size: 28, seed: 1 });
  expect(plan.unsupported).toEqual([]);
  const own = lines.join(" ");
  for (const s of steps) for (const m of s.matchAll(/\\text\s*\{([^}]*)\}/g)) expect(own).toContain(m[0]);
}

describe("median, mode, range", () => {
  it.each([
    // sorted first, then the middle value (the student's own word on the answer line)
    [["12, 3, 15, 7, 8", "\\text{median} = ?"], ["3, 7, 8, 12, 15", "\\text{median} = 8"]],
    [["3, 7, 8, 12", "\\text{median} = ?"], ["\\text{median} = \\frac{7 + 8}{2}", "\\text{median} = 7.5"]],
    [["3, 7, 8, 12", "\\operatorname{med} ="], ["\\operatorname{med} = \\frac{7 + 8}{2}", "\\operatorname{med} = 7.5"]],
    [["\\{4, 1, 9, 6, 2, 8\\}", "Q_{2} = ?"], ["1, 2, 4, 6, 8, 9", "Q_{2} = \\frac{4 + 6}{2}", "Q_{2} = 5"]],
    [["-3, 5, 7, 2", "\\text{Median} = ?"], ["-3, 2, 5, 7", "\\text{Median} = \\frac{2 + 5}{2}", "\\text{Median} = 3.5"]],
    // modes: one, several, none
    [["2, 3, 3, 5, 7", "\\text{mode} = ?"], ["\\text{mode} = 3"]],
    [["7, 3, 2, 7, 3, 9, 5", "\\text{mode} = ?"], ["2, 3, 3, 5, 7, 7, 9", "\\text{mode} = 3, \\ 7"]],
    [["2, 3, 5, 7", "\\text{mode} = ?"], ["\\text{mode} = \\varnothing"]],
    [["3, 7, 8, 12, 15", "\\text{range} = ?"], ["\\text{range} = 15 - 3", "\\text{range} = 12"]],
    [["-3, 5, 7, 2", "\\text{range} = ?"], ["-3, 2, 5, 7", "\\text{range} = 7 - (-3)", "\\text{range} = 10"]],
  ])("%j", (lines, steps) => {
    const got = solveIn(lines);
    expect(got.source).toBe("solveFromLines");
    expect(got.steps).toEqual(steps);
    expectDrawable(steps, lines);
  });

  it("reads the names as Mathpix writes them", () => {
    const last = (ask: string) => solveIn(["3, 7, 8, 12, 15", ask]).steps.at(-1);
    expect(last("\\text { median }=?")).toBe("\\text{median} = 8");
    expect(last("\\text{MEDIAN} =")).toBe("\\text{MEDIAN} = 8");
    expect(last("\\text{median}:")).toBe("\\text{median} = 8");
    expect(last("\\text{Median:}")).toBe("\\text{Median} = 8");
    expect(last("Q1 = ?")).toBe("Q_{1} = 5");
    expect(last("\\text{Q1} = ?")).toBe("\\text{Q1} = 5");
    expect(last("\\mathrm{Q}_{3} = ?")).toBe("\\mathrm{Q}_{3} = 13.5");
    expect(last("I Q R = ?")).toBe("I Q R = 8.5");
    expect(last("\\bar x = ?")).toBe("\\bar{x} = 9");
    expect(last("\\sigma_{x} = ?")).toBe("\\sigma_{x} \\approx 4.15");
    expect(last("s_x = ?")).toBe("s_{x} \\approx 4.64");
  });

  it("every value repeated equally often has no agreed mode: not answered", () => {
    expect(solveIn(["2, 2, 5, 5", "\\text{mode} = ?"]).source).toBeNull();
  });
});

describe("quartiles, IQR, the five-number summary (the median of each half, the median itself in neither)", () => {
  it.each([
    [["3, 7, 8, 12, 15", "Q_{1} = ?"], ["Q_{1} = \\frac{3 + 7}{2}", "Q_{1} = 5"]],
    [["3, 7, 8, 12, 15", "Q_{3} = ?"], ["Q_{3} = \\frac{12 + 15}{2}", "Q_{3} = 13.5"]],
    [["3, 7, 8, 12, 15, 20", "IQR = ?"], ["Q_{1} = 7", "Q_{3} = 15", "IQR = Q_{3} - Q_{1}", "IQR = 15 - 7", "IQR = 8"]],
    [
      ["8, 1, 7, 2, 6, 3, 5, 4", "IQR = ?"],
      ["1, 2, 3, 4, 5, 6, 7, 8", "Q_{1} = \\frac{2 + 3}{2}", "Q_{1} = 2.5", "Q_{3} = \\frac{6 + 7}{2}", "Q_{3} = 6.5", "IQR = Q_{3} - Q_{1}", "IQR = 6.5 - 2.5", "IQR = 4"],
    ],
    [["3, 7, 8, 12, 15, 20", "\\text{five number summary}"], ["Q_{2} = \\frac{8 + 12}{2}", "Q_{2} = 10", "Q_{1} = 7", "Q_{3} = 15", "3, \\ 7, \\ 10, \\ 15, \\ 20"]],
  ])("%j", (lines, steps) => {
    const got = solveIn(lines);
    expect(got.steps).toEqual(steps);
    expectDrawable(steps, lines);
  });
});

describe("the mean and the standard deviation", () => {
  it.each([
    // the mean as before, and with the student's word
    [["3, 5, 7, 9, 11", "\\bar{x} = ?"], ["\\bar{x} = \\frac{3 + 5 + 7 + 9 + 11}{5}", "\\bar{x} = \\frac{35}{5}", "\\bar{x} = 7"]],
    [["2, 4, 4, 5", "\\bar{x} = ?"], ["\\bar{x} = \\frac{2 + 4 + 4 + 5}{4}", "\\bar{x} = \\frac{15}{4}"]],
    [["3, 5, 7, 9, 11", "\\text{Mean} = ?"], ["\\text{Mean} = \\frac{3 + 5 + 7 + 9 + 11}{5}", "\\text{Mean} = \\frac{35}{5}", "\\text{Mean} = 7"]],
    // decimals stay decimals (not `\frac{\frac{5}{2} + …}{3}`)
    [["2.5, 3.5, 1.5", "\\bar{x} = ?"], ["\\bar{x} = \\frac{2.5 + 3.5 + 1.5}{3}", "\\bar{x} = \\frac{7.5}{3}", "\\bar{x} = 2.5"]],
    // σ: the mean, the squared deviations, ÷ n, the root, 2 places
    [
      ["3, 7, 8, 12, 15", "\\sigma = ?"],
      ["\\bar{x} = \\frac{3 + 7 + 8 + 12 + 15}{5}", "\\bar{x} = 9", "\\sigma = \\sqrt{\\frac{(3 - 9)^{2} + (7 - 9)^{2} + (8 - 9)^{2} + (12 - 9)^{2} + (15 - 9)^{2}}{5}}", "\\sigma = \\sqrt{\\frac{36 + 4 + 1 + 9 + 36}{5}}", "\\sigma = \\sqrt{\\frac{86}{5}}", "\\sigma \\approx 4.15"],
    ],
    // s: ÷ (n − 1)
    [
      ["3, 7, 8, 12, 15", "s = ?"],
      ["\\bar{x} = \\frac{3 + 7 + 8 + 12 + 15}{5}", "\\bar{x} = 9", "s = \\sqrt{\\frac{(3 - 9)^{2} + (7 - 9)^{2} + (8 - 9)^{2} + (12 - 9)^{2} + (15 - 9)^{2}}{4}}", "s = \\sqrt{\\frac{36 + 4 + 1 + 9 + 36}{4}}", "s = \\sqrt{\\frac{86}{4}}", "s = \\sqrt{\\frac{43}{2}}", "s \\approx 4.64"],
    ],
    // an exact standard deviation
    [
      ["2, 4, 4, 4, 5, 5, 7, 9", "\\sigma = ?"],
      ["\\bar{x} = \\frac{2 + 4 + 4 + 4 + 5 + 5 + 7 + 9}{8}", "\\bar{x} = 5", "\\sigma = \\sqrt{\\frac{9 + 1 + 1 + 1 + 0 + 0 + 4 + 16}{8}}", "\\sigma = \\sqrt{\\frac{32}{8}}", "\\sigma = \\sqrt{4}", "\\sigma = 2"],
    ],
    // an unnamed SD is the population's
    [
      ["3, 7, 8, 12, 15", "\\text{SD} = ?"],
      ["\\bar{x} = \\frac{3 + 7 + 8 + 12 + 15}{5}", "\\bar{x} = 9", "\\text{SD} = \\sqrt{\\frac{(3 - 9)^{2} + (7 - 9)^{2} + (8 - 9)^{2} + (12 - 9)^{2} + (15 - 9)^{2}}{5}}", "\\text{SD} = \\sqrt{\\frac{36 + 4 + 1 + 9 + 36}{5}}", "\\text{SD} = \\sqrt{\\frac{86}{5}}", "\\text{SD} \\approx 4.15"],
    ],
    // a mean with a long decimal: the squared deviations summed exactly, not written out
    [["3, 7, 8, 12, 15, 20", "\\sigma = ?"], ["\\bar{x} = \\frac{3 + 7 + 8 + 12 + 15 + 20}{6}", "\\bar{x} = \\frac{65}{6}", "\\sigma = \\sqrt{\\frac{1121}{36}}", "\\sigma \\approx 5.58"]],
  ])("%j", (lines, steps) => {
    const got = solveIn(lines);
    expect(got.steps).toEqual(steps);
    expectDrawable(steps, lines);
  });
});

describe("a data list never takes another list's question", () => {
  it("sequences, points, a solution list, a bare list", () => {
    expect(solveIn(["3, 7, 11, 15, \\ldots", "a_{10} = ?"]).steps.at(-1)).toBe("a_{10} = 39");
    expect(solveIn(["3, 7, 11, 15", "a_{10} = ?"]).steps.at(-1)).toBe("a_{10} = 39");
    expect(solveIn(["2, 6, 18, \\ldots", "S_{6} = ?"]).steps.at(-1)).toBe("S_{6} = 728");
    // a list with \ldots is a sequence: its median is not a statistic of data
    expect(solveIn(["3, 7, 11, \\ldots", "\\text{median} = ?"]).source).toBeNull();
    expect(solveIn(["(2, 3), (5, 9)", "m = ?"]).steps.at(-1)).toBe("m = 2");
    expect(solveIn(["3, 7, 8, 12, 15"]).source).toBeNull();
    expect(analyzeColumn(engine, ["x = 2, 3"])[0]?.kind).toBe("assignment");
  });
});

describe("the student's own statistics are checked", () => {
  it("the data sorted is ticked; a list with other values is not ringed (it may be a second data set)", () => {
    expect(verdicts(["12, 3, 15, 7, 8", "3, 7, 8, 12, 15"])).toEqual(["none", "ok"]);
    expect(verdicts(["12, 3, 15, 7, 8", "3, 7, 12, 8, 15"])).toEqual(["none", "none"]);
    expect(verdicts(["12, 3, 15, 7, 8", "4, 9, 1, 6, 2"])).toEqual(["none", "none"]);
  });

  it("a right claim ticked, a wrong one ringed — three lines down as well", () => {
    expect(verdicts(["3, 7, 8, 12, 15", "\\text{median} = 8"])).toEqual(["none", "ok"]);
    expect(verdicts(["3, 7, 8, 12, 15", "\\text{median} = 9"])).toEqual(["none", "mismatch"]);
    expect(verdicts(["12, 3, 15, 7, 8", "3, 7, 8, 12, 15", "Q_{1} = 5", "Q_{3} = 13.5", "IQR = 8.5"])).toEqual(["none", "ok", "ok", "ok", "ok"]);
    expect(verdicts(["12, 3, 15, 7, 8", "3, 7, 8, 12, 15", "Q_{1} = 5", "Q_{3} = 13.5", "IQR = 9.5"])).toEqual(["none", "ok", "ok", "ok", "mismatch"]);
    expect(verdicts(["3, 7, 8, 12, 15", "\\text{range} = 12", "\\text{range} = 15"])).toEqual(["none", "ok", "mismatch"]);
    expect(verdicts(["3, 7, 8, 12, 15", "\\bar{x} = 9", "\\bar{x} = 10"])).toEqual(["none", "ok", "mismatch"]);
  });

  it("a standard deviation to the places written; σ population, s sample", () => {
    expect(verdicts(["3, 7, 8, 12, 15", "\\sigma \\approx 4.15", "\\sigma = 4.1", "s \\approx 4.64"])).toEqual(["none", "ok", "ok", "ok"]);
    expect(verdicts(["3, 7, 8, 12, 15", "\\sigma \\approx 4.64"])).toEqual(["none", "mismatch"]);
    expect(verdicts(["3, 7, 8, 12, 15", "s \\approx 4.15"])).toEqual(["none", "mismatch"]);
    expect(verdicts(["3, 7, 8, 12, 15", "\\sigma = \\sqrt{\\frac{86}{5}}"])).toEqual(["none", "ok"]);
  });

  it("never rings a value that is right by another common convention", () => {
    // Q1 with the median in the lower half (7), or by interpolation (7): left unmarked
    expect(verdicts(["3, 7, 8, 12, 15", "Q_{1} = 7"])).toEqual(["none", "none"]);
    expect(verdicts(["3, 7, 8, 12, 15", "Q_{1} = 6"])).toEqual(["none", "mismatch"]);
    // the sample value under a name that does not say which
    expect(verdicts(["3, 7, 8, 12, 15", "\\text{SD} \\approx 4.64"])).toEqual(["none", "none"]);
    expect(verdicts(["3, 7, 8, 12, 15", "\\text{SD} \\approx 4.15"])).toEqual(["none", "ok"]);
    // some of the modes: incomplete, not wrong
    expect(verdicts(["2, 3, 3, 5, 7, 7, 9", "\\text{mode} = 3, 7", "\\text{mode} = 3", "\\text{mode} = 5"])).toEqual(["none", "ok", "none", "mismatch"]);
    expect(verdicts(["2, 3, 5, 7", "\\text{mode} = \\varnothing"])).toEqual(["none", "ok"]);
  });

  it("an ask under a list is not a word problem (Solve answers it); Solve on a claim is not `x = 10`", () => {
    for (const ask of ["\\text{mode} = ?", "\\text{range} = ?", "\\text{standard deviation} = ?", "\\text{five number summary}"]) {
      const [, a] = analyzeColumn(engine, ["3, 7, 8, 12, 15", ask], "answer");
      expect(a?.kind, ask).toBe("unknown");
    }
    expect(solveIn(["3, 7, 8, 12, 15", "\\bar{x} = 10"]).steps).not.toContain("x = 10");
    // without a list above, a word is still prose
    expect(analyzeColumn(engine, ["\\text{mode} = ?"], "answer")[0]?.kind).toBe("text");
  });
});
