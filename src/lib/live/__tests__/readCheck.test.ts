import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { LineAnalysis, LiveEngine } from "../contracts";
import { getEngine } from "../engine";
import { analyzeColumn } from "../localSolve";
import { acceptChainReread, acceptReread, engineReads, hasWords, isProse, readDistance, rereadTrigger, sameRead, suspiciousRead } from "../readCheck";

/**
 * The second reader's trigger and acceptance. The table is the model benchmark's misread set
 * (docs/eval/models.md, job 3 — the handwriting scoreboard's real Mathpix misreads, its
 * synthetic ones and its 20 correct-read controls) plus lines students write every day.
 */

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

/** [id, what was written, what Mathpix read, the lines above] */
type Item = [string, string, string, string[]];

/** Real Mathpix misreads (docs/eval/handwriting.json, every distinct one). */
const MISREADS: Item[] = [
  ["mr-01", "a = 5", "0=5", []],
  ["mr-02", "v = u + a t", "v=u+\\Delta t", []],
  ["mr-03", "a = 2", "0=2", ["v=u+\\Delta t", "u=3"]],
  ["mr-04", "e^{x} = 10", "6^{x}=10", []],
  ["mr-06", "\\frac{d}{dx} e^{2x} =", "\\frac{d}{d x} \\theta^{2 x}=", []],
  ["mr-07", "\\frac{d}{dx}(x e^{x}) =", "\\frac{d}{d x}\\left(x \\theta^{x}\\right)=", []],
  ["mr-08", "\\frac{3}{4} \\div \\frac{9}{8} =", "\\frac{3}{4} \\div \\frac{9}{0}=", []],
  ["mr-12", "(a + b)^{2}", "(0+b)^{2}", []],
  ["mr-13", "\\frac{d}{dx}(x e^{x}) =", "\\frac{d}{d x}\\left(x 6^{x}\\right)=", []],
  ["mr-14", "\\int e^{x} \\, dx", "\\int 6^{x} d x", []],
  ["mr-15", "\\int x e^{x^{2}} \\, dx", "\\int x 6^{x^{2}} d x", []],
  ["mr-17", "\\int_{0}^{1} e^{x} \\, dx =", "\\int_{0}^{1} 6^{x} d x=", []],
  ["mr-18", "u = 3", "U=3", ["v=u+a t"]],
  ["mr-20", "\\int x e^{x^{2}} \\, dx", "\\int x \\epsilon^{x^{2}} d x", []],
];

/** Misreads no rule can see from the LaTeX: a plausible line in its own right. */
const UNSEEN: Item[] = [
  ["mr-05", "b = 2a - 3", "b=20-3", ["a=5"]],
  ["mr-16", "\\int_{1}^{e} \\frac{1}{x} \\, dx =", "\\int_{1}^{6} \\frac{1}{x} d x=", []],
];

/** The benchmark's synthetic misreads: the two a rule covers. */
const SYNTHETIC: Item[] = [
  ["sy-01", "3x + 2 = 11", "\\varepsilon x+2=11", []],
  ["sy-04", "x^{2} + 4x = 12", "x 2+4 x=12", []],
];

/** The benchmark's 20 controls: lines Mathpix read right, most of them misread in another variant. */
const CONTROLS: Item[] = [
  ["ct-01", "\\frac{3}{4} \\div \\frac{9}{8} =", "\\frac{3}{4} \\div \\frac{9}{8}=", []],
  ["ct-02", "b = 2a - 3", "b=2 a-3", ["0=5"]],
  ["ct-03", "u = 3", "u=3", ["v=u+\\Delta t"]],
  ["ct-04", "a = 5", "a=5", []],
  ["ct-05", "v = u + a t", "v=u+a t", []],
  ["ct-06", "a = 2", "a=2", ["v=u+a t", "u=3"]],
  ["ct-07", "e^{x} = 10", "e^{x}=10", []],
  ["ct-08", "(a + b)^{2}", "(a+b)^{2}", []],
  ["ct-09", "\\int e^{x} \\, dx", "\\int e^{x} d x", []],
  ["ct-10", "\\int x e^{x^{2}} \\, dx", "\\int x e^{x^{2}} d x", []],
  ["ct-11", "\\int_{1}^{e} \\frac{1}{x} \\, dx =", "\\int_{1}^{e} \\frac{1}{x} d x=", []],
  ["ct-12", "\\int_{0}^{1} e^{x} \\, dx =", "\\int_{0}^{1} e^{x} d x=", []],
  ["ct-13", "\\frac{d}{dx} e^{2x} =", "\\frac{d}{d x} e^{2 x}=", []],
  ["ct-14", "\\frac{d}{dx}(x e^{x}) =", "\\frac{d}{d x}\\left(x e^{x}\\right)=", []],
  ["ct-15", "|x - 1| < 3", "|x-1|<3", []],
  ["ct-16", "a + b + c = 9", "a+b+c=9", []],
  ["ct-17", "a - b = 1", "a-b=1", ["a+b+c=9"]],
  ["ct-18", "b - c = 1", "b-c=1", ["a+b+c=9", "a-b=1"]],
  ["ct-19", "b = ?", "b=?", ["0=5", "b=2 a-3"]],
  ["ct-20", "v = ?", "v=?", ["v=u+\\Delta t", "u=3", "0=2", "t=5"]],
];

