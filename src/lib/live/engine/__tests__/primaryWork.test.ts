import { describe, expect, it } from "vitest";
import { judgePrimaryLine, readProblem } from "../primaryWork";

/**
 * A young student's working judged against the problem it is under (`engine/primaryWork.ts`). The
 * cases are prod's (`18 \times 7`, `27 \times 9`, `34 \times 7`, `13 \times 4`, `4+3`, `5+6`, `8+1`,
 * `144 \div 9`, `42 \div 7`, `30 \div 5`, `5.4 \times 0.1`, 2026-10-03 to 10-08) and a primary
 * teacher's: what is ticked, what is ringed, what is let be, and what solves the problem.
 */

/** Each line judged under `problem` with the lines before it above it: [verdict, solved] per line. */
function column(problem: string, lines: string[]): Array<[string, boolean] | null> {
  return lines.map((line, i) => {
    const j = judgePrimaryLine([problem], lines.slice(0, i), line);
    return j ? [j.verdict, j.solved] : null;
  });
}

const TICK: [string, boolean] = ["ok", false];
const SOLVED: [string, boolean] = ["ok", true];
const RING: [string, boolean] = ["mismatch", false];
const NONE: [string, boolean] = ["none", false];

describe("side calculations: true is never ringed, and only the answer solves it", () => {
  it("18 × 7 in side calculations (prod: 8 lines, 3 rings, none right)", () => {
    expect(column("18 \\times 7", ["10 \\times 7 = 70", "8 \\times 7 = 56", "70 + 56 = 126"])).toEqual([TICK, TICK, SOLVED]);
  });

  it("the partial products alone are no wrong answers; the product is the answer", () => {
    expect(column("18 \\times 7", ["70", "56", "126"])).toEqual([NONE, NONE, SOLVED]);
    expect(column("27 \\times 9", ["180", "63", "243"])).toEqual([NONE, NONE, SOLVED]);
    expect(column("34 \\times 7", ["210", "28", "238"])).toEqual([NONE, NONE, SOLVED]);
  });

  it("13 × 4, 27 × 9, 34 × 7 worked by place value", () => {
    expect(column("13 \\times 4", ["10 \\times 4 = 40", "3 \\times 4 = 12", "40 + 12 = 52"])).toEqual([TICK, TICK, SOLVED]);
    expect(column("27 \\times 9", ["20 \\times 9 = 180", "7 \\times 9 = 63", "180 + 63 = 243"])).toEqual([TICK, TICK, SOLVED]);
    expect(column("34 \\times 7", ["30 \\times 7 = 210", "4 \\times 7 = 28", "210 + 28 = 238"])).toEqual([TICK, TICK, SOLVED]);
  });

  it("rounded and given back, or times ten and one taken back", () => {
    expect(column("18 \\times 7", ["20 \\times 7 = 140", "2 \\times 7 = 14", "140 - 14 = 126"])).toEqual([TICK, TICK, SOLVED]);
    expect(column("27 \\times 9", ["27 \\times 10 = 270", "270 - 27 = 243"])).toEqual([TICK, SOLVED]);
  });

  it("a false side calculation is ringed; the fix under it is ticked", () => {
    expect(column("18 \\times 7", ["8 \\times 7 = 54", "8 \\times 7 = 56"])).toEqual([RING, TICK]);
  });

  it("a true line that is no step of this problem is let be, and never solves it", () => {
    expect(column("18 \\times 7", ["6 \\times 21 = 126"])).toEqual([NONE]);
    expect(column("4+3", ["2 + 5 = 7"])).toEqual([NONE]);
  });

  it("a wrong answer is still ringed — alone, claimed with =, or as the problem written out", () => {
    expect(column("18 \\times 7", ["116"])).toEqual([RING]);
    expect(column("18 \\times 7", ["= 136"])).toEqual([RING]);
    expect(column("18 \\times 7", ["18 \\times 7 = 136"])).toEqual([RING]);
    expect(column("13 \\times 4", ["10 \\times 4 = 40", "3 \\times 4 = 12", "42"])).toEqual([TICK, TICK, RING]);
  });

  it("carried on from a ringed line: no second ring, and not solved", () => {
    const j = (above: string[], line: string) => judgePrimaryLine(["18 \\times 7"], above, line);
    expect(j(["8 \\times 7 = 54"], "70 + 54 = 124")).toMatchObject({ verdict: "none", carried: true });
    expect(j(["8 \\times 7 = 54", "70 + 54 = 124"], "124")).toMatchObject({ verdict: "none", carried: true });
  });

  it("one line, the whole chain", () => {
    expect(column("18 \\times 7", ["18 \\times 7 = 10 \\times 7 + 8 \\times 7 = 70 + 56 = 126"])).toEqual([SOLVED]);
    // `=` used as "then": each link starts with the value before it
    expect(column("25 + 17", ["20 + 10 = 30 + 12 = 42"])).toEqual([SOLVED]);
  });

  it("a rewrite of the problem is ticked; claimed with = and worth something else, ringed", () => {
    expect(column("18 \\times 7", ["10 \\times 7 + 8 \\times 7", "= 70 + 56", "= 126"])).toEqual([TICK, TICK, SOLVED]);
    expect(column("18 \\times 7", ["= 70 + 54"])).toEqual([RING]);
    expect(column("18 \\times 7", ["10 \\times 7"])).toEqual([NONE]);
  });

  it("with the order of operations, a true line in the wrong order is no step; the answer is what is ringed", () => {
    expect(column("3 + 4 \\times 2", ["4 \\times 2 = 8", "3 + 8 = 11"])).toEqual([TICK, SOLVED]);
    expect(column("3 + 4 \\times 2", ["3 + 4 = 7", "7 \\times 2 = 14", "14"])).toEqual([NONE, NONE, RING]);
  });
});

