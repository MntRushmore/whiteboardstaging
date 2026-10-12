import { beforeAll, describe, expect, it } from "vitest";
import { all, create, type MathNode } from "mathjs";

import { CORPUS } from "@/__eval__/corpus";
import { YOUNG_CORPUS } from "@/__eval__/young/corpus";
import { layoutMath } from "@/lib/hand/mathLayout";
import type { LiveEngine } from "@/lib/live/contracts";
import { BOARD_PROBLEM_FORMS } from "@/lib/live/chat/problemForms";
import { getEngine } from "@/lib/live/engine";
import { judgeColumn } from "@/lib/live/engine/columnWork";
import { localSolve } from "@/lib/live/localSolve";
import { latexToPlain, plainToLatex } from "../parse";

/**
 * Type it (docs/TYPE-MATH.md): what a kid types on a laptop, as the LaTeX the board writes in their
 * hand and the tutor reads. Every line here must come out in the dialect a pen line is read in — the
 * hand writes it (`layoutMath(…).unsupported` is empty), the engine reads it, and the bar can put it
 * back in the box (`latexToPlain`) and get the same maths again.
 */

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
}, 60_000);

const latexOf = (typed: string): string => {
  const p = plainToLatex(typed);
  if (!p.ok) throw new Error(`${typed}: refused (${p.hint})`);
  return p.latex;
};

/** The engine reads it as maths: not a line it gives up on, not prose. */
const engineReads = (latex: string) => {
  const kind = engine.analyzeLine(latex, { mode: "answer" }).kind;
  return kind !== "unknown" && kind !== "text";
};

// ---------------------------------------------------------------- the table: real K–8 and Algebra 1 typing

