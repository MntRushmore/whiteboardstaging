import { describe, expect, it } from "vitest";
import { nextStep, parseStacked, placeName, placesLeft, stackedAnalysis, workStacked, type StackedRead } from "../columnArithmetic";

/**
 * Column (stacked) arithmetic (`engine/columnArithmetic.ts`): the array Mathpix reads a stacked sum
 * as, the sum worked column by column, the student's answer judged rightmost first, and Help's
 * next column. The reads are the ones Mathpix returned for the tutor's hand writing the layouts.
 */

const OWNER = "\\begin{array}{r}\n286 \\\\\n+680 \\\\\n\\hline 966\n\\end{array}";

function work(read: string, answerLast?: number) {
  const parsed = parseStacked(read);
  expect(parsed, read).not.toBeNull();
  return workStacked(parsed!, answerLast === undefined ? {} : { answerLast })!;
}

describe("reading the array", () => {
  it.each<[string, StackedRead]>([
    // what Mathpix returned for the ink
    [OWNER, { op: "+", operands: ["286", "680"], answer: "966" }],
    ["\\begin{array}{r}\n286 \\\\\n+680 \\\\\n\\hline\n\\end{array}", { op: "+", operands: ["286", "680"], answer: "" }],
    ["\\begin{array}{r}\n286 \\\\\n+680 \\\\\n\\hline 66\n\\end{array}", { op: "+", operands: ["286", "680"], answer: "66" }],
    ["\\begin{array}{c}\n52 \\\\\n-17 \\\\\n\\hline 35\n\\end{array}", { op: "-", operands: ["52", "17"], answer: "35" }],
    ["\\begin{array}{r}\n23 \\\\\n\\times 4 \\\\\n\\hline 92\n\\end{array}", { op: "×", operands: ["23", "4"], answer: "92" }],
    ["\\begin{array}{r}\n125 \\\\\n48 \\\\\n+302 \\\\\n\\hline 475\n\\end{array}", { op: "+", operands: ["125", "48", "302"], answer: "475" }],
    ["\\begin{array}{r}\n3.50 \\\\\n+12.25 \\\\\n\\hline 15.75\n\\end{array}", { op: "+", operands: ["3.50", "12.25"], answer: "15.75" }],
    // and the shapes it could take
    ["\\begin{array}{rr} & 286 \\\\ + & 680 \\\\ \\hline & 966 \\end{array}", { op: "+", operands: ["286", "680"], answer: "966" }],
    ["\\begin{array}{r} 286 \\\\ \\underline{+680} \\\\ 966 \\end{array}", { op: "+", operands: ["286", "680"], answer: "966" }],
    ["\\begin{array}{r} 286 \\\\ \\text { +680 } \\\\ \\hline 966 \\end{array}", { op: "+", operands: ["286", "680"], answer: "966" }],
    ["\\begin{array}{r} { }^{1} 286 \\\\ +680 \\\\ \\hline 966 \\end{array}", { op: "+", operands: ["286", "680"], answer: "966" }],
    ["\\begin{array}{r} 23 \\\\ x 4 \\\\ \\hline 92 \\end{array}", { op: "×", operands: ["23", "4"], answer: "92" }],
    ["\\begin{array}{r} 1{,}250 \\\\ +750 \\\\ \\hline 2{,}000 \\end{array}", { op: "+", operands: ["1250", "750"], answer: "2000" }],
  ])("%s", (latex, want) => {
    expect(parseStacked(latex)).toEqual(want);
  });

  it.each([
    ["\\begin{array}{r} 286 \\\\ +680 \\\\ \\hline 966 \\\\ 12 \\end{array}", "two rows under the rule of a sum"],
    ["\\begin{array}{r} 286 \\\\ +680 \\\\ \\hline 966 \\\\ \\hline 12 \\end{array}", "two rules under a sum"],
    ["\\begin{array}{r} 23 \\\\ \\times 4 \\\\ \\hline 12 \\\\ 80 \\end{array}", "rows under a product by one digit"],
    ["\\begin{array}{r} 23 \\\\ \\times 45 \\\\ \\hline 115 \\\\ 9.2 \\\\ \\hline 1035 \\end{array}", "a row with a point"],
    ["\\begin{array}{r} 286 \\\\ 680 \\\\ \\hline 966 \\end{array}", "no operator"],
    ["\\begin{array}{r} +286 \\\\ +680 \\\\ \\hline 966 \\end{array}", "an operator on the first number"],
    ["\\begin{array}{r} 286 \\\\ +680 \\\\ -12 \\\\ \\hline 954 \\end{array}", "two kinds of operator"],
    ["\\begin{array}{r} 52 \\\\ -17 \\\\ -3 \\\\ \\hline 32 \\end{array}", "taking away twice"],
    ["\\begin{array}{r} x+y=10 \\\\ x-y=2 \\\\ \\hline 2x=12 \\end{array}", "equations added (elimination)"],
    ["\\begin{array}{r} 2x \\\\ +3 \\\\ \\hline 5 \\end{array}", "a letter"],
    ["\\begin{array}{r} 286 \\\\ \\hline 966 \\end{array}", "one number"],
    ["\\begin{array}{ll} -3 & -3 \\end{array}", "an operation line (no rule)"],
    ["\\frac{+680}{966}", "a fraction"],
    ["\\frac{3}{4}", "a fraction"],
    ["286+680=966", "a line"],
  ])("not a stacked sum: %s (%s)", (latex) => {
    expect(parseStacked(latex)).toBeNull();
  });
});