describe("the youngest: a number alone", () => {
  it("a lone 7 under 4 + 3 solves it; a wrong digit is ringed", () => {
    expect(column("4+3", ["7"])).toEqual([SOLVED]);
    expect(column("4+3", ["= 7"])).toEqual([SOLVED]);
    expect(column("4+3", ["8"])).toEqual([RING]);
    expect(column("4+3", ["43"])).toEqual([RING]);
    expect(judgePrimaryLine(["4+3"], [], "7")).toMatchObject({ bare: true });
  });

  it("8+1 (prod: ticked, never finished): the stray marks round a wobbly answer are no part of it", () => {
    for (const read of ["= 9.", "9.", "9,", "9^{\\prime}", "9 \\cdot", "\\cdot 9", "9'"]) expect(column("8+1", [read]), read).toEqual([SOLVED]);
  });

  it("5+6 (prod: a 'sign' mistake): a minus before the answer to a sum is a wobbly =", () => {
    expect(column("5+6", ["-11"])).toEqual([SOLVED]);
    // ...but not where negative numbers are the work
    expect(column("-3 - 7", ["-10"])).toEqual([SOLVED]);
    expect(column("-3 - 7", ["10"])).toEqual([RING]);
  });

  it("doubles and making ten are steps of a small sum", () => {
    expect(column("5+6", ["5 + 5 = 10", "10 + 1 = 11"])).toEqual([TICK, SOLVED]);
    expect(column("8+5", ["8 + 2 = 10", "10 + 3 = 13"])).toEqual([TICK, SOLVED]);
    expect(column("12 - 5", ["12 - 2 = 10", "10 - 3 = 7"])).toEqual([TICK, SOLVED]);
  });

  it("a small sum has no partial results: any other number is a wrong answer", () => {
    expect(column("7 + 8", ["14"])).toEqual([RING]);
    expect(column("6 \\times 7", ["48"])).toEqual([RING]);
  });

  it("two-digit sums: partial sums are not wrong, a sum with no carry is", () => {
    expect(column("47 + 38", ["70", "15", "85"])).toEqual([NONE, NONE, SOLVED]);
    expect(column("47 + 38", ["715"])).toEqual([RING]);
    expect(column("52 - 17", ["42", "35"])).toEqual([NONE, SOLVED]);
    expect(column("52 - 17", ["45"])).toEqual([RING]);
  });
});