const TABLE: Record<string, readonly (readonly [typed: string, latex: string])[]> = {
  "adding and taking away": [
    ["4+3", "4 + 3"],
    ["36+2=", "36 + 2 ="],
    ["345 + 278", "345 + 278"],
    ["9-4", "9 - 4"],
    ["52 - 17 = 35", "52 - 17 = 35"],
    ["8+2=10", "8 + 2 = 10"],
    ["47 + 38 = 85", "47 + 38 = 85"],
    ["= 7", "= 7"],
    ["=126", "= 126"],
    ["126", "126"],
    ["20+30=50+12=62", "20 + 30 = 50 + 12 = 62"],
    ["3+4=7=7", "3 + 4 = 7 = 7"],
  ],
  "times and divide": [
    ["7*8", "7 \\times 8"],
    ["7×8", "7 \\times 8"],
    ["7·8", "7 \\times 8"],
    ["7x8", "7 \\times 8"],
    ["7 x 8 = 56", "7 \\times 8 = 56"],
    ["7X8", "7 \\times 8"],
    ["10x10x10", "10 \\times 10 \\times 10"],
    ["2.5x4", "2.5 \\times 4"],
    ["18 × 7", "18 \\times 7"],
    ["10*7=70", "10 \\times 7 = 70"],
    ["144÷12", "144 \\div 12"],
    ["144:12", "144 \\div 12"],
    ["144 ÷ 12 =", "144 \\div 12 ="],
    ["47÷5", "47 \\div 5"],
    ["17÷5=3 R 2", "17 \\div 5 = 3 R 2"],
    ["3 R 2", "3 R 2"],
    ["3r2", "3 R 2"],
    ["5!", "5!"],
  ],
  "order of operations and negatives": [
    ["3+4*2-6÷3=", "3 + 4 \\times 2 - 6 \\div 3 ="],
    ["5+3*(8-6)^2", "5 + 3 \\times (8 - 6)^{2}"],
    ["(3+4)*2", "(3 + 4) \\times 2"],
    ["[2+(3-1)]*2", "[2 + (3 - 1)] \\times 2"],
    ["-5-(-2)", "-5 - (-2)"],
    ["3+-2", "3 + -2"],
    ["3−−2", "3 - -2"],
    ["-3×-4", "-3 \\times -4"],
    ["-24÷-6", "-24 \\div -6"],
    ["(-3)^2", "(-3)^{2}"],
    ["-3^2", "-3^{2}"],
    ["2^5-3^2=", "2^{5} - 3^{2} ="],
    ["(-3)^2 + 4×5 =", "(-3)^{2} + 4 \\times 5 ="],
  ],
  "big numbers and blanks": [
    ["1,234+567", "1{,}234 + 567"],
    ["1,000,000 ÷ 10", "1{,}000{,}000 \\div 10"],
    ["10^3 = 1,000", "10^{3} = 1{,}000"],
    ["4,582 = 4000 + ? + 80 + 2", "4{,}582 = 4000 + \\square + 80 + 2"],
    ["4+?=9", "4 + \\square = 9"],
    ["4+□=9", "4 + \\square = 9"],
    ["7×8=?", "7 \\times 8 = \\square"],
    ["?×6=42", "\\square \\times 6 = 42"],
    ["2/3 = ?/12", "\\frac{2}{3} = \\frac{\\square}{12}"],
  ],
  "decimals, money, percents": [
    ["0.5", "0.5"],
    [".5", ".5"],
    ["4.2×0.3", "4.2 \\times 0.3"],
    ["5.4 x 0.1", "5.4 \\times 0.1"],
    ["3.5+1.25=4.75", "3.5 + 1.25 = 4.75"],
    ["1.2-0.35", "1.2 - 0.35"],
    ["$4.50", "\\$4.50"],
    ["$3.25+$1.50", "\\$3.25 + \\$1.50"],
    ["$4.50 × 3", "\\$4.50 \\times 3"],
    ["$20 - $7.35 = $12.65", "\\$20 - \\$7.35 = \\$12.65"],
    ["$1,250", "\\$1{,}250"],
    ["25%", "25\\%"],
    ["25% × 80", "25\\% \\times 80"],
    ["25% of 80", "25\\% \\times 80"],
    ["15% of 80 =", "15\\% \\times 80 ="],
    ["0.25 = 25%", "0.25 = 25\\%"],
    ["80 × 1.15", "80 \\times 1.15"],
  ],
  fractions: [
    ["1/2", "\\frac{1}{2}"],
    ["½", "\\frac{1}{2}"],
    ["3/4+1/6", "\\frac{3}{4} + \\frac{1}{6}"],
    ["1/2+3/4", "\\frac{1}{2} + \\frac{3}{4}"],
    ["2/3 × 9/10 =", "\\frac{2}{3} \\times \\frac{9}{10} ="],
    ["3/4 ÷ 9/8", "\\frac{3}{4} \\div \\frac{9}{8}"],
    ["1/2+1/3+1/6=", "\\frac{1}{2} + \\frac{1}{3} + \\frac{1}{6} ="],
    ["5/6-1/4", "\\frac{5}{6} - \\frac{1}{4}"],
    ["6/8 = 3/4", "\\frac{6}{8} = \\frac{3}{4}"],
    ["3/4 > 5/8", "\\frac{3}{4} > \\frac{5}{8}"],
    ["1/2 < 2/3", "\\frac{1}{2} < \\frac{2}{3}"],
    ["-3/4", "-\\frac{3}{4}"],
    ["(-3)/4", "\\frac{-3}{4}"],
    ["3/4 of 20", "\\frac{3}{4} \\times 20"],
    ["1/2 × 3", "\\frac{1}{2} \\times 3"],
    ["(1/2)^2", "\\left(\\frac{1}{2}\\right)^{2}"],
    ["1/2^2", "\\frac{1}{2^{2}}"],
    ["(3×2)/(4×3) = 6/12 = 1/2", "\\frac{3 \\times 2}{4 \\times 3} = \\frac{6}{12} = \\frac{1}{2}"],
    ["144/12=", "\\frac{144}{12} ="],
  ],
  "mixed numbers": [
    ["2 1/2", "2\\frac{1}{2}"],
    ["2 1/2 + 1 3/4 =", "2\\frac{1}{2} + 1\\frac{3}{4} ="],
    ["2½", "2\\frac{1}{2}"],
    ["3¼ - 1¾", "3\\frac{1}{4} - 1\\frac{3}{4}"],
    ["2 1/3 = 7/3", "2\\frac{1}{3} = \\frac{7}{3}"],
    ["17/5 = 3 2/5", "\\frac{17}{5} = 3\\frac{2}{5}"],
    ["-2 1/2", "-2\\frac{1}{2}"],
    ["2 1/3+1 1/2", "2\\frac{1}{3} + 1\\frac{1}{2}"],
  ],
  "exponents and roots": [
    ["x^2", "x^{2}"],
    ["x²", "x^{2}"],
    ["x³", "x^{3}"],
    ["x^-3", "x^{-3}"],
    ["x^(n+1)", "x^{n + 1}"],
    ["x^{n+1}", "x^{n + 1}"],
    ["2^10", "2^{10}"],
    ["2^x = 32", "2^{x} = 32"],
    ["3^(x+1) = 81", "3^{x + 1} = 81"],
    ["x^2 · x^3 = x^5", "x^{2} \\times x^{3} = x^{5}"],
    ["(x^2)^3", "(x^{2})^{3}"],
    ["(2x)^2", "(2x)^{2}"],
    ["x^2y", "x^{2}y"],
    ["e^(2x)", "e^{2x}"],
    ["sqrt(16)", "\\sqrt{16}"],
    ["√16", "\\sqrt{16}"],
    ["√16 = 4", "\\sqrt{16} = 4"],
    ["√(x+1)", "\\sqrt{x + 1}"],
    ["sqrt(x+3) = 4", "\\sqrt{x + 3} = 4"],
    ["√x = 5", "\\sqrt{x} = 5"],
    ["3√2", "3\\sqrt{2}"],
    ["√2x", "\\sqrt{2}x"],
    ["√x^2", "\\sqrt{x^{2}}"],
    ["√(2x-1) = 3", "\\sqrt{2x - 1} = 3"],
    ["cbrt(8)", "\\sqrt[3]{8}"],
    ["∛27 = 3", "\\sqrt[3]{27} = 3"],
    ["∛x = 2", "\\sqrt[3]{x} = 2"],
    ["3^2 + √16", "3^{2} + \\sqrt{16}"],
    ["√(b^2-4ac)", "\\sqrt{b^{2} - 4ac}"],
    ["√50 = 5√2", "\\sqrt{50} = 5\\sqrt{2}"],
  ],
  "expressions and the distributive law": [
    ["2(x+1)", "2(x + 1)"],
    ["(x+1)(x-2)", "(x + 1)(x - 2)"],
    ["3(x+2)-x", "3(x + 2) - x"],
    ["4x+3y-2x+y", "4x + 3y - 2x + y"],
    ["(a+b)^2", "(a + b)^{2}"],
    ["2xy", "2xy"],
    ["-(x+1)", "-(x + 1)"],
    ["2(x+4) + 3(x-1)", "2(x + 4) + 3(x - 1)"],
    ["(2x+1)(x-3)", "(2x + 1)(x - 3)"],
    ["x^2+5x+6", "x^{2} + 5x + 6"],
    ["6x^2+9x", "6x^{2} + 9x"],
    ["(x+y)^2 =", "(x + y)^{2} ="],
    ["3x(2x+3)", "3x(2x + 3)"],
    ["2(x+1)/3", "\\frac{2(x + 1)}{3}"],
    ["3x/4", "\\frac{3x}{4}"],
    ["2 x/3", "2\\frac{x}{3}"],
  ],
  "one- and two-step equations": [
    ["2x+3=11", "2x + 3 = 11"],
    ["3x+5=20", "3x + 5 = 20"],
    ["x=5", "x = 5"],
    ["3(x+2)=21", "3(x + 2) = 21"],
    ["5x-3=2x+9", "5x - 3 = 2x + 9"],
    ["x/2+3=7", "\\frac{x}{2} + 3 = 7"],
    ["(x+1)/3 = (x-1)/2", "\\frac{x + 1}{3} = \\frac{x - 1}{2}"],
    ["7-2x=15", "7 - 2x = 15"],
    ["0.5x+1.5=4", "0.5x + 1.5 = 4"],
    ["2x/3 - x/4 = 5", "\\frac{2x}{3} - \\frac{x}{4} = 5"],
    ["-3y=12", "-3y = 12"],
    ["1/2x + 3 = 7", "\\frac{1}{2}x + 3 = 7"],
    ["3/4x = 12", "\\frac{3}{4}x = 12"],
    ["x = 12/5", "x = \\frac{12}{5}"],
    ["x = -4", "x = -4"],
    ["n × 6 = 42", "n \\times 6 = 42"],
    ["3/4 = x/12", "\\frac{3}{4} = \\frac{x}{12}"],
    ["4x - 5 = 2x + 7", "4x - 5 = 2x + 7"],
    ["2(3-x)+4 = 3(x+1)-7", "2(3 - x) + 4 = 3(x + 1) - 7"],
    ["1/(2x) = 4", "\\frac{1}{2x} = 4"],
    ["3/x = 6", "\\frac{3}{x} = 6"],
  ],
  "a step done to both sides": [
    ["÷2", "\\div 2"],
    ["÷2 ÷2", "\\div 2 \\quad \\div 2"],
    ["/2", "\\div 2"],
    ["×3", "\\times 3"],
    ["*3 *3", "\\times 3 \\quad \\times 3"],
    ["-3 -3", "-3 - 3"],
    ["+5 +5", "+5 + 5"],
  ],
  inequalities: [
    ["2x+3>11", "2x + 3 > 11"],
    ["-2x<6", "-2x < 6"],
    ["3-x>=5", "3 - x \\ge 5"],
    ["x≥5", "x \\ge 5"],
    ["4x-5<=2x+7", "4x - 5 \\le 2x + 7"],
    ["x =< 6", "x \\le 6"],
    ["x => 3", "x \\ge 3"],
    ["x≠3", "x \\neq 3"],
    ["x != 3", "x \\neq 3"],
    ["-2 < x < 4", "-2 < x < 4"],
    ["x^2-4<0", "x^{2} - 4 < 0"],
    ["x/3 - 1 < 2", "\\frac{x}{3} - 1 < 2"],
    ["5-2x<=-1", "5 - 2x \\le -1"],
    ["x ≈ 2.4", "x \\approx 2.4"],
  ],
  "absolute value": [
    ["|x-3|=5", "|x - 3| = 5"],
    ["|2x+1|=7", "|2x + 1| = 7"],
    ["|x|+2=6", "|x| + 2 = 6"],
    ["3|x-1|=12", "3|x - 1| = 12"],
    ["|x-1|<3", "|x - 1| < 3"],
    ["abs(x)", "|x|"],
    ["abs(-5) = 5", "|-5| = 5"],
    ["|-3| + |4|", "|-3| + |4|"],
    ["|1/x|", "\\left|\\frac{1}{x}\\right|"],
  ],
  "systems and points": [
    ["x+y=10", "x + y = 10"],
    ["x-y=2", "x - y = 2"],
    ["2x+y=7", "2x + y = 7"],
    ["y=2x+1", "y = 2x + 1"],
    ["y=-x+7", "y = -x + 7"],
    ["3x+2y=12", "3x + 2y = 12"],
    ["x+y+z=6", "x + y + z = 6"],
    ["(3, 4)", "(3, 4)"],
    ["(3,-4)", "(3, -4)"],
    ["(2,500)", "(2, 500)"],
    ["x=2, y=3", "x = 2, y = 3"],
    ["x = 2 or x = 3", "x = 2 \\text{ or } x = 3"],
  ],
  functions: [
    ["f(x)=2x+1", "f(x) = 2x + 1"],
    ["f(3) = 2(3)+1", "f(3) = 2(3) + 1"],
    ["g(x) = x^2-4", "g(x) = x^{2} - 4"],
    ["h(t) = -16t^2+64t", "h(t) = -16t^{2} + 64t"],
    ["y = mx + b", "y = mx + b"],
    ["y = 1/2x - 3", "y = \\frac{1}{2}x - 3"],
    ["y-3 = 2(x-1)", "y - 3 = 2(x - 1)"],
    ["f(x) = 3/4x + 2", "f(x) = \\frac{3}{4}x + 2"],
  ],
  "quadratics": [
    ["x^2-5x+6=0", "x^{2} - 5x + 6 = 0"],
    ["(x-3)(x+4)=0", "(x - 3)(x + 4) = 0"],
    ["2x^2-8=0", "2x^{2} - 8 = 0"],
    ["x = 2 ± √3", "x = 2 \\pm \\sqrt{3}"],
    ["x = ±√2", "x = \\pm \\sqrt{2}"],
    ["x = (-b ± √(b^2-4ac))/(2a)", "x = \\frac{-b \\pm \\sqrt{b^{2} - 4ac}}{2a}"],
  ],
  "trig, logs, π and degrees": [
    ["sin(30°)=", "\\sin(30^{\\circ}) ="],
    ["sin 30°", "\\sin(30^{\\circ})"],
    ["tan(45°) = 1", "\\tan(45^{\\circ}) = 1"],
    ["sin^2(x)+cos^2(x)=1", "\\sin^{2}(x) + \\cos^{2}(x) = 1"],
    ["sin(π/6)", "\\sin\\left(\\frac{\\pi}{6}\\right)"],
    ["cos(pi)", "\\cos(\\pi)"],
    ["sin 2x", "\\sin(2x)"],
    ["log(100)", "\\log(100)"],
    ["log_2(8)", "\\log_{2}(8)"],
    ["log2(32)", "\\log_{2}(32)"],
    ["ln(x) = 3", "\\ln(x) = 3"],
    ["2ln(x) = ln(9)", "2\\ln(x) = \\ln(9)"],
    ["pi", "\\pi"],
    ["2πr", "2\\pi r"],
    ["A = pi r^2", "A = \\pi r^{2}"],
    ["C = 2pir", "C = 2\\pi r"],
    ["θ = 45°", "\\theta = 45^{\\circ}"],
    ["90° + 45° + 45° = 180°", "90^{\\circ} + 45^{\\circ} + 45^{\\circ} = 180^{\\circ}"],
    ["30deg", "30^{\\circ}"],
  ],
  "formulas": [
    ["A = 8 × 5", "A = 8 \\times 5"],
    ["A = 1/2bh", "A = \\frac{1}{2}bh"],
    ["V = lwh", "V = lwh"],
    ["P = 2l + 2w", "P = 2l + 2w"],
    ["a^2+b^2=c^2", "a^{2} + b^{2} = c^{2}"],
    ["3^2+4^2=5^2", "3^{2} + 4^{2} = 5^{2}"],
    ["a_1 + a_2", "a_{1} + a_{2}"],
    ["x = ?", "x = ?"],
    ["a_10 = ?", "a_{10} = ?"],
    ["AB = ?", "AB = ?"],
  ],
};