/** Lines students write every day, each with the column above it. */
const ORDINARY: Array<[string, string[]]> = [
  ["2x + 3 = 11", []],
  ["2x = 8", ["2x + 3 = 11"]],
  ["3x + 7 = 3x - 2", []],
  ["0 = -9", ["3x + 7 = 3x - 2"]],
  ["0 = 0", ["2x + 6 = 2x + 6"]],
  ["36 + 2 =", []],
  ["x^{2} - 5x + 6 = 0", []],
  ["(x - 2)(x - 3) = 0", ["x^{2} - 5x + 6 = 0"]],
  ["x = 2, \\ x = 3", ["x^{2} - 5x + 6 = 0"]],
  ["x + y = 10", []],
  ["x - y = 2", ["x + y = 10"]],
  ["2x = 12", ["x + y = 10", "x - y = 2"]],
  ["y = 4", ["x + y = 10", "x - y = 2", "2x = 12", "x = 6"]],
  ["\\sin(30^\\circ)", []],
  ["\\sin \\theta = 0.5", []],
  ["\\theta = 30^\\circ", ["\\sin \\theta = 0.5"]],
  ["\\cos \\alpha = \\frac{3}{5}", []],
  ["A = \\pi r^{2}", []],
  ["x \\in \\mathbb{R}", ["2(x + 3) = 2x + 6"]],
  ["2^{x} = 8", []],
  ["10^{x} = 1000", []],
  ["16^{x} = 4", []],
  ["\\log_{2} 8", []],
  ["\\int_{0}^{2} 3x^{2} dx", []],
  ["= x^{3} + C", ["\\int 3x^{2} dx"]],
  ["\\frac{dy}{dx} =", ["y = x^{3} + 2x"]],
  ["f'(x) =", ["f(x) = x^{2} - 3x"]],
  ["\\lim_{x \\to 2}\\frac{x^2-4}{x-2}", []],
  ["\\sum_{i=1}^{10} i =", []],
  ["15\\% \\text{ of } 80 =", []],
  ["5 \\mathrm{~km} / \\mathrm{h} \\text{ to } \\mathrm{m} / \\mathrm{s}", []],
  ["F = m a", []],
  ["v^{2} = u^{2} + 2 a s", ["u = 3", "a = 2", "s = 4"]],
  ["x - 0.5 = 2", []],
  ["10 + x = 13", []],
  ["\\frac{x}{2} + 3 = 7", []],
  ["x_{1} = 3", []],
  ["y = 2e^{x}", []],
  ["2e", ["y = e^{x}"]],
  ["x \\geq 5", ["3 - x \\leq -2"]],
  ["3 - x \\geq 5", []],
  ["\\text{A train travels 60 km in 2 hours.}", []],
  ["n + d = 25", ["\\text{A jar has 25 coins, nickels and dimes.}"]],
];

