import { beforeAll, describe, expect, it } from "vitest";
import type { LiveEngine } from "../../contracts";
import { getEngine } from "..";
import { bracketLine, isArithmetic, isStackRead, judgeColumn, judgeLine } from "../columnWork";

/**
 * A line judged in its column (`engine/columnWork.ts`): the rules `LiveLoop.analyze` marks a line by,
 * pure — against the last right line above it, or in arithmetic against the problem, as a young
 * student's working (`LiveEngine.judgeWork`).
 */

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
}, 60_000);

const marks = (column: { problem?: string[]; lines: string[] }) =>
  judgeColumn(engine, column).map((a) => (a ? `${a.verdict}${a.solved ? "+solved" : ""}${a.carried ? "+carried" : ""}` : null));

describe("which problems are arithmetic", () => {
  it.each([
    ["18 \\times 7", true],
    ["\\frac{1}{2} + \\frac{1}{3}", true],
    ["8 x 7 = 56", true],
    ["3 R 2", true],
    ["17 \\div 5 = 3 \\text { R } 2", true],
    ["9 \\longdiv { 144 }", true],
    ["\\begin{array}{r} 16 \\\\ 9 \\longdiv { 144 } \\end{array}", true],
    ["2x + 3 = 11", false],
    ["3x = 15", false],
    ["\\sqrt{16}", false],
    ["x", false],
  ])("%s: %s", (latex, want) => {
    expect(isArithmetic(latex)).toBe(want);
  });

  it("a block of rows with a rule is a stacked read; a line is not", () => {
    expect(isStackRead("\\begin{array}{r} 286 \\\\ +680 \\\\ \\hline 966 \\end{array}")).toBe(true);
    expect(isStackRead("\\begin{array}{r} 16 \\\\ 9 \\longdiv { 144 } \\end{array}")).toBe(false);
    expect(isStackRead("286 + 680 = 966")).toBe(false);
  });
});

describe("a young student's column, judged against the problem", () => {
  it("18 × 7 in side calculations: ticks, and solved only by the answer", () => {
    expect(marks({ problem: ["18 \\times 7"], lines: ["10 \\times 7 = 70", "8 \\times 7 = 56", "70 + 56 = 126"] })).toEqual(["ok", "ok", "ok+solved"]);
  });

  it("…the same column on the older rule (an engine with no young-work judge): every true line 'solved', the partials ringed", () => {
    const older: LiveEngine = { ...engine, judgeWork: undefined };
    const col = (lines: string[]) => judgeColumn(older, { problem: ["18 \\times 7"], lines }).map((a) => `${a?.verdict}${a?.solved ? "+solved" : ""}`);
    expect(col(["10 \\times 7 = 70"])).toEqual(["ok+solved"]);
    expect(col(["70"])).toEqual(["mismatch"]);
  });

  it("the answer after side calculations is judged against the problem, not the line above", () => {
    const [, , last] = judgeColumn(engine, { problem: ["144 \\div 9"], lines: ["9 \\times 16 = 144", "9 \\times 10 = 90", "16"] });
    expect(last).toMatchObject({ verdict: "ok", solved: true, bareAnswer: true, kind: "expression" });
  });

  it("the student's own first line is the problem", () => {
    expect(marks({ lines: ["18 \\times 7", "70", "56", "126"] })).toEqual(["none", "none", "none", "ok+solved"]);
    // a first line that is a whole sum is its own problem and answer, as before
    expect(marks({ lines: ["36 + 2 = 38"] })).toEqual(["ok+solved"]);
  });

  it("a line on the problem's row that writes its end again: its answer is judged (`3 = 7` after `4 +`)", () => {
    const ctx = { previous: engine.analyzeLine("4+3", { mode: "feedback" }), mode: "feedback" as const };
    expect(judgeLine(engine, "3 = 7", { ctx, arithmetic: ["4+3"], above: [], beside: "= 7" })).toMatchObject({ verdict: "ok", solved: true, bareAnswer: true });
    expect(judgeLine(engine, "3 = 8", { ctx, arithmetic: ["4+3"], above: [], beside: "= 8" })).toMatchObject({ verdict: "mismatch", bareAnswer: true });
  });

  it("a long-division bracket read as a block: its quotient judged, a ring only on a read the board is sure of", () => {
    const wrong = "\\begin{array}{r} 14 \\\\ 9 \\longdiv { 144 } \\\\ \\underline{9} \\\\ 54 \\end{array}";
    expect(bracketLine(engine, wrong, ["144 \\div 9"], true, "feedback").verdict).toBe("mismatch");
    expect(bracketLine(engine, wrong, ["144 \\div 9"], false, "feedback").verdict).toBe("unknown");
    // a block that is no bracket stays quiet
    expect(bracketLine(engine, "\\begin{array}{r} 1 \\\\ 2 \\\\ \\hline 3 \\end{array}", null, true, "feedback").verdict).toBe("unknown");
  });

  it("stacked sums and long multiplication in a column are worked on their own", () => {
    expect(marks({ lines: ["\\begin{array}{r} 46 \\\\ \\times 23 \\\\ \\hline 138 \\\\ 920 \\\\ \\hline 1058 \\end{array}"] })).toEqual(["ok+solved"]);
    expect(marks({ lines: ["\\begin{array}{r} 46 \\\\ \\times 23 \\\\ \\hline 138 \\end{array}"] })).toEqual(["none"]);
  });
});

describe("the engine's own rule for a claimed decimal (`= 5.25` under a line)", () => {
  const claim = (above: string, line: string) => engine.analyzeLine(line, { previous: engine.analyzeLine(above, { mode: "feedback" }), mode: "feedback" }).verdict;

  it("a decimal that is not the value, even rounded to its places, is ringed", () => {
    expect(claim("3.45 + 2.8", "= 5.25")).toBe("mismatch");
    expect(claim("5.6 - 2.75", "= 2.95")).toBe("mismatch");
    expect(claim("5.4 \\times 0.1", "= 5.04")).toBe("mismatch");
    expect(claim("\\sqrt{50}", "= 8.07")).toBe("mismatch");
  });

  it("the value rounded is the calculator's rounding, never ringed; the value itself is ticked", () => {
    expect(claim("\\sqrt{50}", "= 7.07")).not.toBe("mismatch");
    expect(claim("\\sqrt{50}", "= 7.1")).not.toBe("mismatch");
    expect(claim("3.45 + 2.8", "= 6.25")).toBe("ok");
    expect(claim("1.2 \\times 3", "= 3.6")).toBe("ok");
  });
});

describe("algebra keeps its rules", () => {
  it("a slip is ringed, the step carried on from it is not ringed again, the fix is ticked", () => {
    expect(marks({ lines: ["3x - 5 = 10", "3x = 5", "x = \\frac{5}{3}", "3x = 15", "x = 5"] })).toEqual(["none", "mismatch", "none+carried", "ok", "ok+solved"]);
  });

  it("under one of the tutor's problems", () => {
    expect(marks({ problem: ["2x + 3 = 11"], lines: ["2x = 8", "x = 4"] })).toEqual(["ok", "ok+solved"]);
  });
});