const ROWS = Object.values(TABLE).flat();

describe("plainToLatex: the table", () => {
  it("is big", () => {
    expect(ROWS.length).toBeGreaterThanOrEqual(150);
  });

  for (const [group, rows] of Object.entries(TABLE)) {
    it(`${group}: the LaTeX the board speaks`, () => {
      for (const [typed, latex] of rows) expect(plainToLatex(typed), typed).toEqual({ ok: true, latex });
    });

    it(`${group}: the hand writes every line and the engine reads it`, () => {
      for (const [, latex] of rows) {
        expect(layoutMath(latex, { seed: 3, size: 28 }).unsupported, latex).toEqual([]);
        // `x = ?` asks for x: read in its column (courseKit.ts, coordinates.ts), not alone
        if (!latex.endsWith("= ?")) expect(engineReads(latex), latex).toBe(true);
      }
    });

    it(`${group}: back in the box and out again, the same line`, () => {
      for (const [, latex] of rows) expect(plainToLatex(latexToPlain(latex)), latex).toEqual({ ok: true, latex });
    });
  }
});

describe("the engine reads a typed line as it reads the pen's", () => {
  // the dialect choices, each with what the engine does with it
  it("x between two numbers is times only on a line of numbers", () => {
    expect(latexOf("3x4")).toBe("3 \\times 4");
    expect(latexOf("3 x 4 = 12")).toBe("3 \\times 4 = 12");
    expect(engine.analyzeLine(latexOf("3x4="), { mode: "answer" }).resultLatex).toBe("12");
    // a letter anywhere and x is the unknown
    expect(latexOf("3x+4=10")).toBe("3x + 4 = 10");
    expect(latexOf("2x^2")).toBe("2x^{2}");
    expect(latexOf("2x")).toBe("2x");
    expect(plainToLatex("3x4y")).toMatchObject({ ok: false, hint: "Use ^ for a power: x^4" });
    expect(plainToLatex("y = 2x3")).toMatchObject({ ok: false, hint: "Use ^ for a power: x^3" });
    expect(plainToLatex("x = 3x4")).toMatchObject({ ok: false, hint: "Use ^ for a power: x^4" });
  });

  it("a mixed number is the engine's mixed number, never a product", () => {
    expect(engine.analyzeLine(latexOf("2 1/2 + 1 3/4 ="), { mode: "answer" }).resultLatex).toBe("\\frac{17}{4}");
    expect(engine.analyzeLine(latexOf("2½ × 2"), { mode: "answer" }).math).toContain("5 / 2");
  });

  it("1/2x is a half of x; 1/(2x) is one over 2x", () => {
    expect(engine.analyzeLine(latexOf("1/2x = 4"), { mode: "answer" }).math).toBe(engine.analyzeLine("\\frac{x}{2} = 4", { mode: "answer" }).math.replace("((x)/(2))", "((1)/(2)) * x"));
    const solve = (typed: string) => localSolve(engine, [latexOf(typed)]).steps.at(-1);
    expect(solve("1/2x = 4")).toBe("x = 8");
    expect(solve("1/(2x) = 4")).toBe("x = \\frac{1}{8}");
  });

  it("money and percents are the forms the young judge marks", () => {
    expect(judgeColumn(engine, { problem: [latexOf("$3.25+$1.50")], lines: [latexOf("4.75")] }).map((a) => a?.verdict)).toEqual(["ok"]);
    expect(judgeColumn(engine, { problem: [latexOf("25% of 80")], lines: [latexOf("20")] }).map((a) => a?.verdict)).toEqual(["ok"]);
    expect(judgeColumn(engine, { problem: [latexOf("17÷5")], lines: [latexOf("3 R 2")] }).map((a) => a?.verdict)).toEqual(["ok"]);
    expect(judgeColumn(engine, { problem: [latexOf("17÷5")], lines: [latexOf("3r3")] }).map((a) => a?.verdict)).toEqual(["mismatch"]);
  });

  it("an operation under an equation is one", () => {
    const previous = engine.analyzeLine(latexOf("2x+3=11"), { mode: "feedback" });
    expect(engine.analyzeLine(latexOf("-3 -3"), { mode: "feedback", previous })).toMatchObject({ kind: "operation", verdict: "ok" });
    const half = engine.analyzeLine(latexOf("2x=8"), { mode: "feedback" });
    expect(engine.analyzeLine(latexOf("÷2"), { mode: "feedback", previous: half })).toMatchObject({ kind: "operation", verdict: "ok" });
    expect(engine.analyzeLine(latexOf("÷2 ÷2"), { mode: "feedback", previous: half })).toMatchObject({ kind: "operation", verdict: "ok" });
  });

  it("a line ending in = asks for its answer; one starting with = gives it", () => {
    expect(localSolve(engine, [latexOf("36+2=")]).answer).toBe("38");
    expect(localSolve(engine, [latexOf("x = 3"), latexOf("2x+5=")])).toMatchObject({ source: "localAnswer", answer: "11" });
    expect(judgeColumn(engine, { problem: [latexOf("4+3")], lines: [latexOf("=7")] }).map((a) => a?.verdict)).toEqual(["ok"]);
  });
});