describe("suspiciousRead", () => {
  it.each(MISREADS)("%s: `%s` read as `%s` is suspicious", (_id, _truth, read, above) => {
    expect(suspiciousRead(read, above)).not.toBeNull();
  });

  it.each(SYNTHETIC)("%s: `%s` read as `%s` is suspicious", (_id, _truth, read, above) => {
    expect(suspiciousRead(read, above)).not.toBeNull();
  });

  it.each(UNSEEN)("%s: `%s` read as `%s` looks like maths in its own right (a known miss)", (_id, _truth, read, above) => {
    expect(suspiciousRead(read, above)).toBeNull();
  });

  it.each(CONTROLS)("%s: the correct read `%s` is not suspicious", (_id, _truth, read, above) => {
    expect(suspiciousRead(read, above)).toBeNull();
  });

  it.each(ORDINARY)("an ordinary line is not suspicious: %s", (line, above) => {
    expect(suspiciousRead(line, above)).toBeNull();
  });

  it("names the rule that fired", () => {
    expect(suspiciousRead("v=u+\\Delta t")).toBe("odd-symbol");
    expect(suspiciousRead("x \\in 3")).toBe("odd-symbol");
    expect(suspiciousRead("\\varphi + 2 = 5")).toBe("odd-symbol");
    expect(suspiciousRead("U=3", ["v=u+a t"])).toBe("letter-case");
    expect(suspiciousRead("2o + 3")).toBe("digit-letter");
    expect(suspiciousRead("x = 1 e")).toBe("digit-letter");
    expect(suspiciousRead("x 2+4 x=12")).toBe("digit-letter");
    expect(suspiciousRead("6^{x}=10")).toBe("lookalike-base");
    expect(suspiciousRead("0=5")).toBe("false-number");
    expect(suspiciousRead("\\frac{9}{0}")).toBe("zero-denominator");
    expect(suspiciousRead("(0+b)^{2}")).toBe("zero-term");
    expect(suspiciousRead("2x + z = 8", ["x + y = 10", "x - y = 2"])).toBe("stray-letter");
  });

  it("a Greek letter the column already uses is the student's own", () => {
    expect(suspiciousRead("\\Delta t = 2", ["v = \\frac{\\Delta x}{\\Delta t}"])).toBeNull();
    expect(suspiciousRead("\\lambda = 2", [])).toBe("odd-symbol");
    expect(suspiciousRead("\\lambda = 2", ["v = f \\lambda"])).toBeNull();
    // θ is an angle wherever the column has trigonometry, and so is any letter a trig function takes
    expect(suspiciousRead("\\theta = 30", ["\\sin \\theta = 0.5"])).toBeNull();
    expect(suspiciousRead("\\theta = 30", [])).toBe("odd-symbol");
    expect(suspiciousRead("\\sin \\beta = 1")).toBeNull();
  });

  it("a letter from nowhere only counts in a column that is one connected problem", () => {
    // a list of givens shares nothing: every new letter is a new given
    expect(suspiciousRead("t = 5", ["u = 3", "a = 2"])).toBeNull();
    // an assignment names its own new quantity
    expect(suspiciousRead("z = x + y", ["x + y = 10", "x - y = 2"])).toBeNull();
    // the constant of integration, and k / n in a trig solution
    expect(suspiciousRead("= x^{3} + C", ["\\int 3x^{2} dx", "= 3 \\cdot \\frac{x^{3}}{3}"])).toBeNull();
  });

  it("a false numeric line after a line whose unknown cancels is the student's conclusion", () => {
    expect(suspiciousRead("0 = -9", ["3x + 7 = 3x - 2", "3x - 3x = -2 - 7"])).toBeNull();
    expect(suspiciousRead("0 = 5", ["u = 3"])).toBe("false-number");
    // a wrong sum is the student's mistake, not a misread: not both sides a number
    expect(suspiciousRead("2 + 2 = 5")).toBeNull();
  });

  it("prose is never inspected", () => {
    expect(isProse("\\text{Find } \\theta")).toBe(true);
    expect(suspiciousRead("\\text{Find } \\theta")).toBeNull();
    expect(isProse("15\\% \\text{ of } 80")).toBe(false);
  });
});