describe("working it", () => {
  it("the owner's sum is right: a tick, and nothing left to write", () => {
    const w = work(OWNER);
    expect(w).toMatchObject({ result: "966", digits: [6, 6, 9], wrong: -1, right: true, note: "" });
    // the 8 + 8 in the tens carries 1 into the hundreds
    expect(w.carries.slice(0, 4)).toEqual([0, 0, 1, 0]);
    expect(nextStep(w, new Set())).toBeNull();
  });

  it("a forgotten carry is ringed in its column, with the note", () => {
    const w = work("\\begin{array}{r} 286 \\\\ +680 \\\\ \\hline 866 \\end{array}");
    expect(w).toMatchObject({ wrong: 2, right: false, note: "Add the 1 you carried to the hundreds." });
  });

  it("the rightmost wrong column is the one pointed at", () => {
    const w = work("\\begin{array}{r} 286 \\\\ +680 \\\\ \\hline 856 \\end{array}");
    expect(w).toMatchObject({ wrong: 1, note: "Check the tens column." });
  });

  it("a partial answer filled in from the right is not wrong, and not finished", () => {
    const w = work("\\begin{array}{r} 286 \\\\ +680 \\\\ \\hline 66 \\end{array}");
    expect(w).toMatchObject({ wrong: -1, right: false });
    expect(placesLeft(w, new Set())).toEqual([2]);
    expect(nextStep(w, new Set())).toEqual({ digits: [{ place: 2, digit: 9 }], carry: null });
  });

  it("a digit written under the hundreds first is the hundreds (where it sits on the page)", () => {
    const read = parseStacked("\\begin{array}{r} 286 \\\\ +680 \\\\ \\hline 9 \\end{array}")!;
    expect(workStacked(read, { answerLast: 2 })).toMatchObject({ wrong: -1, right: false });
    // read as the ones, it would be wrong
    expect(workStacked(read)).toMatchObject({ wrong: 0 });
  });

  it("Help's next column: its digit and the carry over the column on its left", () => {
    const w = work("\\begin{array}{r} 286 \\\\ +680 \\\\ \\hline \\end{array}");
    expect(nextStep(w, new Set())).toEqual({ digits: [{ place: 0, digit: 6 }], carry: null });
    expect(nextStep(w, new Set([0]))).toEqual({ digits: [{ place: 1, digit: 6 }], carry: { place: 2, digit: 1 } });
    expect(nextStep(w, new Set([0, 1]))).toEqual({ digits: [{ place: 2, digit: 9 }], carry: null });
    expect(nextStep(w, new Set([0, 1, 2]))).toBeNull();
  });

  it("the last column takes the rest of the answer with it: 286 + 780 ends 10, not 0 and a carry", () => {
    const w = work("\\begin{array}{r} 286 \\\\ +780 \\\\ \\hline 66 \\end{array}");
    expect(w.result).toBe("1066");
    expect(nextStep(w, new Set())).toEqual({ digits: [{ place: 2, digit: 0 }, { place: 3, digit: 1 }], carry: null });
  });

  it("nothing more is offered while a digit is wrong (the ring and its fix come first)", () => {
    const w = work("\\begin{array}{r} 286 \\\\ +680 \\\\ \\hline 7 \\end{array}");
    expect(w.wrong).toBe(0);
    expect(nextStep(w, new Set())).toBeNull();
  });

  it("three numbers: a column can carry 2", () => {
    const w = work("\\begin{array}{r} 99 \\\\ 99 \\\\ +99 \\\\ \\hline 297 \\end{array}");
    expect(w).toMatchObject({ result: "297", right: true });
    expect(w.carries[1]).toBe(2);
  });

  it("an extra digit in front is wrong; a leading zero is not", () => {
    expect(work("\\begin{array}{r} 286 \\\\ +680 \\\\ \\hline 1966 \\end{array}")).toMatchObject({ wrong: 3, note: "Check the answer's first digit." });
    expect(work("\\begin{array}{r} 86 \\\\ +10 \\\\ \\hline 096 \\end{array}")).toMatchObject({ wrong: -1, right: true });
  });
});