describe("checking the answer: a typed column reaches what the read one does", () => {
  const COLUMNS: { typed: string[]; read: string[]; problem?: [typed: string, read: string] }[] = [
    { typed: ["3x+5=20", "x=5"], read: ["3x + 5 = 20", "x = 5"] },
    { typed: ["3x+5=20", "3x=15", "x=5"], read: ["3x + 5 = 20", "3x = 15", "x = 5"] },
    { typed: ["3x+5=20", "x=6"], read: ["3x + 5 = 20", "x = 6"] },
    { typed: ["2x+3=11", "-3 -3", "2x=8", "÷2", "x=4"], read: ["2x + 3 = 11", "-3 \\quad -3", "2x = 8", "\\div 2", "x = 4"] },
    { typed: ["1/2x + 3 = 7", "1/2x = 4", "x = 8"], read: ["\\frac{1}{2} x + 3 = 7", "\\frac{1}{2} x = 4", "x = 8"] },
    { typed: ["2x+3>11", "2x>8", "x>4"], read: ["2x + 3 > 11", "2 x > 8", "x > 4"] },
    { typed: ["|x-3|=5", "x-3=5", "x=8"], read: ["|x - 3| = 5", "x - 3 = 5", "x = 8"] },
    { typed: ["x+y=10", "x-y=2", "2x=12", "x=6"], read: ["x + y = 10", "x - y = 2", "2 x = 12", "x = 6"] },
    { typed: ["5 1/2 - 2 3/4", "2 3/4"], read: ["5 \\frac{1}{2} - 2 \\frac{3}{4}", "2 \\frac{3}{4}"] },
    { typed: ["10×7=70", "8×7=56", "70+56=126"], read: ["10 \\times 7 = 70", "8 \\times 7 = 56", "70 + 56 = 126"], problem: ["18x7", "18 \\times 7"] },
    { typed: ["126"], read: ["126"], problem: ["18 × 7", "18 \\times 7"] },
    { typed: ["136"], read: ["136"], problem: ["18 × 7", "18 \\times 7"] },
    { typed: ["1/2 = 3/6", "1/3 = 2/6", "3/6+2/6=5/6"], read: ["\\frac{1}{2} = \\frac{3}{6}", "\\frac{1}{3} = \\frac{2}{6}", "\\frac{3}{6} + \\frac{2}{6} = \\frac{5}{6}"], problem: ["1/2+1/3", "\\frac{1}{2} + \\frac{1}{3}"] },
    { typed: ["5/6"], read: ["5/6"], problem: ["1/2+1/3", "\\frac{1}{2}+\\frac{1}{3}"] },
    { typed: ["4.75"], read: ["4.75"], problem: ["$3.25 + $1.50", "\\$3.25 + \\$1.50"] },
    { typed: ["$4.85"], read: ["\\$4.85"], problem: ["$3.25 + $1.50", "\\$3.25 + \\$1.50"] },
    { typed: ["3 R 2"], read: ["3 \\text { R } 2"], problem: ["17 ÷ 5", "17 \\div 5"] },
    { typed: ["0.54"], read: ["0.54"], problem: ["5.4 x 0.1", "5.4 \\times 0.1"] },
  ];
  const mark = (a: ReturnType<typeof judgeColumn>[number]) => (a ? `${a.verdict}${a.solved ? "+solved" : ""}${a.carried ? "+carried" : ""}` : null);

  it.each(COLUMNS.map((c) => [c.typed.join(" | "), c] as const))("%s", (_name, c) => {
    const typed = judgeColumn(engine, { problem: c.problem ? [latexOf(c.problem[0])] : undefined, lines: c.typed.map(latexOf) }).map(mark);
    const read = judgeColumn(engine, { problem: c.problem ? [c.problem[1]] : undefined, lines: c.read }).map(mark);
    expect(typed).toEqual(read);
  });

  it("the column judges right and wrong the way a teacher does", () => {
    const last = (lines: string[]) => judgeColumn(engine, { lines: lines.map(latexOf) }).map(mark).at(-1);
    expect(last(["3x+5=20", "x=5"])).toBe("ok+solved");
    expect(last(["3x+5=20", "x=6"])).toBe("mismatch");
  });

  it("Solve writes the same answer for a typed problem as for the read one", () => {
    const pairs: [string, string][] = [
      ["3x+5=20", "3x + 5 = 20"],
      ["2 1/2 + 1 3/4 =", "2 \\frac{1}{2} + 1 \\frac{3}{4} ="],
      ["(x+1)/3 = (x-1)/2", "\\frac{x+1}{3}=\\frac{x-1}{2}"],
      ["x^2-5x+6=0", "x^{2}-5 x+6=0"],
      ["|x-3|=5", "|x-3|=5"],
      ["25% of 80 =", "25 \\% \\text { of } 80="],
      ["√(x+3) = 4", "\\sqrt{x+3}=4"],
      ["3x4 =", "3 x 4="],
    ];
    for (const [typed, read] of pairs) {
      const a = localSolve(engine, [latexOf(typed)]);
      const b = localSolve(engine, [read]);
      expect(a.source, typed).not.toBeNull();
      expect(a.steps.at(-1), typed).toBe(b.steps.at(-1));
    }
  });
});