describe("rereadTrigger", () => {
  const analysis = (kind: LineAnalysis["kind"]): LineAnalysis => ({ kind, math: "", resultLatex: "", verdict: "none", note: "" });
  const base = { confidence: 0.97, strokeCount: 6, others: [] as string[] };

  it("(c) low confidence on a line of maths", () => {
    expect(rereadTrigger({ ...base, latex: "2x+?=11", confidence: 0.4, analysis: analysis("unknown") })).toBe("low-confidence");
  });

  it("(a) a line of maths the engine cannot read", () => {
    expect(rereadTrigger({ ...base, latex: "2 x+3=1 \\|", analysis: analysis("unknown") })).toBe("unreadable");
    expect(rereadTrigger({ ...base, latex: "2 x+3=1 \\|", analysis: null })).toBe("unreadable");
  });

  it("(a) not a construct the engine reads and declines, and not the board's `x = ?`", () => {
    expect(rereadTrigger({ ...base, latex: "\\int x e^{x^{2}} d x", analysis: analysis("unknown") })).toBeNull();
    expect(rereadTrigger({ ...base, latex: "\\lim_{n \\to \\infty}(1 + \\frac{1}{n})^{n}", analysis: analysis("unknown") })).toBeNull();
    expect(rereadTrigger({ ...base, latex: "\\begin{pmatrix}1 & 2\\end{pmatrix}", analysis: analysis("unknown") })).toBeNull();
    expect(rereadTrigger({ ...base, latex: "\\frac{dy}{dx} =", analysis: analysis("unknown") })).toBeNull();
    expect(rereadTrigger({ ...base, latex: "f'(x) =", analysis: analysis("unknown") })).toBeNull();
    expect(rereadTrigger({ ...base, latex: "b=?", analysis: analysis("unknown") })).toBeNull();
  });

  it("(b) a suspicious read in a line the engine did read", () => {
    expect(rereadTrigger({ ...base, latex: "0=5", analysis: analysis("equation") })).toBe("false-number");
    expect(rereadTrigger({ ...base, latex: "2x+3=11", analysis: analysis("equation") })).toBeNull();
  });

  it("never for prose, a label, a lone symbol, a single stroke, or no read at all", () => {
    expect(rereadTrigger({ ...base, latex: "\\text{A train travels 60 km}", confidence: 0.3, analysis: analysis("text") })).toBeNull();
    expect(rereadTrigger({ ...base, latex: "A", confidence: 0.3, analysis: analysis("label") })).toBeNull();
    expect(rereadTrigger({ ...base, latex: "\\Delta", confidence: 0.3, analysis: analysis("unknown") })).toBeNull();
    expect(rereadTrigger({ ...base, latex: "0=5", strokeCount: 1, analysis: analysis("equation") })).toBeNull();
    expect(rereadTrigger({ ...base, latex: "", confidence: 0, analysis: null })).toBeNull();
  });
});

describe("accepting the second reader's LaTeX", () => {
  it.each([...MISREADS, ...UNSEEN, ...SYNTHETIC])("%s: the true line `%s` replaces `%s`", (_id, truth, read) => {
    expect(acceptReread(engine, read, truth)).toBe(truth);
  });

  it("keeps Mathpix's read when the answer is the same read (spacing and braces aside)", () => {
    expect(acceptReread(engine, "e^{x}=10", "e^x = 10")).toBeNull();
    expect(acceptReread(engine, "\\frac{d}{d x}\\left(x e^{x}\\right)=", "\\frac{d}{dx}(x e^{x}) =")).toBeNull();
    expect(sameRead("2 x + 3", "2x+3")).toBe(true);
    expect(sameRead("2x + 3", "2x + 8")).toBe(false);
  });

  it("refuses a 'correction' that itself looks misread (the benchmark's `0=5` → `\\sigma = 5`)", () => {
    expect(acceptReread(engine, "0=5", "\\sigma = 5")).toBeNull();
    expect(acceptReread(engine, "0=5", "\\sigma = 5", ["F = \\sigma A"])).toBe("\\sigma = 5");
    expect(acceptReread(engine, "U=3", "V=3", ["v=u+a t"])).toBeNull();
    expect(acceptReread(engine, "U=3", "u=3", ["v=u+a t"])).toBe("u=3");
  });

  it("refuses words, a worked answer, and LaTeX the engine cannot read", () => {
    expect(acceptReread(engine, "0=5", "\\text{a equals five}")).toBeNull();
    expect(acceptReread(engine, "0=5", "Sorry, I cannot read this")).toBeNull();
    expect(acceptReread(engine, "0=5", "a = 5 \\text{ (corrected)}")).toBeNull();
    expect(acceptReread(engine, "2x+3=11", "2x = 8, \\ x = 4, \\ \\text{so } x = 4")).toBeNull();
    expect(acceptReread(engine, "2x+3=11", "\\frac{2x+3}{")).toBeNull();
    expect(acceptReread(engine, "0=5", "")).toBeNull();
  });

  it("accepts the engine's own idioms: a trailing =, `x = ?`, an integral it cannot do", () => {
    expect(engineReads(engine, "(a+b)^{2} =")).toBe(true);
    expect(engineReads(engine, "a = ?")).toBe(true);
    expect(engineReads(engine, "\\int x e^{x^{2}} \\, dx")).toBe(true);
    expect(engineReads(engine, "\\int x e^{x^{2}}")).toBe(false);
    expect(acceptReread(engine, "0=?", "a = ?")).toBe("a = ?");
  });

  it("hasWords: prose and letter runs, never the engine's connectors, units or functions", () => {
    expect(hasWords("\\text{speed}")).toBe(true);
    expect(hasWords("x = 4 therefore")).toBe(true);
    expect(hasWords("15\\% \\text{ of } 80")).toBe(false);
    expect(hasWords("5 \\mathrm{km} \\text{ to } \\mathrm{m}")).toBe(false);
    expect(hasWords("\\sin \\theta + \\log_{2} 8")).toBe(false);
  });
});