describe("taking away", () => {
  it("52 - 17 = 35, borrowing from the tens", () => {
    const w = work("\\begin{array}{c} 52 \\\\ -17 \\\\ \\hline 35 \\end{array}");
    expect(w).toMatchObject({ result: "35", right: true });
    // the tens lent 1 to the ones
    expect(w.carries[1]).toBe(1);
  });

  it("the smaller taken from the bigger instead of borrowing: 53 - 17 written 44", () => {
    expect(work("\\begin{array}{c} 53 \\\\ -17 \\\\ \\hline 44 \\end{array}")).toMatchObject({ wrong: 0, note: "3 is less than 7: borrow from the tens." });
  });

  it("forgetting the column lent 1: 53 - 17 written 46", () => {
    expect(work("\\begin{array}{c} 53 \\\\ -17 \\\\ \\hline 46 \\end{array}")).toMatchObject({ wrong: 1, note: "The tens lent 1, so the 5 is 4 now." });
    // the tens written first, where they sit
    expect(work("\\begin{array}{c} 53 \\\\ -17 \\\\ \\hline 4 \\end{array}", 1)).toMatchObject({ wrong: 1 });
  });

  it("borrowing across a zero: 503 - 178 = 325", () => {
    expect(work("\\begin{array}{r} 503 \\\\ -178 \\\\ \\hline 325 \\end{array}")).toMatchObject({ result: "325", right: true });
  });

  it("a difference that would be negative is not column subtraction: quiet", () => {
    expect(workStacked(parseStacked("\\begin{array}{r} 17 \\\\ -52 \\\\ \\hline 35 \\end{array}")!)).toBeNull();
  });

  it("Help writes the digit only (no carry over a column for taking away)", () => {
    const w = work("\\begin{array}{c} 52 \\\\ -17 \\\\ \\hline \\end{array}");
    expect(nextStep(w, new Set())).toEqual({ digits: [{ place: 0, digit: 5 }], carry: null });
  });
});

describe("multiplying", () => {
  it("23 x 4 = 92, carrying 1", () => {
    const w = work("\\begin{array}{r} 23 \\\\ \\times 4 \\\\ \\hline 92 \\end{array}");
    expect(w).toMatchObject({ result: "92", right: true });
    expect(nextStep(w, new Set())).toBeNull();
    const empty = work("\\begin{array}{r} 23 \\\\ \\times 4 \\\\ \\hline \\end{array}");
    expect(nextStep(empty, new Set())).toEqual({ digits: [{ place: 0, digit: 2 }], carry: { place: 1, digit: 1 } });
  });

  it("a forgotten carry", () => {
    expect(work("\\begin{array}{r} 23 \\\\ \\times 4 \\\\ \\hline 82 \\end{array}")).toMatchObject({ wrong: 1, note: "Add the 1 you carried to the tens." });
  });

  it("by two digits written straight down: the product is checked, but there is no single next column", () => {
    const w = work("\\begin{array}{r} 23 \\\\ \\times 45 \\\\ \\hline 1035 \\end{array}");
    expect(w).toMatchObject({ result: "1035", right: true });
    expect(nextStep(work("\\begin{array}{r} 23 \\\\ \\times 45 \\\\ \\hline \\end{array}"), new Set())).toBeNull();
  });

  it("decimals in a product: quiet", () => {
    expect(workStacked(parseStacked("\\begin{array}{r} 2.5 \\\\ \\times 4 \\\\ \\hline 10.0 \\end{array}")!)).toBeNull();
  });
});