// ---------------------------------------------------------------- refusals: kind hints, a preview anyway

describe("plainToLatex: unfinished or unclear", () => {
  it("empty is nothing to say", () => {
    for (const s of ["", "   ", "\t\n"]) expect(plainToLatex(s)).toEqual({ ok: false, hint: "", partial: "" });
  });

  it.each([
    ["(x+1", "Close the bracket", "(x + 1)"],
    ["3(x+2", "Close the bracket", "3(x + 2)"],
    ["|x-3", "Close the | bar", "|x - 3|"],
    ["3x+", "Something goes after the +", "3x + \\square"],
    ["5×", "Something goes after the ×", "5 \\times \\square"],
    ["5*", "Something goes after the *", "5 \\times \\square"],
    ["1/", "Something goes after the /", "\\frac{1}{\\square}"],
    ["2^", "Something goes after the ^", "2^{\\square}"],
    ["3 + × 4", "Something goes after the +", "3 + \\square \\times 4"],
    ["x <", "Something goes after the <", "x <"],
    ["=", "Something goes after the =", "="],
    ["3 = = 4", "Something goes after the =", "3 = \\square = 4"],
    ["< 5", "Something goes before the <", "< 5"],
    ["^2", "Something goes before the ^", "\\square"],
    ["()", "Something goes in the brackets", "(\\square)"],
    ["||", "Something goes between the | bars", "||\\square||"],
    [")", "There's a ) with no ( before it", "\\square"],
    ["3)+4", "There's a ) with no ( before it", "3"],
    ["sqrt", "Something goes after sqrt", "\\sqrt{\\square}"],
    ["√", "Something goes after the √", "\\sqrt{\\square}"],
    ["sin", "Something goes after sin", "\\sin(\\square)"],
    ["$", "A number goes after the $", "\\square"],
    ["3.", "Something goes after the point", "3."],
    ["x2", "Use ^ for a power: x^2", "x2"],
    ["3x2+y", "Use ^ for a power: x^2", "3x2 + y"],
    ["2 3", "Two numbers need a sign between them", "2\\ 3"],
    ["1 000", "Two numbers need a sign between them", "1\\ 000"],
    ["1/2 3/4", "Two numbers need a sign between them", "\\frac{1}{2}\\frac{3}{4}"],
    ["2 5/4", "The fraction in a mixed number is less than 1", "2\\frac{5}{4}"],
    ["2 1/", "Something goes after the /", "2\\frac{1}{\\square}"],
    ["(3,", "Something goes after the ,", "(3, \\square)"],
    ["x_", "Something goes after the _", "x_{\\square}"],
    ["2_3", "Take out the _", "2"],
    ["5 # 3", "Take out the #", "5\\ 3"],
    ["f'(x)", "Take out the '", "f(x)"],
    ["x = 3 and", "Something goes after and", "x = 3 \\text{ and } \\square"],
    ["3\\", "Take out the \\", "3"],
  ])("%s → %s", (typed, hint, partial) => {
    expect(plainToLatex(typed)).toEqual({ ok: false, hint, partial });
  });

  it("a very long paste is no line of maths", () => {
    expect(plainToLatex("1+".repeat(300) + "1")).toMatchObject({ ok: false, hint: "That line is too long: split it in two" });
  });
});