describe("the second look before a ring (chain re-reads)", () => {
  it("measures how far apart two reads are, spacing and braces aside", () => {
    expect(readDistance("3(x-2)=17", "3(x - 2) = 17")).toBe(0);
    expect(readDistance("x^{2}=4", "x^2=4")).toBe(0);
    expect(readDistance("3(x-2)=17", "3(x-2)=12")).toBe(1);
    expect(readDistance("2x=8", "2x-8")).toBe(1);
    expect(readDistance("5x-2x=9-3", "3x=12")).toBe(7);
  });

  it.each([
    ["a 2 read as a 7", "3(x-2)=17", "3(x-2)=12"],
    ["a 1 read as a 7", "x+7=4", "x+1=4"],
    ["an = read as a -", "2x-8", "2x=8"],
    ["21 read as 11", "x=11", "x=21"],
    ["an x read as a y", "y^{2}-5x+6=0", "x^{2}-5x+6=0"],
  ])("believes a look-alike: %s", (_why, read, truth) => {
    expect(acceptChainReread(engine, read, truth)).toBe(truth);
  });

  it.each([
    ["the next step instead of the line", "5x-2x=9-3", "3x=6"],
    ["the student's maths fixed", "5x-2x=9-3", "5x-2x=9+3+0"],
    ["a different equation", "3(x-2)=17", "3x-6=12"],
  ])("ignores more than a look-alike: %s", (_why, read, answer) => {
    expect(acceptChainReread(engine, read, answer)).toBeNull();
  });

  it("asks everything acceptReread asks: a change, no words, maths the engine reads", () => {
    expect(acceptChainReread(engine, "3(x-2)=17", "3(x-2) = 17")).toBeNull();
    expect(acceptChainReread(engine, "x=11", "x=1(")).toBeNull();
    expect(acceptChainReread(engine, "U=3", "V=3", ["v=u+a t"])).toBeNull();
  });
});

describe("the handwriting scoreboard (docs/eval/handwriting.json)", () => {
  it("triggers on 17 of its 20 misreads and on none of its 704 correct reads, in writing order", () => {
    const hw = JSON.parse(readFileSync(join(__dirname, "..", "..", "..", "..", "docs", "eval", "handwriting.json"), "utf8")) as {
      runs: Array<{ lines: Array<{ recognized?: string; confidence?: number; read: string }> }>;
    };
    const tally = { wrong: [0, 0], correct: [0, 0] };
    for (const run of hw.runs) {
      const reads = run.lines.map((l) => (l.read === "skipped" ? "" : (l.recognized ?? "")));
      const analyses = analyzeColumn(engine, reads, "answer");
      run.lines.forEach((l, i) => {
        if (!reads[i]) return;
        const cls = l.read === "wrong" ? "wrong" : "correct";
        // the loop asks right after the line is read: the lines above are all that exist yet
        const t = rereadTrigger({ latex: reads[i], confidence: l.confidence ?? 1, analysis: analyses[i], strokeCount: 5, others: reads.slice(0, i) });
        tally[cls][0]++;
        if (t) tally[cls][1]++;
      });
    }
    expect(tally.wrong).toEqual([20, 17]);
    expect(tally.correct).toEqual([704, 0]);
    // 724 lines through the engine: seconds on its own, longer under the full suite's load
  }, 30_000);
});