describe("decimals, lined up on the point", () => {
  it("3.50 + 12.25 = 15.75", () => {
    expect(work("\\begin{array}{r} 3.50 \\\\ +12.25 \\\\ \\hline 15.75 \\end{array}")).toMatchObject({ result: "15.75", decimals: 2, right: true });
  });

  it("3.5 + 12.25: the 5 is the tenths", () => {
    expect(work("\\begin{array}{r} 3.5 \\\\ +12.25 \\\\ \\hline 15.75 \\end{array}")).toMatchObject({ result: "15.75", right: true });
  });

  it("a point in the wrong place", () => {
    expect(work("\\begin{array}{r} 3.50 \\\\ +12.25 \\\\ \\hline 157.5 \\end{array}")).toMatchObject({ note: "Line up the decimal points." });
  });

  it("1.5 - 0.7 = 0.8", () => {
    expect(work("\\begin{array}{r} 1.5 \\\\ -0.7 \\\\ \\hline 0.8 \\end{array}")).toMatchObject({ result: "0.8", right: true });
  });

  it("names the places after the point", () => {
    expect(placeName(0, 2)).toBe("hundredths");
    expect(placeName(1, 2)).toBe("tenths");
    expect(placeName(2, 2)).toBe("ones");
    expect(placeName(3, 0)).toBe("thousands");
  });
});