describe("LaTeX in the box", () => {
  it("what this reader knows is written back in the board's dialect", () => {
    expect(plainToLatex("\\frac{1}{2} + \\frac{1}{3}")).toEqual({ ok: true, latex: "\\frac{1}{2} + \\frac{1}{3}" });
    expect(plainToLatex("\\dfrac{3}{4} \\cdot 2")).toEqual({ ok: true, latex: "\\frac{3}{4} \\times 2" });
    expect(plainToLatex("x \\leq 3")).toEqual({ ok: true, latex: "x \\le 3" });
    expect(plainToLatex("2 \\frac{1}{2}")).toEqual({ ok: true, latex: "2\\frac{1}{2}" });
    expect(plainToLatex("\\left(\\frac{1}{2}\\right)^{2}")).toEqual({ ok: true, latex: "\\left(\\frac{1}{2}\\right)^{2}" });
  });

  it("what it does not is passed through as typed, its braces checked", () => {
    expect(plainToLatex("\\int_{0}^{1} x^{2} \\, dx")).toEqual({ ok: true, latex: "\\int_{0}^{1} x^{2} \\, dx" });
    expect(plainToLatex("5 \\mathrm{~km} \\text{ to } \\mathrm{m}")).toEqual({ ok: true, latex: "5 \\mathrm{~km} \\text{ to } \\mathrm{m}" });
    expect(plainToLatex("\\gcd(12, 18)")).toEqual({ ok: true, latex: "\\gcd(12, 18)" });
    expect(plainToLatex("\\frac{1}{2")).toMatchObject({ ok: false, hint: "Close the {" });
    expect(plainToLatex("\\int x}")).toMatchObject({ ok: false, hint: "There's a } with no { before it" });
  });
});

// ---------------------------------------------------------------- latexToPlain: a pen line back in the box

/** mathjs, to compare what the engine made of two writings of one line */
const m = create(all);

