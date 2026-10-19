import { describe, expect, it } from "vitest";
import type { Rect } from "@/lib/live/contracts";
import { hasLetters, lineType } from "./corpus";
import { judgeLine, readBracket } from "./judge";
import { sameRead } from "./report";
import { leadingNumber, scoreSplit } from "./split";
import type { PageRead, Worksheet } from "./worksheets";

/** The v3/text eval's judging and scoring, offline (no canvas, no network): runs in CI. */
describe("mpx-text eval: judging a read", () => {
  const stack = { type: "stacked sums" as const, set: "stacked" as const, latex: "\\begin{array}{r} 286 \\\\ +680 \\\\ \\hline 966 \\end{array}" };

  it("a stacked sum is right when the board's stack parser reads the same operands, operator and answer", () => {
    expect(judgeLine(stack, { ok: true, latex: "\\begin{array}{r}\n286 \\\\\n+680 \\\\\n\\hline 966\n\\end{array}" })).toBe("semantic");
    expect(judgeLine(stack, { ok: true, latex: "\\begin{array}{r} 286 \\\\ +680 \\\\ \\hline 866 \\end{array}" })).toBe("wrong");
    // the right digits in a shape the board's parser rejects are wrong for the board
    expect(judgeLine(stack, { ok: true, latex: "\\begin{array}{r@{\\quad}l} 286 \\\\ + 680 \\\\ \\hline 966 \\end{array}" })).toBe("wrong");
    expect(judgeLine(stack, { ok: false, latex: "" })).toBe("failed");
  });

  it("a long division is right when its bracket has the divisor and dividend written", () => {
    const line = { type: "long division" as const, set: "bars" as const, latex: "3 \\overline{)126}" };
    expect(readBracket("3 \\longdiv { 1 2 6 }")).toEqual({ divisor: 3, dividend: 126 });
    expect(judgeLine(line, { ok: true, latex: "3 \\longdiv { 1 2 6 }" })).toBe("semantic");
    expect(judgeLine(line, { ok: true, latex: "4) \\overline{128}" })).toBe("wrong");
    expect(judgeLine(line, { ok: true, latex: "3) \\overline{126}" })).toBe("semantic");
    expect(judgeLine(line, { ok: true, latex: "3 ) 126" })).toBe("wrong");
  });

  it("a drawing is read right when nothing is read from it", () => {
    const d = { type: "drawing (no maths)" as const, set: "drawings" as const, latex: "" };
    expect(judgeLine(d, { ok: false, latex: "" })).toBe("exact");
    expect(judgeLine(d, { ok: true, latex: "" })).toBe("exact");
    expect(judgeLine(d, { ok: true, latex: "\\triangle" })).toBe("wrong");
  });

  it("an ordinary line goes to the scoreboard's judge", () => {
    const l = { type: "equations" as const, set: "scoreboard" as const, latex: "a = 5" };
    expect(judgeLine(l, { ok: true, latex: "a=5" })).toBe("exact");
    expect(judgeLine(l, { ok: true, latex: "0=5" })).toBe("wrong");
    expect(sameRead("2 x+3=11", "2x + 3 = 11")).toBe(true);
    expect(sameRead("0=5", "a=5")).toBe(false);
  });

  it("types lines as the report does", () => {
    expect(lineType("\\frac{3}{4} + \\frac{1}{8} =", "scoreboard")).toBe("fractions");
    expect(lineType("2x + 3 = 11", "scoreboard")).toBe("equations");
    expect(lineType("3 \\times 4 - 2", "scoreboard")).toBe("arithmetic");
    expect(lineType("(a + b)^{2}", "scoreboard")).toBe("exponents / roots");
    expect(lineType("3 \\overline{)126}", "bars")).toBe("long division");
    expect(lineType("18 \\times 7", "young")).toBe("young kids' lines");
    expect(hasLetters("\\sin x = 1")).toBe(true);
    expect(hasLetters("2.5 \\mathrm{~h} \\text{ to } \\mathrm{min}")).toBe(false);
    expect(hasLetters("6 \\times 7 \\div 2")).toBe(false);
  });
});

describe("mpx-text eval: splitting a worksheet", () => {
  it("finds a problem's number however Mathpix writes it", () => {
    expect(leadingNumber("\n1. \\( \\frac{3}{4} \\)")).toEqual({ n: 1, style: "." });
    expect(leadingNumber("\n\\begin{itemize}\n\\item[3.] Solve")).toEqual({ n: 3, style: "." });
    expect(leadingNumber("\\item[10.] Write")).toEqual({ n: 10, style: "." });
    expect(leadingNumber("6) \\( \\frac{42}{252} \\)")).toEqual({ n: 6, style: ")" });
    expect(leadingNumber("3.50 + 12.25")).toBeNull();
    expect(leadingNumber("Name: Maya")).toBeNull();
  });

  const box = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });
  const sheet: Worksheet = {
    name: "two columns",
    photo: false,
    width: 1000,
    height: 1000,
    jpeg: Buffer.alloc(0),
    problems: [
      { n: 1, box: box(50, 100, 250, 180), hand: [box(100, 200, 100, 60)] },
      { n: 2, box: box(550, 100, 250, 180), hand: [box(600, 200, 100, 60)] },
      { n: 3, box: box(50, 500, 260, 200), hand: [box(100, 600, 100, 60)] },
    ],
  };
  const read = (regions: Array<[string, Rect]>, size = 1000): PageRead => ({ ok: true, reader: "v3/text", width: size, height: size, ms: 0, regions: regions.map(([text, b]) => ({ text, box: b })) });

  it("groups regions by column, whatever order Mathpix reads them in", () => {
    // reading order interleaves the columns (1, 2, then 1's answer), and a long division's `6)` is not a problem
    const s = scoreSplit(
      sheet,
      read([
        ["1. Solve", box(60, 110, 200, 60)],
        ["2. Solve", box(560, 110, 200, 60)],
        ["x = 4", box(100, 200, 100, 60)],
        ["x = 5", box(600, 200, 100, 60)],
        ["3.", box(60, 510, 40, 40)],
        ["6) \\frac{42}{252}", box(100, 560, 200, 130)],
      ]),
    );
    expect(s.numbersFound).toBe(3);
    expect(s.right).toEqual([1, 2, 3]);
    expect(s.handwritingAttached).toBe(3);
    expect(s.texts[3]).toBe("3. ⏎ 6) \\frac{42}{252}");
  });

  it("scales Mathpix's coordinates to the page, and a region over two problems is not pure", () => {
    const s = scoreSplit(sheet, read([["1. Solve 2. Solve", box(30, 55, 420, 30)]], 500));
    expect(s.regionsOverProblems).toBe(1);
    expect(s.pureRegions).toBe(0);
    expect(s.splitRight).toBe(0);
  });
});