describe("long multiplication: a row for each digit, then their sum", () => {
  const LONG = (rows: string) => `\\begin{array}{r} 46 \\\\ \\times 23 \\\\ \\hline ${rows} \\end{array}`;

  it.each<[string, string, Partial<StackedRead>]>([
    ["two rules", LONG("138 \\\\ 920 \\\\ \\hline 1058"), { rows: ["138", "920"], answer: "1058" }],
    ["the second rule read as a fraction's bar (Mathpix's read of the tutor's hand)", LONG("138 \\\\ \\frac{920}{1058}"), { rows: ["138", "920"], answer: "1058" }],
    ["a + before the last row", LONG("138 \\\\ +920 \\\\ \\hline 1058"), { rows: ["138", "920"], answer: "1058" }],
    ["the last row underlined", LONG("138 \\\\ \\underline{920} \\\\ 1058"), { rows: ["138", "920"], answer: "1058" }],
    ["the rows, the sum still to come", LONG("138 \\\\ 920"), { rows: ["138", "920"], answer: "" }],
    ["the rows and the second rule", LONG("138 \\\\ 920 \\\\ \\hline"), { rows: ["138", "920"], answer: "" }],
  ])("reads %s", (_name, latex, want) => {
    expect(parseStacked(latex)).toEqual({ op: "×", operands: ["46", "23"], ...want });
  });

  it("46 × 23: 138, 920, 1058 — right; the 0 holding the place may be left out", () => {
    expect(work(LONG("138 \\\\ 920 \\\\ \\hline 1058"))).toMatchObject({ result: "1058", right: true, wrong: -1, long: { want: [138, 920], wrong: -1 } });
    expect(work(LONG("138 \\\\ 92 \\\\ \\hline 1058"))).toMatchObject({ right: true, long: { wrong: -1 } });
    expect(stackedAnalysis(work(LONG("138 \\\\ 920 \\\\ \\hline 1058")), true)).toMatchObject({ verdict: "ok", solved: true });
  });

  it("a wrong row is the mistake, said in a child's words — the sum under it is not judged again", () => {
    const w = work(LONG("138 \\\\ 820 \\\\ \\hline 958"));
    expect(w).toMatchObject({ right: false, wrong: -1, long: { wrong: 1 }, note: "Check the row for the 2 tens: 46 × 20." });
    expect(stackedAnalysis(w, true)).toMatchObject({ verdict: "mismatch", note: "Check the row for the 2 tens: 46 × 20." });
    expect(work(LONG("128 \\\\ 920 \\\\ \\hline 1048"))).toMatchObject({ long: { wrong: 0 }, note: "Check the row for the 3 ones: 46 × 3." });
    expect(work(LONG("138 \\\\ 920 \\\\ 46 \\\\ \\hline 1104"))).toMatchObject({ long: { wrong: 2 }, note: "There is one row for each digit of 23." });
  });

  it("right rows, a wrong sum: ringed in its column", () => {
    const w = work(LONG("138 \\\\ 920 \\\\ \\hline 1048"));
    expect(w).toMatchObject({ right: false, wrong: 1, long: { wrong: -1 } });
    expect(stackedAnalysis(w, true).verdict).toBe("mismatch");
    // ...but only on a read the board is sure of
    expect(stackedAnalysis(w, false).verdict).toBe("unknown");
  });

  it("right so far is no mark: the rows without their sum, or the first row alone under the rule", () => {
    expect(stackedAnalysis(work(LONG("138 \\\\ 920")), true)).toMatchObject({ verdict: "none" });
    expect(stackedAnalysis(work(LONG("138")), true)).toMatchObject({ verdict: "none" });
    // the product itself straight under the rule is the answer; anything else there is wrong
    expect(stackedAnalysis(work(LONG("1058")), true)).toMatchObject({ verdict: "ok", solved: true });
    expect(stackedAnalysis(work(LONG("1048")), true)).toMatchObject({ verdict: "mismatch" });
  });

  it("a zero in the bottom number has no row of its own: 123 × 205 = 615 + 24600", () => {
    const w = work("\\begin{array}{r} 123 \\\\ \\times 205 \\\\ \\hline 615 \\\\ 24600 \\\\ \\hline 25215 \\end{array}");
    expect(w).toMatchObject({ right: true, long: { want: [615, 24600], wrong: -1 } });
  });

  it("the other ways a class sets it out are right too: partial products, the rows the other way round, a row of zeros", () => {
    const ok = { verdict: "ok", solved: true };
    // partial products (the four-row method): 6 × 3, 40 × 3, 6 × 20, 40 × 20
    expect(stackedAnalysis(work(LONG("18 \\\\ 120 \\\\ 120 \\\\ +800 \\\\ \\hline 1058")), true)).toMatchObject(ok);
    expect(stackedAnalysis(work(LONG("18 \\\\ 120 \\\\ 120 \\\\ \\frac{+800}{1058}")), true)).toMatchObject(ok);
    expect(stackedAnalysis(work(LONG("800 \\\\ 120 \\\\ 120 \\\\ 18 \\\\ \\hline 1058")), true)).toMatchObject(ok);
    // the tens row first
    expect(stackedAnalysis(work(LONG("920 \\\\ +138 \\\\ \\hline 1058")), true)).toMatchObject(ok);
    // a row of zeros for a 0 in the bottom number
    const BY = (bottom: string, rows: string) => `\\begin{array}{r} 46 \\\\ \\times ${bottom} \\\\ \\hline ${rows} \\end{array}`;
    expect(stackedAnalysis(work(BY("105", "230 \\\\ 000 \\\\ +4600 \\\\ \\hline 4830")), true)).toMatchObject(ok);
    expect(stackedAnalysis(work(BY("205", "230 \\\\ 000 \\\\ 9200 \\\\ \\hline 9430")), true)).toMatchObject(ok);
    expect(stackedAnalysis(work(BY("20", "00 \\\\ 920 \\\\ \\hline 920")), true)).toMatchObject(ok);
    expect(stackedAnalysis(work(BY("30", "000 \\\\ 1380 \\\\ \\hline 1380")), true)).toMatchObject(ok);
    expect(stackedAnalysis(work(BY("30", "00 \\\\ 138 \\\\ \\hline 1380")), true)).toMatchObject(ok);
  });

  it("set out another way, a wrong answer is still ringed, and right so far is still no mark", () => {
    // partial products, the total wrong
    expect(stackedAnalysis(work(LONG("18 \\\\ 120 \\\\ 120 \\\\ 800 \\\\ \\hline 1048")), true)).toMatchObject({ verdict: "mismatch" });
    // a partial product wrong, and the total its sum
    const slip = work(LONG("18 \\\\ 120 \\\\ 120 \\\\ 700 \\\\ \\hline 958"));
    expect(stackedAnalysis(slip, true)).toMatchObject({ verdict: "mismatch", note: "Check the rows: together they are 46 × 23." });
    // the rows the other way round, one of them wrong: the row is named
    expect(stackedAnalysis(work(LONG("920 \\\\ 128 \\\\ \\hline 1048")), true)).toMatchObject({ verdict: "mismatch", note: "Check the row for the 3 ones: 46 × 3." });
    // a zero row where a row should be: the total is wrong
    expect(stackedAnalysis(work(LONG("138 \\\\ 000 \\\\ \\hline 138")), true)).toMatchObject({ verdict: "mismatch" });
    // two partial products, the total still to come
    expect(stackedAnalysis(work(LONG("18 \\\\ 120")), true)).toMatchObject({ verdict: "none" });
    expect(stackedAnalysis(work(LONG("18 \\\\ 120 \\\\ \\hline")), true)).toMatchObject({ verdict: "none" });
  });

  it("nothing for Help to write into it: the rows are the student's", () => {
    expect(nextStep(work(LONG("138")), new Set())).toBeNull();
  });
});