describe("division", () => {
  it("144 ÷ 9 = 16 inline, or 16 alone, solves it (prod: never credited)", () => {
    expect(column("144 \\div 9", ["144 \\div 9 = 16"])).toEqual([SOLVED]);
    expect(column("144 \\div 9", ["16"])).toEqual([SOLVED]);
    expect(column("42 \\div 7", ["7 \\times 6 = 42", "6"])).toEqual([TICK, SOLVED]);
    expect(column("30 \\div 5", ["5 \\times 6 = 30", "= 6"])).toEqual([TICK, SOLVED]);
    expect(column("144 \\div 9", ["15"])).toEqual([RING]);
  });

  it("chunking: the quotient a place at a time", () => {
    expect(column("144 \\div 9", ["9 \\times 10 = 90", "144 - 90 = 54", "9 \\times 6 = 54", "10 + 6 = 16"])).toEqual([TICK, TICK, TICK, SOLVED]);
  });

  it("the bracket: the right quotient over it solves it; none yet, or its first digit, is no mark; a wrong one is ringed", () => {
    expect(column("144 \\div 9", ["\\begin{array}{r} 16 \\\\ 9 \\longdiv { 144 } \\end{array}"])).toEqual([SOLVED]);
    expect(column("144 \\div 9", ["\\frac{16}{9 \\longdiv { 144 }}"])).toEqual([SOLVED]);
    expect(column("144 \\div 9", ["\\begin{array}{r} 16 \\\\ 9 \\enclose{longdiv}{144} \\end{array}"])).toEqual([SOLVED]);
    expect(column("144 \\div 9", ["\\begin{array}{r} 16 \\\\ 9 ) \\overline{144} \\end{array}"])).toEqual([SOLVED]);
    expect(column("144 \\div 9", ["9 \\longdiv { 144 }"])).toEqual([NONE]);
    expect(column("144 \\div 9", ["\\begin{array}{r} 1 \\\\ 9 \\longdiv { 144 } \\end{array}"])).toEqual([NONE]);
    expect(column("144 \\div 9", ["\\begin{array}{r} 14 \\\\ 9 \\longdiv { 144 } \\end{array}"])).toEqual([RING]);
  });

  it("the bracket is a problem of its own on a blank board, and its working under it is never ringed", () => {
    expect(judgePrimaryLine([], [], "\\begin{array}{r} 16 \\\\ 9 \\longdiv { 144 } \\\\ \\underline{9} \\\\ 54 \\\\ \\underline{54} \\\\ 0 \\end{array}")).toMatchObject({ verdict: "ok", solved: true });
    expect(column("144 \\div 9", ["9 \\longdiv { 144 }", "-9", "54", "-54", "0", "16"])).toEqual([NONE, NONE, NONE, NONE, NONE, SOLVED]);
  });

  it("remainders: `3 R 2` is right when 3 × 5 + 2 is 17 and 2 is less than 5", () => {
    for (const read of ["3 R 2", "3 r 2", "3 \\text { R } 2", "3 \\mathrm{R} 2", "17 \\div 5 = 3 R 2", "3\\frac{2}{5}", "3.4"]) expect(column("17 \\div 5", [read]), read).toEqual([SOLVED]);
    expect(column("17 \\div 5", ["3 R 3"])).toEqual([RING]);
    expect(column("17 \\div 5", ["4 R 3"])).toEqual([RING]);
    expect(judgePrimaryLine(["17 \\div 5"], [], "2 R 7")).toMatchObject({ verdict: "mismatch", note: "The remainder must be less than 5." });
    // the quotient alone: right so far, the remainder still to come
    expect(column("17 \\div 5", ["3"])).toEqual([NONE]);
    expect(column("17 \\div 5", ["5 \\times 3 = 15", "17 - 15 = 2", "3 R 2"])).toEqual([TICK, TICK, SOLVED]);
    expect(column("100 \\div 7", ["\\begin{array}{r} 14 R 2 \\\\ 7 \\longdiv { 100 } \\end{array}"])).toEqual([SOLVED]);
  });

  it("an answer with no end, rounded right", () => {
    expect(column("10 \\div 3", ["3.33"])).toEqual([SOLVED]);
    expect(column("10 \\div 3", ["3.3"])).toEqual([SOLVED]);
    expect(column("10 \\div 3", ["3.4"])).toEqual([RING]);
  });
});

