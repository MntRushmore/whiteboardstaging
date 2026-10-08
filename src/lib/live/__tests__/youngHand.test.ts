import { beforeAll, describe, expect, it } from "vitest";
import type { LiveEngine } from "../contracts";
import { getEngine } from "../engine";
import { analyzeColumn } from "../localSolve";
import { isLoneRelation } from "../policy";
import { readYoungHand } from "../youngHand";

const ARITHMETIC = { arithmetic: true };
const ANYWHERE = { arithmetic: false };

describe("readYoungHand: a wobbly `=` as Mathpix reads it", () => {
  it("a curved bar (`\\smile`, `\\frown`) is never maths at school: always `=`", () => {
    for (const ctx of [ARITHMETIC, ANYWHERE]) {
      expect(readYoungHand("\\smile", ctx)).toBe("=");
      expect(readYoungHand("\\frown", ctx)).toBe("=");
      expect(readYoungHand("\\smile 7", ctx)).toBe("= 7");
      expect(readYoungHand("X \\smile 7", ctx)).toBe("X = 7");
      expect(readYoungHand("4+3 \\frown 7", ctx)).toBe("4+3 = 7");
      expect(readYoungHand("⌣ 9", ctx)).toBe("= 9");
      expect(readYoungHand("\\smallsmile11", ctx)).toBe("= 11");
    }
  });

  it("two bars read stacked are one `=`", () => {
    expect(readYoungHand("\\underset{\\smile}{\\frown}", ANYWHERE)).toBe("=");
    expect(readYoungHand("\\frac{-}{-}", ANYWHERE)).toBe("=");
    expect(readYoungHand("\\stackrel{\\frown}{\\smile} 9", ANYWHERE)).toBe("= 9");
    expect(readYoungHand("\\frac{\\sim}{-} 7", ARITHMETIC)).toBe("= 7");
    // a real fraction stays one
    expect(readYoungHand("\\frac{1}{2}", ARITHMETIC)).toBe("\\frac{1}{2}");
  });

  it("a relation look-alike alone on a line is an `=` waiting for its answer", () => {
    for (const read of ["\\asymp", "\\approx", "\\sim", "\\sim \\sim", "\\simeq", "\\cong", "\\equiv", "≈", "~", "= ="]) {
      expect(readYoungHand(read, ANYWHERE), read).toBe("=");
      expect(isLoneRelation(readYoungHand(read, ANYWHERE))).toBe(true);
    }
    // a lone curved bar read as a set sign, a wedge, a `v`, or a lone minus: in arithmetic only
    for (const read of ["\\cup", "\\cap", "\\wedge", "\\vee", "v", "-"]) {
      expect(readYoungHand(read, ARITHMETIC), read).toBe("=");
      expect(readYoungHand(read, ANYWHERE), read).toBe(read);
    }
  });

  it("in arithmetic, a look-alike starting the line is the `=` of her answer", () => {
    expect(readYoungHand("\\approx 7", ARITHMETIC)).toBe("= 7");
    expect(readYoungHand("\\asymp 11", ARITHMETIC)).toBe("= 11");
    expect(readYoungHand("\\sim9", ARITHMETIC)).toBe("= 9");
    expect(readYoungHand("\\cup 7", ARITHMETIC)).toBe("= 7");
    expect(readYoungHand("v 9", ARITHMETIC)).toBe("= 9");
    expect(readYoungHand("\\approx 3.75", ARITHMETIC)).toBe("= 3.75");
    expect(readYoungHand("\\sim \\sim 12", ARITHMETIC)).toBe("= 12");
    // a minus before a number is a negative number
    expect(readYoungHand("-7", ARITHMETIC)).toBe("-7");
    // ...and elsewhere `\approx 2.41` under `x = 1 + \sqrt{2}` is meant
    expect(readYoungHand("\\approx 2.41", ANYWHERE)).toBe("\\approx 2.41");
    expect(readYoungHand("\\sim 7", ANYWHERE)).toBe("\\sim 7");
  });

  it("between two sides: any look-alike in arithmetic, elsewhere only one the engine cannot read on a line of numbers", () => {
    expect(readYoungHand("4+3 \\approx 7", ARITHMETIC)).toBe("4+3 = 7");
    expect(readYoungHand("4+3\\asymp7", ARITHMETIC)).toBe("4+3 = 7");
    expect(readYoungHand("5+6 \\equiv 11", ARITHMETIC)).toBe("5+6 = 11");
    expect(readYoungHand("4+3 \\asymp 7", ANYWHERE)).toBe("4+3 = 7");
    expect(readYoungHand("(2+3) \\sim (1+4)", ANYWHERE)).toBe("(2+3) = (1+4)");
  });

  it("a genuine `\\approx`, `\\cong`, `\\sim` or `\\equiv` stays", () => {
    for (const read of [
      "48+31 \\approx 80",
      "x \\approx 2.41",
      "\\sqrt{2} \\approx 1.41",
      "\\pi \\approx 3.14",
      "\\triangle ABC \\cong \\triangle DEF",
      "\\overline{AB} \\cong \\overline{CD}",
      "X \\sim N(0, 1)",
      "17 \\equiv 2 \\pmod{5}",
      "a \\equiv b",
      "y \\approx 0.5 x",
    ]) {
      expect(readYoungHand(read, ANYWHERE), read).toBe(read);
    }
  });

  it("in arithmetic, the tick she drew after her answer is no part of it", () => {
    expect(readYoungHand("=7 \\checkmark", ARITHMETIC)).toBe("=7");
    expect(readYoungHand("=9 \\vee", ARITHMETIC)).toBe("=9");
    expect(readYoungHand("= 11 v", ARITHMETIC)).toBe("= 11");
    expect(readYoungHand("=9\\sqrt{}", ARITHMETIC)).toBe("=9");
    expect(readYoungHand("=7 \\text { ✓ }", ARITHMETIC)).toBe("=7");
    expect(readYoungHand("\\asymp 7 \\checkmark", ARITHMETIC)).toBe("= 7");
    // ...not in algebra, where `2v` is two v's
    expect(readYoungHand("x = 2v", ANYWHERE)).toBe("x = 2v");
    expect(readYoungHand("=9 \\vee", ANYWHERE)).toBe("=9 \\vee");
  });

  it("a read with nothing to change is returned as it came", () => {
    for (const read of ["=7", "7+2=9", "2x + 3 = 11", "\\frac{1}{2} + \\frac{1}{4} = \\frac{3}{4}", "14", "x^{2} - 4 = 0", "-3"]) {
      expect(readYoungHand(read, ARITHMETIC), read).toBe(read);
      expect(readYoungHand(read, ANYWHERE), read).toBe(read);
    }
  });
});

describe("readYoungHand: what the engine makes of her answers once they read as she wrote them", () => {
  let engine: LiveEngine;
  beforeAll(async () => {
    engine = await getEngine();
  });

  const judged = (problem: string, read: string) => analyzeColumn(engine, [problem, readYoungHand(read, ARITHMETIC)], "feedback")[1];

  it("right answers are right", () => {
    expect(judged("4+3", "\\approx 7")).toMatchObject({ verdict: "ok" });
    expect(judged("5+6", "\\asymp 11")).toMatchObject({ verdict: "ok" });
    expect(judged("7+2", "=9 \\vee")).toMatchObject({ verdict: "ok" });
    expect(judged("8+1", "\\smile 9")).toMatchObject({ verdict: "ok" });
    expect(judged("4+3", "4+3 \\asymp 7")).toMatchObject({ verdict: "ok" });
  });

  it("and a wrong one is still wrong", () => {
    expect(judged("4+3", "\\approx 8")).toMatchObject({ verdict: "mismatch" });
    expect(judged("5+6", "\\smile 12")).toMatchObject({ verdict: "mismatch" });
  });
});
