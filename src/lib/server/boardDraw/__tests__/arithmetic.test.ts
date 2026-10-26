import { describe, expect, it } from "vitest";
import { evaluate, falseEquations, numberText } from "../arithmetic";

describe("evaluate", () => {
  it("does + − × ÷ with brackets, precedence and thousands commas", () => {
    expect(evaluate("600 + 125")).toBe(725);
    expect(evaluate("(100 − 1296) + 1")).toBe(-1195);
    expect(evaluate("1,385 + 2,749")).toBe(4134);
    expect(evaluate("2 + 3 × 4")).toBe(14);
    expect(evaluate("864 ÷ 6")).toBe(144);
    expect(evaluate("2 +")).toBeNull();
  });
});

describe("falseEquations", () => {
  it("finds a wrong sum and passes right ones (the owner's board, 2026-10-26)", () => {
    expect(falseEquations("Write 68 + 57 = 125, then 600 + 125 = 725.")).toEqual([]);
    expect(falseEquations("68 + 57 = 120")).toEqual(["68 + 57 = 120"]);
    expect(falseEquations("1,385 + 2,749 = 4,134")).toEqual([]);
    expect(falseEquations("1,385 + 2,749 = 4,034")).toEqual(["1,385 + 2,749 = 4,034"]);
  });

  it("leaves equations with letters alone, and lists that aren't sums", () => {
    expect(falseEquations("2x + 3 = 11, so 2x = 8 and x = 4")).toEqual([]);
    expect(falseEquations("Column sums: 3, 12, 14")).toEqual([]);
  });

  it("reads whole statements only (the picture bench, 2026-10-26)", () => {
    // a chain: "= -4 - (-5) = 1" is not "= -4" (a 70 s recheck on right working)
    expect(falseEquations("-7 + 3 - (-5) = -4 - (-5) = 1")).toEqual([]);
    expect(falseEquations("-7 + 3 = -4, then -4 - (-5) = 1")).toEqual([]);
    // a fraction or a power after "=" is not its first number
    expect(falseEquations("9/12 + 8/12 = 17/12")).toEqual([]);
    expect(falseEquations("2^3 × 2^4 = 2^7 = 128")).toEqual([]);
    // an x next to a number is a letter; between spaces it is a times sign
    expect(falseEquations("3x-7 = 8, so 3x = 15")).toEqual([]);
    expect(falseEquations("x - 3 + 2 = 11")).toEqual([]);
    expect(falseEquations("3 x 4 = 12")).toEqual([]);
    expect(falseEquations("3 x 4 = 13")).toEqual(["3 x 4 = 13"]);
    // and a real slip in a chain is still caught
    expect(falseEquations("-7 + 3 = -5")).toEqual(["-7 + 3 = -5"]);
  });

  it("accepts a rounded answer to the places it shows", () => {
    expect(falseEquations("10 ÷ 3 = 3.33")).toEqual([]);
    expect(falseEquations("10 ÷ 3 = 3.5")).toEqual(["10 ÷ 3 = 3.5"]);
  });
});

describe("numberText", () => {
  it("writes whole numbers plainly and the rest to at most 4 places", () => {
    expect(numberText(2)).toBe("2");
    expect(numberText(-1195)).toBe("-1195");
    expect(numberText(10 / 3)).toBe("3.3333");
    expect(numberText(0.25)).toBe("0.25");
  });
});