describe("fractions and decimals, grades 4–6", () => {
  it("equivalent fractions and a common denominator are steps; the sum solves it", () => {
    expect(column("\\frac{1}{2} + \\frac{1}{3}", ["\\frac{1}{2} = \\frac{3}{6}", "\\frac{1}{3} = \\frac{2}{6}", "\\frac{3}{6} + \\frac{2}{6} = \\frac{5}{6}"])).toEqual([TICK, TICK, SOLVED]);
    expect(column("\\frac{1}{2} + \\frac{1}{3}", ["\\frac{3}{6} + \\frac{2}{6}", "= \\frac{5}{6}"])).toEqual([TICK, SOLVED]);
    expect(column("\\frac{2}{3} + \\frac{1}{4}", ["\\frac{8}{12} + \\frac{3}{12} = \\frac{11}{12}"])).toEqual([SOLVED]);
  });

  it("a wrong equivalent fraction, tops and bottoms added: ringed", () => {
    expect(column("\\frac{1}{2} + \\frac{1}{3}", ["\\frac{1}{2} = \\frac{2}{6}"])).toEqual([RING]);
    expect(column("\\frac{1}{2} + \\frac{1}{3}", ["\\frac{2}{5}"])).toEqual([RING]);
  });

  it("right but not in its simplest form: a tick, not finished; simplified at the end, solved", () => {
    expect(column("\\frac{5}{6} - \\frac{1}{3}", ["\\frac{3}{6}"])).toEqual([TICK]);
    expect(column("\\frac{5}{6} - \\frac{1}{3}", ["\\frac{5}{6} - \\frac{2}{6} = \\frac{3}{6}", "= \\frac{1}{2}"])).toEqual([TICK, SOLVED]);
    expect(column("\\frac{3}{4} + \\frac{1}{4}", ["\\frac{4}{4} = 1"])).toEqual([SOLVED]);
    expect(column("\\frac{6}{8}", ["\\frac{3}{4}"])).toEqual([SOLVED]);
  });

  it("mixed numbers: rewritten, improper, wholes and parts apart — any simplest form", () => {
    expect(column("2\\frac{1}{3} + 1\\frac{1}{2}", ["2\\frac{2}{6} + 1\\frac{3}{6}", "= 3\\frac{5}{6}"])).toEqual([TICK, SOLVED]);
    expect(column("2\\frac{1}{3} + 1\\frac{1}{2}", ["\\frac{7}{3} + \\frac{3}{2}", "= \\frac{14}{6} + \\frac{9}{6}", "= \\frac{23}{6}"])).toEqual([TICK, TICK, SOLVED]);
    expect(column("2\\frac{1}{3} + 1\\frac{1}{2}", ["2 + 1 = 3", "\\frac{1}{3} + \\frac{1}{2} = \\frac{5}{6}", "3\\frac{5}{6}"])).toEqual([TICK, TICK, SOLVED]);
    expect(column("2\\frac{1}{3} + 1\\frac{1}{2}", ["3\\frac{2}{5}"])).toEqual([RING]);
  });

  it("times and divide: keep, change, flip", () => {
    expect(column("\\frac{3}{4} \\times \\frac{2}{3}", ["\\frac{3 \\times 2}{4 \\times 3} = \\frac{6}{12} = \\frac{1}{2}"])).toEqual([SOLVED]);
    expect(column("\\frac{1}{2} \\div \\frac{1}{4}", ["\\frac{1}{2} \\times \\frac{4}{1} = \\frac{4}{2} = 2"])).toEqual([SOLVED]);
    expect(column("\\frac{1}{2} \\div \\frac{1}{4}", ["\\frac{1}{8}"])).toEqual([RING]);
  });

  it("5.4 × 0.1 = 0.54 (prod: unfinished after 4 asks), however the point is written", () => {
    for (const read of ["0.54", ".54", "5.4 \\times 0.1 = 0.54", "5.4 \\div 10 = 0.54", "0 \\cdot 54"]) expect(column("5.4 \\times 0.1", [read]), read).toEqual([SOLVED]);
    expect(column("5.4 \\times 0.1", ["54 \\times 1 = 54", "0.54"])).toEqual([TICK, SOLVED]);
    expect(column("5.4 \\times 0.1", ["5.04"])).toEqual([RING]);
  });

  it("a wrong decimal answer is ringed, as a wrong whole number is (the grade starters' decimals)", () => {
    // decimals_add_subtract
    expect(column("3.45 + 2.8", ["= 6.25"])).toEqual([SOLVED]);
    for (const wrong of ["= 5.25", "5.25", "3.73", "625", "3.45 + 2.8 = 5.25"]) expect(column("3.45 + 2.8", [wrong]), wrong).toEqual([RING]);
    expect(column("5.6 - 2.75", ["5.60 - 2.75 = 2.85"])).toEqual([SOLVED]);
    for (const wrong of ["= 2.95", "3.15"]) expect(column("5.6 - 2.75", [wrong]), wrong).toEqual([RING]);
    // decimals_multiply: the point lost or moved is a wrong answer; the digits multiplied is a step
    expect(column("1.2 \\times 3", ["= 3.6"])).toEqual([SOLVED]);
    for (const wrong of ["3.06", "36"]) expect(column("1.2 \\times 3", [wrong]), wrong).toEqual([RING]);
    expect(column("1.2 \\times 3", ["12 \\times 3 = 36", "3.6"])).toEqual([TICK, SOLVED]);
    for (const wrong of ["0.054", "= 54", "5.04"]) expect(column("5.4 \\times 0.1", [wrong]), wrong).toEqual([RING]);
  });

  it("decimal place value in sums and products", () => {
    expect(column("3.5 + 1.25", ["3.50 + 1.25 = 4.75"])).toEqual([SOLVED]);
    expect(column("3.5 + 1.25", ["1.60"])).toEqual([RING]);
    expect(column("2.4 \\times 3", ["24 \\times 3 = 72", "7.2"])).toEqual([TICK, SOLVED]);
    expect(column("1.2 - 0.35", ["0.85"])).toEqual([SOLVED]);
  });
});

describe("what it leaves to the column's own rules (null)", () => {
  it.each<[string[], string, string]>([
    [["2x + 3 = 11"], "2x = 8", "a problem with letters"],
    [["18 \\times 7"], "x = 4", "a line with letters"],
    [["18 \\times 7"], "70 + 56 =", "a line asking for its answer"],
    [["18 \\times 7"], "126 \\approx 130", "a relation other than ="],
    [["18 \\times 7"], "18 \\times 7", "the problem itself"],
    [["18 \\times 7"], "\\sqrt{126}", "a root"],
    [["x + y = 5", "x - y = 1"], "2x = 6", "a problem of two lines"],
  ])("%s / %s: %s", (problem, line) => {
    expect(judgePrimaryLine(problem, [], line)).toBeNull();
  });

  it("reads the problem without the place for its answer", () => {
    expect(readProblem(["18 \\times 7 ="])).not.toBeNull();
    expect(readProblem(["18 \\times 7 = ?"])).not.toBeNull();
    expect(readProblem(["18 \\times 7 = \\underline{\\quad}"])).not.toBeNull();
    expect(readProblem(["18 \\times 7 = 126"])).toBeNull();
  });
});