function sameMath(a: string, b: string): boolean {
  const squash = (s: string) => s.replace(/\s+/g, "");
  if (squash(a) === squash(b)) return true;
  const REL = /(==|<=|>=|!=|<|>|=)/;
  const sa = a.split(REL);
  const sb = b.split(REL);
  if (sa.length !== sb.length) return false;
  for (let k = 0; k < sa.length; k++) {
    if (k % 2 === 1) {
      if (sa[k] !== sb[k]) return false;
      continue;
    }
    if (!sameValue(sa[k], sb[k])) return false;
  }
  return true;
}

function sameValue(a: string, b: string): boolean {
  let na: MathNode;
  let nb: MathNode;
  try {
    na = m.parse(a);
    nb = m.parse(b);
  } catch {
    return a.replace(/[\s()]/g, "") === b.replace(/[\s()]/g, "");
  }
  const names = new Set<string>();
  for (const node of [na, nb]) {
    node.traverse((n, path, parent) => {
      if ((n as MathNode & { isSymbolNode?: boolean }).isSymbolNode && !(parent && (parent as { isFunctionNode?: boolean }).isFunctionNode && path === "fn")) {
        const name = (n as unknown as { name: string }).name;
        if (!["pi", "e", "i", "Infinity", "deg"].includes(name)) names.add(name);
      }
    });
  }
  for (let trial = 0; trial < 3; trial++) {
    const scope: Record<string, number> = {};
    let k = 0;
    for (const name of names) scope[name] = 0.7 + ((trial * 7 + k++ * 3) % 11) * 0.31;
    let va: unknown;
    let vb: unknown;
    try {
      va = na.evaluate({ ...scope });
      vb = nb.evaluate({ ...scope });
    } catch {
      return a.replace(/[\s()]/g, "") === b.replace(/[\s()]/g, "");
    }
    if (typeof va === "number" && typeof vb === "number") {
      if (Math.abs(va - vb) > 1e-9 * Math.max(1, Math.abs(va))) return false;
    } else if (m.format(va, { precision: 10 }) !== m.format(vb, { precision: 10 })) return false;
  }
  return true;
}

/** Two writings of a line the engine reads alike: the same kind, and the same maths. */
function sameReading(a: string, b: string): boolean {
  // a remainder's `r` is written R (the young judge reads both, `primaryWork.ts`)
  const r = (s: string) => s.replace(/(\d)\s*r\s*(\d)/g, "$1 R $2");
  const ra = engine.analyzeLine(r(a), { mode: "feedback" });
  const rb = engine.analyzeLine(r(b), { mode: "feedback" });
  return ra.kind === rb.kind && sameMath(ra.math, rb.math);
}

describe("latexToPlain", () => {
  it.each([
    ["\\frac{3}{4} + \\frac{1}{6}", "3/4 + 1/6"],
    ["2 \\frac{1}{2} + 1 \\frac{3}{4} =", "2 1/2 + 1 3/4 ="],
    ["\\frac{x + 1}{3} = \\frac{x - 1}{2}", "(x + 1)/3 = (x - 1)/2"],
    ["\\frac{2x}{3} - \\frac{x}{4} = 5", "2x/3 - x/4 = 5"],
    ["\\frac{1}{2} x + 3 = 7", "1/2x + 3 = 7"],
    ["\\frac{1}{2x}", "1/(2x)"],
    ["\\frac{-3}{4}", "(-3)/4"],
    ["7 \\times 8", "7 × 8"],
    ["2 \\cdot 3", "2 × 3"],
    ["144 \\div 12 =", "144 ÷ 12 ="],
    ["x^{2} - 5x + 6 = 0", "x^2 - 5x + 6 = 0"],
    ["3^{x + 1} = 81", "3^(x + 1) = 81"],
    ["\\sqrt{x + 3} = 4", "√(x + 3) = 4"],
    ["\\sqrt[3]{x} = 2", "∛x = 2"],
    ["\\left|2x + 1\\right| = 7", "|2x + 1| = 7"],
    ["3 - x \\geq 5", "3 - x ≥ 5"],
    ["5 - 2x \\le -1", "5 - 2x ≤ -1"],
    ["x \\neq 3", "x ≠ 3"],
    ["\\sin(30^{\\circ}) =", "sin(30°) ="],
    ["\\sin\\left(\\frac{\\pi}{6}\\right) =", "sin(π/6) ="],
    ["\\sin^{2}(30^{\\circ}) + \\cos^{2}(30^{\\circ}) =", "sin^2(30°) + cos^2(30°) ="],
    ["\\log_{2}(x) = 5", "log_2(x) = 5"],
    ["\\$3.25 + \\$1.50", "$3.25 + $1.50"],
    ["25\\% \\times 80", "25% × 80"],
    ["15\\% \\text{ of } 80 =", "15% × 80 ="],
    ["1{,}234 + 567", "1,234 + 567"],
    ["4 + \\square = 9", "4 + □ = 9"],
    ["x = ?", "x = ?"],
    ["3 \\text { R } 2", "3 R 2"],
    ["17 \\div 5 = 3 R 2", "17 ÷ 5 = 3 R 2"],
    ["2x2", "2 × 2"],
    ["\\pi r^{2}", "πr^2"],
    ["p i", "p i"],
    ["x = \\frac{-b \\pm \\sqrt{b^{2} - 4ac}}{2a}", "x = (-b ± √(b^2 - 4ac))/(2a)"],
    ["\\div 2 \\div 2", "÷2 ÷2"],
    ["-3 \\quad -3", "-3 - 3"],
    ["\\boxed{x = 4}", "x = 4"],
    ["\\left(\\sqrt{2}\\right)^{2}", "(√2)^2"],
    ["\\sqrt{2}^{2}", "√(2)^2"],
    ["\\sqrt{(x + 1)^{2}}", "√((x + 1)^2)"],
    ["\\frac{\\frac{1}{2}}{3}", "(1/2)/3"],
    ["\\frac{2\\sqrt{3}}{3}", "2√3/3"],
  ])("%s → %s", (latex, typed) => {
    expect(latexToPlain(latex)).toBe(typed);
    expect(sameReading(latexOf(typed), latex), typed).toBe(true);
  });

  it("LaTeX it does not model, or an unfinished reading, comes back as it is", () => {
    for (const latex of ["\\int_{0}^{1} x^{2} \\, dx", "f'(x) =", "\\begin{array}{r} 52 \\\\ -17 \\\\ \\hline 35 \\end{array}", "5 \\mathrm{~km}", "3x +", "\\frac{1}{}", "\\angle ABC = 90^{\\circ}", "  "]) {
      expect(latexToPlain(latex)).toBe(latex.trim());
    }
  });

  it("every typed line comes back as itself (the bar keeps the kid's own text, but the dialect is closed)", () => {
    for (const [, latex] of ROWS) {
      const typed = latexToPlain(latex);
      expect(typed, latex).not.toContain("\\");
      expect(plainToLatex(typed), latex).toEqual({ ok: true, latex });
    }
  });

  /** what a pen line reads as: the scoreboard's corpus, the young kids' working, the chat's problems */
  const READINGS = [
    ...CORPUS.flatMap((p) => p.lines),
    ...YOUNG_CORPUS.flatMap((c) => [...(c.problem ? [c.problem] : []), ...c.work.map(([latex]) => latex)]),
    ...BOARD_PROBLEM_FORMS.flatMap((f) => (typeof f.example === "string" ? [f.example] : [...f.example])),
  ];

  it("a pen line's reading, in the box and out again, is read by the engine as it was", () => {
    let turned = 0;
    const wrong: string[] = [];
    for (const latex of new Set(READINGS)) {
      const typed = latexToPlain(latex);
      const again = plainToLatex(typed);
      if (!/\\/.test(typed)) turned++;
      if (!again.ok) {
        // refused only when the reading came back as it was (unfinished: `3x +`)
        if (typed !== latex.trim()) wrong.push(`${latex} → ${typed} refused: ${again.hint}`);
      } else if (again.latex !== latex.replace(/\s+/g, " ").trim() && !sameReading(again.latex, latex)) wrong.push(`${latex} → ${typed} → ${again.latex}`);
      else if (!/\\/.test(typed) && layoutMath(again.latex, { seed: 3 }).unsupported.length) wrong.push(`${latex} → ${again.latex}: the hand cannot`);
    }
    expect(wrong).toEqual([]);
    // most readings are maths a kid can edit as plain text
    expect(turned).toBeGreaterThan(250);
  });
});

