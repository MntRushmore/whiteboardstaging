import { evaluate } from "mathjs";
import { describe, expect, it } from "vitest";
import { LANDING_COPY } from "@/components/landing/copy";
import { handInk } from "../handInk";
import { driftSeconds, equationSides, gradeName, readableMath, STRIP_HAND, stripItemLabel, stripLines } from "../strip";

const ITEMS = LANDING_COPY.strip.items;

describe("the problem strip's lines", () => {
  it("has one line for each grade, kindergarten to 8th, in order", () => {
    expect(ITEMS.map((i) => i.grade)).toEqual(["K", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th"]);
  });

  it("is a true equation on every line, worked out", () => {
    for (const { latex } of ITEMS) {
      const [left, right] = equationSides(latex);
      // a check mark is honest on its own only for a line with nothing unknown in it
      expect(left + right, latex).not.toMatch(/[a-z]/i);
      const l = Number(evaluate(left));
      const r = Number(evaluate(right));
      expect(Number.isFinite(l) && Number.isFinite(r), latex).toBe(true);
      expect(Math.abs(l - r), `${latex}: ${l} vs ${r}`).toBeLessThan(1e-9);
    }
  });

  it("reads the strip's LaTeX the way a calculator does", () => {
    expect(equationSides("6\\times7=42")).toEqual(["6*7", "42"]);
    expect(equationSides("\\frac{2}{3}\\div\\frac{1}{6}=4")).toEqual(["((2)/(3))/((1)/(6))", "4"]);
    expect(equationSides("3^{2}+4^2=5^2")).toEqual(["3^(2)+4^2", "5^2"]);
    // and it would catch a wrong line
    const [l, r] = equationSides("\\frac{3}{4}=\\frac{5}{8}");
    expect(Number(evaluate(l))).not.toBeCloseTo(Number(evaluate(r)));
    expect(() => equationSides("2x+3")).toThrow(/not one equation/);
  });

  it("is written by the hand engine, every line (it throws on one it cannot write)", () => {
    for (const { latex } of ITEMS) {
      const ink = handInk(latex, STRIP_HAND);
      expect(ink.strokes.length, latex).toBeGreaterThan(2);
    }
  });

  it("reads each line out once, as words and maths", () => {
    expect(gradeName("K")).toBe("Kindergarten");
    expect(gradeName("3rd")).toBe("3rd grade");
    expect(readableMath("6\\times7=42")).toBe("6 × 7 = 42");
    expect(readableMath("52-17=35")).toBe("52 − 17 = 35");
    expect(readableMath("-3+8=5")).toBe("−3 + 8 = 5");
    expect(readableMath("\\frac{3}{4}=\\frac{6}{8}")).toBe("3/4 = 6/8");
    expect(readableMath("\\frac{2}{3}\\div\\frac{1}{6}=4")).toBe("2/3 ÷ 1/6 = 4");
    expect(readableMath("2.5\\times4=10")).toBe("2.5 × 4 = 10");
    expect(readableMath("3^2+4^2=5^2")).toBe("3² + 4² = 5²");
    expect(stripItemLabel({ grade: "3rd", latex: "6\\times7=42" })).toBe("3rd grade: 6 × 7 = 42");
    expect(stripItemLabel({ grade: "K", latex: "3+2=5" })).toBe("Kindergarten: 3 + 2 = 5");
    for (const item of ITEMS) expect(stripItemLabel(item)).not.toMatch(/\\|[{}^]/);
  });

  it("writes the lines in one after another on the first pass, each checked after it is written", () => {
    const lines = stripLines(ITEMS);
    expect(lines).toHaveLength(ITEMS.length);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      expect(line.width).toBeGreaterThan(0);
      expect(line.checkAtMs).toBeGreaterThan(line.startMs + 200);
      if (i > 0) expect(line.startMs).toBeGreaterThan(lines[i - 1].startMs);
    }
    // a fraction's main line sits low in its box: it moves up, a plain line hardly at all
    const fraction = lines.find((l) => l.grade === "4th")!;
    const plain = lines.find((l) => l.grade === "1st")!;
    expect(Math.abs(plain.shift)).toBeLessThan(3);
    expect(Math.abs(fraction.shift)).toBeGreaterThan(Math.abs(plain.shift));
  });

  it("drifts slowly: a lap of the row takes over a minute", () => {
    const row = stripLines(ITEMS).reduce((sum, l) => sum + l.width + 170, 0);
    expect(driftSeconds(row, 22)).toBeGreaterThan(60);
  });
});