// ---------------------------------------------------------------- never throws

describe("anything typed", () => {
  /** a small seeded generator, so a failure can be replayed */
  const rng = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const POOL = ["1", "2", "3", "0", "5", "x", "y", "X", "R", "a", "+", "-", "−", "*", "×", "/", "÷", ":", "^", "²", "(", ")", "[", "]", "{", "}", "|", "=", "<", ">", "<=", "!=", "≤", ",", ".", " ", " ", "√", "∛", "π", "%", "$", "°", "!", "?", "½", "_", "sin", "sqrt", "log", "pi", "of", "or", "abs", "#", "'", "é", "😀"];

  it("never throws, and an accepted line is always writable and comes back as the same maths", () => {
    const next = rng(20261012);
    let accepted = 0;
    let itself = 0;
    for (let k = 0; k < 3000; k++) {
      const len = 1 + Math.floor(next() * 14);
      let s = "";
      for (let j = 0; j < len; j++) s += POOL[Math.floor(next() * POOL.length)];
      const p = plainToLatex(s);
      expect(typeof p.ok, s).toBe("boolean");
      if (!p.ok) {
        expect(typeof p.hint, s).toBe("string");
        expect(typeof p.partial, s).toBe("string");
        continue;
      }
      accepted++;
      expect(layoutMath(p.latex, { seed: 3 }).unsupported, `${s} → ${p.latex}`).toEqual([]);
      const again = plainToLatex(latexToPlain(p.latex));
      expect(again.ok, `${s} → ${p.latex}`).toBe(true);
      if (!again.ok) continue;
      // `½%` comes back as `(1/2)%`: the brackets plain text needs, the same maths
      if (again.latex === p.latex) itself++;
      else expect(sameReading(again.latex, p.latex), `${s} → ${p.latex} → ${again.latex}`).toBe(true);
    }
    expect(accepted).toBeGreaterThan(100);
    expect(itself / accepted).toBeGreaterThan(0.95);
  });

  it("LaTeX of any shape never throws either way", () => {
    const next = rng(7);
    const BITS = ["\\frac", "{", "}", "\\sqrt", "[3]", "\\left(", "\\right)", "\\left|", "\\right|", "^", "_", "x", "2", "\\times", "\\le", "\\text{ or }", "\\pi", "\\circ", "\\$", "\\%", " ", "\\", "\\unknown", "{,}", "=", "-", "/"];
    for (let k = 0; k < 2000; k++) {
      let s = "";
      const len = 1 + Math.floor(next() * 12);
      for (let j = 0; j < len; j++) s += BITS[Math.floor(next() * BITS.length)];
      expect(() => latexToPlain(s), s).not.toThrow();
      expect(() => plainToLatex(s), s).not.toThrow();
    }
  });

  it("is quick enough for every keystroke", () => {
    const line = "x = (-b ± √(b^2-4ac))/(2a) + 2 1/2 × 3^(n+1) - |x-3| + sin(30°)";
    const t0 = performance.now();
    for (let k = 0; k < 1000; k++) plainToLatex(line.slice(0, (k % line.length) + 1));
    expect((performance.now() - t0) / 1000).toBeLessThan(1);
  });
});
